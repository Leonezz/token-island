import SwiftUI

// MARK: - Clean Synthetic Desktop Wallpaper for Headless Snapshots
//
// Replaces the busy checkerboard dither with a clean dark architectural desktop
// backdrop + macOS menu bar so `--snapshot --background wallpaper` highlights
// the Dynamic Island widget with zero visual noise.

struct WallpaperView: View {
    var body: some View {
        ZStack(alignment: .top) {
            LinearGradient(
                colors: [DS.Palette.bgRaised, DS.Palette.bg],
                startPoint: .top,
                endPoint: .bottom
            )

            // Clean macOS Menu Bar
            VStack(spacing: 0) {
                HStack(spacing: 14) {
                    Text("")
                        .font(DS.Typography.sans(13, weight: .bold))
                        .foregroundColor(DS.Palette.ink)
                    Text("Xcode")
                        .font(DS.Typography.sans(12.5, weight: .semibold))
                        .foregroundColor(DS.Palette.ink)
                    Text("File")
                        .font(DS.Typography.sans(12.5, weight: .regular))
                        .foregroundColor(DS.Palette.inkDim)
                    Text("Edit")
                        .font(DS.Typography.sans(12.5, weight: .regular))
                        .foregroundColor(DS.Palette.inkDim)
                    Text("View")
                        .font(DS.Typography.sans(12.5, weight: .regular))
                        .foregroundColor(DS.Palette.inkDim)

                    Spacer()

                    HStack(spacing: 5) {
                        Circle()
                            .fill(DS.Palette.teal)
                            .frame(width: 6, height: 6)
                        Text("TI")
                            .font(DS.Typography.mono(11.5, weight: .semibold))
                            .foregroundColor(DS.Palette.inkDim)
                    }

                    Text("Tue 9:41 AM")
                        .font(DS.Typography.sans(12, weight: .medium))
                        .foregroundColor(DS.Palette.inkDim)
                }
                .padding(.horizontal, 18)
                .frame(height: 28)
                .background(DS.Palette.surface.opacity(0.88))

                Rectangle()
                    .fill(DS.Palette.border)
                    .frame(height: 1)
            }
        }
        .clipped()
    }
}
