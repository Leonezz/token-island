import SwiftUI

// MARK: - Shared pixel components
//
// The small, stateless pieces used by the collapsed island and the 448x400
// expanded panel. Every position is an integer point; no view depends on
// animation phase, so the snapshot renderer is deterministic.

// MARK: Labels

/// Uppercase micro label with the canonical pixel tracking.
struct PixelLabel: View {
    let text: String
    var color: Color = DS.Palette.inkDim
    var size: CGFloat = DS.FontSize.micro
    var tracking: CGFloat = DS.Tracking.label

    var body: some View {
        PixelText(text: text, size: size, color: color, tracking: tracking)
    }
}

// MARK: Live dot

/// Expanded-panel session/section dot: 6pt blinking 3x3 sprite.
struct LiveDot: View {
    var active: Bool
    var color: Color = DS.Palette.teal
    var animated: Bool = true

    var body: some View {
        BlinkDot(
            live: active,
            size: 6,
            animated: animated,
            onColor: color,
            offColor: DS.Palette.tealDark,
            idleColor: DS.Palette.inkFaint
        )
    }
}

// MARK: Token split

/// One IN / CACHE / OUT cell: 6pt segmented bar with label + value underneath
/// (the "legend row" sits under the bars, contract §1.3.3).
struct SplitBarCell: View {
    let label: String
    let value: Int
    let total: Int
    let color: Color
    let width: CGFloat

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            PixelSegmentedBar(
                ratio: total > 0 ? Double(value) / Double(total) : 0,
                color: color,
                height: 6,
                segments: 16,
                gap: 2
            )
            .frame(width: width, height: 6)

            HStack(spacing: 0) {
                PixelText(text: label, size: DS.FontSize.micro, color: DS.Palette.inkDim, tracking: DS.Tracking.label)
                Spacer(minLength: 0)
                PixelText(text: Fmt.tokens(value), size: DS.FontSize.micro, color: DS.Palette.ink)
            }
            .frame(width: width, height: 5)
            .padding(.top, 8)
        }
        .frame(width: width, height: 19, alignment: .topLeading)
        .accessibilityLabel(Text("\(label) \(Fmt.tokensFull(value)) tokens"))
    }
}

// MARK: 14-day bar chart

/// 14 chunky bars (8pt wide, 4pt gap) with today in teal + 1px ink cap. Bars
/// snap to new values; there is no tweening.
struct TokenBarChart: View {
    let daily: [DailyPoint]
    var maxHeight: CGFloat = 56
    var barWidth: CGFloat = 8
    var gap: CGFloat = 4

    private var values: [Int] { daily.suffix(14).map(\.totalTokens) }
    private var maxValue: Int { max(values.max() ?? 0, 1) }

    var body: some View {
        Canvas { context, size in
            let count = values.count
            guard count > 0 else { return }
            let baseline = size.height
            for (index, value) in values.enumerated() {
                let isToday = index == count - 1
                let x = CGFloat(index) * (barWidth + gap)
                let ratio = CGFloat(value) / CGFloat(maxValue)
                let rawHeight = value == 0 ? 2 : max(2, (ratio * maxHeight).rounded())
                let barHeight = min(maxHeight, rawHeight)
                let rect = CGRect(x: x, y: baseline - barHeight, width: barWidth, height: barHeight)
                if isToday {
                    context.fill(Path(rect), with: .color(DS.Palette.teal))
                    // 1px ink cap on the today bar.
                    context.fill(
                        Path(CGRect(x: x, y: baseline - barHeight, width: barWidth, height: 1)),
                        with: .color(DS.Palette.ink)
                    )
                } else {
                    context.fill(Path(rect), with: .color(DS.Palette.surfaceAlt))
                    // `border` 1px top edge for the inactive bars.
                    context.fill(
                        Path(CGRect(x: x, y: baseline - barHeight, width: barWidth, height: 1)),
                        with: .color(DS.Palette.border)
                    )
                }
            }
        }
        .frame(width: CGFloat(values.count) * barWidth + CGFloat(max(values.count - 1, 0)) * gap, height: maxHeight)
        .accessibilityLabel(Text("Token usage for the last \(values.count) days"))
    }

    var barTotalWidth: CGFloat {
        CGFloat(values.count) * barWidth + CGFloat(max(values.count - 1, 0)) * gap
    }
}

// MARK: Model row

/// Top-model row: 12x12 rank chip, name, 140x8 segmented bar, tokens, share.
struct ModelRow: View {
    let rank: Int
    let model: Breakdown
    var accent: Color = DS.Palette.teal
    var nameWidth: CGFloat = 160
    var barWidth: CGFloat = 140

    var body: some View {
        ZStack(alignment: .topLeading) {
            ZStack(alignment: .topLeading) {
                PixelPanel(
                    fill: DS.Palette.surfaceAlt,
                    border: accent,
                    highlight: accent.opacity(0.4),
                    showsShadow: false
                )
                PixelText(
                    text: "\(rank)",
                    size: DS.FontSize.micro,
                    color: accent,
                    width: 12,
                    alignment: .center
                )
                .offset(y: 3)
            }
            .frame(width: 12, height: 12)
            .offset(x: 12, y: 5)

            PixelText(
                text: PixelText.truncate(model.label, maxCharacters: 22),
                size: DS.FontSize.micro,
                color: DS.Palette.ink,
                width: nameWidth,
                alignment: .leading
            )
            .offset(x: 32, y: 8)

            PixelSegmentedBar(
                ratio: model.share > 0 ? model.share : 0,
                color: accent,
                height: 8,
                segments: nil,
                gap: 2
            )
            .frame(width: barWidth, height: 8)
            .offset(x: 200, y: 7)

            PixelText(
                text: Fmt.tokens(model.totalTokens),
                size: DS.FontSize.micro,
                color: DS.Palette.ink,
                width: 44,
                alignment: .trailing
            )
            .offset(x: 348, y: 8)

            PixelText(
                text: Fmt.percent(model.share),
                size: DS.FontSize.micro,
                color: DS.Palette.inkDim,
                width: 30,
                alignment: .trailing
            )
            .offset(x: 406, y: 8)
        }
        .frame(width: 424, height: 22, alignment: .topLeading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text("\(model.label), \(Fmt.tokensFull(model.totalTokens)) tokens, \(Fmt.percent(model.share))"))
    }
}

// MARK: Live session row

/// Live session row: blink dot, project, model, tokens, relative time.
struct LiveSessionRow: View {
    let session: LiveSession
    let now: Double
    var animated: Bool = true

    private var project: String {
        // Presentation-only: transliterate non-ASCII project names, then clamp
        // to ~18 characters / the fixed row width.
        let label = Fmt.projectLabel(session.project)
        return PixelText.truncate(
            PixelText.truncate(label, maxCharacters: 18),
            toWidth: 170,
            size: DS.FontSize.micro
        )
    }

    private var model: String {
        PixelText.truncate(session.model.isEmpty ? "UNKNOWN MODEL" : session.model, toWidth: 116, size: DS.FontSize.micro)
    }

    var body: some View {
        ZStack(alignment: .topLeading) {
            LiveDot(active: session.active, animated: animated)
                .offset(x: 12, y: 8)

            PixelText(text: project, size: DS.FontSize.micro, color: DS.Palette.ink)
                .offset(x: 26, y: 8)

            PixelText(text: model, size: DS.FontSize.micro, color: DS.Palette.inkDim)
                .offset(x: 204, y: 8)

            PixelText(
                text: Fmt.tokens(session.totalTokens),
                size: DS.FontSize.micro,
                color: DS.Palette.ink,
                width: 50,
                alignment: .trailing
            )
            .offset(x: 330, y: 8)

            PixelText(
                text: Fmt.relativeCompact(session.updatedAt, now: now),
                size: DS.FontSize.micro,
                color: DS.Palette.inkDim,
                width: 50,
                alignment: .trailing
            )
            .offset(x: 386, y: 8)
        }
        .frame(width: 424, height: 22, alignment: .topLeading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text("\(session.project), \(session.model), \(Fmt.tokensFull(session.totalTokens)) tokens"))
    }
}

// MARK: Section helpers

/// Empty-state line used by models / sessions sections.
struct EmptyStateLine: View {
    let text: String

    var body: some View {
        PixelText(text: text, size: DS.FontSize.micro, color: DS.Palette.inkFaint, tracking: DS.Tracking.label)
            .frame(height: 22, alignment: .top)
    }
}
