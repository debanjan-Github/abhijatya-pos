import UIKit
import Capacitor
import VisionKit

@objc(NativeBarcodeScannerPlugin)
@available(iOS 16.0, *)
final class NativeBarcodeScannerPlugin: CAPPlugin, CAPBridgedPlugin, DataScannerViewControllerDelegate, UIAdaptivePresentationControllerDelegate {
    let identifier = "NativeBarcodeScannerPlugin"
    let jsName = "NativeBarcodeScanner"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setStatus", returnType: CAPPluginReturnPromise)
    ]

    private var scanner: DataScannerViewController?
    private var recentlyScanned: [String: Date] = [:]
    private weak var statusLabel: UILabel?
    private weak var statusBackground: UIVisualEffectView?

    @objc func start(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            guard #available(iOS 16.0, *) else {
                call.reject("Native barcode scanning requires iOS 16 or later.")
                return
            }
            guard DataScannerViewController.isSupported else {
                call.reject("This iPhone does not support native barcode scanning.")
                return
            }
            guard DataScannerViewController.isAvailable else {
                call.reject("The camera is unavailable. Close other camera apps and try again.")
                return
            }
            guard self.scanner == nil else {
                call.reject("A barcode scan is already in progress.")
                return
            }
            guard let presentingViewController = self.bridge?.viewController else {
                call.reject("Barcode scanner is not ready.")
                return
            }

            let scanner = DataScannerViewController(
                recognizedDataTypes: [.barcode(symbologies: [.code128])],
                qualityLevel: .balanced,
                recognizesMultipleItems: true,
                isHighFrameRateTrackingEnabled: true,
                isGuidanceEnabled: true,
                isHighlightingEnabled: true
            )
            scanner.delegate = self
            self.scanner = scanner
            presentingViewController.present(scanner, animated: true) {
                scanner.presentationController?.delegate = self
                self.addStatusOverlay(to: scanner)
                do {
                    try scanner.startScanning()
                    call.resolve()
                } catch {
                    self.scanner = nil
                    scanner.dismiss(animated: true)
                    call.reject("Could not start the barcode camera: \(error.localizedDescription)")
                }
            }
        }
    }

    @available(iOS 16.0, *)
    func dataScanner(_ dataScanner: DataScannerViewController, didAdd addedItems: [RecognizedItem], allItems: [RecognizedItem]) {
        guard let item = addedItems.first else { return }
        if case let .barcode(barcode) = item, let value = barcode.payloadStringValue, !value.isEmpty {
            let now = Date()
            if let lastRead = recentlyScanned[value], now.timeIntervalSince(lastRead) < 1.2 {
                updateStatus("Already scanned \(value). Scan the next saree.", tone: "duplicate")
                return
            }
            recentlyScanned[value] = now
            notifyListeners("barcodeScanned", data: ["barcode": value])
        }
    }

    func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
        scanner = nil
        recentlyScanned.removeAll()
        statusLabel = nil
        statusBackground = nil
    }

    @objc func setStatus(_ call: CAPPluginCall) {
        let text = call.getString("message") ?? "Ready to scan the next saree."
        let tone = call.getString("tone") ?? "added"
        DispatchQueue.main.async { [weak self] in
            self?.updateStatus(text, tone: tone)
            call.resolve()
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            guard let scanner = self.scanner else {
                call.resolve()
                return
            }
            self.scanner = nil
            self.statusLabel = nil
            self.statusBackground = nil
            if #available(iOS 16.0, *) {
                scanner.stopScanning()
            }
            scanner.dismiss(animated: true) { call.resolve() }
        }
    }

    private func addStatusOverlay(to scanner: DataScannerViewController) {
        let effect = UIBlurEffect(style: .systemChromeMaterialDark)
        let background = UIVisualEffectView(effect: effect)
        background.layer.cornerRadius = 14
        background.clipsToBounds = true
        background.translatesAutoresizingMaskIntoConstraints = false

        let label = UILabel()
        label.font = .preferredFont(forTextStyle: .headline)
        label.textColor = .white
        label.numberOfLines = 0
        label.textAlignment = .center
        label.adjustsFontForContentSizeCategory = true
        label.translatesAutoresizingMaskIntoConstraints = false
        label.text = "Camera is ready. Scan the first barcode."

        scanner.view.addSubview(background)
        background.contentView.addSubview(label)
        NSLayoutConstraint.activate([
            background.leadingAnchor.constraint(equalTo: scanner.view.safeAreaLayoutGuide.leadingAnchor, constant: 22),
            background.trailingAnchor.constraint(equalTo: scanner.view.safeAreaLayoutGuide.trailingAnchor, constant: -22),
            background.bottomAnchor.constraint(equalTo: scanner.view.safeAreaLayoutGuide.bottomAnchor, constant: -28),
            label.leadingAnchor.constraint(equalTo: background.contentView.leadingAnchor, constant: 14),
            label.trailingAnchor.constraint(equalTo: background.contentView.trailingAnchor, constant: -14),
            label.topAnchor.constraint(equalTo: background.contentView.topAnchor, constant: 12),
            label.bottomAnchor.constraint(equalTo: background.contentView.bottomAnchor, constant: -12)
        ])
        statusLabel = label
        statusBackground = background
    }

    private func updateStatus(_ text: String, tone: String) {
        statusLabel?.text = text
        switch tone {
        case "duplicate": statusBackground?.contentView.backgroundColor = UIColor.systemOrange.withAlphaComponent(0.62)
        case "error": statusBackground?.contentView.backgroundColor = UIColor.systemRed.withAlphaComponent(0.62)
        default: statusBackground?.contentView.backgroundColor = UIColor.systemGreen.withAlphaComponent(0.55)
        }
    }
}

@objc(NativeProductActionsPlugin)
final class NativeProductActionsPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "NativeProductActionsPlugin"
    let jsName = "NativeProductActions"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "showActions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "confirmDelete", returnType: CAPPluginReturnPromise)
    ]

    @objc func showActions(_ call: CAPPluginCall) {
        let productName = call.getString("productName") ?? "this product"
        DispatchQueue.main.async { [weak self] in
            guard let self, let presenter = self.bridge?.viewController else {
                call.reject("Product actions are not ready.")
                return
            }
            let alert = UIAlertController(title: productName, message: "Product actions", preferredStyle: .actionSheet)
            alert.addAction(UIAlertAction(title: "Edit product", style: .default) { _ in call.resolve(["action": "edit"]) })
            alert.addAction(UIAlertAction(title: "Delete product", style: .destructive) { _ in call.resolve(["action": "delete"]) })
            alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in call.resolve(["action": "cancel"]) })
            self.configurePopover(alert, presenter: presenter)
            presenter.present(alert, animated: true)
        }
    }

    @objc func confirmDelete(_ call: CAPPluginCall) {
        let productName = call.getString("productName") ?? "this product"
        let permanent = call.getBool("permanent") ?? false
        let title = permanent ? "Permanently delete product?" : "Delete product?"
        let message = permanent
            ? "\(productName) will be removed permanently. This cannot be undone."
            : "\(productName) will be moved to Archived products."
        let actionTitle = permanent ? "Delete permanently" : "Delete product"
        DispatchQueue.main.async { [weak self] in
            guard let self, let presenter = self.bridge?.viewController else {
                call.reject("Delete confirmation is not ready.")
                return
            }
            let alert = UIAlertController(title: title, message: message, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in call.resolve(["confirmed": false]) })
            alert.addAction(UIAlertAction(title: actionTitle, style: .destructive) { _ in call.resolve(["confirmed": true]) })
            self.configurePopover(alert, presenter: presenter)
            presenter.present(alert, animated: true)
        }
    }

    private func configurePopover(_ alert: UIAlertController, presenter: UIViewController) {
        guard let popover = alert.popoverPresentationController else { return }
        popover.sourceView = presenter.view
        popover.sourceRect = CGRect(x: presenter.view.bounds.midX, y: presenter.view.bounds.midY, width: 1, height: 1)
        popover.permittedArrowDirections = []
    }
}

final class AppBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        if #available(iOS 16.0, *) {
            bridge?.registerPluginInstance(NativeBarcodeScannerPlugin())
        }
        bridge?.registerPluginInstance(NativeProductActionsPlugin())
    }
}

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = AppBridgeViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
