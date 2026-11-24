import AppKit
import SwiftUI

// MARK: - Native Preferences window (contract §1.4)
//
// A real NSWindow hosting a pixel-styled SwiftUI form: collector port, refresh
// interval (1s / 2s / 5s), launch-at-login toggle, Open dashboard, version and
// data paths. Settings persist in UserDefaults; every mutation is guarded so a
// missing app bundle / unwritable LaunchAgent can never crash the app.

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
        window.title = "Preferences"
        window.isReleasedWhenClosed = false
        window.titlebarAppearsTransparent = true
        window.backgroundColor = NSColor(DS.Palette.bg)
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

// MARK: - Preferences content

struct PreferencesView: View {
    @ObservedObject var settings: AppSettings
    @ObservedObject var model: IslandModel

    private let width: CGFloat = 460
    private let height: CGFloat = 380
    private let padding: CGFloat = 16
    private let rightEdge: CGFloat = 444

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
        ZStack(alignment: .topLeading) {
            PixelPanel()

            PixelText(text: "PREFERENCES", size: DS.FontSize.small, color: DS.Palette.ink, tracking: DS.Tracking.label)
                .offset(x: padding, y: 14)

            PixelText(
                text: "TOKEN ISLAND \(DS.version)",
                size: DS.FontSize.micro,
                color: DS.Palette.inkFaint,
                tracking: DS.Tracking.label,
                width: 200,
                alignment: .trailing
            )
            .offset(x: rightEdge - 200, y: 22)

            PixelDivider(color: DS.Palette.border)
                .frame(width: rightEdge - padding, height: 2)
                .offset(x: padding, y: 40)

            // Collector port.
            rowLabel("COLLECTOR PORT", y: 64)
            portField
                .offset(x: rightEdge - 100, y: 54)

            // Refresh interval.
            rowLabel("REFRESH INTERVAL", y: 104)
            refreshPicker
                .offset(x: rightEdge - 132, y: 94)

            // Launch at login.
            rowLabel("LAUNCH AT LOGIN", y: 144)
            launchToggle
                .offset(x: rightEdge - 64, y: 134)

            PixelDivider(color: DS.Palette.border)
                .frame(width: rightEdge - padding, height: 2)
                .offset(x: padding, y: 180)

            // Dashboard.
            dashboardButton
                .offset(x: padding, y: 196)
            PixelText(
                text: dashboardLabel,
                size: DS.FontSize.micro,
                color: DS.Palette.inkFaint,
                width: 240,
                alignment: .leading,
                uppercased: false
            )
            .offset(x: padding + 152, y: 203)

            PixelDivider(color: DS.Palette.border)
                .frame(width: rightEdge - padding, height: 2)
                .offset(x: padding, y: 236)

            // Data paths.
            pathLine(label: "CONFIG", value: settings.configPath, y: 248)
            pathLine(label: "DATA", value: settings.dataPath, y: 264)
            pathLine(label: "AGENT", value: settings.launchAgentPath, y: 280)

            if let errorMessage {
                PixelText(
                    text: errorMessage,
                    size: DS.FontSize.micro,
                    color: DS.Palette.amber,
                    width: rightEdge - padding,
                    alignment: .leading
                )
                .offset(x: padding, y: 304)
            }

            PixelText(text: settings.versionLine, size: DS.FontSize.micro, color: DS.Palette.inkFaint, tracking: DS.Tracking.label)
                .offset(x: padding, y: 344)

            PixelText(
                text: "SETTINGS ARE SAVED AUTOMATICALLY",
                size: DS.FontSize.micro,
                color: DS.Palette.inkFaint,
                tracking: 0,
                width: 260,
                alignment: .trailing
            )
            .offset(x: rightEdge - 260, y: 344)
        }
        .frame(width: width, height: height)
        .onChange(of: settings.collectorPort) { newValue in
            if portText != String(newValue) { portText = String(newValue) }
        }
    }

    // MARK: Rows

    private func rowLabel(_ text: String, y: CGFloat) -> some View {
        PixelText(text: text, size: DS.FontSize.micro, color: DS.Palette.inkDim, tracking: DS.Tracking.label)
            .offset(x: padding, y: y)
    }

    private var portField: some View {
        ZStack(alignment: .leading) {
            PixelInset(fill: DS.Palette.inset, border: portValid ? DS.Palette.border : DS.Palette.red)
            TextField("", text: $portText)
                .textFieldStyle(.plain)
                .font(PixelFont.font(size: DS.FontSize.small))
                .foregroundColor(DS.Palette.ink)
                .padding(.horizontal, 8)
                .frame(height: 24)
                .onSubmit(commitPort)
                .onChange(of: portText) { _ in commitPort() }
        }
        .frame(width: 100, height: 24)
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
        HStack(spacing: 4) {
            ForEach(Array(AppSettings.refreshChoices.enumerated()), id: \.offset) { _, interval in
                pixelSegment(
                    title: "\(Int(interval))S",
                    selected: settings.refreshInterval == interval
                ) {
                    settings.refreshInterval = interval
                    errorMessage = nil
                }
            }
        }
        .frame(width: 132, height: 24)
    }

    private func pixelSegment(title: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            ZStack {
                PixelPanel(
                    fill: selected ? DS.Palette.surfaceAlt : DS.Palette.surface,
                    border: selected ? DS.Palette.teal : DS.Palette.border,
                    highlight: selected ? DS.Palette.teal : DS.Palette.borderHi,
                    showsShadow: false
                )
                PixelText(text: title, size: DS.FontSize.micro, color: selected ? DS.Palette.teal : DS.Palette.inkDim)
                    .offset(y: 8)
            }
            .frame(width: 40, height: 24)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text("Refresh every \(title)"))
    }

    private var launchToggle: some View {
        Button(action: toggleLaunchAtLogin) {
            ZStack {
                PixelPanel(
                    fill: DS.Palette.surfaceAlt,
                    border: launchAtLogin ? DS.Palette.teal : DS.Palette.border,
                    highlight: launchAtLogin ? DS.Palette.teal : DS.Palette.borderHi,
                    showsShadow: false
                )
                PixelText(
                    text: launchAtLogin ? "ON" : "OFF",
                    size: DS.FontSize.micro,
                    color: launchAtLogin ? DS.Palette.teal : DS.Palette.inkDim,
                    tracking: DS.Tracking.label
                )
                .offset(y: 8)
            }
            .frame(width: 64, height: 24)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(launchAtLogin ? "Launch at login on" : "Launch at login off"))
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
        return "not configured"
    }

    private var dashboardButton: some View {
        let configured = model.dashboardURL() != nil
        return Button(action: {
            if configured {
                model.openDashboard()
                errorMessage = nil
            } else {
                errorMessage = "No dashboard configured - set cloud.url or register with a cloud"
            }
        }) {
            ZStack {
                PixelPanel(
                    fill: configured ? DS.Palette.surfaceAlt : DS.Palette.surface,
                    border: configured ? DS.Palette.borderHi : DS.Palette.border,
                    highlight: DS.Palette.borderHi,
                    showsShadow: true
                )
                PixelText(
                    text: "OPEN DASHBOARD",
                    size: DS.FontSize.micro,
                    color: configured ? DS.Palette.ink : DS.Palette.inkFaint,
                    tracking: DS.Tracking.label
                )
                .offset(y: 8)
            }
            .frame(width: 148, height: 24)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text("Open dashboard"))
    }

    private func pathLine(label: String, value: String, y: CGFloat) -> some View {
        let labelWidth = PixelText.metrics(label, size: DS.FontSize.micro, tracking: DS.Tracking.label)
        return ZStack(alignment: .topLeading) {
            PixelText(text: label, size: DS.FontSize.micro, color: DS.Palette.inkFaint, tracking: DS.Tracking.label)
            PixelText(
                text: PixelText.truncate(value, toWidth: rightEdge - padding - labelWidth - 10, size: DS.FontSize.micro, uppercased: false),
                size: DS.FontSize.micro,
                color: DS.Palette.inkDim,
                uppercased: false
            )
            .offset(x: labelWidth + 10)
        }
        .offset(x: padding, y: y)
    }
}
