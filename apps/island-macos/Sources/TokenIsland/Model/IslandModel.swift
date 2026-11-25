import AppKit
import Foundation
import SwiftUI

// MARK: - Island data + presentation state + local collector supervision
//
//  - Local mode:
//      * Launches & keeps alive `collector.mjs` on `127.0.0.1:<port>`
//      * `Open Dashboard` opens the built-in Local Telemetry Web Dashboard at
//        `http://127.0.0.1:<port>/` (works 100% offline with zero Cloud setup)
//  - Remote mode:
//      * Stops managed local collector and polls `/api/v1/me/summary` (when signed
//        in via GitHub / Keychain), `/api/v1/u/:user`, or `/api/summary`.

enum IslandStatus {
    case live
    case idle
    case offline

    var label: String {
        switch self {
        case .live: return "LIVE"
        case .idle: return "IDLE"
        case .offline: return "OFFLINE"
        }
    }
}

@MainActor
final class IslandModel: ObservableObject {

    // MARK: Data

    @Published private(set) var summary: Summary?
    @Published private(set) var offline = false
    @Published private(set) var isLoading = true
    @Published private(set) var lastSuccessfulPoll: Date?
    @Published private(set) var lastPollError: String?

    // MARK: Presentation

    @Published private(set) var expanded = false
    @Published private(set) var pinned = false
    @Published private(set) var panelVisible = true
    @Published private(set) var toast: String?
    /// Hardware notch footprint (width x safeAreaTop) measured from the target screen.
    @Published var notchSize = CGSize(width: DS.Size.collapsedWidth, height: DS.Size.collapsedHeight)

    // MARK: Dependencies

    let config: IslandConfig
    let settings: AppSettings
    let supervisor: CollectorSupervisor
    let githubAuth: GitHubAuthCoordinator
    let demoMode: Bool
    private let fixturePath: String?

    private var pollTask: Task<Void, Never>?
    private var toastTimer: MainTimer?
    private var failures = 0

    var onExpansionChange: ((Bool) -> Void)?
    var onVisibilityChange: ((Bool) -> Void)?

    static let failureThreshold = 3

    init(
        config: IslandConfig,
        demoMode: Bool,
        fixturePath: String? = nil,
        settings: AppSettings? = nil,
        supervisor: CollectorSupervisor? = nil,
        githubAuth: GitHubAuthCoordinator? = nil
    ) {
        self.config = config
        self.demoMode = demoMode
        self.fixturePath = fixturePath
        let resolvedSettings = settings ?? AppSettings.shared
        self.settings = resolvedSettings
        self.supervisor = supervisor ?? CollectorSupervisor()
        let auth = githubAuth ?? GitHubAuthCoordinator()
        self.githubAuth = auth

        resolvedSettings.onConnectionSettingsChanged = { [weak self] in
            self?.handleConnectionSettingsChanged()
        }

        if !demoMode {
            auth.bootstrap(
                serverURL: resolvedSettings.serverURL,
                username: resolvedSettings.remoteUsername,
                configPath: resolvedSettings.configPath
            )
        }
    }

    deinit {
        pollTask?.cancel()
    }

    // MARK: Lifecycle

    func start() {
        if demoMode {
            loadDemoData()
        } else {
            reconcileSupervisor()
            pollTask = Task { [weak self] in
                await self?.pollLoop()
            }
        }
    }

    func stop() {
        pollTask?.cancel()
        pollTask = nil
        supervisor.deactivate()
    }

    func restartLocalCollector() {
        guard !demoMode, settings.serverMode == .local else { return }
        let targetPort = port
        showToast("Restarting local collector…")
        Task { [weak self] in
            guard let self else { return }
            await self.supervisor.forceRestart(port: targetPort)
            try? await Task.sleep(nanoseconds: 900_000_000)
            await self.pollOnce()
        }
    }

    func refreshNow() {
        guard !demoMode else { return }
        failures = 0
        Task { [weak self] in
            await self?.pollOnce()
        }
    }

    func applyGitHubLoginSuccess(baseURL: String, username: String) {
        ConfigWriter.saveCloudLogin(
            configPath: settings.configPath,
            serverURL: baseURL,
            username: username
        )
        settings.serverURL = baseURL
        settings.remoteUsername = username
        showToast("Signed in as @\(username)")

        if !demoMode {
            if settings.serverMode == .local {
                let targetPort = port
                // Force-restart collector so it picks up Keychain TOKEN_ISLAND_API_KEY, then sync.
                Task { [weak self] in
                    guard let self else { return }
                    await self.supervisor.forceRestart(port: targetPort)
                    try? await Task.sleep(nanoseconds: 1_200_000_000)
                    await self.pollOnce()
                    self.syncCloudNow()
                }
            } else {
                refreshNow()
            }
        }
    }

    func applySignOut() {
        showToast("Signed out of Cloud")
        if !demoMode, settings.serverMode == .local {
            let targetPort = port
            Task { [weak self] in
                guard let self else { return }
                await self.supervisor.forceRestart(port: targetPort)
                try? await Task.sleep(nanoseconds: 900_000_000)
                await self.pollOnce()
            }
            return
        }
        refreshNow()
    }

    private func handleConnectionSettingsChanged() {
        guard !demoMode else { return }
        failures = 0
        lastPollError = nil
        reconcileSupervisor()
        Task { [weak self] in
            await self?.pollOnce()
        }
    }

    private func reconcileSupervisor() {
        guard !demoMode else { return }
        switch settings.serverMode {
        case .local:
            supervisor.activate(port: port)
        case .remote:
            supervisor.deactivate()
        }
    }

    private func loadDemoData() {
        let path = FixtureLoader.resolve(explicit: fixturePath)
        if let summary = FixtureLoader.load(path: path) {
            apply(summary: summary)
            lastSuccessfulPoll = Date()
        } else {
            isLoading = false
            offline = true
            showToast("Demo fixture missing")
        }
    }

    // MARK: Polling

    private func pollLoop() async {
        while !Task.isCancelled {
            await pollOnce()
            let interval = max(0.5, settings.refreshInterval)
            try? await Task.sleep(nanoseconds: UInt64(interval * 1_000_000_000))
        }
    }

    func pollOnce() async {
        switch settings.serverMode {
        case .local:
            await pollLocalCollector()
        case .remote:
            await pollRemoteServer()
        }
    }

    private func pollLocalCollector() async {
        guard let url = URL(string: "http://127.0.0.1:\(port)/api/summary?range=today&days=14") else {
            return
        }
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = 1.8
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue("no-store", forHTTPHeaderField: "Cache-Control")

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse else {
                throw PollError.badResponse
            }
            guard (200..<300).contains(http.statusCode) else {
                throw PollError.statusCode(http.statusCode)
            }
            let decoded = try Summary.decodeFlexible(from: data)
            apply(summary: decoded)
            lastSuccessfulPoll = Date()
            lastPollError = nil
        } catch {
            registerFailure(error, target: "127.0.0.1:\(port)")
        }
    }

    private func pollRemoteServer() async {
        guard let resolved = ServerEndpointResolver.resolve(
            rawURL: settings.serverURL,
            explicitUsername: settings.remoteUsername
        ) else {
            lastPollError = "Configure Remote Server URL in Preferences"
            isLoading = false
            offline = true
            return
        }

        let activeKey = KeychainStore.readAPIKey(fallbackConfigPath: settings.configPath)
            ?? (config.cloudAPIKey.isEmpty ? nil : config.cloudAPIKey)

        var candidateURLs: [URL] = []
        // Authenticated owner summary works even when visibility == private/unlisted!
        if let activeKey, !activeKey.isEmpty,
           let meSummaryURL = URL(string: "\(resolved.baseString)/api/v1/me/summary") {
            candidateURLs.append(meSummaryURL)
        }
        if let username = resolved.username, !username.isEmpty,
           let encoded = username.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed),
           let cloudStatsURL = URL(string: "\(resolved.baseString)/api/v1/u/\(encoded)") {
            candidateURLs.append(cloudStatsURL)
        }
        if let collectorSummaryURL = URL(string: "\(resolved.baseString)/api/summary?range=today&days=14") {
            candidateURLs.append(collectorSummaryURL)
        }
        if resolved.username == nil,
           let demoStatsURL = URL(string: "\(resolved.baseString)/api/v1/u/demo") {
            candidateURLs.append(demoStatsURL)
        }

        var lastError: Error = PollError.badResponse
        for url in candidateURLs {
            var request = URLRequest(url: url)
            request.httpMethod = "GET"
            request.timeoutInterval = 6.0
            request.cachePolicy = .reloadIgnoringLocalCacheData
            request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
            if let activeKey, !activeKey.isEmpty {
                request.setValue("Bearer \(activeKey)", forHTTPHeaderField: "Authorization")
            }

            do {
                let (data, response) = try await URLSession.shared.data(for: request)
                guard let http = response as? HTTPURLResponse else {
                    lastError = PollError.badResponse
                    continue
                }
                guard (200..<300).contains(http.statusCode) else {
                    lastError = PollError.statusCode(http.statusCode)
                    continue
                }
                let decoded = try Summary.decodeFlexible(from: data, endpoint: resolved.baseString)
                apply(summary: decoded)
                lastSuccessfulPoll = Date()
                lastPollError = nil
                return
            } catch {
                lastError = error
            }
        }

        registerFailure(lastError, target: resolved.baseString)
    }

    private enum PollError: LocalizedError {
        case badResponse
        case statusCode(Int)

        var errorDescription: String? {
            switch self {
            case .badResponse: return "Invalid HTTP response"
            case .statusCode(let code): return "HTTP \(code)"
            }
        }
    }

    private func apply(summary: Summary) {
        let wasOffline = offline
        let wasFirstLoad = self.summary == nil
        self.summary = summary
        failures = 0
        isLoading = false
        if wasFirstLoad {
            Logger.info("summary loaded · today=\(summary.today.totalTokens) tokens · \(summary.today.messages) turns · live=\(summary.live.count)")
        }
        if wasOffline {
            offline = false
            Logger.info("server reconnected (\(endpointCaption))")
            showToast(settings.serverMode == .remote ? "Remote server connected" : "Collector reconnected")
        }
    }

    private func registerFailure(_ error: Error, target: String) {
        failures += 1
        isLoading = false
        lastPollError = error.localizedDescription
        if failures == 1 {
            Logger.info("poll failed on \(target): \(error.localizedDescription)")
        }
        if failures >= Self.failureThreshold, !offline {
            offline = true
            Logger.info("server offline after \(failures) failures (\(target)) · keeping stale data")
            showToast(settings.serverMode == .remote ? "Remote server unreachable" : "Local collector starting…")
        }
    }

    // MARK: Derived presentation state

    var now: Double {
        if demoMode, let summary { return summary.referenceNow }
        return Date().timeIntervalSince1970 * 1_000
    }

    var status: IslandStatus {
        if offline { return .offline }
        guard let summary else { return .idle }
        return summary.isLive(now: now) ? .live : .idle
    }

    var displaySummary: Summary { summary ?? .empty }
    var dataIsStale: Bool { offline }
    var serverMode: ServerMode { settings.serverMode }
    var port: Int { settings.collectorPort }

    var endpointCaption: String {
        switch settings.serverMode {
        case .local:
            return "127.0.0.1:\(port)"
        case .remote:
            if let resolved = ServerEndpointResolver.resolve(
                rawURL: settings.serverURL,
                explicitUsername: settings.remoteUsername
            ) {
                let host = resolved.baseURL.host ?? resolved.baseString
                if let port = resolved.baseURL.port {
                    return "\(host):\(port)"
                }
                return host
            }
            return "remote unconfigured"
        }
    }

    // MARK: Expansion / pin

    func setExpanded(_ value: Bool) {
        guard expanded != value else { return }
        expanded = value
        if !value {
            pinned = false
        }
        onExpansionChange?(value)
    }

    func expandAndPin() {
        pinned = true
        guard !expanded else { return }
        expanded = true
        onExpansionChange?(true)
    }

    func togglePin() {
        pinned.toggle()
    }

    func collapse() {
        guard expanded else { return }
        expanded = false
        pinned = false
        onExpansionChange?(false)
    }

    func hidePanel() {
        guard panelVisible else { return }
        collapse()
        panelVisible = false
        onVisibilityChange?(false)
    }

    func showPanel() {
        guard !panelVisible else { return }
        panelVisible = true
        onVisibilityChange?(true)
    }

    func togglePanelVisibility() {
        if panelVisible {
            hidePanel()
        } else {
            showPanel()
        }
    }

    // MARK: Toast

    func showToast(_ message: String, duration: TimeInterval = 2.6) {
        toastTimer?.cancel()
        toast = message
        toastTimer = MainTimer(interval: duration) { [weak self] in
            self?.toast = nil
        }
    }

    // MARK: Actions

    func syncCloudNow() {
        guard !demoMode else {
            showToast("Demo mode · sync disabled")
            return
        }
        if settings.serverMode == .remote {
            showToast("Refreshing remote server…", duration: 2.0)
            refreshNow()
            return
        }
        showToast("Syncing cloud…", duration: 8)
        let port = self.port
        Task { [weak self] in
            guard let self else { return }
            guard let url = URL(string: "http://127.0.0.1:\(port)/api/cloud/sync") else { return }
            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.timeoutInterval = 20
            do {
                let (_, response) = try await URLSession.shared.data(for: request)
                let code = (response as? HTTPURLResponse)?.statusCode ?? 0
                if code == 200 {
                    self.showToast("Cloud synced")
                } else {
                    self.showToast("Cloud sync failed · HTTP \(code)")
                }
            } catch {
                self.showToast("Cloud sync failed")
            }
        }
    }

    private var signedInUsername: String? {
        if case .signedIn(let username, _, _, _) = githubAuth.state, !username.isEmpty {
            return username
        }
        return nil
    }

    private var effectiveCloudUsername: String? {
        if let signedInUsername {
            return signedInUsername
        }
        if !settings.remoteUsername.isEmpty {
            return settings.remoteUsername
        }
        if let cloudUser = summary?.collector.cloud.username, !cloudUser.isEmpty {
            return cloudUser
        }
        if !config.cloudUsername.isEmpty {
            return config.cloudUsername
        }
        return nil
    }

    /// True only when a public Cloud profile is genuinely configured & authenticated/enabled.
    var hasActiveCloudProfile: Bool {
        if case .signedIn(_, _, let visibility, _) = githubAuth.state {
            return visibility == "public" && cloudDashboardURL() != nil
        }
        if summary?.collector.cloud.enabled == true, effectiveCloudUsername != nil {
            return cloudDashboardURL() != nil
        }
        return false
    }

    /// Primary Dashboard URL:
    ///  - In `.local` mode: ALWAYS points to the built-in Local Telemetry Web
    ///    Dashboard (`http://127.0.0.1:<port>/`) so it opens reliably with zero
    ///    Cloud configuration.
    ///  - In `.remote` mode: points to `<remoteServerURL>/u/<username>` (or `<remoteServerURL>/`).
    func dashboardURL() -> URL? {
        if settings.serverMode == .local {
            return URL(string: "http://127.0.0.1:\(port)/")
        }
        return cloudDashboardURL()
    }

    /// Optional public Cloud profile URL (`<cloudURL>/u/<username>`).
    func cloudDashboardURL() -> URL? {
        let fallbackUser = effectiveCloudUsername

        if let resolved = ServerEndpointResolver.resolve(
            rawURL: settings.serverURL,
            explicitUsername: fallbackUser ?? ""
        ) {
            return Self.appendUserPath(base: resolved.baseURL, username: resolved.username)
        }
        if let base = config.cloudURL {
            return Self.appendUserPath(base: base, username: fallbackUser)
        }
        if let endpoint = summary?.collector.cloud.endpoint, let base = URL(string: endpoint) {
            return Self.appendUserPath(base: base, username: fallbackUser)
        }
        return nil
    }

    private static func appendUserPath(base: URL, username: String?) -> URL {
        guard let username, !username.isEmpty, !base.path.contains("/u/") else { return base }
        return base.appendingPathComponent("u").appendingPathComponent(username)
    }

    func openDashboard() {
        if settings.serverMode == .local {
            guard let localURL = URL(string: "http://127.0.0.1:\(port)/") else { return }
            if demoMode {
                NSWorkspace.shared.open(localURL)
                return
            }
            let targetPort = port
            Task { [weak self] in
                guard let self else { return }
                if await CollectorSupervisor.isDashboardReady(port: targetPort) {
                    NSWorkspace.shared.open(localURL)
                    return
                }
                self.showToast("Starting local dashboard…", duration: 4.0)
                await self.supervisor.forceRestart(port: targetPort)
                for _ in 0..<20 {
                    try? await Task.sleep(nanoseconds: 250_000_000)
                    if await CollectorSupervisor.isDashboardReady(port: targetPort) {
                        NSWorkspace.shared.open(localURL)
                        return
                    }
                }
                if await CollectorSupervisor.probeHealth(port: targetPort) {
                    NSWorkspace.shared.open(localURL)
                } else {
                    self.showToast("Local collector failed to start · check Preferences", duration: 4.0)
                }
            }
            return
        }

        guard let candidate = cloudDashboardURL() else {
            showToast("Set Remote Server URL in Preferences first")
            return
        }
        openVerifiedRemoteURL(candidate: candidate)
    }

    func openCloudDashboard() {
        guard let candidate = cloudDashboardURL() else {
            showToast("Configure Cloud Server URL in Preferences first")
            return
        }
        openVerifiedRemoteURL(candidate: candidate)
    }

    private func openVerifiedRemoteURL(candidate: URL) {
        let baseURL = ServerEndpointResolver.resolve(
            rawURL: settings.serverURL,
            explicitUsername: effectiveCloudUsername ?? ""
        )?.baseURL

        Task { [weak self] in
            if let status = await Self.probeHTTPStatus(url: candidate),
               (200..<400).contains(status) {
                NSWorkspace.shared.open(candidate)
                return
            }
            if let baseURL, baseURL != candidate,
               let rootStatus = await Self.probeHTTPStatus(url: baseURL),
               (200..<400).contains(rootStatus) {
                self?.showToast("Opened server root · sync or make profile Public for /u/ page", duration: 3.6)
                NSWorkspace.shared.open(baseURL)
                return
            }
            NSWorkspace.shared.open(candidate)
        }
    }

    nonisolated private static func probeHTTPStatus(url: URL) async -> Int? {
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = 2.0
        request.cachePolicy = .reloadIgnoringLocalCacheData
        do {
            let (_, response) = try await URLSession.shared.data(for: request)
            return (response as? HTTPURLResponse)?.statusCode
        } catch {
            return nil
        }
    }
}

