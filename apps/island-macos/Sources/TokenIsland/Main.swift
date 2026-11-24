import Foundation

// MARK: - Entry point
//
// Two modes:
//   * headless snapshot mode — renders PNGs with ImageRenderer, never creates a
//     window, prints the absolute output path(s) and exits 0.
//   * normal mode — runs the LSUIElement menu-bar app (NSPanel + status item).
//
// `main` is `async` on the main actor so SwiftUI's `ImageRenderer` and AppKit
// are usable directly without dispatching.

@main
@MainActor
struct TokenIslandMain {
    static func main() async {
        // Register the bundled Silkscreen TTFs before any view exists; both the
        // live app and snapshot mode render with the real pixel font.
        PixelFont.registerBundledFonts()
        // Load the Silkscreen dot-matrix glyph JSON once for the V3 hero figure.
        DotMatrix.loadBundledGlyphs()
        let options = LaunchOptions.parse(arguments: CommandLine.arguments)
        if options.isHeadless {
            SnapshotRunner.run(options)
            exit(0)
        }
        TokenIslandApp.run(options: options)
    }
}
