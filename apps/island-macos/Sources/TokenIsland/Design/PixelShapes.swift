import AppKit
import SwiftUI

// MARK: - Pixel primitives
//
// Every visual in the island is built from these integer-grid primitives:
// staircase-cornered panels with 2pt borders and hard shadows, 2px dividers,
// segmented bars, sprite glyphs and step-only blink dots. No curves, gradients
// or blur are allowed anywhere except the outer window shape macOS requires.

// MARK: Staircase rectangle

enum PixelShape {
    /// A rectangle whose corners are cut as a 2-step pixel staircase. All
    /// coordinates stay integer; the path is built from axis-aligned segments so
    /// it fills perfectly crisp at @2x (no antialiased diagonals).
    static func rect(_ rect: CGRect, corner: CGFloat) -> Path {
        let x = rect.minX
        let y = rect.minY
        let width = max(0, rect.width)
        let height = max(0, rect.height)
        let c = max(0, min(corner.rounded(), (min(width, height) / 2).rounded(.down)))
        guard c > 0 else { return Path(CGRect(x: x, y: y, width: width, height: height)) }

        var points: [CGPoint] = []
        // Top edge.
        points.append(CGPoint(x: x + c, y: y))
        points.append(CGPoint(x: x + width - c, y: y))
        // Top-right staircase (down, right, down, right ...).
        for index in 0..<Int(c) {
            let step = CGFloat(index)
            points.append(CGPoint(x: x + width - c + step, y: y + step + 1))
            points.append(CGPoint(x: x + width - c + step + 1, y: y + step + 1))
        }
        // Right edge.
        points.append(CGPoint(x: x + width, y: y + height - c))
        // Bottom-right staircase (left, down, left, down ...).
        for index in 0..<Int(c) {
            let step = CGFloat(index)
            points.append(CGPoint(x: x + width - 1 - step, y: y + height - c + step))
            points.append(CGPoint(x: x + width - 1 - step, y: y + height - c + step + 1))
        }
        // Bottom edge.
        points.append(CGPoint(x: x + c, y: y + height))
        // Bottom-left staircase (right, up, right, up ...).
        for index in 0..<Int(c) {
            let step = CGFloat(index)
            points.append(CGPoint(x: x + c - step, y: y + height - 1 - step))
            points.append(CGPoint(x: x + c - step - 1, y: y + height - 1 - step))
        }
        // Left edge.
        points.append(CGPoint(x: x, y: y + c))
        // Top-left staircase (right, up, right, up ...).
        for index in 0..<Int(c) {
            let step = CGFloat(index)
            points.append(CGPoint(x: x + step + 1, y: y + c - step))
            points.append(CGPoint(x: x + step + 1, y: y + c - step - 1))
        }
        points.append(CGPoint(x: x + c, y: y))

        var path = Path()
        path.move(to: points[0])
        for point in points.dropFirst() {
            path.addLine(to: point)
        }
        path.closeSubpath()
        return path
    }
}

// MARK: Panel

/// Pixel panel: flat fill, staircase corners, 2pt border, 1pt top highlight and
/// a hard 2pt offset shadow that lives inside the view (bottom strip).
struct PixelPanel: View {
    var fill: Color = DS.Palette.surface
    var border: Color = DS.Palette.border
    var highlight: Color = DS.Palette.borderHi
    var shadow: Color = DS.Palette.shadow
    var showsShadow: Bool = true
    var corner: CGFloat = DS.Space.corner
    var opacity: Double = 1

    var body: some View {
        Canvas { context, size in
            let shadowOffset = showsShadow ? DS.Size.shadow : 0
            let body = CGRect(
                x: 0,
                y: 0,
                width: size.width,
                height: max(0, size.height - shadowOffset)
            )
            let outer = PixelShape.rect(body, corner: corner)
            let inner = PixelShape.rect(
                CGRect(x: body.minX + DS.Space.border, y: body.minY + DS.Space.border,
                       width: body.width - DS.Space.border * 2, height: body.height - DS.Space.border * 2),
                corner: corner
            )

            if showsShadow {
                var transform = CGAffineTransform(translationX: DS.Size.shadow, y: DS.Size.shadow)
                if let shadowPath = outer.cgPath.copy(using: &transform) {
                    context.fill(Path(shadowPath), with: .color(shadow))
                }
            }
            context.fill(outer, with: .color(fill.opacity(opacity)))

            // 2pt hard border drawn as an even-odd ring (crisp, no stroke AA).
            var borderPath = Path()
            borderPath.addPath(outer)
            borderPath.addPath(inner)
            context.fill(borderPath, with: .color(border), style: FillStyle(eoFill: true))

            // 1pt top highlight, clipped to the top edge of the panel.
            let highlightRect = CGRect(x: body.minX + 3, y: body.minY, width: max(0, body.width - 6), height: 1)
            context.fill(Path(highlightRect), with: .color(highlight))
        }
        .allowsHitTesting(false)
    }
}

/// Inset well used behind tracks / fields.
struct PixelInset: View {
    var fill: Color = DS.Palette.inset
    var border: Color = DS.Palette.border

    var body: some View {
        Canvas { context, size in
            guard size.width >= 2, size.height >= 2 else { return }
            let outer = PixelShape.rect(CGRect(origin: .zero, size: size), corner: 1)
            let inner = PixelShape.rect(CGRect(x: 1, y: 1, width: size.width - 2, height: size.height - 2), corner: 1)
            context.fill(outer, with: .color(fill))
            var ring = Path()
            ring.addPath(outer)
            ring.addPath(inner)
            context.fill(ring, with: .color(border), style: FillStyle(eoFill: true))
        }
        .allowsHitTesting(false)
    }
}

// MARK: Divider

/// 4px-on / 2px-off 2px divider, like a classic 8-bit rule.
struct PixelDivider: View {
    var color: Color = DS.Palette.border
    var step: CGFloat = 6

    var body: some View {
        Canvas { context, size in
            var offset: CGFloat = 0
            while offset + 4 <= size.width {
                context.fill(
                    Path(CGRect(x: offset, y: 0, width: 4, height: 2)),
                    with: .color(color)
                )
                offset += step
            }
        }
        .frame(height: 2)
        .allowsHitTesting(false)
    }
}

// MARK: Segmented bar

/// Segmented bar with square cells. Filled cells use the accent colour, the
/// remaining cells the track colour; sizes snap to whole points.
struct PixelSegmentedBar: View {
    var ratio: Double
    var color: Color
    var height: CGFloat = 6
    var segments: Int? = nil
    var gap: CGFloat = 2
    var track: Color = DS.Palette.inset

    var body: some View {
        GeometryReader { geometry in
            Canvas { context, size in
                let width = size.width
                let gap = max(1, self.gap)
                let count = segments ?? max(1, Int(((width + gap) / (6 + gap)).rounded(.down)))
                let segmentWidth = max(1, ((width - gap * CGFloat(count - 1)) / CGFloat(count)).rounded(.down))
                let filled = max(0, min(count, Int((ratio * Double(count)).rounded())))
                for index in 0..<count {
                    let x = CGFloat(index) * (segmentWidth + gap)
                    let rect = CGRect(x: x, y: 0, width: segmentWidth, height: size.height)
                    context.fill(Path(rect), with: .color(index < filled ? color : track))
                }
            }
        }
        .frame(height: height)
        .allowsHitTesting(false)
    }
}

// MARK: Sprites (exact copies of packages/core PIXEL_SPRITES)

enum PixelSprite: String, CaseIterable {
    case dot, heart, flame, bolt, cloud, pin, check, cross, arrowUp, arrowDown, pulse, coin, chart, clock, gear

    var rows: [String] {
        switch self {
        case .dot: return ["###", "###", "###"]
        case .heart: return [".#.#.", "#####", "#####", ".###.", "..#.."]
        case .flame: return ["..#..", ".##..", "####.", "#####", ".###.", "..#.."]
        case .bolt: return ["...##", "..##.", ".##..", ".###.", "..##.", ".##..", "##..."]
        case .cloud: return ["..###..", ".#####.", "#######", "#######", ".#####."]
        case .pin: return ["..#..", ".###.", ".###.", "..#..", "..#..", "..#.."]
        case .check: return ["....#", "...#.", "#.#..", ".#..."]
        case .cross: return ["#...#", ".#.#.", "..#..", ".#.#.", "#...#"]
        case .arrowUp: return ["..#..", ".###.", "#####", "..#..", "..#.."]
        case .arrowDown: return ["..#..", "..#..", "#####", ".###.", "..#.."]
        case .pulse: return ["#....", ".#..#", "..#..", "..#..", "#..#.", "#...."]
        case .coin: return [".###.", "#...#", "#.#.#", "#...#", ".###."]
        case .chart: return ["....#", "...#.", "..#..", ".#.#.", "#...#"]
        case .clock: return [".###.", "#...#", "#.#.#", "#...#", ".###."]
        case .gear: return [".#.#.", "#####", ".##..", "#####", ".#.#."]
        }
    }

    var pixelWidth: Int { rows.map(\.count).max() ?? 0 }
    var pixelHeight: Int { rows.count }

    func width(scale: CGFloat) -> CGFloat { CGFloat(pixelWidth) * scale }
    func height(scale: CGFloat) -> CGFloat { CGFloat(pixelHeight) * scale }

    /// Draws the sprite into a CoreGraphics context at integer coordinates.
    func draw(in context: CGContext, x: CGFloat, y: CGFloat, scale: CGFloat, color: CGColor) {
        context.setFillColor(color)
        for (rowIndex, row) in rows.enumerated() {
            var runStart = -1
            let characters = Array(row)
            for column in 0...characters.count {
                let on = column < characters.count && characters[column] == "#"
                if on && runStart == -1 {
                    runStart = column
                } else if !on && runStart != -1 {
                    let rect = CGRect(
                        x: x + CGFloat(runStart) * scale,
                        y: y + CGFloat(rowIndex) * scale,
                        width: CGFloat(column - runStart) * scale,
                        height: scale
                    )
                    context.fill(rect)
                    runStart = -1
                }
            }
        }
    }
}

/// Pixel sprite as a SwiftUI view at an integer scale.
struct PixelSpriteView: View {
    let sprite: PixelSprite
    var scale: CGFloat = 1
    var color: Color = DS.Palette.ink

    var body: some View {
        Canvas { context, _ in
            context.withCGContext { cg in
                cg.setShouldAntialias(false)
                sprite.draw(in: cg, x: 0, y: 0, scale: scale, color: NSColor(color).cgColor)
            }
        }
        .frame(width: sprite.width(scale: scale), height: sprite.height(scale: scale))
        .allowsHitTesting(false)
    }
}

extension PixelSprite {
    /// Generates a black template NSImage (used for the menu-bar icon).
    func templateImage(scale: CGFloat, canvas: CGSize = CGSize(width: 18, height: 18)) -> NSImage? {
        let imageSize = NSSize(width: canvas.width, height: canvas.height)
        let width = width(scale: scale)
        let height = height(scale: scale)
        let originX = ((canvas.width - width) / 2).rounded()
        let originY = ((canvas.height - height) / 2).rounded()
        let image = NSImage(size: imageSize, flipped: false) { _ in
            guard let context = NSGraphicsContext.current?.cgContext else { return false }
            context.setShouldAntialias(false)
            self.draw(
                in: context,
                x: originX,
                y: originY,
                scale: scale,
                color: NSColor.black.cgColor
            )
            return true
        }
        image.isTemplate = true
        return image
    }
}

// MARK: Blink dot

/// 3x3 live dot at 2x (6pt). Two-frame step blink while live, static grey when
/// idle. Snapshots get the deterministic "on" frame.
struct BlinkDot: View {
    var live: Bool
    var size: CGFloat = 6
    var animated: Bool = true
    var onColor: Color = DS.Palette.teal
    var offColor: Color = DS.Palette.tealDark
    var idleColor: Color = DS.Palette.inkFaint

    @State private var frameOn = true

    private var scale: CGFloat { max(1, (size / 3).rounded()) }
    private var color: Color {
        guard live else { return idleColor }
        return frameOn ? onColor : offColor
    }

    var body: some View {
        PixelSpriteView(sprite: .dot, scale: scale, color: color)
            .frame(width: size, height: size)
            .onReceive(Timer.publish(every: DS.Motion.blinkFrame, on: .main, in: .common).autoconnect()) { _ in
                guard live, animated else { return }
                frameOn.toggle()
            }
            .onChange(of: live) { newValue in
                frameOn = newValue
            }
    }
}

// MARK: Status badge

/// Panel 56x16 with a 2pt accent border and 8pt status text.
struct StatusBadge: View {
    let status: IslandStatus
    var width: CGFloat = 56
    var height: CGFloat = 16

    private var accent: Color {
        switch status {
        case .live: return DS.Palette.teal
        case .idle: return DS.Palette.inkDim
        case .offline: return DS.Palette.amber
        }
    }

    var body: some View {
        ZStack(alignment: .topLeading) {
            PixelPanel(
                fill: DS.Palette.surfaceAlt,
                border: accent,
                highlight: accent.opacity(0.45),
                showsShadow: false
            )
            PixelText(
                text: status.label,
                size: DS.FontSize.micro,
                color: accent,
                tracking: DS.Tracking.label
            )
            .offset(x: 8, y: 6)
        }
        .frame(width: width, height: height)
        .accessibilityLabel(Text("\(status.label) status"))
    }
}

// MARK: Pixel button

/// Chunky pixel button: panel + centre label, hard shadow, pressed state steps.
struct PixelButton: View {
    let title: String
    var accent: Color = DS.Palette.ink
    var fill: Color = DS.Palette.surfaceAlt
    var border: Color = DS.Palette.border
    var minWidth: CGFloat = 0
    var action: () -> Void

    @State private var pressed = false

    var body: some View {
        Button(action: action) {
            ZStack {
                PixelPanel(fill: pressed ? DS.Palette.inset : fill, border: border, highlight: border, showsShadow: true)
                PixelText(
                    text: title,
                    size: DS.FontSize.micro,
                    color: accent,
                    tracking: DS.Tracking.label,
                    width: nil,
                    alignment: .leading
                )
                .padding(.horizontal, 10)
            }
            .frame(height: 24)
            .frame(minWidth: minWidth)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering in
            pressed = hovering ? false : pressed
        }
        .simultaneousGesture(
            DragGesture(minimumDistance: 0)
                .onChanged { _ in pressed = true }
                .onEnded { _ in pressed = false }
        )
    }
}

// MARK: Toast

struct PixelToast: View {
    let text: String

    var body: some View {
        ZStack(alignment: .topLeading) {
            PixelPanel(
                fill: DS.Palette.surfaceAlt,
                border: DS.Palette.borderHi,
                highlight: DS.Palette.borderHi,
                showsShadow: true
            )
            PixelText(
                text: text,
                size: DS.FontSize.micro,
                color: DS.Palette.ink,
                tracking: DS.Tracking.label
            )
            .padding(.horizontal, 8)
            .offset(y: 6)
        }
        .frame(height: 20)
    }
}

// MARK: Legend swatch

struct PixelLegendDot: View {
    var color: Color
    var size: CGFloat = 4

    var body: some View {
        Rectangle()
            .fill(color)
            .frame(width: size, height: size)
    }
}
