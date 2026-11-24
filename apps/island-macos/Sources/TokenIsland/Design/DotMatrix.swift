import AppKit
import SwiftUI

// MARK: - Dot-matrix data marks (V3)
//
// V3 principle: **readable text stays Silkscreen; dots are only used for data
// marks** — the hero figure, chart columns, sparkline and the status LED. This
// file owns the glyph-JSON dot renderer behind the hero figure and the small
// LED dot primitive (the only element allowed to glow).
//
// Glyph data: `assets/fonts/pixel-glyphs.json`, exported from core by
// `assets/fonts/export_glyphs.mjs`, copied into `Contents/Resources/` by
// `scripts/build-app.sh` and loaded exactly once at launch (Main.swift).
//
// Rendering law (V3 §2.1 + review): integer dot grid, pitch 4–5pt, scale 2 →
// a 40pt cap block. Figure dots are packed (≈0.48 × pitch) so glyph shapes read
// clearly even at 1x; the figure itself has NO halo — halo rings are reserved
// for the status LEDs and are plain low-alpha fills (never `blur`).

// MARK: Glyph JSON model

struct DotGlyph: Decodable {
    /// Advance width in font pixels (Silkscreen native 8px grid).
    let advance: Int
    /// Top offset relative to the cap line (negative values reach above it).
    let top: Int
    /// One string per font-pixel row; `#` is a lit pixel, `.` is unlit.
    let rows: [String]

    private enum CodingKeys: String, CodingKey {
        case advance = "a"
        case top = "t"
        case rows = "r"
    }
}

struct DotGlyphFont: Decodable {
    let font: String
    let license: String
    /// Capital height in font pixels (Silkscreen: 5).
    let capHeight: Int
    /// Cap top to descender bottom in font pixels (Silkscreen: 6).
    let textHeight: Int
    let ascent: Int
    let glyphs: [String: DotGlyph]
}

// MARK: Renderer

@MainActor
enum DotMatrix {

    // MARK: Figure geometry

    /// Hero figure dot pitch in points (contract: 4–5pt).
    static let figurePitch: CGFloat = 4
    /// Dots per font pixel (contract: scale 2).
    static let figureScale: Int = 2
    /// Dot radius: 0.48 × pitch packs adjacent dots together (~0.16pt gap) so
    /// the figure reads as clear glyph shapes at 1x while staying dot-textured.
    static let figureDotRadius: CGFloat = figurePitch * 0.48

    // MARK: Loaded font

    private(set) static var font: DotGlyphFont?
    private static var loadAttempted = false

    static var glyphCount: Int { font?.glyphs.count ?? 0 }
    static var isAvailable: Bool { font != nil }

    /// Loads the bundled glyph JSON once (called from `main` before any view).
    static func loadBundledGlyphs() {
        guard !loadAttempted else { return }
        loadAttempted = true
        guard let url = locateGlyphJSON() else {
            Logger.error("dotmatrix: pixel-glyphs.json not found; hero falls back to Silkscreen text")
            return
        }
        do {
            let data = try Data(contentsOf: url)
            let decoded = try JSONDecoder().decode(DotGlyphFont.self, from: data)
            guard !decoded.glyphs.isEmpty else {
                Logger.error("dotmatrix: glyph JSON is empty at \(url.path)")
                return
            }
            font = decoded
            Logger.info(
                "dotmatrix: loaded \(decoded.glyphs.count) \(decoded.font) glyphs " +
                    "(capHeight=\(decoded.capHeight), pitch \(Int(figurePitch))pt, scale \(figureScale)) from \(url.lastPathComponent)"
            )
        } catch {
            Logger.error("dotmatrix: glyph decode failed at \(url.path): \(error.localizedDescription)")
        }
    }

    private static func locateGlyphJSON() -> URL? {
        var candidates: [URL] = []
        if let resource = Bundle.main.resourceURL {
            candidates.append(resource.appendingPathComponent("pixel-glyphs.json"))
            candidates.append(resource.appendingPathComponent("fonts/pixel-glyphs.json"))
        }
        // Raw `swift build` / snapshot runs: walk up from the executable to the repo.
        let executable = Bundle.main.executableURL
            ?? URL(fileURLWithPath: CommandLine.arguments.first ?? "TokenIsland")
        var directory = executable.deletingLastPathComponent()
        for _ in 0..<8 {
            candidates.append(directory.appendingPathComponent("assets/fonts/pixel-glyphs.json"))
            candidates.append(directory.appendingPathComponent("Resources/pixel-glyphs.json"))
            directory = directory.deletingLastPathComponent()
        }
        candidates.append(
            URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
                .appendingPathComponent("assets/fonts/pixel-glyphs.json")
        )
        return candidates.first { FileManager.default.fileExists(atPath: $0.path) }
    }

    // MARK: Feature flag + accessibility fallback

    /// `TOKEN_ISLAND_DOT_HERO=0` forces the V2 Silkscreen figure, `=1` forces
    /// dots (QA comparison only), unset = automatic. Dots are disabled when the
    /// glyph JSON is missing or Reduce Transparency / Reduce Motion is on
    /// (contract §2.1: fall back to the V2 Silkscreen number).
    static var heroFigureEnabled: Bool {
        let env = ProcessInfo.processInfo.environment["TOKEN_ISLAND_DOT_HERO"]
        if env == "0" { return false }
        if env == "1" { return isAvailable }
        guard isAvailable else { return false }
        let workspace = NSWorkspace.shared
        if workspace.accessibilityDisplayShouldReduceTransparency { return false }
        if workspace.accessibilityDisplayShouldReduceMotion { return false }
        return true
    }

    // MARK: Metrics

    /// Sanitises the string through the same mapping the Silkscreen text path uses.
    static func sanitized(_ text: String) -> String {
        PixelText.sanitize(text)
    }

    /// Height of the figure view in points (the 40pt cap block itself).
    static var figureHeight: CGFloat {
        guard let font else { return 0 }
        return CGFloat(font.capHeight) * CGFloat(figureScale) * figurePitch
    }

    /// Width of the halo-padded figure view in points.
    static func figureWidth(_ text: String) -> CGFloat {
        guard let font else { return 0 }
        let clean = sanitized(text)
        var pen: CGFloat = 0
        for character in clean {
            let glyph = font.glyphs[String(character)] ?? font.glyphs[" "]
            guard let glyph else { continue }
            pen += CGFloat(glyph.advance) * CGFloat(figureScale) * figurePitch
        }
        return pen
    }

    /// Dot centres (y-down, (0,0) = cap-block top-left) for one line of glyphs.
    static func figureDots(_ text: String) -> [CGPoint] {
        guard let font else { return [] }
        let pitch = figurePitch
        let scale = CGFloat(figureScale)
        let cap = CGFloat(font.capHeight)
        let clean = sanitized(text)
        var dots: [CGPoint] = []
        var pen: CGFloat = 0
        for character in clean {
            let glyph = font.glyphs[String(character)] ?? font.glyphs[" "]
            guard let glyph else { continue }
            for (rowIndex, row) in glyph.rows.enumerated() {
                let characters = Array(row)
                for column in 0..<characters.count where characters[column] == "#" {
                    for sy in 0..<figureScale {
                        for sx in 0..<figureScale {
                            let x = pen
                                + (CGFloat(column) * scale + CGFloat(sx)) * pitch
                                + pitch / 2
                            let y = (cap + CGFloat(glyph.top) + CGFloat(rowIndex)) * scale * pitch
                                + CGFloat(sy) * pitch
                                + pitch / 2
                            dots.append(CGPoint(x: x, y: y))
                        }
                    }
                }
            }
            pen += CGFloat(glyph.advance) * scale * pitch
        }
        return dots
    }
}

// MARK: - Hero dot figure

/// Hero "today tokens" figure drawn as packed dots from the Silkscreen bitmap
/// glyphs. The frame is exactly the 40pt cap block (no halo padding, no glow);
/// dots are ~0.48 × pitch so the glyph shapes stay readable at 1x.
struct DotFigureView: View {
    let text: String
    var color: Color = DS.Palette.ink

    var body: some View {
        let dots = DotMatrix.figureDots(text)
        Canvas { context, _ in
            guard !dots.isEmpty else { return }
            let radius = DotMatrix.figureDotRadius
            var path = Path()
            for dot in dots {
                path.addEllipse(
                    in: CGRect(
                        x: dot.x - radius,
                        y: dot.y - radius,
                        width: radius * 2,
                        height: radius * 2
                    )
                )
            }
            context.fill(path, with: .color(color))
        }
        .frame(width: DotMatrix.figureWidth(text), height: DotMatrix.figureHeight)
        .accessibilityHidden(true)
        .allowsHitTesting(false)
    }
}

// MARK: - LED dot (the only element allowed to glow)

/// Status LED: one round dot plus two concentric halo rings. Halos are plain
/// low-alpha fills (no blur/filter), so the dot core stays crisp. The frame
/// includes 4pt of halo padding; callers position it by its centre.
struct DotLED: View {
    var color: Color
    var diameter: CGFloat = 6
    /// 0 = unlit / idle (no halo), 1 = full halo (blinking "on" frame).
    var glow: CGFloat = 0

    static let haloPadding: CGFloat = 4
    static let haloRings: [(radius: CGFloat, opacity: Double)] = [(2.0, 0.07), (1.5, 0.13)]

    var body: some View {
        Canvas { context, size in
            let center = CGPoint(x: size.width / 2, y: size.height / 2)
            let radius = diameter / 2
            if glow > 0 {
                for ring in Self.haloRings {
                    let haloRadius = radius * ring.radius
                    let rect = CGRect(
                        x: center.x - haloRadius,
                        y: center.y - haloRadius,
                        width: haloRadius * 2,
                        height: haloRadius * 2
                    )
                    context.fill(
                        Path(ellipseIn: rect),
                        with: .color(color.opacity(Double(glow) * ring.opacity))
                    )
                }
            }
            let core = CGRect(
                x: center.x - radius,
                y: center.y - radius,
                width: diameter,
                height: diameter
            )
            context.fill(Path(ellipseIn: core), with: .color(color))
        }
        .frame(width: diameter + Self.haloPadding * 2, height: diameter + Self.haloPadding * 2)
        .allowsHitTesting(false)
    }

    /// Frame size for a given dot diameter (used by callers to centre it).
    static func frameSize(diameter: CGFloat) -> CGSize {
        CGSize(width: diameter + haloPadding * 2, height: diameter + haloPadding * 2)
    }
}
