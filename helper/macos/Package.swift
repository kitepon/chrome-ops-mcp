// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "ChromeOpsHelper",
    platforms: [.macOS(.v13)],
    products: [
        .executable(name: "chrome-ops-helper", targets: ["ChromeOpsHelper"])
    ],
    targets: [
        .executableTarget(name: "ChromeOpsHelper")
    ]
)
