import SwiftUI

// MARK: - Island surface
//
// Pure visual composition: no timers, no networking, no window state. This is
// exactly what the AppKit panel and the headless snapshot renderer display, so
// the PNGs are the real pixel UI.
//
// A `PixelPanel` draws the full window (the 2pt hard bottom shadow is part of
// the window, so nothing is clipped). Collapsed = 224x44, expanded = 448x400.

struct IslandSurface: View {
    let summary: Summary
    let expanded: Bool
    let pinned: Bool
    let status: IslandStatus
    let offline: Bool
    let port: Int
    let now: Double
    let toast: String?
    var animated: Bool = true
    var onPinToggle: () -> Void = {}
    var onCollapsedTap: (() -> Void)?

    private var size: CGSize { DS.Size.island(expanded: expanded) }

    var body: some View {
        ZStack(alignment: .topLeading) {
            if expanded {
                ExpandedView(
                    summary: summary,
                    status: status,
                    offline: offline,
                    pinned: pinned,
                    port: port,
                    now: now,
                    toast: toast,
                    animated: animated,
                    onPinToggle: onPinToggle
                )
            } else {
                CollapsedView(summary: summary, status: status, offline: offline, animated: animated)
                    .contentShape(Rectangle())
                    .onTapGesture { onCollapsedTap?() }
            }
        }
        .frame(width: size.width, height: size.height, alignment: .topLeading)
        .animation(.linear(duration: DS.Motion.contentSwap), value: expanded)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Token Island"))
    }
}

// MARK: - Live app root

/// Wraps the surface with the observable model. The panel controller drives
/// hover / click / pin state; this view only mirrors it, so the live 2s polling
/// updates snap entire values instead of tweening them.
struct IslandRootView: View {
    @ObservedObject var model: IslandModel

    var body: some View {
        IslandSurface(
            summary: model.summary ?? .empty,
            expanded: model.expanded,
            pinned: model.pinned,
            status: model.status,
            offline: model.offline,
            port: model.port,
            now: model.now,
            toast: model.toast,
            animated: true,
            onPinToggle: { model.togglePin() },
            onCollapsedTap: { model.expandAndPin() }
        )
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}
