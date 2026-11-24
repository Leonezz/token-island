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
            DotStrip(
                ratio: total > 0 ? Double(value) / Double(total) : 0,
                color: color,
                width: width,
                height: 6
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

/// 14-day dot-matrix column chart (V3 §2.2): each day is a 2-dot-wide column of
/// dots over a faint unlit track grid; today is `teal`, the other days
/// `inkDim`. The slot (164x56 at 8pt column / 4pt gap) and the `14 DAYS` /
/// `MAX …` text labels are unchanged from V2. Bars snap to new values.
struct TokenBarChart: View {
    let daily: [DailyPoint]
    var maxHeight: CGFloat = 56
    var barWidth: CGFloat = 8
    var gap: CGFloat = 4

    /// Dot pitch (integer grid; 56 / 4 = 14 rows).
    private let pitch: CGFloat = 4
    private let dotRadius: CGFloat = 1.6

    private var values: [Int] { daily.suffix(14).map(\.totalTokens) }
    private var maxValue: Int { max(values.max() ?? 0, 1) }

    var body: some View {
        let values = self.values
        let maxValue = self.maxValue
        let pitch = self.pitch
        let dotRadius = self.dotRadius
        let stride = barWidth + gap
        let barWidth = self.barWidth
        let trackRadius = dotRadius * 0.55
        Canvas { context, size in
            let count = values.count
            guard count > 0 else { return }
            let rows = max(1, Int((size.height / pitch).rounded(.down)))

            // Very faint unlit track dots behind every column (matrix feel without noise).
            var track = Path()
            for index in 0..<count {
                let centerX = CGFloat(index) * stride + barWidth / 2
                for row in 0..<rows {
                    let y = size.height - pitch / 2 - CGFloat(row) * pitch
                    for column in 0..<2 {
                        let x = centerX + (CGFloat(column) - 0.5) * pitch
                        track.addEllipse(
                            in: CGRect(
                                x: x - trackRadius,
                                y: y - trackRadius,
                                width: trackRadius * 2,
                                height: trackRadius * 2
                            )
                        )
                    }
                }
            }
            context.fill(track, with: .color(DS.Palette.border.opacity(0.15)))

            // Lit dots per day: today `teal`, the rest `inkDim`.
            for (index, value) in values.enumerated() {
                let isToday = index == count - 1
                let lit = max(
                    1,
                    Int((CGFloat(value) / CGFloat(maxValue) * CGFloat(rows)).rounded())
                )
                let centerX = CGFloat(index) * stride + barWidth / 2
                let radius = isToday ? dotRadius * 1.12 : dotRadius
                var path = Path()
                for row in 0..<min(lit, rows) {
                    let y = size.height - pitch / 2 - CGFloat(row) * pitch
                    for column in 0..<2 {
                        let x = centerX + (CGFloat(column) - 0.5) * pitch
                        path.addEllipse(
                            in: CGRect(x: x - radius, y: y - radius, width: radius * 2, height: radius * 2)
                        )
                    }
                }
                context.fill(
                    path,
                    with: .color(isToday ? DS.Palette.teal : DS.Palette.inkDim)
                )
            }
        }
        .frame(width: barTotalWidth, height: maxHeight)
        .accessibilityLabel(Text("Token usage for the last \(values.count) days"))
    }

    var barTotalWidth: CGFloat {
        CGFloat(values.count) * barWidth + CGFloat(max(values.count - 1, 0)) * gap
    }
}

// MARK: Dot strip (horizontal ratio data mark)

/// Horizontal dot-matrix strip for ratio data marks: the IN/CACHE/OUT split
/// bars and the model-share bars. Two dot rows at an integer pitch with a very
/// faint unlit track, using the same dot rendering as the 14-day chart; the
/// caller keeps its accent colour and the number of lit dots carries the data.
struct DotStrip: View {
    var ratio: Double
    var color: Color
    var width: CGFloat
    var height: CGFloat
    var rows: Int = 2
    var trackOpacity: Double = 0.15

    var body: some View {
        Canvas { context, size in
            guard size.width > 0, size.height > 0 else { return }
            let rows = max(1, self.rows)
            let pitch = size.height / CGFloat(rows)
            let radius = pitch * 0.40
            let count = max(1, Int((size.width / pitch).rounded(.down)))
            let filled = max(0, min(count, Int((ratio * Double(count)).rounded())))
            var track = Path()
            var lit = Path()
            for column in 0..<count {
                let centerX = (CGFloat(column) + 0.5) * pitch
                for row in 0..<rows {
                    let centerY = (CGFloat(row) + 0.5) * pitch
                    let rect = CGRect(
                        x: centerX - radius,
                        y: centerY - radius,
                        width: radius * 2,
                        height: radius * 2
                    )
                    if column < filled {
                        lit.addEllipse(in: rect)
                    } else {
                        track.addEllipse(in: rect)
                    }
                }
            }
            context.fill(track, with: .color(DS.Palette.border.opacity(trackOpacity)))
            context.fill(lit, with: .color(color))
        }
        .frame(width: width, height: height)
        .accessibilityHidden(true)
        .allowsHitTesting(false)
    }
}

// MARK: Collapsed sparkline

/// 7-day dot-matrix sparkline for the collapsed pill (V3 §2.3): 30x12pt at a
/// 3pt pitch, one dot per row, today `teal` and the other days `inkDim`.
struct DotSparkline: View {
    let values: [Int]
    var width: CGFloat = 30
    var height: CGFloat = 12
    var pitch: CGFloat = 3

    var body: some View {
        let values = self.values
        let pitch = self.pitch
        Canvas { context, size in
            let count = values.count
            guard count > 0 else { return }
            let maxValue = max(values.max() ?? 0, 1)
            let rows = max(1, Int((size.height / pitch).rounded(.down)))
            let radius = pitch * 0.36
            let columnWidth = size.width / CGFloat(count)
            for (index, value) in values.enumerated() {
                let isToday = index == count - 1
                let lit = max(
                    1,
                    Int((CGFloat(value) / CGFloat(maxValue) * CGFloat(rows)).rounded())
                )
                let centerX = (CGFloat(index) + 0.5) * columnWidth
                var path = Path()
                for row in 0..<min(lit, rows) {
                    let centerY = size.height - pitch / 2 - CGFloat(row) * pitch
                    path.addEllipse(
                        in: CGRect(x: centerX - radius, y: centerY - radius, width: radius * 2, height: radius * 2)
                    )
                }
                context.fill(path, with: .color(isToday ? DS.Palette.teal : DS.Palette.inkDim))
            }
        }
        .frame(width: width, height: height)
        .accessibilityHidden(true)
        .allowsHitTesting(false)
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

            DotStrip(
                ratio: model.share > 0 ? model.share : 0,
                color: accent,
                width: barWidth,
                height: 8
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
            // LED frame includes 4pt halo padding; centre (15, 11) matches the
            // V2 6pt square dot at offset (12, 8).
            LiveDot(active: session.active, animated: animated)
                .offset(x: 8, y: 4)

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
