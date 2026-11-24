import AppKit
import SwiftUI

// MARK: - Notch-Attached & Telemetry Primitives

/// Shape with sharp 0pt top corners (flush against the top screen bezel) and
/// smooth rounded bottom corners.
struct NotchAttachedShape: Shape {
    var bottomRadius: CGFloat = DS.Space.bottomCorner

    func path(in rect: CGRect) -> Path {
        let r = max(0, min(bottomRadius, min(rect.width / 2, rect.height)))
        let cg = CGMutablePath()
        cg.move(to: CGPoint(x: rect.minX, y: rect.minY))
        cg.addLine(to: CGPoint(x: rect.maxX, y: rect.minY))
        cg.addArc(
            tangent1End: CGPoint(x: rect.maxX, y: rect.maxY),
            tangent2End: CGPoint(x: rect.midX, y: rect.maxY),
            radius: r
        )
        cg.addArc(
            tangent1End: CGPoint(x: rect.minX, y: rect.maxY),
            tangent2End: CGPoint(x: rect.minX, y: rect.minY),
            radius: r
        )
        cg.addLine(to: CGPoint(x: rect.minX, y: rect.minY))
        cg.closeSubpath()
        return Path(cg)
    }
}

/// Three-sided U-border (left, rounded bottom corners, bottom, right) so the
/// top edge merges seamlessly into the black screen bezel with no top line.
struct NotchAttachedBorder: Shape {
    var bottomRadius: CGFloat = DS.Space.bottomCorner

    func path(in rect: CGRect) -> Path {
        let minX = rect.minX + 0.5
        let maxX = rect.maxX - 0.5
        let minY = rect.minY
        let maxY = rect.maxY - 0.5
        let r = max(0, min(bottomRadius - 0.5, min((maxX - minX) / 2, maxY - minY)))
        let cg = CGMutablePath()
        cg.move(to: CGPoint(x: minX, y: minY))
        cg.addArc(
            tangent1End: CGPoint(x: minX, y: maxY),
            tangent2End: CGPoint(x: rect.midX, y: maxY),
            radius: r
        )
        cg.addArc(
            tangent1End: CGPoint(x: maxX, y: maxY),
            tangent2End: CGPoint(x: maxX, y: minY),
            radius: r
        )
        cg.addLine(to: CGPoint(x: maxX, y: minY))
        return Path(cg)
    }
}

/// Backdrop for the expanded notch-attached panel: blends from pure #000000 at
/// the top edge (fusing with the physical notch) into `DS.Palette.surface`.
struct NotchAttachedPanel: View {
    var border: Color = DS.Palette.borderHi
    var bottomRadius: CGFloat = DS.Space.bottomCorner

    var body: some View {
        NotchAttachedShape(bottomRadius: bottomRadius)
            .fill(
                LinearGradient(
                    stops: [
                        .init(color: DS.Palette.notchBlack, location: 0.0),
                        .init(color: Color(hex: 0x0b0e14), location: 0.10),
                        .init(color: DS.Palette.surface, location: 0.24),
                    ],
                    startPoint: .top,
                    endPoint: .bottom
                )
            )
            .allowsHitTesting(false)
    }
}

struct PixelPanel: View {
    var fill: Color = DS.Palette.surface
    var border: Color = DS.Palette.borderHi
    var highlight: Color = Color.white.opacity(0.06)
    var shadow: Color = DS.Palette.shadow
    var showsShadow: Bool = false
    var corner: CGFloat = DS.Space.corner
    var opacity: Double = 1

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: corner, style: .continuous)
        ZStack(alignment: .top) {
            shape.fill(fill.opacity(opacity))
            shape.strokeBorder(border, lineWidth: 1)
            RoundedRectangle(cornerRadius: max(1, corner - 1), style: .continuous)
                .strokeBorder(
                    LinearGradient(
                        colors: [highlight, .clear],
                        startPoint: .top,
                        endPoint: .bottom
                    ),
                    lineWidth: 1
                )
        }
        .allowsHitTesting(false)
    }
}

struct PixelInset: View {
    var fill: Color = DS.Palette.inset
    var border: Color = DS.Palette.border
    var corner: CGFloat = DS.Space.cardCorner

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: corner, style: .continuous)
        ZStack {
            shape.fill(fill)
            shape.strokeBorder(border, lineWidth: 1)
        }
        .allowsHitTesting(false)
    }
}

struct PixelDivider: View {
    var color: Color = DS.Palette.border

    var body: some View {
        Rectangle()
            .fill(color)
            .frame(height: 1)
            .allowsHitTesting(false)
    }
}

// MARK: Menu-bar & utility sprites

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

    func templateImage(scale: CGFloat, canvas: CGSize = CGSize(width: 18, height: 18)) -> NSImage? {
        let imageSize = NSSize(width: canvas.width, height: canvas.height)
        let image = NSImage(size: imageSize, flipped: false) { _ in
            NSColor.black.setFill()
            let bars: [NSRect] = [
                NSRect(x: 3, y: 4, width: 3, height: 6),
                NSRect(x: 7.5, y: 4, width: 3, height: 11),
                NSRect(x: 12, y: 4, width: 3, height: 8.5),
            ]
            for rect in bars {
                NSBezierPath(roundedRect: rect, xRadius: 1, yRadius: 1).fill()
            }
            return true
        }
        image.isTemplate = true
        return image
    }
}

// MARK: Blink LED dot

struct BlinkDot: View {
    var live: Bool
    var size: CGFloat = 6
    var animated: Bool = true
    var onColor: Color = DS.Palette.teal
    var offColor: Color = DS.Palette.tealDark
    var idleColor: Color = DS.Palette.inkFaint

    @State private var frameOn = true

    private var color: Color {
        guard live else { return idleColor }
        return frameOn ? onColor : offColor
    }

    private var glow: CGFloat {
        guard live else { return 0 }
        return frameOn ? 1 : 0.35
    }

    var body: some View {
        DotLED(color: color, diameter: size, glow: glow)
            .frame(width: size + DotLED.haloPadding * 2, height: size + DotLED.haloPadding * 2)
            .onReceive(Timer.publish(every: DS.Motion.blinkFrame, on: .main, in: .common).autoconnect()) { _ in
                guard live, animated else { return }
                frameOn.toggle()
            }
            .onChange(of: live) { newValue in
                frameOn = newValue
            }
    }
}

// MARK: Status Pill Badge

struct StatusBadge: View {
    let status: IslandStatus
    var animated: Bool = true

    private var accent: Color {
        switch status {
        case .live: return DS.Palette.teal
        case .idle: return DS.Palette.inkDim
        case .offline: return DS.Palette.amber
        }
    }

    private var displayTitle: String {
        switch status {
        case .live: return "Live"
        case .idle: return "Idle"
        case .offline: return "Offline"
        }
    }

    var body: some View {
        HStack(spacing: 5) {
            Circle()
                .fill(accent)
                .frame(width: 6, height: 6)
            Text(displayTitle)
                .font(DS.Typography.sans(11.5, weight: .semibold))
                .foregroundColor(accent)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 2.5)
        .background(
            RoundedRectangle(cornerRadius: DS.Space.smallCorner, style: .continuous)
                .fill(accent.opacity(0.15))
        )
        .accessibilityLabel(Text("\(displayTitle) status"))
    }
}

// MARK: Button & Toast

struct PixelButton: View {
    let title: String
    var accent: Color = DS.Palette.ink
    var fill: Color = DS.Palette.surfaceAlt
    var border: Color = DS.Palette.borderHi
    var minWidth: CGFloat = 0
    var action: () -> Void

    @State private var hovered = false

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(DS.Typography.sans(12, weight: .semibold))
                .foregroundColor(hovered ? DS.Palette.teal : accent)
                .padding(.horizontal, 12)
                .frame(minWidth: minWidth, minHeight: 28)
                .background(
                    RoundedRectangle(cornerRadius: DS.Space.cardCorner, style: .continuous)
                        .fill(fill)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: DS.Space.cardCorner, style: .continuous)
                        .strokeBorder(hovered ? DS.Palette.teal : border, lineWidth: 1)
                )
        }
        .buttonStyle(.plain)
        .onHover { isHovering in
            hovered = isHovering
        }
    }
}

struct PixelToast: View {
    let text: String

    var body: some View {
        Text(text)
            .font(DS.Typography.sans(12, weight: .medium))
            .foregroundColor(DS.Palette.ink)
            .padding(.horizontal, 12)
            .padding(.vertical, 5)
            .background(
                RoundedRectangle(cornerRadius: DS.Space.cardCorner, style: .continuous)
                    .fill(DS.Palette.surfaceAlt)
            )
            .overlay(
                RoundedRectangle(cornerRadius: DS.Space.cardCorner, style: .continuous)
                    .strokeBorder(DS.Palette.borderHi, lineWidth: 1)
            )
    }
}
