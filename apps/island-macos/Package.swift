// swift-tools-version:5.9
import PackageDescription

// Token Island — native macOS "Dynamic Island" widget.
// No external dependencies. Swift language mode v5 keeps Swift 6 strict
// concurrency out of the way (the package is AppKit/SwiftUI main-actor code).
//
// NOTE: `swiftLanguageModes` in PackageDescription requires tools-version 6.0,
// while the contract mandates tools-version 5.9. `swiftLanguageVersions: [.v5]`
// is the 5.9-compatible spelling and yields the same Swift 5 language mode.
let package = Package(
    name: "TokenIsland",
    platforms: [.macOS(.v13)],
    products: [
        .executable(name: "TokenIsland", targets: ["TokenIsland"]),
    ],
    targets: [
        .executableTarget(
            name: "TokenIsland",
            path: "Sources/TokenIsland"
        ),
    ],
    swiftLanguageVersions: [.v5]
)
