import Foundation
@preconcurrency import AVFoundation
import Combine
#if canImport(UIKit)
import UIKit
#endif

// MARK: - ContinuityCameraError

/// Errors from Continuity Camera capture operations.
enum ContinuityCameraError: LocalizedError {
    case cameraPermissionDenied
    case noContinuityCameraFound
    case captureSessionFailed(String)
    case photoCaptureFailed(Error)
    case noPhotoData
    case streamingUnavailable

    var errorDescription: String? {
        switch self {
        case .cameraPermissionDenied:
            return "Camera access is required for Continuity Camera"
        case .noContinuityCameraFound:
            return "No Continuity Camera device found. Ensure your Mac is nearby and signed into the same Apple ID."
        case .captureSessionFailed(let detail):
            return "Capture session failed: \(detail)"
        case .photoCaptureFailed(let error):
            return "Photo capture failed: \(error.localizedDescription)"
        case .noPhotoData:
            return "No image data received from Continuity Camera"
        case .streamingUnavailable:
            return "Camera streaming is not available"
        }
    }
}

// MARK: - ContinuityCameraService

/// Uses AVCaptureDevice.DiscoverySession to find and stream from Continuity Camera.
///
/// When an iPhone is used as a macOS Continuity Camera, the desktop requests
/// the camera feed via the system. This service provides the companion-side
/// controls: capturing single photos for context injection and managing
/// the streaming session lifecycle.
///
/// Architecture:
/// 1. Discover available cameras via AVCaptureDevice.DiscoverySession
/// 2. Prefer the back wide-angle camera for Continuity Camera use
/// 3. Single-photo capture for injecting visual context into conversations
/// 4. Streaming mode sends frames to the desktop via CompanionServer RPC
#if canImport(UIKit)
@MainActor
final class ContinuityCameraService: NSObject, ObservableObject {

    // MARK: Published State

    @Published var isStreaming = false
    @Published var isCapturing = false
    @Published var lastCapturedPhoto: UIImage?
    @Published var error: ContinuityCameraError?
    @Published var activeDeviceName: String?
    @Published var frameCount: Int = 0

    // MARK: Private

    private var captureSession: AVCaptureSession?
    private var photoOutput: AVCapturePhotoOutput?
    private var videoOutput: AVCaptureVideoDataOutput?
    private var photoContinuation: CheckedContinuation<Data, Error>?
    private var streamingRPCClient: RPCClient?
    private let processingQueue = DispatchQueue(
        label: "com.wotann.continuity-camera",
        qos: .userInitiated
    )

    // MARK: - Permissions

    /// Request camera access permission.
    /// - Returns: `true` if the user granted access.
    func requestPermission() async -> Bool {
        let status = AVCaptureDevice.authorizationStatus(for: .video)
        switch status {
        case .authorized:
            return true
        case .notDetermined:
            return await AVCaptureDevice.requestAccess(for: .video)
        default:
            return false
        }
    }

    // MARK: - Device Discovery

    /// Find the best available camera for Continuity Camera use.
    ///
    /// Prefers the back wide-angle camera, which is what macOS requests
    /// for Continuity Camera. Falls back to any available back camera.
    /// - Returns: The best available capture device, or nil.
    func discoverContinuityCamera() -> AVCaptureDevice? {
        let discoverySession = AVCaptureDevice.DiscoverySession(
            deviceTypes: [
                .builtInWideAngleCamera,
                .builtInUltraWideCamera,
                .builtInTelephotoCamera,
            ],
            mediaType: .video,
            position: .back
        )

        let devices = discoverySession.devices

        // Prefer wide-angle (the standard Continuity Camera lens)
        if let wideAngle = devices.first(where: { $0.deviceType == .builtInWideAngleCamera }) {
            return wideAngle
        }

        return devices.first
    }

    // MARK: - Capture Lifecycle

    /// Start the camera capture session for Continuity Camera streaming.
    ///
    /// This configures the AVCaptureSession with both photo and video outputs,
    /// allowing single-photo capture as well as continuous frame streaming.
    ///
    /// - Parameter rpcClient: Optional RPC client for streaming frames to the desktop.
    func startCapture(rpcClient: RPCClient? = nil) async throws {
        guard AVCaptureDevice.authorizationStatus(for: .video) == .authorized else {
            throw ContinuityCameraError.cameraPermissionDenied
        }

        guard let device = discoverContinuityCamera() else {
            throw ContinuityCameraError.noContinuityCameraFound
        }

        error = nil
        streamingRPCClient = rpcClient

        let session = AVCaptureSession()
        session.sessionPreset = .high

        // Add camera input
        let input: AVCaptureDeviceInput
        do {
            input = try AVCaptureDeviceInput(device: device)
        } catch {
            throw ContinuityCameraError.captureSessionFailed(error.localizedDescription)
        }

        guard session.canAddInput(input) else {
            throw ContinuityCameraError.captureSessionFailed("Cannot add camera input")
        }
        session.addInput(input)

        // Add photo output for single-frame captures
        let photo = AVCapturePhotoOutput()
        guard session.canAddOutput(photo) else {
            throw ContinuityCameraError.captureSessionFailed("Cannot add photo output")
        }
        session.addOutput(photo)
        photoOutput = photo

        // Add video output for streaming frames
        let video = AVCaptureVideoDataOutput()
        video.alwaysDiscardsLateVideoFrames = true
        video.setSampleBufferDelegate(self, queue: processingQueue)

        guard session.canAddOutput(video) else {
            throw ContinuityCameraError.captureSessionFailed("Cannot add video output")
        }
        session.addOutput(video)
        videoOutput = video

        // Start the session on a background thread to avoid blocking the main actor
        captureSession = session
        activeDeviceName = device.localizedName

        let capturedSession = session
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            processingQueue.async { [capturedSession] in
                capturedSession.startRunning()
                continuation.resume()
            }
        }

        isStreaming = true
    }

    /// Stop the capture session and release all resources.
    func stopCapture() {
        guard let session = captureSession else { return }
        let capturedSession = session
        processingQueue.async { [capturedSession] in
            capturedSession.stopRunning()
        }

        captureSession = nil
        photoOutput = nil
        videoOutput = nil
        streamingRPCClient = nil
        activeDeviceName = nil
        isStreaming = false
        frameCount = 0
    }

    // MARK: - Photo Capture

    /// Capture a single photo for context injection into a conversation.
    ///
    /// The photo is returned as JPEG data at 80% quality, suitable for
    /// base64 encoding and sending to the desktop agent.
    ///
    /// - Returns: JPEG image data.
    func capturePhoto() async throws -> Data {
        guard let session = captureSession, session.isRunning else {
            // If no session is active, start a temporary one for the photo
            return try await captureOneShot()
        }

        guard let output = photoOutput else {
            throw ContinuityCameraError.streamingUnavailable
        }

        isCapturing = true
        error = nil

        defer { isCapturing = false }

        let imageData: Data = try await withCheckedThrowingContinuation { continuation in
            self.photoContinuation = continuation

            let settings = AVCapturePhotoSettings()
            settings.flashMode = .auto
            output.capturePhoto(with: settings, delegate: self)
        }

        if let image = UIImage(data: imageData) {
            lastCapturedPhoto = image
        }

        return imageData
    }

    // MARK: - One-Shot Capture

    /// Capture a single photo without maintaining an ongoing session.
    /// Creates a temporary capture session, takes the photo, and tears down.
    private func captureOneShot() async throws -> Data {
        guard AVCaptureDevice.authorizationStatus(for: .video) == .authorized else {
            throw ContinuityCameraError.cameraPermissionDenied
        }

        guard let device = discoverContinuityCamera() else {
            throw ContinuityCameraError.noContinuityCameraFound
        }

        isCapturing = true
        error = nil

        defer { isCapturing = false }

        let session = AVCaptureSession()
        session.sessionPreset = .photo

        let input = try AVCaptureDeviceInput(device: device)
        guard session.canAddInput(input) else {
            throw ContinuityCameraError.captureSessionFailed("Cannot add camera input")
        }
        session.addInput(input)

        let output = AVCapturePhotoOutput()
        guard session.canAddOutput(output) else {
            throw ContinuityCameraError.captureSessionFailed("Cannot add photo output")
        }
        session.addOutput(output)

        session.startRunning()

        let imageData: Data = try await withCheckedThrowingContinuation { continuation in
            self.photoContinuation = continuation

            let settings = AVCapturePhotoSettings()
            output.capturePhoto(with: settings, delegate: self)
        }

        session.stopRunning()

        if let image = UIImage(data: imageData) {
            lastCapturedPhoto = image
        }

        return imageData
    }

    // MARK: - Frame Streaming

    /// Send a captured video frame to the desktop via RPC.
    /// Frames are sent as base64-encoded JPEG at reduced quality for bandwidth.
    private func sendFrame(_ sampleBuffer: CMSampleBuffer) {
        guard let rpcClient = streamingRPCClient else { return }
        guard let imageBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }

        let ciImage = CIImage(cvPixelBuffer: imageBuffer)
        let context = CIContext()

        guard let cgImage = context.createCGImage(ciImage, from: ciImage.extent) else { return }

        let uiImage = UIImage(cgImage: cgImage)

        // Use lower quality for streaming bandwidth
        guard let jpegData = uiImage.jpegData(compressionQuality: 0.3) else { return }

        let base64Frame = jpegData.base64EncodedString()

        Task { @MainActor in
            self.frameCount += 1
            _ = try? await rpcClient.send("continuity.frame", params: [
                "frame": .string(base64Frame),
                "width": .int(Int(ciImage.extent.width)),
                "height": .int(Int(ciImage.extent.height)),
                "sequence": .int(self.frameCount),
            ])
        }
    }
}

// MARK: - AVCapturePhotoCaptureDelegate

extension ContinuityCameraService: AVCapturePhotoCaptureDelegate {
    nonisolated func photoOutput(
        _ output: AVCapturePhotoOutput,
        didFinishProcessingPhoto photo: AVCapturePhoto,
        error: Error?
    ) {
        Task { @MainActor in
            if let error {
                self.photoContinuation?.resume(throwing: ContinuityCameraError.photoCaptureFailed(error))
                self.photoContinuation = nil
                return
            }

            guard let data = photo.fileDataRepresentation() else {
                self.photoContinuation?.resume(throwing: ContinuityCameraError.noPhotoData)
                self.photoContinuation = nil
                return
            }

            self.photoContinuation?.resume(returning: data)
            self.photoContinuation = nil
        }
    }
}

// MARK: - AVCaptureVideoDataOutputSampleBufferDelegate

extension ContinuityCameraService: AVCaptureVideoDataOutputSampleBufferDelegate {
    nonisolated func captureOutput(
        _ output: AVCaptureOutput,
        didOutput sampleBuffer: CMSampleBuffer,
        from connection: AVCaptureConnection
    ) {
        // Throttle frame sending: only send every 10th frame (~3 fps at 30 fps capture)
        // to avoid overwhelming the WebSocket connection
        let currentFrame = sampleBuffer.presentationTimeStamp.value
        guard currentFrame % 10 == 0 else { return }

        Task { @MainActor in
            sendFrame(sampleBuffer)
        }
    }
}

#else

// MARK: - macOS / non-UIKit Stub

/// Stub for non-UIKit platforms (macOS builds, tests).
@MainActor
final class ContinuityCameraService: ObservableObject {
    @Published var isStreaming = false
    @Published var isCapturing = false
    @Published var error: ContinuityCameraError?
    @Published var activeDeviceName: String?
    @Published var frameCount: Int = 0

    func requestPermission() async -> Bool { false }
    func startCapture(rpcClient: RPCClient? = nil) async throws {
        throw ContinuityCameraError.streamingUnavailable
    }
    func stopCapture() {}
    func capturePhoto() async throws -> Data {
        throw ContinuityCameraError.streamingUnavailable
    }
}

#endif
