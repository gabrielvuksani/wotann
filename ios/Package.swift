// swift-tools-version: 6.0
import PackageDescription

/// WOTANN iOS package.
///
/// On-device AI is opt-in via SPM: the MLX and llama.cpp dependencies are
/// declared here so `import MLX` and `import MLXLLM` resolve when Xcode runs
/// the package. The canImport(FoundationModels) check in OnDeviceModelService
/// compiles Apple's system framework only on iOS 26+ SDKs.
let package = Package(
    name: "WOTANN",
    platforms: [
        .iOS(.v18),
        .watchOS(.v11),
    ],
    products: [
        .library(name: "WOTANNCore", targets: ["WOTANNCore"]),
    ],
    dependencies: [
        // MLX Swift — on-device ML runtime for Apple Silicon.
        // Provides MLX, MLXNN, MLXLLM modules used by OnDeviceModelService.
        .package(url: "https://github.com/ml-explore/mlx-swift.git", from: "0.21.0"),
        .package(url: "https://github.com/ml-explore/mlx-swift-examples.git", from: "2.21.0"),
        // Swift transformers — tokenizers + HuggingFace hub client for MLX.
        .package(url: "https://github.com/huggingface/swift-transformers.git", from: "0.1.17"),
    ],
    targets: [
        .target(
            name: "WOTANNCore",
            dependencies: [
                .product(name: "MLX", package: "mlx-swift"),
                .product(name: "MLXNN", package: "mlx-swift"),
                .product(name: "MLXRandom", package: "mlx-swift"),
                .product(name: "MLXLLM", package: "mlx-swift-examples"),
                .product(name: "MLXLMCommon", package: "mlx-swift-examples"),
                .product(name: "Transformers", package: "swift-transformers"),
            ],
            path: ".",
            exclude: [
                ".build",
                "Package.swift",
                "WOTANNWatch", // Watch is a separate Xcode target
            ],
            sources: [
                "WOTANN",
                "WOTANNIntents",
                "WOTANNWidgets",
                "WOTANNShareExtension",
                "WOTANNLiveActivity",
            ],
            swiftSettings: [
                .swiftLanguageMode(.v5),
                .define("WOTANN_MLX_AVAILABLE"),
            ]
        ),
    ]
)
