import AppKit
import SwiftUI

// MARK: - Panel
//
// Borderless, non-activating NSPanel that floats at `.statusBar` level above
// normal windows and full-screen apps, on every Space, without stealing focus.
// v1 §7.2 semantics are kept; V2 only changes the geometry (contract §1.1).

final class IslandPanel: NSPanel {
    /// Invoked for `cancelOperation(_:)` (Escape) when the panel is key.
    var onEscape: (() -> Void)?

    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }

    init() {
        super.init(
            contentRect: NSRect(origin: .zero, size: DS.Size.collapsed),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        isOpaque = false
        backgroundColor = .clear
        hasShadow = false
        level = .statusBar
        collectionBehavior = [.canJoinAllSpaces, .stationary, .fullScreenAuxiliary, .ignoresCycle]
        isMovableByWindowBackground = false
        animationBehavior = .none
        becomesKeyOnlyIfNeeded = true
        hidesOnDeactivate = false
        isReleasedWhenClosed = false
        isRestorable = false
        titleVisibility = .hidden
        titlebarAppearsTransparent = true
    }

    override func cancelOperation(_ sender: Any?) {
        onEscape?()
    }

    override var acceptsFirstResponder: Bool { true }
}

// MARK: - Hosting view
//
// Adds a `.activeAlways` tracking area for hover expansion (works while the app
// is inactive — the panel never activates), and relays right-clicks to the
// AppKit context menu. Left clicks stay with SwiftUI (tap to pin/expand,
// buttons in the header).

final class IslandHostingView: NSHostingView<IslandRootView> {
    var onHoverChange: ((Bool) -> Void)?
    var onRightClick: ((NSEvent) -> Void)?

    private var hoverTrackingArea: NSTrackingArea?

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let existing = hoverTrackingArea {
            removeTrackingArea(existing)
        }
        let area = NSTrackingArea(
            rect: .zero,
            options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect],
            owner: self,
            userInfo: nil
        )
        addTrackingArea(area)
        hoverTrackingArea = area
    }

    override func mouseEntered(with event: NSEvent) {
        onHoverChange?(true)
    }

    override func mouseExited(with event: NSEvent) {
        onHoverChange?(false)
    }

    override func rightMouseDown(with event: NSEvent) {
        onRightClick?(event)
    }

    /// The panel never activates, so the first click into it must be delivered
    /// to SwiftUI instead of being consumed as a window-activation click.
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool {
        true
    }
}

// MARK: - Panel controller
//
// Owns the window, its screen placement (notched display top-centre) and the
// hover / pin / collapse state machine. The frame animates 224x44 <-> 448x400
// with a 160ms step-ish ease-out while the content swaps.

@MainActor
final class IslandPanelController {

    private let model: IslandModel
    private let panel: IslandPanel
    private let hostingView: IslandHostingView

    private var expandTimer: MainTimer?
    private var collapseTimer: MainTimer?
    private var screenObserver: NSObjectProtocol?

    /// Supplied by AppDelegate so the island's right-click menu is identical to
    /// the one used from the status item.
    var contextMenuProvider: (() -> NSMenu)?

    init(model: IslandModel) {
        self.model = model

        let panel = IslandPanel()
        let hosting = IslandHostingView(rootView: IslandRootView(model: model))
        self.panel = panel
        self.hostingView = hosting

        panel.contentView = hosting
        hosting.wantsLayer = true
        hosting.onHoverChange = { [weak self] inside in
            self?.hoverChanged(inside)
        }
        hosting.onRightClick = { [weak self] event in
            self?.showContextMenu(event)
        }
        panel.onEscape = { [weak self] in
            self?.model.collapse()
        }

        panel.setAccessibilityElement(true)
        panel.setAccessibilityRole(.group)
        panel.setAccessibilityLabel("Token Island")

        panel.setFrame(frame(forExpanded: model.expanded), display: false)
        panel.orderFrontRegardless()

        model.onExpansionChange = { [weak self] expanded in
            self?.animate(to: expanded)
        }
        model.onVisibilityChange = { [weak self] visible in
            self?.applyVisibility(visible)
        }

        screenObserver = NotificationCenter.default.addObserver(
            forName: NSApplication.didChangeScreenParametersNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                self?.reposition()
            }
        }
    }

    deinit {
        if let screenObserver {
            NotificationCenter.default.removeObserver(screenObserver)
        }
    }

    // MARK: Screen geometry (contract §1.1)

    /// The notched built-in display when present, otherwise the main display.
    static func targetScreen() -> NSScreen? {
        NSScreen.screens.first(where: { $0.safeAreaInsets.top > 0 })
            ?? NSScreen.main
            ?? NSScreen.screens.first
    }

    /// Horizontal centre of the notch (or of the screen when there is none).
    static func notchCenterX(for screen: NSScreen) -> CGFloat {
        if let left = screen.auxiliaryTopLeftArea, let right = screen.auxiliaryTopRightArea {
            let notchWidth = screen.frame.width - left.width - right.width
            return screen.frame.minX + left.width + notchWidth / 2
        }
        return screen.frame.midX
    }

    /// Frame for the island attached to the top edge of the target screen: the
    /// pixel panel's top edge sits `DS.Space.topEdgeInset` (2pt) below the very
    /// top, so the island hangs just under the menu bar / around the notch.
    func frame(forExpanded expanded: Bool) -> NSRect {
        let size = DS.Size.island(expanded: expanded)
        guard let screen = Self.targetScreen() else {
            return NSRect(origin: .zero, size: size)
        }
        let centerX = Self.notchCenterX(for: screen)
        let top = screen.frame.maxY - DS.Space.topEdgeInset
        return NSRect(
            x: (centerX - size.width / 2).rounded(),
            y: top - size.height,
            width: size.width,
            height: size.height
        )
    }

    // MARK: Visibility

    func present() {
        panel.setFrame(frame(forExpanded: model.expanded), display: false)
        panel.orderFrontRegardless()
    }

    private func applyVisibility(_ visible: Bool) {
        if visible {
            present()
        } else {
            panel.orderOut(nil)
        }
    }

    // MARK: Animation

    private func animate(to expanded: Bool) {
        expandTimer?.cancel()
        collapseTimer?.cancel()
        let target = frame(forExpanded: expanded)
        NSAnimationContext.runAnimationGroup { context in
            context.duration = DS.Motion.frameAnimation
            context.timingFunction = CAMediaTimingFunction(name: .easeOut)
            context.allowsImplicitAnimation = true
            panel.animator().setFrame(target, display: true)
        }
    }

    private func reposition() {
        expandTimer?.cancel()
        collapseTimer?.cancel()
        let target = frame(forExpanded: model.expanded)
        NSAnimationContext.runAnimationGroup { context in
            context.duration = 0.2
            context.timingFunction = CAMediaTimingFunction(name: .easeOut)
            panel.animator().setFrame(target, display: true)
        }
    }

    // MARK: Hover

    private var pointerInsidePanel: Bool {
        guard panel.isVisible else { return false }
        return panel.frame.contains(NSEvent.mouseLocation)
    }

    private func hoverChanged(_ inside: Bool) {
        if inside {
            collapseTimer?.cancel()
            guard !model.expanded else { return }
            expandTimer?.cancel()
            expandTimer = MainTimer(interval: DS.Motion.hoverExpandDelay) { [weak self] in
                guard let self, self.pointerInsidePanel else { return }
                self.model.setExpanded(true)
            }
        } else {
            expandTimer?.cancel()
            guard model.expanded, !model.pinned else { return }
            collapseTimer?.cancel()
            collapseTimer = MainTimer(interval: DS.Motion.hoverCollapseDelay) { [weak self] in
                guard let self, !self.pointerInsidePanel else { return }
                self.model.setExpanded(false)
            }
        }
    }

    // MARK: Context menu

    private func showContextMenu(_ event: NSEvent) {
        guard let menu = contextMenuProvider?() else { return }
        let location = hostingView.convert(event.locationInWindow, from: nil)
        menu.popUp(positioning: nil, at: location, in: hostingView)
    }
}
