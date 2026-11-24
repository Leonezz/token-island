import SwiftUI

// MARK: - Precision Telemetry Design System (v4.1 — Notch-Attached)
//
// Geometry tailored for notched MacBooks:
//  - Collapsed: invisible hover sensor tucked strictly inside the hardware notch
//  - Expanded:  580 x 500pt flush at screen.frame.maxY (0pt top gap, 0pt top
//               corners, 24pt continuous bottom corners, camera exclusion zone)

enum DS {

    // MARK: Geometry

    enum Size {
        /// Default notch hover-zone fallback when NSScreen metrics are unavailable.
        static let collapsedWidth: CGFloat = 200
        static let collapsedHeight: CGFloat = 32
        /// Spacious notch-attached interactive telemetry panel (580 x 568pt).
        static let expandedWidth: CGFloat = 580
        static let expandedHeight: CGFloat = 568

        static let collapsed = CGSize(width: collapsedWidth, height: collapsedHeight)
        static let expanded = CGSize(width: expandedWidth, height: expandedHeight)

        static let shadow: CGFloat = 0

        static func island(expanded isExpanded: Bool, notch: CGSize = collapsed) -> CGSize {
            if isExpanded {
                let minRequiredWidth = max(expandedWidth, notch.width + 360)
                return CGSize(width: minRequiredWidth, height: expandedHeight)
            }
            // Invisible hover sensor: spans the notch + 8pt below its bottom edge so
            // macOS cursor notch-deflection never blocks hover expansion.
            return CGSize(
                width: max(180, notch.width + 16),
                height: max(14, notch.height + 8)
            )
        }

        static func bodyHeight(expanded isExpanded: Bool) -> CGFloat {
            island(expanded: isExpanded).height
        }
    }

    enum Space {
        /// Flush with the top bezel (0pt gap).
        static let topEdgeInset: CGFloat = 0
        static let expandedPadding: CGFloat = 22
        static let collapsedInset: CGFloat = 0
        static let sectionGap: CGFloat = 13
        static let border: CGFloat = 1
        /// Standard modal window corner radius (Preferences / About).
        static let corner: CGFloat = 12
        /// Bottom corner radius of the notch-attached expanded island.
        static let bottomCorner: CGFloat = 24
        static let cardCorner: CGFloat = 10
        static let smallCorner: CGFloat = 6
        static let grid: CGFloat = 2
    }

    // MARK: Palette

    enum Palette {
        static let notchBlack = Color(hex: 0x000000)
        static let bg = Color(hex: 0x090b0e)
        static let bgRaised = Color(hex: 0x0d1015)
        static let surface = Color(hex: 0x10141c)
        static let surfaceAlt = Color(hex: 0x171c27)
        static let inset = Color(hex: 0x090c11)
        static let border = Color(hex: 0x242c3b)
        static let borderHi = Color(hex: 0x343f54)
        static let ink = Color(hex: 0xf4f6f9)
        static let inkDim = Color(hex: 0xa0aab8)
        static let inkFaint = Color(hex: 0x7e889b)
        static let teal = Color(hex: 0x10b981)
        static let blue = Color(hex: 0x38bdf8)
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

    // MARK: Typography

    enum FontSize {
        static let micro: CGFloat = 12
        static let small: CGFloat = 13
        static let body: CGFloat = 14.5
        static let large: CGFloat = 20
        static let hero: CGFloat = 34
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
        static let hoverExpandDelay: TimeInterval = 0.10
        static let hoverCollapseDelay: TimeInterval = 0.35
        static let frameAnimation: TimeInterval = 0.18
        static let contentSwap: TimeInterval = 0.10
        static let blinkFrame: TimeInterval = 0.90
    }

    static let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.4.0"
}

extension Color {
    init(hex: UInt32, opacity: Double = 1.0) {
        let red = Double((hex >> 16) & 0xFF) / 255.0
        let green = Double((hex >> 8) & 0xFF) / 255.0
        let blue = Double(hex & 0xFF) / 255.0
        self.init(.sRGB, red: red, green: green, blue: blue, opacity: opacity)
    }
}
