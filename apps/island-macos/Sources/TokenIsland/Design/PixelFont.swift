import AppKit
import CoreText
import SwiftUI

// MARK: - Silkscreen TTF registration + crisp pixel text
//
// The widget ships `Silkscreen-Regular.ttf` / `Silkscreen-Bold.ttf` inside
// `Contents/Resources/fonts/` and registers them with CoreText at launch
// (contract §1.4). Once resolved we get the exact PostScript names back and
// render every label with the *real* font.
//
// Rendering note: Silkscreen is a 5x5-cap bitmap font on a 100-unit grid
// (125 font units = one glyph pixel). At sizes 8/16/24/32/48pt one glyph pixel
// is an integer number of points, so glyph outlines always land on the Retina
// pixel grid. `PixelText` draws the glyph outlines through CoreText with
// antialiasing disabled, which yields hard-edged, 2-colour text in snapshots
// and on screen (no soft / blurred labels).

enum PixelFont {

    /// PostScript names resolved from the bundled TTFs.
    private(set) static var regularName: String = "Silkscreen-Regular"
    private(set) static var boldName: String = "Silkscreen-Bold"
    /// False when the TTFs could not be registered; text falls back to Menlo.
    private(set) static var isAvailable = false

    private static var didRegister = false
    private static var fontCache: [String: CTFont] = [:]
    private static var glyphSupport: [String: Set<UniChar>] = [:]

    static let fallbackName = "Menlo-Regular"
    static let fallbackSystemFontName = "Menlo-Regular"

    // MARK: Registration

    /// Registers the bundled Silkscreen TTFs exactly once. Safe to call from
    /// `main` before AppKit / SwiftUI create any view.
    static func registerBundledFonts() {
        guard !didRegister else { return }
        didRegister = true

        let regular = locateFont("Silkscreen-Regular")
        let bold = locateFont("Silkscreen-Bold")
        var failures: [String] = []

        for url in [regular, bold].compactMap({ $0 }) {
            var error: Unmanaged<CFError>?
            let ok = CTFontManagerRegisterFontsForURL(url as CFURL, .process, &error)
            if !ok {
                // Already-registered fonts are not a failure for our purposes.
                let message = (error?.takeRetainedValue()).map { String(describing: $0) } ?? "unknown error"
                failures.append("\(url.lastPathComponent): \(message)")
            }
        }

        guard regular != nil, bold != nil else {
            Logger.error("fonts: bundled Silkscreen TTFs not found (expected Resources/fonts/Silkscreen-*.ttf)")
            return
        }

        let resolvedRegular = resolvePostScriptName(preferred: "Silkscreen-Regular", fallbackName: "Silkscreen")
        let resolvedBold = resolvePostScriptName(preferred: "Silkscreen-Bold", fallbackName: "Silkscreen Bold")
        isAvailable = resolvedRegular != nil && resolvedBold != nil
        if let resolvedRegular { regularName = resolvedRegular }
        if let resolvedBold { boldName = resolvedBold }

        if isAvailable {
            Logger.info("fonts registered \(regularName), \(boldName) (sizes 8/16/24/32/48pt)")
        } else {
            Logger.error(
                "fonts: Silkscreen could not be resolved, falling back to system font" +
                    (failures.isEmpty ? "" : " (\(failures.joined(separator: "; ")))")
            )
        }
    }

    /// Resolves the actual PostScript name as exposed by CoreText. Returns nil
    /// when the family is not Silkscreen (registration failed / system font).
    private static func resolvePostScriptName(preferred: String, fallbackName: String) -> String? {
        for candidate in [preferred, fallbackName] {
            let font = CTFontCreateWithName(candidate as CFString, 16, nil)
            let family = CTFontCopyFamilyName(font) as String
            guard family == "Silkscreen" else { continue }
            return CTFontCopyPostScriptName(font) as String
        }
        return nil
    }

    /// Candidate URLs for a bundled TTF, in priority order.
    private static func locateFont(_ base: String) -> URL? {
        var candidates: [URL] = []
        let resource = Bundle.main.resourceURL
        if let resource {
            candidates.append(resource.appendingPathComponent("fonts/\(base).ttf"))
            candidates.append(resource.appendingPathComponent("\(base).ttf"))
        }
        if let bundled = Bundle.main.url(forResource: base, withExtension: "ttf") {
            candidates.insert(bundled, at: 0)
        }
        // `swift build` / snapshot runs from the raw binary: walk up to the repo.
        let executable = Bundle.main.executableURL ?? URL(fileURLWithPath: CommandLine.arguments.first ?? "TokenIsland")
        var directory = executable.deletingLastPathComponent()
        for _ in 0..<8 {
            candidates.append(directory.appendingPathComponent("assets/fonts/\(base).ttf"))
            candidates.append(directory.appendingPathComponent("fonts/\(base).ttf"))
            directory = directory.deletingLastPathComponent()
        }
        candidates.append(URL(fileURLWithPath: FileManager.default.currentDirectoryPath).appendingPathComponent("assets/fonts/\(base).ttf"))
        return candidates.first { FileManager.default.fileExists(atPath: $0.path) }
    }

    // MARK: Fonts

    /// The resolved Silkscreen `CTFont` at a multiple-of-8pt size.
    static func ctFont(size: CGFloat, bold: Bool) -> CTFont {
        let clamped = max(8, (size / 8).rounded() * 8)
        let name = isAvailable ? (bold ? boldName : regularName) : fallbackName
        let key = "\(name)@\(clamped)"
        if let cached = fontCache[key] { return cached }
        let font = CTFontCreateWithName(name as CFString, clamped, nil)
        fontCache[key] = font
        return font
    }

    /// SwiftUI font for controls that must use a native text field / picker.
    static func font(size: CGFloat, bold: Bool = false) -> Font {
        let name = isAvailable ? (bold ? boldName : regularName) : PixelFont.fallbackSystemFontName
        return Font.custom(name, size: size)
    }

    // MARK: Glyph support

    /// True when the resolved pixel face has a glyph for `character`.
    static func supports(character: Character) -> Bool {
        guard let scalar = character.unicodeScalars.first else { return false }
        let value = UniChar(scalar.value)
        guard scalar.value <= 0xFFFF else { return false }
        let name = isAvailable ? regularName : fallbackName
        if let cached = glyphSupport[name] { return cached.contains(value) }
        let font = ctFont(size: 16, bold: false)
        var chars: [UniChar] = [value]
        var glyphs: [CGGlyph] = [0]
        let ok = CTFontGetGlyphsForCharacters(font, &chars, &glyphs, 1) && glyphs[0] != 0
        var set = glyphSupport[name] ?? []
        if ok { set.insert(value) }
        glyphSupport[name] = set
        return ok
    }

    /// Backwards-compatible name used by the design helpers.
    static func fontName(bold: Bool) -> String {
        isAvailable ? (bold ? boldName : regularName) : fallbackName
    }
}

// MARK: - PixelText

/// One line of Silkscreen text rendered as hard-edged pixel glyph outlines.
///
/// The view's frame is exactly the ink box: height = Silkscreen cap height
/// (`5/8 * size`), width = advance width. That makes integer layouts trivial and
/// guarantees no half-point baselines. Texts that contain glyphs reaching above
/// the cap line (`$`, `&`) pass `extraTop: size / 8`.
struct PixelText: View {
    let text: String
    var size: CGFloat = DS.FontSize.micro
    var color: Color = DS.Palette.ink
    var bold: Bool = false
    var tracking: CGFloat = 0
    /// Extra empty rows above the cap line for glyphs such as `$`.
    var extraTop: CGFloat = 0
    /// Optional frame width for centre / trailing alignment.
    var width: CGFloat? = nil
    var alignment: Alignment = .leading
    /// Pixel surfaces are uppercase by law; paths / URLs may opt out.
    var uppercased: Bool = true

    private var clean: String { PixelText.sanitize(text, uppercased: uppercased) }

    var body: some View {
        let measured = PixelText.metrics(clean, size: size, bold: bold, tracking: tracking, uppercased: false)
        let height = PixelText.capHeight(size) + extraTop
        let frameWidth = width ?? measured
        Canvas { context, canvasSize in
            guard !clean.isEmpty else { return }
            context.withCGContext { cg in
                cg.setShouldAntialias(false)
                cg.setShouldSmoothFonts(false)
                cg.setAllowsAntialiasing(false)
                cg.setAllowsFontSmoothing(false)
                guard let glyphPath = PixelText.path(clean, size: size, bold: bold, tracking: tracking, uppercased: false) else { return }
                var transform = CGAffineTransform.identity
                switch alignment {
                case .center:
                    transform = transform.translatedBy(x: ((frameWidth - measured) / 2).rounded(), y: 0)
                case .trailing:
                    transform = transform.translatedBy(x: frameWidth - measured, y: 0)
                default:
                    break
                }
                transform = transform.translatedBy(x: 0, y: canvasSize.height)
                if let placed = glyphPath.copy(using: &transform) {
                    cg.addPath(placed)
                    cg.setFillColor(NSColor(color).cgColor)
                    cg.fillPath()
                }
            }
        }
        .frame(width: frameWidth, height: height)
    }

    // MARK: Metrics

    /// Silkscreen cap height in points (5 glyph pixels on the 8px grid).
    static func capHeight(_ size: CGFloat) -> CGFloat {
        ((size / 8).rounded() * 5)
    }

    /// Advance width of a line in points (integer at multiple-of-8pt sizes).
    static func metrics(_ text: String, size: CGFloat, bold: Bool = false, tracking: CGFloat = 0, uppercased: Bool = true) -> CGFloat {
        let clean = sanitize(text, uppercased: uppercased)
        guard !clean.isEmpty else { return 0 }
        let font = PixelFont.ctFont(size: size, bold: bold)
        var chars = Array(clean.utf16)
        var glyphs = [CGGlyph](repeating: 0, count: chars.count)
        guard CTFontGetGlyphsForCharacters(font, &chars, &glyphs, chars.count) else { return 0 }
        var advances = [CGSize](repeating: .zero, count: glyphs.count)
        CTFontGetAdvancesForGlyphs(font, .horizontal, glyphs, &advances, glyphs.count)
        let glyphsWidth = advances.reduce(0) { $0 + $1.width }
        let trackingWidth = max(0, CGFloat(glyphs.count) - 1) * tracking
        return (glyphsWidth + trackingWidth).rounded()
    }

    /// Truncates to `maxCharacters` visible characters, appending `..`.
    static func truncate(_ text: String, maxCharacters: Int) -> String {
        let clean = sanitize(text)
        guard clean.count > maxCharacters, maxCharacters >= 2 else { return clean }
        return String(clean.prefix(maxCharacters - 2)) + ".."
    }

    /// Truncates to fit `availableWidth` points, appending `..`.
    static func truncate(_ text: String, toWidth availableWidth: CGFloat, size: CGFloat, bold: Bool = false, uppercased: Bool = true) -> String {
        let clean = sanitize(text, uppercased: uppercased)
        guard metrics(clean, size: size, bold: bold) > availableWidth else { return clean }
        var candidate = clean
        while candidate.count > 2 {
            candidate.removeLast()
            let next = candidate + ".."
            if metrics(next, size: size, bold: bold) <= availableWidth { return next }
        }
        return String(clean.prefix(1))
    }

    // MARK: Sanitising

    /// Mirrors `sanitizePixelText()` from core: uppercase, ASCII fallbacks for
    /// characters the pixel face has no glyph for.
    private static let fallbacks: [Character: String] = [
        "\u{00b7}": "*", "\u{2022}": "*", "\u{25b2}": "^", "\u{25bc}": "v",
        "\u{2192}": ">", "\u{2190}": "<", "\u{2191}": "^", "\u{2193}": "v",
        "\u{00d7}": "x", "\u{2713}": "+", "\u{2717}": "x", "\u{2014}": "-",
        "\u{2013}": "-", "\u{2026}": ".", "\u{201c}": "\"", "\u{201d}": "\"",
        "\u{2018}": "'", "\u{2019}": "'", "\u{00a0}": " ", "\u{2197}": "^",
        "\u{2198}": "v", "\u{2248}": "~",
    ]

    static func sanitize(_ text: String, uppercased: Bool = true) -> String {
        let upper = uppercased ? text.uppercased() : text
        guard PixelFont.isAvailable else {
            return String(upper.map { $0.isASCII ? $0 : "?" })
        }
        var out = ""
        for character in upper {
            if let mapped = fallbacks[character] {
                out += mapped
            } else if character.isASCII && PixelFont.supports(character: character) {
                out.append(character)
            } else if !character.isASCII {
                out.append("?")
            } else {
                out.append(character)
            }
        }
        return out
    }

    // MARK: Glyph paths

    /// A single cached glyph-outline path for the whole line of text. Glyphs are
    /// placed with the baseline at y = 0 in a y-down coordinate system, so the
    /// path can be filled at `(x, baselineY)` directly.
    static func path(_ text: String, size: CGFloat, bold: Bool, tracking: CGFloat, uppercased: Bool = true) -> CGPath? {
        let text = sanitize(text, uppercased: uppercased)
        guard !text.isEmpty else { return nil }
        let font = PixelFont.ctFont(size: size, bold: bold)
        var chars = Array(text.utf16)
        var glyphs = [CGGlyph](repeating: 0, count: chars.count)
        guard CTFontGetGlyphsForCharacters(font, &chars, &glyphs, chars.count) else { return nil }
        var advances = [CGSize](repeating: .zero, count: glyphs.count)
        CTFontGetAdvancesForGlyphs(font, .horizontal, glyphs, &advances, glyphs.count)

        let combined = CGMutablePath()
        var penX: CGFloat = 0
        for (index, glyph) in glyphs.enumerated() {
            if let glyphPath = CTFontCreatePathForGlyph(font, glyph, nil) {
                var transform = CGAffineTransform(a: 1, b: 0, c: 0, d: -1, tx: penX, ty: 0)
                if let flipped = glyphPath.copy(using: &transform) {
                    combined.addPath(flipped)
                }
            }
            penX += advances[index].width + tracking
        }
        return combined
    }
}
