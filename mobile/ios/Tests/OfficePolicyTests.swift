import XCTest
import CoreLocation
@testable import Shikshavertex

final class OfficePolicyTests: XCTestCase {
    func testOriginIsExactAndHTTPS() {
        XCTAssertTrue(OfficePolicy.trusted(URL(string: "https://placement-tracker-lyjf.onrender.com/api/attendance")))
        for value in ["http://placement-tracker-lyjf.onrender.com", "https://placement-tracker-lyjf.onrender.com.evil.test", "https://evil.test", "https://placement-tracker-lyjf.onrender.com:444"] {
            XCTAssertFalse(OfficePolicy.trusted(URL(string: value)))
        }
    }
    func testAttendanceCannotUseAnOldOrImpreciseFix() {
        let now = Date()
        func fix(_ age: TimeInterval, _ accuracy: Double) -> CLLocation {
            CLLocation(coordinate: CLLocationCoordinate2D(latitude: 12.912773610440954, longitude: 77.62322878099566), altitude: 0, horizontalAccuracy: accuracy, verticalAccuracy: 5, timestamp: now.addingTimeInterval(-age))
        }
        XCTAssertTrue(OfficePolicy.fresh(fix(1, 5), now: now))
        XCTAssertFalse(OfficePolicy.fresh(fix(20, 5), now: now))
        XCTAssertFalse(OfficePolicy.fresh(fix(0, 100), now: now))
        XCTAssertFalse(OfficePolicy.fresh(fix(0, -1), now: now))
        XCTAssertFalse(OfficePolicy.fresh(fix(-10, 5), now: now))
    }
    func testEventIdCannotChangeTheNativeEndpoint() {
        XCTAssertTrue(OfficePolicy.validEvent("daily-2026-11-09"))
        XCTAssertFalse(OfficePolicy.validEvent("../session"))
        XCTAssertFalse(OfficePolicy.validEvent(""))
    }
}
