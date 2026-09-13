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
    private weak var closeButton: UIButton?

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
        closeButton = nil
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
            self.closeButton = nil
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

        let closeButton = UIButton(type: .system)
        closeButton.setTitle("Close", for: .normal)
        closeButton.setTitleColor(.white, for: .normal)
        closeButton.titleLabel?.font = .preferredFont(forTextStyle: .headline)
        closeButton.backgroundColor = UIColor.black.withAlphaComponent(0.58)
        closeButton.layer.cornerRadius = 12
        closeButton.contentEdgeInsets = UIEdgeInsets(top: 10, left: 16, bottom: 10, right: 16)
        closeButton.translatesAutoresizingMaskIntoConstraints = false
        closeButton.addTarget(self, action: #selector(closeScanner), for: .touchUpInside)

        scanner.view.addSubview(background)
        background.contentView.addSubview(label)
        scanner.view.addSubview(closeButton)
        NSLayoutConstraint.activate([
            closeButton.trailingAnchor.constraint(equalTo: scanner.view.safeAreaLayoutGuide.trailingAnchor, constant: -22),
            closeButton.topAnchor.constraint(equalTo: scanner.view.safeAreaLayoutGuide.topAnchor, constant: 18),
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
        self.closeButton = closeButton
    }

    @objc private func closeScanner() {
        guard let scanner else { return }
        self.scanner = nil
        scanner.stopScanning()
        scanner.dismiss(animated: true)
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

@objc(NativeBillSharePlugin)
final class NativeBillSharePlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "NativeBillSharePlugin"
    let jsName = "NativeBillShare"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "sharePdf", returnType: CAPPluginReturnPromise)
    ]

    @objc func sharePdf(_ call: CAPPluginCall) {
        let invoiceNumber = call.getString("invoiceNumber") ?? "ABHIJATYA-BILL"
        let dateText = call.getString("dateText") ?? ""
        let totalText = call.getString("totalText") ?? ""
        let paymentMethod = call.getString("paymentMethod") ?? ""
        let customerPhone = call.getString("customerPhone") ?? "Not provided"
        let logo = image(from: call.getString("logoDataUrl"))
        let items = call.getArray("items", JSObject.self) ?? []

        DispatchQueue.main.async { [weak self] in
            guard let self, let presenter = self.bridge?.viewController else {
                call.reject("PDF sharing is not ready.")
                return
            }
            do {
                let pdf = self.makeReceiptPdf(
                    invoiceNumber: invoiceNumber,
                    dateText: dateText,
                    totalText: totalText,
                    paymentMethod: paymentMethod,
                    customerPhone: customerPhone,
                    items: items,
                    logo: logo
                )
                let safeName = invoiceNumber.replacingOccurrences(of: "/", with: "-")
                let fileUrl = FileManager.default.temporaryDirectory.appendingPathComponent("\(safeName).pdf")
                try pdf.write(to: fileUrl, options: .atomic)

                let share = UIActivityViewController(activityItems: [fileUrl], applicationActivities: nil)
                share.completionWithItemsHandler = { _, completed, _, error in
                    if let error { call.reject(error.localizedDescription) }
                    else { call.resolve(["shared": completed]) }
                }
                self.configurePopover(share, presenter: presenter)
                presenter.present(share, animated: true)
            } catch {
                call.reject("Could not create the PDF bill: \(error.localizedDescription)")
            }
        }
    }

    private func makeReceiptPdf(invoiceNumber: String, dateText: String, totalText: String, paymentMethod: String, customerPhone: String, items: [JSObject], logo: UIImage?) -> Data {
        // This PDF is designed for sharing on WhatsApp, so it uses a clear
        // invoice layout. The separate Print action remains the 58 mm receipt.
        let width: CGFloat = 595
        let itemHeight = items.reduce(CGFloat(0)) { total, item in
            let name = item["name"] as? String ?? "Product"
            return total + max(40, CGFloat((name.count + 42) / 43) * 15 + 25)
        }
        let height = max(CGFloat(842), 410 + itemHeight + 160)
        let renderer = UIGraphicsPDFRenderer(bounds: CGRect(x: 0, y: 0, width: width, height: height))
        return renderer.pdfData { context in
            context.beginPage()
            let margin: CGFloat = 54
            var y: CGFloat = 48
            let boutiqueRed = UIColor(red: 0.70, green: 0.06, blue: 0.08, alpha: 1)
            let warmGrey = UIColor(red: 0.40, green: 0.37, blue: 0.34, alpha: 1)
            let softTint = UIColor(red: 0.98, green: 0.95, blue: 0.93, alpha: 1)
            let regular: [NSAttributedString.Key: Any] = [.font: UIFont.systemFont(ofSize: 10), .foregroundColor: UIColor.black]
            let small: [NSAttributedString.Key: Any] = [.font: UIFont.systemFont(ofSize: 8.5), .foregroundColor: warmGrey]
            let bold: [NSAttributedString.Key: Any] = [.font: UIFont.systemFont(ofSize: 11, weight: .semibold), .foregroundColor: UIColor.black]
            let title: [NSAttributedString.Key: Any] = [.font: UIFont.systemFont(ofSize: 24, weight: .bold), .foregroundColor: UIColor.black]
            let brand: [NSAttributedString.Key: Any] = [.font: UIFont.systemFont(ofSize: 18, weight: .medium), .foregroundColor: UIColor.black]
            let centered = paragraph(.center)
            let right = paragraph(.right)

            if let logo {
                logo.draw(in: CGRect(x: margin, y: y, width: 70, height: 70))
            }
            ("ABHIJATYA" as NSString).draw(in: CGRect(x: margin + 82, y: y + 12, width: 230, height: 24), withAttributes: brand)
            ("BOUTIQUE" as NSString).draw(in: CGRect(x: margin + 82, y: y + 38, width: 230, height: 16), withAttributes: small)
            ("SALES INVOICE" as NSString).draw(in: CGRect(x: 330, y: y + 4, width: width - margin - 330, height: 30), withAttributes: title.merging([.paragraphStyle: right]) { $1 })
            ("BILL NUMBER   \(invoiceNumber)" as NSString).draw(in: CGRect(x: 330, y: y + 40, width: width - margin - 330, height: 14), withAttributes: bold.merging([.paragraphStyle: right]) { $1 })
            (dateText as NSString).draw(in: CGRect(x: 330, y: y + 57, width: width - margin - 330, height: 13), withAttributes: small.merging([.paragraphStyle: right]) { $1 })
            y += 96
            drawRule(y: y, width: width, margin: margin, color: boutiqueRed, thickness: 2)
            y += 24

            // These two panels replace the irrelevant shipping/address fields
            // from a generic invoice with information Abhijatya actually has.
            fillRect(CGRect(x: margin, y: y, width: 232, height: 76), color: softTint)
            fillRect(CGRect(x: margin + 244, y: y, width: width - margin * 2 - 244, height: 76), color: softTint)
            ("BILLED TO" as NSString).draw(in: CGRect(x: margin + 13, y: y + 12, width: 180, height: 14), withAttributes: bold)
            ("Customer mobile" as NSString).draw(in: CGRect(x: margin + 13, y: y + 32, width: 180, height: 12), withAttributes: small)
            (customerPhone as NSString).draw(in: CGRect(x: margin + 13, y: y + 46, width: 200, height: 16), withAttributes: regular)
            ("PAYMENT" as NSString).draw(in: CGRect(x: margin + 257, y: y + 12, width: 180, height: 14), withAttributes: bold)
            ("Payment method" as NSString).draw(in: CGRect(x: margin + 257, y: y + 32, width: 180, height: 12), withAttributes: small)
            (paymentMethod as NSString).draw(in: CGRect(x: margin + 257, y: y + 46, width: 200, height: 16), withAttributes: regular)
            y += 102

            fillRect(CGRect(x: margin, y: y, width: width - margin * 2, height: 28), color: boutiqueRed)
            let headerStyle: [NSAttributedString.Key: Any] = [.font: UIFont.systemFont(ofSize: 9, weight: .bold), .foregroundColor: UIColor.white]
            ("ITEMS" as NSString).draw(in: CGRect(x: margin + 12, y: y + 9, width: 280, height: 12), withAttributes: headerStyle)
            ("QTY" as NSString).draw(in: CGRect(x: 396, y: y + 9, width: 45, height: 12), withAttributes: headerStyle.merging([.paragraphStyle: centered]) { $1 })
            ("SUBTOTAL" as NSString).draw(in: CGRect(x: 440, y: y + 9, width: 100, height: 12), withAttributes: headerStyle.merging([.paragraphStyle: right]) { $1 })
            y += 40

            for item in items {
                let name = item["name"] as? String ?? "Product"
                let barcode = item["barcode"] as? String ?? ""
                let quantity = item["quantity"] as? Int ?? 1
                let lineTotal = item["lineTotal"] as? String ?? ""
                y = drawWrapped(name, x: margin + 12, y: y, width: 305, attributes: bold, charactersPerLine: 43)
                ("Code: \(barcode)" as NSString).draw(in: CGRect(x: margin + 12, y: y, width: 305, height: 13), withAttributes: small)
                ("\(quantity)" as NSString).draw(in: CGRect(x: 396, y: y - 12, width: 45, height: 14), withAttributes: regular.merging([.paragraphStyle: centered]) { $1 })
                (lineTotal as NSString).draw(in: CGRect(x: 440, y: y - 12, width: 100, height: 14), withAttributes: regular.merging([.paragraphStyle: right]) { $1 })
                y += 16
                drawRule(y: y, width: width, margin: margin, color: UIColor.lightGray, thickness: 0.6)
                y += 12
            }

            ("GRAND TOTAL" as NSString).draw(in: CGRect(x: 335, y: y + 10, width: 100, height: 18), withAttributes: bold.merging([.paragraphStyle: right]) { $1 })
            fillRect(CGRect(x: 445, y: y, width: 96, height: 38), color: boutiqueRed)
            (totalText as NSString).draw(in: CGRect(x: 451, y: y + 10, width: 84, height: 18), withAttributes: [.font: UIFont.systemFont(ofSize: 13, weight: .bold), .foregroundColor: UIColor.white, .paragraphStyle: right])
            y += 102
            fillRect(CGRect(x: margin, y: y, width: width - margin * 2, height: 58), color: softTint)
            ("THANK YOU FOR SHOPPING WITH ABHIJATYA." as NSString).draw(in: CGRect(x: margin, y: y + 14, width: width - margin * 2, height: 18), withAttributes: bold.merging([.paragraphStyle: centered]) { $1 })
            ("Please retain this bill for your reference." as NSString).draw(in: CGRect(x: margin, y: y + 33, width: width - margin * 2, height: 14), withAttributes: small.merging([.paragraphStyle: centered]) { $1 })
        }
    }

    private func drawWrapped(_ text: String, x: CGFloat, y: CGFloat, width: CGFloat, attributes: [NSAttributedString.Key: Any], charactersPerLine: Int) -> CGFloat {
        let words = text.split(separator: " ")
        var line = ""
        var currentY = y
        for word in words {
            let candidate = line.isEmpty ? String(word) : "\(line) \(word)"
            if candidate.count > charactersPerLine && !line.isEmpty {
                (line as NSString).draw(in: CGRect(x: x, y: currentY, width: width, height: 10), withAttributes: attributes)
                currentY += 11
                line = String(word)
            } else { line = candidate }
        }
        if !line.isEmpty {
            (line as NSString).draw(in: CGRect(x: x, y: currentY, width: width, height: 10), withAttributes: attributes)
            currentY += 11
        }
        return currentY
    }

    private func drawRule(y: CGFloat, width: CGFloat, margin: CGFloat, color: UIColor, thickness: CGFloat) {
        guard let context = UIGraphicsGetCurrentContext() else { return }
        context.setStrokeColor(color.cgColor)
        context.setLineWidth(thickness)
        context.move(to: CGPoint(x: margin, y: y))
        context.addLine(to: CGPoint(x: width - margin, y: y))
        context.strokePath()
    }

    private func fillRect(_ rect: CGRect, color: UIColor) {
        guard let context = UIGraphicsGetCurrentContext() else { return }
        context.setFillColor(color.cgColor)
        context.fill(rect)
    }

    private func paragraph(_ alignment: NSTextAlignment) -> NSParagraphStyle {
        let style = NSMutableParagraphStyle()
        style.alignment = alignment
        return style
    }

    private func image(from dataUrl: String?) -> UIImage? {
        guard let dataUrl, let comma = dataUrl.firstIndex(of: ",") else { return nil }
        return Data(base64Encoded: String(dataUrl[dataUrl.index(after: comma)...])).flatMap(UIImage.init(data:))
    }

    private func configurePopover(_ share: UIActivityViewController, presenter: UIViewController) {
        guard let popover = share.popoverPresentationController else { return }
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
        bridge?.registerPluginInstance(NativeBillSharePlugin())
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
