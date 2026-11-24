import Foundation

// MARK: - UserDefaults-backed UI settings (contract §1.4 Preferences)
//
// The collector port and refresh interval are UI preferences on top of the
// shared config file. Precedence for the effective port:
//   UserDefaults (Preferences) > ~/.token-island/config.json > 47118
// The env override TOKEN_ISLAND_PORT still wins inside `IslandConfig.load()`.

@MainActor
final class AppSettings: ObservableObject {
    static let shared = AppSettings()

    static let portKey = "token-island.collectorPort"
    static let intervalKey = "token-island.refreshInterval"

    /// Refresh choices required by the contract (1s / 2s / 5s).
    static let refreshChoices: [TimeInterval] = [1, 2, 5]
    static let defaultRefresh: TimeInterval = 2

    private let defaults: UserDefaults
    private let config: IslandConfig

    @Published var collectorPort: Int {
        didSet {
            let clamped = min(max(collectorPort, 1), 65_535)
            if clamped != collectorPort {
                collectorPort = clamped
                return
            }
            defaults.set(collectorPort, forKey: Self.portKey)
        }
    }

    @Published var refreshInterval: TimeInterval {
        didSet {
            let snapped = Self.refreshChoices.contains(refreshInterval) ? refreshInterval : Self.defaultRefresh
            if snapped != refreshInterval {
                refreshInterval = snapped
                return
            }
            defaults.set(refreshInterval, forKey: Self.intervalKey)
        }
    }

    init(defaults: UserDefaults = .standard, config: IslandConfig? = nil) {
        self.defaults = defaults
        let loaded = config ?? IslandConfig.load()
        self.config = loaded
        if let stored = defaults.object(forKey: Self.portKey) as? Int, stored > 0, stored < 65_536 {
            self.collectorPort = stored
        } else {
            self.collectorPort = loaded.port
        }
        if let stored = defaults.object(forKey: Self.intervalKey) as? Double,
           Self.refreshChoices.contains(stored) {
            self.refreshInterval = stored
        } else {
            self.refreshInterval = Self.defaultRefresh
        }
    }

    /// Human-readable port source for the Preferences path line.
    var portSource: String {
        if defaults.object(forKey: Self.portKey) != nil { return "preferences" }
        if config.configPath != nil { return "config.json" }
        return "default"
    }

    var configPath: String { config.configPath ?? IslandConfig.expandTilde("~/.token-island/config.json") }
    var dataPath: String { IslandConfig.expandTilde("~/.token-island/data.db") }
    var launchAgentPath: String { LoginItem.plistURL.path }

    var versionLine: String { "TOKEN ISLAND \(DS.version)" }
}
