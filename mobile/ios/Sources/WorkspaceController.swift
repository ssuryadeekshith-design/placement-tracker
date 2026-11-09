import UIKit
import WebKit
import NetworkExtension

private final class AttendanceHandler: NSObject, WKScriptMessageHandlerWithReply {
    weak var owner: WorkspaceController?
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        guard let owner = owner else { replyHandler(nil, "The app is closing."); return }
        owner.receive(message, reply: replyHandler)
    }
}

final class WorkspaceController: UIViewController, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate, URLSessionTaskDelegate {
    private var web: WKWebView!
    private let location = OfficeLocation()
    private var checking = false
    private let status = UILabel()
    private let retry = UIButton(type: .system)
    private var exports: [ObjectIdentifier: URL] = [:]

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        let handler = AttendanceHandler(); handler.owner = self
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.limitsNavigationsToAppBoundDomains = true
        configuration.userContentController.addScriptMessageHandler(handler, contentWorld: .page, name: "attendance")
        web = WKWebView(frame: .zero, configuration: configuration)
        web.navigationDelegate = self; web.uiDelegate = self
        web.translatesAutoresizingMaskIntoConstraints = false
        web.allowsBackForwardNavigationGestures = true
        status.text = "Connecting to the server. Please wait a moment..."
        status.numberOfLines = 0; status.textAlignment = .center
        status.font = .preferredFont(forTextStyle: .body)
        status.textColor = .secondaryLabel; status.translatesAutoresizingMaskIntoConstraints = false
        retry.setTitle("Try again", for: .normal); retry.isHidden = true
        retry.translatesAutoresizingMaskIntoConstraints = false
        retry.addTarget(self, action: #selector(loadWorkspace), for: .touchUpInside)
        view.addSubview(web); view.addSubview(status); view.addSubview(retry)
        NSLayoutConstraint.activate([
            web.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor), web.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            web.leadingAnchor.constraint(equalTo: view.leadingAnchor), web.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            status.centerYAnchor.constraint(equalTo: view.centerYAnchor), status.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 30),
            status.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -30),
            retry.topAnchor.constraint(equalTo: status.bottomAnchor, constant: 20), retry.centerXAnchor.constraint(equalTo: view.centerXAnchor)
        ])
        NotificationCenter.default.addObserver(self, selector: #selector(backgrounded), name: UIApplication.didEnterBackgroundNotification, object: nil)
        loadWorkspace()
    }

    @objc private func loadWorkspace() {
        status.text = "Connecting to the server. Please wait a moment..."
        status.isHidden = false; retry.isHidden = true; web.isHidden = true
        var request = URLRequest(url: OfficePolicy.origin); request.timeoutInterval = 120
        web.load(request)
    }
    @objc private func backgrounded() { location.cancel() }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard OfficePolicy.trusted(webView.url) else { return }
        web.isHidden = false; status.isHidden = true; retry.isHidden = true
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { failed(error) }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { failed(error) }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { failed(OfficeFailure.message("The workspace needs to reload.")) }
    private func failed(_ error: Error) {
        if (error as NSError).code == NSURLErrorCancelled { return }
        status.text = "The workspace could not connect. Check your internet connection, then try again."
        status.isHidden = false; retry.isHidden = false; web.isHidden = true
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        let url = navigationAction.request.url
        if navigationAction.shouldPerformDownload, OfficePolicy.trusted(navigationAction.sourceFrame.request.url),
           OfficePolicy.trusted(url) || url?.absoluteString.hasPrefix("blob:\(OfficePolicy.origin.absoluteString)/") == true {
            decisionHandler(.download); return
        }
        if OfficePolicy.trusted(url) { decisionHandler(.allow); return }
        if navigationAction.targetFrame?.isMainFrame == false, url?.scheme == "https",
           url?.host == "placementtracker-a1a87.firebaseapp.com" { decisionHandler(.allow); return }
        if navigationAction.navigationType == .linkActivated, let url = url, ["https", "mailto"].contains(url.scheme ?? "") { UIApplication.shared.open(url) }
        decisionHandler(.cancel)
    }
    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { download.delegate = self }
    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { download.delegate = self }
    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String,
                  completionHandler: @escaping (URL?) -> Void) {
        guard suggestedFilename.lowercased().hasSuffix(".csv") else { completionHandler(nil); return }
        do {
            let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let file = directory.appendingPathComponent((suggestedFilename as NSString).lastPathComponent)
            exports[ObjectIdentifier(download)] = file; completionHandler(file)
        } catch { completionHandler(nil) }
    }
    func downloadDidFinish(_ download: WKDownload) {
        guard let file = exports.removeValue(forKey: ObjectIdentifier(download)) else { return }
        let share = UIActivityViewController(activityItems: [file], applicationActivities: nil)
        share.popoverPresentationController?.sourceView = view
        share.popoverPresentationController?.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 1, height: 1)
        share.completionWithItemsHandler = { _, _, _, _ in try? FileManager.default.removeItem(at: file.deletingLastPathComponent()) }
        present(share, animated: true)
    }
    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        if let file = exports.removeValue(forKey: ObjectIdentifier(download)) { try? FileManager.default.removeItem(at: file.deletingLastPathComponent()) }
        let alert = UIAlertController(title: "Export unavailable", message: "The CSV could not be downloaded. Refresh the report and try again.", preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default)); present(alert, animated: true)
    }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url, url.scheme == "https" { UIApplication.shared.open(url) }
        return nil
    }

    func receive(_ message: WKScriptMessage, reply: @escaping (Any?, String?) -> Void) {
        guard message.frameInfo.isMainFrame, OfficePolicy.trusted(message.frameInfo.request.url), OfficePolicy.trusted(web.url),
              let body = message.body as? [String: Any], body["action"] as? String == "markAttendance",
              let eventId = body["eventId"] as? String, OfficePolicy.validEvent(eventId),
              let token = body["idToken"] as? String, token.count >= 20, token.count < 16000,
              !token.contains("\n"), !token.contains("\r"),
              let proof = body["biometricProof"] as? String, !proof.isEmpty, proof.count < 16000 else {
            reply(nil, "This attendance request was not accepted."); return
        }
        guard !checking, UIApplication.shared.applicationState == .active else { reply(nil, "Open the app and wait for the current check-in to finish."); return }
        checking = true
        Task { @MainActor in
            defer { checking = false }
            do {
                let fix = try await location.capture()
                let network = await NEHotspotNetwork.fetchCurrent()
                guard let network = network, network.ssid == OfficePolicy.ssid else {
                    throw OfficeFailure.message("You are not connected to the office. Connect to Shikshavertex_5G and enable precise location, then retry. Attendance was not marked.")
                }
                guard UIApplication.shared.applicationState == .active, OfficePolicy.trusted(web.url), OfficePolicy.fresh(fix) else {
                    throw OfficeFailure.message("The office check expired. Keep the app open and try again.")
                }
                let cookies = await web.configuration.websiteDataStore.httpCookieStore.allCookies()
                guard let device = cookies.first(where: { $0.name == "placement_device" && $0.domain.trimmingCharacters(in: CharacterSet(charactersIn: ".")) == OfficePolicy.origin.host && $0.isSecure }) else {
                    throw OfficeFailure.message("Your account session needs to refresh. Sign in again before checking in.")
                }
                var request = URLRequest(url: OfficePolicy.origin.appendingPathComponent("api/attendance"))
                request.httpMethod = "POST"; request.timeoutInterval = 30
                request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
                request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                request.setValue("\(device.name)=\(device.value)", forHTTPHeaderField: "Cookie")
                request.httpBody = try JSONSerialization.data(withJSONObject: [
                    "eventId": eventId, "biometricProof": proof,
                    "location": ["latitude": fix.coordinate.latitude, "longitude": fix.coordinate.longitude,
                                 "accuracyMeters": fix.horizontalAccuracy, "capturedAt": fix.timestamp.timeIntervalSince1970 * 1000],
                    "wifi": ["transport": "wifi", "ssid": network.ssid, "bssid": network.bssid,
                             "observedAt": Date().timeIntervalSince1970 * 1000]
                ])
                let configuration = URLSessionConfiguration.ephemeral
                configuration.allowsCellularAccess = false; configuration.waitsForConnectivity = false
                configuration.httpCookieStorage = nil; configuration.httpShouldSetCookies = false
                let session = URLSession(configuration: configuration, delegate: self, delegateQueue: .main)
                defer { session.finishTasksAndInvalidate() }
                // A write is never retried automatically; an uncertain receipt
                // must be refreshed before the employee makes another attempt.
                let (data, response) = try await session.data(for: request)
                guard let http = response as? HTTPURLResponse, OfficePolicy.trusted(http.url),
                      let result = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                    throw OfficeFailure.message("The attendance result could not be confirmed. Refresh attendance before retrying.")
                }
                reply(["status": http.statusCode, "data": result], nil)
            } catch { reply(nil, error.localizedDescription) }
        }
    }

    // Never forward a token/cookie or replay a check-in through redirects.
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}

private extension WKHTTPCookieStore {
    func allCookies() async -> [HTTPCookie] { await withCheckedContinuation { continuation in getAllCookies { continuation.resume(returning: $0) } } }
}
