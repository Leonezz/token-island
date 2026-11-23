import SwiftUI

// MARK: - Island surface
//
// Pure visual composition: no timers, no networking, no window state. This is
// what both the live AppKit panel and the headless snapshot renderer display,
// so the PNGs are exactly what users see.

struct IslandSurface: View {
    let summary: Summary
    let expanded: Bool
    let pinned: Bool
    let status: IslandStatus
    let offline: Bool
    let port: Int
    let now: Double
    let toast: String?
    let onPinToggle: () -> Void
    var onCollapsedTap: (() -> Void)?

    private var radius: CGFloat { expanded ? DS.Radius.expanded : DS.Radius.collapsed }
    private var size: CGSize { DS.Size.island(expanded: expanded) }

    var body: some View {
        ZStack(alignment: .top) {
            IslandBackground(radius: radius)
            content
                .frame(width: size.width, height: size.height, alignment: .top)
                .clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
        }
        .frame(width: size.width, height: size.height)
        .animation(.easeOut(duration: DS.Motion.contentFade), value: expanded)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Token Island"))
    }

    @ViewBuilder
    private var content: some View {
        if expanded {
            ExpandedView(
                summary: summary,
                status: status,
                offline: offline,
                pinned: pinned,
                port: port,
                now: now,
                toast: toast,
                onPinToggle: onPinToggle
            )
            .transition(.opacity)
        } else {
            CollapsedView(summary: summary, status: status, now: now)
                .contentShape(Rectangle())
                .onTapGesture { onCollapsedTap?() }
                .transition(.opacity)
        }
    }
}

// MARK: - Live app root
//
// Wraps the surface with the observable model. The panel controller drives
// hover/click/pin state; this view only mirrors it.

struct IslandRootView: View {
    @ObservedObject var model: IslandModel

    var body: some View {
        IslandSurface(
            summary: model.summary ?? .empty,
            expanded: model.expanded,
            pinned: model.pinned,
            status: model.status,
            offline: model.offline,
            port: model.config.port,
            now: model.now,
            toast: model.toast,
            onPinToggle: { model.togglePin() },
            onCollapsedTap: { model.expandAndPin() }
        )
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }
}
