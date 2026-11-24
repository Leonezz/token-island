import SwiftUI

// MARK: - Expanded Notch-Attached Interactive Telemetry Panel (580 x 568)
//
// Interactive capabilities:
//  1. Click any bar in the 14-Day Activity chart to focus that day's KPIs,
//     In/Cache/Out token split, and breakdowns (click again or "Today ↩" to reset)
//  2. Switch dimensions across Models · Agent Apps · Projects
//  3. Click any Model / Agent App / Project row to expand its inline detail
//     drawer (token split + cost + turns + nested sub-breakdowns)

struct ExpandedView: View {
    let summary: Summary
    let status: IslandStatus
    let offline: Bool
    let pinned: Bool
    let port: Int
    let now: Double
    let toast: String?
    var serverMode: ServerMode = .local
    var endpointCaption: String = ""
    var notchSize: CGSize = DS.Size.collapsed
    var panelWidth: CGFloat = DS.Size.expandedWidth
    var animated: Bool = true
    var onPinToggle: () -> Void = {}

    @State private var selectedDate: String?
    @State private var hoveredDate: String?
    @State private var selectedDimension: BreakdownDimension = .models
    @State private var expandedItemKey: String?

    private var days14: [DailyPoint] { summary.last14Days }

    private var maxDaily: Int {
        days14.map(\.totalTokens).max() ?? 0
    }

    private var focusedPoint: DailyPoint? {
        guard let selectedDate else { return nil }
        return days14.first(where: { $0.date == selectedDate })
    }

    private var activeTotalTokens: Int {
        focusedPoint?.totalTokens ?? summary.today.totalTokens
    }

    private var activeInputTokens: Int {
        focusedPoint?.inputTokens ?? summary.today.inputTokens
    }

    private var activeCacheTokens: Int {
        focusedPoint?.cacheReadTokens ?? summary.today.cacheReadTokens
    }

    private var activeOutputTokens: Int {
        focusedPoint?.outputTokens ?? summary.today.outputTokens
    }

    private var activeCostUsd: Double {
        focusedPoint?.costUsd ?? summary.today.costUsd
    }

    private var activeTurns: Int {
        focusedPoint?.messages ?? summary.today.messages
    }

    private var activeDelta: Double? {
        if let point = focusedPoint {
            return summary.delta(forDate: point.date)
        }
        return summary.todayDelta
    }

    private func breakdowns(for dimension: BreakdownDimension) -> [Breakdown] {
        if let point = focusedPoint {
            switch dimension {
            case .models: return point.models
            case .agents: return point.sources
            case .projects: return point.projects
            }
        }
        // Default Today view: prefer Today's DailyPoint breakdowns if populated,
        // otherwise fall back to summary-level breakdowns.
        if let todayPoint = days14.last,
           (!todayPoint.models.isEmpty || !todayPoint.sources.isEmpty || !todayPoint.projects.isEmpty) {
            switch dimension {
            case .models: return todayPoint.models
            case .agents: return todayPoint.sources
            case .projects: return todayPoint.projects
            }
        }
        switch dimension {
        case .models: return summary.models
        case .agents: return summary.sources
        case .projects: return summary.projects
        }
    }

    private var dimensionCounts: [BreakdownDimension: Int] {
        [
            .models: breakdowns(for: .models).count,
            .agents: breakdowns(for: .agents).count,
            .projects: breakdowns(for: .projects).count,
        ]
    }

    private var hasSyncError: Bool {
        summary.collector.cloud.enabled && summary.collector.cloud.lastError != nil
    }

    /// Height of the top bar, guaranteed >= hardware notch height + 6pt clearance.
    private var notchBarHeight: CGFloat {
        max(40, notchSize.height > 12 ? notchSize.height + 6 : 40)
    }

    /// Center exclusion zone reserved for the physical camera cutout.
    private var notchExclusionWidth: CGFloat {
        notchSize.height > 12 ? max(204, notchSize.width + 20) : 40
    }

    private var effectiveEndpointCaption: String {
        endpointCaption.isEmpty ? "127.0.0.1:\(port)" : endpointCaption
    }

    private var cloudSyncLabel: String {
        if offline { return "Offline" }
        if serverMode == .remote {
            if let user = summary.collector.cloud.username, !user.isEmpty {
                return "Remote · @\(user)"
            }
            return "Remote"
        }
        let cloud = summary.collector.cloud
        guard cloud.enabled else { return "Local" }
        if hasSyncError { return "Sync error" }
        guard let lastSync = cloud.lastSyncAt else { return "Unsynced" }
        let relative = Fmt.relativeCompact(lastSync, now: now)
        return relative == "now" ? "Synced now" : "Synced \(relative)"
    }

    var body: some View {
        let borderColor = offline ? DS.Palette.amber.opacity(0.65) : DS.Palette.borderHi
        let shape = NotchAttachedShape(bottomRadius: DS.Space.bottomCorner)

        ZStack(alignment: .bottom) {
            NotchAttachedPanel(border: borderColor, bottomRadius: DS.Space.bottomCorner)

            VStack(alignment: .leading, spacing: 0) {
                notchSafeHeader

                PixelDivider(color: DS.Palette.border.opacity(0.85))

                VStack(alignment: .leading, spacing: 11) {
                    heroSection

                    ProportionalSplitBar(
                        inputTokens: activeInputTokens,
                        cacheReadTokens: activeCacheTokens,
                        outputTokens: activeOutputTokens
                    )

                    chartCard

                    breakdownSection
                }
                .padding(.horizontal, DS.Space.expandedPadding)
                .padding(.top, 12)
                .padding(.bottom, 10)
                .frame(maxHeight: .infinity, alignment: .top)

                sessionsBand

                footerRow
            }

            if let toast {
                PixelToast(text: toast)
                    .padding(.bottom, 44)
                    .transition(.opacity)
            }
        }
        .frame(width: panelWidth, height: DS.Size.expandedHeight, alignment: .topLeading)
        .clipShape(shape)
        .overlay(
            NotchAttachedBorder(bottomRadius: DS.Space.bottomCorner)
                .stroke(borderColor, lineWidth: 1)
        )
        .onChange(of: selectedDimension) { _ in
            expandedItemKey = nil
        }
        .onChange(of: selectedDate) { _ in
            expandedItemKey = nil
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Token Island expanded panel"))
    }

    // MARK: 1. Notch-Safe Split Header (Left Wing | Camera Cutout | Right Wing)

    private var notchSafeHeader: some View {
        let wingWidth = max(120, (panelWidth - notchExclusionWidth) / 2 - DS.Space.expandedPadding)

        return HStack(spacing: 0) {
            HStack(spacing: 8) {
                Text("Token Island")
                    .font(DS.Typography.sans(13, weight: .semibold))
                    .foregroundColor(DS.Palette.ink)
                    .lineLimit(1)

                StatusBadge(status: status, animated: animated)

                Spacer(minLength: 0)
            }
            .frame(width: wingWidth, alignment: .leading)

            Spacer()
                .frame(width: notchExclusionWidth)

            HStack(spacing: 8) {
                Spacer(minLength: 0)

                Text(cloudSyncLabel)
                    .font(DS.Typography.sans(11.5, weight: .medium))
                    .foregroundColor(offline ? DS.Palette.amber : (hasSyncError ? DS.Palette.red : DS.Palette.inkDim))
                    .lineLimit(1)

                Button(action: onPinToggle) {
                    Text(pinned ? "Pinned" : "Pin")
                        .font(DS.Typography.sans(11.5, weight: .semibold))
                        .foregroundColor(pinned ? DS.Palette.teal : DS.Palette.inkDim)
                        .padding(.horizontal, 9)
                        .padding(.vertical, 3)
                        .background(
                            RoundedRectangle(cornerRadius: DS.Space.smallCorner, style: .continuous)
                                .fill(pinned ? DS.Palette.teal.opacity(0.15) : DS.Palette.surfaceAlt)
                        )
                        .overlay(
                            RoundedRectangle(cornerRadius: DS.Space.smallCorner, style: .continuous)
                                .strokeBorder(pinned ? DS.Palette.teal : DS.Palette.border, lineWidth: 1)
                        )
                }
                .buttonStyle(.plain)
                .help(pinned ? "Unpin island" : "Pin island open")
                .accessibilityLabel(Text(pinned ? "Unpin island" : "Pin island open"))
            }
            .frame(width: wingWidth, alignment: .trailing)
        }
        .padding(.horizontal, DS.Space.expandedPadding)
        .frame(width: panelWidth, height: notchBarHeight)
    }

    // MARK: 2. Hero (Today or Focused Day)

    private var heroSection: some View {
        HStack(alignment: .bottom, spacing: 14) {
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 8) {
                    if let point = focusedPoint {
                        Text("Focused · \(Fmt.shortDate(point.date))")
                            .font(DS.Typography.sans(12, weight: .semibold))
                            .foregroundColor(DS.Palette.amber)

                        Button(action: { selectedDate = nil }) {
                            Text("Today ↩")
                                .font(DS.Typography.sans(11, weight: .semibold))
                                .foregroundColor(DS.Palette.teal)
                                .padding(.horizontal, 7)
                                .padding(.vertical, 1.5)
                                .background(
                                    RoundedRectangle(cornerRadius: 4, style: .continuous)
                                        .fill(DS.Palette.teal.opacity(0.14))
                                )
                                .overlay(
                                    RoundedRectangle(cornerRadius: 4, style: .continuous)
                                        .strokeBorder(DS.Palette.teal.opacity(0.55), lineWidth: 1)
                                )
                        }
                        .buttonStyle(.plain)
                    } else {
                        Text(offline ? "Cached Usage (\(effectiveEndpointCaption) offline)" : "Today’s Usage")
                            .font(DS.Typography.sans(12, weight: .medium))
                            .foregroundColor(offline ? DS.Palette.amber : DS.Palette.inkDim)
                            .lineLimit(1)
                    }
                }

                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    Text(Fmt.tokens(activeTotalTokens))
                        .font(DS.Typography.mono(32, weight: .bold))
                        .foregroundColor(DS.Palette.ink)
                    Text(Fmt.tokensFull(activeTotalTokens))
                        .font(DS.Typography.mono(12, weight: .regular))
                        .foregroundColor(DS.Palette.inkFaint)
                }
            }

            Spacer(minLength: 8)

            VStack(alignment: .trailing, spacing: 4) {
                HStack(alignment: .firstTextBaseline, spacing: 5) {
                    Text("Est.")
                        .font(DS.Typography.sans(12, weight: .regular))
                        .foregroundColor(DS.Palette.inkFaint)
                    Text(Fmt.cost(activeCostUsd, approx: true))
                        .font(DS.Typography.mono(DS.FontSize.large, weight: .bold))
                        .foregroundColor(DS.Palette.amber)
                }

                if offline && focusedPoint == nil {
                    Text(serverMode == .remote ? "Check Remote Server URL" : "Auto-starting local collector")
                        .font(DS.Typography.sans(11.5, weight: .medium))
                        .foregroundColor(DS.Palette.amber)
                } else if let delta = activeDelta {
                    let up = delta >= 0
                    HStack(spacing: 4) {
                        Text("\(up ? "↑" : "↓") \(Fmt.percent(abs(delta)))")
                            .font(DS.Typography.mono(11.5, weight: .semibold))
                            .foregroundColor(up ? DS.Palette.green : DS.Palette.red)
                        Text(focusedPoint == nil ? "vs yesterday" : "vs prev day")
                            .font(DS.Typography.sans(11.5, weight: .regular))
                            .foregroundColor(DS.Palette.inkFaint)
                    }
                } else {
                    Text("\(activeTurns) turns recorded")
                        .font(DS.Typography.sans(11.5, weight: .regular))
                        .foregroundColor(DS.Palette.inkFaint)
                }
            }
        }
    }

    // MARK: 3. Interactive 14-Day Activity Card

    private var chartCard: some View {
        let hoveredPoint = hoveredDate.flatMap { d in days14.first(where: { $0.date == d }) }

        return VStack(alignment: .leading, spacing: 7) {
            HStack(spacing: 6) {
                Text("14-Day Activity")
                    .font(DS.Typography.sans(12, weight: .semibold))
                    .foregroundColor(DS.Palette.inkDim)

                Spacer()

                if let hp = hoveredPoint {
                    Text("\(Fmt.compactMonthDay(hp.date)) · \(Fmt.tokens(hp.totalTokens)) · \(Fmt.cost(hp.costUsd, approx: true))")
                        .font(DS.Typography.mono(11.5, weight: .semibold))
                        .foregroundColor(DS.Palette.mint)
                } else {
                    Text("Peak \(Fmt.tokens(maxDaily))")
                        .font(DS.Typography.mono(11.5, weight: .regular))
                        .foregroundColor(DS.Palette.inkFaint)
                    Text("·")
                        .foregroundColor(DS.Palette.inkFaint)
                    Text("Today \(Fmt.tokens(summary.today.totalTokens))")
                        .font(DS.Typography.mono(11.5, weight: .semibold))
                        .foregroundColor(DS.Palette.teal)
                }
            }

            TokenBarChart(
                daily: days14,
                selectedDate: selectedDate,
                hoveredDate: $hoveredDate,
                chartHeight: 50,
                onSelectDate: { tappedDate in
                    let todayKey = days14.last?.date
                    if selectedDate == tappedDate || (selectedDate == nil && tappedDate == todayKey) {
                        selectedDate = nil
                    } else {
                        selectedDate = tappedDate
                    }
                }
            )
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 9)
        .background(
            RoundedRectangle(cornerRadius: DS.Space.cardCorner, style: .continuous)
                .fill(DS.Palette.surfaceAlt)
        )
        .overlay(
            RoundedRectangle(cornerRadius: DS.Space.cardCorner, style: .continuous)
                .strokeBorder(focusedPoint != nil ? DS.Palette.amber.opacity(0.45) : DS.Palette.border, lineWidth: 1)
        )
    }

    // MARK: 4. Interactive Breakdowns (Models | Agent Apps | Projects + Drill-Down)

    private var breakdownSection: some View {
        let rows = breakdowns(for: selectedDimension)

        return VStack(alignment: .leading, spacing: 7) {
            HStack {
                DimensionPicker(selection: $selectedDimension, counts: dimensionCounts)

                Spacer()

                Text("Click row for details")
                    .font(DS.Typography.sans(11, weight: .regular))
                    .foregroundColor(DS.Palette.inkFaint)
            }

            if animated {
                ScrollView(.vertical, showsIndicators: false) {
                    breakdownRowsList(rows: rows)
                }
                .frame(maxHeight: .infinity)
            } else {
                breakdownRowsList(rows: Array(rows.prefix(4)))
                    .frame(maxHeight: .infinity, alignment: .top)
            }
        }
        .frame(maxHeight: .infinity)
    }

    @ViewBuilder
    private func breakdownRowsList(rows: [Breakdown]) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            if rows.isEmpty {
                EmptyStateLine(text: selectedDimension.emptyMessage)
            } else {
                ForEach(Array(rows.enumerated()), id: \.element.key) { index, item in
                    ExpandableBreakdownRow(
                        rank: index + 1,
                        item: item,
                        dimension: selectedDimension,
                        isExpanded: expandedItemKey == item.key,
                        fallbackAccent: DS.Palette.series[index % DS.Palette.series.count],
                        onToggle: {
                            if expandedItemKey == item.key {
                                expandedItemKey = nil
                            } else {
                                expandedItemKey = item.key
                            }
                        }
                    )
                }
            }
        }
    }

    // MARK: 5. Active Sessions Band

    private var sessionsBand: some View {
        let sessions = summary.visibleLiveSessions
        return VStack(alignment: .leading, spacing: 5) {
            if sessions.isEmpty {
                Text(serverMode == .remote ? "Remote telemetry stream active" : "No active coding sessions in the last 10m")
                    .font(DS.Typography.sans(12, weight: .regular))
                    .foregroundColor(DS.Palette.inkFaint)
            } else {
                ForEach(Array(sessions.enumerated()), id: \.offset) { _, session in
                    LiveSessionRow(session: session, now: now, animated: animated)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, DS.Space.expandedPadding)
        .padding(.vertical, 8)
        .background(DS.Palette.surfaceAlt)
        .overlay(PixelDivider(), alignment: .top)
    }

    // MARK: 6. Footer

    private var footerRow: some View {
        HStack(spacing: 14) {
            Text("🔥 \(summary.streak.current)d streak")
                .font(DS.Typography.sans(12, weight: .semibold))
                .foregroundColor(DS.Palette.amber)

            Text("\(activeTurns) turns \(focusedPoint == nil ? "today" : "on day")")
                .font(DS.Typography.sans(12, weight: .medium))
                .foregroundColor(DS.Palette.inkDim)

            Spacer()

            Text(serverMode == .remote ? effectiveEndpointCaption : "Collector \(summary.collector.version)")
                .font(DS.Typography.mono(11.5, weight: .regular))
                .foregroundColor(DS.Palette.inkFaint)
                .lineLimit(1)
        }
        .padding(.horizontal, DS.Space.expandedPadding + 2)
        .frame(height: 35)
        .background(DS.Palette.surface)
        .overlay(PixelDivider(), alignment: .top)
    }
}
