import AppKit
import SwiftUI

// MARK: - Native Preferences Window
//
// Hosts a clean Precision Telemetry form: collector port, refresh interval
// (1s / 2s / 5s), launch-at-login toggle, Open Dashboard button, and local
// config/database paths.

@MainActor
final class PreferencesWindowController {
    private var window: NSWindow?

    static let windowSize = NSSize(width: 460, height: 380)

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
            rootView: PreferencesView(settings: settings, model: model)
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

    @State private var portText: String
    @State private var portValid: Bool = true
    @State private var launchAtLogin: Bool
    @State private var errorMessage: String?

    init(settings: AppSettings, model: IslandModel) {
        self.settings = settings
        self.model = model
        _portText = State(initialValue: String(settings.collectorPort))
        _launchAtLogin = State(initialValue: LoginItem.isInstalled)
    }

    var body: some View {
        ZStack {
            DS.Palette.surface.ignoresSafeArea()

            VStack(alignment: .leading, spacing: 14) {
                HStack(alignment: .firstTextBaseline) {
                    Text("Preferences")
                        .font(DS.Typography.sans(16, weight: .bold))
                        .foregroundColor(DS.Palette.ink)
                    Spacer()
                    Text("Token Island \(DS.version)")
                        .font(DS.Typography.mono(11.5, weight: .regular))
                        .foregroundColor(DS.Palette.inkFaint)
                }

                PixelDivider()

                // Collector Port
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Collector Port")
                            .font(DS.Typography.sans(13, weight: .semibold))
                            .foregroundColor(DS.Palette.ink)
                        Text("Local loopback HTTP endpoint (127.0.0.1)")
                            .font(DS.Typography.sans(11.5, weight: .regular))
                            .foregroundColor(DS.Palette.inkDim)
                    }
                    Spacer()
                    portField
                }

                // Refresh Interval
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

                // Launch at Login
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Launch at Login")
                            .font(DS.Typography.sans(13, weight: .semibold))
                            .foregroundColor(DS.Palette.ink)
                        Text("Manage user LaunchAgent automatically")
                            .font(DS.Typography.sans(11.5, weight: .regular))
                            .foregroundColor(DS.Palette.inkDim)
                    }
                    Spacer()
                    launchToggle
                }

                // Local Paths Box
                VStack(alignment: .leading, spacing: 5) {
                    pathRow(label: "Config", value: settings.configPath)
                    pathRow(label: "Database", value: settings.dataPath)
                    pathRow(label: "Agent", value: settings.launchAgentPath)
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

                if let errorMessage {
                    Text(errorMessage)
                        .font(DS.Typography.sans(11.5, weight: .medium))
                        .foregroundColor(DS.Palette.amber)
                        .lineLimit(2)
                }

                Spacer(minLength: 0)

                HStack {
                    Text(dashboardLabel)
                        .font(DS.Typography.mono(11, weight: .regular))
                        .foregroundColor(DS.Palette.inkFaint)
                        .lineLimit(1)
                        .truncationMode(.middle)
                    Spacer()
                    dashboardButton
                }
            }
            .padding(20)
        }
        .frame(width: 460, height: 380)
        .onChange(of: settings.collectorPort) { newValue in
            if portText != String(newValue) { portText = String(newValue) }
        }
    }

    private var portField: some View {
        ZStack {
            PixelInset(
                fill: DS.Palette.inset,
                border: portValid ? DS.Palette.borderHi : DS.Palette.red,
                corner: DS.Space.cardCorner
            )
            TextField("", text: $portText)
                .textFieldStyle(.plain)
                .font(DS.Typography.mono(13, weight: .medium))
                .foregroundColor(DS.Palette.ink)
                .multilineTextAlignment(.trailing)
                .padding(.horizontal, 10)
                .onSubmit(commitPort)
                .onChange(of: portText) { _ in commitPort() }
        }
        .frame(width: 96, height: 28)
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

    private var refreshPicker: some View {
        HStack(spacing: 2) {
            ForEach(Array(AppSettings.refreshChoices.enumerated()), id: \.offset) { _, interval in
                let selected = settings.refreshInterval == interval
                Button(action: {
                    settings.refreshInterval = interval
                    errorMessage = nil
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
            errorMessage = failure
            launchAtLogin = LoginItem.isInstalled
        } else {
            launchAtLogin = target
            errorMessage = nil
        }
    }

    private var dashboardLabel: String {
        if let url = model.dashboardURL() { return url.absoluteString }
        return "Cloud dashboard not configured"
    }

    private var dashboardButton: some View {
        let configured = model.dashboardURL() != nil
        return PixelButton(
            title: "Open Dashboard ↗",
            accent: configured ? DS.Palette.ink : DS.Palette.inkDim,
            fill: DS.Palette.surfaceAlt,
            border: configured ? DS.Palette.borderHi : DS.Palette.border
        ) {
            if configured {
                model.openDashboard()
                errorMessage = nil
            } else {
                errorMessage = "Set cloud.url in config.json or run `tokenisland register` first."
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
