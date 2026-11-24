import SwiftUI

// MARK: - Pixel design system
//
// The single source of truth for the V2 pixel look. Values mirror
// `packages/core/src/pixel.ts` one-for-one: the same palette, the same 8pt
// type steps, the same integer geometry laws.
//
// Laws:
//  - every coordinate / offset / border / shadow is an integer number of points
//  - no curves, no gradients, no blur: staircase corners, hard 2pt shadows
//  - type sizes are multiples of 8pt so Silkscreen glyph pixels land on the
//    Retina grid (8pt = 1pt/glyph-pixel = 2 device px at @2x)

enum DS {

    // MARK: Geometry (contract §1.1)

    enum Size {
        /// Collapsed island size (contract §1.1 / §1.2).
        static let collapsedWidth: CGFloat = 224
        static let collapsedHeight: CGFloat = 44
        /// Expanded panel size (contract §1.1 / §1.3).
        static let expandedWidth: CGFloat = 448
        static let expandedHeight: CGFloat = 400

        static let collapsed = CGSize(width: collapsedWidth, height: collapsedHeight)
        static let expanded = CGSize(width: expandedWidth, height: expandedHeight)

        /// Hard 2pt bottom shadow is part of the window: the visible pixel panel
        /// is 2pt shorter than the window.
        static let shadow: CGFloat = 2

        static func island(expanded isExpanded: Bool) -> CGSize {
            isExpanded ? expanded : collapsed
        }

        /// Body height of the drawn panel (window minus the hard bottom shadow).
        static func bodyHeight(expanded isExpanded: Bool) -> CGFloat {
            island(expanded: isExpanded).height - shadow
        }
    }

    enum Space {
        /// Panel top edge inset from the very top of the screen (contract §1.1).
        static let topEdgeInset: CGFloat = 2
        /// Expanded content padding (contract §1.3).
        static let expandedPadding: CGFloat = 12
        /// Collapsed content inset (contract §1.2).
        static let collapsedInset: CGFloat = 8
        /// Gap between the seven expanded rows (`374 = 332 + 6 * 7`).
        static let sectionGap: CGFloat = 7
        /// 2pt border width for every pixel panel.
        static let border: CGFloat = 2
        /// Staircase corner size in points (2 steps).
        static let corner: CGFloat = 2
        /// Grid step used by bars / sprites / dithering.
        static let grid: CGFloat = 2
    }

    // MARK: Palette (verbatim from packages/core/src/pixel.ts)

    enum Palette {
        /// Page / wallpaper background.
        static let bg = Color(hex: 0x0b0b12)
        /// Slightly lifted background for striped sections.
        static let bgRaised = Color(hex: 0x10101b)
        /// Panel fill.
        static let surface = Color(hex: 0x14121d)
        /// Secondary panel / inset well.
        static let surfaceAlt = Color(hex: 0x1b1928)
        /// Deep inset (track background).
        static let inset = Color(hex: 0x090910)
        /// Default 2pt border.
        static let border = Color(hex: 0x332d4a)
        /// Highlight border on the top edge of raised panels.
        static let borderHi = Color(hex: 0x57507a)
        /// Primary ink.
        static let ink = Color(hex: 0xf4f2ff)
        /// Secondary ink.
        static let inkDim = Color(hex: 0xa39fc4)
        /// Tertiary ink / labels.
        static let inkFaint = Color(hex: 0x6b6689)
        /// Brand / success / live.
        static let teal = Color(hex: 0x3be8b0)
        /// Cache / secondary data.
        static let blue = Color(hex: 0x5b9dff)
        /// Output / tertiary data / cost.
        static let purple = Color(hex: 0xb388ff)
        /// Warning / streak / offline.
        static let amber = Color(hex: 0xffc857)
        /// Error / negative.
        static let red = Color(hex: 0xff6b6b)
        /// Positive trend.
        static let green = Color(hex: 0x7dff9b)
        /// Silkscreen accent for "today" highlights.
        static let mint = Color(hex: 0x8fffe0)
        /// Hard shadow behind every panel.
        static let shadow = Color(hex: 0x050509)
        /// Dark teal second blink frame (from core `pixelHeatColor`).
        static let tealDark = Color(hex: 0x1f6f5b)

        /// Categorical series used by chart / model rows, in core order.
        static let series: [Color] = [teal, purple, blue, amber, green, red, mint, inkDim]
    }

    // MARK: Type ramp (multiples of 8pt, contract §0)

    enum FontSize {
        /// Micro-label / body copy in the widget.
        static let micro: CGFloat = 8
        /// Small labels (badges, legend values, section labels).
        static let small: CGFloat = 16
        /// Body (rarely used in the island).
        static let body: CGFloat = 24
        /// Large hero (cost emphasis, offline).
        static let large: CGFloat = 32
        /// Hero (never used in the 448x400 panel; kept for completeness).
        static let hero: CGFloat = 48
    }

    enum Tracking {
        /// Tracking for uppercase micro labels (in points, integer).
        static let label: CGFloat = 1
    }

    // MARK: Motion (step-wise only, contract §0)

    enum Motion {
        /// Hover-to-expand delay (~120 ms).
        static let hoverExpandDelay: TimeInterval = 0.12
        /// Mouse-exit collapse delay (400 ms).
        static let hoverCollapseDelay: TimeInterval = 0.40
        /// Step-ish window frame animation (contract §1.1: 160 ms).
        static let frameAnimation: TimeInterval = 0.16
        /// Content swap between collapsed / expanded.
        static let contentSwap: TimeInterval = 0.08
        /// Live dot frame duration: 2 frames at ~1.6Hz.
        static let blinkFrame: TimeInterval = 0.3125
    }

    /// Version string shown in the About window / Preferences.
    static let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.2.0"
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
}
