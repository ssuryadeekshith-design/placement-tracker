const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig } = require('../config');
const { checkLocation, checkEvent, distanceMeters, readDevice, hmac, indiaDate } = require('../security');

const NOW = Date.parse('2026-11-04T06:00:00Z');
const VENUE = { configured: true, latitude: 12.9, longitude: 77.6, radiusMeters: 100, maxAccuracyMeters: 50 };
const location = overrides => ({ latitude: 12.9, longitude: 77.6, accuracyMeters: 5, capturedAt: NOW, ...overrides });

test('owner-confirmed venue defaults are used, missing override fails closed, and production needs a strong secret', () => {
  const config = loadConfig({});
  assert.equal(config.venue.configured, true);
  assert.equal(config.venue.latitude, 12.912773610440954);
  assert.equal(config.venue.longitude, 77.62322878099566);
  assert.equal(config.venue.requiresRoomCode, true);
  assert.throws(() => checkLocation(location(), { ...config.venue, configured: false }, NOW), error => error.status === 503);
  assert.throws(() => loadConfig({ NODE_ENV: 'production' }), /DEVICE_COOKIE_SECRET/);
  assert.throws(() => loadConfig({ NODE_ENV: 'production', DEVICE_COOKIE_SECRET: 'short' }), /DEVICE_COOKIE_SECRET/);
  const ready = loadConfig({ NODE_ENV: 'production', DEVICE_COOKIE_SECRET: 'a'.repeat(64), VENUE_LATITUDE: '12.9', VENUE_LONGITUDE: '77.6' });
  assert.equal(ready.venue.configured, true);
  assert.equal(ready.production, true);
});

test('invalid venue coordinates fail at startup, and either missing coordinate remains unconfigured', () => {
  for (const values of [{ VENUE_LATITUDE: 'NaN' }, { VENUE_LATITUDE: '91' }, { VENUE_LONGITUDE: '-181' }]) {
    assert.throws(() => loadConfig(values), /Invalid VENUE_/);
  }
  assert.equal(loadConfig({ VENUE_LATITUDE: '12.9' }).venue.configured, false);
  assert.equal(loadConfig({ VENUE_LONGITUDE: '77.6' }).venue.configured, false);
});

test('geofence includes reported uncertainty rather than accepting any approximate position inside the circle', () => {
  const nearBoundary = location({ latitude: 12.90072, accuracyMeters: 30 });
  const distance = distanceMeters(nearBoundary.latitude, nearBoundary.longitude, VENUE.latitude, VENUE.longitude);
  assert.ok(distance < 100 && distance > 70);
  assert.throws(() => checkLocation(nearBoundary, VENUE, NOW), error => error.status === 403);
  assert.equal(checkLocation(location(), VENUE, NOW).distanceMeters, 0);
});

test('location validation rejects zero accuracy, invalid coordinates, old or future capture times', () => {
  for (const input of [
    undefined, location({ latitude: NaN }), location({ latitude: 91 }), location({ longitude: -181 }),
    location({ accuracyMeters: 0 }), location({ accuracyMeters: -1 }), location({ accuracyMeters: 51 }),
    location({ capturedAt: NOW - 60001 }), location({ capturedAt: NOW + 5001 }), location({ capturedAt: String(NOW) }),
  ]) {
    assert.throws(() => checkLocation(input, VENUE, NOW), error => error.status === 400);
  }
});

test('attendance day uses India time around UTC midnight', () => {
  const lateUtc = Date.parse('2026-11-03T20:00:00Z');
  assert.equal(indiaDate(lateUtc), '2026-11-04');
  assert.doesNotThrow(() => checkEvent({ checkInOpen: true, date: '2026-11-04' }, lateUtc));
  assert.throws(() => checkEvent({ checkInOpen: true, date: '2026-11-03' }, lateUtc), error => error.status === 403);
  assert.throws(() => checkEvent({ checkInOpen: false, date: '2026-11-04' }, lateUtc), error => error.status === 403);
});

test('device cookie parser accepts only a complete valid signed token and rejects malformed signatures safely', () => {
  const token = 'a'.repeat(64);
  const secret = 'b'.repeat(64);
  const valid = `${token}.${hmac(token, secret)}`;
  assert.equal(readDevice({ headers: {} }, secret), null);
  assert.equal(readDevice({ headers: { cookie: `unrelated=x; placement_device=${valid}; another=y` } }, secret), token);
  for (const invalid of [`${valid}.extra`, `${token}.${'é'.repeat(64)}`, `${token}.${'a'.repeat(64)}`, 'malformed']) {
    assert.throws(() => readDevice({ headers: { cookie: `placement_device=${invalid}` } }, secret), error => error.status === 403);
  }
});
