import Foundation

// MARK: - Command line interface

enum SnapshotState: String {
    case collapsed
    case expanded
    case offline
}

enum SnapshotBackground: String {
    case wallpaper
    case transparent
}

struct SnapshotJob {
    var outputPath: String
    var state: SnapshotState = .expanded
    var fixture: String?
    var scale: CGFloat = 2
    var background: SnapshotBackground = .wallpaper
}

struct LaunchOptions {
    /// Demo mode: load the bundled fixture, never touch the network.
    var demo = false
    /// One-shot PNG render.
    var snapshot: SnapshotJob?
    /// One-shot PNG render of every state into a directory.
    var snapshotAll: String?
    var snapshotAllFixture: String?
    var snapshotAllScale: CGFloat = 2

    var isHeadless: Bool { snapshot != nil || snapshotAll != nil }

    static func parse(arguments: [String]) -> LaunchOptions {
        var options = LaunchOptions()
        var index = 1
        let args = arguments

        func nextValue(_ flag: String) -> String? {
            guard index + 1 < args.count else {
                Logger.error("missing value for \(flag)")
                return nil
            }
            index += 1
            return args[index]
        }

        while index < args.count {
            let arg = args[index]
            switch arg {
            case "--demo":
                options.demo = true
            case "--snapshot":
                guard let out = nextValue("--snapshot") else { return options }
                var job = SnapshotJob(outputPath: out)
                index += 1
                while index < args.count {
                    switch args[index] {
                    case "--state":
                        if let value = nextValue("--state") {
                            job.state = SnapshotState(rawValue: value) ?? .expanded
                        }
                    case "--fixture":
                        job.fixture = nextValue("--fixture")
                    case "--scale":
                        if let value = nextValue("--scale"), let scale = Double(value) {
                            job.scale = scale >= 1.5 ? 2 : 1
                        }
                    case "--background":
                        if let value = nextValue("--background") {
                            job.background = SnapshotBackground(rawValue: value) ?? .wallpaper
                        }
                    default:
                        // Stop consuming when the next top-level flag appears.
                        if args[index] == "--snapshot-all" || args[index] == "--demo" {
                            break
                        }
                        index += 1
                        continue
                    }
                    index += 1
                }
                options.snapshot = job
            case "--snapshot-all":
                guard let dir = nextValue("--snapshot-all") else { return options }
                options.snapshotAll = dir
                index += 1
                while index < args.count {
                    switch args[index] {
                    case "--fixture":
                        options.snapshotAllFixture = nextValue("--fixture")
                    case "--scale":
                        if let value = nextValue("--scale"), let scale = Double(value) {
                            options.snapshotAllScale = scale >= 1.5 ? 2 : 1
                        }
                    default:
                        index += 1
                        continue
                    }
                    index += 1
                }
            case "--help", "-h":
                printUsage()
                exit(0)
            default:
                // Ignore unknown flags (LaunchServices injects e.g. -psn_…).
                Logger.error("ignoring unknown argument: \(arg)")
            }
            index += 1
        }
        return options
    }

    static func printUsage() {
        print(
            """
            TokenIsland — local-first token usage in your notch.

            Usage:
              TokenIsland [--demo]
              TokenIsland --snapshot <out.png> [--state collapsed|expanded|offline]
                          [--fixture <path>] [--scale 1|2] [--background wallpaper|transparent]
              TokenIsland --snapshot-all <dir> [--fixture <path>] [--scale 2]

            Options:
              --demo        run standalone with the bundled summary.example.json (no network)
              --snapshot    render one PNG headlessly and exit (no window is shown)
              --snapshot-all render collapsed/expanded/offline snapshots (wallpaper + transparent)
              --fixture     Summary JSON to render/use (default: bundled summary.example.json)
              --scale       1 or 2 (default 2 for snapshots)
              --background  wallpaper (16:10 synthetic desktop) or transparent (keeps alpha)
            """
        )
    }
}
