import Foundation
import CoreLocation

enum OfficePolicy {
    static let origin = URL(string: "https://placement-tracker-lyjf.onrender.com")!
    static let ssid = "Shikshavertex_5G"

    static func trusted(_ url: URL?) -> Bool {
        guard let url = url else { return false }
        return url.scheme == "https" && url.host == origin.host && (url.port == nil || url.port == 443)
    }

    static func validEvent(_ value: String) -> Bool {
        value.range(of: "^[A-Za-z0-9_-]{1,128}$", options: .regularExpression) != nil
    }

    static func fresh(_ location: CLLocation, now: Date = Date()) -> Bool {
        let age = now.timeIntervalSince(location.timestamp)
        return location.horizontalAccuracy > 0 && location.horizontalAccuracy <= 50 && age >= -5 && age <= 15 &&
            CLLocationCoordinate2DIsValid(location.coordinate) && location.sourceInformation?.isSimulatedBySoftware != true
    }
}

enum OfficeFailure: LocalizedError {
    case message(String)
    var errorDescription: String? { if case let .message(text) = self { return text }; return nil }
}
