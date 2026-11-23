import SwiftUI

// MARK: - Synthetic desktop wallpaper
//
// `--snapshot --background wallpaper` composites the island over this
// generated dark blue/purple 16:10 desktop so README screenshots look like a
// real macOS capture (screen recording permission is not available).

struct WallpaperView: View {
    var body: some View {
        GeometryReader { geometry in
            let width = geometry.size.width
            let height = geometry.size.height
            let diag = max(width, height)
            ZStack {
                LinearGradient(
                    stops: [
                        .init(color: Color(hex: 0x17224E), location: 0.0),
                        .init(color: Color(hex: 0x22204F), location: 0.30),
                        .init(color: Color(hex: 0x2B1A46), location: 0.64),
                        .init(color: Color(hex: 0x0C0A1C), location: 1.0),
                    ],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )

                RadialGradient(
                    colors: [Color(hex: 0x5B4BE0).opacity(0.62), Color(hex: 0x5B4BE0).opacity(0.0)],
                    center: UnitPoint(x: 0.86, y: 0.10),
                    startRadius: 4,
                    endRadius: diag * 0.62
                )

                RadialGradient(
                    colors: [Color(hex: 0x0F6C8A).opacity(0.50), Color(hex: 0x0F6C8A).opacity(0.0)],
                    center: UnitPoint(x: 0.04, y: 0.86),
                    startRadius: 4,
                    endRadius: diag * 0.58
                )

                RadialGradient(
                    colors: [Color(hex: 0x8B3AA8).opacity(0.38), Color(hex: 0x8B3AA8).opacity(0.0)],
                    center: UnitPoint(x: 0.55, y: 1.05),
                    startRadius: 4,
                    endRadius: diag * 0.55
                )

                RadialGradient(
                    colors: [Color(hex: 0x2E5BD8).opacity(0.30), Color(hex: 0x2E5BD8).opacity(0.0)],
                    center: UnitPoint(x: 0.16, y: 0.06),
                    startRadius: 2,
                    endRadius: diag * 0.46
                )

                // Soft vignette pulls the eye towards the top-center island.
                RadialGradient(
                    colors: [Color.clear, Color.black.opacity(0.50)],
                    center: UnitPoint(x: 0.5, y: 0.42),
                    startRadius: diag * 0.20,
                    endRadius: diag * 0.95
                )
            }
            .frame(width: width, height: height)
        }
        .clipped()
    }

}
