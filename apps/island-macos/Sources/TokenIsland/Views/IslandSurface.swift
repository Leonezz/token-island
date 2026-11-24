import SwiftUI

// MARK: - Island surface
//
// Pure visual composition:
//  - Collapsed: invisible hover hit-zone tucked inside the notch
//  - Expanded:  flush top-bezel panel (580x500) with 24pt rounded bottom corners

struct IslandSurface: View {
    let summary: Summary
    let expanded: Bool
    let pinned: Bool
    let status: IslandStatus
    let offline: Bool
    let port: Int
    let now: Double
    let toast: String?
    var notchSize: CGSize = DS.Size.collapsed
    var animated: Bool = true
    var onPinToggle: () -> Void = {}
    var onCollapsedTap: (() -> Void)?

    private var size: CGSize { DS.Size.island(expanded: expanded, notch: notchSize) }

    var body: some View {
        ZStack(alignment: .top) {
            if expanded {
                ExpandedView(
                    summary: summary,
                    status: status,
                    offline: offline,
                    pinned: pinned,
                    port: port,
                    now: now,
                    toast: toast,
                    notchSize: notchSize,
                    panelWidth: size.width,
                    animated: animated,
                    onPinToggle: onPinToggle
                )
            } else {
                CollapsedView(
                    summary: summary,
                    status: status,
                    offline: offline,
                    size: size,
                    animated: animated
                )
                .contentShape(Rectangle())
                .onTapGesture { onCollapsedTap?() }
            }
        }
        .frame(width: size.width, height: size.height, alignment: .top)
        .animation(.easeOut(duration: DS.Motion.contentSwap), value: expanded)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Token Island"))
    }
}

// MARK: - Live app root

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
            notchSize: model.notchSize,
            animated: true,
            onPinToggle: { model.togglePin() },
            onCollapsedTap: { model.expandAndPin() }
        )
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }
}
