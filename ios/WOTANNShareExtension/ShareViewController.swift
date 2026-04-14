#if canImport(UIKit)
import UIKit
import SwiftUI

// MARK: - ShareViewController

/// Share extension host that presents a SwiftUI ShareView within the extension context.
class ShareViewController: UIViewController {
    private var sharedText: String = ""

    override func viewDidLoad() {
        super.viewDidLoad()
        extractSharedContent()
    }

    private func extractSharedContent() {
        guard let extensionItems = extensionContext?.inputItems as? [NSExtensionItem] else {
            presentShareView(with: "")
            return
        }

        for item in extensionItems {
            guard let attachments = item.attachments else { continue }

            for provider in attachments {
                if provider.hasItemConformingToTypeIdentifier("public.plain-text") {
                    provider.loadItem(forTypeIdentifier: "public.plain-text", options: nil) { [weak self] data, _ in
                        let text = (data as? String) ?? ""
                        DispatchQueue.main.async {
                            self?.presentShareView(with: text)
                        }
                    }
                    return
                }

                if provider.hasItemConformingToTypeIdentifier("public.url") {
                    provider.loadItem(forTypeIdentifier: "public.url", options: nil) { [weak self] data, _ in
                        let url = (data as? URL)?.absoluteString ?? ""
                        DispatchQueue.main.async {
                            self?.presentShareView(with: url)
                        }
                    }
                    return
                }
            }
        }

        presentShareView(with: "")
    }

    private func presentShareView(with text: String) {
        let shareView = ShareView(
            sharedText: text,
            onSend: { [weak self] selectedConversation, content in
                self?.sendToWOTANN(conversation: selectedConversation, content: content)
            },
            onCancel: { [weak self] in
                self?.extensionContext?.completeRequest(returningItems: nil)
            }
        )

        let hostingController = UIHostingController(rootView: shareView)
        hostingController.view.backgroundColor = .clear

        addChild(hostingController)
        view.addSubview(hostingController.view)
        hostingController.view.translatesAutoresizingMaskIntoConstraints = false

        NSLayoutConstraint.activate([
            hostingController.view.topAnchor.constraint(equalTo: view.topAnchor),
            hostingController.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            hostingController.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            hostingController.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])

        hostingController.didMove(toParent: self)
    }

    private func sendToWOTANN(conversation: String, content: String) {
        let payload: [String: String] = [
            "conversation": conversation,
            "content": content,
            "timestamp": ISO8601DateFormatter().string(from: Date()),
        ]

        if let data = try? JSONEncoder().encode(payload),
           let defaults = UserDefaults(suiteName: "group.com.wotann.shared") {
            var queue = defaults.array(forKey: "pendingShares") as? [Data] ?? []
            queue.append(data)
            defaults.set(queue, forKey: "pendingShares")
        }

        extensionContext?.completeRequest(returningItems: nil)
    }
}
#endif
