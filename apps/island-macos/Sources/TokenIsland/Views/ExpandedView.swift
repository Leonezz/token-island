import SwiftUI

// MARK: - Expanded Precision Telemetry Panel (448 x 408)
//
// Structured high-legibility layout:
//  1. Header: Wordmark + Live/Offline pill + Cloud sync readout + Pin button
//  2. Optional Offline Diagnostic Banner (keeps cached data at 100% contrast)
//  3. Hero: 28pt tabular-mono Today tokens + exact count + Est. spend + Delta
//  4. Proportional In / Cache / Out split bar + aligned counts
//  5. Full-width 14-Day Activity card (Peak + Today callouts)
//  6. Top Models Today (3 rows, natural lowercase monospace IDs)
//  7. Active Sessions + Streak / Turns / Collector Footer

struct ExpandedView: View {
    let summary: Summary
    let status: IslandStatus
    let offline: Bool
    let pinned: Bool
    let port: Int
    let now: Double
    let toast: String?
    var animated: Bool = true
    var onPinToggle: () -> Void = {}

    private var maxDaily: Int {
        summary.last14Days.map(\.totalTokens).max() ?? 0
    }

    private var hasSyncError: Bool {
        summary.collector.cloud.enabled && summary.collector.cloud.lastError != nil
    }

    private var cloudSyncLabel: String {
        let cloud = summary.collector.cloud
        if offline {
            return "Collector 127.0.0.1:\(port) unreachable"
        }
        guard cloud.enabled else { return "Local only" }
        if hasSyncError { return "Sync error" }
        guard let lastSync = cloud.lastSyncAt else { return "Not synced" }
        let relative = Fmt.relativeCompact(lastSync, now: now)
        return relative == "now" ? "Synced now" : "Synced \(relative) ago"
    }

    var body: some View {
        ZStack(alignment: .bottom) {
            PixelPanel(
                fill: DS.Palette.surface,
                border: offline ? DS.Palette.amber.opacity(0.65) : DS.Palette.borderHi,
                corner: DS.Space.corner
            )

            VStack(alignment: .leading, spacing: 0) {
                headerRow
                    .padding(.horizontal, DS.Space.expandedPadding)
                    .padding(.top, 12)
                    .padding(.bottom, 10)

                PixelDivider()

                VStack(alignment: .leading, spacing: 11) {
                    heroSection

                    ProportionalSplitBar(
                        inputTokens: summary.today.inputTokens,
                        cacheReadTokens: summary.today.cacheReadTokens,
                        outputTokens: summary.today.outputTokens
                    )

                    chartCard

                    modelsSection
                }
                .padding(.horizontal, DS.Space.expandedPadding)
                .padding(.vertical, 11)

                Spacer(minLength: 0)

                sessionsBand

                footerRow
            }

            if let toast {
                PixelToast(text: toast)
                    .padding(.bottom, 38)
                    .transition(.opacity)
            }
        }
        .frame(width: DS.Size.expandedWidth, height: DS.Size.expandedHeight, alignment: .topLeading)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Token Island expanded panel"))
    }

    // MARK: 1. Header

    private var headerRow: some View {
        HStack(spacing: 8) {
            Text("Token Island")
                .font(DS.Typography.sans(13, weight: .semibold))
                .foregroundColor(DS.Palette.ink)

            StatusBadge(status: status, animated: animated)

            Spacer(minLength: 8)

            Text(cloudSyncLabel)
                .font(DS.Typography.sans(11.5, weight: .medium))
                .foregroundColor(offline ? DS.Palette.amber : (hasSyncError ? DS.Palette.red : DS.Palette.inkDim))
                .lineLimit(1)

            Button(action: onPinToggle) {
                Text(pinned ? "Pinned" : "Pin")
                    .font(DS.Typography.sans(11.5, weight: .medium))
                    .foregroundColor(pinned ? DS.Palette.ink : DS.Palette.inkFaint)
                    .padding(.horizontal, 7)
                    .padding(.vertical, 2)
                    .background(
                        RoundedRectangle(cornerRadius: DS.Space.smallCorner, style: .continuous)
                            .fill(pinned ? DS.Palette.surfaceAlt : .clear)
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: DS.Space.smallCorner, style: .continuous)
                            .strokeBorder(pinned ? DS.Palette.borderHi : DS.Palette.border, lineWidth: 1)
                    )
            }
            .buttonStyle(.plain)
            .help(pinned ? "Unpin island" : "Pin island open")
            .accessibilityLabel(Text(pinned ? "Unpin island" : "Pin island open"))
        }
    }

    // MARK: 2. Hero

    private var heroSection: some View {
        HStack(alignment: .bottom, spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(offline ? "Cached Today’s Usage" : "Today’s Usage")
                    .font(DS.Typography.sans(11.5, weight: .medium))
                    .foregroundColor(offline ? DS.Palette.amber : DS.Palette.inkDim)

                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(Fmt.tokens(summary.today.totalTokens))
                        .font(DS.Typography.mono(DS.FontSize.hero, weight: .bold))
                        .foregroundColor(DS.Palette.ink)
                    Text(Fmt.tokensFull(summary.today.totalTokens))
                        .font(DS.Typography.mono(11.5, weight: .regular))
                        .foregroundColor(DS.Palette.inkFaint)
                }
            }

            Spacer(minLength: 8)

            VStack(alignment: .trailing, spacing: 3) {
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Text("Est.")
                        .font(DS.Typography.sans(11.5, weight: .regular))
                        .foregroundColor(DS.Palette.inkFaint)
                    Text(Fmt.cost(summary.today.costUsd, approx: true))
                        .font(DS.Typography.mono(17, weight: .semibold))
                        .foregroundColor(DS.Palette.amber)
                }

                if offline {
                    Text("Auto-retrying local collector")
                        .font(DS.Typography.sans(11.5, weight: .medium))
                        .foregroundColor(DS.Palette.amber)
                } else if let delta = summary.todayDelta {
                    let up = delta >= 0
                    HStack(spacing: 4) {
                        Text("\(up ? "↑" : "↓") \(Fmt.percent(abs(delta)))")
                            .font(DS.Typography.mono(11.5, weight: .semibold))
                            .foregroundColor(up ? DS.Palette.green : DS.Palette.red)
                        Text("vs yesterday")
                            .font(DS.Typography.sans(11.5, weight: .regular))
                            .foregroundColor(DS.Palette.inkFaint)
                    }
                } else {
                    Text("No baseline yesterday")
                        .font(DS.Typography.sans(11.5, weight: .regular))
                        .foregroundColor(DS.Palette.inkFaint)
                }
            }
        }
    }

    // MARK: 3. Full-Width 14-Day Chart Card

    private var chartCard: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("14-Day Activity")
                    .font(DS.Typography.sans(11.5, weight: .semibold))
                    .foregroundColor(DS.Palette.inkDim)
                Spacer()
                Text("Peak \(Fmt.tokens(maxDaily))")
                    .font(DS.Typography.mono(11, weight: .regular))
                    .foregroundColor(DS.Palette.inkFaint)
                Text("·")
                    .foregroundColor(DS.Palette.inkFaint)
                Text("Today \(Fmt.tokens(summary.today.totalTokens))")
                    .font(DS.Typography.mono(11, weight: .semibold))
                    .foregroundColor(DS.Palette.teal)
            }

            TokenBarChart(daily: summary.last14Days, chartHeight: 42)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(
            RoundedRectangle(cornerRadius: DS.Space.cardCorner, style: .continuous)
                .fill(DS.Palette.surfaceAlt)
        )
        .overlay(
            RoundedRectangle(cornerRadius: DS.Space.cardCorner, style: .continuous)
                .strokeBorder(DS.Palette.border, lineWidth: 1)
        )
    }

    // MARK: 4. Top Models

    private var modelsSection: some View {
        let models = summary.topModels
        return VStack(alignment: .leading, spacing: 5) {
            HStack {
                Text("Top Models Today")
                    .font(DS.Typography.sans(11.5, weight: .semibold))
                    .foregroundColor(DS.Palette.inkDim)
                Spacer()
                Text("Tokens · Share")
                    .font(DS.Typography.sans(11, weight: .regular))
                    .foregroundColor(DS.Palette.inkFaint)
            }

            if models.isEmpty {
                EmptyStateLine(text: "No model activity recorded today")
            } else {
                ForEach(Array(models.enumerated()), id: \.offset) { index, model in
                    ModelRow(
                        rank: index + 1,
                        model: model,
                        accent: DS.Palette.series[index % DS.Palette.series.count]
                    )
                }
            }
        }
    }

    // MARK: 5. Active Sessions Band

    private var sessionsBand: some View {
        let sessions = summary.visibleLiveSessions
        return VStack(alignment: .leading, spacing: 4) {
            if sessions.isEmpty {
                Text("No active coding sessions in the last 10m")
                    .font(DS.Typography.sans(11.5, weight: .regular))
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
        HStack(spacing: 12) {
            Text("🔥 \(summary.streak.current)d streak")
                .font(DS.Typography.sans(11.5, weight: .semibold))
                .foregroundColor(DS.Palette.amber)

            Text("\(summary.today.messages) turns today")
                .font(DS.Typography.sans(11.5, weight: .medium))
                .foregroundColor(DS.Palette.inkDim)

            Spacer()

            Text("Collector \(summary.collector.version)")
                .font(DS.Typography.mono(11, weight: .regular))
                .foregroundColor(DS.Palette.inkFaint)
        }
        .padding(.horizontal, DS.Space.expandedPadding)
        .padding(.vertical, 8)
        .overlay(PixelDivider(), alignment: .top)
    }
}
