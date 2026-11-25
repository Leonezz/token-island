import Foundation

// MARK: - Local Collector Process Supervisor
//
// Launches and keeps alive the bundled `collector.mjs` daemon whenever
// `AppSettings.serverMode == .local` (and not in `--demo` fixture mode).
//
// Key behaviors:
//  1. Coexistence: probes `127.0.0.1:<port>/api/health` first. If an external
//     collector (CLI or LaunchAgent) is already serving that port, attaches to
//     it passively without EADDRINUSE conflicts, and takes over automatically
//     if the external daemon ever stops.
//  2. GUI PATH discovery: searches Homebrew, Volta, Mise, fnm, nvm, asdf, and
//     system locations for Node.js >= 22.5 (since LSUIElement apps do not
//     inherit interactive shell PATH).
//  3. Keep-alive supervision: monitors child process health every 3.5s and
//     restarts crashed processes with bounded exponential backoff (1s..8s).

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

    // MARK: Supervision Loop

    private func superviseLoop(port: Int) async {
        var consecutiveSpawns = 0

        while !Task.isCancelled {
            let healthy = await Self.probeHealth(port: port)

            if healthy {
                consecutiveSpawns = 0
                if let proc = managedProcess, proc.isRunning {
                    state = .runningManaged(pid: proc.processIdentifier, port: port)
                } else {
                    managedProcess = nil
                    state = .runningExternal(port: port)
                }
                try? await Task.sleep(nanoseconds: 3_500_000_000)
                continue
            }

            // Port is not responding. If our managed process is dead (or never started), spawn it.
            if let proc = managedProcess, proc.isRunning {
                // Give a freshly launched process a short window before declaring it wedged.
                try? await Task.sleep(nanoseconds: 1_500_000_000)
                if await Self.probeHealth(port: port) {
                    consecutiveSpawns = 0
                    state = .runningManaged(pid: proc.processIdentifier, port: port)
                    continue
                }
                terminateManagedProcess()
            }

            guard !Task.isCancelled else { break }

            state = .starting(port: port)
            let spawnResult = await spawnCollector(port: port)
            switch spawnResult {
            case .success(let pid):
                consecutiveSpawns += 1
                // Poll up to 4.5s for HTTP server readiness.
                var ready = false
                for _ in 0..<18 {
                    if Task.isCancelled { return }
                    try? await Task.sleep(nanoseconds: 250_000_000)
                    if await Self.probeHealth(port: port) {
                        ready = true
                        break
                    }
                    if let proc = managedProcess, !proc.isRunning {
                        break
                    }
                }
                if ready {
                    consecutiveSpawns = 0
                    state = .runningManaged(pid: pid, port: port)
                } else if await Self.probeHealth(port: port) {
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

        let process = Process()
        process.executableURL = URL(fileURLWithPath: nodePath)
        process.arguments = [
            "--no-warnings",
            scriptPath,
            "collect",
            "--foreground",
            "--port",
            String(port),
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

    // MARK: Health & Binary Discovery

    nonisolated static func probeHealth(port: Int) async -> Bool {
        guard let url = URL(string: "http://127.0.0.1:\(port)/api/health") else { return false }
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = 1.0
        request.cachePolicy = .reloadIgnoringLocalCacheData
        do {
            let (_, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse else { return false }
            return (200..<300).contains(http.statusCode)
        } catch {
            return false
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
