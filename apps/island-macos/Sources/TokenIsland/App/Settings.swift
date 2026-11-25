import Foundation

// MARK: - Server Mode & UserDefaults-backed UI Settings
//
// Manages local vs remote server mode, server URL, collector port, and refresh
// interval, while keeping `~/.token-island/config.json` synchronized so CLI
// commands and cloud sync share the same endpoint configuration.

enum ServerMode: String, CaseIterable {
    case local
    case remote

    var label: String {
        switch self {
        case .local: return "Local"
        case .remote: return "Remote"
        }
    }

    var subtitle: String {
        switch self {
        case .local: return "App launches & keeps local collector alive"
        case .remote: return "Fetch telemetry from a remote Cloud or Collector URL"
        }
    }
}

@MainActor
final class AppSettings: ObservableObject {
    static let shared = AppSettings()

    static let modeKey = "token-island.serverMode"
    static let serverURLKey = "token-island.serverURL"
    static let remoteUsernameKey = "token-island.remoteUsername"
    static let portKey = "token-island.collectorPort"
    static let intervalKey = "token-island.refreshInterval"

    /// Refresh choices required by the contract (1s / 2s / 5s).
    static let refreshChoices: [TimeInterval] = [1, 2, 5]
    static let defaultRefresh: TimeInterval = 2

    private let defaults: UserDefaults
    private let config: IslandConfig

    /// Hook invoked when server mode, port, or remote URL changes so `IslandModel`
    /// can immediately reconfigure supervision and re-poll.
    var onConnectionSettingsChanged: (() -> Void)?

    @Published var serverMode: ServerMode {
        didSet {
            guard serverMode != oldValue else { return }
            defaults.set(serverMode.rawValue, forKey: Self.modeKey)
            onConnectionSettingsChanged?()
        }
    }

    @Published var serverURL: String {
        didSet {
            let trimmed = serverURL.trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmed != serverURL {
                serverURL = trimmed
                return
            }
            defaults.set(serverURL, forKey: Self.serverURLKey)
            if let resolved = ServerEndpointResolver.resolve(rawURL: serverURL, explicitUsername: ""),
               let extracted = resolved.username,
               !extracted.isEmpty,
               remoteUsername.isEmpty {
                remoteUsername = extracted
            }
            persistToConfigFile()
            onConnectionSettingsChanged?()
        }
    }

    @Published var remoteUsername: String {
        didSet {
            let trimmed = remoteUsername.trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmed != remoteUsername {
                remoteUsername = trimmed
                return
            }
            defaults.set(remoteUsername, forKey: Self.remoteUsernameKey)
            persistToConfigFile()
            onConnectionSettingsChanged?()
        }
    }

    @Published var collectorPort: Int {
        didSet {
            let clamped = min(max(collectorPort, 1), 65_535)
            if clamped != collectorPort {
                collectorPort = clamped
                return
            }
            guard collectorPort != oldValue else { return }
            defaults.set(collectorPort, forKey: Self.portKey)
            persistToConfigFile()
            onConnectionSettingsChanged?()
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

        if let rawMode = defaults.string(forKey: Self.modeKey),
           let parsedMode = ServerMode(rawValue: rawMode) {
            self.serverMode = parsedMode
        } else {
            self.serverMode = .local
        }

        if let storedURL = defaults.string(forKey: Self.serverURLKey) {
            self.serverURL = storedURL
        } else {
            self.serverURL = loaded.cloudURLString
        }

        if let storedUser = defaults.string(forKey: Self.remoteUsernameKey), !storedUser.isEmpty {
            self.remoteUsername = storedUser
        } else {
            self.remoteUsername = loaded.cloudUsername
        }

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

    func persistToConfigFile() {
        ConfigWriter.savePreferences(
            configPath: configPath,
            port: collectorPort,
            serverURL: serverURL,
            username: remoteUsername
        )
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
    var collectorLogPath: String { IslandConfig.expandTilde("~/Library/Logs/TokenIsland-collector.log") }

    var versionLine: String { "TOKEN ISLAND \(DS.version)" }
}
