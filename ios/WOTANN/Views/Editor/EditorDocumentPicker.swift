import SwiftUI
import UIKit
import UniformTypeIdentifiers

// MARK: - EditorDocumentPicker
//
// SwiftUI wrapper around `UIDocumentPickerViewController` for opening files
// from iCloud Drive / Files / On-My-iPhone. Supports a generous content-type
// allow-list — any `public.text` descendant plus a handful of code formats
// that aren't always declared as text by their app vendors (e.g. `.swift`).
//
// The picker is presented modally; the wrapped controller deinits when the
// user taps Cancel or selects a file, so the binding flips back to false.
//
// Quality bar #7: per-instance state. The picker doesn't share any caches
// between sessions; each open allocates a fresh delegate.

struct EditorDocumentPicker: UIViewControllerRepresentable {

    /// Called with the picked file URL. Caller is responsible for any
    /// security-scoped resource handling — we forward the URL as-is.
    var onPicked: (URL) -> Void

    /// Called when the user cancels.
    var onCancel: () -> Void = {}

    // MARK: - UIViewControllerRepresentable

    func makeUIViewController(context: Context) -> UIDocumentPickerViewController {
        // We keep the type list explicit so `.swift`, `.toml`, etc. aren't
        // silently filtered out by the OS UTI inference layer.
        let types: [UTType] = [
            .text,
            .plainText,
            .sourceCode,
            .swiftSource,
            .pythonScript,
            .json,
            .yaml,
            .xml,
            .html,
            .css,
            .javaScript,
            .data,             // last resort — opens anything if user insists
        ].compactMap { $0 }

        let picker = UIDocumentPickerViewController(forOpeningContentTypes: types, asCopy: true)
        picker.delegate = context.coordinator
        picker.allowsMultipleSelection = false
        picker.shouldShowFileExtensions = true
        return picker
    }

    func updateUIViewController(_ vc: UIDocumentPickerViewController, context: Context) { }

    // MARK: - Coordinator

    func makeCoordinator() -> Coordinator {
        Coordinator(onPicked: onPicked, onCancel: onCancel)
    }

    final class Coordinator: NSObject, UIDocumentPickerDelegate {
        let onPicked: (URL) -> Void
        let onCancel: () -> Void

        init(onPicked: @escaping (URL) -> Void, onCancel: @escaping () -> Void) {
            self.onPicked = onPicked
            self.onCancel = onCancel
        }

        func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
            guard let url = urls.first else {
                onCancel()
                return
            }
            // The picker was created with `asCopy: true` so we don't need
            // to start a security-scoped session on the original URL.
            onPicked(url)
        }

        func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
            onCancel()
        }
    }
}
