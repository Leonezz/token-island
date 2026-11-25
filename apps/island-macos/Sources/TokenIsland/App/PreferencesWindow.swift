import AppKit
import SwiftUI

// MARK: - Native Preferences Window
//
// Precision Telemetry configuration window:
//  - Local vs Remote Server mode switcher
//  - Local collector auto-launch & keep-alive status + Port + Restart
//  - Server URL + Username configuration (synced to ~/.token-island/config.json)
//  - Refresh interval (1s / 2s / 5s), Launch at Login, local paths, Open Dashboard

@MainActor
final class PreferencesWindowController {
    private var window: NSWindow?

    static let windowSize = NSSize(width: 500, height: 520)

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
            rootView: PreferencesView(settings: settings, model: model, supervisor: model.supervisor)
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

    @State private var serverURLText: String
    @State private var usernameText: String
    @State private var portText: String
    @State private var portValid: Bool = true
    @State private var urlValid: Bool = true
    @State private var launchAtLogin: Bool
    @State private var statusMessage: String?
    @State private var statusIsError: Bool = false

    init(settings: AppSettings, model: IslandModel, supervisor: CollectorSupervisor) {
        self.settings = settings
        self.model = model
        self.supervisor = supervisor
        _serverURLText = State(initialValue: settings.serverURL)
        _usernameText = State(initialValue: settings.remoteUsername)
        _portText = State(initialValue: String(settings.collectorPort))
        _launchAtLogin = State(initialValue: LoginItem.isInstalled)
    }

    var body: some View {
        ZStack {
            DS.Palette.surface.ignoresSafeArea()

            VStack(alignment: .leading, spacing: 13) {
                headerRow

                PixelDivider()

                modeSection

                serverConfigurationCard

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
                // Local Server Supervision Row
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
                            Text("Auto-started & kept alive on 127.0.0.1:\(settings.collectorPort)")
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

                PixelDivider(color: DS.Palette.border.opacity(0.8))
            } else {
                // Remote Server Status Row
                HStack(spacing: 10) {
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 6) {
                            Text("Remote Telemetry")
                                .font(DS.Typography.sans(12.5, weight: .semibold))
                                .foregroundColor(DS.Palette.ink)
                            remoteStatusBadge
                        }
                        Text(model.lastPollError ?? "Supports Cloud URL (/u/<user>) or Remote Collector (:47118)")
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

                PixelDivider(color: DS.Palette.border.opacity(0.8))
            }

            // Server URL Field (used as Cloud Sync / Dashboard URL in Local mode, or Data Source URL in Remote mode)
            VStack(alignment: .leading, spacing: 5) {
                HStack {
                    Text(settings.serverMode == .local ? "Cloud Server URL" : "Remote Server URL")
                        .font(DS.Typography.sans(12, weight: .semibold))
                        .foregroundColor(DS.Palette.ink)
                    Spacer()
                    Text(settings.serverMode == .local ? "Optional · for Sync & Dashboard" : "Required in Remote Mode")
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
                    .frame(width: 108, height: 28)
                    .help("Cloud username (optional when connecting to a remote collector)")

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
            statusMessage = "Saved server settings to ~/.token-island/config.json"
        }
    }

    // MARK: 3. Refresh Interval & Launch at Login

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

    // MARK: 4. Paths & Dashboard Footer

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
        let configured = model.dashboardURL() != nil
        return HStack {
            Text(model.dashboardURL()?.absoluteString ?? "Enter Server URL above to enable Dashboard")
                .font(DS.Typography.mono(11, weight: .regular))
                .foregroundColor(DS.Palette.inkFaint)
                .lineLimit(1)
                .truncationMode(.middle)

            Spacer()

            PixelButton(
                title: "Open Dashboard ↗",
                accent: configured ? DS.Palette.ink : DS.Palette.inkDim,
                fill: DS.Palette.surfaceAlt,
                border: configured ? DS.Palette.borderHi : DS.Palette.border
            ) {
                commitServerFields(quiet: true)
                if model.dashboardURL() != nil {
                    model.openDashboard()
                    statusMessage = nil
                } else {
                    statusIsError = true
                    statusMessage = "Enter a Server URL above and click Save first."
                }
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
