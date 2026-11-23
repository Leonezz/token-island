import AppKit

// MARK: - Application delegate
//
// Owns the island model, the floating panel controller and the menu-bar status
// item. All menus/actions live here so the status item and the island's
// right-click menu can share them.

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate {

    private let options: LaunchOptions
    private let config: IslandConfig
    private let model: IslandModel

    private var panelController: IslandPanelController?
    private var statusItem: NSStatusItem?
    private var escapeMonitor: Any?

    init(options: LaunchOptions) {
        self.options = options
        self.config = IslandConfig.load()
        self.model = IslandModel(
            config: config,
            demoMode: options.demo,
            fixturePath: FixtureLoader.envOverride()
        )
        super.init()
    }

    // MARK: Launch

    func applicationWillFinishLaunching(_ notification: Notification) {
        // Menu-bar-only app: no Dock icon, no app menu.
        NSApp.setActivationPolicy(.accessory)
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        let controller = IslandPanelController(model: model)
        controller.contextMenuProvider = { [weak self] in
            self?.makeContextMenu() ?? NSMenu()
        }
        panelController = controller
        controller.present()

        installStatusItem()
        installEscapeMonitor()

        // Diagnostics for `--demo` smoke tests (the Lead cannot screenshot the
        // screen, so the resolved notch geometry is logged to stderr).
        logGeometry()

        model.start()
    }

    func applicationWillTerminate(_ notification: Notification) {
        model.stop()
        if let escapeMonitor {
            NSEvent.removeMonitor(escapeMonitor)
            self.escapeMonitor = nil
        }
    }

    // MARK: Geometry logging

    private func logGeometry() {
        guard let controller = panelController else { return }
        let screens = NSScreen.screens.enumerated().map { index, screen -> String in
            let frame = screen.frame
            let notch = screen.safeAreaInsets.top > 0 ? "yes" : "no"
            let widths: String
            if let left = screen.auxiliaryTopLeftArea, let right = screen.auxiliaryTopRightArea {
                widths = "aux=\(Int(left.width))/\(Int(right.width))"
            } else {
                widths = "aux=none"
            }
            return "screen[\(index)] \(screen.localizedName) \(Int(frame.width))x\(Int(frame.height))@(\(Int(frame.minX)),\(Int(frame.minY))) safeTop=\(Int(screen.safeAreaInsets.top)) notch=\(notch) \(widths)"
        }
        let target = IslandPanelController.targetScreen()
        let notchWidth = target.map { screen -> Int in
            guard let left = screen.auxiliaryTopLeftArea, let right = screen.auxiliaryTopRightArea else { return 0 }
            return Int(screen.frame.width - left.width - right.width)
        } ?? 0
        let collapsed = controller.frame(forExpanded: false)
        let expanded = controller.frame(forExpanded: true)
        let lines = [
            "[island] demo=\(options.demo) port=\(config.port) screens=\(screens.count)",
            "[island] target=\(target?.localizedName ?? "none") notchWidth=\(notchWidth)",
            "[island] collapsed={\(Int(collapsed.minX)),\(Int(collapsed.minY)),\(Int(collapsed.width)),\(Int(collapsed.height))} expanded={\(Int(expanded.minX)),\(Int(expanded.minY)),\(Int(expanded.width)),\(Int(expanded.height))} level=statusBar",
        ]
        for line in lines {
            FileHandle.standardError.write(Data((line + "\n").utf8))
        }
    }

    // MARK: Status item

    private func installStatusItem() {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        if let button = item.button {
            let image = NSImage(
                systemSymbolName: "bolt.horizontal.circle.fill",
                accessibilityDescription: "Token Island"
            )
            image?.isTemplate = true
            button.image = image
            button.toolTip = "Token Island"
        }
        let menu = NSMenu()
        menu.delegate = self
        item.menu = menu
        statusItem = item
    }

    /// Status-bar menu (contract §7.2). Rebuilt on every open so labels always
    /// reflect the current state.
    func menuNeedsUpdate(_ menu: NSMenu) {
        guard menu === statusItem?.menu else { return }
        menu.removeAllItems()

        menu.addItem(menuItem(
            model.panelVisible ? "Hide Island" : "Show Island",
            action: #selector(toggleIslandVisibility)
        ))
        menu.addItem(.separator())
        menu.addItem(menuItem("Sync Cloud Now", action: #selector(syncCloudNow), keyEquivalent: "r"))
        menu.addItem(menuItem("Open Dashboard", action: #selector(openDashboard), keyEquivalent: "d"))
        menu.addItem(menuItem("Snapshot Demo…", action: #selector(snapshotDemo)))
        menu.addItem(.separator())

        let loginItem = NSMenuItem(
            title: "Launch at Login: \(launchAgentInstalled ? "On" : "Off")",
            action: nil,
            keyEquivalent: ""
        )
        loginItem.isEnabled = false
        menu.addItem(loginItem)

        menu.addItem(.separator())
        menu.addItem(menuItem("Quit Token Island", action: #selector(quit), keyEquivalent: "q"))
    }

    /// Right-click menu on the island itself (contract §7.2).
    private func makeContextMenu() -> NSMenu {
        let menu = NSMenu()
        menu.addItem(menuItem("Open Dashboard", action: #selector(openDashboard)))
        menu.addItem(menuItem("Sync Cloud Now", action: #selector(syncCloudNow)))
        menu.addItem(menuItem("Snapshot Demo…", action: #selector(snapshotDemo)))
        menu.addItem(.separator())
        menu.addItem(menuItem(
            model.panelVisible ? "Hide Island" : "Show Island",
            action: #selector(toggleIslandVisibility)
        ))
        menu.addItem(.separator())
        menu.addItem(menuItem("Quit Token Island", action: #selector(quit)))
        return menu
    }

    private func menuItem(_ title: String, action: Selector, keyEquivalent: String = "") -> NSMenuItem {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: keyEquivalent)
        item.target = self
        return item
    }

    private var launchAgentInstalled: Bool {
        FileManager.default.fileExists(
            atPath: NSString(string: "~/Library/LaunchAgents/com.token-island.app.plist").expandingTildeInPath
        )
    }

    // MARK: Actions

    @objc private func toggleIslandVisibility() {
        model.togglePanelVisibility()
    }

    @objc private func syncCloudNow() {
        model.syncCloudNow()
    }

    @objc private func openDashboard() {
        model.openDashboard()
    }

    @objc private func snapshotDemo() {
        let summary = model.summary ?? .empty
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyyMMdd-HHmmss"
        let stamp = formatter.string(from: Date())
        let directory = FileManager.default.urls(for: .desktopDirectory, in: .userDomainMask).first
            ?? FileManager.default.temporaryDirectory
        let path = directory.appendingPathComponent("token-island-\(stamp).png").path
        let ok = SnapshotWriter.write(
            state: .expanded,
            summary: summary,
            offline: model.offline,
            port: config.port,
            scale: 2,
            background: .wallpaper,
            to: path
        )
        if ok {
            model.showToast("Snapshot saved to Desktop")
            NSWorkspace.shared.open(URL(fileURLWithPath: path))
        } else {
            model.showToast("Snapshot failed")
        }
    }

    @objc private func quit() {
        NSApp.terminate(nil)
    }

    // MARK: Escape

    private func installEscapeMonitor() {
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleEscape),
            name: .islandEscapeRequested,
            object: nil
        )
        escapeMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { event in
            if event.keyCode == 53 {
                NotificationCenter.default.post(name: .islandEscapeRequested, object: nil)
                return nil
            }
            return event
        }
    }

    @objc private func handleEscape() {
        guard model.expanded else { return }
        model.collapse()
    }
}

extension Notification.Name {
    static let islandEscapeRequested = Notification.Name("TokenIslandEscapeRequested")
}

// MARK: - App entry

@MainActor
enum TokenIslandApp {
    /// Runs the menu-bar app. Never returns.
    static func run(options: LaunchOptions) -> Never {
        let application = NSApplication.shared
        let delegate = AppDelegate(options: options)
        application.delegate = delegate
        application.run()
        exit(0)
    }
}
