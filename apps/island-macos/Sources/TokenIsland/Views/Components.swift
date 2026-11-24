import SwiftUI

// MARK: - Precision Telemetry Interactive Components (580pt Wide Layout)

enum BreakdownDimension: String, CaseIterable, Identifiable {
    case models
    case agents
    case projects

    var id: String { rawValue }

    var title: String {
        switch self {
        case .models: return "Models"
        case .agents: return "Agent Apps"
        case .projects: return "Projects"
        }
    }

    var emptyMessage: String {
        switch self {
        case .models: return "No model activity recorded for this day"
        case .agents: return "No agent app activity recorded for this day"
        case .projects: return "No project activity recorded for this day"
        }
    }
}

// MARK: Proportional In / Cache / Out Bar

struct ProportionalSplitBar: View {
    let inputTokens: Int
    let cacheReadTokens: Int
    let outputTokens: Int

    private var sum: Int {
        max(1, inputTokens + cacheReadTokens + outputTokens)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
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
            .frame(height: 8)
            .clipShape(RoundedRectangle(cornerRadius: 4, style: .continuous))

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
                .font(DS.Typography.sans(12, weight: .medium))
                .foregroundColor(DS.Palette.inkDim)
            Text(Fmt.tokens(value))
                .font(DS.Typography.mono(12.5, weight: .semibold))
                .foregroundColor(DS.Palette.ink)
        }
    }
}

// MARK: Interactive 14-Day Activity Bar Chart (Click to Focus Day)

struct TokenBarChart: View {
    let daily: [DailyPoint]
    var selectedDate: String?
    @Binding var hoveredDate: String?
    var chartHeight: CGFloat = 54
    var onSelectDate: (String) -> Void = { _ in }

    private var points: [DailyPoint] { Array(daily.suffix(14)) }
    private var maxValue: Int { max(points.map(\.totalTokens).max() ?? 0, 1) }

    var body: some View {
        let items = points
        let peak = maxValue
        let todayDate = items.last?.date

        VStack(spacing: 5) {
            ZStack {
                // Dashed mid-height reference guide
                Canvas { context, size in
                    guard size.width > 0, size.height > 0 else { return }
                    let midY = (size.height * 0.45).rounded() + 0.5
                    var guide = Path()
                    var gx: CGFloat = 0
                    while gx < size.width {
                        guide.move(to: CGPoint(x: gx, y: midY))
                        guide.addLine(to: CGPoint(x: min(size.width, gx + 4), y: midY))
                        gx += 8
                    }
                    context.stroke(guide, with: .color(DS.Palette.borderHi.opacity(0.45)), lineWidth: 1)
                }
                .allowsHitTesting(false)

                HStack(alignment: .bottom, spacing: 6) {
                    ForEach(Array(items.enumerated()), id: \.element.date) { index, point in
                        let isToday = index == items.count - 1
                        let isSelected = selectedDate == point.date
                        let isHovered = hoveredDate == point.date
                        let hasFocusFilter = selectedDate != nil

                        dayBarButton(
                            point: point,
                            peak: peak,
                            isToday: isToday,
                            isSelected: isSelected,
                            isHovered: isHovered,
                            dimmed: hasFocusFilter && !isSelected
                        )
                    }
                }
            }
            .frame(height: chartHeight)

            if let first = items.first?.date, let last = todayDate {
                HStack {
                    Text(Fmt.compactMonthDay(first))
                        .font(DS.Typography.mono(10.5, weight: .regular))
                        .foregroundColor(DS.Palette.inkFaint)

                    Spacer()

                    if let focused = selectedDate {
                        Text("Focused \(Fmt.compactMonthDay(focused)) · click again to reset")
                            .font(DS.Typography.sans(10.5, weight: .medium))
                            .foregroundColor(DS.Palette.amber)
                    } else {
                        Text("Click any bar to inspect that day")
                            .font(DS.Typography.sans(10.5, weight: .regular))
                            .foregroundColor(DS.Palette.inkFaint)
                    }

                    Spacer()

                    Text(selectedDate == last ? "Today ●" : "Today")
                        .font(DS.Typography.mono(10.5, weight: .semibold))
                        .foregroundColor(DS.Palette.teal)
                }
            }
        }
        .accessibilityLabel(Text("Interactive token usage chart for the last \(items.count) days"))
    }

    private func dayBarButton(
        point: DailyPoint,
        peak: Int,
        isToday: Bool,
        isSelected: Bool,
        isHovered: Bool,
        dimmed: Bool
    ) -> some View {
        let ratio = point.totalTokens > 0 ? CGFloat(point.totalTokens) / CGFloat(peak) : 0
        let barHeight = point.totalTokens > 0 ? max(4, (ratio * chartHeight).rounded()) : 0
        let fillColor: Color = {
            if isSelected { return DS.Palette.amber }
            if isHovered { return isToday ? DS.Palette.mint : DS.Palette.blue }
            return isToday ? DS.Palette.teal : DS.Palette.blue.opacity(0.78)
        }()

        return Button(action: { onSelectDate(point.date) }) {
            ZStack(alignment: .bottom) {
                RoundedRectangle(cornerRadius: 3.5, style: .continuous)
                    .fill(isSelected || isHovered ? DS.Palette.surface : DS.Palette.inset.opacity(0.72))
                    .overlay(
                        RoundedRectangle(cornerRadius: 3.5, style: .continuous)
                            .strokeBorder(
                                isSelected ? DS.Palette.amber.opacity(0.85) : (isHovered ? DS.Palette.borderHi : .clear),
                                lineWidth: 1
                            )
                    )

                if barHeight > 0 {
                    RoundedRectangle(cornerRadius: 3, style: .continuous)
                        .fill(fillColor)
                        .opacity(dimmed ? 0.34 : 1.0)
                        .frame(height: barHeight)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { inside in
            if inside {
                hoveredDate = point.date
            } else if hoveredDate == point.date {
                hoveredDate = nil
            }
        }
        .help("\(point.date): \(Fmt.tokens(point.totalTokens)) tokens · \(Fmt.cost(point.costUsd, approx: true))")
        .accessibilityLabel(Text("\(point.date), \(Fmt.tokensFull(point.totalTokens)) tokens"))
    }
}

// MARK: Dimension Segmented Switcher (Models | Agent Apps | Projects)

struct DimensionPicker: View {
    @Binding var selection: BreakdownDimension
    let counts: [BreakdownDimension: Int]

    var body: some View {
        HStack(spacing: 3) {
            ForEach(BreakdownDimension.allCases) { dimension in
                let isSelected = selection == dimension
                let count = counts[dimension] ?? 0
                Button(action: { selection = dimension }) {
                    HStack(spacing: 5) {
                        Text(dimension.title)
                            .font(DS.Typography.sans(11.5, weight: isSelected ? .semibold : .medium))
                            .foregroundColor(isSelected ? DS.Palette.ink : DS.Palette.inkDim)
                        if count > 0 {
                            Text("\(count)")
                                .font(DS.Typography.mono(10.5, weight: .semibold))
                                .foregroundColor(isSelected ? DS.Palette.teal : DS.Palette.inkFaint)
                        }
                    }
                    .padding(.horizontal, 9)
                    .padding(.vertical, 4)
                    .background(
                        RoundedRectangle(cornerRadius: 6, style: .continuous)
                            .fill(isSelected ? DS.Palette.surfaceAlt : .clear)
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 6, style: .continuous)
                            .strokeBorder(isSelected ? DS.Palette.borderHi : .clear, lineWidth: 1)
                    )
                }
                .buttonStyle(.plain)
            }
        }
        .padding(2)
        .background(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(DS.Palette.inset)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .strokeBorder(DS.Palette.border, lineWidth: 1)
        )
    }
}

// MARK: Expandable Breakdown Row + Inline Detail Drawer

struct ExpandableBreakdownRow: View {
    let rank: Int
    let item: Breakdown
    let dimension: BreakdownDimension
    let isExpanded: Bool
    var fallbackAccent: Color = DS.Palette.teal
    var onToggle: () -> Void

    @State private var isHovered = false

    private var accent: Color {
        Color.fromHexString(item.color) ?? fallbackAccent
    }

    private var displayTitle: String {
        switch dimension {
        case .projects:
            return Fmt.cleanProjectLabel(item.label)
        case .models, .agents:
            return item.label.isEmpty ? "unknown" : item.label
        }
    }

    private var hasSplit: Bool {
        guard let i = item.inputTokens, let c = item.cacheReadTokens, let o = item.outputTokens else {
            return false
        }
        return (i + c + o) > 0
    }

    private var primarySubSection: (title: String, rows: [BreakdownDetail])? {
        switch dimension {
        case .models:
            return item.sources.isEmpty ? nil : ("Agent Apps", item.sources)
        case .agents:
            return item.models.isEmpty ? nil : ("Models", item.models)
        case .projects:
            return item.models.isEmpty ? nil : ("Models", item.models)
        }
    }

    private var secondarySubSection: (title: String, rows: [BreakdownDetail])? {
        switch dimension {
        case .models:
            return item.projects.isEmpty ? nil : ("Projects", item.projects)
        case .agents:
            return item.projects.isEmpty ? nil : ("Projects", item.projects)
        case .projects:
            return item.sources.isEmpty ? nil : ("Agent Apps", item.sources)
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button(action: onToggle) {
                HStack(spacing: 8) {
                    Text(isExpanded ? "▾" : "▸")
                        .font(DS.Typography.mono(11, weight: .bold))
                        .foregroundColor(isExpanded ? accent : DS.Palette.inkFaint)
                        .frame(width: 12)

                    Circle()
                        .fill(accent)
                        .frame(width: 7, height: 7)

                    Text(displayTitle)
                        .font(dimension == .models ? DS.Typography.mono(12.5, weight: .medium) : DS.Typography.sans(12.5, weight: .medium))
                        .foregroundColor(DS.Palette.ink)
                        .lineLimit(1)
                        .truncationMode(dimension == .projects ? .middle : .tail)
                        .frame(maxWidth: .infinity, alignment: .leading)

                    GeometryReader { proxy in
                        let fillWidth = max(4, proxy.size.width * CGFloat(min(1, max(0, item.share))))
                        ZStack(alignment: .leading) {
                            Capsule().fill(DS.Palette.inset)
                            Capsule().fill(accent).frame(width: fillWidth)
                        }
                    }
                    .frame(width: 112, height: 6)

                    Text(Fmt.tokens(item.totalTokens))
                        .font(DS.Typography.mono(12.5, weight: .semibold))
                        .foregroundColor(DS.Palette.ink)
                        .frame(width: 56, alignment: .trailing)

                    Text(Fmt.percent(item.share))
                        .font(DS.Typography.mono(11.5, weight: .regular))
                        .foregroundColor(DS.Palette.inkFaint)
                        .frame(width: 42, alignment: .trailing)
                }
                .padding(.horizontal, 8)
                .frame(height: 26)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .onHover { inside in isHovered = inside }

            if isExpanded {
                detailDrawer
            }
        }
        .background(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(isExpanded ? DS.Palette.surfaceAlt : (isHovered ? DS.Palette.surfaceAlt.opacity(0.55) : .clear))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .strokeBorder(isExpanded ? DS.Palette.borderHi : .clear, lineWidth: 1)
        )
        .accessibilityElement(children: .contain)
    }

    private var detailDrawer: some View {
        VStack(alignment: .leading, spacing: 8) {
            PixelDivider(color: DS.Palette.border.opacity(0.8))

            // Token Split + Cost + Turns strip
            HStack(spacing: 12) {
                if hasSplit {
                    miniCounter(label: "In", value: Fmt.tokens(item.inputTokens ?? 0), color: DS.Palette.teal)
                    miniCounter(label: "Cache", value: Fmt.tokens(item.cacheReadTokens ?? 0), color: DS.Palette.blue)
                    miniCounter(label: "Out", value: Fmt.tokens(item.outputTokens ?? 0), color: DS.Palette.amber)
                } else {
                    miniCounter(label: "Total", value: Fmt.tokensFull(item.totalTokens), color: accent)
                }

                Spacer(minLength: 6)

                Text(Fmt.cost(item.costUsd, approx: true))
                    .font(DS.Typography.mono(11.5, weight: .semibold))
                    .foregroundColor(DS.Palette.amber)

                if item.messages > 0 {
                    Text("\(item.messages) turns")
                        .font(DS.Typography.mono(11, weight: .regular))
                        .foregroundColor(DS.Palette.inkDim)
                }
            }

            if let primary = primarySubSection {
                subBreakdownGroup(title: primary.title, rows: Array(primary.rows.prefix(4)))
            }

            if let secondary = secondarySubSection {
                subBreakdownGroup(title: secondary.title, rows: Array(secondary.rows.prefix(4)))
            }
        }
        .padding(.horizontal, 10)
        .padding(.bottom, 9)
        .padding(.top, 2)
    }

    private func miniCounter(label: String, value: String, color: Color) -> some View {
        HStack(spacing: 4) {
            Circle()
                .fill(color)
                .frame(width: 5.5, height: 5.5)
            Text(label)
                .font(DS.Typography.sans(11, weight: .regular))
                .foregroundColor(DS.Palette.inkFaint)
            Text(value)
                .font(DS.Typography.mono(11.5, weight: .semibold))
                .foregroundColor(DS.Palette.ink)
        }
    }

    private func subBreakdownGroup(title: String, rows: [BreakdownDetail]) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title.uppercased())
                .font(DS.Typography.sans(10, weight: .semibold))
                .tracking(0.5)
                .foregroundColor(DS.Palette.inkFaint)

            ForEach(Array(rows.enumerated()), id: \.element.key) { index, child in
                let childColor = Color.fromHexString(child.color)
                    ?? DS.Palette.series[(index + 1) % DS.Palette.series.count]

                HStack(spacing: 8) {
                    RoundedRectangle(cornerRadius: 2, style: .continuous)
                        .fill(childColor)
                        .frame(width: 5, height: 5)

                    Text(Fmt.cleanProjectLabel(child.label))
                        .font(DS.Typography.mono(11.5, weight: .regular))
                        .foregroundColor(DS.Palette.inkDim)
                        .lineLimit(1)
                        .truncationMode(.middle)
                        .frame(maxWidth: .infinity, alignment: .leading)

                    GeometryReader { proxy in
                        let w = max(3, proxy.size.width * CGFloat(min(1, max(0, child.share))))
                        ZStack(alignment: .leading) {
                            Capsule().fill(DS.Palette.inset)
                            Capsule().fill(childColor.opacity(0.85)).frame(width: w)
                        }
                    }
                    .frame(width: 76, height: 4.5)

                    Text(Fmt.tokens(child.totalTokens))
                        .font(DS.Typography.mono(11.5, weight: .medium))
                        .foregroundColor(DS.Palette.ink)
                        .frame(width: 50, alignment: .trailing)

                    Text(Fmt.percent(child.share))
                        .font(DS.Typography.mono(11, weight: .regular))
                        .foregroundColor(DS.Palette.inkFaint)
                        .frame(width: 38, alignment: .trailing)
                }
                .frame(height: 18)
            }
        }
        .padding(.top, 2)
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

    private var agentLabel: String {
        session.source.displayLabel
    }

    private var agentColor: Color {
        Color.fromHexString(session.source.brandHex) ?? DS.Palette.teal
    }

    private var modelName: String {
        session.model.isEmpty ? "unknown" : session.model
    }

    var body: some View {
        HStack(spacing: 8) {
            Circle()
                .fill(session.active ? DS.Palette.teal : DS.Palette.inkFaint)
                .frame(width: 7, height: 7)

            Text(agentLabel)
                .font(DS.Typography.sans(11, weight: .semibold))
                .foregroundColor(agentColor)
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .background(
                    RoundedRectangle(cornerRadius: 4, style: .continuous)
                        .fill(agentColor.opacity(0.14))
                )

            Text(project)
                .font(DS.Typography.sans(12, weight: .medium))
                .foregroundColor(DS.Palette.ink)
                .lineLimit(1)
                .truncationMode(.middle)

            Text(modelName)
                .font(DS.Typography.mono(11, weight: .regular))
                .foregroundColor(DS.Palette.inkDim)
                .lineLimit(1)
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .background(
                    RoundedRectangle(cornerRadius: 5, style: .continuous)
                        .fill(DS.Palette.surface)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 5, style: .continuous)
                        .strokeBorder(DS.Palette.border, lineWidth: 1)
                )

            Spacer(minLength: 6)

            Text(Fmt.tokens(session.totalTokens))
                .font(DS.Typography.mono(12, weight: .semibold))
                .foregroundColor(DS.Palette.ink)

            Text(Fmt.relativeCompact(session.updatedAt, now: now))
                .font(DS.Typography.mono(11.5, weight: .regular))
                .foregroundColor(DS.Palette.inkFaint)
                .frame(width: 34, alignment: .trailing)
        }
        .frame(height: 22)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text("\(agentLabel), \(project), \(modelName), \(Fmt.tokensFull(session.totalTokens)) tokens"))
    }
}

struct EmptyStateLine: View {
    let text: String

    var body: some View {
        Text(text)
            .font(DS.Typography.sans(12.5, weight: .regular))
            .foregroundColor(DS.Palette.inkFaint)
            .frame(maxWidth: .infinity, alignment: .leading)
            .frame(height: 26)
    }
}
