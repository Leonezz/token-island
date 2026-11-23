import Foundation

// MARK: - Configuration
//
// The widget only needs the collector port and (optionally) the cloud URL.
// Sources, in priority order:
//   1. `TOKEN_ISLAND_PORT` / `TOKEN_ISLAND_CONFIG` environment variables
//   2. `~/.token-island/config.json` (shared with collector + CLI)
//   3. built-in defaults (port 47118)

struct IslandConfig {
    var port: Int = 47118
    var cloudURL: URL?
    var cloudEnabled: Bool = false
    /// Human readable source of the port for diagnostics / offline caption.
    var configPath: String?

    static let defaultPort = 47118

    /// Loads the config from disk, tolerating a missing/corrupt file.
    static func load(environment: [String: String] = ProcessInfo.processInfo.environment) -> IslandConfig {
        var config = IslandConfig()

        let explicitPath = environment["TOKEN_ISLAND_CONFIG"]
            ?? (expandTilde("~/.token-island/config.json"))
        config.configPath = explicitPath

        if let data = FileManager.default.contents(atPath: explicitPath),
           let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            if let port = intValue(object["port"]) {
                config.port = port
            }
            if let cloud = object["cloud"] as? [String: Any] {
                if let enabled = cloud["enabled"] as? Bool {
                    config.cloudEnabled = enabled
                }
                if let raw = cloud["url"] as? String, let url = URL(string: raw) {
                    config.cloudURL = url
                }
            }
        }

        if let raw = environment["TOKEN_ISLAND_PORT"], let port = Int(raw) {
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
