const test = require('node:test');
const assert = require('node:assert/strict');
const { checkAttendanceWifi, ATTENDANCE_SSID, normalizeIp } = require('../wifi-attendance');
const { loadConfig } = require('../config');
const NOW = Date.parse('2026-11-05T06:00:00Z');
const observation = overrides => ({ transport: 'wifi', ssid: ATTENDANCE_SSID, observedAt: NOW, ...overrides });

test('the supplied SSID is required in onsite mode and configuration contains no Wi-Fi password', () => {
    const config = loadConfig({ ENFORCE_ONSITE_ATTENDANCE: 'true' });
    assert.equal(config.wifi.required, true);
    assert.equal(config.wifi.ssid, 'Shikshavertex_5G');
    assert.deepEqual(config.venue.attendanceWifi, { required: true, ssid: 'Shikshavertex_5G' });
    assert.equal('password' in config.wifi, false);
    const result = checkAttendanceWifi(observation(), config.wifi, NOW, '127.0.0.1');
    assert.equal(result.verification, 'native-client-observation');
    assert.equal(result.ssid, ATTENDANCE_SSID);
});

test('missing Wi-Fi, cellular, wrong/case-changed/space-suffixed names and stale observations are rejected', () => {
    for (const value of [undefined, {}, observation({ transport: 'cellular' }), observation({ ssid: 'Guest' }), observation({ ssid: 'shikshavertex_5g' }), observation({ ssid: 'Shikshavertex_5G ' }), observation({ observedAt: NOW - 10001 }), observation({ observedAt: NOW + 5001 }), observation({ observedAt: String(NOW) }), observation({ observedAt: NaN })]) {
        assert.throws(() => checkAttendanceWifi(value, {}, NOW, '127.0.0.1'), error => error.status === 403);
    }
});

test('optional AP identifiers reject other or redacted BSSIDs', () => {
    const settings = { allowedBssids: ['aa:bb:cc:dd:ee:ff'] };
    for (const bssid of [undefined, '02:00:00:00:00:00', '00:00:00:00:00:00', '11:22:33:44:55:66']) assert.throws(() => checkAttendanceWifi(observation({ bssid }), settings, NOW), error => error.status === 403);
    assert.equal(checkAttendanceWifi(observation({ bssid: 'AA:BB:CC:DD:EE:FF' }), settings, NOW).bssid, 'aa:bb:cc:dd:ee:ff');
});

test('optional trusted request-IP gate uses normalized observed request address', () => {
    const settings = { allowedIps: ['203.0.113.42'] };
    assert.throws(() => checkAttendanceWifi(observation(), settings, NOW, '203.0.113.43'), error => error.status === 403);
    assert.throws(() => checkAttendanceWifi(observation(), settings, NOW, undefined), error => error.status === 403);
    assert.equal(checkAttendanceWifi(observation(), settings, NOW, '::ffff:203.0.113.42').verification, 'native-observation-and-request-ip');
    assert.equal(normalizeIp('2001:0db8:0:0:0:0:0:1'), '2001:db8::1');
    assert.equal(normalizeIp('invalid'), null);
});

test('router restriction configuration rejects malformed public identifiers', () => {
    assert.throws(() => loadConfig({ WIFI_ATTENDANCE_BSSIDS: 'not-a-mac' }));
    assert.throws(() => loadConfig({ WIFI_ATTENDANCE_BSSIDS: '02:00:00:00:00:00' }));
    assert.throws(() => loadConfig({ WIFI_ATTENDANCE_ALLOWED_IPS: '*' }));
    assert.deepEqual(loadConfig({ WIFI_ATTENDANCE_BSSIDS: 'AA:BB:CC:DD:EE:FF', WIFI_ATTENDANCE_ALLOWED_IPS: '203.0.113.42' }).wifi.allowedBssids, ['aa:bb:cc:dd:ee:ff']);
});
