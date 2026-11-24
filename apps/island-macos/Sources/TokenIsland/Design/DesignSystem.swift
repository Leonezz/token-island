import SwiftUI

// MARK: - Precision Telemetry Design System (v4)
//
// High-contrast, legible developer telemetry language shared with
// `packages/core/src/telemetry.ts`:
//  - Crisp SF Pro / system sans for labels and SF Mono + tabular digits for numbers
//  - Neutral carbon surfaces with >= 4.8:1 (AA) to >= 15:1 (AAA) contrast ratios
//  - Smooth architectural corner radii (12pt panel, 8pt cards, 6pt controls)

enum DS {

    // MARK: Geometry

    enum Size {
        /// Collapsed capsule size (280 x 38pt — fits 14pt count, 7d sparkline and cost cleanly).
        static let collapsedWidth: CGFloat = 280
        static let collapsedHeight: CGFloat = 38
        /// Expanded telemetry panel size (448 x 408pt).
        static let expandedWidth: CGFloat = 448
        static let expandedHeight: CGFloat = 408

        static let collapsed = CGSize(width: collapsedWidth, height: collapsedHeight)
        static let expanded = CGSize(width: expandedWidth, height: expandedHeight)

        static let shadow: CGFloat = 0

        static func island(expanded isExpanded: Bool) -> CGSize {
            isExpanded ? expanded : collapsed
        }

        static func bodyHeight(expanded isExpanded: Bool) -> CGFloat {
            island(expanded: isExpanded).height
        }
    }

    enum Space {
        static let topEdgeInset: CGFloat = 4
        static let expandedPadding: CGFloat = 16
        static let collapsedInset: CGFloat = 12
        static let sectionGap: CGFloat = 10
        static let border: CGFloat = 1
        static let corner: CGFloat = 12
        static let cardCorner: CGFloat = 8
        static let smallCorner: CGFloat = 5
        static let grid: CGFloat = 2
    }

    // MARK: Palette (mirrors TELEMETRY_DARK in packages/core/src/telemetry.ts)

    enum Palette {
        static let bg = Color(hex: 0x090b0e)
        static let bgRaised = Color(hex: 0x0d1015)
        static let surface = Color(hex: 0x13171f)
        static let surfaceAlt = Color(hex: 0x191e28)
        static let inset = Color(hex: 0x0a0d12)
        static let border = Color(hex: 0x252c3a)
        static let borderHi = Color(hex: 0x343e52)
        static let ink = Color(hex: 0xf3f5f8)
        static let inkDim = Color(hex: 0x9ba4b5)
        static let inkFaint = Color(hex: 0x7e889b)
        static let teal = Color(hex: 0x10b981)
        static let blue = Color(hex: 0x38bdf8)
        /// Mapped to warm amber to eliminate low-contrast violet on dark surfaces.
        static let purple = Color(hex: 0xf59e0b)
        static let amber = Color(hex: 0xf59e0b)
        static let red = Color(hex: 0xf43f5e)
        static let green = Color(hex: 0x34d399)
        static let mint = Color(hex: 0x6ee7b7)
        static let shadow = Color(hex: 0x040608)
        static let tealDark = Color(hex: 0x065f46)

        static let series: [Color] = [
            teal,
            blue,
            amber,
            Color(hex: 0xfb7185),
            green,
            Color(hex: 0x22d3ee),
            mint,
            inkDim,
        ]
    }

    // MARK: Typography (Readable >= 11.5pt scale, tabular numerals)

    enum FontSize {
        static let micro: CGFloat = 11.5
        static let small: CGFloat = 12.5
        static let body: CGFloat = 14
        static let large: CGFloat = 18
        static let hero: CGFloat = 28
    }

    enum Typography {
        static func sans(_ size: CGFloat, weight: Font.Weight = .medium) -> Font {
            Font.system(size: size, weight: weight, design: .default).monospacedDigit()
        }

        static func mono(_ size: CGFloat, weight: Font.Weight = .medium) -> Font {
            Font.system(size: size, weight: weight, design: .monospaced).monospacedDigit()
        }
    }

    enum Tracking {
        static let label: CGFloat = 0.4
    }

    // MARK: Motion

    enum Motion {
        static let hoverExpandDelay: TimeInterval = 0.12
        static let hoverCollapseDelay: TimeInterval = 0.40
        static let frameAnimation: TimeInterval = 0.18
        static let contentSwap: TimeInterval = 0.10
        static let blinkFrame: TimeInterval = 0.90
    }

    static let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.4.0"
}

// MARK: - Color helpers

extension Color {
    init(hex: UInt32, opacity: Double = 1.0) {
        let red = Double((hex >> 16) & 0xFF) / 255.0
        let green = Double((hex >> 8) & 0xFF) / 255.0
        let blue = Double(hex & 0xFF) / 255.0
        self.init(.sRGB, red: red, green: green, blue: blue, opacity: opacity)
    }
}
