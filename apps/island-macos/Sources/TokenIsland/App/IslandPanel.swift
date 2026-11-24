import AppKit
import SwiftUI

// MARK: - Panel
//
// Borderless, non-activating NSPanel anchored flush to `screen.frame.maxY`
// (0pt top gap). When collapsed, it acts as a 100% invisible hover sensor at
// the hardware notch; when hovered or pinned, it expands seamlessly downward.

final class IslandPanel: NSPanel {
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

    override func acceptsFirstMouse(for event: NSEvent?) -> Bool {
        true
    }
}

// MARK: - Panel controller

@MainActor
final class IslandPanelController {

    private let model: IslandModel
    private let panel: IslandPanel
    private let hostingView: IslandHostingView

    private var expandTimer: MainTimer?
    private var collapseTimer: MainTimer?
    private var screenObserver: NSObjectProtocol?

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

        syncNotchMetrics()
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

    // MARK: Screen & Notch Geometry

    static func targetScreen() -> NSScreen? {
        NSScreen.screens.first(where: { $0.safeAreaInsets.top > 0 })
            ?? NSScreen.main
            ?? NSScreen.screens.first
    }

    static func notchCenterX(for screen: NSScreen) -> CGFloat {
        if let left = screen.auxiliaryTopLeftArea, let right = screen.auxiliaryTopRightArea {
            let notchWidth = screen.frame.width - left.width - right.width
            return screen.frame.minX + left.width + notchWidth / 2
        }
        return screen.frame.midX
    }

    /// Measured hardware notch size (or sensible menu-bar fallback on non-notched displays).
    static func measuredNotchSize(for screen: NSScreen?) -> CGSize {
        guard let screen else { return DS.Size.collapsed }
        let safeTop = screen.safeAreaInsets.top
        if safeTop > 0, let left = screen.auxiliaryTopLeftArea, let right = screen.auxiliaryTopRightArea {
            let rawWidth = screen.frame.width - left.width - right.width
            return CGSize(
                width: max(170, min(280, rawWidth.rounded())),
                height: max(30, safeTop.rounded())
            )
        }
        // Non-notched external monitor: zero-obstruction center strip
        return CGSize(width: 180, height: 6)
    }

    private func syncNotchMetrics() {
        let measured = Self.measuredNotchSize(for: Self.targetScreen())
        if model.notchSize != measured {
            model.notchSize = measured
        }
    }

    /// Top edge is strictly flush with `screen.frame.maxY` (0pt gap).
    func frame(forExpanded expanded: Bool) -> NSRect {
        let screen = Self.targetScreen()
        let notch = Self.measuredNotchSize(for: screen)
        let size = DS.Size.island(expanded: expanded, notch: notch)
        guard let screen else {
            return NSRect(origin: .zero, size: size)
        }
        let centerX = Self.notchCenterX(for: screen)
        let top = screen.frame.maxY
        return NSRect(
            x: (centerX - size.width / 2).rounded(),
            y: top - size.height,
            width: size.width,
            height: size.height
        )
    }

    // MARK: Visibility

    func present() {
        syncNotchMetrics()
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
        syncNotchMetrics()
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
        syncNotchMetrics()
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
