import SwiftUI

// MARK: - Expanded panel (430 x 352)
//
// Content contract §7.4:
//  1. header  — wordmark, LIVE/IDLE/OFFLINE pill, cloud sync, pin
//  2. hero    — today tokens (40 pt) + TODAY, estimated cost + delta vs yesterday
//  3. split   — stacked input / cache / output bar + legend
//  4. chart   — 14-day bars, today highlighted, max value
//  5. models  — up to 3 rows
//  6. sessions— up to 2 live sessions
//  7. footer  — streak + turns, collector version

struct ExpandedView: View {
    let summary: Summary
    let status: IslandStatus
    let offline: Bool
    let pinned: Bool
    let port: Int
    let now: Double
    let toast: String?
    let onPinToggle: () -> Void

    private var tint: Color { DS.Palette.tokens }

    private var heroValue: String {
        if offline { return "--" }
        // A real zero is shown honestly as "0"; the loading placeholder only
        // appears when there is no data at all yet.
        return Fmt.tokens(summary.today.totalTokens)
    }

    /// "stale · 2m ago" (or "stale data" when the timestamp is unknown).
    private var staleLabel: String {
        guard summary.generatedAt > 0 else { return "stale data" }
        let compact = Fmt.relativeCompact(summary.generatedAt, now: now)
        return compact == "now" ? "stale data" : "stale · \(compact) ago"
    }

    private var maxDaily: Int {
        summary.last14Days.map(\.totalTokens).max() ?? 0
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 11) {
            header
            hero

            Group {
                splitSection
                chartSection
                modelsSection
                sessionsSection
            }
            .opacity(offline ? 0.42 : 1.0)

            Spacer(minLength: 0)
            footer
        }
        .padding(.horizontal, DS.Space.panelPadding)
        .padding(.top, 16)
        .padding(.bottom, 14)
        .frame(width: DS.Size.expandedWidth, height: DS.Size.expandedHeight, alignment: .top)
        .overlay(alignment: .bottom) { toastOverlay }
    }

    // MARK: Header

    private var header: some View {
        HStack(spacing: 7) {
            Text("TOKEN ISLAND")
                .font(DS.Fonts.micro)
                .tracking(DS.Tracking.micro)
                .foregroundStyle(DS.Palette.textSecondary)
            StatusPill(status: status)
            Spacer(minLength: 4)
            CloudSyncBadge(cloud: summary.collector.cloud, offline: offline, now: now)
            PinButton(pinned: pinned, action: onPinToggle)
        }
        .frame(height: 16)
    }

    // MARK: Hero

    private var hero: some View {
        HStack(alignment: .top, spacing: 10) {
            HStack(alignment: .firstTextBaseline, spacing: 7) {
                Text(heroValue)
                    .font(DS.Fonts.hero)
                    .monospacedDigit()
                    .foregroundStyle(offline ? DS.Palette.textTertiary : DS.Palette.textPrimary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.65)
                    .shadow(color: offline ? .clear : tint.opacity(0.22), radius: 16)
                Text("TODAY")
                    .font(DS.Fonts.microSmall)
                    .tracking(DS.Tracking.micro)
                    .foregroundStyle(DS.Palette.textTertiary)
            }
            Spacer(minLength: 6)
            VStack(alignment: .trailing, spacing: 3) {
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Text("EST")
                        .font(DS.Fonts.microSmall)
                        .tracking(0.8)
                        .foregroundStyle(DS.Palette.textTertiary)
                    Text(offline ? "—" : Fmt.cost(summary.today.costUsd, approx: true))
                        .font(DS.Fonts.cost)
                        .monospacedDigit()
                        .foregroundStyle(offline ? DS.Palette.textTertiary : DS.Palette.textPrimary)
                        .lineLimit(1)
                }
                if offline {
                    Text(staleLabel)
                        .font(DS.Fonts.microSmall)
                        .foregroundStyle(DS.Palette.warning.opacity(0.85))
                } else if let delta = summary.todayDelta {
                    DeltaBadge(delta: delta)
                } else {
                    Text("no data yesterday")
                        .font(DS.Fonts.microSmall)
                        .foregroundStyle(DS.Palette.textTertiary)
                }
            }
            .frame(maxWidth: 128, alignment: .trailing)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text("Today \(Fmt.tokensFull(summary.today.totalTokens)) tokens, estimated cost \(Fmt.cost(summary.today.costUsd))"))
    }

    // MARK: Token split

    private var splitSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            TokenSplitBar(
                input: summary.today.inputTokens,
                cache: summary.today.cacheReadTokens,
                output: summary.today.outputTokens
            )
            HStack(spacing: 12) {
                SplitLegendItem(color: DS.Palette.splitInput, label: "IN", value: summary.today.inputTokens)
                SplitLegendItem(color: DS.Palette.splitCache, label: "CACHE", value: summary.today.cacheReadTokens)
                SplitLegendItem(color: DS.Palette.splitOutput, label: "OUT", value: summary.today.outputTokens)
                Spacer(minLength: 0)
            }
        }
    }

    // MARK: 14-day chart

    private var chartSection: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(alignment: .firstTextBaseline) {
                Text("14 DAYS")
                    .font(DS.Fonts.microSmall)
                    .tracking(DS.Tracking.micro)
                    .foregroundStyle(DS.Palette.textTertiary)
                Spacer(minLength: 4)
                Text("max \(Fmt.tokens(maxDaily))")
                    .font(DS.Fonts.microSmall)
                    .monospacedDigit()
                    .foregroundStyle(DS.Palette.textTertiary)
            }
            Sparkline(values: summary.last14Days.map(\.totalTokens), height: 34, gap: 6)
        }
    }

    // MARK: Top models

    private var modelsSection: some View {
        let models = summary.topModels
        return VStack(alignment: .leading, spacing: 4) {
            if models.isEmpty {
                Text("No model activity today")
                    .font(DS.Fonts.caption)
                    .foregroundStyle(DS.Palette.textTertiary)
                    .frame(height: 14)
            } else {
                ForEach(models) { model in
                    ModelRow(model: model)
                }
            }
        }
    }

    // MARK: Live sessions

    private var sessionsSection: some View {
        let sessions = summary.visibleLiveSessions
        return VStack(alignment: .leading, spacing: 3) {
            if sessions.isEmpty {
                EmptySessionsRow()
            } else {
                ForEach(sessions) { session in
                    LiveSessionRow(session: session, now: now)
                }
            }
        }
    }

    // MARK: Footer

    private var footer: some View {
        HStack(spacing: 0) {
            if offline {
                HStack(spacing: 4) {
                    Image(systemName: "wifi.slash")
                        .font(.system(size: 8.5, weight: .semibold))
                    // `Text(verbatim:)` — LocalizedStringKey interpolation would
                    // group the port digits ("127.0.0.1:47,118").
                    Text(verbatim: "Collector not reachable · 127.0.0.1:" + String(port))
                        .font(DS.Fonts.caption)
                        .lineLimit(1)
                }
                .foregroundStyle(DS.Palette.warning.opacity(0.92))
                Spacer(minLength: 6)
                Text("auto-retry")
                    .font(DS.Fonts.microSmall)
                    .foregroundStyle(DS.Palette.textTertiary)
            } else {
                HStack(spacing: 5) {
                    Image(systemName: "flame.fill")
                        .font(.system(size: 8.5, weight: .semibold))
                        .foregroundStyle(Color(hex: 0xF59E0B))
                    Text("\(summary.streak.current)d streak")
                        .font(DS.Fonts.microSmall)
                        .foregroundStyle(DS.Palette.textSecondary)
                    Text("·")
                        .font(DS.Fonts.microSmall)
                        .foregroundStyle(DS.Palette.textTertiary)
                    Text("\(summary.today.messages) turns today")
                        .font(DS.Fonts.microSmall)
                        .foregroundStyle(DS.Palette.textTertiary)
                }
                Spacer(minLength: 6)
                Text("collector \(Fmt.truncate(summary.collector.version, 22))")
                    .font(DS.Fonts.microSmall)
                    .foregroundStyle(DS.Palette.textTertiary)
                    .lineLimit(1)
            }
        }
        .frame(height: 12)
        .overlay(alignment: .top) {
            // Hairline that separates the pinned footer from the scrollable-ish
            // content above it (uses the Spacer gap, so it costs no height).
            Rectangle()
                .fill(DS.Palette.divider)
                .frame(height: 0.5)
                .offset(y: -6)
        }
    }

    // MARK: Toast

    @ViewBuilder
    private var toastOverlay: some View {
        if let toast {
            IslandToast(text: toast)
                .padding(.bottom, 10)
                .transition(.opacity.combined(with: .move(edge: .bottom)))
        }
    }
}

// MARK: - Delta badge

struct DeltaBadge: View {
    let delta: Double

    private var isUp: Bool { delta >= 0 }
    private var color: Color { isUp ? DS.Palette.live : DS.Palette.error }

    var body: some View {
        HStack(spacing: 2.5) {
            Image(systemName: isUp ? "arrow.up.right" : "arrow.down.right")
                .font(.system(size: 7.5, weight: .bold))
            Text(Fmt.percent(abs(delta)))
                .font(.system(size: 9, weight: .semibold, design: .rounded))
                .monospacedDigit()
            Text("vs yesterday")
                .font(DS.Fonts.microSmall)
                .foregroundStyle(DS.Palette.textTertiary)
        }
        .foregroundStyle(color)
    }
}

// MARK: - Cloud sync badge

struct CloudSyncBadge: View {
    let cloud: CloudSyncStatus
    let offline: Bool
    let now: Double

    private var icon: String {
        if offline { return "arrow.triangle.2.circlepath" }
        if cloud.enabled && cloud.lastError == nil { return "cloud.fill" }
        return "cloud"
    }

    private var label: String {
        guard cloud.enabled else { return "local" }
        if let last = cloud.lastSyncAt { return "synced " + Fmt.relativeCompact(last, now: now) + " ago" }
        return "not synced"
    }

    var body: some View {
        HStack(spacing: 3.5) {
            Image(systemName: icon)
                .font(.system(size: 9, weight: .medium))
            Text(label)
                .font(DS.Fonts.microSmall)
                .monospacedDigit()
                .lineLimit(1)
        }
        .foregroundStyle(offline ? DS.Palette.warning.opacity(0.85) : DS.Palette.textTertiary)
        .accessibilityLabel(Text("Cloud sync \(label)"))
    }
}

// MARK: - Pin button

struct PinButton: View {
    let pinned: Bool
    let action: () -> Void

    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            Image(systemName: pinned ? "pin.fill" : "pin")
                .font(.system(size: 9.5, weight: .semibold))
                .foregroundStyle(
                    pinned ? DS.Palette.textPrimary.opacity(0.9)
                    : (hovering ? DS.Palette.textSecondary : DS.Palette.textTertiary)
                )
                .frame(width: 16, height: 16)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .help(pinned ? "Unpin island" : "Pin island open")
        .accessibilityLabel(Text(pinned ? "Unpin island" : "Pin island open"))
    }
}
