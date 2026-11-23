import SwiftUI

// MARK: - Shared island components
//
// Small, composable pieces used by both the collapsed pill and the expanded
// panel. Kept stateless where possible so ImageRenderer snapshots are
// deterministic (no layout that depends on animation phase).

// MARK: Pulse dot

struct PulseDot: View {
    let color: Color
    var size: CGFloat = 7
    var animated: Bool = false

    @State private var pulse = false

    var body: some View {
        Circle()
            .fill(color)
            .frame(width: size, height: size)
            .scaleEffect(animated && pulse ? 1.18 : 0.88)
            .opacity(animated && pulse ? 0.62 : 1.0)
            .shadow(color: color.opacity(animated ? 0.55 : 0.0), radius: 3.5)
            .frame(width: size * 1.5, height: size * 1.5)
            .onAppear(perform: restart)
            .onChange(of: animated) { _ in restart() }
    }

    private func restart() {
        guard animated else {
            pulse = false
            return
        }
        pulse = false
        withAnimation(.easeInOut(duration: DS.Motion.pulse).repeatForever(autoreverses: true)) {
            pulse = true
        }
    }
}

// MARK: Status pill

struct StatusPill: View {
    let status: IslandStatus

    private var color: Color {
        switch status {
        case .live: return DS.Palette.live
        case .idle: return Color.white.opacity(0.42)
        case .offline: return DS.Palette.warning
        }
    }

    var body: some View {
        HStack(spacing: 4) {
            PulseDot(color: color, size: 5, animated: status == .live)
            Text(status.label)
                .font(DS.Fonts.pill)
                .tracking(DS.Tracking.pill)
                .foregroundStyle(color.opacity(0.98))
        }
        .padding(.horizontal, 7)
        .padding(.vertical, 2.5)
        .background(Capsule().fill(color.opacity(0.12)))
        .overlay(Capsule().strokeBorder(color.opacity(0.24), lineWidth: 0.5))
        .accessibilityLabel(Text(status.label + " status"))
    }
}

// MARK: Micro label

struct MicroLabel: View {
    let text: String
    var color: Color = DS.Palette.textTertiary

    var body: some View {
        Text(text.uppercased())
            .font(DS.Fonts.microSmall)
            .tracking(DS.Tracking.micro)
            .foregroundStyle(color)
    }
}

// MARK: Bar shape

/// Classic bar-chart bar: rounded top corners, square base.
struct RoundedTopBar: Shape {
    var radius: CGFloat

    func path(in rect: CGRect) -> Path {
        let radius = min(radius, rect.width / 2, rect.height)
        var path = Path()
        path.move(to: CGPoint(x: rect.minX, y: rect.maxY))
        path.addLine(to: CGPoint(x: rect.minX, y: rect.minY + radius))
        path.addQuadCurve(
            to: CGPoint(x: rect.minX + radius, y: rect.minY),
            control: CGPoint(x: rect.minX, y: rect.minY)
        )
        path.addLine(to: CGPoint(x: rect.maxX - radius, y: rect.minY))
        path.addQuadCurve(
            to: CGPoint(x: rect.maxX, y: rect.minY + radius),
            control: CGPoint(x: rect.maxX, y: rect.minY)
        )
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY))
        path.closeSubpath()
        return path
    }
}

// MARK: Sparkline

/// 14-day bar sparkline; the last (today) bar uses the accent gradient.
struct Sparkline: View {
    let values: [Int]
    var height: CGFloat = 30
    var accent: Color = DS.Palette.tokens
    var highlightLast: Bool = true
    var gap: CGFloat = 4

    private var maxValue: Int { max(values.max() ?? 0, 1) }

    var body: some View {
        GeometryReader { geometry in
            let count = max(values.count, 1)
            let barWidth = max(1, (geometry.size.width - gap * CGFloat(count - 1)) / CGFloat(count))
            HStack(alignment: .bottom, spacing: gap) {
                ForEach(Array(values.enumerated()), id: \.offset) { index, value in
                    let fraction = CGFloat(value) / CGFloat(maxValue)
                    let barHeight = value == 0 ? 2 : max(3, fraction * height)
                    let isToday = highlightLast && index == values.count - 1
                    RoundedTopBar(radius: min(2.5, barWidth * 0.3))
                        .fill(fillForBar(isToday: isToday, isEmpty: value == 0))
                        .frame(width: barWidth, height: barHeight)
                        .shadow(color: isToday ? accent.opacity(0.45) : .clear, radius: 3)
                }
            }
            .frame(width: geometry.size.width, height: height, alignment: .bottomLeading)
            .overlay(alignment: .bottom) {
                Rectangle()
                    .fill(Color.white.opacity(0.06))
                    .frame(height: 0.5)
            }
        }
        .frame(height: height)
        .animation(.easeOut(duration: DS.Motion.chart), value: values)
        .accessibilityLabel(Text("Token usage for the last \(values.count) days"))
    }

    private func fillForBar(isToday: Bool, isEmpty: Bool) -> AnyShapeStyle {
        if isToday {
            return AnyShapeStyle(
                LinearGradient(
                    colors: [accent, accent.opacity(0.62)],
                    startPoint: .top,
                    endPoint: .bottom
                )
            )
        }
        if isEmpty {
            return AnyShapeStyle(DS.Palette.barEmpty)
        }
        return AnyShapeStyle(
            LinearGradient(
                colors: [Color.white.opacity(0.30), Color.white.opacity(0.13)],
                startPoint: .top,
                endPoint: .bottom
            )
        )
    }
}

// MARK: Stacked split bar

struct TokenSplitBar: View {
    let input: Int
    let cache: Int
    let output: Int

    private struct Segment {
        let value: Int
        let color: Color
    }

    private var segments: [Segment] {
        [
            Segment(value: input, color: DS.Palette.splitInput),
            Segment(value: cache, color: DS.Palette.splitCache),
            Segment(value: output, color: DS.Palette.splitOutput),
        ].filter { $0.value > 0 }
    }

    var body: some View {
        GeometryReader { geometry in
            let total = max(segments.reduce(0) { $0 + $1.value }, 1)
            let gap: CGFloat = 2
            let gaps = CGFloat(max(segments.count - 1, 0)) * gap
            let available = max(0, geometry.size.width - gaps)
            HStack(spacing: gap) {
                ForEach(Array(segments.enumerated()), id: \.offset) { _, segment in
                    let width = available * CGFloat(segment.value) / CGFloat(total)
                    RoundedRectangle(cornerRadius: 3, style: .continuous)
                        .fill(
                            LinearGradient(
                                colors: [segment.color.opacity(0.95), segment.color.opacity(0.72)],
                                startPoint: .top,
                                endPoint: .bottom
                            )
                        )
                        .frame(width: max(1.5, width))
                }
            }
            .frame(width: geometry.size.width, alignment: .leading)
        }
        .frame(height: 8)
        .accessibilityLabel(Text("Token split: input \(input), cache \(cache), output \(output)"))
    }
}

// MARK: Legend

struct SplitLegendItem: View {
    let color: Color
    let label: String
    let value: Int

    var body: some View {
        HStack(spacing: 4) {
            RoundedRectangle(cornerRadius: 1.5, style: .continuous)
                .fill(color)
                .frame(width: 5, height: 5)
            Text(label)
                .font(DS.Fonts.microSmall)
                .tracking(0.7)
                .foregroundStyle(DS.Palette.textTertiary)
            Text(Fmt.tokens(value))
                .font(DS.Fonts.value)
                .monospacedDigit()
                .foregroundStyle(color.opacity(0.95))
        }
    }
}

// MARK: Model row

struct ModelRow: View {
    let model: Breakdown

    private var tint: Color {
        Color(hexString: model.color, fallback: DS.Palette.tokens)
    }

    var body: some View {
        HStack(spacing: 8) {
            RoundedRectangle(cornerRadius: 1.5, style: .continuous)
                .fill(tint)
                .frame(width: 3, height: 12)
            Text(Fmt.truncate(model.label, 22))
                .font(DS.Fonts.body)
                .foregroundStyle(DS.Palette.textPrimary.opacity(0.9))
                .lineLimit(1)
            Spacer(minLength: 8)
            Text(Fmt.tokens(model.totalTokens))
                .font(DS.Fonts.value)
                .monospacedDigit()
                .foregroundStyle(DS.Palette.textSecondary)
                .frame(width: 52, alignment: .trailing)
            Text(Fmt.percent(model.share))
                .font(DS.Fonts.caption)
                .monospacedDigit()
                .foregroundStyle(DS.Palette.textTertiary)
                .frame(width: 32, alignment: .trailing)
        }
        .frame(height: 13)
        .accessibilityElement(children: .combine)
    }
}

// MARK: Live session row

struct LiveSessionRow: View {
    let session: LiveSession
    let now: Double
    /// Shown next to the project when two visible sessions share a project.
    var discriminator: String?

    private var tint: Color { SourceMeta.color(session.source.rawValue) }

    /// Short, stable, human-scannable id for a session ("#5I5QN" style suffix).
    static func discriminator(for session: LiveSession) -> String? {
        let identifier = session.sessionId.filter { $0.isLetter || $0.isNumber }
        if identifier.count >= 4 {
            return "#" + String(identifier.suffix(4)).uppercased()
        }
        let model = session.model.filter { $0.isLetter || $0.isNumber }
        guard model.count >= 4 else { return nil }
        return "#" + String(model.suffix(4)).uppercased()
    }

    var body: some View {
        HStack(spacing: 8) {
            PulseDot(color: tint, size: 5.5, animated: session.active)
            VStack(alignment: .leading, spacing: 0.5) {
                HStack(spacing: 4) {
                    Text(session.project.isEmpty ? "unknown project" : session.project)
                        .font(DS.Fonts.body)
                        .foregroundStyle(DS.Palette.textPrimary.opacity(0.88))
                        .lineLimit(1)
                    if let discriminator {
                        Text(discriminator)
                            .font(DS.Fonts.microSmall)
                            .tracking(0.4)
                            .foregroundStyle(DS.Palette.textTertiary)
                            .lineLimit(1)
                            .fixedSize()
                    }
                }
                Text("\(SourceMeta.short(session.source.rawValue)) · \(Fmt.truncate(session.model, 24))")
                    .font(DS.Fonts.microSmall)
                    .foregroundStyle(DS.Palette.textTertiary)
                    .lineLimit(1)
            }
            Spacer(minLength: 6)
            VStack(alignment: .trailing, spacing: 0.5) {
                Text(Fmt.tokens(session.totalTokens))
                    .font(DS.Fonts.value)
                    .monospacedDigit()
                    .foregroundStyle(DS.Palette.textSecondary)
                Text(Fmt.relative(session.updatedAt, now: now))
                    .font(DS.Fonts.microSmall)
                    .foregroundStyle(DS.Palette.textTertiary)
            }
        }
        .frame(height: 23)
        .accessibilityElement(children: .combine)
    }
}

struct EmptySessionsRow: View {
    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "moon.zzz")
                .font(.system(size: 9, weight: .medium))
            Text("No active sessions")
                .font(DS.Fonts.caption)
        }
        .foregroundStyle(DS.Palette.textTertiary)
        .frame(height: 23)
    }
}

// MARK: Toast

struct IslandToast: View {
    let text: String
    var icon: String = "arrow.triangle.2.circlepath"

    var body: some View {
        HStack(spacing: 5) {
            Image(systemName: icon)
                .font(.system(size: 8.5, weight: .semibold))
                .foregroundStyle(DS.Palette.tokens)
            Text(text)
                .font(DS.Fonts.caption)
                .foregroundStyle(DS.Palette.textPrimary.opacity(0.9))
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 5.5)
        .background(Capsule().fill(Color(hex: 0x17171F).opacity(0.97)))
        .overlay(Capsule().strokeBorder(Color.white.opacity(0.10), lineWidth: 0.5))
        .shadow(color: .black.opacity(0.45), radius: 10, y: 4)
    }
}

// MARK: Island background

/// Near-black glass surface with a 1 px inner stroke, a faint top sheen and a
/// soft outer glow (visible in snapshots, where the canvas has padding).
struct IslandBackground: View {
    var radius: CGFloat
    var glow: Bool = true

    var body: some View {
        RoundedRectangle(cornerRadius: radius, style: .continuous)
            .fill(DS.Palette.background.opacity(DS.Palette.backgroundOpacity))
            .overlay(
                RoundedRectangle(cornerRadius: radius, style: .continuous)
                    .fill(DS.Palette.sheen)
                    .opacity(0.6)
            )
            .overlay(
                RoundedRectangle(cornerRadius: radius, style: .continuous)
                    .strokeBorder(DS.Palette.stroke, lineWidth: 1)
            )
            .shadow(color: glow ? DS.Palette.outerGlow : .clear, radius: 24, x: 0, y: 12)
    }
}
