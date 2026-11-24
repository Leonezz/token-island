import SwiftUI

// MARK: - Pixel-art synthetic desktop wallpaper
//
// Used by `--snapshot --background wallpaper` so README screenshots read like a
// real macOS capture without screen-recording permission. The look mirrors the
// app icon: a dark checkerboard field, a dithered purple aura at the top edge,
// sparse pixel stars, a stepped pixel skyline and the icon's two-colour bottom
// strip. Every colour comes from the shared `DS.Palette`; everything is snapped
// to the 4pt grid so the wallpaper stays pixel-crisp at @2x.

struct WallpaperView: View {
    var body: some View {
        GeometryReader { geometry in
            Canvas { context, size in
                drawBackground(context: &context, size: size)
            }
        }
        .clipped()
    }

    // MARK: Draw

    private func drawBackground(context: inout GraphicsContext, size: CGSize) {
        let width = size.width
        let height = size.height

        // Base.
        context.fill(Path(CGRect(origin: .zero, size: size)), with: .color(DS.Palette.bg))

        // Subtle 4pt checkerboard, exactly like the icon's fabric.
        let checker: CGFloat = 4
        var y: CGFloat = 0
        while y < height {
            var x: CGFloat = 0
            while x < width {
                if (Int(x / checker) + Int(y / checker)) % 2 == 0 {
                    context.fill(
                        Path(CGRect(x: x, y: y, width: checker, height: checker)),
                        with: .color(DS.Palette.bgRaised.opacity(0.32))
                    )
                }
                x += checker
            }
            y += checker
        }

        // Dithered aura hugging the top edge behind the island.
        ditherBand(
            context: &context,
            size: size,
            colors: [
                DS.Palette.border, DS.Palette.surfaceAlt, DS.Palette.surface,
                DS.Palette.bgRaised, DS.Palette.bg,
            ],
            densities: [42, 30, 20, 12, 5],
            height: 200
        )

        drawStars(context: &context, size: size)
        drawAccentClusters(context: &context, size: size)
        drawSkyline(context: &context, size: size)
        drawChartBars(context: &context, size: size)
        drawBottomStrip(context: &context, size: size)
        drawMenuBar(context: &context, size: size)
    }

    /// A synthetic macOS menu bar so screenshots read as a desktop capture: the
    /// island hangs from the top edge over it, exactly like the real widget.
    private func drawMenuBar(context: inout GraphicsContext, size: CGSize) {
        let barHeight: CGFloat = 30
        context.fill(
            Path(CGRect(x: 0, y: 0, width: size.width, height: barHeight)),
            with: .color(DS.Palette.bgRaised)
        )
        context.fill(
            Path(CGRect(x: 0, y: barHeight - 1, width: size.width, height: 1)),
            with: .color(DS.Palette.border.opacity(0.6))
        )
        // Left: a tiny pixel chart emblem + abstract menu titles.
        context.fill(
            Path(CGRect(x: 18, y: 17, width: 3, height: 6)),
            with: .color(DS.Palette.inkDim.opacity(0.75))
        )
        context.fill(
            Path(CGRect(x: 23, y: 12, width: 3, height: 11)),
            with: .color(DS.Palette.inkDim.opacity(0.75))
        )
        context.fill(
            Path(CGRect(x: 28, y: 15, width: 3, height: 8)),
            with: .color(DS.Palette.inkDim.opacity(0.75))
        )
        var x: CGFloat = 44
        let titleWidths: [CGFloat] = [18, 12, 20]
        for width in titleWidths {
            context.fill(
                Path(CGRect(x: x, y: 14, width: width, height: 3)),
                with: .color(DS.Palette.inkDim.opacity(0.5))
            )
            x += width + 12
        }
        // Right: clock sprite + a few status glyphs (pixel rectangles only).
        context.withCGContext { cg in
            cg.setShouldAntialias(false)
            PixelSprite.clock.draw(
                in: cg,
                x: size.width - 32,
                y: 13,
                scale: 1,
                color: NSColor(DS.Palette.inkDim.opacity(0.85)).cgColor
            )
        }
        let statusGlyphs: [(CGFloat, CGFloat, CGFloat, Color)] = [
            (size.width - 56, 14, 8, DS.Palette.inkDim),
            (size.width - 76, 13, 5, DS.Palette.inkDim),
            (size.width - 94, 15, 4, DS.Palette.teal),
            (size.width - 112, 14, 9, DS.Palette.inkDim),
        ]
        for glyph in statusGlyphs {
            context.fill(
                Path(CGRect(x: glyph.0, y: glyph.1, width: glyph.2, height: 3)),
                with: .color(glyph.3.opacity(0.65))
            )
        }
    }

    /// Ordered-dither gradient from the top edge down (Bayer 4x4, flat pixels).
    private func ditherBand(
        context: inout GraphicsContext,
        size: CGSize,
        colors: [Color],
        densities: [Int],
        height: CGFloat
    ) {
        let cell: CGFloat = 4
        let maxRow = min(Int(height / cell), Int(size.height / cell))
        guard maxRow > 0 else { return }
        for row in 0..<maxRow {
            let progress = CGFloat(row) / CGFloat(maxRow)
            let band = min(colors.count - 1, Int(progress * CGFloat(colors.count)))
            let density = densities[min(band, densities.count - 1)]
            for column in 0..<Int(size.width / cell) {
                let threshold = Self.bayer4[(column % 4) + (row % 4) * 4] * 100 / 16
                guard threshold < density else { continue }
                context.fill(
                    Path(CGRect(x: CGFloat(column) * cell, y: CGFloat(row) * cell, width: cell, height: cell)),
                    with: .color(colors[band])
                )
            }
        }
    }

    /// A handful of deliberate palette sparks, echoing the icon's floating dots.
    private func drawAccentClusters(context: inout GraphicsContext, size: CGSize) {
        let clusters: [(CGPoint, Color, Int)] = [
            (CGPoint(x: 0.88, y: 0.16), DS.Palette.purple, 5),
            (CGPoint(x: 0.94, y: 0.26), DS.Palette.blue, 3),
            (CGPoint(x: 0.80, y: 0.08), DS.Palette.teal, 4),
            (CGPoint(x: 0.12, y: 0.72), DS.Palette.teal, 5),
            (CGPoint(x: 0.20, y: 0.80), DS.Palette.mint, 2),
            (CGPoint(x: 0.06, y: 0.34), DS.Palette.amber, 2),
            (CGPoint(x: 0.90, y: 0.68), DS.Palette.purple, 2),
        ]
        for (clusterIndex, cluster) in clusters.enumerated() {
            let baseX = (size.width * cluster.0.x / 4).rounded() * 4
            let baseY = (size.height * cluster.0.y / 4).rounded() * 4
            for spark in 0..<(4 + cluster.2) {
                let hash = Self.hash(clusterIndex, spark, 5)
                let x = baseX + CGFloat(Int(hash % 6) - 3) * 4
                let y = baseY + CGFloat(Int((hash >> 4) % 6) - 3) * 4
                guard x >= 0, y >= 0, x < size.width, y < size.height else { continue }
                let dimension: CGFloat = hash % 5 == 0 ? 4 : 2
                context.fill(
                    Path(CGRect(x: x, y: y, width: dimension, height: dimension)),
                    with: .color(cluster.1.opacity(0.8))
                )
            }
        }
    }

    /// Sparse 2x2 stars in the ink palette.
    private func drawStars(context: inout GraphicsContext, size: CGSize) {
        let palette: [Color] = [DS.Palette.inkFaint, DS.Palette.inkFaint, DS.Palette.inkDim, DS.Palette.inkFaint]
        for index in 0..<36 {
            let rawX = Self.hash(index, 1, 3) % UInt32(max(1, Int(size.width / 4)))
            let rawY = Self.hash(index, 2, 5) % UInt32(max(1, Int(size.height * 0.80 / 4)))
            let x = CGFloat(rawX) * 4
            let y = CGFloat(rawY) * 4
            let color = palette[Int(Self.hash(index, 3, 9)) % palette.count]
            context.fill(
                Path(CGRect(x: x, y: y, width: 2, height: 2)),
                with: .color(color.opacity(0.65))
            )
        }
    }

    /// Stepped pixel skyline sitting on the bottom horizon.
    private func drawSkyline(context: inout GraphicsContext, size: CGSize) {
        let groundY = (size.height - 26).rounded()
        context.fill(
            Path(CGRect(x: 0, y: groundY, width: size.width, height: size.height - groundY)),
            with: .color(DS.Palette.inset)
        )
        // Fixed, deliberate blocks: widths 48/64/32, stepped heights.
        let widths: [CGFloat] = [64, 48, 72, 40, 64, 48, 56]
        let heights: [CGFloat] = [24, 40, 32, 56, 40, 64, 32]
        var x: CGFloat = 0
        var index = 0
        while x < size.width {
            let blockWidth = widths[index % widths.count]
            let blockHeight = heights[(index * 3) % heights.count]
            let blockTop = groundY - blockHeight
            context.fill(
                Path(CGRect(x: x, y: blockTop, width: blockWidth, height: blockHeight)),
                with: .color(DS.Palette.bgRaised)
            )
            context.fill(
                Path(CGRect(x: x, y: blockTop, width: blockWidth, height: 1)),
                with: .color(DS.Palette.border.opacity(0.8))
            )
            // Two or three lit windows per block.
            let windowCount = 2 + Int(Self.hash(index, 4, 11) % 2)
            for window in 0..<windowCount {
                let windowX = x + 8 + CGFloat(window) * 16
                guard windowX + 2 <= x + blockWidth else { continue }
                let windowY = blockTop + 10 + CGFloat(Int(Self.hash(index, window, 13) % 3)) * 8
                guard windowY + 2 <= groundY - 2 else { continue }
                let colors: [Color] = [DS.Palette.teal, DS.Palette.purple, DS.Palette.amber]
                context.fill(
                    Path(CGRect(x: windowX, y: windowY, width: 2, height: 2)),
                    with: .color(colors[Int(Self.hash(index, window, 17)) % colors.count].opacity(0.55))
                )
            }
            x += blockWidth + 16
            index += 1
        }
    }

    /// Oversized icon-style token bars, left of the bottom skyline.
    private func drawChartBars(context: inout GraphicsContext, size: CGSize) {
        let baseY = (size.height - 26).rounded()
        let bars: [(CGFloat, CGFloat)] = [(28, 32), (48, 56), (68, 80), (88, 48)]
        for (index, bar) in bars.enumerated() {
            let barWidth: CGFloat = 12
            let blockTop = baseY - bar.1
            context.fill(
                Path(CGRect(x: bar.0, y: blockTop, width: barWidth, height: bar.1)),
                with: .color(DS.Palette.inset)
            )
            context.fill(
                Path(CGRect(x: bar.0 + 2, y: blockTop + 2, width: barWidth - 4, height: bar.1 - 2)),
                with: .color(DS.Palette.tealDark.opacity(0.75))
            )
            let litHeight = (bar.1 * 0.70).rounded()
            context.fill(
                Path(CGRect(x: bar.0 + 2, y: baseY - litHeight, width: barWidth - 4, height: litHeight - 1)),
                with: .color(DS.Palette.teal.opacity(index % 2 == 0 ? 0.28 : 0.18))
            )
            context.fill(
                Path(CGRect(x: bar.0, y: blockTop, width: barWidth, height: 1)),
                with: .color(DS.Palette.border)
            )
        }
    }

    /// The icon's alternating teal/purple bottom strip.
    private func drawBottomStrip(context: inout GraphicsContext, size: CGSize) {
        let stripY = size.height - 2
        var x: CGFloat = 0
        var index = 0
        while x < size.width {
            let color: Color
            switch index % 3 {
            case 0: color = DS.Palette.teal
            case 1: color = DS.Palette.purple
            default: color = DS.Palette.border
            }
            context.fill(
                Path(CGRect(x: x, y: stripY, width: 8, height: 2)),
                with: .color(color.opacity(index % 3 == 2 ? 1 : 0.75))
            )
            x += 8
            index += 1
        }
    }

    /// Bayer 4x4 ordered-dither matrix (flattened, 0...15).
    private static let bayer4: [Int] = [
        0, 8, 2, 10,
        12, 4, 14, 6,
        3, 11, 1, 9,
        15, 7, 13, 5,
    ]

    /// Deterministic 32-bit hash used for star / window placement (snapshots
    /// are byte-identical between runs).
    private static func hash(_ a: Int, _ b: Int, _ seed: Int) -> UInt32 {
        var value = UInt32(truncatingIfNeeded: (a &* 73856093) ^ (b &* 19349663) ^ (seed &* 83492791))
        value ^= value >> 13
        value = value &* 1274126177
        value ^= value >> 16
        return value
    }
}
