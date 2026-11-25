import AppKit
import SwiftUI

// MARK: - Snapshot writer
//
// Renders the real pixel UI headlessly with SwiftUI's ImageRenderer (macOS 13+)
// and writes a PNG. This is how the Lead / QA verify the widget without screen
// recording permission, so it must never show a window and must be
// deterministic (no animation phase, fixed fixture clock, dithered wallpaper).
//
// Canvas sizes:
//  - wallpaper   : 960 x 600 @1x (1920 x 1200 at --scale 2, 16:10), island pinned
//                  to the top edge like it is on screen, over the pixel-art
//                  desktop crop.
//  - transparent : island + 16pt of padding on every side (multiple of 8).

@MainActor
enum SnapshotWriter {

    static let transparentPadding: CGFloat = 16
    static let wallpaperSize = CGSize(width: 960, height: 640)

    /// Canvas size (points) for the requested background.
    static func canvasSize(islandSize: CGSize, background: SnapshotBackground) -> CGSize {
        switch background {
        case .transparent:
            return CGSize(
                width: islandSize.width + transparentPadding * 2,
                height: islandSize.height + transparentPadding * 2
            )
        case .wallpaper:
            return wallpaperSize
        }
    }

    /// Renders the island (optionally over the synthetic wallpaper) at `scale`.
    static func render(
        state: SnapshotState,
        summary: Summary,
        offline: Bool,
        port: Int,
        scale: CGFloat,
        background: SnapshotBackground
    ) -> CGImage? {
        let expanded = state != .collapsed
        let isOffline = offline || state == .offline
        let referenceNow = summary.referenceNow
        let status: IslandStatus = isOffline
            ? .offline
            : (summary.isLive(now: referenceNow) ? .live : .idle)
        let islandSize = DS.Size.island(expanded: expanded)

        let island = IslandSurface(
            summary: summary,
            expanded: expanded,
            pinned: expanded,
            status: status,
            offline: isOffline,
            port: port,
            now: referenceNow,
            toast: nil,
            animated: false,
            onPinToggle: {},
            onCollapsedTap: nil
        )

        let canvas = canvasSize(islandSize: islandSize, background: background)
        let content: AnyView
        switch background {
        case .wallpaper:
            let islandX = ((canvas.width - islandSize.width) / 2).rounded()
            content = AnyView(
                ZStack(alignment: .topLeading) {
                    WallpaperView()
                        .frame(width: canvas.width, height: canvas.height)
                    island
                        .offset(x: islandX, y: 0)
                }
                .frame(width: canvas.width, height: canvas.height, alignment: .topLeading)
            )
        case .transparent:
            content = AnyView(
                ZStack(alignment: .topLeading) {
                    island
                        .offset(x: transparentPadding, y: transparentPadding)
                }
                .frame(width: canvas.width, height: canvas.height, alignment: .topLeading)
            )
        }

        let renderer = ImageRenderer(content: content)
        renderer.scale = scale
        renderer.isOpaque = background == .wallpaper
        renderer.proposedSize = ProposedViewSize(canvas)
        return renderer.cgImage
    }

    /// Renders an arbitrary pixel view (used for the About / Preferences QA
    /// snapshots; these windows are normally only visible on screen).
    static func render<V: View>(view: V, size: CGSize, scale: CGFloat) -> CGImage? {
        let renderer = ImageRenderer(content: view.frame(width: size.width, height: size.height))
        renderer.scale = scale
        renderer.isOpaque = true
        renderer.proposedSize = ProposedViewSize(size)
        return renderer.cgImage
    }

    /// Writes a PNG for an arbitrary view and prints its absolute path.
    @discardableResult
    static func write<V: View>(view: V, size: CGSize, scale: CGFloat, to path: String) -> Bool {
        guard let image = render(view: view, size: size, scale: scale) else {
            Logger.error("snapshot render failed for \(path)")
            return false
        }
        guard let data = pngData(image, scale: scale) else {
            Logger.error("snapshot PNG encoding failed for \(path)")
            return false
        }
        let url = URL(fileURLWithPath: path).standardizedFileURL
        do {
            try FileManager.default.createDirectory(
                at: url.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
            try data.write(to: url)
            print(url.path)
            return true
        } catch {
            Logger.error("snapshot write failed: \(error.localizedDescription)")
            return false
        }
    }

    /// Renders and writes `path`; prints the absolute path like the contract
    /// requires. Returns false on failure.
    @discardableResult
    static func write(
        state: SnapshotState,
        summary: Summary,
        offline: Bool,
        port: Int,
        scale: CGFloat,
        background: SnapshotBackground,
        to path: String
    ) -> Bool {
        guard let image = render(
            state: state,
            summary: summary,
            offline: offline,
            port: port,
            scale: scale,
            background: background
        ) else {
            Logger.error("snapshot render failed (\(state.rawValue)/\(background.rawValue))")
            return false
        }
        guard let data = pngData(image, scale: scale) else {
            Logger.error("snapshot PNG encoding failed (\(state.rawValue)/\(background.rawValue))")
            return false
        }
        let url = URL(fileURLWithPath: path).standardizedFileURL
        do {
            try FileManager.default.createDirectory(
                at: url.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
            try data.write(to: url)
            print(url.path)
            return true
        } catch {
            Logger.error("snapshot write failed: \(error.localizedDescription)")
            return false
        }
    }

    /// PNG data with the right pixel density (`size` = logical points).
    static func pngData(_ image: CGImage, scale: CGFloat) -> Data? {
        let representation = NSBitmapImageRep(cgImage: image)
        representation.size = NSSize(
            width: CGFloat(image.width) / scale,
            height: CGFloat(image.height) / scale
        )
        return representation.representation(using: .png, properties: [:])
    }
}

// MARK: - Snapshot CLI runner

@MainActor
enum SnapshotRunner {

    static let states: [SnapshotState] = [.collapsed, .expanded, .offline]
    static let backgrounds: [SnapshotBackground] = [.wallpaper, .transparent]

    /// Handles `--snapshot` / `--snapshot-all`. Exits the process afterwards
    /// (no window is ever created).
    static func run(_ options: LaunchOptions) {
        PixelFont.registerBundledFonts()
        var failed = false

        if let job = options.snapshot {
            let summary = loadSummary(explicit: job.fixture, fallbackToEmpty: false)
            let ok = SnapshotWriter.write(
                state: job.state,
                summary: summary,
                offline: job.state == .offline,
                port: IslandConfig.load().port,
                scale: job.scale,
                background: job.background,
                to: job.outputPath
            )
            failed = failed || !ok
        }

        if let directory = options.snapshotUI {
            let base = URL(fileURLWithPath: directory).standardizedFileURL.path
            let config = IslandConfig.load()
            let settings = AppSettings(config: config)
            let model = IslandModel(config: config, demoMode: true, fixturePath: nil, settings: settings)
            model.start()
            let aboutOK = SnapshotWriter.write(
                view: AboutView(),
                size: CGSize(width: 400, height: 330),
                scale: 2,
                to: base + "/about.png"
            )
            let prefsOK = SnapshotWriter.write(
                view: PreferencesView(
                    settings: settings,
                    model: model,
                    supervisor: model.supervisor,
                    githubAuth: model.githubAuth
                ),
                size: CGSize(
                    width: PreferencesWindowController.windowSize.width,
                    height: PreferencesWindowController.windowSize.height
                ),
                scale: 2,
                to: base + "/preferences.png"
            )
            failed = failed || !aboutOK || !prefsOK
        }

        if let directory = options.snapshotAll {
            let summary = loadSummary(explicit: options.snapshotAllFixture, fallbackToEmpty: false)
            let base = URL(fileURLWithPath: directory).standardizedFileURL
            do {
                try FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
            } catch {
                Logger.error("cannot create snapshot directory \(base.path): \(error.localizedDescription)")
                failed = true
            }
            for state in states {
                for background in backgrounds {
                    let suffix = background == .transparent ? "-transparent" : ""
                    let path = base.appendingPathComponent("island-\(state.rawValue)\(suffix).png").path
                    let ok = SnapshotWriter.write(
                        state: state,
                        summary: summary,
                        offline: state == .offline,
                        port: IslandConfig.load().port,
                        scale: options.snapshotAllScale,
                        background: background,
                        to: path
                    )
                    failed = failed || !ok
                }
            }
        }

        fflush(stdout)
        exit(failed ? 1 : 0)
    }

    static func loadSummary(explicit: String?, fallbackToEmpty: Bool) -> Summary {
        if let path = FixtureLoader.resolve(explicit: explicit),
           let summary = FixtureLoader.load(path: path) {
            return summary
        }
        if let path = FixtureLoader.locateDefault(), let summary = FixtureLoader.load(path: path) {
            return summary
        }
        Logger.error("no Summary fixture found; rendering empty island")
        return .empty
    }
}
