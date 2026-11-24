import SwiftUI

// MARK: - Collapsed island (224 x 44)
//
// Contract §1.2:
//   [blink dot 6x6 teal] 8 [TODAY TOKEN COUNT 16pt ink] 6 [TODAY 8pt inkDim]
//   … [~$6.11 8pt inkDim]
//
// Panel: surface fill, 2pt border, 1pt top highlight, staircase corners and a
// 2pt hard bottom shadow. Content inset is 8pt; the cost hides itself when the
// numbers would collide.

struct CollapsedView: View {
    let summary: Summary
    let status: IslandStatus
    let offline: Bool
    var animated: Bool = true

    private let width: CGFloat = DS.Size.collapsedWidth
    private let bodyHeight: CGFloat = DS.Size.collapsedHeight - DS.Size.shadow
    private let inset: CGFloat = DS.Space.collapsedInset

    private var countText: String {
        Fmt.tokens(summary.today.totalTokens)
    }

    private var countWidth: CGFloat {
        PixelText.metrics(countText, size: DS.FontSize.small)
    }

    private var countTop: CGFloat {
        // 16pt cap height is 10; centre the 10pt cap block in the 26pt content.
        inset + (bodyHeight - inset * 2 - PixelText.capHeight(DS.FontSize.small)) / 2
    }

    private var baselineTop: CGFloat {
        countTop + PixelText.capHeight(DS.FontSize.small) - PixelText.capHeight(DS.FontSize.micro)
    }

    private var dotColor: Color {
        switch status {
        case .live: return DS.Palette.teal
        case .idle: return DS.Palette.inkFaint
        case .offline: return DS.Palette.amber
        }
    }

    private var contentOpacity: Double {
        offline ? 0.45 : 1
    }

    var body: some View {
        ZStack(alignment: .topLeading) {
            PixelPanel(highlight: offline ? DS.Palette.amber.opacity(0.7) : DS.Palette.borderHi)

            BlinkDot(
                live: status == .live,
                size: 6,
                animated: animated,
                onColor: dotColor,
                offColor: DS.Palette.tealDark,
                idleColor: dotColor
            )
            .offset(x: 8, y: 18)

            PixelText(text: countText, size: DS.FontSize.small, color: DS.Palette.ink)
                .offset(x: 22, y: countTop)
                .opacity(contentOpacity)

            PixelLabel(text: "TODAY", color: DS.Palette.inkDim)
                .offset(x: 22 + countWidth + 6, y: baselineTop)
                .opacity(contentOpacity)

            costView
        }
        .frame(width: width, height: DS.Size.collapsedHeight, alignment: .topLeading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(
            Text("Token Island. Today \(Fmt.tokensFull(summary.today.totalTokens)) tokens, estimated cost \(Fmt.cost(summary.today.costUsd))")
        )
    }

    @ViewBuilder
    private var costView: some View {
        let costText = Fmt.cost(summary.today.costUsd, approx: true)
        let costWidth = PixelText.metrics(costText, size: DS.FontSize.micro)
        let costX = width - inset - costWidth
        let todayX = 22 + countWidth + 6
        let todayEnd = todayX + PixelText.metrics("TODAY", size: DS.FontSize.micro, tracking: DS.Tracking.label)
        if costX - todayEnd >= 6 {
            PixelText(text: costText, size: DS.FontSize.micro, color: DS.Palette.inkDim, extraTop: 1)
                .offset(x: costX, y: baselineTop - 1)
                .opacity(contentOpacity)
        }
    }
}
