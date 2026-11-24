import Foundation

// MARK: - Configuration
//
// Shared configuration across the macOS app, collector daemon, and CLI.
// Sources, in priority order:
//   1. `TOKEN_ISLAND_PORT` / `TOKEN_ISLAND_CONFIG` environment variables
//   2. `~/.token-island/config.json` (shared with collector + CLI)
//   3. built-in defaults (port 47118)

struct IslandConfig {
    var port: Int = 47118
    var cloudURL: URL?
    var cloudURLString: String = ""
    var cloudUsername: String = ""
    var cloudAPIKey: String = ""
    var cloudEnabled: Bool = false
    /// Path to `config.json` for diagnostics and atomic updates.
    var configPath: String?

    static let defaultPort = 47118

    /// Loads the config from disk, tolerating a missing/corrupt file.
    static func load(environment: [String: String] = ProcessInfo.processInfo.environment) -> IslandConfig {
        var config = IslandConfig()

        let explicitPath = environment["TOKEN_ISLAND_CONFIG"]
            ?? expandTilde("~/.token-island/config.json")
        config.configPath = explicitPath

        if let data = FileManager.default.contents(atPath: explicitPath),
           let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            if let port = intValue(object["port"]), (1...65_535).contains(port) {
                config.port = port
            }
            if let cloud = object["cloud"] as? [String: Any] {
                if let enabled = cloud["enabled"] as? Bool {
                    config.cloudEnabled = enabled
                }
                if let raw = cloud["url"] as? String {
                    let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
                    config.cloudURLString = trimmed
                    if let url = URL(string: trimmed) {
                        config.cloudURL = url
                    }
                }
                if let username = cloud["username"] as? String {
                    config.cloudUsername = username.trimmingCharacters(in: .whitespacesAndNewlines)
                }
                if let apiKey = cloud["apiKey"] as? String {
                    config.cloudAPIKey = apiKey.trimmingCharacters(in: .whitespacesAndNewlines)
                }
            }
        }

        if let raw = environment["TOKEN_ISLAND_PORT"], let port = Int(raw), (1...65_535).contains(port) {
            config.port = port
        }
        return config
    }

    private static func intValue(_ value: Any?) -> Int? {
        if let int = value as? Int { return int }
        if let number = value as? NSNumber { return number.intValue }
        if let double = value as? Double { return Int(double) }
        if let string = value as? String { return Int(string) }
        return nil
    }

    static func expandTilde(_ path: String) -> String {
        NSString(string: path).expandingTildeInPath
    }
}

// MARK: - Atomic Config Persistence & URL Normalization

enum ServerEndpointResolver {
    struct ResolvedEndpoint {
        let baseURL: URL
        let baseString: String
        let username: String?
    }

    /// Normalizes a user-entered server URL (e.g. `https://host/u/alice`,
    /// `http://127.0.0.1:47117`, or `tokens.example.com`) into a clean base URL
    /// plus optional extracted username.
    static func resolve(rawURL: String, explicitUsername: String) -> ResolvedEndpoint? {
        var trimmed = rawURL.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }

        if !trimmed.contains("://") {
            let lower = trimmed.lowercased()
            let isLocal = lower.hasPrefix("localhost")
                || lower.hasPrefix("127.")
                || lower.hasPrefix("192.168.")
                || lower.hasPrefix("10.")
            trimmed = (isLocal ? "http://" : "https://") + trimmed
        }

        while trimmed.hasSuffix("/") {
            trimmed.removeLast()
        }

        guard var components = URLComponents(string: trimmed),
              let scheme = components.scheme?.lowercased(),
              (scheme == "http" || scheme == "https"),
              components.host != nil else {
            return nil
        }

        var extractedUser: String?
        let path = components.path
        if let range = path.range(of: "/u/") {
            let tail = String(path[range.upperBound...])
            let handle = tail.split(separator: "/").first.map(String.init) ?? ""
            if !handle.isEmpty {
                extractedUser = handle
            }
            let prefix = String(path[..<range.lowerBound])
            components.path = prefix
        } else if path == "/api/summary" || path.hasPrefix("/api/v1") {
            components.path = ""
        }
        components.query = nil
        components.fragment = nil

        guard let cleanURL = components.url else { return nil }
        var cleanString = cleanURL.absoluteString
        while cleanString.hasSuffix("/") {
            cleanString.removeLast()
        }

        let cleanExplicit = explicitUsername.trimmingCharacters(in: .whitespacesAndNewlines)
        let effectiveUser = !cleanExplicit.isEmpty ? cleanExplicit : extractedUser
        return ResolvedEndpoint(
            baseURL: URL(string: cleanString) ?? cleanURL,
            baseString: cleanString,
            username: effectiveUser
        )
    }
}

enum ConfigWriter {
    /// Atomically merges updated port and server URL/username into `~/.token-island/config.json`
    /// while preserving existing keys (`apiKey`, `prices`, `paths`, `sources`) and `0600` permissions.
    @discardableResult
    static func savePreferences(
        configPath: String,
        port: Int,
        serverURL: String,
        username: String
    ) -> Bool {
        let fileManager = FileManager.default
        let fileURL = URL(fileURLWithPath: configPath)
        let directoryURL = fileURL.deletingLastPathComponent()

        do {
            try fileManager.createDirectory(
                at: directoryURL,
                withIntermediateDirectories: true,
                attributes: [.posixPermissions: 0o700]
            )
        } catch {
            Logger.error("cannot create config dir \(directoryURL.path): \(error.localizedDescription)")
            return false
        }

        var root: [String: Any] = [:]
        if let data = fileManager.contents(atPath: configPath),
           let parsed = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            root = parsed
        }

        root["port"] = port

        var cloud = (root["cloud"] as? [String: Any]) ?? [:]
        let resolved = ServerEndpointResolver.resolve(rawURL: serverURL, explicitUsername: username)
        if let resolved {
            cloud["url"] = resolved.baseString
            if let user = resolved.username, !user.isEmpty {
                cloud["username"] = user
            } else if username.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                // Preserve existing username unless explicitly cleared when URL had none
            }
            if let apiKey = cloud["apiKey"] as? String, !apiKey.isEmpty, cloud["enabled"] == nil {
                cloud["enabled"] = true
            }
        } else if serverURL.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            cloud["url"] = ""
        }
        let cleanUser = username.trimmingCharacters(in: .whitespacesAndNewlines)
        if !cleanUser.isEmpty {
            cloud["username"] = cleanUser
        }
        root["cloud"] = cloud

        guard JSONSerialization.isValidJSONObject(root),
              let encoded = try? JSONSerialization.data(withJSONObject: root, options: [.prettyPrinted, .sortedKeys]) else {
            return false
        }

        var output = encoded
        output.append(0x0A)

        do {
            try output.write(to: fileURL, options: .atomic)
            try? fileManager.setAttributes([.posixPermissions: 0o600], ofItemAtPath: configPath)
            return true
        } catch {
            Logger.error("cannot write config \(configPath): \(error.localizedDescription)")
            return false
        }
    }
}

// MARK: - Fixture loading
//
// Used by `--demo`, `--snapshot` and `--snapshot-all`. Resolution order:
// explicit path -> TOKEN_ISLAND_FIXTURE -> bundled resource -> repo fixtures
// (walking up from the executable) -> current working directory.

enum FixtureLoader {
    static let fileName = "summary.example.json"

    static func envOverride() -> String? {
        ProcessInfo.processInfo.environment["TOKEN_ISLAND_FIXTURE"]
    }

    /// First existing candidate path for the fixture, or nil.
    static func locateDefault() -> String? {
        candidates().first { FileManager.default.fileExists(atPath: $0) }
    }

    static func candidates() -> [String] {
        var paths: [String] = []
        if let override = envOverride() { paths.append(override) }
        if let resource = Bundle.main.resourceURL {
            paths.append(resource.appendingPathComponent(fileName).path)
        }
        let executable = Bundle.main.executableURL
            ?? URL(fileURLWithPath: CommandLine.arguments.first ?? "TokenIsland")
        var directory = executable.deletingLastPathComponent()
        for _ in 0..<7 {
            paths.append(directory.appendingPathComponent("fixtures/\(fileName)").path)
            paths.append(directory.appendingPathComponent("Resources/\(fileName)").path)
            directory = directory.deletingLastPathComponent()
        }
        paths.append(FileManager.default.currentDirectoryPath + "/fixtures/\(fileName)")
        return paths
    }

    static func load(path: String?) -> Summary? {
        guard let path else {
            Logger.error("fixture path not found (looked for \(fileName))")
            return nil
        }
        guard let data = FileManager.default.contents(atPath: path) else {
            Logger.error("cannot read fixture at \(path)")
            return nil
        }
        do {
            return try JSONDecoder().decode(Summary.self, from: data)
        } catch {
            Logger.error("fixture decode failed at \(path): \(error)")
            return nil
        }
    }

    /// Path to use: explicit flag wins, otherwise the first existing default.
    static func resolve(explicit: String?) -> String? {
        if let explicit {
            return FileManager.default.fileExists(atPath: explicit) ? explicit : nil
        }
        return locateDefault()
    }
}

// MARK: - Tiny stderr logger

enum Logger {
    static func error(_ message: String) {
        FileHandle.standardError.write(Data(("[token-island] " + message + "\n").utf8))
    }

    static func info(_ message: String) {
        // Flush explicitly: when launchd or a shell redirects stdout to a file,
        // stdio is block-buffered and a killed process would lose its log lines.
        print("[token-island] " + message)
        fflush(stdout)
    }
}
