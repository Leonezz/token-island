import SwiftUI

// MARK: - Collapsed pill (210 x 36)
//
// Content contract §7.4: live pulse dot · today tokens · TODAY micro label ·
// 30x12 sparkline · trailing estimated cost.

struct CollapsedView: View {
    let summary: Summary
    let status: IslandStatus
    let now: Double

    private var accent: Color {
        switch status {
        case .live: return DS.Palette.live
        case .idle: return Color.white.opacity(0.38)
        case .offline: return DS.Palette.warning
        }
    }

    private var valueText: String {
        summary.today.totalTokens > 0 ? Fmt.tokens(summary.today.totalTokens) : "—"
    }

    private var costText: String {
        summary.today.costUsd > 0 ? Fmt.cost(summary.today.costUsd, approx: true) : "—"
    }

    private var sparkValues: [Int] {
        summary.last14Days.suffix(7).map(\.totalTokens)
    }

    var body: some View {
        HStack(spacing: 0) {
            PulseDot(color: accent, size: 7, animated: status == .live)

            Text(valueText)
                .font(DS.Fonts.pillNumber)
                .monospacedDigit()
                .foregroundStyle(DS.Palette.textPrimary.opacity(status == .offline ? 0.55 : 1.0))
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                .padding(.leading, 2)

            Text("TODAY")
                .font(DS.Fonts.microSmall)
                .tracking(DS.Tracking.micro)
                .foregroundStyle(DS.Palette.textTertiary)
                .padding(.leading, 5)

            Spacer(minLength: 4)

            Sparkline(values: sparkValues, height: 12, gap: 1.5)
                .frame(width: 30, height: 12)

            Text(costText)
                .font(.system(size: 10, weight: .medium, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(DS.Palette.textSecondary.opacity(status == .offline ? 0.6 : 1.0))
                .lineLimit(1)
                .padding(.leading, 7)
        }
        .padding(.horizontal, DS.Space.pillPadding)
        .frame(width: DS.Size.collapsedWidth, height: DS.Size.collapsedHeight)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text("Token Island. Today \(Fmt.tokensFull(summary.today.totalTokens)) tokens, estimated cost \(Fmt.cost(summary.today.costUsd))"))
    }
}
