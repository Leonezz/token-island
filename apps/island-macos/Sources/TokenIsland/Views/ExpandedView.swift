import SwiftUI

// MARK: - Expanded Notch-Attached Telemetry Panel (580 x 500)
//
//  - Top edge sits at y=0 (flush with screen.frame.maxY, 0pt gap, 0pt top corners)
//  - Header splits cleanly into Left Wing & Right Wing around the measured
//    hardware camera notch so nothing is ever occluded by the notch
//  - Entire panel (including bottom bands) clips cleanly to 24pt rounded bottom
//    corners with a 3-sided U-border

struct ExpandedView: View {
    let summary: Summary
    let status: IslandStatus
    let offline: Bool
    let pinned: Bool
    let port: Int
    let now: Double
    let toast: String?
    var notchSize: CGSize = DS.Size.collapsed
    var panelWidth: CGFloat = DS.Size.expandedWidth
    var animated: Bool = true
    var onPinToggle: () -> Void = {}

    private var maxDaily: Int {
        summary.last14Days.map(\.totalTokens).max() ?? 0
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

    private var cloudSyncLabel: String {
        let cloud = summary.collector.cloud
        if offline { return "Offline" }
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

                VStack(alignment: .leading, spacing: DS.Space.sectionGap) {
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
                .padding(.top, 14)
                .padding(.bottom, 12)

                Spacer(minLength: 0)

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
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Token Island expanded panel"))
    }

    // MARK: 1. Notch-Safe Split Header (Left Wing | Camera Cutout | Right Wing)

    private var notchSafeHeader: some View {
        let wingWidth = max(120, (panelWidth - notchExclusionWidth) / 2 - DS.Space.expandedPadding)

        return HStack(spacing: 0) {
            // Left of hardware notch
            HStack(spacing: 8) {
                Text("Token Island")
                    .font(DS.Typography.sans(13, weight: .semibold))
                    .foregroundColor(DS.Palette.ink)
                    .lineLimit(1)

                StatusBadge(status: status, animated: animated)

                Spacer(minLength: 0)
            }
            .frame(width: wingWidth, alignment: .leading)

            // Center hardware camera cutout exclusion zone (never place UI here)
            Spacer()
                .frame(width: notchExclusionWidth)

            // Right of hardware notch
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

    // MARK: 2. Hero

    private var heroSection: some View {
        HStack(alignment: .bottom, spacing: 16) {
            VStack(alignment: .leading, spacing: 3) {
                Text(offline ? "Cached Today’s Usage (127.0.0.1:\(port) offline)" : "Today’s Usage")
                    .font(DS.Typography.sans(12, weight: .medium))
                    .foregroundColor(offline ? DS.Palette.amber : DS.Palette.inkDim)

                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    Text(Fmt.tokens(summary.today.totalTokens))
                        .font(DS.Typography.mono(DS.FontSize.hero, weight: .bold))
                        .foregroundColor(DS.Palette.ink)
                    Text(Fmt.tokensFull(summary.today.totalTokens))
                        .font(DS.Typography.mono(12.5, weight: .regular))
                        .foregroundColor(DS.Palette.inkFaint)
                }
            }

            Spacer(minLength: 12)

            VStack(alignment: .trailing, spacing: 4) {
                HStack(alignment: .firstTextBaseline, spacing: 5) {
                    Text("Est.")
                        .font(DS.Typography.sans(12, weight: .regular))
                        .foregroundColor(DS.Palette.inkFaint)
                    Text(Fmt.cost(summary.today.costUsd, approx: true))
                        .font(DS.Typography.mono(DS.FontSize.large, weight: .bold))
                        .foregroundColor(DS.Palette.amber)
                }

                if offline {
                    Text("Auto-retrying local collector")
                        .font(DS.Typography.sans(12, weight: .medium))
                        .foregroundColor(DS.Palette.amber)
                } else if let delta = summary.todayDelta {
                    let up = delta >= 0
                    HStack(spacing: 4) {
                        Text("\(up ? "↑" : "↓") \(Fmt.percent(abs(delta)))")
                            .font(DS.Typography.mono(12, weight: .semibold))
                            .foregroundColor(up ? DS.Palette.green : DS.Palette.red)
                        Text("vs yesterday")
                            .font(DS.Typography.sans(12, weight: .regular))
                            .foregroundColor(DS.Palette.inkFaint)
                    }
                } else {
                    Text("No baseline yesterday")
                        .font(DS.Typography.sans(12, weight: .regular))
                        .foregroundColor(DS.Palette.inkFaint)
                }
            }
        }
    }

    // MARK: 3. Full-Width 14-Day Chart Card

    private var chartCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("14-Day Activity")
                    .font(DS.Typography.sans(12, weight: .semibold))
                    .foregroundColor(DS.Palette.inkDim)
                Spacer()
                Text("Peak \(Fmt.tokens(maxDaily))")
                    .font(DS.Typography.mono(11.5, weight: .regular))
                    .foregroundColor(DS.Palette.inkFaint)
                Text("·")
                    .foregroundColor(DS.Palette.inkFaint)
                Text("Today \(Fmt.tokens(summary.today.totalTokens))")
                    .font(DS.Typography.mono(11.5, weight: .semibold))
                    .foregroundColor(DS.Palette.teal)
            }

            TokenBarChart(daily: summary.last14Days, chartHeight: 56)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
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
        return VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("Top Models Today")
                    .font(DS.Typography.sans(12, weight: .semibold))
                    .foregroundColor(DS.Palette.inkDim)
                Spacer()
                Text("Tokens · Share")
                    .font(DS.Typography.sans(11.5, weight: .regular))
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
        return VStack(alignment: .leading, spacing: 5) {
            if sessions.isEmpty {
                Text("No active coding sessions in the last 10m")
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
        .padding(.vertical, 9)
        .background(DS.Palette.surfaceAlt)
        .overlay(PixelDivider(), alignment: .top)
    }

    // MARK: 6. Footer (extra horizontal inset clears 24pt bottom rounded corners)

    private var footerRow: some View {
        HStack(spacing: 14) {
            Text("🔥 \(summary.streak.current)d streak")
                .font(DS.Typography.sans(12, weight: .semibold))
                .foregroundColor(DS.Palette.amber)

            Text("\(summary.today.messages) turns today")
                .font(DS.Typography.sans(12, weight: .medium))
                .foregroundColor(DS.Palette.inkDim)

            Spacer()

            Text("Collector \(summary.collector.version)")
                .font(DS.Typography.mono(11.5, weight: .regular))
                .foregroundColor(DS.Palette.inkFaint)
        }
        .padding(.horizontal, DS.Space.expandedPadding + 2)
        .frame(height: 36)
        .background(DS.Palette.surface)
        .overlay(PixelDivider(), alignment: .top)
    }
}
