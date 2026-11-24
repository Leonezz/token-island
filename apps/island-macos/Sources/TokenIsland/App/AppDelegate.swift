import AppKit

// MARK: - Application delegate
//
// Owns the island model, the floating pixel panel controller, the menu-bar
// status item, the main menu and the About / Preferences windows. The app is an
// LSUIElement accessory: no Dock icon, no focus stealing, alive while hidden.
// Contract §1.1 / §1.4 / v1 §7.2.

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate {

    private let options: LaunchOptions
    private let config: IslandConfig
    private let settings: AppSettings
    private let model: IslandModel

    private var panelController: IslandPanelController?
    private var statusItem: NSStatusItem?
    private var aboutController: AboutWindowController?
    private var preferencesController: PreferencesWindowController?
    private var escapeMonitor: Any?

    init(options: LaunchOptions) {
        self.options = options
        self.config = IslandConfig.load()
        self.settings = AppSettings.shared
        self.model = IslandModel(
            config: config,
            demoMode: options.demo,
            fixturePath: FixtureLoader.envOverride(),
            settings: settings
        )
        super.init()
    }

    // MARK: Launch

    func applicationWillFinishLaunching(_ notification: Notification) {
        // Menu-bar-only app: no Dock icon, no app menu in the Dock, but a real
        // NSApplication main menu for ⌘, / ⌘H / ⌘Q (contract §1.4).
        NSApp.setActivationPolicy(.accessory)
        MainMenu.install(target: self)
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
        logGeometry()
        model.start()

        // Developer QA hooks: exercise the native About / Preferences windows
        // without UI automation (used by the smoke test).
        if options.showPreferences { showPreferences() }
        if options.showAbout { showAbout() }
    }

    func applicationWillTerminate(_ notification: Notification) {
        model.stop()
        if let escapeMonitor {
            NSEvent.removeMonitor(escapeMonitor)
            self.escapeMonitor = nil
        }
    }

    /// Reopening the app (Finder double-click, `open TokenIsland.app`) restores
    /// the island even when it was hidden (contract §1.4).
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        model.showPanel()
        return true
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        false
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
            "[island] v\(DS.version) demo=\(options.demo) port=\(model.port) refresh=\(settings.refreshInterval)s screens=\(screens.count)",
            "[island] target=\(target?.localizedName ?? "none") notchWidth=\(notchWidth) topEdge=maxY-\(Int(DS.Space.topEdgeInset))",
            "[island] collapsed={\(Int(collapsed.minX)),\(Int(collapsed.minY)),\(Int(collapsed.width)),\(Int(collapsed.height))} expanded={\(Int(expanded.minX)),\(Int(expanded.minY)),\(Int(expanded.width)),\(Int(expanded.height))} level=statusBar",
            "[island] fonts=\(PixelFont.isAvailable ? "Silkscreen-Regular/Silkscreen-Bold" : "fallback") statusItem=\(statusItemImageSource)",
        ]
        for line in lines {
            FileHandle.standardError.write(Data((line + "\n").utf8))
        }
    }

    private var statusItemImageSource: String {
        guard let button = statusItem?.button else { return "none" }
        return button.image?.isTemplate == true ? "pixel-template" : "sf-symbol"
    }

    // MARK: Status item

    private func installStatusItem() {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        if let button = item.button {
            // Pixel-art template icon generated at runtime from the chart sprite
            // (18x18 at 2x). Fallback to an SF Symbol if that ever fails.
            if let image = PixelSprite.chart.templateImage(scale: 3, canvas: CGSize(width: 18, height: 18)),
               image.size.width > 0 {
                image.size = NSSize(width: 18, height: 18)
                button.image = image
            } else {
                let fallback = NSImage(
                    systemSymbolName: "chart.bar.fill",
                    accessibilityDescription: "Token Island"
                )
                fallback?.isTemplate = true
                button.image = fallback
            }
            button.toolTip = "Token Island"
            button.setAccessibilityLabel("Token Island")
        }
        let menu = NSMenu()
        menu.delegate = self
        item.menu = menu
        statusItem = item
    }

    /// Status-bar menu (contract §1.4). Rebuilt on every open so labels reflect
    /// the current state.
    func menuNeedsUpdate(_ menu: NSMenu) {
        guard menu === statusItem?.menu else { return }
        menu.removeAllItems()

        menu.addItem(menuItem(
            model.panelVisible ? "Hide Island" : "Show Island",
            action: #selector(toggleIslandVisibility)
        ))
        menu.addItem(menuItem("Open Dashboard", action: #selector(openDashboard), keyEquivalent: "d"))
        menu.addItem(menuItem("Sync Cloud Now", action: #selector(syncCloudNow), keyEquivalent: "r"))
        menu.addItem(.separator())
        menu.addItem(menuItem("Preferences…", action: #selector(showPreferences), keyEquivalent: ","))
        menu.addItem(menuItem("About Token Island", action: #selector(showAbout)))
        menu.addItem(.separator())
        menu.addItem(menuItem("Quit Token Island", action: #selector(quit), keyEquivalent: "q"))
    }

    /// Right-click menu on the island itself; same verbs as the status menu.
    private func makeContextMenu() -> NSMenu {
        let menu = NSMenu()
        menu.addItem(menuItem("Open Dashboard", action: #selector(openDashboard)))
        menu.addItem(menuItem("Sync Cloud Now", action: #selector(syncCloudNow)))
        menu.addItem(.separator())
        menu.addItem(menuItem(
            model.panelVisible ? "Hide Island" : "Show Island",
            action: #selector(toggleIslandVisibility)
        ))
        menu.addItem(menuItem("Preferences…", action: #selector(showPreferences)))
        menu.addItem(menuItem("About Token Island", action: #selector(showAbout)))
        menu.addItem(.separator())
        menu.addItem(menuItem("Quit Token Island", action: #selector(quit)))
        return menu
    }

    private func menuItem(_ title: String, action: Selector, keyEquivalent: String = "") -> NSMenuItem {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: keyEquivalent)
        item.target = self
        return item
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

    @objc func showPreferences() {
        if preferencesController == nil {
            preferencesController = PreferencesWindowController()
        }
        preferencesController?.show(model: model, settings: settings)
    }

    @objc func showAbout() {
        if aboutController == nil {
            aboutController = AboutWindowController()
        }
        aboutController?.show()
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
