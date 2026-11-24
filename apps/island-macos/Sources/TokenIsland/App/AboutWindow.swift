import AppKit
import SwiftUI

// MARK: - Native About Window

@MainActor
final class AboutWindowController {
    private var window: NSWindow?

    private static let windowSize = NSSize(width: 400, height: 320)

    func show() {
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
        window.title = "About Token Island"
        window.isReleasedWhenClosed = false
        window.titlebarAppearsTransparent = true
        window.backgroundColor = NSColor(DS.Palette.surface)
        window.isMovableByWindowBackground = true
        window.contentView = NSHostingView(rootView: AboutView())
        window.center()
        window.setFrameOrigin(window.frame.origin)
        self.window = window
        NSApp.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
    }
}

struct AboutView: View {
    var body: some View {
        ZStack {
            DS.Palette.surface.ignoresSafeArea()

            VStack(spacing: 10) {
                if let icon = AboutView.appIcon {
                    Image(nsImage: icon)
                        .resizable()
                        .interpolation(.high)
                        .frame(width: 80, height: 80)
                        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                }

                Text("Token Island")
                    .font(DS.Typography.sans(18, weight: .bold))
                    .foregroundColor(DS.Palette.ink)

                Text("Version \(DS.version)")
                    .font(DS.Typography.mono(12, weight: .medium))
                    .foregroundColor(DS.Palette.inkDim)

                PixelDivider()
                    .padding(.vertical, 4)

                Text("Local-first token telemetry for AI coding agents")
                    .font(DS.Typography.sans(12.5, weight: .regular))
                    .foregroundColor(DS.Palette.inkDim)
                    .multilineTextAlignment(.center)

                Button(action: { openURL("https://github.com/Leonezz/token-island") }) {
                    Text("github.com/Leonezz/token-island ↗")
                        .font(DS.Typography.mono(12, weight: .semibold))
                        .foregroundColor(DS.Palette.teal)
                }
                .buttonStyle(.plain)

                Spacer(minLength: 4)

                Text("MIT License · macOS 13+ Menu Bar App")
                    .font(DS.Typography.sans(11.5, weight: .regular))
                    .foregroundColor(DS.Palette.inkFaint)
            }
            .padding(24)
        }
        .frame(width: 400, height: 320)
    }

    static var appIcon: NSImage? {
        if let url = Bundle.main.url(forResource: "AppIcon", withExtension: "icns"),
           let image = NSImage(contentsOf: url) {
            return image
        }
        if let path = Bundle.main.path(forResource: "AppIcon", ofType: "icns"),
           let image = NSImage(contentsOfFile: path) {
            return image
        }
        let executable = Bundle.main.executableURL ?? URL(fileURLWithPath: CommandLine.arguments.first ?? "TokenIsland")
        var directory = executable.deletingLastPathComponent()
        for _ in 0..<8 {
            let candidate = directory.appendingPathComponent("assets/appicon/icon-1024.png")
            if let image = NSImage(contentsOf: candidate) { return image }
            directory = directory.deletingLastPathComponent()
        }
        return NSApp.applicationIconImage
    }

    private func openURL(_ string: String) {
        guard let url = URL(string: string) else { return }
        NSWorkspace.shared.open(url)
    }
}
