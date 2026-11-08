const test = require('node:test');
const assert = require('node:assert/strict');
const { attendanceReport } = require('../attendance-viewers');
const { createFakeFirestore } = require('./fake-firestore');

const DATE = '2026-11-08';
const NOW = Date.parse(`${DATE}T06:00:00Z`);

async function reportFor(logs) {
    const initial = { 'Events/daily': { title: 'Daily attendance', date: DATE, checkInOpen: true } };
    for (const [uid, evidence] of Object.entries(logs)) {
        const email = `${uid}@shikshavertex.in`;
        initial[`Users/${uid}`] = { email, fullName: uid };
        initial[`AllowedEmails/${email}`] = { enabled: true, uid };
        initial[`AttendanceLogs/${uid}`] = { uid, email, eventId: 'daily', timestamp: new Date(NOW).toISOString(), method: 'self', ...evidence };
    }
    return attendanceReport({ db: createFakeFirestore(initial), date: DATE, now: () => NOW });
}

test('viewer badge evidence reflects independently stored phone, Wi-Fi and location observations', async () => {
    const report = await reportFor({
        verified: {
            verification: { method: 'passkey-user-verification', credentialId: 'private-credential-identifier', verifiedAt: new Date(NOW).toISOString() },
            wifi: { verification: 'native-client-observation', ssid: 'Shikshavertex_5G', bssid: 'aa:bb:cc:dd:ee:ff', observedIp: 'private-router-address' },
            locationVerified: true, location: { latitude: 12.9127736, longitude: 77.6232288 },
        },
        phoneOnly: { verification: { method: 'passkey-user-verification' }, attendanceMode: 'setup', locationVerified: false },
        wifiOnly: { wifi: { verification: 'native-client-observation', ssid: 'Shikshavertex_5G' } },
        locationOnly: { locationVerified: true },
    });
    const checkIn = name => report.rows.find(row => row.name === name).checkIns[0];
    assert.equal(checkIn('verified').phoneVerified, true);
    assert.equal(checkIn('verified').venueWifiObserved, true);
    assert.equal(checkIn('verified').locationChecked, true);
    assert.deepEqual([checkIn('phoneOnly').phoneVerified, checkIn('phoneOnly').venueWifiObserved, checkIn('phoneOnly').locationChecked], [true, false, false]);
    assert.deepEqual([checkIn('wifiOnly').phoneVerified, checkIn('wifiOnly').venueWifiObserved, checkIn('wifiOnly').locationChecked], [false, true, false]);
    assert.deepEqual([checkIn('locationOnly').phoneVerified, checkIn('locationOnly').venueWifiObserved, checkIn('locationOnly').locationChecked], [false, false, true]);
    const serialized = JSON.stringify(report);
    for (const privateField of ['credentialId', 'private-credential-identifier', 'bssid', 'aa:bb:cc:dd:ee:ff', 'observedIp', 'private-router-address', 'latitude', 'longitude', 'Shikshavertex_5G']) assert.equal(serialized.includes(privateField), false, privateField);
});

test('missing, client-like flags, wrong verification methods and legacy overrides never become verified badges', async () => {
    const report = await reportFor({
        legacy: {},
        override: { method: 'committee', locationVerified: false },
        topLevelFlags: { phoneVerified: true, biometric: true, venueWifiObserved: true, locationVerified: 'true' },
        wrongPhone: { verification: { method: 'biometric', verified: true } },
        wrongNetwork: { wifi: { verification: 'native-client-observation', ssid: 'Guest' } },
        networkNameOnly: { wifi: { ssid: 'Shikshavertex_5G', verified: true } },
        wrongObservation: { wifi: { verification: 'client-asserted', ssid: 'Shikshavertex_5G' } },
    });
    for (const row of report.rows) {
        const check = row.checkIns[0];
        assert.equal(check.phoneVerified, false, row.name);
        assert.equal(check.venueWifiObserved, false, row.name);
        assert.equal(check.locationChecked, false, row.name);
    }
    assert.equal(report.rows.find(row => row.name === 'legacy').checkIns[0].attendanceMode, 'legacy');
    assert.equal(report.rows.find(row => row.name === 'override').checkIns[0].method, 'committee');
});
