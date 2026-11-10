import CoreLocation
import Foundation

// A single explicit check-in request. No continuous or background tracking.
final class OfficeLocation: NSObject, CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    private var pending: CheckedContinuation<CLLocation, Error>?
    private var deadline: Timer?

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
    }

    func capture() async throws -> CLLocation {
        guard pending == nil else { throw OfficeFailure.message("A location check is already running.") }
        return try await withCheckedThrowingContinuation { continuation in
            pending = continuation
            deadline = Timer.scheduledTimer(withTimeInterval: 25, repeats: false) { [weak self] _ in
                self?.finish(.failure(OfficeFailure.message("Location lookup timed out. Enable precise location and try again.")))
            }
            authorize()
        }
    }

    private func authorize() {
        switch manager.authorizationStatus {
        case .notDetermined: manager.requestWhenInUseAuthorization()
        case .authorizedAlways, .authorizedWhenInUse:
            guard manager.accuracyAuthorization == .fullAccuracy else {
                finish(.failure(OfficeFailure.message("Enable Precise Location in Settings → Shikshavertex → Location, then retry."))); return
            }
            manager.startUpdatingLocation()
        default: finish(.failure(OfficeFailure.message("Allow location while using Shikshavertex in iPhone Settings before checking in.")))
        }
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) { if pending != nil { authorize() } }
    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        if let location = locations.last, OfficePolicy.fresh(location) { finish(.success(location)) }
    }
    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        if (error as? CLError)?.code == .locationUnknown { return }
        finish(.failure(OfficeFailure.message("A precise location could not be obtained. Check iPhone location permissions and retry.")))
    }
    func cancel() { finish(.failure(OfficeFailure.message("Check-in was interrupted. Refresh attendance before retrying."))) }
    private func finish(_ result: Result<CLLocation, Error>) {
        guard let continuation = pending else { return }
        pending = nil; deadline?.invalidate(); deadline = nil
        manager.stopUpdatingLocation()
        continuation.resume(with: result)
    }
}
