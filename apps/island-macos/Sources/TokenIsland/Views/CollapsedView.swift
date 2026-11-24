import SwiftUI

// MARK: - Collapsed State (Invisible Notch Hover Trigger)
//
// Visually 100% invisible on screen so nothing protrudes around the MacBook
// camera notch or occludes menu-bar icons. Uses a near-zero alpha (0.012) fill
// above macOS WindowServer's click-through threshold so moving the cursor up to
// the notch reliably triggers hover expansion.

struct CollapsedView: View {
    let summary: Summary
    let status: IslandStatus
    let offline: Bool
    var size: CGSize = DS.Size.collapsed
    var animated: Bool = true

    var body: some View {
        Rectangle()
            .fill(Color.black.opacity(0.012))
            .frame(width: size.width, height: size.height)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(
                Text("Token Island notch trigger. Today \(Fmt.tokensFull(summary.today.totalTokens)) tokens, estimated cost \(Fmt.cost(summary.today.costUsd))")
            )
    }
}
