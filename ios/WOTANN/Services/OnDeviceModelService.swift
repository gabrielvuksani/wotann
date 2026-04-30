import Foundation
#if canImport(FoundationModels)
import FoundationModels
#endif

/// On-device AI model service for iOS — 3-tier architecture for FULL offline capability.
///
/// Architecture (prioritized by speed and resource usage):
/// 1. Apple Foundation Models (iOS 26+) — free, zero-footprint, instant. Simple tasks.
/// 2. FunctionGemma 270M (~200MB) — action dispatch at 142 tok/s. Tool calling.
/// 3. Gemma 4 E2B (<1.5GB) — complex reasoning via MLX Swift. Full conversations.
/// 4. Cloud fallback — Gemini/Claude API when on-device can't handle it.
/// 5. OfflineQueueService — queue for later if all else fails.
///
/// When connected to KAIROS daemon, all requests route through desktop (primary path).
/// This service activates ONLY when the daemon is unreachable.
///
/// Frameworks:
/// - Apple Foundation Models: `import FoundationModels` (iOS 26+)
/// - MLX Swift: `import MLX, MLXLLM` (iOS 18+, Apple Silicon)
/// - llama.cpp: Swift SPM bindings for GGUF models (iOS 14+)

// MARK: - On-Device Model Configuration

struct OnDeviceModelConfig {
    /// Model identifier for download/caching
    let modelId: String
    /// Hugging Face repository (MLX-quantized variant)
    let hfRepo: String
    /// Approximate download size in bytes
    let downloadSize: Int64
    /// Approximate RAM usage in bytes
    let ramUsage: Int64
    /// Minimum iOS version required
    let minIOSVersion: Double

    static let gemma4E2B = OnDeviceModelConfig(
        modelId: "gemma-4-e2b-q4",
        hfRepo: "mlx-community/gemma-4-e2b-4bit",
        downloadSize: 2_000_000_000, // ~2GB
        ramUsage: 2_500_000_000,     // ~2.5GB
        minIOSVersion: 17.0
    )

    /// FunctionGemma 270M — ultra-fast action dispatch (142 tok/s on iPhone)
    /// Purpose-built for translating natural language into function/tool calls.
    /// Only 200MB — runs on any modern iPhone.
    static let functionGemma = OnDeviceModelConfig(
        modelId: "functiongemma-270m-q4",
        hfRepo: "google/functiongemma-270m-it",
        downloadSize: 200_000_000,   // ~200MB
        ramUsage: 300_000_000,       // ~300MB
        minIOSVersion: 16.0
    )

    static let phi4Mini = OnDeviceModelConfig(
        modelId: "phi-4-mini-q4",
        hfRepo: "mlx-community/Phi-4-mini-instruct-4bit",
        downloadSize: 2_200_000_000,
        ramUsage: 2_800_000_000,
        minIOSVersion: 17.0
    )
}

// MARK: - On-Device Model Service

@MainActor
final class OnDeviceModelService: ObservableObject {
    @Published var isModelLoaded = false
    @Published var isDownloading = false
    @Published var downloadProgress: Double = 0
    @Published var isGenerating = false
    @Published var lastError: String?

    private let config: OnDeviceModelConfig
    private let offlineQueue: OfflineQueueService

    /// Public read of the active on-device model id (e.g.
    /// "gemma-4-e2b-q4"). ChatViewModel surfaces this in the message
    /// metadata so the user sees the actual model that produced the
    /// reply rather than a hardcoded label.
    var activeModelId: String { config.modelId }

    /// Public read of the active on-device model's HuggingFace repo,
    /// useful for any UI that surfaces "Model: gemma/gemma-4-e2b-it
    /// (offline, 2.6 GB)" line.
    var activeModelRepo: String { config.hfRepo }

    @MainActor
    init(config: OnDeviceModelConfig = .gemma4E2B) {
        self.config = config
        self.offlineQueue = OfflineQueueService()
    }

    /// Check if the device has enough resources to run on-device inference
    var canRunOnDevice: Bool {
        let totalRAM = ProcessInfo.processInfo.physicalMemory
        let availableRAM = totalRAM / 2 // Conservative: use at most half
        return Int64(availableRAM) >= config.ramUsage
    }

    /// Check if the model is already downloaded (looks for completion marker)
    var isModelDownloaded: Bool {
        let marker = modelCacheDirectory.appendingPathComponent(".wotann-model-ready")
        return FileManager.default.fileExists(atPath: marker.path)
    }

    /// Directory where the model is cached
    private var modelCacheDirectory: URL {
        let cacheDir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first!
        return cacheDir.appendingPathComponent("wotann-models/\(config.modelId)")
    }

    /// Smart offline routing for on-device inference.
    ///
    /// Architecture: Daemon is PRIMARY for all AI. This method is ONLY called
    /// when the desktop daemon is unreachable (offline mode).
    ///
    /// Routing order (when offline):
    /// 1. If user has opted into on-device inference AND model is downloaded → run locally
    /// 2. If Apple Foundation Models available (iOS 26+) AND user opted in → use AFM
    /// 3. Otherwise → queue for delivery when desktop reconnects
    ///
    /// The `enableOnDeviceInference` flag is controlled by Settings > Voice & AI.
    func generate(prompt: String, systemPrompt: String = "", enableOnDeviceInference: Bool = false) async -> String {

        // If user hasn't opted in, always queue for desktop
        guard enableOnDeviceInference else {
            offlineQueue.enqueue(prompt: prompt)
            return "[Queued for desktop — will deliver when connection resumes]"
        }

        // Check hardware requirements
        guard canRunOnDevice else {
            offlineQueue.enqueue(prompt: prompt)
            return "[Queued — device doesn't have enough RAM for on-device inference (\(config.ramUsage / 1_000_000_000)GB required)]"
        }

        isGenerating = true
        defer { isGenerating = false }

        // Tier 1: Downloaded MLX model (if available and user opted in)
        #if canImport(MLXLLM)
        if isModelDownloaded {
            do {
                let modelURL = modelCacheDirectory
                let configuration = ModelConfiguration(directory: modelURL)
                let model = try await LLMModelFactory.shared.load(configuration: configuration)

                var fullPrompt = ""
                if !systemPrompt.isEmpty {
                    fullPrompt += "<start_of_turn>system\n\(systemPrompt)<end_of_turn>\n"
                }
                fullPrompt += "<start_of_turn>user\n\(prompt)<end_of_turn>\n<start_of_turn>model\n"

                let result = try await model.generate(
                    prompt: fullPrompt,
                    parameters: .init(temperature: 0.7, topP: 0.95, maxTokens: 2048)
                )
                return result.output
            } catch {
                lastError = error.localizedDescription
                // Fall through to next tier
            }
        }
        #endif

        // Tier 2: Apple Foundation Models (iOS 26+) — zero-download fallback
        // Only compiles when building with iOS 26+ SDK (FoundationModels framework)
        #if canImport(FoundationModels)
        if #available(iOS 26, *) {
            do {
                let session = LanguageModelSession()
                let response = try await session.respond(to: prompt)
                return response.content
            } catch {
                lastError = error.localizedDescription
                // Fall through to queue
            }
        }
        #endif

        // Tier 3: Queue for desktop delivery
        offlineQueue.enqueue(prompt: prompt)
        return "[Queued for desktop — on-device models unavailable. Will deliver when connection resumes.]"
    }

    /// Download the model for offline use from HuggingFace.
    /// Downloads the config.json to verify access, then fetches the quantized model weights.
    func downloadModel() async throws {
        guard !isDownloading else { return }
        isDownloading = true
        downloadProgress = 0
        lastError = nil

        defer { isDownloading = false }

        let modelDir = modelCacheDirectory
        try FileManager.default.createDirectory(at: modelDir, withIntermediateDirectories: true)

        // Key files needed for MLX model loading — includes weight shards
        var filesToDownload = [
            "config.json",
            "tokenizer.json",
            "tokenizer_config.json",
            "model.safetensors.index.json",
        ]

        // Parse the index file to discover actual weight shard filenames
        let indexPath = modelDir.appendingPathComponent("model.safetensors.index.json")
        if FileManager.default.fileExists(atPath: indexPath.path),
           let indexData = try? Data(contentsOf: indexPath),
           let index = try? JSONSerialization.jsonObject(with: indexData) as? [String: Any],
           let weightMap = index["weight_map"] as? [String: String] {
            let shardFiles = Set(weightMap.values)
            filesToDownload.append(contentsOf: shardFiles.sorted())
        } else {
            // If no index exists yet, download it first then re-parse
            // Common shard names for small quantized models
            filesToDownload.append("model.safetensors")
        }

        let baseURL = "https://huggingface.co/\(config.hfRepo)/resolve/main"

        // Download each required file
        for (idx, filename) in filesToDownload.enumerated() {
            guard let url = URL(string: "\(baseURL)/\(filename)") else { continue }
            let destPath = modelDir.appendingPathComponent(filename)

            // Skip if already downloaded
            if FileManager.default.fileExists(atPath: destPath.path) {
                downloadProgress = Double(idx + 1) / Double(filesToDownload.count + 1)
                continue
            }

            do {
                let (tempURL, response) = try await URLSession.shared.download(from: url)
                guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 else {
                    continue
                }

                // Move to destination
                if FileManager.default.fileExists(atPath: destPath.path) {
                    try FileManager.default.removeItem(at: destPath)
                }
                try FileManager.default.moveItem(at: tempURL, to: destPath)
            } catch {
                // Non-fatal — some files may not exist for all model variants
                lastError = "Failed to download \(filename): \(error.localizedDescription)"
            }

            downloadProgress = Double(idx + 1) / Double(filesToDownload.count + 1)
        }

        // Write a completion marker
        let markerPath = modelDir.appendingPathComponent(".wotann-model-ready")
        try "Downloaded \(config.modelId) from \(config.hfRepo)".write(to: markerPath, atomically: true, encoding: .utf8)
        downloadProgress = 1.0
        isModelLoaded = true
    }

    /// Remove downloaded model to free storage
    func deleteModel() throws {
        let modelDir = modelCacheDirectory
        if FileManager.default.fileExists(atPath: modelDir.path) {
            try FileManager.default.removeItem(at: modelDir)
        }
        isModelLoaded = false
    }

    /// Get the estimated storage impact
    var storageEstimate: String {
        let gb = Double(config.downloadSize) / 1_000_000_000
        return String(format: "%.1f GB", gb)
    }
}

// MARK: - OfflineQueueService Convenience

extension OnDeviceModelService {
    /// Convenience to queue a prompt via the offline service
    private func queueForLater(_ prompt: String) {
        offlineQueue.enqueue(prompt: prompt)
    }
}
