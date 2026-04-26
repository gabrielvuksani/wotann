import SwiftUI
@preconcurrency import AVFoundation

// MARK: - QRScannerView

/// AVFoundation camera QR code scanner wrapped for SwiftUI.
struct QRScannerView: View {
    let onScan: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var isAuthorized = false
    @State private var showPermissionDenied = false
    @State private var scannerError: String?

    var body: some View {
        NavigationStack {
            ZStack {
                if isAuthorized {
                    if let scannerError {
                        unavailableView(message: scannerError)
                    } else {
                        QRCameraPreview(
                            onScan: { code in
                                HapticService.shared.trigger(.pairingSuccess)
                                onScan(code)
                            },
                            onFailure: { error in
                                scannerError = error
                            }
                        )
                        .ignoresSafeArea()

                        // Scanning overlay
                        scanOverlay
                    }
                } else if showPermissionDenied {
                    permissionDeniedView
                } else {
                    FullScreenLoading(message: "Requesting camera access...")
                }
            }
            .background(WTheme.Colors.background)
            .navigationTitle("Scan QR Code")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
            .task {
                let status = AVCaptureDevice.authorizationStatus(for: .video)
                switch status {
                case .authorized:
                    isAuthorized = true
                    scannerError = nil
                case .notDetermined:
                    isAuthorized = await AVCaptureDevice.requestAccess(for: .video)
                    showPermissionDenied = !isAuthorized
                    scannerError = nil
                default:
                    showPermissionDenied = true
                }
            }
        }
    }

    private var scanOverlay: some View {
        VStack {
            Spacer()

            // Scan frame
            RoundedRectangle(cornerRadius: WTheme.Radius.lg)
                .strokeBorder(WTheme.Colors.primary, lineWidth: 3)
                .frame(width: 250, height: 250)
                .background(Color.clear)
                .overlay(
                    // Corner accents
                    ZStack {
                        cornerAccent(rotation: 0)
                        cornerAccent(rotation: 90)
                        cornerAccent(rotation: 180)
                        cornerAccent(rotation: 270)
                    }
                )

            Text("Point your camera at the QR code\nshown on your desktop")
                .multilineTextAlignment(.center)
                .font(WTheme.Typography.subheadline)
                .foregroundColor(.white)
                .padding(.top, WTheme.Spacing.lg)

            Spacer()
        }
    }

    private func cornerAccent(rotation: Double) -> some View {
        Rectangle()
            .fill(WTheme.Colors.primary)
            .frame(width: 30, height: 4)
            .offset(x: -110, y: -123)
            .rotationEffect(.degrees(rotation))
    }

    private var permissionDeniedView: some View {
        EmptyState(
            icon: "camera.fill",
            title: "Camera Access Required",
            subtitle: "WOTANN needs camera access to scan QR codes for pairing. Please enable it in Settings.",
            action: {
                if let url = URL(string: UIApplication.openSettingsURLString) {
                    UIApplication.shared.open(url)
                }
            },
            actionTitle: "Open Settings"
        )
    }

    private func unavailableView(message: String) -> some View {
        EmptyState(
            icon: "camera.viewfinder",
            title: "Camera Preview Unavailable",
            subtitle: message,
            action: {
                scannerError = nil
            },
            actionTitle: "Retry"
        )
    }
}

// MARK: - QRCameraPreview

/// UIViewRepresentable for the AVCaptureSession camera preview.
struct QRCameraPreview: UIViewRepresentable {
    let onScan: (String) -> Void
    let onFailure: (String) -> Void

    func makeUIView(context: Context) -> PreviewView {
        let view = PreviewView(frame: .zero)
        view.backgroundColor = .black
        context.coordinator.attach(to: view, onFailure: onFailure)
        return view
    }

    func updateUIView(_ uiView: PreviewView, context: Context) {
        context.coordinator.updateOrientation(for: uiView)
    }

    static func dismantleUIView(_ uiView: PreviewView, coordinator: Coordinator) {
        coordinator.stopSession()
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(onScan: onScan)
    }

    class Coordinator: NSObject, AVCaptureMetadataOutputObjectsDelegate {
        let onScan: (String) -> Void
        private let sessionQueue = DispatchQueue(label: "com.wotann.qrscanner.session", qos: .userInitiated)
        var session: AVCaptureSession?
        weak var previewView: PreviewView?
        private var hasScanned = false
        private var isConfigured = false

        init(onScan: @escaping (String) -> Void) {
            self.onScan = onScan
        }

        func attach(to previewView: PreviewView, onFailure: @escaping (String) -> Void) {
            self.previewView = previewView
            previewView.previewLayer.videoGravity = .resizeAspectFill
            updateOrientation(for: previewView)

            guard !isConfigured else {
                previewView.previewLayer.session = session
                startSessionIfNeeded()
                return
            }

            let session = AVCaptureSession()
            session.beginConfiguration()
            session.sessionPreset = .high

            guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back)
                ?? AVCaptureDevice.default(for: .video) else {
                session.commitConfiguration()
                onFailure("No camera is available on this device.")
                return
            }

            do {
                let input = try AVCaptureDeviceInput(device: device)
                guard session.canAddInput(input) else {
                    session.commitConfiguration()
                    onFailure("WOTANN could not attach the camera input.")
                    return
                }
                session.addInput(input)
            } catch {
                session.commitConfiguration()
                onFailure("WOTANN could not configure the camera: \(error.localizedDescription)")
                return
            }

            let output = AVCaptureMetadataOutput()
            guard session.canAddOutput(output) else {
                session.commitConfiguration()
                onFailure("WOTANN could not configure QR scanning output.")
                return
            }

            session.addOutput(output)
            output.setMetadataObjectsDelegate(self, queue: .main)

            if output.availableMetadataObjectTypes.contains(.qr) {
                output.metadataObjectTypes = [.qr]
            } else {
                session.commitConfiguration()
                onFailure("QR scanning is not supported on this device.")
                return
            }

            session.commitConfiguration()

            self.session = session
            self.isConfigured = true
            previewView.previewLayer.session = session
            startSessionIfNeeded()
        }

        func updateOrientation(for previewView: PreviewView) {
            guard let connection = previewView.previewLayer.connection else { return }

            if #available(iOS 17.0, *) {
                if let interfaceOrientation = previewView.window?.windowScene?.interfaceOrientation {
                    connection.videoRotationAngle = angle(for: interfaceOrientation)
                }
            } else if connection.isVideoOrientationSupported,
                      let interfaceOrientation = previewView.window?.windowScene?.interfaceOrientation,
                      let orientation = AVCaptureVideoOrientation(interfaceOrientation: interfaceOrientation) {
                connection.videoOrientation = orientation
            }
        }

        func stopSession() {
            guard let session else { return }
            sessionQueue.async {
                if session.isRunning {
                    session.stopRunning()
                }
            }
        }

        private func startSessionIfNeeded() {
            guard let session else { return }
            sessionQueue.async {
                guard !session.isRunning else { return }
                session.startRunning()
            }
        }

        @available(iOS 17.0, *)
        private func angle(for orientation: UIInterfaceOrientation) -> CGFloat {
            switch orientation {
            case .portrait:
                return 90
            case .portraitUpsideDown:
                return 270
            case .landscapeLeft:
                return 0
            case .landscapeRight:
                return 180
            default:
                return 90
            }
        }

        func metadataOutput(
            _ output: AVCaptureMetadataOutput,
            didOutput metadataObjects: [AVMetadataObject],
            from connection: AVCaptureConnection
        ) {
            guard !hasScanned,
                  let metadata = metadataObjects.first as? AVMetadataMachineReadableCodeObject,
                  metadata.type == .qr,
                  let code = metadata.stringValue else {
                return
            }

            hasScanned = true
            stopSession()
            onScan(code)
        }
    }
}

final class PreviewView: UIView {
    override class var layerClass: AnyClass {
        AVCaptureVideoPreviewLayer.self
    }

    var previewLayer: AVCaptureVideoPreviewLayer {
        guard let layer = layer as? AVCaptureVideoPreviewLayer else {
            fatalError("PreviewView layer is not AVCaptureVideoPreviewLayer")
        }
        return layer
    }
}

private extension AVCaptureVideoOrientation {
    init?(interfaceOrientation: UIInterfaceOrientation) {
        switch interfaceOrientation {
        case .portrait:
            self = .portrait
        case .portraitUpsideDown:
            self = .portraitUpsideDown
        case .landscapeLeft:
            self = .landscapeRight
        case .landscapeRight:
            self = .landscapeLeft
        default:
            return nil
        }
    }
}
