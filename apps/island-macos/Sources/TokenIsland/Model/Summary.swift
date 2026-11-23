import Foundation

// MARK: - Codable mirror of packages/core Summary
//
// The widget decodes the exact JSON served by the collector's
// `GET /api/summary?range=today&days=14`. Unknown fields are ignored by
// `JSONDecoder`; every field except `totals`, `today`, `daily` and `streak`
// tolerates being absent so a collector from a slightly different version can
// never take the widget down.

struct TokenTotals: Codable {
    var inputTokens: Int = 0
    var outputTokens: Int = 0
    var cacheReadTokens: Int = 0
    var cacheWriteTokens: Int = 0
    var reasoningTokens: Int = 0
    var totalTokens: Int = 0
    var unpricedTokens: Int = 0
    var costUsd: Double = 0
    var messages: Int = 0
    var sessions: Int = 0

    init() {}

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        inputTokens = try c.decodeIfPresent(Int.self, forKey: .inputTokens) ?? 0
        outputTokens = try c.decodeIfPresent(Int.self, forKey: .outputTokens) ?? 0
        cacheReadTokens = try c.decodeIfPresent(Int.self, forKey: .cacheReadTokens) ?? 0
        cacheWriteTokens = try c.decodeIfPresent(Int.self, forKey: .cacheWriteTokens) ?? 0
        reasoningTokens = try c.decodeIfPresent(Int.self, forKey: .reasoningTokens) ?? 0
        totalTokens = try c.decodeIfPresent(Int.self, forKey: .totalTokens) ?? 0
        unpricedTokens = try c.decodeIfPresent(Int.self, forKey: .unpricedTokens) ?? 0
        costUsd = try c.decodeIfPresent(Double.self, forKey: .costUsd) ?? 0
        messages = try c.decodeIfPresent(Int.self, forKey: .messages) ?? 0
        sessions = try c.decodeIfPresent(Int.self, forKey: .sessions) ?? 0
    }
}

struct Streak: Codable {
    var current: Int = 0
    var longest: Int = 0
    var todayActive: Bool = false
    var lastActiveDate: String?

    init() {}

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        current = try c.decodeIfPresent(Int.self, forKey: .current) ?? 0
        longest = try c.decodeIfPresent(Int.self, forKey: .longest) ?? 0
        todayActive = try c.decodeIfPresent(Bool.self, forKey: .todayActive) ?? false
        lastActiveDate = try c.decodeIfPresent(String.self, forKey: .lastActiveDate)
    }
}

struct DailyPoint: Codable, Identifiable {
    var date: String = ""
    var inputTokens: Int = 0
    var outputTokens: Int = 0
    var cacheReadTokens: Int = 0
    var cacheWriteTokens: Int = 0
    var reasoningTokens: Int = 0
    var totalTokens: Int = 0
    var unpricedTokens: Int = 0
    var costUsd: Double = 0
    var messages: Int = 0

    var id: String { date }

    init() {}

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        date = try c.decodeIfPresent(String.self, forKey: .date) ?? ""
        inputTokens = try c.decodeIfPresent(Int.self, forKey: .inputTokens) ?? 0
        outputTokens = try c.decodeIfPresent(Int.self, forKey: .outputTokens) ?? 0
        cacheReadTokens = try c.decodeIfPresent(Int.self, forKey: .cacheReadTokens) ?? 0
        cacheWriteTokens = try c.decodeIfPresent(Int.self, forKey: .cacheWriteTokens) ?? 0
        reasoningTokens = try c.decodeIfPresent(Int.self, forKey: .reasoningTokens) ?? 0
        totalTokens = try c.decodeIfPresent(Int.self, forKey: .totalTokens) ?? 0
        unpricedTokens = try c.decodeIfPresent(Int.self, forKey: .unpricedTokens) ?? 0
        costUsd = try c.decodeIfPresent(Double.self, forKey: .costUsd) ?? 0
        messages = try c.decodeIfPresent(Int.self, forKey: .messages) ?? 0
    }
}

struct HourPoint: Codable {
    var hour: Int = 0
    var totalTokens: Int = 0
    var costUsd: Double = 0
    var messages: Int = 0

    init() {}

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        hour = try c.decodeIfPresent(Int.self, forKey: .hour) ?? 0
        totalTokens = try c.decodeIfPresent(Int.self, forKey: .totalTokens) ?? 0
        costUsd = try c.decodeIfPresent(Double.self, forKey: .costUsd) ?? 0
        messages = try c.decodeIfPresent(Int.self, forKey: .messages) ?? 0
    }
}

struct Breakdown: Codable, Identifiable {
    var key: String = ""
    var label: String = ""
    var color: String?
    var totalTokens: Int = 0
    var costUsd: Double = 0
    var messages: Int = 0
    var share: Double = 0

    var id: String { key }

    init() {}

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        key = try c.decodeIfPresent(String.self, forKey: .key) ?? ""
        label = try c.decodeIfPresent(String.self, forKey: .label) ?? key
        color = try c.decodeIfPresent(String.self, forKey: .color)
        totalTokens = try c.decodeIfPresent(Int.self, forKey: .totalTokens) ?? 0
        costUsd = try c.decodeIfPresent(Double.self, forKey: .costUsd) ?? 0
        messages = try c.decodeIfPresent(Int.self, forKey: .messages) ?? 0
        share = try c.decodeIfPresent(Double.self, forKey: .share) ?? 0
    }
}

struct LiveSession: Codable, Identifiable {
    var source: SourceId = .other
    var sessionId: String = ""
    var project: String = ""
    var model: String = ""
    var updatedAt: Double = 0
    var totalTokens: Int = 0
    var messages: Int = 0
    var active: Bool = false

    var id: String { "\(source.rawValue):\(sessionId)" }

    init() {}

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        source = try c.decodeIfPresent(SourceId.self, forKey: .source) ?? .other
        sessionId = try c.decodeIfPresent(String.self, forKey: .sessionId) ?? ""
        project = try c.decodeIfPresent(String.self, forKey: .project) ?? ""
        model = try c.decodeIfPresent(String.self, forKey: .model) ?? ""
        updatedAt = try c.decodeIfPresent(Double.self, forKey: .updatedAt) ?? 0
        totalTokens = try c.decodeIfPresent(Int.self, forKey: .totalTokens) ?? 0
        messages = try c.decodeIfPresent(Int.self, forKey: .messages) ?? 0
        active = try c.decodeIfPresent(Bool.self, forKey: .active) ?? false
    }
}

enum SourceId: String, Codable {
    case claude, codex, opencode, dsh, gemini, other

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = SourceId(rawValue: raw) ?? .other
    }
}

struct SourceStatus: Codable {
    var source: SourceId = .other
    var enabled: Bool = true
    var lastEventAt: Double?
    var events: Int = 0
    var error: String?

    init() {}

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        source = try c.decodeIfPresent(SourceId.self, forKey: .source) ?? .other
        enabled = try c.decodeIfPresent(Bool.self, forKey: .enabled) ?? true
        lastEventAt = try c.decodeIfPresent(Double.self, forKey: .lastEventAt)
        events = try c.decodeIfPresent(Int.self, forKey: .events) ?? 0
        error = try c.decodeIfPresent(String.self, forKey: .error)
    }
}

struct CloudSyncStatus: Codable {
    var enabled: Bool = false
    var lastSyncAt: Double?
    var lastError: String?
    var username: String?
    var endpoint: String?

    init() {}

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        enabled = try c.decodeIfPresent(Bool.self, forKey: .enabled) ?? false
        lastSyncAt = try c.decodeIfPresent(Double.self, forKey: .lastSyncAt)
        lastError = try c.decodeIfPresent(String.self, forKey: .lastError)
        username = try c.decodeIfPresent(String.self, forKey: .username)
        endpoint = try c.decodeIfPresent(String.self, forKey: .endpoint)
    }
}

struct CollectorMeta: Codable {
    var version: String = "unknown"
    var uptimeSec: Double = 0
    var dbPath: String = ""
    var watchRoots: [String] = []
    var sources: [SourceStatus] = []
    var cloud: CloudSyncStatus = CloudSyncStatus()

    init() {}

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        version = try c.decodeIfPresent(String.self, forKey: .version) ?? "unknown"
        uptimeSec = try c.decodeIfPresent(Double.self, forKey: .uptimeSec) ?? 0
        dbPath = try c.decodeIfPresent(String.self, forKey: .dbPath) ?? ""
        watchRoots = try c.decodeIfPresent([String].self, forKey: .watchRoots) ?? []
        sources = try c.decodeIfPresent([SourceStatus].self, forKey: .sources) ?? []
        cloud = try c.decodeIfPresent(CloudSyncStatus.self, forKey: .cloud) ?? CloudSyncStatus()
    }
}

struct Summary: Codable {
    var version: Int = 1
    var generatedAt: Double = 0
    var range: String = "today"
    var timezone: String = ""
    var totals: TokenTotals = TokenTotals()
    var today: TokenTotals = TokenTotals()
    var streak: Streak = Streak()
    var daily: [DailyPoint] = []
    var hourly: [HourPoint] = []
    var models: [Breakdown] = []
    var sources: [Breakdown] = []
    var projects: [Breakdown] = []
    var live: [LiveSession] = []
    var lastEventAt: Double?
    var unpricedModels: [String] = []
    var collector: CollectorMeta = CollectorMeta()

    init() {}

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        version = try c.decodeIfPresent(Int.self, forKey: .version) ?? 1
        generatedAt = try c.decodeIfPresent(Double.self, forKey: .generatedAt) ?? 0
        range = try c.decodeIfPresent(String.self, forKey: .range) ?? "today"
        timezone = try c.decodeIfPresent(String.self, forKey: .timezone) ?? ""
        // Required by contract §7.3 — but decode leniently so a partial payload
        // shows an empty island rather than crashing the widget.
        totals = try c.decodeIfPresent(TokenTotals.self, forKey: .totals) ?? TokenTotals()
        today = try c.decodeIfPresent(TokenTotals.self, forKey: .today) ?? TokenTotals()
        streak = try c.decodeIfPresent(Streak.self, forKey: .streak) ?? Streak()
        daily = try c.decodeIfPresent([DailyPoint].self, forKey: .daily) ?? []
        hourly = try c.decodeIfPresent([HourPoint].self, forKey: .hourly) ?? []
        models = try c.decodeIfPresent([Breakdown].self, forKey: .models) ?? []
        sources = try c.decodeIfPresent([Breakdown].self, forKey: .sources) ?? []
        projects = try c.decodeIfPresent([Breakdown].self, forKey: .projects) ?? []
        live = try c.decodeIfPresent([LiveSession].self, forKey: .live) ?? []
        lastEventAt = try c.decodeIfPresent(Double.self, forKey: .lastEventAt)
        unpricedModels = try c.decodeIfPresent([String].self, forKey: .unpricedModels) ?? []
        collector = try c.decodeIfPresent(CollectorMeta.self, forKey: .collector) ?? CollectorMeta()
    }
}

// MARK: - Derived values used by the widget UI

extension Summary {
    /// Most recent 14 daily points (zero-filled; ascending, today last).
    var last14Days: [DailyPoint] {
        guard daily.count > 14 else { return daily }
        return Array(daily.suffix(14))
    }

    /// Reference clock for relative timestamps. `generatedAt` keeps demo runs
    /// and snapshots deterministic ("just now" stays "just now").
    var referenceNow: Double { generatedAt > 0 ? generatedAt : Date().timeIntervalSince1970 * 1_000 }

    /// Today's token delta versus yesterday, from the last two daily points.
    /// Returns a signed fractional change (e.g. -0.072 for -7.2%).
    var todayDelta: Double? {
        guard daily.count >= 2 else { return nil }
        let today = daily[daily.count - 1].totalTokens
        let yesterday = daily[daily.count - 2].totalTokens
        guard yesterday > 0 else { return nil }
        return Double(today - yesterday) / Double(yesterday)
    }

    /// Collector considered "live" when a session is active or events arrived
    /// within the last 10 minutes.
    func isLive(now: Double) -> Bool {
        if live.contains(where: { $0.active }) { return true }
        if let last = lastEventAt, now - last < 600_000 { return true }
        return false
    }

    var topModels: [Breakdown] { Array(models.prefix(3)) }
    var visibleLiveSessions: [LiveSession] { Array(live.prefix(2)) }

    static var empty: Summary { Summary() }
}
