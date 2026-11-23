import SwiftUI

// MARK: - Design system
//
// Single source of truth for the island's visual language: palette, type ramp,
// metrics and motion. Everything else composes these tokens so the collapsed
// pill and the expanded panel stay visually consistent.

enum DS {

    // MARK: Geometry

    enum Size {
        static let collapsedWidth: CGFloat = 210
        static let collapsedHeight: CGFloat = 36
        static let expandedWidth: CGFloat = 430
        static let expandedHeight: CGFloat = 352

        static let collapsed = CGSize(width: collapsedWidth, height: collapsedHeight)
        static let expanded = CGSize(width: expandedWidth, height: expandedHeight)

        static func island(expanded isExpanded: Bool) -> CGSize { isExpanded ? expanded : collapsed }
    }

    enum Radius {
        static let collapsed: CGFloat = 18
        static let expanded: CGFloat = 28
    }

    enum Space {
        /// Expanded panel content inset.
        static let panelPadding: CGFloat = 20
        /// Gap between the top screen edge and the island (contract §7.2).
        static let topEdgeGap: CGFloat = 1
        /// Collapsed pill horizontal padding.
        static let pillPadding: CGFloat = 12
        /// Vertical rhythm inside the expanded panel.
        static let section: CGFloat = 11
    }

    // MARK: Palette

    enum Palette {
        /// Near-black glass, 96% opaque over the desktop.
        static let background = Color(hex: 0x050507)
        static let backgroundOpacity: Double = 0.96
        /// 1 px inner stroke.
        static let stroke = Color.white.opacity(0.08)
        /// Subtle top sheen so the glass reads as a surface, not a cut-out.
        static let sheen = LinearGradient(
            colors: [Color.white.opacity(0.055), Color.white.opacity(0.0)],
            startPoint: .top,
            endPoint: .bottom
        )
        static let outerGlow = Color.black.opacity(0.35)

        static let textPrimary = Color.white.opacity(0.94)
        static let textSecondary = Color.white.opacity(0.52)
        static let textTertiary = Color.white.opacity(0.32)

        static let live = Color(hex: 0x34D399)
        static let tokens = Color(hex: 0x5EEAD4)
        static let cost = Color(hex: 0xA78BFA)
        static let cache = Color(hex: 0x60A5FA)
        static let warning = Color(hex: 0xFBBF24)
        static let error = Color(hex: 0xF87171)

        // Stacked token-split bar (contract §7.4 item 3).
        static let splitInput = tokens
        static let splitCache = cache
        static let splitOutput = cost

        static let track = Color.white.opacity(0.06)
        static let barIdle = Color.white.opacity(0.16)
        static let barEmpty = Color.white.opacity(0.07)
        static let divider = Color.white.opacity(0.06)
    }

    // MARK: Type ramp

    enum Fonts {
        /// Hero token count in the expanded panel.
        static let hero = Font.system(size: 40, weight: .bold, design: .rounded)
        /// Collapsed pill token count.
        static let pillNumber = Font.system(size: 15, weight: .semibold, design: .rounded)
        /// Estimated cost block.
        static let cost = Font.system(size: 16, weight: .semibold, design: .rounded)
        /// Generic numeric value (models / sessions / legend).
        static let value = Font.system(size: 10, weight: .semibold, design: .rounded)
        static let valueLarger = Font.system(size: 11, weight: .semibold, design: .rounded)
        /// Row label / body.
        static let body = Font.system(size: 11, weight: .medium)
        static let label = Font.system(size: 9.5, weight: .medium)
        static let caption = Font.system(size: 9, weight: .regular)
        /// Uppercase micro labels.
        static let micro = Font.system(size: 9, weight: .semibold)
        static let microSmall = Font.system(size: 8.5, weight: .semibold)
        static let pill = Font.system(size: 8.5, weight: .semibold)
    }

    /// Uppercase micro-label tracking.
    enum Tracking {
        static let micro: CGFloat = 1.1
        static let pill: CGFloat = 0.9
    }

    // MARK: Motion

    enum Motion {
        /// Hover-to-expand delay (contract: ~120 ms).
        static let hoverExpandDelay: TimeInterval = 0.12
        /// Mouse-exit collapse delay (contract: 400 ms).
        static let hoverCollapseDelay: TimeInterval = 0.40
        /// Window frame animation.
        static let frameAnimation: TimeInterval = 0.28
        /// Cross-fade between collapsed / expanded content.
        static let contentFade: TimeInterval = 0.22
        /// Live pulse cycle.
        static let pulse: TimeInterval = 1.3
        /// Sparkline data animation.
        static let chart: TimeInterval = 0.35
    }
}

// MARK: - Color helpers

extension Color {
    /// sRGB color from a 0xRRGGBB literal.
    init(hex: UInt32, opacity: Double = 1.0) {
        let red = Double((hex >> 16) & 0xFF) / 255.0
        let green = Double((hex >> 8) & 0xFF) / 255.0
        let blue = Double(hex & 0xFF) / 255.0
        self.init(.sRGB, red: red, green: green, blue: blue, opacity: opacity)
    }

    /// Parses `"#RRGGBB"` (as emitted by `@token-island/core`), falls back to the
    /// supplied default.
    init(hexString: String?, fallback: Color) {
        guard var raw = hexString?.trimmingCharacters(in: .whitespacesAndNewlines),
              raw.hasPrefix("#") else {
            self = fallback
            return
        }
        raw.removeFirst()
        guard raw.count == 6, let value = UInt32(raw, radix: 16) else {
            self = fallback
            return
        }
        self.init(hex: value)
    }
}

// MARK: - Source metadata (mirrors packages/core SOURCE_META)

enum SourceMeta {
    static func short(_ id: String) -> String {
        switch id {
        case "claude": return "Claude"
        case "codex": return "Codex"
        case "opencode": return "OpenCode"
        case "dsh": return "DSH"
        case "gemini": return "Gemini"
        default: return "Other"
        }
    }

    static func color(_ id: String) -> Color {
        switch id {
        case "claude": return Color(hex: 0xD97757)
        case "codex": return Color(hex: 0x10A37F)
        case "opencode": return Color(hex: 0x6C7BFF)
        case "dsh": return Color(hex: 0x4D6BFE)
        case "gemini": return Color(hex: 0x4285F4)
        default: return Color(hex: 0x8B8B8B)
        }
    }
}
