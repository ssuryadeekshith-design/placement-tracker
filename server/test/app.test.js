const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createFakeFirestore } = require('./fake-firestore');
const { createApp } = require('../app');
const { loadConfig } = require('../config');
const { digest, readDevice } = require('../security');

const START = Date.parse('2026-11-04T06:00:00Z');
const ALICE = 'supriti_m@shikshavertex.in';
const BOB = 'cbhavitha@shikshavertex.in';
const COMMITTEE = 'committee@example.org';
const employeeRoster = require('../employees.json');

async function fixture(t, extra = {}, venueOverrides = {}, access = { required: false }) {
  let clock = START;
  const db = createFakeFirestore({
    [`AllowedEmails/${ALICE}`]: { enabled: true, email: ALICE },
    [`AllowedEmails/${BOB}`]: { enabled: true, email: BOB },
    [`AllowedEmails/${COMMITTEE}`]: { enabled: true, email: COMMITTEE },
    'Events/current': { title: 'Placement preparation', date: '2026-11-04', isMandatory: true, checkInOpen: true },
    'Events/closed': { title: 'Closed event', date: '2026-11-04', isMandatory: false, checkInOpen: false },
    'Events/old': { title: 'Past event', date: '2026-11-03', isMandatory: true, checkInOpen: true },
    ...extra,
  });
  const tokens = {
    alice: { uid: 'alice', email: ALICE, email_verified: true, name: 'Supriti' },
    hr: { uid: 'hr', email: 'hr@shikshavertex.in', email_verified: true },
    hire: { uid: 'hire', email: 'new.employee@shikshavertex.in', email_verified: true },
    hire2: { uid: 'hire2', email: 'second.employee@shikshavertex.in', email_verified: true },
    bob: { uid: 'bob', email: BOB, email_verified: true },
    surya: { uid: 'surya', email: 'surya_deekshith@shikshavertex.in', email_verified: true },
    pallavi: { uid: 'pallavi', email: 'hr_pallavi@shikshavertex.in', email_verified: true },
    recreatedPallavi: { uid: 'replacement', email: 'hr_pallavi@shikshavertex.in', email_verified: true },
    unverifiedPallavi: { uid: 'pallavi', email: 'hr_pallavi@shikshavertex.in', email_verified: false },
    committee: { uid: 'committee', email: COMMITTEE, email_verified: true, committee: true },
    unverified: { uid: 'alice', email: ALICE, email_verified: false },
    unlisted: { uid: 'unlisted', email: 'unknown@example.org', email_verified: true },
  };
  const auth = { verifyIdToken: async (token, checkRevoked) => {
    assert.equal(checkRevoked, true, 'revoked authentication tokens must be checked');
    if (!tokens[token]) throw new Error('Invalid authentication token');
    return structuredClone(tokens[token]);
  }, getUser: async uid => ({ uid, email: tokens[uid]?.email, emailVerified: true, customClaims: {} }), setCustomUserClaims: async (uid, claims) => { Object.assign(tokens[uid], claims); } };
  const config = {
    cookieSecret: 'a'.repeat(64), production: false, allowedOrigins: [],
    // Legacy route tests isolate geofence/device behavior; biometrics have dedicated tests.
    biometrics: { required: false, configured: false },
    access,
    // Wi-Fi enforcement is exercised below; existing tests isolate other gates.
    wifi: { required: false },
    venue: { address: '2nd floor, Srivari Arcade, Bengaluru', mapsUrl: 'https://maps.app.goo.gl/1t5uN5hefMxJEWKdA', configured: true, latitude: 12.9, longitude: 77.6, radiusMeters: 100, maxAccuracyMeters: 50, requiresRoomCode: true, ...venueOverrides },
  };
  const server = createApp({ db, auth, config, now: () => clock }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const url = `http://127.0.0.1:${server.address().port}/api`;
  async function request(path, { token = 'alice', cookie, venueToken, forwardedFor, body, raw, method = body === undefined && raw === undefined ? 'GET' : 'POST' } = {}) {
    const response = await fetch(`${url}${path}`, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(venueToken ? { 'X-Venue-Access': venueToken } : {}), ...(forwardedFor ? { 'X-Forwarded-For': forwardedFor } : {}), ...(body !== undefined || raw !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      ...(raw !== undefined ? { body: raw } : body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: response.status, data, cookie: response.headers.get('set-cookie')?.split(';')[0], cookieHeader: response.headers.get('set-cookie') };
  }
  async function session(token = 'alice', cookie) {
    const result = await request('/session', { token, cookie, body: {} });
    assert.equal(result.status, 200, JSON.stringify(result.data));
    return result;
  }
  async function code() {
    const admin = await session('committee');
    const result = await request('/events/current/room-code', { token: 'committee', cookie: admin.cookie, body: {} });
    assert.equal(result.status, 200, JSON.stringify(result.data));
    assert.match(result.data.code, /^\d{6}$/);
    return result.data.code;
  }
  const location = overrides => ({ latitude: 12.9, longitude: 77.6, accuracyMeters: 5, capturedAt: clock, ...overrides });
  return { db, url, request, session, code, location, config, advance: ms => { clock += ms; } };
}

test('only HR can privately import official emails, without creating login permission', async t => {
  const f = await fixture(t, { 'Employees/SV001': { ...employeeRoster[0], active: true } });
  const payload = { employees: [{ employeeId: 'SV001', fullName: employeeRoster[0].fullName, email: 'test.joe@shikshavertex.in' }] };
  const employee = await f.session();
  assert.equal((await f.request('/employees/registration-emails', { cookie: employee.cookie, body: payload })).status, 403);
  const hr = await f.session('committee');
  const result = await f.request('/employees/registration-emails', { token: 'committee', cookie: hr.cookie, body: payload });
  assert.equal(result.status, 200); assert.equal(result.data.imported, 1);
  assert.equal(f.db.dump()['Employees/SV001'].registrationEmail, 'test.joe@shikshavertex.in');
  assert.equal(f.db.dump()['AllowedEmails/test.joe@shikshavertex.in'], undefined);
});

test('HR approval cannot link an account to a different official registration email', async t => {
  const f = await fixture(t, { 'Employees/SV001': { ...employeeRoster[0], active: true, registrationEmail: 'official@shikshavertex.in' } });
  await f.request('/registration/request', { token: 'hire', body: { fullName: employeeRoster[0].fullName } });
  const hr = await f.session('committee');
  const result = await f.request('/registration-requests/hire/approve', { token: 'committee', cookie: hr.cookie, body: { employeeId: 'SV001' } });
  assert.equal(result.status, 409); assert.equal(f.db.dump()['RegistrationRequests/hire'].status, 'pending');
  assert.equal(f.db.dump()['AllowedEmails/new.employee@shikshavertex.in'], undefined);
});

test('Apple passkey association advertises only configured app IDs', async t => {
  const f = await fixture(t);
  // The public association is deliberately unauthenticated, with no dynamic Host reflection.
  const association = new URL('/.well-known/apple-app-site-association', f.url);
  assert.deepEqual(await (await fetch(association)).json(), { webcredentials: { apps: [] } });
  f.config.ios = { appIds: ['ABCDE12345.in.shikshavertex.attendance'] };
  assert.deepEqual(await (await fetch(association)).json(), { webcredentials: { apps: f.config.ios.appIds } });
  assert.deepEqual(loadConfig({}).ios.appIds, []);
  assert.deepEqual(loadConfig({ IOS_APP_IDS: 'ABCDE12345.in.shikshavertex.attendance' }).ios.appIds, ['ABCDE12345.in.shikshavertex.attendance']);
  assert.throws(() => loadConfig({ IOS_APP_IDS: 'placeholder' }), /Invalid IOS_APP_IDS/);
});

test('production policy opens account screens anywhere but requires location, office connection and phone proof for attendance', async t => {
  const settings = loadConfig({ ENFORCE_ONSITE_ATTENDANCE: 'false', REQUIRE_ROOM_CODE: 'true' });
  const f = await fixture(t, {}, settings.venue, settings.access);
  f.config.wifi = settings.wifi;
  f.config.biometrics = settings.biometrics;
  const { cookie } = await f.session();
  // These authenticated screens must work without coordinates or an access lease.
  for (const route of ['/events', '/attendance-summary', '/me', '/biometrics']) {
    assert.equal((await f.request(route, { cookie })).status, 200, route);
  }
  const admin = await f.session('committee');
  assert.equal((await f.request('/students', { token: 'committee', cookie: admin.cookie })).status, 200);
  assert.equal((await f.request('/events/current/room-code', { token: 'committee', cookie: admin.cookie, body: {} })).status, 410);
  const point = f.location({ latitude: settings.venue.latitude, longitude: settings.venue.longitude });
  const wifi = { transport: 'wifi', ssid: 'Shikshavertex_5G', observedAt: START };
  const body = { eventId: 'current', location: point, wifi, attendanceMode: 'setup', locationRequired: false };
  const deviceId = digest(readDevice({ headers: { cookie } }, f.config.cookieSecret));
  const proof = 'b'.repeat(64), credentialId = 'phone-passkey';
  await f.db.collection('BiometricCredentials').doc(digest(credentialId)).set({ active: true, uid: 'alice', deviceId });
  await f.db.collection('BiometricProofs').doc(digest(proof)).set({ uid: 'alice', deviceId, eventId: 'current', credentialId, expiresAt: START + 60000, used: false, verifiedAt: new Date(START).toISOString() });
  for (const token of [null, 'unverified', 'hire', 'unlisted']) {
    assert.ok([401, 403].includes((await f.request('/attendance', { token, cookie, body })).status));
  }
  for (const extra of [
    { wifi: undefined }, { wifi: { ...wifi, transport: 'cellular' } }, { wifi: { ...wifi, ssid: 'Guest' } },
    { wifi: { ...wifi, observedAt: START - 10001 } }, { location: undefined },
    { location: { ...point, latitude: 13.1 } }, { location: { ...point, accuracyMeters: 100 } },
    { location: { ...point, capturedAt: START - 60001 } },
  ]) {
    const result = await f.request('/attendance', { cookie, body: { ...body, biometricProof: proof, ...extra } });
    assert.ok([400, 403].includes(result.status), JSON.stringify(result));
    assert.equal(f.db.dump()[`BiometricProofs/${digest(proof)}`].used, false);
  }
  assert.equal((await f.request('/attendance', { cookie, body })).status, 403, 'phone proof remains required');
  assert.equal(Object.keys(f.db.dump()).filter(key => key.startsWith('AttendanceLogs/')).length, 0);
  const result = await f.request('/attendance', { cookie, body: { ...body, biometricProof: proof } });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.equal(result.data.attendance.attendanceMode, 'onsite');
  assert.equal(result.data.attendance.locationVerified, true);
  assert.equal(result.data.attendance.location.latitude, settings.venue.latitude);
  assert.equal(result.data.attendance.wifi.ssid, 'Shikshavertex_5G');
  assert.equal(result.data.attendance.verification.method, 'passkey-user-verification');
  f.advance(1000);
  const duplicate = await f.request('/attendance', { cookie, body });
  assert.equal(duplicate.data.alreadyMarked, true);
  assert.equal(duplicate.data.attendance.timestamp, result.data.attendance.timestamp);
});

test('anonymous, invalid, unverified and unlisted identities cannot establish a device session', async t => {
  const f = await fixture(t);
  for (const token of [null, 'invalid', 'unverified', 'unlisted']) {
    const result = await f.request('/session', { token, body: {} });
    assert.ok([401, 403].includes(result.status), `${token}: ${JSON.stringify(result)}`);
    assert.equal(result.cookie, undefined);
  }
  assert.equal(Object.keys(f.db.dump()).filter(key => key.startsWith('Users/')).length, 0);
});

test('verified first login persists a server-side browser binding and rejects another email', async t => {
  const f = await fixture(t);
  const first = await f.session();
  assert.match(first.cookieHeader, /HttpOnly/i);
  assert.match(first.cookieHeader, /SameSite=/i);
  assert.equal(first.data.user.email, ALICE);
  const conflict = await f.request('/session', { token: 'bob', cookie: first.cookie, body: {} });
  assert.equal(conflict.status, 403);
  const same = await f.request('/me', { cookie: first.cookie });
  assert.equal(same.status, 200);
  assert.equal(same.data.user.email, ALICE);
  assert.equal(Object.keys(f.db.dump()).filter(key => key.startsWith('Devices/')).length, 1);
});

test('a token alone or forged device cookie cannot read authenticated attendance', async t => {
  const f = await fixture(t);
  assert.ok([401, 403].includes((await f.request('/attendance-summary')).status));
  assert.ok([401, 403].includes((await f.request('/attendance-summary', { cookie: 'placement_device=fake.signature' })).status));
});

test('a disabled allowlist member loses access even with an existing session', async t => {
  const f = await fixture(t);
  const { cookie } = await f.session();
  await f.db.collection('AllowedEmails').doc(ALICE).set({ enabled: false, email: ALICE });
  assert.equal((await f.request('/events', { cookie })).status, 403);
});

test('an approved email already owned by another UID cannot be rebound after account recreation', async t => {
  const f = await fixture(t, { [`AllowedEmails/${ALICE}`]: { enabled: true, email: ALICE, uid: 'original-account' } });
  const result = await f.request('/session', { body: {} });
  assert.equal(result.status, 403);
  assert.equal(result.cookie, undefined);
  assert.equal(Object.keys(f.db.dump()).filter(key => key.startsWith('Devices/')).length, 0);
});

test('students cannot access the roster, manage events, get room codes or mark another person', async t => {
  const f = await fixture(t);
  const { cookie } = await f.session();
  for (const [path, method, body] of [
    ['/students', 'GET'],
    ['/events', 'POST', { title: 'Unauthorized', date: '2026-11-04' }],
    ['/events/current', 'PATCH', { checkInOpen: false }],
    ['/events/current/room-code', 'POST', {}],
    ['/attendance/manual', 'POST', { eventId: 'current', email: BOB, reason: 'test' }],
  ]) {
    assert.equal((await f.request(path, { cookie, method, body })).status, 403, path);
  }
  assert.equal((await f.request('/attendance', { cookie, body: { eventId: 'current', email: BOB, rollNumber: 'someone-else', location: f.location() } })).status, 400);
});

test('committee can create and open an event, while invalid event dates are rejected', async t => {
  const f = await fixture(t);
  const admin = await f.session('committee');
  const options = { token: 'committee', cookie: admin.cookie };
  const invalid = await f.request('/events', { ...options, body: { title: 'Wrong date', date: '2026-02-31', isMandatory: true } });
  assert.equal(invalid.status, 400);
  const created = await f.request('/events', { ...options, body: { title: 'Interview practice', date: '2026-11-04', isMandatory: false } });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  assert.equal(created.data.checkInOpen, false);
  assert.equal(created.data.createdBy, 'committee');
  const opened = await f.request(`/events/${created.data.id}`, { ...options, method: 'PATCH', body: { checkInOpen: true } });
  assert.equal(opened.status, 200);
  const events = await f.request('/events', options);
  assert.equal(events.data.find(event => event.id === created.data.id).checkInOpen, true);
});

test('empty, null, array and malformed request bodies are rejected as client errors', async t => {
  const f = await fixture(t);
  const { cookie } = await f.session('committee');
  for (const path of ['/events', '/attendance', '/attendance/manual']) {
    const empty = await f.request(path, { token: 'committee', cookie, method: 'POST' });
    assert.equal(empty.status, 400, `${path} omitted body: ${JSON.stringify(empty.data)}`);
    for (const raw of ['', 'null', '[]', '"not an object"', '{"eventId":']) {
      const result = await f.request(path, { token: 'committee', cookie, raw });
      assert.equal(result.status, 400, `${path} raw ${JSON.stringify(raw)}: ${JSON.stringify(result.data)}`);
    }
  }
  assert.equal(Object.keys(f.db.dump()).filter(key => key.startsWith('AttendanceLogs/')).length, 0);
  assert.equal(Object.keys(f.db.dump()).filter(key => key.startsWith('Events/')).length, 3);
});

test('self check-in requires location, fresh accurate proximity, an open event and a valid room code', async t => {
  const f = await fixture(t);
  const { cookie } = await f.session();
  const roomCode = await f.code();
  const bodies = [
    { eventId: 'current', roomCode },
    { eventId: 'current', roomCode, location: f.location({ latitude: 13.2 }) },
    { eventId: 'current', roomCode, location: f.location({ capturedAt: START - 120000 }) },
    { eventId: 'current', roomCode, location: f.location({ capturedAt: START + 120000 }) },
    { eventId: 'current', roomCode, location: f.location({ accuracyMeters: 80 }) },
    { eventId: 'current', roomCode, location: f.location({ latitude: '12.9' }) },
    { eventId: 'current', roomCode, location: f.location({ longitude: 181 }) },
    { eventId: 'current', location: f.location() },
    { eventId: 'current', roomCode: 'invalid', location: f.location() },
    { eventId: 'closed', roomCode, location: f.location() },
    { eventId: 'old', roomCode, location: f.location() },
    { eventId: 'missing', roomCode, location: f.location() },
  ];
  for (const body of bodies) {
    const result = await f.request('/attendance', { cookie, body });
    assert.ok(result.status >= 400 && result.status < 500, `${JSON.stringify(body)}: ${JSON.stringify(result)}`);
  }
  assert.equal(Object.keys(f.db.dump()).filter(key => key.startsWith('AttendanceLogs/')).length, 0);
});

test('short-lived room codes expire and a newly generated code enables check-in again', async t => {
  const f = await fixture(t);
  const { cookie } = await f.session();
  const roomCode = await f.code();
  f.advance(61000);
  const expired = await f.request('/attendance', { cookie, body: { eventId: 'current', roomCode, location: f.location() } });
  assert.ok([400, 403, 409].includes(expired.status));
  const replacement = await f.code();
  const success = await f.request('/attendance', { cookie, body: { eventId: 'current', roomCode: replacement, location: f.location() } });
  assert.equal(success.status, 200, JSON.stringify(success.data));
});

test('repeated room-code guesses are throttled for a signed-in attendee', async t => {
  const f = await fixture(t);
  const { cookie } = await f.session();
  await f.code();
  let result;
  for (let attempt = 0; attempt < 16; attempt++) {
    result = await f.request('/attendance', { cookie, body: { eventId: 'current', roomCode: 'invalid', location: f.location() } });
  }
  assert.equal(result.status, 429);
  assert.equal(Object.keys(f.db.dump()).filter(key => key.startsWith('AttendanceLogs/')).length, 0);
});

test('successful attendance stores the authenticated person and location exactly once', async t => {
  const f = await fixture(t);
  const { cookie } = await f.session();
  const roomCode = await f.code();
  const body = { eventId: 'current', roomCode, location: f.location() };
  const first = await f.request('/attendance', { cookie, body });
  assert.equal(first.status, 200, JSON.stringify(first.data));
  assert.equal(first.data.alreadyMarked, false);
  const original = f.db.dump();
  const duplicates = await Promise.all([f.request('/attendance', { cookie, body }), f.request('/attendance', { cookie, body })]);
  assert.ok(duplicates.every(result => result.status === 200 && result.data.alreadyMarked));
  const logs = Object.entries(f.db.dump()).filter(([key]) => key.startsWith('AttendanceLogs/'));
  assert.equal(logs.length, 1);
  assert.equal(logs[0][1].uid, 'alice');
  assert.equal(logs[0][1].email, ALICE);
  assert.equal(logs[0][1].location.latitude, 12.9);
  assert.equal(logs[0][1].location.longitude, 77.6);
  assert.deepEqual(f.db.dump()[logs[0][0]], original[logs[0][0]], 'duplicate attendance must not overwrite the first location/time');
});

test('concurrent first check-ins create exactly one record with one idempotent response', async t => {
  const f = await fixture(t);
  const { cookie } = await f.session();
  const roomCode = await f.code();
  const body = { eventId: 'current', roomCode, location: f.location() };
  const results = await Promise.all([f.request('/attendance', { cookie, body }), f.request('/attendance', { cookie, body })]);
  assert.ok(results.every(result => result.status === 200), JSON.stringify(results));
  assert.deepEqual(results.map(result => result.data.alreadyMarked).sort(), [false, true]);
  assert.equal(Object.keys(f.db.dump()).filter(key => key.startsWith('AttendanceLogs/')).length, 1);
});

test('the supplied real venue pin supports the complete authenticated self check-in request', async t => {
  const venue = loadConfig({ ENFORCE_ONSITE_ATTENDANCE: 'true' }).venue;
  const f = await fixture(t, {}, venue);
  const { cookie } = await f.session();
  const result = await f.request('/attendance', {
    cookie,
    body: { eventId: 'current', location: f.location({ latitude: venue.latitude, longitude: venue.longitude }) },
  });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.equal(result.data.attendance.location.latitude, 12.912773610440954);
  assert.equal(result.data.attendance.location.longitude, 77.62322878099566);
  assert.equal(result.data.attendance.location.distanceMeters, 0);
  assert.equal(result.data.attendance.venueAddress, venue.address);
});

test('students see only their own attendance while committee can review all records', async t => {
  const f = await fixture(t, {
    'AttendanceLogs/alice-existing': { uid: 'alice', email: ALICE, eventId: 'current', timestamp: new Date(START).toISOString() },
    'AttendanceLogs/bob-existing': { uid: 'bob', email: BOB, eventId: 'current', timestamp: new Date(START).toISOString() },
  });
  const { cookie } = await f.session();
  const mine = await f.request('/attendance-summary', { cookie });
  assert.equal(mine.status, 200);
  assert.equal(mine.data.logs.length, 1);
  assert.equal(mine.data.logs[0].uid, 'alice');
  const admin = await f.session('committee');
  const all = await f.request('/attendance-summary', { token: 'committee', cookie: admin.cookie });
  assert.equal(all.status, 200);
  assert.equal(all.data.logs.length, 2);
});

test('committee manual attendance requires a reason and is recorded as an audited override', async t => {
  const f = await fixture(t);
  const admin = await f.session('committee');
  await f.session('bob');
  const missingReason = await f.request('/attendance/manual', { token: 'committee', cookie: admin.cookie, body: { eventId: 'current', email: BOB } });
  assert.equal(missingReason.status, 400);
  const result = await f.request('/attendance/manual', { token: 'committee', cookie: admin.cookie, body: { eventId: 'current', email: BOB, reason: 'Location unavailable; person verified in the room' } });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  const log = Object.entries(f.db.dump()).find(([key]) => key.startsWith('AttendanceLogs/'))?.[1];
  assert.equal(log.email, BOB);
  assert.ok(log.method.includes('manual') || log.method.includes('committee'));
  assert.equal(log.location ?? null, null);
  assert.ok(JSON.stringify(log).includes('Location unavailable; person verified in the room'));
  assert.ok(JSON.stringify(log).includes('committee'));
});

test('committee manual attendance rejects malformed emails and incomplete student registrations', async t => {
  const f = await fixture(t, {
    [`AllowedEmails/${BOB}`]: { email: BOB, enabled: true, uid: 'bob' },
  });
  const { cookie } = await f.session('committee');
  for (const email of ['bad/email@example.org', 'invalid-email', BOB]) {
    const result = await f.request('/attendance/manual', { token: 'committee', cookie, body: { eventId: 'current', email, reason: 'Manual record attempt' } });
    assert.equal(result.status, 400, `${email}: ${JSON.stringify(result.data)}`);
  }
  assert.equal(Object.keys(f.db.dump()).filter(key => key.startsWith('AttendanceLogs/')).length, 0);
});

test('attendance atomically consumes a signed phone proof only when every location and room-code gate passes', async t => {
  const { digest } = require('../security');
  const f = await fixture(t, { 'Events/second': { title: 'Another event', date: '2026-11-04', checkInOpen: true } });
  f.config.biometrics = { required: true, configured: true, rpID: 'attendance.example.org', expectedOrigins: ['https://attendance.example.org'] };
  const { cookie } = await f.session();
  const roomCode = await f.code();
  const body = { eventId: 'current', roomCode, location: f.location() };
  assert.equal((await f.request('/attendance', { cookie, body })).status, 403);
  const token = 'f'.repeat(64);
  const deviceToken = cookie.split('=')[1].split('.')[0];
  const deviceId = digest(deviceToken);
  await f.db.collection('BiometricCredentials').doc(digest('credential')).set({ id: 'credential', uid: 'alice', deviceId, active: true });
  await f.db.collection('BiometricProofs').doc(digest(token)).set({ uid: 'alice', deviceId, eventId: 'current', credentialId: 'credential', expiresAt: START + 60000, used: false, verifiedAt: new Date(START).toISOString() });
  const invalid = await f.request('/attendance', { cookie, body: { ...body, biometricProof: token, roomCode: 'invalid' } });
  assert.equal(invalid.status, 403);
  assert.equal((await f.db.collection('BiometricProofs').doc(digest(token)).get()).data().used, false);
  const success = await f.request('/attendance', { cookie, body: { ...body, biometricProof: token } });
  assert.equal(success.status, 200, JSON.stringify(success.data));
  assert.equal(success.data.attendance.verification.method, 'passkey-user-verification');
  assert.equal((await f.db.collection('BiometricProofs').doc(digest(token)).get()).data().used, true);
  const second = await f.request('/attendance', { cookie, body: { ...body, eventId: 'second', biometricProof: token } });
  assert.equal(second.status, 403);
  assert.equal(Object.keys(f.db.dump()).filter(key => key.startsWith('AttendanceLogs/')).length, 1);
});


test('venue lock protects interactive routes while bootstrap and stop controls remain accessible', async t => {
  const f = await fixture(t, {}, {}, { required: true });
  const member = await f.session();
  for (const path of ['/events', '/biometrics', '/attendance-summary', '/tracking/report?date=2026-11-04']) {
    assert.equal((await f.request(path, { cookie: member.cookie })).status, 403, path);
  }
  assert.equal((await f.request('/tracking/start', { cookie: member.cookie, body: { consent: true } })).status, 403);
  assert.equal((await f.request('/tracking/status', { cookie: member.cookie })).status, 200);
  assert.equal((await f.request('/tracking/stop', { cookie: member.cookie, body: {} })).status, 200);
  assert.equal((await f.request('/me', { cookie: member.cookie })).status, 200);
  const committee = await f.session('committee');
  assert.equal((await f.request('/students', { token: 'committee', cookie: committee.cookie })).status, 403);
});

test('venue lease is bound to the signed-in profile and expires when its location becomes stale', async t => {
  const f = await fixture(t, {}, {}, { required: true });
  const member = await f.session();
  const unlock = await f.request('/access/verify', { cookie: member.cookie, body: { location: f.location() } });
  assert.equal(unlock.status, 200, JSON.stringify(unlock.data));
  const venueToken = unlock.data.token;
  assert.equal((await f.request('/events', { cookie: member.cookie, venueToken })).status, 200);
  const anotherProfile = await f.session();
  assert.equal((await f.request('/events', { cookie: anotherProfile.cookie, venueToken })).status, 403);
  const bob = await f.session('bob');
  assert.equal((await f.request('/events', { token: 'bob', cookie: bob.cookie, venueToken })).status, 403);
  f.advance(15001);
  assert.equal((await f.request('/events', { cookie: member.cookie, venueToken })).status, 403);
  const records = Object.entries(f.db.dump()).filter(([path]) => path.startsWith('VenueAccess'));
  assert.ok(records.length > 0);
  assert.equal(JSON.stringify(records).includes('latitude'), false, 'access checks must not create location histories');
});

test('confirmed outside position immediately revokes prior venue access and old fixes cannot reopen it', async t => {
  const f = await fixture(t, {}, {}, { required: true });
  const { cookie } = await f.session();
  const unlock = await f.request('/access/verify', { cookie, body: { location: f.location() } });
  assert.equal(unlock.status, 200);
  const locked = await f.request('/access/verify', { cookie, body: { location: f.location({ latitude: 13.1 }) } });
  assert.equal(locked.status, 403);
  assert.equal((await f.request('/events', { cookie, venueToken: unlock.data.token })).status, 403);
  assert.equal((await f.request('/access/verify', { cookie, body: { location: f.location() } })).status, 403);
  f.advance(1000);
  assert.equal((await f.request('/access/verify', { cookie, body: { location: f.location() } })).status, 200);
});

test('venue access rejects missing, inaccurate, stale and forged position flags', async t => {
  const f = await fixture(t, {}, {}, { required: true });
  const { cookie } = await f.session();
  for (const body of [ {}, { inside: true, location: f.location() }, { location: f.location({ accuracyMeters: 51 }) }, { location: f.location({ capturedAt: START - 16000 }) }, { location: f.location({ accuracyMeters: 0 }) }]) {
    const result = await f.request('/access/verify', { cookie, body });
    assert.ok([400, 403].includes(result.status), JSON.stringify(result.data));
  }
});

test('away tracking and local stop remain usable after venue access locks', async t => {
  const f = await fixture(t, {}, {}, { required: true });
  const { cookie } = await f.session();
  const unlock = await f.request('/access/verify', { cookie, body: { location: f.location() } });
  const start = await f.request('/tracking/start', { cookie, venueToken: unlock.data.token, body: { consent: true } });
  assert.equal(start.status, 200, JSON.stringify(start.data));
  f.advance(1000);
  await f.request('/access/lock', { cookie, body: {} });
  assert.equal((await f.request('/events', { cookie, venueToken: unlock.data.token })).status, 403);
  assert.equal((await f.request('/tracking/points', { cookie, body: { points: [f.location({ latitude: 13.1 })] } })).status, 200);
  assert.equal((await f.request('/tracking/stop', { cookie, body: {} })).status, 200);
  assert.equal((await f.request('/tracking/points', { cookie, body: { points: [f.location({ latitude: 13.1 })] } })).status, 403);
});


test('attendance requires a recent observation of the exact venue Wi-Fi and records it only on success', async t => {
  const f = await fixture(t);
  const { cookie } = await f.session();
  const roomCode = await f.code();
  f.config.wifi = { required: true, ssid: 'Shikshavertex_5G' };
  const body = { eventId: 'current', roomCode, location: f.location() };
  for (const wifi of [undefined, { transport: 'cellular', ssid: 'Shikshavertex_5G', observedAt: START }, { transport: 'wifi', ssid: 'Guest', observedAt: START }, { transport: 'wifi', ssid: 'Shikshavertex_5G', observedAt: START - 10001 }]) {
    assert.equal((await f.request('/attendance', { cookie, body: { ...body, ...(wifi ? { wifi } : {}) } })).status, 403);
  }
  assert.equal(Object.keys(f.db.dump()).filter(key => key.startsWith('AttendanceLogs/')).length, 0);
  const wifi = { transport: 'wifi', ssid: 'Shikshavertex_5G', observedAt: START };
  const result = await f.request('/attendance', { cookie, body: { ...body, wifi } });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.equal(result.data.attendance.wifi.ssid, wifi.ssid);
  assert.equal(result.data.attendance.wifi.verification, 'native-client-observation');
  assert.equal((await f.request('/attendance', { cookie, body })).status, 403, 'a repeated submission still cannot bypass the Wi-Fi condition');
});

test('committee override cannot bypass the required Wi-Fi connection', async t => {
  const f = await fixture(t);
  const admin = await f.session('committee'); await f.session('bob');
  f.config.wifi = { required: true, ssid: 'Shikshavertex_5G' };
  const body = { eventId: 'current', email: BOB, reason: 'Student verified in the room' };
  assert.equal((await f.request('/attendance/manual', { token: 'committee', cookie: admin.cookie, body })).status, 403);
  assert.equal((await f.request('/attendance/manual', { token: 'committee', cookie: admin.cookie, body: { ...body, wifi: { transport: 'wifi', ssid: 'Shikshavertex_5G', observedAt: START } } })).status, 400);
  assert.equal((await f.request('/attendance/manual', { token: 'committee', cookie: admin.cookie, body: { ...body, location: f.location({ latitude: 13.1 }), wifi: { transport: 'wifi', ssid: 'Shikshavertex_5G', observedAt: START } } })).status, 403);
  const result = await f.request('/attendance/manual', { token: 'committee', cookie: admin.cookie, body: { ...body, location: f.location(), wifi: { transport: 'wifi', ssid: 'Shikshavertex_5G', observedAt: START } } });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  const log = Object.entries(f.db.dump()).find(([path]) => path.startsWith('AttendanceLogs/'))[1];
  assert.equal(log.wifi.ssid, 'Shikshavertex_5G');
});

test('a client-supplied forwarded IP does not bypass an optional venue egress restriction', async t => {
  const f = await fixture(t);
  const { cookie } = await f.session(); const roomCode = await f.code();
  f.config.wifi = { required: true, ssid: 'Shikshavertex_5G', allowedIps: ['203.0.113.42'] };
  const body = { eventId: 'current', location: f.location(), roomCode, wifi: { transport: 'wifi', ssid: 'Shikshavertex_5G', observedAt: START, requestIp: '203.0.113.42' } };
  assert.equal((await f.request('/attendance', { cookie, forwardedFor: '203.0.113.42', body })).status, 403);
  f.config.wifi.allowedIps = ['127.0.0.1'];
  assert.equal((await f.request('/attendance', { cookie, body })).status, 200);
});


test('employee requests need verified company email and remain blocked until an HR decision', async t => {
  const f = await fixture(t);
  const denied = await f.request('/events', { token: 'hire' });
  assert.equal(denied.status, 403); assert.equal(denied.data.code, 'HR_APPROVAL_REQUIRED');
  for (const token of [null, 'unverified', 'unlisted']) {
    assert.ok([401, 403].includes((await f.request('/registration/request', { token, body: { fullName: 'Employee' } })).status));
  }
  const result = await f.request('/registration/request', { token: 'hire', body: { fullName: 'Arockia Joe Arnold', role: 'committee', approved: true } });
  assert.equal(result.status, 200); assert.equal(result.data.status, 'pending');
  assert.equal((await f.request('/registration/status', { token: 'hire' })).data.approved, false);
  assert.equal((await f.request('/session', { token: 'hire', body: {} })).status, 403);
  assert.equal(f.db.dump()['AllowedEmails/new.employee@shikshavertex.in'], undefined);
  const member = await f.session();
  assert.equal((await f.request('/employees', { cookie: member.cookie })).status, 403);
  assert.equal((await f.request('/registration-requests/hire/approve', { cookie: member.cookie, body: { employeeId: 'SV001' } })).status, 403);
});

test('HR approval links a roster identity exactly once without granting a job title admin privileges', async t => {
  const { seedEmployees } = require('../scripts/seed-employees');
  const f = await fixture(t); await seedEmployees(f.db);
  await f.request('/registration/request', { token: 'hire', body: { fullName: 'Requested name is not authoritative' } });
  await f.request('/registration/request', { token: 'hire2', body: { fullName: 'Second employee' } });
  const admin = await f.session('committee');
  const directory = await f.request('/employees', { token: 'committee', cookie: admin.cookie });
  assert.equal(directory.data.length, 64);
  const approve = body => f.request('/registration-requests/hire/approve', { token: 'committee', cookie: admin.cookie, body });
  assert.equal((await approve({ employeeId: 'SV999' })).status, 400);
  assert.equal((await approve({ employeeId: 'SV001' })).status, 200);
  assert.equal((await approve({ employeeId: 'SV001' })).status, 409);
  const hire = await f.session('hire');
  assert.equal(hire.data.user.fullName, 'Arockia Joe Arnold');
  assert.equal(hire.data.user.designation, 'Manager - Inside Sales');
  assert.equal(hire.data.user.role, 'student', 'job title must not grant administrator privileges');
  assert.equal(hire.data.user.employeeId, 'SV001');
  assert.equal((await f.request('/employees', { token: 'hire', cookie: hire.cookie })).status, 403);
  const collision = await f.request('/registration-requests/hire2/approve', { token: 'committee', cookie: admin.cookie, body: { employeeId: 'SV001' } });
  assert.equal(collision.status, 409);
  const request = f.db.dump()['RegistrationRequests/hire'];
  assert.equal(request.reviewedBy, 'committee'); assert.equal(request.status, 'approved');
});

test('rejected or revoked requests cannot approve or re-enable themselves', async t => {
  const f = await fixture(t); const admin = await f.session('committee');
  await f.request('/registration/request', { token: 'hire', body: { fullName: 'Employee' } });
  const reject = await f.request('/registration-requests/hire/reject', { token: 'committee', cookie: admin.cookie, body: { reason: 'Identity could not be confirmed' } });
  assert.equal(reject.status, 200);
  const again = await f.request('/registration/request', { token: 'hire', body: { fullName: 'Changed name', status: 'approved' } });
  assert.equal(again.data.status, 'rejected');
  assert.equal((await f.request('/registration/status', { token: 'hire' })).data.approved, false);
  await f.db.collection('AllowedEmails').doc('new.employee@shikshavertex.in').set({ enabled: false, uid: 'hire' });
  assert.equal((await f.request('/registration/request', { token: 'hire', body: { fullName: 'Employee' } })).status, 403);
});


test('first verified HR mailbox receives a one-time claim and must use a refreshed token', async t => {
  const f = await fixture(t);
  f.config.bootstrapHrEmail = 'hr@shikshavertex.in';
  const initial = await f.request('/session', { token: 'hr', body: {} });
  assert.equal(initial.status, 401, JSON.stringify(initial.data));
  assert.equal(initial.data.code, 'TOKEN_REFRESH_REQUIRED');
  const signed = await f.session('hr');
  assert.equal(signed.data.user.role, 'committee');
  assert.equal((await f.request('/employees', { token: 'hr', cookie: signed.cookie })).status, 200);
  assert.equal(f.db.dump()['System/initial-hr-admin'].uid, 'hr');
});

test('owner-selected viewers need verified email, retain profile binding, and receive no HR or movement privileges', async t => {
  const f = await fixture(t, { 'AllowedEmails/surya_deekshith@shikshavertex.in': { enabled: true } });
  f.config.attendanceViewerEmails = loadConfig({}).attendanceViewerEmails;
  assert.equal((await f.request('/session', { token: 'unverifiedPallavi', body: {} })).status, 403);
  assert.equal(f.db.dump()['AttendanceViewers/hr_pallavi@shikshavertex.in'], undefined);
  const surya = await f.session('surya');
  assert.equal(surya.data.user.canViewAllAttendance, true);
  assert.equal(surya.data.user.role, 'student', 'viewer permission must not replace existing employee access');
  const pallavi = await f.session('pallavi');
  assert.equal(pallavi.data.user.role, 'attendance-viewer');
  assert.equal(pallavi.data.user.canViewAllAttendance, true);
  assert.equal(f.db.dump()['AllowedEmails/hr_pallavi@shikshavertex.in'], undefined, 'viewing must not silently approve employee attendance');
  const report = '/attendance-report?date=2026-11-04';
  assert.equal((await f.request(report, { token: 'pallavi', cookie: pallavi.cookie })).status, 200);
  assert.equal((await f.request(report, { token: 'pallavi', cookie: surya.cookie })).status, 403);
  assert.equal((await f.request(report, { token: 'pallavi' })).status, 403);
  for (const token of [null, 'invalid', 'unverifiedPallavi']) assert.ok([401, 403].includes((await f.request(report, { token, cookie: pallavi.cookie })).status));
  for (const token of ['surya', 'pallavi']) {
    const cookie = token === 'surya' ? surya.cookie : pallavi.cookie;
    for (const path of ['/employees', '/registration-requests', '/students', '/tracking/report?date=2026-11-04&uid=alice']) {
      assert.equal((await f.request(path, { token, cookie })).status, 403, path);
    }
    for (const [path, body] of [['/events', { title: 'Forged', date: '2026-11-04' }], ['/attendance/manual', { email: ALICE }], ['/registration-requests/hire/approve', { employeeId: 'SV001' }]]) {
      assert.equal((await f.request(path, { token, cookie, body })).status, 403, path);
    }
  }
  for (const path of ['/events', '/attendance-summary', '/biometrics', '/tracking/status', '/tracking/report?date=2026-11-04']) {
    assert.equal((await f.request(path, { token: 'pallavi', cookie: pallavi.cookie })).status, 403, path);
  }
  for (const path of ['/attendance', '/tracking/start', '/tracking/points']) {
    assert.equal((await f.request(path, { token: 'pallavi', cookie: pallavi.cookie, body: { eventId: 'current', consent: true } })).status, 403, path);
  }
  const alice = await f.session();
  assert.equal((await f.request(report, { cookie: alice.cookie })).status, 403);
  const code = await f.code();
  assert.equal((await f.request('/attendance', { token: 'surya', cookie: surya.cookie, body: { eventId: 'current', location: f.location(), roomCode: code } })).status, 200, 'existing employee keeps own attendance');
});

test('viewer grants preserve revocations, UID ownership and existing HR access', async t => {
  const f = await fixture(t, { 'AllowedEmails/surya_deekshith@shikshavertex.in': { enabled: true } });
  f.config.attendanceViewerEmails = loadConfig({}).attendanceViewerEmails;
  f.config.bootstrapHrEmail = 'hr@shikshavertex.in';
  await f.request('/session', { token: 'hr', body: {} });
  const hr = await f.session('hr');
  assert.equal(hr.data.user.role, 'committee'); assert.equal(hr.data.user.canViewAllAttendance, true);
  assert.equal((await f.request('/employees', { token: 'hr', cookie: hr.cookie })).status, 200);
  const surya = await f.session('surya');
  await f.db.collection('AttendanceViewers').doc('surya_deekshith@shikshavertex.in').set({ enabled: false }, { merge: true });
  assert.equal((await f.request('/attendance-report', { token: 'surya', cookie: surya.cookie })).status, 403);
  const own = await f.request('/me', { token: 'surya', cookie: surya.cookie });
  assert.equal(own.status, 200); assert.equal(own.data.user.canViewAllAttendance, false);
  const pallavi = await f.session('pallavi');
  assert.equal((await f.request('/session', { token: 'recreatedPallavi', body: {} })).status, 403);
  await f.db.collection('AttendanceViewers').doc('hr_pallavi@shikshavertex.in').set({ enabled: false }, { merge: true });
  assert.equal((await f.request('/attendance-report', { token: 'pallavi', cookie: pallavi.cookie })).status, 403);
  assert.equal(f.db.dump()['AttendanceViewers/hr_pallavi@shikshavertex.in'].enabled, false);
  await f.db.collection('AllowedEmails').doc('surya_deekshith@shikshavertex.in').set({ enabled: false }, { merge: true });
  assert.equal((await f.request('/session', { token: 'surya', body: {} })).status, 403);
});

test('attendance report filters date/session, counts registered accounts, preserves historical logs and omits location/proof data', async t => {
  const f = await fixture(t, {
    'AttendanceLogs/current-alice': { uid: 'alice', email: ALICE, eventId: 'current', timestamp: new Date(START).toISOString(), method: 'self', attendanceMode: 'setup', locationVerified: false, location: { latitude: 12.9, longitude: 77.6 }, verification: { credentialId: 'secret-proof' }, deviceId: 'hidden-device' },
    'AttendanceLogs/past-bob': { uid: 'bob', email: BOB, eventId: 'old', timestamp: '2026-11-03T06:00:00Z', method: 'committee' },
    'AttendanceLogs/historical': { uid: 'disabled-user', email: 'historical@shikshavertex.in', eventId: 'current', timestamp: new Date(START).toISOString(), method: 'committee' },
    'AttendanceLogs/legacy': { rollNumber: 'not-attributable', eventId: 'current', timestamp: new Date(START).toISOString() },
  });
  await f.session(); await f.session('bob');
  const admin = await f.session('committee');
  const get = path => f.request(path, { token: 'committee', cookie: admin.cookie });
  const report = await get('/attendance-report?date=2026-11-04');
  assert.equal(report.status, 200, JSON.stringify(report.data));
  assert.equal(report.data.events.length, 2);
  assert.equal(report.data.totals.marked, 2);
  assert.equal(report.data.rows.find(r => r.email === ALICE).status, 'marked');
  assert.equal(report.data.rows.find(r => r.email === BOB).status, 'not-marked');
  assert.equal(report.data.rows.find(r => r.email === 'historical@shikshavertex.in').status, 'marked');
  assert.equal(report.data.rows.some(r => r.email.includes('hr_pallavi')), false);
  for (const field of ['latitude', 'longitude', 'secret-proof', 'deviceId', 'not-attributable', 'credentialId']) assert.equal(JSON.stringify(report.data).includes(field), false, field);
  assert.equal((await get('/attendance-report?date=2026-11-04&eventId=closed')).data.totals.marked, 0);
  assert.equal((await get('/attendance-report?date=2026-11-03')).data.rows.find(r => r.email === BOB).status, 'marked');
  for (const path of ['/attendance-report?date=2026-11-05', '/attendance-report?date=2026-02-30', '/attendance-report?date=bad', '/attendance-report?date=2026-11-04&eventId=old', '/attendance-report?date=2026-11-04&eventId=../bad', '/attendance-report?date[]=2026-11-04']) {
    assert.equal((await get(path)).status, 400, path);
  }
});

test('HR manual-target metadata distinguishes approved employees from viewer-only accounts without hiding history identities', async t => {
  const f = await fixture(t);
  f.config.attendanceViewerEmails = loadConfig({}).attendanceViewerEmails;
  await f.session(); await f.session('pallavi');
  const admin = await f.session('committee');
  const result = await f.request('/students', { token: 'committee', cookie: admin.cookie });
  assert.equal(result.status, 200);
  assert.equal(result.data.find(user => user.uid === 'alice').attendanceEligible, true);
  assert.equal(result.data.find(user => user.uid === 'pallavi').attendanceEligible, false);
  await f.db.collection('AllowedEmails').doc(ALICE).set({ enabled: false }, { merge: true });
  const updated = await f.request('/students', { token: 'committee', cookie: admin.cookie });
  assert.equal(updated.data.find(user => user.uid === 'alice').attendanceEligible, false);
  assert.equal(updated.data.some(user => user.uid === 'pallavi'), true);
});
