import AppKit

// MARK: - NSApplication main menu (contract §1.4)
//
// Even though Token Island is an accessory (LSUIElement) app with no Dock icon,
// it owns a real main menu so ⌘, / ⌘H / ⌘Q and the standard Edit shortcuts work
// whenever one of its windows is key. The menu items target AppDelegate.

@MainActor
enum MainMenu {
    static func install(target: AnyObject) {
        let appName = "Token Island"
        let mainMenu = NSMenu()

        // Application menu.
        let appMenuItem = NSMenuItem()
        let appMenu = NSMenu(title: appName)
        appMenu.addItem(item("About Token Island", #selector(AppDelegate.showAbout), target: target))
        appMenu.addItem(.separator())
        appMenu.addItem(item("Preferences…", #selector(AppDelegate.showPreferences), target: target, key: ","))
        appMenu.addItem(.separator())
        appMenu.addItem(item("Hide Token Island", #selector(NSApplication.hide(_:)), target: nil, key: "h"))
        let hideOthers = item("Hide Others", #selector(NSApplication.hideOtherApplications(_:)), target: nil, key: "h")
        hideOthers.keyEquivalentModifierMask = [.command, .option]
        appMenu.addItem(hideOthers)
        appMenu.addItem(item("Show All", #selector(NSApplication.unhideAllApplications(_:)), target: nil))
        appMenu.addItem(.separator())
        appMenu.addItem(item("Quit Token Island", #selector(NSApplication.terminate(_:)), target: nil, key: "q"))
        appMenuItem.submenu = appMenu
        mainMenu.addItem(appMenuItem)

        // Edit menu (needed by the Preferences text field).
        let editMenuItem = NSMenuItem()
        let editMenu = NSMenu(title: "Edit")
        editMenu.addItem(item("Undo", Selector(("undo:")), target: nil, key: "z"))
        let redo = item("Redo", Selector(("redo:")), target: nil, key: "z")
        redo.keyEquivalentModifierMask = [.command, .shift]
        editMenu.addItem(redo)
        editMenu.addItem(.separator())
        editMenu.addItem(item("Cut", #selector(NSText.cut(_:)), target: nil, key: "x"))
        editMenu.addItem(item("Copy", #selector(NSText.copy(_:)), target: nil, key: "c"))
        editMenu.addItem(item("Paste", #selector(NSText.paste(_:)), target: nil, key: "v"))
        editMenu.addItem(item("Select All", #selector(NSText.selectAll(_:)), target: nil, key: "a"))
        editMenuItem.submenu = editMenu
        mainMenu.addItem(editMenuItem)

        NSApp.mainMenu = mainMenu
    }

    private static func item(
        _ title: String,
        _ action: Selector,
        target: AnyObject?,
        key: String = ""
    ) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: key)
        item.target = target
        return item
    }
}
