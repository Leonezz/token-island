import SwiftUI

// MARK: - Precision Telemetry Shared Components (580pt Wide Layout)

// MARK: Proportional In / Cache / Out Bar

struct ProportionalSplitBar: View {
    let inputTokens: Int
    let cacheReadTokens: Int
    let outputTokens: Int

    private var sum: Int {
        max(1, inputTokens + cacheReadTokens + outputTokens)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            GeometryReader { proxy in
                let totalWidth = max(12, proxy.size.width)
                let gap: CGFloat = 2.5
                let usable = max(6, totalWidth - gap * 2)
                let inRatio = CGFloat(inputTokens) / CGFloat(sum)
                let cacheRatio = CGFloat(cacheReadTokens) / CGFloat(sum)
                let outRatio = max(0, 1 - inRatio - cacheRatio)

                HStack(spacing: gap) {
                    if inputTokens == 0 && cacheReadTokens == 0 && outputTokens == 0 {
                        RoundedRectangle(cornerRadius: 4, style: .continuous)
                            .fill(DS.Palette.inset)
                    } else {
                        RoundedRectangle(cornerRadius: 2.5, style: .continuous)
                            .fill(DS.Palette.teal)
                            .frame(width: max(5, usable * inRatio))
                        RoundedRectangle(cornerRadius: 2.5, style: .continuous)
                            .fill(DS.Palette.blue)
                            .frame(width: max(5, usable * cacheRatio))
                        RoundedRectangle(cornerRadius: 2.5, style: .continuous)
                            .fill(DS.Palette.amber)
                            .frame(maxWidth: .infinity)
                            .opacity(outRatio > 0 ? 1 : 0.25)
                    }
                }
            }
            .frame(height: 9)
            .clipShape(RoundedRectangle(cornerRadius: 4.5, style: .continuous))

            HStack(spacing: 16) {
                splitLegend(label: "In", value: inputTokens, color: DS.Palette.teal)
                Spacer(minLength: 8)
                splitLegend(label: "Cache", value: cacheReadTokens, color: DS.Palette.blue)
                Spacer(minLength: 8)
                splitLegend(label: "Out", value: outputTokens, color: DS.Palette.amber)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(
            Text("Input \(Fmt.tokensFull(inputTokens)), Cache \(Fmt.tokensFull(cacheReadTokens)), Output \(Fmt.tokensFull(outputTokens)) tokens")
        )
    }

    private func splitLegend(label: String, value: Int, color: Color) -> some View {
        HStack(spacing: 6) {
            RoundedRectangle(cornerRadius: 2.5, style: .continuous)
                .fill(color)
                .frame(width: 8, height: 8)
            Text(label)
                .font(DS.Typography.sans(12.5, weight: .medium))
                .foregroundColor(DS.Palette.inkDim)
            Text(Fmt.tokens(value))
                .font(DS.Typography.mono(13, weight: .semibold))
                .foregroundColor(DS.Palette.ink)
        }
    }
}

// MARK: Full-Width 14-Day Bar Chart

struct TokenBarChart: View {
    let daily: [DailyPoint]
    var chartHeight: CGFloat = 58

    private var values: [Int] { daily.suffix(14).map(\.totalTokens) }
    private var maxValue: Int { max(values.max() ?? 0, 1) }

    var body: some View {
        let points = values
        let peak = maxValue

        GeometryReader { _ in
            Canvas { context, size in
                let count = points.count
                guard count > 0, size.width > 0, size.height > 0 else { return }

                let midY = (size.height * 0.45).rounded() + 0.5
                var guide = Path()
                var gx: CGFloat = 0
                while gx < size.width {
                    guide.move(to: CGPoint(x: gx, y: midY))
                    guide.addLine(to: CGPoint(x: min(size.width, gx + 4), y: midY))
                    gx += 8
                }
                context.stroke(guide, with: .color(DS.Palette.borderHi.opacity(0.55)), lineWidth: 1)

                let gap: CGFloat = 6
                let barWidth = max(4, (size.width - gap * CGFloat(max(0, count - 1))) / CGFloat(count))

                for (index, value) in points.enumerated() {
                    let x = CGFloat(index) * (barWidth + gap)
                    let trackRect = CGRect(x: x, y: 0, width: barWidth, height: size.height)
                    context.fill(
                        Path(roundedRect: trackRect, cornerRadius: 3),
                        with: .color(DS.Palette.inset.opacity(0.70))
                    )

                    guard value > 0 else { continue }
                    let ratio = CGFloat(value) / CGFloat(peak)
                    let barHeight = max(4, (ratio * size.height).rounded())
                    let barRect = CGRect(x: x, y: size.height - barHeight, width: barWidth, height: barHeight)
                    let isToday = index == count - 1
                    context.fill(
                        Path(roundedRect: barRect, cornerRadius: 3),
                        with: .color(isToday ? DS.Palette.teal : DS.Palette.blue.opacity(0.78))
                    )
                }
            }
        }
        .frame(height: chartHeight)
        .accessibilityLabel(Text("Token usage for the last \(values.count) days"))
    }
}

// MARK: Top Model Row

struct ModelRow: View {
    let rank: Int
    let model: Breakdown
    var accent: Color = DS.Palette.teal

    var body: some View {
        HStack(spacing: 10) {
            Text("\(rank)")
                .font(DS.Typography.mono(11.5, weight: .semibold))
                .foregroundColor(DS.Palette.inkDim)
                .frame(width: 20, height: 20)
                .background(
                    RoundedRectangle(cornerRadius: 5, style: .continuous)
                        .fill(DS.Palette.surfaceAlt)
                )

            Text(model.label)
                .font(DS.Typography.mono(13, weight: .medium))
                .foregroundColor(DS.Palette.ink)
                .lineLimit(1)
                .truncationMode(.tail)
                .frame(maxWidth: .infinity, alignment: .leading)

            GeometryReader { proxy in
                let fillWidth = max(4, proxy.size.width * CGFloat(min(1, max(0, model.share))))
                ZStack(alignment: .leading) {
                    Capsule().fill(DS.Palette.inset)
                    Capsule().fill(accent).frame(width: fillWidth)
                }
            }
            .frame(width: 132, height: 7)

            Text(Fmt.tokens(model.totalTokens))
                .font(DS.Typography.mono(13, weight: .semibold))
                .foregroundColor(DS.Palette.ink)
                .frame(width: 56, alignment: .trailing)

            Text(Fmt.percent(model.share))
                .font(DS.Typography.mono(12, weight: .regular))
                .foregroundColor(DS.Palette.inkFaint)
                .frame(width: 42, alignment: .trailing)
        }
        .frame(height: 22)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text("\(model.label), \(Fmt.tokensFull(model.totalTokens)) tokens, \(Fmt.percent(model.share))"))
    }
}

// MARK: Active Session Row

struct LiveSessionRow: View {
    let session: LiveSession
    let now: Double
    var animated: Bool = true

    private var project: String {
        Fmt.cleanProjectLabel(session.project)
    }

    private var modelName: String {
        session.model.isEmpty ? "unknown" : session.model
    }

    var body: some View {
        HStack(spacing: 10) {
            Circle()
                .fill(session.active ? DS.Palette.teal : DS.Palette.inkFaint)
                .frame(width: 7, height: 7)

            Text(project)
                .font(DS.Typography.sans(12.5, weight: .medium))
                .foregroundColor(DS.Palette.ink)
                .lineLimit(1)
                .truncationMode(.middle)

            Text(modelName)
                .font(DS.Typography.mono(11.5, weight: .regular))
                .foregroundColor(DS.Palette.inkDim)
                .lineLimit(1)
                .padding(.horizontal, 7)
                .padding(.vertical, 2)
                .background(
                    RoundedRectangle(cornerRadius: 5, style: .continuous)
                        .fill(DS.Palette.surface)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 5, style: .continuous)
                        .strokeBorder(DS.Palette.border, lineWidth: 1)
                )

            Spacer(minLength: 8)

            Text(Fmt.tokens(session.totalTokens))
                .font(DS.Typography.mono(12.5, weight: .semibold))
                .foregroundColor(DS.Palette.ink)

            Text(Fmt.relativeCompact(session.updatedAt, now: now))
                .font(DS.Typography.mono(12, weight: .regular))
                .foregroundColor(DS.Palette.inkFaint)
                .frame(width: 36, alignment: .trailing)
        }
        .frame(height: 22)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text("\(project), \(modelName), \(Fmt.tokensFull(session.totalTokens)) tokens"))
    }
}

struct EmptyStateLine: View {
    let text: String

    var body: some View {
        Text(text)
            .font(DS.Typography.sans(12.5, weight: .regular))
            .foregroundColor(DS.Palette.inkFaint)
            .frame(maxWidth: .infinity, alignment: .leading)
            .frame(height: 24)
    }
}
