const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig } = require('../config');

test('passkey attendance is required and production must configure a trusted RP', () => {
    const local = loadConfig({});
    assert.equal(local.biometrics.required, true);
    assert.equal(local.biometrics.rpID, 'localhost');
    const production = loadConfig({ NODE_ENV: 'production', DEVICE_COOKIE_SECRET: 'a'.repeat(64) });
    assert.equal(production.biometrics.required, true);
    assert.equal(production.biometrics.configured, false);
});

test('only exact HTTPS web origins matching RP host are accepted in production', () => {
    const base = { NODE_ENV: 'production', DEVICE_COOKIE_SECRET: 'a'.repeat(64), WEBAUTHN_RP_ID: 'attendance.example.org' };
    for (const origin of ['http://attendance.example.org', 'https://evil.example.org', 'https://attendance.example.org/path', 'https://attendance.example.org.evil.test']) {
        assert.throws(() => loadConfig({ ...base, WEBAUTHN_EXPECTED_ORIGINS: origin }));
    }
    const ready = loadConfig({ ...base, WEBAUTHN_EXPECTED_ORIGINS: 'https://attendance.example.org' });
    assert.equal(ready.biometrics.configured, true);
    assert.deepEqual(ready.biometrics.expectedOrigins, ['https://attendance.example.org']);
});

test('Android public certificate fingerprint supplies exact passkey origin and app association', () => {
    const fingerprint = 'ab'.repeat(32);
    const config = loadConfig({ WEBAUTHN_RP_ID: 'attendance.example.org', WEBAUTHN_EXPECTED_ORIGINS: 'https://attendance.example.org', ANDROID_SHA256_CERT_FINGERPRINTS: fingerprint });
    assert.ok(config.biometrics.expectedOrigins.includes(`android:apk-key-hash:${Buffer.from(fingerprint, 'hex').toString('base64url')}`));
    assert.equal(config.android.appId, 'in.shikshavertex.attendance');
    assert.equal(config.android.fingerprints[0], Array(32).fill('AB').join(':'));
    assert.throws(() => loadConfig({ ANDROID_SHA256_CERT_FINGERPRINTS: 'wrong' }));
    assert.throws(() => loadConfig({ ANDROID_APP_ID: '../untrusted' }));
});
