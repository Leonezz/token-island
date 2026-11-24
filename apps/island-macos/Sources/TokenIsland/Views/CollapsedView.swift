import SwiftUI

// MARK: - Collapsed Capsule (280 x 38)
//
// Clean Precision Telemetry status capsule:
//   [LED dot] [1.49M 14pt mono bold] [Today 11.5pt dim] ... [7d sparkline] [~$2.57 pill]

struct CollapsedView: View {
    let summary: Summary
    let status: IslandStatus
    let offline: Bool
    var animated: Bool = true

    private var sparkValues: [Int] {
        Array(summary.last14Days.suffix(7).map(\.totalTokens))
    }

    private var dotColor: Color {
        switch status {
        case .live: return DS.Palette.teal
        case .idle: return DS.Palette.inkFaint
        case .offline: return DS.Palette.amber
        }
    }

    var body: some View {
        ZStack {
            PixelPanel(
                fill: DS.Palette.surface,
                border: offline ? DS.Palette.amber.opacity(0.65) : DS.Palette.borderHi,
                corner: DS.Space.corner
            )

            HStack(spacing: 8) {
                BlinkDot(
                    live: status == .live,
                    size: 6,
                    animated: animated,
                    onColor: dotColor,
                    offColor: DS.Palette.tealDark,
                    idleColor: dotColor
                )
                .frame(width: 10, height: 10)

                Text(Fmt.tokens(summary.today.totalTokens))
                    .font(DS.Typography.mono(14, weight: .bold))
                    .foregroundColor(DS.Palette.ink)

                Text(offline ? "Cached" : "Today")
                    .font(DS.Typography.sans(11.5, weight: .medium))
                    .foregroundColor(offline ? DS.Palette.amber : DS.Palette.inkDim)

                Spacer(minLength: 6)

                if !sparkValues.isEmpty {
                    MiniBarSparkline(values: sparkValues, width: 32, height: 13)
                }

                Text(Fmt.cost(summary.today.costUsd, approx: true))
                    .font(DS.Typography.mono(11.5, weight: .semibold))
                    .foregroundColor(DS.Palette.amber)
                    .padding(.horizontal, 7)
                    .padding(.vertical, 2.5)
                    .background(
                        RoundedRectangle(cornerRadius: DS.Space.smallCorner, style: .continuous)
                            .fill(DS.Palette.surfaceAlt)
                    )
            }
            .padding(.horizontal, DS.Space.collapsedInset)
        }
        .frame(width: DS.Size.collapsedWidth, height: DS.Size.collapsedHeight)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(
            Text("Token Island. Today \(Fmt.tokensFull(summary.today.totalTokens)) tokens, estimated cost \(Fmt.cost(summary.today.costUsd))")
        )
    }
}
