import Darwin
import Foundation

// MARK: - Local Collector Process Supervisor
//
// Launches and keeps alive the bundled `collector.mjs` daemon whenever
// `AppSettings.serverMode == .local` (and not in `--demo` fixture mode).
//
// Key behaviors:
//  1. Dashboard-aware coexistence & self-healing: probes both `/api/health` AND
//     `HEAD /` on `127.0.0.1:<port>`. If an up-to-date external collector is
//     already serving the dashboard, attaches passively; if a stale pre-dashboard
//     collector (`/` -> 404) or legacy `com.token-island.collector` LaunchAgent
//     is occupying the port, automatically evicts it and spawns the bundled
//     `collector.mjs`.
//  2. Parent-lifetime binding: passes `--parent-pid <pid>` so managed
//     `collector.mjs` exits cleanly within 2.5s if `TokenIsland.app` quits or
//     is replaced during an upgrade.
//  3. GUI PATH discovery: searches Homebrew, Volta, Mise, fnm, nvm, asdf, and
//     system locations for Node.js >= 22.5.
//  4. Keep-alive supervision: monitors child process health every 3.5s and
//     restarts crashed processes with bounded exponential backoff (1s..8s).

enum LocalCollectorProbe: Equatable {
    case offline
    case ready
    case staleNoDashboard
}

@MainActor
final class CollectorSupervisor: ObservableObject {

    enum State: Equatable {
        case stopped
        case starting(port: Int)
        case runningManaged(pid: Int32, port: Int)
        case runningExternal(port: Int)
        case failed(String)

        var badgeText: String {
            switch self {
            case .stopped:
                return "Stopped"
            case .starting:
                return "Starting…"
            case .runningManaged(let pid, _):
                return "Managed · PID \(pid)"
            case .runningExternal:
                return "External · Active"
            case .failed:
                return "Unavailable"
            }
        }

        var isHealthy: Bool {
            switch self {
            case .runningManaged, .runningExternal:
                return true
            default:
                return false
            }
        }
    }

    @Published private(set) var state: State = .stopped

    private var superviseTask: Task<Void, Never>?
    private var managedProcess: Process?
    private var logFileHandle: FileHandle?
    private var activePort: Int?
    private var cachedNodePath: String?

    deinit {
        superviseTask?.cancel()
    }

    // MARK: Public Control

    func activate(port: Int) {
        if activePort == port, superviseTask != nil {
            return
        }
        deactivate()
        activePort = port
        state = .starting(port: port)
        superviseTask = Task { [weak self] in
            await self?.superviseLoop(port: port)
        }
    }

    func deactivate() {
        superviseTask?.cancel()
        superviseTask = nil
        activePort = nil
        terminateManagedProcess()
        state = .stopped
    }

    func restart(port: Int) {
        deactivate()
        activate(port: port)
    }

    /// Stops any managed OR external Token Island collector bound to `port`,
    /// then immediately launches a fresh managed `collector.mjs` instance.
    func forceRestart(port: Int) async {
        deactivate()
        state = .starting(port: port)
        if await Self.inspectCollector(port: port) != .offline {
            await Self.evictStaleCollector(port: port)
        }
        activate(port: port)
    }

    // MARK: Supervision Loop

    private func superviseLoop(port: Int) async {
        var consecutiveSpawns = 0

        while !Task.isCancelled {
            let probe = await Self.inspectCollector(port: port)

            switch probe {
            case .ready:
                consecutiveSpawns = 0
                if let proc = managedProcess, proc.isRunning {
                    state = .runningManaged(pid: proc.processIdentifier, port: port)
                } else {
                    managedProcess = nil
                    state = .runningExternal(port: port)
                }
                try? await Task.sleep(nanoseconds: 3_500_000_000)
                continue

            case .staleNoDashboard:
                Logger.info("replacing stale collector without dashboard route on 127.0.0.1:\(port)")
                state = .starting(port: port)
                terminateManagedProcess()
                await Self.evictStaleCollector(port: port)

            case .offline:
                // Port is not responding. Give a freshly launched managed process a brief window before restarting it.
                if let proc = managedProcess, proc.isRunning {
                    try? await Task.sleep(nanoseconds: 1_500_000_000)
                    if await Self.isDashboardReady(port: port) {
                        consecutiveSpawns = 0
                        state = .runningManaged(pid: proc.processIdentifier, port: port)
                        continue
                    }
                    terminateManagedProcess()
                }
            }

            guard !Task.isCancelled else { break }

            state = .starting(port: port)
            let spawnResult = await spawnCollector(port: port)
            switch spawnResult {
            case .success:
                consecutiveSpawns += 1
                // Poll up to 5.0s for both `/api/health` and `/` dashboard readiness.
                var ready = false
                for _ in 0..<20 {
                    if Task.isCancelled { return }
                    try? await Task.sleep(nanoseconds: 250_000_000)
                    if await Self.isDashboardReady(port: port) {
                        ready = true
                        break
                    }
                    if let proc = managedProcess, !proc.isRunning {
                        break
                    }
                }
                if ready {
                    consecutiveSpawns = 0
                    if let proc = managedProcess, proc.isRunning {
                        state = .runningManaged(pid: proc.processIdentifier, port: port)
                    } else {
                        state = .runningExternal(port: port)
                    }
                } else if await Self.isDashboardReady(port: port) {
                    state = .runningExternal(port: port)
                } else {
                    let delaySec = min(8.0, pow(2.0, Double(max(0, consecutiveSpawns - 1))))
                    state = .failed("Local collector exited before binding 127.0.0.1:\(port) · retrying")
                    try? await Task.sleep(nanoseconds: UInt64(delaySec * 1_000_000_000))
                }

            case .failure(let reason):
                state = .failed(reason.message)
                try? await Task.sleep(nanoseconds: 6_000_000_000)
            }
        }
    }

    private struct SpawnFailure: Error {
        let message: String
    }

    private func spawnCollector(port: Int) async -> Result<Int32, SpawnFailure> {
        let nodePath: String
        if let cached = cachedNodePath, FileManager.default.isExecutableFile(atPath: cached) {
            nodePath = cached
        } else if let discovered = await Task.detached(priority: .utility, operation: {
            Self.discoverNodeBinary()
        }).value {
            cachedNodePath = discovered
            nodePath = discovered
        } else {
            return .failure(SpawnFailure(message: "Node.js 22.5+ not found (install via `brew install node`)"))
        }

        guard let scriptPath = Self.locateCollectorScript() else {
            return .failure(SpawnFailure(message: "Bundled collector.mjs resource missing from app bundle"))
        }

        let parentPID = ProcessInfo.processInfo.processIdentifier
        let process = Process()
        process.executableURL = URL(fileURLWithPath: nodePath)
        process.arguments = [
            "--no-warnings",
            scriptPath,
            "collect",
            "--foreground",
            "--port",
            String(port),
            "--parent-pid",
            String(parentPID),
        ]

        var env = ProcessInfo.processInfo.environment
        env["TOKEN_ISLAND_PORT"] = String(port)
        if let keychainKey = KeychainStore.readAPIKey(), !keychainKey.isEmpty {
            env["TOKEN_ISLAND_API_KEY"] = keychainKey
        }
        let nodeDir = URL(fileURLWithPath: nodePath).deletingLastPathComponent().path
        let existingPath = env["PATH"] ?? "/usr/bin:/bin:/usr/sbin:/sbin"
        env["PATH"] = "\(nodeDir):/opt/homebrew/bin:/usr/local/bin:\(existingPath)"
        process.environment = env

        if let handle = openLogFile() {
            process.standardOutput = handle
            process.standardError = handle
        } else {
            process.standardOutput = FileHandle.nullDevice
            process.standardError = FileHandle.nullDevice
        }

        do {
            try process.run()
            managedProcess = process
            let pid = process.processIdentifier
            Logger.info("launched local collector (pid=\(pid), port=\(port), script=\(scriptPath))")
            return .success(pid)
        } catch {
            return .failure(SpawnFailure(message: "Failed to launch collector: \(error.localizedDescription)"))
        }
    }

    private func terminateManagedProcess() {
        if let proc = managedProcess {
            if proc.isRunning {
                Logger.info("stopping managed local collector (pid=\(proc.processIdentifier))")
                proc.terminate()
            }
            managedProcess = nil
        }
        try? logFileHandle?.close()
        logFileHandle = nil
    }

    private func openLogFile() -> FileHandle? {
        try? logFileHandle?.close()
        logFileHandle = nil

        let logPath = IslandConfig.expandTilde("~/Library/Logs/TokenIsland-collector.log")
        let logURL = URL(fileURLWithPath: logPath)
        let dirURL = logURL.deletingLastPathComponent()
        try? FileManager.default.createDirectory(at: dirURL, withIntermediateDirectories: true)
        if !FileManager.default.fileExists(atPath: logPath) {
            FileManager.default.createFile(atPath: logPath, contents: nil)
        }
        guard let handle = try? FileHandle(forWritingTo: logURL) else { return nil }
        _ = try? handle.seekToEnd()
        logFileHandle = handle
        return handle
    }

    // MARK: Health, Dashboard Readiness & Stale Process Eviction

    nonisolated static func inspectCollector(port: Int) async -> LocalCollectorProbe {
        guard let healthURL = URL(string: "http://127.0.0.1:\(port)/api/health") else {
            return .offline
        }
        var healthReq = URLRequest(url: healthURL)
        healthReq.httpMethod = "GET"
        healthReq.timeoutInterval = 1.0
        healthReq.cachePolicy = .reloadIgnoringLocalCacheData
        do {
            let (data, response) = try await URLSession.shared.data(for: healthReq)
            guard let http = response as? HTTPURLResponse,
                  (200..<300).contains(http.statusCode) else {
                return .offline
            }
            // Verify this is genuinely a Token Island collector before inspecting or evicting it.
            guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  (json["ok"] as? Bool) == true,
                  json["dbPath"] != nil || json["uptimeSec"] != nil else {
                return .offline
            }
        } catch {
            return .offline
        }

        guard let rootURL = URL(string: "http://127.0.0.1:\(port)/") else {
            return .staleNoDashboard
        }
        var rootReq = URLRequest(url: rootURL)
        rootReq.httpMethod = "HEAD"
        rootReq.timeoutInterval = 1.2
        rootReq.cachePolicy = .reloadIgnoringLocalCacheData
        do {
            let (_, response) = try await URLSession.shared.data(for: rootReq)
            guard let http = response as? HTTPURLResponse else {
                return .staleNoDashboard
            }
            if (200..<300).contains(http.statusCode) {
                return .ready
            }
            return .staleNoDashboard
        } catch {
            return .staleNoDashboard
        }
    }

    nonisolated static func isDashboardReady(port: Int) async -> Bool {
        await inspectCollector(port: port) == .ready
    }

    nonisolated static func probeHealth(port: Int) async -> Bool {
        await inspectCollector(port: port) != .offline
    }

    /// Unloads any legacy `com.token-island.collector` LaunchAgent and terminates
    /// stale Token Island collector processes still holding `127.0.0.1:<port>`.
    nonisolated static func evictStaleCollector(port: Int) async {
        await Task.detached(priority: .utility) {
            let fm = FileManager.default
            let legacyPlist = fm.homeDirectoryForCurrentUser
                .appendingPathComponent("Library/LaunchAgents/com.token-island.collector.plist")
                .path
            if fm.fileExists(atPath: legacyPlist) {
                Logger.info("removing legacy LaunchAgent \(legacyPlist)")
                runShortProcess("/bin/launchctl", ["unload", "-w", legacyPlist])
                runShortProcess("/bin/launchctl", ["bootout", "gui/\(getuid())/com.token-island.collector"])
                try? fm.removeItem(atPath: legacyPlist)
            }

            let selfPID = getpid()
            let initialPIDs = listeningPIDs(onPort: port).filter { $0 > 1 && $0 != selfPID }
            guard !initialPIDs.isEmpty else { return }

            for pid in initialPIDs {
                Logger.info("sending SIGTERM to stale collector pid=\(pid) on port \(port)")
                _ = Darwin.kill(pid, SIGTERM)
            }

            for _ in 0..<12 {
                usleep(150_000)
                let remaining = listeningPIDs(onPort: port).filter { $0 > 1 && $0 != selfPID }
                if remaining.isEmpty {
                    return
                }
            }

            let stubborn = listeningPIDs(onPort: port).filter { $0 > 1 && $0 != selfPID }
            for pid in stubborn {
                Logger.info("sending SIGKILL to wedged collector pid=\(pid) on port \(port)")
                _ = Darwin.kill(pid, SIGKILL)
            }
            if !stubborn.isEmpty {
                usleep(200_000)
            }
        }.value
    }

    nonisolated private static func listeningPIDs(onPort port: Int) -> [pid_t] {
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: "/usr/sbin/lsof")
        proc.arguments = ["-nP", "-tiTCP:\(port)", "-sTCP:LISTEN"]
        let out = Pipe()
        proc.standardOutput = out
        proc.standardError = FileHandle.nullDevice
        do {
            try proc.run()
            proc.waitUntilExit()
            let data = out.fileHandleForReading.readDataToEndOfFile()
            guard let text = String(data: data, encoding: .utf8) else { return [] }
            return text
                .split(whereSeparator: \.isNewline)
                .compactMap { Int32($0.trimmingCharacters(in: .whitespaces)) }
        } catch {
            return []
        }
    }

    nonisolated private static func runShortProcess(_ executable: String, _ arguments: [String]) {
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: executable)
        proc.arguments = arguments
        proc.standardOutput = FileHandle.nullDevice
        proc.standardError = FileHandle.nullDevice
        do {
            try proc.run()
            proc.waitUntilExit()
        } catch {
            // Best-effort cleanup.
        }
    }


    nonisolated static func locateCollectorScript() -> String? {
        let fm = FileManager.default
        if let bundled = Bundle.main.url(forResource: "collector", withExtension: "mjs")?.path,
           fm.fileExists(atPath: bundled) {
            return bundled
        }
        if let resourceDir = Bundle.main.resourceURL?.appendingPathComponent("collector.mjs").path,
           fm.fileExists(atPath: resourceDir) {
            return resourceDir
        }

        let executable = Bundle.main.executableURL
            ?? URL(fileURLWithPath: CommandLine.arguments.first ?? "TokenIsland")
        var dir = executable.deletingLastPathComponent()
        for _ in 0..<8 {
            let resourceCandidate = dir.appendingPathComponent("Resources/collector.mjs").path
            if fm.fileExists(atPath: resourceCandidate) { return resourceCandidate }
            let repoResource = dir.appendingPathComponent("apps/island-macos/Resources/collector.mjs").path
            if fm.fileExists(atPath: repoResource) { return repoResource }
            let cliCandidate = dir.appendingPathComponent("bin/tokenisland.mjs").path
            if fm.fileExists(atPath: cliCandidate) { return cliCandidate }
            dir = dir.deletingLastPathComponent()
        }
        return nil
    }

    nonisolated static func discoverNodeBinary() -> String? {
        let fm = FileManager.default
        let home = fm.homeDirectoryForCurrentUser.path
        var candidates: [String] = []

        if let explicit = ProcessInfo.processInfo.environment["TOKEN_ISLAND_NODE"], !explicit.isEmpty {
            candidates.append(NSString(string: explicit).expandingTildeInPath)
        }

        candidates.append(contentsOf: [
            "/opt/homebrew/bin/node",
            "/usr/local/bin/node",
            "\(home)/.volta/bin/node",
            "\(home)/.local/share/mise/shims/node",
            "\(home)/.fnm/aliases/default/bin/node",
            "\(home)/Library/Application Support/fnm/aliases/default/bin/node",
            "\(home)/.asdf/shims/node",
        ])

        // Glob versioned installs (nvm & mise), highest version first
        for versionsRoot in [
            "\(home)/.nvm/versions/node",
            "\(home)/.local/share/mise/installs/node",
        ] {
            if let entries = try? fm.contentsOfDirectory(atPath: versionsRoot) {
                let sorted = entries.sorted { lhs, rhs in
                    lhs.compare(rhs, options: .numeric) == .orderedDescending
                }
                for entry in sorted {
                    candidates.append("\(versionsRoot)/\(entry)/bin/node")
                }
            }
        }

        candidates.append("/usr/bin/node")

        var seen = Set<String>()
        for path in candidates {
            guard !seen.contains(path) else { continue }
            seen.insert(path)
            guard fm.isExecutableFile(atPath: path) else { continue }
            if verifyNodeVersion(at: path) {
                return path
            }
        }
        return nil
    }

    nonisolated private static func verifyNodeVersion(at path: String) -> Bool {
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: path)
        proc.arguments = ["-p", "process.versions.node"]
        let pipe = Pipe()
        proc.standardOutput = pipe
        proc.standardError = FileHandle.nullDevice
        do {
            try proc.run()
            proc.waitUntilExit()
            guard proc.terminationStatus == 0 else { return false }
            let data = pipe.fileHandleForReading.readDataToEndOfFile()
            guard let text = String(data: data, encoding: .utf8)?
                .trimmingCharacters(in: .whitespacesAndNewlines) else { return false }
            let parts = text.split(separator: ".").compactMap { Int($0) }
            guard parts.count >= 2 else { return false }
            return parts[0] > 22 || (parts[0] == 22 && parts[1] >= 5)
        } catch {
            return false
        }
    }
}
