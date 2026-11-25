import Foundation

// MARK: - Codable mirror of packages/core Summary (+ Cloud Remote Stats adapter)
//
// Decodes both:
//  1. Local / Remote Collector `GET /api/summary?range=today&days=14`
//  2. Token Island Cloud `GET /api/v1/u/:username` / `GET /api/v1/me`

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

struct BreakdownDetail: Codable, Identifiable {
    var key: String = ""
    var label: String = ""
    var color: String?
    var totalTokens: Int = 0
    var costUsd: Double = 0
    var messages: Int = 0
    var share: Double = 0

    var id: String { key }

    init(
        key: String = "",
        label: String = "",
        color: String? = nil,
        totalTokens: Int = 0,
        costUsd: Double = 0,
        messages: Int = 0,
        share: Double = 0
    ) {
        self.key = key
        self.label = label
        self.color = color
        self.totalTokens = totalTokens
        self.costUsd = costUsd
        self.messages = messages
        self.share = share
    }

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

struct Breakdown: Codable, Identifiable {
    var key: String = ""
    var label: String = ""
    var color: String?
    var inputTokens: Int?
    var outputTokens: Int?
    var cacheReadTokens: Int?
    var cacheWriteTokens: Int?
    var reasoningTokens: Int?
    var totalTokens: Int = 0
    var costUsd: Double = 0
    var messages: Int = 0
    var share: Double = 0
    var models: [BreakdownDetail] = []
    var sources: [BreakdownDetail] = []
    var projects: [BreakdownDetail] = []

    var id: String { key }

    init(
        key: String = "",
        label: String = "",
        color: String? = nil,
        inputTokens: Int? = nil,
        outputTokens: Int? = nil,
        cacheReadTokens: Int? = nil,
        cacheWriteTokens: Int? = nil,
        reasoningTokens: Int? = nil,
        totalTokens: Int = 0,
        costUsd: Double = 0,
        messages: Int = 0,
        share: Double = 0,
        models: [BreakdownDetail] = [],
        sources: [BreakdownDetail] = [],
        projects: [BreakdownDetail] = []
    ) {
        self.key = key
        self.label = label
        self.color = color
        self.inputTokens = inputTokens
        self.outputTokens = outputTokens
        self.cacheReadTokens = cacheReadTokens
        self.cacheWriteTokens = cacheWriteTokens
        self.reasoningTokens = reasoningTokens
        self.totalTokens = totalTokens
        self.costUsd = costUsd
        self.messages = messages
        self.share = share
        self.models = models
        self.sources = sources
        self.projects = projects
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        key = try c.decodeIfPresent(String.self, forKey: .key) ?? ""
        label = try c.decodeIfPresent(String.self, forKey: .label) ?? key
        color = try c.decodeIfPresent(String.self, forKey: .color)
        inputTokens = try c.decodeIfPresent(Int.self, forKey: .inputTokens)
        outputTokens = try c.decodeIfPresent(Int.self, forKey: .outputTokens)
        cacheReadTokens = try c.decodeIfPresent(Int.self, forKey: .cacheReadTokens)
        cacheWriteTokens = try c.decodeIfPresent(Int.self, forKey: .cacheWriteTokens)
        reasoningTokens = try c.decodeIfPresent(Int.self, forKey: .reasoningTokens)
        totalTokens = try c.decodeIfPresent(Int.self, forKey: .totalTokens) ?? 0
        costUsd = try c.decodeIfPresent(Double.self, forKey: .costUsd) ?? 0
        messages = try c.decodeIfPresent(Int.self, forKey: .messages) ?? 0
        share = try c.decodeIfPresent(Double.self, forKey: .share) ?? 0
        models = try c.decodeIfPresent([BreakdownDetail].self, forKey: .models) ?? []
        sources = try c.decodeIfPresent([BreakdownDetail].self, forKey: .sources) ?? []
        projects = try c.decodeIfPresent([BreakdownDetail].self, forKey: .projects) ?? []
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
    var models: [Breakdown] = []
    var sources: [Breakdown] = []
    var projects: [Breakdown] = []

    var id: String { date }

    init(date: String = "") {
        self.date = date
    }

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
        models = try c.decodeIfPresent([Breakdown].self, forKey: .models) ?? []
        sources = try c.decodeIfPresent([Breakdown].self, forKey: .sources) ?? []
        projects = try c.decodeIfPresent([Breakdown].self, forKey: .projects) ?? []
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

    var displayLabel: String {
        switch self {
        case .claude: return "Claude Code"
        case .codex: return "OpenAI Codex"
        case .opencode: return "OpenCode"
        case .dsh: return "DeepSeek Harness"
        case .gemini: return "Gemini CLI"
        case .other: return "Other"
        }
    }

    var brandHex: String {
        switch self {
        case .claude: return "#D97757"
        case .codex: return "#10A37F"
        case .opencode: return "#6C7BFF"
        case .dsh: return "#4D6BFE"
        case .gemini: return "#4285F4"
        case .other: return "#8B8B8B"
        }
    }

    static func infer(fromModel model: String) -> SourceId {
        let lower = model.lowercased()
        if lower.contains("claude") || lower.contains("anthropic") { return .claude }
        if lower.contains("codex") || lower.contains("gpt") || lower.hasPrefix("o3") || lower.hasPrefix("o4") { return .codex }
        if lower.contains("deepseek") || lower.contains("dsh") { return .dsh }
        if lower.contains("glm") || lower.contains("kimi") || lower.contains("qwen") || lower.contains("minimax") { return .opencode }
        if lower.contains("gemini") || lower.contains("google") { return .gemini }
        return .other
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

// MARK: - Remote Cloud Public Stats Adapter (`/api/v1/u/:username`)

extension Summary {
    private struct CloudDayPayload: Decodable {
        var date: String
        var inputTokens: Int?
        var outputTokens: Int?
        var cacheReadTokens: Int?
        var cacheWriteTokens: Int?
        var reasoningTokens: Int?
        var totalTokens: Int?
        var unpricedTokens: Int?
        var costUsd: Double?
        var messages: Int?
        var models: [String: Int]?
    }

    private struct CloudModelPayload: Decodable {
        var model: String
        var totalTokens: Int
        var share: Double?
        var color: String?
    }

    private struct CloudSourcePayload: Decodable {
        var source: String
        var label: String?
        var color: String?
        var totalTokens: Int
        var share: Double?
    }

    private struct CloudPublicPayload: Decodable {
        var username: String
        var lastSyncAt: Double?
        var totals: TokenTotals?
        var streak: Streak?
        var daily: [CloudDayPayload]?
        var models: [CloudModelPayload]?
        var sources: [CloudSourcePayload]?
    }

    /// Decodes either a native Collector `Summary` or a Token Island Cloud
    /// `/api/v1/u/:user` (or `/api/v1/me`) payload.
    static func decodeFlexible(from data: Data, endpoint: String? = nil) throws -> Summary {
        if let top = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            if let userObj = top["user"] as? [String: Any],
               userObj["username"] != nil,
               top["totals"] == nil,
               top["daily"] == nil {
                // `/api/v1/me` wraps minimal user info when stats aren't embedded
                throw NSError(
                    domain: "TokenIsland",
                    code: 422,
                    userInfo: [NSLocalizedDescriptionKey: "Set remote username to load cloud telemetry"]
                )
            }
            if top["username"] != nil && top["collector"] == nil && top["hourly"] == nil {
                return try decodeFromCloudStats(data, endpoint: endpoint)
            }
        }
        return try JSONDecoder().decode(Summary.self, from: data)
    }

    private static func decodeFromCloudStats(_ data: Data, endpoint: String?) throws -> Summary {
        let payload = try JSONDecoder().decode(CloudPublicPayload.self, from: data)
        let nowMs = Date().timeIntervalSince1970 * 1_000
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.locale = Locale(identifier: "en_US_POSIX")
        let todayKey = formatter.string(from: Date())

        var byDate: [String: DailyPoint] = [:]
        for raw in payload.daily ?? [] {
            let dayTotal = raw.totalTokens ?? 0
            let dayCost = raw.costUsd ?? 0
            var dayModels: [Breakdown] = []
            var sourceMap: [SourceId: (tokens: Int, models: [BreakdownDetail])] = [:]

            if let modelDict = raw.models, !modelDict.isEmpty {
                let sortedModels = modelDict.sorted { $0.value > $1.value }
                for (mKey, mTokens) in sortedModels where mTokens > 0 {
                    let src = SourceId.infer(fromModel: mKey)
                    let mShare = dayTotal > 0 ? Double(mTokens) / Double(dayTotal) : 0
                    let proportionalCost = dayCost * mShare
                    dayModels.append(Breakdown(
                        key: mKey,
                        label: mKey,
                        color: nil,
                        totalTokens: mTokens,
                        costUsd: proportionalCost,
                        messages: 0,
                        share: mShare,
                        sources: [
                            BreakdownDetail(
                                key: src.rawValue,
                                label: src.displayLabel,
                                color: src.brandHex,
                                totalTokens: mTokens,
                                costUsd: proportionalCost,
                                messages: 0,
                                share: 1.0
                            ),
                        ]
                    ))
                    var entry = sourceMap[src] ?? (0, [])
                    entry.tokens += mTokens
                    entry.models.append(BreakdownDetail(
                        key: mKey,
                        label: mKey,
                        totalTokens: mTokens,
                        costUsd: proportionalCost,
                        messages: 0,
                        share: 0
                    ))
                    sourceMap[src] = entry
                }
            }

            let daySources: [Breakdown] = sourceMap
                .sorted { $0.value.tokens > $1.value.tokens }
                .map { src, info in
                    let share = dayTotal > 0 ? Double(info.tokens) / Double(dayTotal) : 0
                    let normalizedModels = info.models.map { item -> BreakdownDetail in
                        var copy = item
                        copy.share = info.tokens > 0 ? Double(item.totalTokens) / Double(info.tokens) : 0
                        return copy
                    }
                    return Breakdown(
                        key: src.rawValue,
                        label: src.displayLabel,
                        color: src.brandHex,
                        totalTokens: info.tokens,
                        costUsd: dayCost * share,
                        messages: 0,
                        share: share,
                        models: normalizedModels
                    )
                }

            var pt = DailyPoint(date: raw.date)
            pt.inputTokens = raw.inputTokens ?? 0
            pt.outputTokens = raw.outputTokens ?? 0
            pt.cacheReadTokens = raw.cacheReadTokens ?? 0
            pt.cacheWriteTokens = raw.cacheWriteTokens ?? 0
            pt.reasoningTokens = raw.reasoningTokens ?? 0
            pt.totalTokens = dayTotal
            pt.unpricedTokens = raw.unpricedTokens ?? 0
            pt.costUsd = dayCost
            pt.messages = raw.messages ?? 0
            pt.models = Array(dayModels.prefix(8))
            pt.sources = daySources
            byDate[raw.date] = pt
        }

        // Build rolling 14-day window ending today
        let calendar = Calendar(identifier: .gregorian)
        let anchorDate = formatter.date(from: todayKey) ?? Date()
        var window: [DailyPoint] = []
        for offset in stride(from: 13, through: 0, by: -1) {
            let date = calendar.date(byAdding: .day, value: -offset, to: anchorDate) ?? anchorDate
            let key = formatter.string(from: date)
            window.append(byDate[key] ?? DailyPoint(date: key))
        }

        let todayPoint = byDate[todayKey] ?? DailyPoint(date: todayKey)
        var todayTotals = TokenTotals()
        todayTotals.inputTokens = todayPoint.inputTokens
        todayTotals.outputTokens = todayPoint.outputTokens
        todayTotals.cacheReadTokens = todayPoint.cacheReadTokens
        todayTotals.cacheWriteTokens = todayPoint.cacheWriteTokens
        todayTotals.reasoningTokens = todayPoint.reasoningTokens
        todayTotals.totalTokens = todayPoint.totalTokens
        todayTotals.unpricedTokens = todayPoint.unpricedTokens
        todayTotals.costUsd = todayPoint.costUsd
        todayTotals.messages = todayPoint.messages

        // Top-level breakdowns: prefer Today's if active, else overall Cloud stats
        let topModels: [Breakdown]
        let topSources: [Breakdown]
        if !todayPoint.models.isEmpty {
            topModels = todayPoint.models
            topSources = todayPoint.sources
        } else {
            let overallCost = payload.totals?.costUsd ?? 0
            topModels = (payload.models ?? []).prefix(8).map { row in
                let src = SourceId.infer(fromModel: row.model)
                let share = row.share ?? 0
                return Breakdown(
                    key: row.model,
                    label: row.model,
                    color: row.color,
                    totalTokens: row.totalTokens,
                    costUsd: overallCost * share,
                    messages: 0,
                    share: share,
                    sources: [
                        BreakdownDetail(
                            key: src.rawValue,
                            label: src.displayLabel,
                            color: src.brandHex,
                            totalTokens: row.totalTokens,
                            costUsd: overallCost * share,
                            messages: 0,
                            share: 1.0
                        ),
                    ]
                )
            }
            let modelsBySource = Dictionary(grouping: payload.models ?? []) { SourceId.infer(fromModel: $0.model) }
            topSources = (payload.sources ?? []).map { row in
                let src = SourceId(rawValue: row.source) ?? .other
                let share = row.share ?? 0
                let childModels = (modelsBySource[src] ?? []).prefix(6).map { m in
                    BreakdownDetail(
                        key: m.model,
                        label: m.model,
                        color: m.color,
                        totalTokens: m.totalTokens,
                        costUsd: 0,
                        messages: 0,
                        share: row.totalTokens > 0 ? Double(m.totalTokens) / Double(row.totalTokens) : 0
                    )
                }
                return Breakdown(
                    key: row.source,
                    label: row.label ?? src.displayLabel,
                    color: row.color ?? src.brandHex,
                    totalTokens: row.totalTokens,
                    costUsd: overallCost * share,
                    messages: 0,
                    share: share,
                    models: Array(childModels)
                )
            }
        }

        var summary = Summary()
        summary.version = 1
        summary.generatedAt = nowMs
        summary.range = "today"
        summary.timezone = TimeZone.current.identifier
        summary.totals = payload.totals ?? todayTotals
        summary.today = todayTotals
        summary.streak = payload.streak ?? Streak()
        summary.daily = window
        summary.models = topModels
        summary.sources = topSources
        summary.lastEventAt = payload.lastSyncAt

        var meta = CollectorMeta()
        meta.version = "remote"
        var cloud = CloudSyncStatus()
        cloud.enabled = true
        cloud.lastSyncAt = payload.lastSyncAt
        cloud.username = payload.username
        cloud.endpoint = endpoint
        meta.cloud = cloud
        summary.collector = meta
        return summary
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
    var todayDelta: Double? {
        guard daily.count >= 2 else { return nil }
        let today = daily[daily.count - 1].totalTokens
        let yesterday = daily[daily.count - 2].totalTokens
        guard yesterday > 0 else { return nil }
        return Double(today - yesterday) / Double(yesterday)
    }

    /// Fractional token delta for an arbitrary date in `daily` vs its preceding day.
    func delta(forDate date: String) -> Double? {
        guard let index = daily.firstIndex(where: { $0.date == date }), index > 0 else {
            return nil
        }
        let current = daily[index].totalTokens
        let previous = daily[index - 1].totalTokens
        guard previous > 0 else { return nil }
        return Double(current - previous) / Double(previous)
    }

    /// Collector considered "live" when a session is active or events arrived
    /// within the last 10 minutes.
    func isLive(now: Double) -> Bool {
        if live.contains(where: { $0.active }) { return true }
        if let last = lastEventAt, now - last < 600_000 { return true }
        return false
    }

    var topModels: [Breakdown] { Array(models.prefix(8)) }
    var visibleLiveSessions: [LiveSession] { Array(live.prefix(2)) }

    static var empty: Summary { Summary() }
}
