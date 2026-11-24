import AppKit
import SwiftUI

// MARK: - Custom About window (contract §1.4)
//
// Native NSWindow hosting a pixel-styled SwiftUI panel: app icon, wordmark,
// version, GitHub link and the MIT line. It is opened from the main menu
// (About Token Island) and the menu-bar menu.

@MainActor
final class AboutWindowController {
    private var window: NSWindow?

    private static let windowSize = NSSize(width: 400, height: 330)

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
        window.backgroundColor = NSColor(DS.Palette.bg)
        window.isMovableByWindowBackground = true
        window.contentView = NSHostingView(rootView: AboutView())
        window.center()
        window.setFrameOrigin(window.frame.origin)
        self.window = window
        NSApp.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
    }
}

// MARK: - About content

struct AboutView: View {
    private let contentWidth: CGFloat = 400
    private let padding: CGFloat = 16

    var body: some View {
        ZStack(alignment: .topLeading) {
            PixelPanel()

            if let icon = AboutView.appIcon {
                Image(nsImage: icon)
                    .resizable()
                    .interpolation(.none)
                    .frame(width: 96, height: 96)
                    .offset(x: (contentWidth - 96) / 2, y: 20)
            }

            PixelText(
                text: "TOKEN ISLAND",
                size: DS.FontSize.small,
                color: DS.Palette.ink,
                tracking: DS.Tracking.label,
                width: contentWidth - padding * 2,
                alignment: .center
            )
            .offset(x: padding, y: 132)

            PixelText(
                text: "VERSION \(DS.version)",
                size: DS.FontSize.micro,
                color: DS.Palette.inkDim,
                tracking: DS.Tracking.label,
                width: contentWidth - padding * 2,
                alignment: .center
            )
            .offset(x: padding, y: 160)

            PixelDivider(color: DS.Palette.border)
                .frame(width: contentWidth - padding * 2, height: 2)
                .offset(x: padding, y: 184)

            PixelText(
                text: "LOCAL-FIRST TOKEN USAGE FOR AI CODING AGENTS",
                size: DS.FontSize.micro,
                color: DS.Palette.inkDim,
                tracking: 0,
                width: contentWidth - padding * 2,
                alignment: .center
            )
            .offset(x: padding, y: 198)

            Button(action: { openURL("https://github.com/token-island/token-island") }) {
                PixelText(
                    text: "GITHUB.COM/TOKEN-ISLAND",
                    size: DS.FontSize.micro,
                    color: DS.Palette.teal,
                    tracking: DS.Tracking.label,
                    width: contentWidth - padding * 2,
                    alignment: .center
                )
            }
            .buttonStyle(.plain)
            .offset(x: padding, y: 220)

            PixelText(
                text: "MIT LICENSE",
                size: DS.FontSize.micro,
                color: DS.Palette.inkFaint,
                tracking: DS.Tracking.label,
                width: contentWidth - padding * 2,
                alignment: .center
            )
            .offset(x: padding, y: 238)

            PixelText(
                text: "STATUS BAR APP - MACOS 13+",
                size: DS.FontSize.micro,
                color: DS.Palette.inkFaint,
                tracking: 0,
                width: contentWidth - padding * 2,
                alignment: .center
            )
            .offset(x: padding, y: 270)

            PixelText(
                text: "2026 TOKEN ISLAND",
                size: DS.FontSize.micro,
                color: DS.Palette.inkFaint,
                tracking: DS.Tracking.label,
                width: contentWidth - padding * 2,
                alignment: .center
            )
            .offset(x: padding, y: 300)
        }
        .frame(width: contentWidth, height: 330)
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
        // Fallback: the repo icon (snapshot / dev runs directly from the binary).
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
