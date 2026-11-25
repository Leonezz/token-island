import AppKit
import SwiftUI

// MARK: - Native Preferences Window
//
// Precision Telemetry configuration window:
//  - Local vs Remote Server mode switcher
//  - Local Collector supervision status + Port + Restart + instant Local Dashboard
//  - Cloud Server URL + one-click GitHub Login (OAuth Device Flow) + Visibility
//    (`Public / Unlisted / Private`) + macOS Keychain storage
//  - Refresh interval (1s / 2s / 5s), Launch at Login, local paths

@MainActor
final class PreferencesWindowController {
    private var window: NSWindow?

    static let windowSize = NSSize(width: 510, height: 590)

    func show(model: IslandModel, settings: AppSettings) {
        if let window {
            NSApp.activate(ignoringOtherApps: true)
            window.makeKeyAndOrderFront(nil)
            return
        }
        let window = NSWindow(
            contentRect: NSRect(origin: .zero, size: Self.windowSize),
            styleMask: [.titled, .closable],
            backing: .buffered,
            defer: false
        )
        window.title = "Token Island Preferences"
        window.isReleasedWhenClosed = false
        window.titlebarAppearsTransparent = true
        window.backgroundColor = NSColor(DS.Palette.surface)
        window.isMovableByWindowBackground = false
        window.contentView = NSHostingView(
            rootView: PreferencesView(
                settings: settings,
                model: model,
                supervisor: model.supervisor,
                githubAuth: model.githubAuth
            )
        )
        window.center()
        self.window = window
        NSApp.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
    }
}

struct PreferencesView: View {
    @ObservedObject var settings: AppSettings
    @ObservedObject var model: IslandModel
    @ObservedObject var supervisor: CollectorSupervisor
    @ObservedObject var githubAuth: GitHubAuthCoordinator

    @State private var serverURLText: String
    @State private var usernameText: String
    @State private var portText: String
    @State private var portValid: Bool = true
    @State private var urlValid: Bool = true
    @State private var launchAtLogin: Bool
    @State private var statusMessage: String?
    @State private var statusIsError: Bool = false

    private static let visibilityOptions: [(key: String, label: String)] = [
        ("public", "Public"),
        ("unlisted", "Unlisted"),
        ("private", "Private"),
    ]

    init(
        settings: AppSettings,
        model: IslandModel,
        supervisor: CollectorSupervisor,
        githubAuth: GitHubAuthCoordinator
    ) {
        self.settings = settings
        self.model = model
        self.supervisor = supervisor
        self.githubAuth = githubAuth
        _serverURLText = State(initialValue: settings.serverURL)
        _usernameText = State(initialValue: settings.remoteUsername)
        _portText = State(initialValue: String(settings.collectorPort))
        _launchAtLogin = State(initialValue: LoginItem.isInstalled)
    }

    var body: some View {
        ZStack {
            DS.Palette.surface.ignoresSafeArea()

            VStack(alignment: .leading, spacing: 12) {
                headerRow

                PixelDivider()

                modeSection

                serverConfigurationCard

                githubAuthCard

                refreshAndLoginSection

                pathsCard

                if let statusMessage {
                    Text(statusMessage)
                        .font(DS.Typography.sans(11.5, weight: .medium))
                        .foregroundColor(statusIsError ? DS.Palette.amber : DS.Palette.teal)
                        .lineLimit(2)
                }

                Spacer(minLength: 0)

                footerDashboardRow
            }
            .padding(20)
        }
        .frame(
            width: PreferencesWindowController.windowSize.width,
            height: PreferencesWindowController.windowSize.height
        )
        .onChange(of: settings.collectorPort) { newValue in
            if portText != String(newValue) { portText = String(newValue) }
        }
        .onChange(of: settings.serverURL) { newValue in
            if serverURLText != newValue { serverURLText = newValue }
        }
        .onChange(of: settings.remoteUsername) { newValue in
            if usernameText != newValue { usernameText = newValue }
        }
    }

    // MARK: Header

    private var headerRow: some View {
        HStack(alignment: .firstTextBaseline) {
            Text("Preferences")
                .font(DS.Typography.sans(16, weight: .bold))
                .foregroundColor(DS.Palette.ink)
            Spacer()
            Text("Token Island \(DS.version)")
                .font(DS.Typography.mono(11.5, weight: .regular))
                .foregroundColor(DS.Palette.inkFaint)
        }
    }

    // MARK: 1. Local vs Remote Server Mode

    private var modeSection: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text("Data Source Mode")
                    .font(DS.Typography.sans(13, weight: .semibold))
                    .foregroundColor(DS.Palette.ink)
                Text(settings.serverMode.subtitle)
                    .font(DS.Typography.sans(11.5, weight: .regular))
                    .foregroundColor(DS.Palette.inkDim)
            }
            Spacer()
            modePicker
        }
    }

    private var modePicker: some View {
        HStack(spacing: 2) {
            ForEach(ServerMode.allCases, id: \.rawValue) { mode in
                let selected = settings.serverMode == mode
                Button(action: {
                    commitServerFields(quiet: true)
                    settings.serverMode = mode
                    statusMessage = nil
                }) {
                    Text(mode.label)
                        .font(DS.Typography.sans(12, weight: .semibold))
                        .foregroundColor(selected ? Color(hex: 0x04130d) : DS.Palette.inkDim)
                        .frame(width: 68, height: 25)
                        .background(
                            RoundedRectangle(cornerRadius: 5, style: .continuous)
                                .fill(selected ? DS.Palette.teal : .clear)
                        )
                }
                .buttonStyle(.plain)
            }
        }
        .padding(2)
        .background(
            RoundedRectangle(cornerRadius: 7, style: .continuous)
                .fill(DS.Palette.inset)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 7, style: .continuous)
                .strokeBorder(DS.Palette.border, lineWidth: 1)
        )
    }

    // MARK: 2. Server URL & Local Supervisor Card

    private var serverConfigurationCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            if settings.serverMode == .local {
                HStack(spacing: 10) {
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 6) {
                            Text("Local Collector")
                                .font(DS.Typography.sans(12.5, weight: .semibold))
                                .foregroundColor(DS.Palette.ink)
                            supervisorBadge
                        }
                        if case .failed(let detail) = supervisor.state {
                            Text(detail)
                                .font(DS.Typography.sans(11, weight: .regular))
                                .foregroundColor(DS.Palette.amber)
                                .lineLimit(1)
                        } else {
                            Text("Serving local API & web dashboard at 127.0.0.1:\(settings.collectorPort)")
                                .font(DS.Typography.sans(11, weight: .regular))
                                .foregroundColor(DS.Palette.inkDim)
                        }
                    }

                    Spacer()

                    portField

                    PixelButton(
                        title: "Restart",
                        accent: DS.Palette.ink,
                        fill: DS.Palette.surface,
                        border: DS.Palette.borderHi
                    ) {
                        commitPort()
                        model.restartLocalCollector()
                    }
                }
            } else {
                HStack(spacing: 10) {
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 6) {
                            Text("Remote Telemetry")
                                .font(DS.Typography.sans(12.5, weight: .semibold))
                                .foregroundColor(DS.Palette.ink)
                            remoteStatusBadge
                        }
                        Text(model.lastPollError ?? "Connected via Cloud / Remote Collector URL")
                            .font(DS.Typography.sans(11, weight: .regular))
                            .foregroundColor(model.offline ? DS.Palette.amber : DS.Palette.inkDim)
                            .lineLimit(1)
                    }

                    Spacer()

                    PixelButton(
                        title: "Reconnect",
                        accent: DS.Palette.ink,
                        fill: DS.Palette.surface,
                        border: DS.Palette.borderHi
                    ) {
                        commitServerFields(quiet: false)
                        model.refreshNow()
                    }
                }
            }

            PixelDivider(color: DS.Palette.border.opacity(0.8))

            VStack(alignment: .leading, spacing: 5) {
                HStack {
                    Text(settings.serverMode == .local ? "Cloud Server URL" : "Remote Server URL")
                        .font(DS.Typography.sans(12, weight: .semibold))
                        .foregroundColor(DS.Palette.ink)
                    Spacer()
                    Text(settings.serverMode == .local ? "Optional · for Cloud Sync & GitHub Login" : "Required in Remote Mode")
                        .font(DS.Typography.sans(11, weight: .regular))
                        .foregroundColor(DS.Palette.inkFaint)
                }

                HStack(spacing: 8) {
                    ZStack(alignment: .leading) {
                        PixelInset(
                            fill: DS.Palette.inset,
                            border: urlValid ? DS.Palette.borderHi : DS.Palette.red,
                            corner: 7
                        )
                        if serverURLText.isEmpty {
                            Text("https://token-island.example.com")
                                .font(DS.Typography.mono(12, weight: .regular))
                                .foregroundColor(DS.Palette.inkFaint.opacity(0.65))
                                .padding(.horizontal, 10)
                                .allowsHitTesting(false)
                        }
                        TextField("", text: $serverURLText)
                            .textFieldStyle(.plain)
                            .font(DS.Typography.mono(12, weight: .regular))
                            .foregroundColor(DS.Palette.ink)
                            .padding(.horizontal, 10)
                            .onSubmit { commitServerFields(quiet: false) }
                    }
                    .frame(height: 28)

                    ZStack(alignment: .leading) {
                        PixelInset(
                            fill: DS.Palette.inset,
                            border: DS.Palette.borderHi,
                            corner: 7
                        )
                        if usernameText.isEmpty {
                            Text("username")
                                .font(DS.Typography.mono(12, weight: .regular))
                                .foregroundColor(DS.Palette.inkFaint.opacity(0.65))
                                .padding(.horizontal, 8)
                                .allowsHitTesting(false)
                        }
                        TextField("", text: $usernameText)
                            .textFieldStyle(.plain)
                            .font(DS.Typography.mono(12, weight: .regular))
                            .foregroundColor(DS.Palette.ink)
                            .padding(.horizontal, 8)
                            .onSubmit { commitServerFields(quiet: false) }
                    }
                    .frame(width: 102, height: 28)
                    .help("Cloud username (auto-filled when signing in with GitHub)")

                    PixelButton(
                        title: "Save",
                        accent: DS.Palette.teal,
                        fill: DS.Palette.teal.opacity(0.14),
                        border: DS.Palette.teal
                    ) {
                        commitServerFields(quiet: false)
                    }
                }
            }
        }
        .padding(12)
        .background(
            RoundedRectangle(cornerRadius: DS.Space.cardCorner, style: .continuous)
                .fill(DS.Palette.surfaceAlt)
        )
        .overlay(
            RoundedRectangle(cornerRadius: DS.Space.cardCorner, style: .continuous)
                .strokeBorder(DS.Palette.border, lineWidth: 1)
        )
    }

    // MARK: 3. GitHub Login & Multi-Device Cloud Account Card

    private var githubAuthCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            switch githubAuth.state {
            case .signedOut:
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("GitHub Cloud Account")
                            .font(DS.Typography.sans(12.5, weight: .semibold))
                            .foregroundColor(DS.Palette.ink)
                        Text("Bind this Mac via GitHub OAuth · multi-device additive sync")
                            .font(DS.Typography.sans(11, weight: .regular))
                            .foregroundColor(DS.Palette.inkDim)
                    }
                    Spacer()
                    PixelButton(
                        title: "Sign in with GitHub",
                        accent: DS.Palette.ink,
                        fill: DS.Palette.surface,
                        border: DS.Palette.borderHi
                    ) {
                        commitServerFields(quiet: true)
                        githubAuth.startGitHubLogin(rawServerURL: serverURLText) { baseURL, username, _ in
                            serverURLText = baseURL
                            usernameText = username
                            model.applyGitHubLoginSuccess(baseURL: baseURL, username: username)
                        }
                    }
                }

            case .starting:
                HStack {
                    Text("Requesting GitHub verification code…")
                        .font(DS.Typography.sans(12, weight: .medium))
                        .foregroundColor(DS.Palette.inkDim)
                    Spacer()
                    PixelButton(
                        title: "Cancel",
                        accent: DS.Palette.inkDim,
                        fill: DS.Palette.surface,
                        border: DS.Palette.border
                    ) {
                        githubAuth.cancelFlow()
                    }
                }

            case .awaitingBrowser(let userCode, let verificationURL):
                HStack(spacing: 10) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text("Enter code on GitHub (copied to clipboard):")
                            .font(DS.Typography.sans(11, weight: .medium))
                            .foregroundColor(DS.Palette.inkDim)
                        Text(userCode)
                            .font(DS.Typography.mono(16, weight: .bold))
                            .foregroundColor(DS.Palette.amber)
                    }
                    Spacer()
                    PixelButton(
                        title: "Open GitHub ↗",
                        accent: DS.Palette.teal,
                        fill: DS.Palette.teal.opacity(0.14),
                        border: DS.Palette.teal
                    ) {
                        githubAuth.copyAndReopenBrowser(userCode: userCode, verificationURL: verificationURL)
                    }
                    PixelButton(
                        title: "Cancel",
                        accent: DS.Palette.inkDim,
                        fill: DS.Palette.surface,
                        border: DS.Palette.border
                    ) {
                        githubAuth.cancelFlow()
                    }
                }

            case .signedIn(let username, _, let visibility, let githubConnected):
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        HStack(spacing: 6) {
                            Circle()
                                .fill(DS.Palette.teal)
                                .frame(width: 7, height: 7)
                            Text("@\(username)")
                                .font(DS.Typography.mono(12.5, weight: .semibold))
                                .foregroundColor(DS.Palette.ink)
                            Text(githubConnected ? "GitHub" : "API Key")
                                .font(DS.Typography.sans(10.5, weight: .semibold))
                                .foregroundColor(DS.Palette.teal)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 1.5)
                                .background(
                                    RoundedRectangle(cornerRadius: 4, style: .continuous)
                                        .fill(DS.Palette.teal.opacity(0.14))
                                )
                        }

                        Spacer()

                        visibilityPicker(current: visibility)

                        PixelButton(
                            title: "Sign Out",
                            accent: DS.Palette.inkDim,
                            fill: DS.Palette.surface,
                            border: DS.Palette.border
                        ) {
                            githubAuth.signOut(configPath: settings.configPath) {
                                model.applySignOut()
                            }
                        }
                    }
                }

            case .failed(let message):
                HStack(spacing: 10) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("GitHub Sign-In Issue")
                            .font(DS.Typography.sans(12, weight: .semibold))
                            .foregroundColor(DS.Palette.amber)
                        Text(message)
                            .font(DS.Typography.sans(11, weight: .regular))
                            .foregroundColor(DS.Palette.inkDim)
                            .lineLimit(2)
                    }
                    Spacer()
                    PixelButton(
                        title: "Retry",
                        accent: DS.Palette.ink,
                        fill: DS.Palette.surface,
                        border: DS.Palette.borderHi
                    ) {
                        commitServerFields(quiet: true)
                        githubAuth.startGitHubLogin(rawServerURL: serverURLText) { baseURL, username, _ in
                            serverURLText = baseURL
                            usernameText = username
                            model.applyGitHubLoginSuccess(baseURL: baseURL, username: username)
                        }
                    }
                }
            }
        }
        .padding(12)
        .background(
            RoundedRectangle(cornerRadius: DS.Space.cardCorner, style: .continuous)
                .fill(DS.Palette.surfaceAlt)
        )
        .overlay(
            RoundedRectangle(cornerRadius: DS.Space.cardCorner, style: .continuous)
                .strokeBorder(DS.Palette.border, lineWidth: 1)
        )
    }

    private func visibilityPicker(current: String) -> some View {
        HStack(spacing: 2) {
            ForEach(Self.visibilityOptions, id: \.key) { option in
                let selected = current == option.key
                Button(action: {
                    githubAuth.updateVisibility(
                        option.key,
                        rawServerURL: serverURLText,
                        configPath: settings.configPath
                    ) { updated in
                        statusIsError = false
                        statusMessage = "Profile visibility set to \(updated)"
                    }
                }) {
                    Text(option.label)
                        .font(DS.Typography.sans(10.5, weight: .semibold))
                        .foregroundColor(selected ? DS.Palette.ink : DS.Palette.inkFaint)
                        .padding(.horizontal, 7)
                        .padding(.vertical, 3)
                        .background(
                            RoundedRectangle(cornerRadius: 4, style: .continuous)
                                .fill(selected ? DS.Palette.surface : .clear)
                        )
                }
                .buttonStyle(.plain)
            }
        }
        .padding(2)
        .background(
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .fill(DS.Palette.inset)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .strokeBorder(DS.Palette.border, lineWidth: 1)
        )
        .help("Profile visibility: Public, Unlisted (badges only), or Private")
    }

    private var supervisorBadge: some View {
        let healthy = supervisor.state.isHealthy
        let color: Color = healthy ? DS.Palette.teal : DS.Palette.amber
        return HStack(spacing: 4) {
            Circle()
                .fill(color)
                .frame(width: 6, height: 6)
            Text(supervisor.state.badgeText)
                .font(DS.Typography.mono(10.5, weight: .semibold))
                .foregroundColor(color)
        }
        .padding(.horizontal, 7)
        .padding(.vertical, 2)
        .background(
            RoundedRectangle(cornerRadius: 4, style: .continuous)
                .fill(color.opacity(0.14))
        )
    }

    private var remoteStatusBadge: some View {
        let connected = !model.offline && model.lastSuccessfulPoll != nil
        let color: Color = connected ? DS.Palette.teal : DS.Palette.amber
        return HStack(spacing: 4) {
            Circle()
                .fill(color)
                .frame(width: 6, height: 6)
            Text(connected ? "Connected" : "Disconnected")
                .font(DS.Typography.mono(10.5, weight: .semibold))
                .foregroundColor(color)
        }
        .padding(.horizontal, 7)
        .padding(.vertical, 2)
        .background(
            RoundedRectangle(cornerRadius: 4, style: .continuous)
                .fill(color.opacity(0.14))
        )
    }

    private var portField: some View {
        ZStack {
            PixelInset(
                fill: DS.Palette.inset,
                border: portValid ? DS.Palette.borderHi : DS.Palette.red,
                corner: 7
            )
            TextField("", text: $portText)
                .textFieldStyle(.plain)
                .font(DS.Typography.mono(12.5, weight: .medium))
                .foregroundColor(DS.Palette.ink)
                .multilineTextAlignment(.trailing)
                .padding(.horizontal, 8)
                .onSubmit(commitPort)
                .onChange(of: portText) { _ in commitPort() }
        }
        .frame(width: 74, height: 26)
        .help("Local collector HTTP port")
        .accessibilityLabel(Text("Collector port"))
    }

    private func commitPort() {
        let digits = portText.filter(\.isNumber)
        guard !digits.isEmpty, let value = Int(digits), value >= 1, value <= 65_535 else {
            portValid = false
            return
        }
        portValid = true
        if settings.collectorPort != value {
            settings.collectorPort = value
        }
    }

    private func commitServerFields(quiet: Bool) {
        let trimmedURL = serverURLText.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedUser = usernameText.trimmingCharacters(in: .whitespacesAndNewlines)

        if !trimmedURL.isEmpty,
           ServerEndpointResolver.resolve(rawURL: trimmedURL, explicitUsername: trimmedUser) == nil {
            urlValid = false
            statusIsError = true
            statusMessage = "Invalid Server URL (expected http:// or https:// host)"
            return
        }

        urlValid = true
        if let resolved = ServerEndpointResolver.resolve(rawURL: trimmedURL, explicitUsername: trimmedUser) {
            settings.serverURL = resolved.baseString
            serverURLText = resolved.baseString
            if let extracted = resolved.username, !extracted.isEmpty {
                settings.remoteUsername = extracted
                usernameText = extracted
            } else {
                settings.remoteUsername = trimmedUser
            }
        } else {
            settings.serverURL = ""
            settings.remoteUsername = trimmedUser
        }
        settings.persistToConfigFile()

        if !quiet {
            statusIsError = false
            statusMessage = "Saved server settings"
        }
    }

    // MARK: 4. Refresh Interval & Launch at Login

    private var refreshAndLoginSection: some View {
        VStack(spacing: 10) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Refresh Interval")
                        .font(DS.Typography.sans(13, weight: .semibold))
                        .foregroundColor(DS.Palette.ink)
                    Text("Polling cadence for the Dynamic Island")
                        .font(DS.Typography.sans(11.5, weight: .regular))
                        .foregroundColor(DS.Palette.inkDim)
                }
                Spacer()
                refreshPicker
            }

            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Launch at Login")
                        .font(DS.Typography.sans(13, weight: .semibold))
                        .foregroundColor(DS.Palette.ink)
                    Text("Start Token Island automatically on macOS login")
                        .font(DS.Typography.sans(11.5, weight: .regular))
                        .foregroundColor(DS.Palette.inkDim)
                }
                Spacer()
                launchToggle
            }
        }
    }

    private var refreshPicker: some View {
        HStack(spacing: 2) {
            ForEach(Array(AppSettings.refreshChoices.enumerated()), id: \.offset) { _, interval in
                let selected = settings.refreshInterval == interval
                Button(action: {
                    settings.refreshInterval = interval
                }) {
                    Text("\(Int(interval))s")
                        .font(DS.Typography.mono(12, weight: .semibold))
                        .foregroundColor(selected ? Color(hex: 0x04130d) : DS.Palette.inkDim)
                        .frame(width: 38, height: 24)
                        .background(
                            RoundedRectangle(cornerRadius: 5, style: .continuous)
                                .fill(selected ? DS.Palette.teal : .clear)
                        )
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("Refresh every \(Int(interval)) seconds"))
            }
        }
        .padding(2)
        .background(
            RoundedRectangle(cornerRadius: 7, style: .continuous)
                .fill(DS.Palette.inset)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 7, style: .continuous)
                .strokeBorder(DS.Palette.border, lineWidth: 1)
        )
    }

    private var launchToggle: some View {
        Button(action: toggleLaunchAtLogin) {
            HStack(spacing: 6) {
                Circle()
                    .fill(launchAtLogin ? DS.Palette.teal : DS.Palette.inkFaint)
                    .frame(width: 7, height: 7)
                Text(launchAtLogin ? "Enabled" : "Disabled")
                    .font(DS.Typography.sans(12, weight: .semibold))
                    .foregroundColor(launchAtLogin ? DS.Palette.teal : DS.Palette.inkDim)
            }
            .padding(.horizontal, 10)
            .frame(height: 26)
            .background(
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .fill(launchAtLogin ? DS.Palette.teal.opacity(0.14) : DS.Palette.surfaceAlt)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .strokeBorder(launchAtLogin ? DS.Palette.teal : DS.Palette.border, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(launchAtLogin ? "Launch at login enabled" : "Launch at login disabled"))
    }

    private func toggleLaunchAtLogin() {
        let target = !launchAtLogin
        let failure = LoginItem.setEnabled(target)
        if let failure {
            statusIsError = true
            statusMessage = failure
            launchAtLogin = LoginItem.isInstalled
        } else {
            launchAtLogin = target
            statusMessage = nil
        }
    }

    // MARK: 5. Paths & Dashboard Footer

    private var pathsCard: some View {
        VStack(alignment: .leading, spacing: 4) {
            pathRow(label: "Config", value: settings.configPath)
            pathRow(label: "Database", value: settings.dataPath)
            pathRow(label: "Log", value: settings.collectorLogPath)
        }
        .padding(10)
        .background(
            RoundedRectangle(cornerRadius: DS.Space.cardCorner, style: .continuous)
                .fill(DS.Palette.surfaceAlt)
        )
        .overlay(
            RoundedRectangle(cornerRadius: DS.Space.cardCorner, style: .continuous)
                .strokeBorder(DS.Palette.border, lineWidth: 1)
        )
    }

    private var footerDashboardRow: some View {
        let primaryURL = model.dashboardURL()
        let hasCloudProfile = settings.serverMode == .local && model.cloudDashboardURL() != nil

        return HStack(spacing: 8) {
            Text(primaryURL?.absoluteString ?? "Configure Remote Server URL above")
                .font(DS.Typography.mono(11, weight: .regular))
                .foregroundColor(DS.Palette.inkFaint)
                .lineLimit(1)
                .truncationMode(.middle)

            Spacer()

            if hasCloudProfile {
                PixelButton(
                    title: "Cloud Profile ↗",
                    accent: DS.Palette.inkDim,
                    fill: DS.Palette.surfaceAlt,
                    border: DS.Palette.border
                ) {
                    commitServerFields(quiet: true)
                    model.openCloudDashboard()
                }
            }

            PixelButton(
                title: settings.serverMode == .local ? "Open Local Dashboard ↗" : "Open Dashboard ↗",
                accent: primaryURL != nil ? DS.Palette.ink : DS.Palette.inkDim,
                fill: DS.Palette.surfaceAlt,
                border: primaryURL != nil ? DS.Palette.borderHi : DS.Palette.border
            ) {
                commitServerFields(quiet: true)
                model.openDashboard()
            }
        }
    }

    private func pathRow(label: String, value: String) -> some View {
        HStack {
            Text(label)
                .font(DS.Typography.sans(11.5, weight: .medium))
                .foregroundColor(DS.Palette.inkFaint)
                .frame(width: 64, alignment: .leading)
            Text(value)
                .font(DS.Typography.mono(11, weight: .regular))
                .foregroundColor(DS.Palette.inkDim)
                .lineLimit(1)
                .truncationMode(.middle)
            Spacer(minLength: 0)
        }
    }
}
