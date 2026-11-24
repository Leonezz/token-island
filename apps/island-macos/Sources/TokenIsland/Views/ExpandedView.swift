import SwiftUI

// MARK: - Expanded island (448 x 400)
//
// Contract §1.3 rows, in design points, content inset 12, seven rows separated
// by 7pt of air (20 + 64 + 48 + 74 + 66 + 44 + 16 + 6*7 = 374 = 398 - 24):
//
//   header   y=12   h=20   wordmark / status badge / cloud sync / pin
//   hero     y=39   h=64   today tokens 32pt, TODAY, EST + cost + trend
//   split    y=110  h=48   3x 16-segment bars (teal/blue/purple) + legend row
//   chart    y=165  h=74   14 bars 8x56, today teal + ink cap, MAX label
//   models   y=246  h=66   3 rows: rank chip, name, 140x8 bar, tokens, share
//   sessions y=319  h=44   up to 2 live rows or NO ACTIVE SESSIONS
//   footer   y=370  h=16   2px divider, streak, turns, collector version
//
// Offline keeps the layout: OFFLINE 24pt amber hero, stale data at 45%,
// amber footer with the collector address and AUTO RETRY.

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

    // Layout constants (integer points).
    private let contentX = DS.Space.expandedPadding
    private let contentWidth = DS.Size.expandedWidth - DS.Space.expandedPadding * 2
    private let rightEdge = DS.Size.expandedWidth - DS.Space.expandedPadding

    private let headerY: CGFloat = 12
    private let heroY: CGFloat = 39
    private let splitY: CGFloat = 110
    private let chartY: CGFloat = 165
    private let modelsY: CGFloat = 246
    private let sessionsY: CGFloat = 319
    private let footerY: CGFloat = 370

    private var totalToday: Int {
        let t = summary.today
        let sum = t.inputTokens + t.cacheReadTokens + t.outputTokens
        return max(sum, t.totalTokens)
    }

    private var maxDaily: Int {
        summary.last14Days.map(\.totalTokens).max() ?? 0
    }

    var body: some View {
        ZStack(alignment: .topLeading) {
            PixelPanel(highlight: offline ? DS.Palette.amber.opacity(0.7) : DS.Palette.borderHi)

            header
            hero

            Group {
                splitSection
                chartSection
                modelsSection
                sessionsSection
            }
            .opacity(offline ? 0.45 : 1)

            footer
            toastOverlay
        }
        .frame(width: DS.Size.expandedWidth, height: DS.Size.expandedHeight, alignment: .topLeading)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Token Island expanded panel"))
    }

    // MARK: Header (y 12, h 20)

    private var header: some View {
        let wordmarkWidth = PixelText.metrics("TOKEN ISLAND", size: DS.FontSize.micro, tracking: DS.Tracking.label)
        let badgeX = contentX + wordmarkWidth + 8
        return ZStack(alignment: .topLeading) {
            PixelText(text: "TOKEN ISLAND", size: DS.FontSize.micro, color: DS.Palette.ink, tracking: DS.Tracking.label)
                .offset(x: contentX, y: headerY + 8)

            StatusBadge(status: status)
                .offset(x: badgeX, y: headerY + 2)

            cloudSyncView

            pinButton
        }
        .frame(width: DS.Size.expandedWidth, height: 20, alignment: .topLeading)
    }

    @ViewBuilder
    private var cloudSyncView: some View {
        let label = cloudSyncLabel
        let labelWidth = PixelText.metrics(label, size: DS.FontSize.micro, tracking: 0)
        let labelX = rightEdge - 16 - 6 - labelWidth
        let color: Color = offline ? DS.Palette.amber : (hasSyncError ? DS.Palette.red : DS.Palette.inkDim)
        PixelSpriteView(sprite: .cloud, scale: 2, color: color)
            .offset(x: labelX - 6 - 14, y: headerY + 5)
        PixelText(text: label, size: DS.FontSize.micro, color: color)
            .offset(x: labelX, y: headerY + 8)
    }

    private var hasSyncError: Bool {
        summary.collector.cloud.enabled && summary.collector.cloud.lastError != nil
    }

    private var cloudSyncLabel: String {
        let cloud = summary.collector.cloud
        if offline {
            guard let lastSync = cloud.lastSyncAt else { return "STALE DATA" }
            let relative = Fmt.relativeCompact(lastSync, now: now)
            return relative == "now" ? "STALE DATA" : "STALE \(relative) AGO"
        }
        guard cloud.enabled else { return "LOCAL" }
        guard let lastSync = cloud.lastSyncAt else { return "NOT SYNCED" }
        let relative = Fmt.relativeCompact(lastSync, now: now)
        return relative == "now" ? "SYNCED NOW" : "SYNCED \(relative) AGO"
    }

    private var pinButton: some View {
        Button(action: onPinToggle) {
            PixelSpriteView(
                sprite: .pin,
                scale: 2,
                color: pinned ? DS.Palette.ink : DS.Palette.inkFaint
            )
            .frame(width: 10, height: 12)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .offset(x: rightEdge - 10, y: headerY + 4)
        .help(pinned ? "Unpin island" : "Pin island open")
        .accessibilityLabel(Text(pinned ? "Unpin island" : "Pin island open"))
    }

    // MARK: Hero (y 39, h 64)

    private var hero: some View {
        ZStack(alignment: .topLeading) {
            if offline {
                PixelText(text: "OFFLINE", size: DS.FontSize.body, color: DS.Palette.amber)
                    .offset(x: contentX, y: heroY + 16)
                PixelLabel(text: "STALE DATA", color: DS.Palette.inkDim)
                    .offset(x: contentX, y: heroY + 37)
            } else {
                PixelText(text: Fmt.tokens(summary.today.totalTokens), size: DS.FontSize.large, color: DS.Palette.ink)
                    .offset(x: contentX, y: heroY + 16)
                PixelLabel(text: "TODAY", color: DS.Palette.inkDim)
                    .offset(x: contentX, y: heroY + 40)
            }
            heroRightColumn
        }
        .frame(width: DS.Size.expandedWidth, height: 64, alignment: .topLeading)
    }

    @ViewBuilder
    private var heroRightColumn: some View {
        let costText = offline ? "--" : Fmt.cost(summary.today.costUsd, approx: true)
        let costWidth = PixelText.metrics(costText, size: DS.FontSize.small)
        let costX = rightEdge - costWidth
        let costCapTop: CGFloat = heroY + 20
        let estColor = offline ? DS.Palette.inkFaint : DS.Palette.inkFaint
        let estWidth = PixelText.metrics("EST", size: DS.FontSize.micro, tracking: DS.Tracking.label)
        let estX = costX - 6 - estWidth

        PixelText(text: "EST", size: DS.FontSize.micro, color: estColor, tracking: DS.Tracking.label)
            .offset(x: estX, y: costCapTop + 5)
        PixelText(
            text: costText,
            size: DS.FontSize.small,
            color: offline ? DS.Palette.inkDim : DS.Palette.purple,
            extraTop: 2
        )
        .offset(x: costX, y: costCapTop - 2)

        trendRow
    }

    @ViewBuilder
    private var trendRow: some View {
        if offline {
            let relative = Fmt.relativeCompact(summary.generatedAt, now: now)
            PixelText(
                text: relative == "now" ? "NO LIVE DATA" : "LAST DATA \(relative) AGO",
                size: DS.FontSize.micro,
                color: DS.Palette.amber,
                width: contentWidth,
                alignment: .trailing
            )
            .offset(x: contentX, y: heroY + 40)
        } else if let delta = summary.todayDelta {
            let up = delta >= 0
            let text = "\(Fmt.percent(abs(delta))) VS YESTERDAY"
            let width = PixelText.metrics(text, size: DS.FontSize.micro)
            let arrowWidth: CGFloat = 10
            let groupWidth = arrowWidth + 6 + width
            let startX = rightEdge - groupWidth
            PixelSpriteView(sprite: up ? .arrowUp : .arrowDown, scale: 2, color: up ? DS.Palette.green : DS.Palette.red)
                .offset(x: startX, y: heroY + 36)
            PixelText(text: text, size: DS.FontSize.micro, color: up ? DS.Palette.green : DS.Palette.red)
                .offset(x: startX + arrowWidth + 6, y: heroY + 40)
        } else {
            PixelText(
                text: "NO DATA YESTERDAY",
                size: DS.FontSize.micro,
                color: DS.Palette.inkFaint,
                width: contentWidth,
                alignment: .trailing
            )
            .offset(x: contentX, y: heroY + 40)
        }
    }

    // MARK: Split (y 110, h 48)

    private var splitSection: some View {
        let cells: [(String, Int, Color)] = [
            ("IN", summary.today.inputTokens, DS.Palette.teal),
            ("CACHE", summary.today.cacheReadTokens, DS.Palette.blue),
            ("OUT", summary.today.outputTokens, DS.Palette.purple),
        ]
        return ZStack(alignment: .topLeading) {
            ForEach(Array(cells.enumerated()), id: \.offset) { index, cell in
                SplitBarCell(
                    label: cell.0,
                    value: cell.1,
                    total: totalToday,
                    color: cell.2,
                    width: 126
                )
                .offset(x: contentX + CGFloat(index) * 144, y: splitY + 14)
            }
        }
        .frame(width: DS.Size.expandedWidth, height: 48, alignment: .topLeading)
    }

    // MARK: 14-day chart (y 165, h 74)

    private var chartSection: some View {
        let chart = TokenBarChart(daily: summary.last14Days)
        return ZStack(alignment: .topLeading) {
            PixelLabel(text: "14 DAYS", color: DS.Palette.inkFaint)
                .offset(x: contentX, y: chartY + 2)
            PixelText(
                text: "MAX \(Fmt.tokens(maxDaily))",
                size: DS.FontSize.micro,
                color: DS.Palette.inkFaint,
                width: contentWidth,
                alignment: .trailing
            )
            .offset(x: contentX, y: chartY + 2)
            PixelText(
                text: "TODAY \(Fmt.tokens(summary.today.totalTokens))",
                size: DS.FontSize.micro,
                color: DS.Palette.teal,
                width: contentWidth,
                alignment: .trailing
            )
            .offset(x: contentX, y: chartY + 18)
            chart
                .offset(x: contentX, y: chartY + 16)
        }
        .frame(width: DS.Size.expandedWidth, height: 74, alignment: .topLeading)
    }

    // MARK: Top models (y 246, h 66)

    private var modelsSection: some View {
        let models = summary.topModels
        return ZStack(alignment: .topLeading) {
            if models.isEmpty {
                EmptyStateLine(text: "NO MODEL ACTIVITY TODAY")
                    .offset(x: contentX, y: modelsY + 31)
            } else {
                ForEach(Array(models.enumerated()), id: \.offset) { index, model in
                    ModelRow(
                        rank: index + 1,
                        model: model,
                        accent: DS.Palette.series[index % DS.Palette.series.count]
                    )
                    .offset(x: 0, y: modelsY + CGFloat(index) * 22)
                }
            }
        }
        .frame(width: DS.Size.expandedWidth, height: 66, alignment: .topLeading)
    }

    // MARK: Live sessions (y 319, h 44)

    private var sessionsSection: some View {
        let sessions = summary.visibleLiveSessions
        return ZStack(alignment: .topLeading) {
            if sessions.isEmpty {
                PixelText(
                    text: "NO ACTIVE SESSIONS",
                    size: DS.FontSize.micro,
                    color: DS.Palette.inkFaint,
                    tracking: DS.Tracking.label
                )
                .offset(x: contentX, y: sessionsY + 19)
            } else {
                ForEach(Array(sessions.enumerated()), id: \.offset) { index, session in
                    LiveSessionRow(session: session, now: now, animated: animated)
                        .offset(x: 0, y: sessionsY + CGFloat(index) * 22)
                }
            }
        }
        .frame(width: DS.Size.expandedWidth, height: 44, alignment: .topLeading)
    }

    // MARK: Footer (y 370, h 16)

    private var footer: some View {
        ZStack(alignment: .topLeading) {
            PixelDivider(color: DS.Palette.border)
                .frame(width: contentWidth, height: 2)
                .offset(x: contentX, y: footerY)

            if offline {
                PixelText(
                    text: "COLLECTOR NOT REACHABLE - 127.0.0.1:\(String(port))",
                    size: DS.FontSize.micro,
                    color: DS.Palette.amber
                )
                .offset(x: contentX, y: footerY + 7)

                PixelText(
                    text: "AUTO RETRY",
                    size: DS.FontSize.micro,
                    color: DS.Palette.inkFaint,
                    width: 70,
                    alignment: .trailing
                )
                .offset(x: rightEdge - 70, y: footerY + 7)
            } else {
                let streakText = "STREAK \(summary.streak.current)D"
                let streakWidth = PixelText.metrics(streakText, size: DS.FontSize.micro, tracking: DS.Tracking.label)
                PixelSpriteView(sprite: .flame, scale: 2, color: DS.Palette.amber)
                    .offset(x: contentX, y: footerY + 4)
                PixelText(text: streakText, size: DS.FontSize.micro, color: DS.Palette.amber, tracking: DS.Tracking.label)
                    .offset(x: contentX + 10 + 6, y: footerY + 7)
                PixelText(
                    text: "\(summary.today.messages) TURNS TODAY",
                    size: DS.FontSize.micro,
                    color: DS.Palette.inkDim
                )
                .offset(x: contentX + 10 + 6 + streakWidth + 12, y: footerY + 7)
                PixelText(
                    text: "COLLECTOR \(summary.collector.version)",
                    size: DS.FontSize.micro,
                    color: DS.Palette.inkFaint,
                    width: 150,
                    alignment: .trailing
                )
                .offset(x: rightEdge - 150, y: footerY + 7)
            }
        }
        .frame(width: DS.Size.expandedWidth, height: 16, alignment: .topLeading)
    }

    // MARK: Toast

    @ViewBuilder
    private var toastOverlay: some View {
        if let toast {
            let width = PixelText.metrics(toast, size: DS.FontSize.micro, tracking: DS.Tracking.label) + 16
            PixelToast(text: toast)
                .frame(width: width, height: 20)
                .offset(x: contentX + ((contentWidth - width) / 2).rounded(), y: 340)
                .transition(.opacity)
        }
    }
}
