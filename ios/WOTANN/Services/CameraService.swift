import Foundation
@preconcurrency import AVFoundation
import Vision
import Combine
#if canImport(UIKit)
import UIKit
#endif

// MARK: - CameraError

/// Errors from photo capture and text extraction operations.
enum CameraError: LocalizedError {
    case cameraPermissionDenied
    case captureSessionFailed
    case photoCaptureFailed(Error)
    case noPhotoData
    case ocrFailed(Error)
    case cameraUnavailable

    var errorDescription: String? {
        switch self {
        case .cameraPermissionDenied:
            return "Camera access is required"
        case .captureSessionFailed:
            return "Failed to configure the camera"
        case .photoCaptureFailed(let error):
            return "Photo capture failed: \(error.localizedDescription)"
        case .noPhotoData:
            return "No image data received from camera"
        case .ocrFailed(let error):
            return "Text extraction failed: \(error.localizedDescription)"
        case .cameraUnavailable:
            return "No camera is available on this device"
        }
    }
}

// MARK: - CameraService

/// Camera service for photo capture and Vision-based OCR text extraction.
///
/// Capabilities registered with NodeCapabilityService:
/// - `camera.snap`: Capture a single photo
/// - `camera.clip`: Extract text from a captured or provided image
#if canImport(UIKit)
@MainActor
final class CameraService: NSObject, ObservableObject {

    // MARK: Published State

    @Published var lastCapturedImage: UIImage?
    @Published var extractedText: String = ""
    @Published var isCapturing = false
    @Published var error: CameraError?

    // MARK: Private

    private var captureSession: AVCaptureSession?
    private var photoOutput: AVCapturePhotoOutput?
    private var photoContinuation: CheckedContinuation<UIImage, Error>?

    // MARK: - Permissions

    /// Request camera permission.
    /// - Returns: `true` if granted.
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

    // MARK: - Photo Capture

    /// Capture a single photo using the rear camera.
    /// - Returns: The captured `UIImage`.
    func capturePhoto() async throws -> UIImage {
        guard AVCaptureDevice.authorizationStatus(for: .video) == .authorized else {
            throw CameraError.cameraPermissionDenied
        }

        isCapturing = true
        error = nil

        defer { isCapturing = false }

        // Configure session
        let session = AVCaptureSession()
        session.sessionPreset = .photo

        guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back) else {
            throw CameraError.cameraUnavailable
        }

        let input = try AVCaptureDeviceInput(device: device)
        guard session.canAddInput(input) else {
            throw CameraError.captureSessionFailed
        }
        session.addInput(input)

        let output = AVCapturePhotoOutput()
        guard session.canAddOutput(output) else {
            throw CameraError.captureSessionFailed
        }
        session.addOutput(output)
        photoOutput = output

        session.startRunning()
        captureSession = session

        let image: UIImage = try await withCheckedThrowingContinuation { continuation in
            self.photoContinuation = continuation

            let settings = AVCapturePhotoSettings()
            output.capturePhoto(with: settings, delegate: self)
        }

        session.stopRunning()
        captureSession = nil
        photoOutput = nil

        lastCapturedImage = image
        return image
    }

    // MARK: - OCR / Text Extraction

    /// Extract text from an image using VNRecognizeTextRequest.
    /// - Parameter image: The source image.
    /// - Returns: All recognized text joined by newlines.
    func extractText(from image: UIImage) async throws -> String {
        guard let cgImage = image.cgImage else {
            throw CameraError.ocrFailed(
                NSError(domain: "CameraService", code: -1,
                        userInfo: [NSLocalizedDescriptionKey: "Could not get CGImage from UIImage"])
            )
        }

        let result: String = try await withCheckedThrowingContinuation { continuation in
            let request = VNRecognizeTextRequest { request, error in
                if let error {
                    continuation.resume(throwing: CameraError.ocrFailed(error))
                    return
                }

                let observations = request.results as? [VNRecognizedTextObservation] ?? []
                let text = observations
                    .compactMap { $0.topCandidates(1).first?.string }
                    .joined(separator: "\n")

                continuation.resume(returning: text)
            }

            request.recognitionLevel = .accurate
            request.usesLanguageCorrection = true

            let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
            do {
                try handler.perform([request])
            } catch {
                continuation.resume(throwing: CameraError.ocrFailed(error))
            }
        }

        extractedText = result
        return result
    }

    /// Capture a photo and immediately extract text from it.
    /// - Returns: The recognized text.
    func captureAndExtractText() async throws -> String {
        let image = try await capturePhoto()
        return try await extractText(from: image)
    }
}

// MARK: - AVCapturePhotoCaptureDelegate

extension CameraService: AVCapturePhotoCaptureDelegate {
    nonisolated func photoOutput(
        _ output: AVCapturePhotoOutput,
        didFinishProcessingPhoto photo: AVCapturePhoto,
        error: Error?
    ) {
        Task { @MainActor in
            if let error {
                self.photoContinuation?.resume(throwing: CameraError.photoCaptureFailed(error))
                self.photoContinuation = nil
                return
            }

            guard let data = photo.fileDataRepresentation(),
                  let image = UIImage(data: data) else {
                self.photoContinuation?.resume(throwing: CameraError.noPhotoData)
                self.photoContinuation = nil
                return
            }

            self.photoContinuation?.resume(returning: image)
            self.photoContinuation = nil
        }
    }
}

#else

// MARK: - macOS / non-UIKit stub

/// Stub for non-UIKit platforms (macOS builds, tests).
@MainActor
final class CameraService: ObservableObject {
    @Published var extractedText: String = ""
    @Published var isCapturing = false
    @Published var error: CameraError?

    func requestPermission() async -> Bool { false }
    func extractText(from data: Data) async throws -> String { "" }
}

#endif
