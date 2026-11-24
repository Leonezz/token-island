import Foundation

// MARK: - Launch-at-login helper (contract §1.4 Preferences)
//
// Writes / removes `~/Library/LaunchAgents/com.token-island.app.plist` pointing
// at the *current* app bundle executable, then loads / unloads it with
// launchctl. Failure is reported, never fatal. A `TOKEN_ISLAND_LAUNCH_AGENTS_DIR`
// override exists so the packaging scripts can exercise the logic with a
// workspace-local staging directory (agents cannot write ~/Library).

enum LoginItem {
    static let label = "com.token-island.app"

    static var directoryURL: URL {
        if let override = ProcessInfo.processInfo.environment["TOKEN_ISLAND_LAUNCH_AGENTS_DIR"],
           !override.isEmpty {
            return URL(fileURLWithPath: override)
        }
        return FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/LaunchAgents")
    }

    static var plistURL: URL {
        directoryURL.appendingPathComponent("\(label).plist")
    }

    static var isInstalled: Bool {
        FileManager.default.fileExists(atPath: plistURL.path)
    }

    static var executablePath: String {
        Bundle.main.executableURL?.path
            ?? URL(fileURLWithPath: CommandLine.arguments.first ?? "/Applications/TokenIsland.app/Contents/MacOS/TokenIsland").path
    }

    /// Registers (enabled = true) or removes (false) the login item.
    /// Returns nil on success, or a human readable error.
    @discardableResult
    static func setEnabled(_ enabled: Bool) -> String? {
        enabled ? install() : remove()
    }

    private static func install() -> String? {
        do {
            try FileManager.default.createDirectory(at: directoryURL, withIntermediateDirectories: true)
            try makePlist(executablePath: executablePath).write(to: plistURL, atomically: true, encoding: .utf8)
        } catch {
            return "cannot write \(plistURL.lastPathComponent): \(error.localizedDescription)"
        }
        // Unload a previous registration, then load the fresh plist.
        _ = launchctl(["unload", "-w", plistURL.path])
        let load = launchctl(["load", "-w", plistURL.path])
        if load.status != 0 {
            let error = (load.stderr ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            // sudo-free bootstrap fallback (newer launchd).
            let bootstrap = launchctl(["bootstrap", "gui/\(uid())", plistURL.path])
            if bootstrap.status != 0 {
                return "LaunchAgent written but launchctl could not load it" + (error.isEmpty ? "" : " (\(error))")
            }
        }
        return nil
    }

    private static func remove() -> String? {
        _ = launchctl(["unload", "-w", plistURL.path])
        _ = launchctl(["bootout", "gui/\(uid())/\(label)"])
        do {
            if FileManager.default.fileExists(atPath: plistURL.path) {
                try FileManager.default.removeItem(at: plistURL)
            }
        } catch {
            return "cannot remove \(plistURL.lastPathComponent): \(error.localizedDescription)"
        }
        return nil
    }

    /// The widget LaunchAgent (RunAtLoad, KeepAlive false, Aqua session).
    static func makePlist(executablePath: String) -> String {
        let log = IslandConfig.expandTilde("~/Library/Logs/TokenIsland.log")
        return """
        <?xml version="1.0" encoding="UTF-8"?>
        <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
        <plist version="1.0">
        <dict>
            <key>Label</key>
            <string>\(label)</string>
            <key>ProgramArguments</key>
            <array>
                <string>\(executablePath)</string>
            </array>
            <key>RunAtLoad</key>
            <true/>
            <key>KeepAlive</key>
            <false/>
            <key>LimitLoadToSessionType</key>
            <string>Aqua</string>
            <key>ProcessType</key>
            <string>Interactive</string>
            <key>StandardOutPath</key>
            <string>\(log)</string>
            <key>StandardErrorPath</key>
            <string>\(log)</string>
        </dict>
        </plist>
        """
    }

    // MARK: launchctl

    private static func launchctl(_ arguments: [String]) -> (status: Int32, stderr: String?) {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/launchctl")
        process.arguments = arguments
        let stderr = Pipe()
        process.standardError = stderr
        process.standardOutput = Pipe()
        do {
            try process.run()
            process.waitUntilExit()
        } catch {
            return (-1, error.localizedDescription)
        }
        let data = stderr.fileHandleForReading.readDataToEndOfFile()
        return (process.terminationStatus, String(data: data, encoding: .utf8))
    }

    private static func uid() -> uid_t {
        getuid()
    }
}
