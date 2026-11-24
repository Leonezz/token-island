import AppKit
import Foundation
import SwiftUI

// MARK: - Island data + presentation state
//
// Single observable model shared by the SwiftUI island and the AppKit panel
// controller: polling data, offline detection, expansion/pin state and the
// transient toast. All mutations happen on the main actor.

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

    // MARK: Presentation

    @Published private(set) var expanded = false
    @Published private(set) var pinned = false
    @Published private(set) var panelVisible = true
    @Published private(set) var toast: String?

    // MARK: Dependencies

    let config: IslandConfig
    let settings: AppSettings
    let demoMode: Bool
    private let fixturePath: String?

    private var pollTask: Task<Void, Never>?
    private var toastTimer: MainTimer?
    private var failures = 0

    /// Presentation hooks consumed by the AppKit panel controller. Using plain
    /// callbacks (instead of Combine subscriptions) keeps every window mutation
    /// on the main actor with no cross-context plumbing.
    var onExpansionChange: ((Bool) -> Void)?
    var onVisibilityChange: ((Bool) -> Void)?

    /// Number of consecutive failed polls tolerated before the offline state.
    static let failureThreshold = 3

    init(config: IslandConfig, demoMode: Bool, fixturePath: String? = nil, settings: AppSettings? = nil) {
        self.config = config
        self.demoMode = demoMode
        self.fixturePath = fixturePath
        self.settings = settings ?? AppSettings.shared
    }

    deinit {
        pollTask?.cancel()
    }

    // MARK: Lifecycle

    func start() {
        if demoMode {
            loadDemoData()
        } else {
            pollTask = Task { [weak self] in
                await self?.pollLoop()
            }
        }
    }

    func stop() {
        pollTask?.cancel()
        pollTask = nil
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

    private func pollOnce() async {
        guard let url = URL(string: "http://127.0.0.1:\(port)/api/summary?range=today&days=14") else {
            return
        }
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = 1.5
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
            let decoded = try JSONDecoder().decode(Summary.self, from: data)
            apply(summary: decoded)
            lastSuccessfulPoll = Date()
        } catch {
            registerFailure(error)
        }
    }

    private enum PollError: Error {
        case badResponse
        case statusCode(Int)
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
            Logger.info("collector reconnected on 127.0.0.1:\(port)")
            showToast("Collector reconnected")
        }
    }

    private func registerFailure(_ error: Error) {
        failures += 1
        isLoading = false
        if failures == 1 {
            Logger.info("collector poll failed on 127.0.0.1:\(port): \(error.localizedDescription)")
        }
        if failures >= Self.failureThreshold, !offline {
            offline = true
            Logger.info("collector offline after \(failures) failures · keeping stale data")
            showToast("Collector offline")
        }
    }

    // MARK: Derived presentation state

    /// Clock used for relative timestamps. Demo/snapshot data keeps the fixture
    /// clock so "just now" stays stable.
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

    /// Effective collector port: Preferences > config file > default.
    var port: Int { settings.collectorPort }

    /// Port caption shown in the offline state / preferences.
    var endpointCaption: String { "127.0.0.1:\(port)" }

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
        // Step-only motion: the toast snaps in and out, no fades.
        toastTimer?.cancel()
        toast = message
        toastTimer = MainTimer(interval: duration) { [weak self] in
            self?.toast = nil
        }
    }

    // MARK: Actions

    /// "Sync cloud now" -> POST /api/cloud/sync on the local collector.
    func syncCloudNow() {
        guard !demoMode else {
            showToast("Demo mode · sync disabled")
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

    /// Dashboard URL: provider's endpoint + username when available.
    func dashboardURL() -> URL? {
        if let base = config.cloudURL { return Self.dashboardURL(base: base, username: summary?.collector.cloud.username) }
        if let endpoint = summary?.collector.cloud.endpoint, let base = URL(string: endpoint) {
            return Self.dashboardURL(base: base, username: summary?.collector.cloud.username)
        }
        return nil
    }

    private static func dashboardURL(base: URL, username: String?) -> URL {
        guard let username, !username.isEmpty, !base.path.contains("/u/") else { return base }
        return base.appendingPathComponent("u").appendingPathComponent(username)
    }

    func openDashboard() {
        guard let url = dashboardURL() else {
            showToast("No dashboard configured")
            return
        }
        NSWorkspace.shared.open(url)
    }
}
