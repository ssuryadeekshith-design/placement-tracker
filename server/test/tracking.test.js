const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { once } = require('node:events');
const { createFakeFirestore } = require('./fake-firestore');
const { HttpError, hmac, digest } = require('../security');
const { registerTrackingRoutes, buildDailyReport, finalizeDailyReports, dayWindow, classification, CONSENT_VERSION } = require('../tracking');

const DATE = '2026-11-04';
const WINDOW = dayWindow(DATE);
const VENUE = { configured: true, latitude: 12.912773610440954, longitude: 77.62322878099566, radiusMeters: 100, maxAccuracyMeters: 50 };
const COOKIE_SECRET = 'c'.repeat(64);
const token = 'a'.repeat(64);
const COOKIE = `placement_device=${token}.${hmac(token, COOKIE_SECRET)}`;
const pt = (minutes, longitude = VENUE.longitude, accuracyMeters = 5) => ({ latitude: VENUE.latitude, longitude, accuracyMeters, capturedAt: WINDOW.start + minutes * 60000 });
const session = (from = WINDOW.start, to = WINDOW.end) => ({ uid: 'alice', email: 'alice@example.org', date: DATE, startAt: from, endAt: WINDOW.end, consentVersion: CONSENT_VERSION, consentPeriods: [{ startAt: from, endAt: to }], stoppedAt: null });
const report = (points, extra = {}) => buildDailyReport({ date: DATE, uid: 'alice', points, session: session(), venue: VENUE, now: WINDOW.end, ...extra });

async function fixture(t, initial = {}) {
    let clock = WINDOW.start;
    const db = createFakeFirestore(initial);
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.body ??= {}; next(); });
    const auth = (req, res, next) => {
        if (!req.headers.authorization) return res.status(401).json({ error: 'Sign in' });
        const uid = req.headers.authorization;
        req.identity = { uid, committee: uid === 'committee' };
        req.email = `${uid}@example.org`;
        if (!req.headers.cookie) return res.status(403).json({ error: 'Bind browser' });
        next();
    };
    const asyncRoute = action => (req, res, next) => Promise.resolve(action(req, res, next)).catch(next);
    registerTrackingRoutes({ app, db, config: { cookieSecret: COOKIE_SECRET, venue: VENUE }, now: () => clock, protectedRoute: [auth], asyncRoute });
    app.use((error, req, res, next) => { res.status(error instanceof HttpError ? error.status : 500).json({ error: error.message }); });
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
    async function request(path, body, opts = {}) {
        const response = await fetch(`http://127.0.0.1:${server.address().port}/api/tracking${path}`, {
            method: body === undefined ? 'GET' : 'POST',
            headers: { ...(opts.uid !== null ? { Authorization: opts.uid || 'alice' } : {}), ...(opts.cookie !== null ? { Cookie: opts.cookie || COOKIE } : {}), 'Content-Type': 'application/json' },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        return { status: response.status, data: await response.json() };
    }
    return { db, request, setTime: time => { clock = time; } };
}

test('India tracking window is exactly 10:30 to 20:30 and invalid dates fail', () => {
    assert.equal(new Date(WINDOW.start).toISOString(), '2026-11-04T05:00:00.000Z');
    assert.equal(new Date(WINDOW.end).toISOString(), '2026-11-04T15:00:00.000Z');
    for (const date of ['2026-02-30', 'invalid', '2026-11-4', ['2026-11-04']]) assert.throws(() => dayWindow(date), error => error.status === 400);
});

test('accuracy overlapping venue edge is unknown; confident outside is away', () => {
    assert.equal(classification(pt(0), VENUE), 'inside');
    assert.equal(classification(pt(0, VENUE.longitude + 0.02), VENUE), 'away');
    assert.equal(classification({ ...pt(0), accuracyMeters: 100 }, VENUE), 'unknown');
    assert.equal(classification({ ...pt(0), latitude: VENUE.latitude + 0.00085, accuracyMeters: 30 }, VENUE), 'unknown');
});

test('reports count only covered adjacent samples and never fill gaps or boundary transitions', () => {
    const result = report([pt(0), pt(1), pt(2, VENUE.longitude + 0.02), pt(3, VENUE.longitude + 0.02), pt(10, VENUE.longitude + 0.02), pt(11)]);
    assert.equal(result.totals.insideSeconds, 60);
    assert.equal(result.totals.awaySeconds, 60);
    assert.equal(result.totals.unknownSeconds, 36000 - 120);
    assert.equal(result.excursions.length, 1);
    assert.equal(result.excursions[0].leftAt, new Date(pt(2).capturedAt).toISOString());
    assert.equal(result.excursions[0].returnedAt, new Date(pt(11).capturedAt).toISOString());
    assert.equal(result.excursions[0].durationSeconds, 60);
    assert.equal(result.excursions[0].unknownSeconds, 480);
    assert.ok(result.gaps.some(gap => gap.reason === 'Location reporting gap'));
    assert.equal(result.final, true);
});

test('unconsented time, tail after last sample and inaccurate points remain unknown', () => {
    const result = report([pt(0), pt(1), pt(2), pt(3), pt(4), pt(5, VENUE.longitude, 500)], {
        session: { ...session(), consentPeriods: [{ startAt: pt(0).capturedAt, endAt: pt(1).capturedAt }, { startAt: pt(3).capturedAt, endAt: pt(4).capturedAt }] },
        now: pt(10).capturedAt,
    });
    assert.equal(result.totals.insideSeconds, 120);
    assert.equal(result.totals.unknownSeconds, 480);
    assert.equal(result.final, false);
    assert.equal(report([], { session: null }).totals.unknownSeconds, 36000);
    assert.deepEqual(report([], { now: WINDOW.start - 100 }).totals, { insideSeconds: 0, awaySeconds: 0, unknownSeconds: 0 });
});

test('offsite visits require repeated nearby samples over three minutes and never invent place names', () => {
    const away = VENUE.longitude + 0.02;
    const result = report([pt(0, away), pt(1, away), pt(2, away), pt(3, away), pt(4), pt(10, away), pt(11, away)]);
    assert.equal(result.visits.length, 1);
    assert.equal(result.visits[0].dwellSeconds, 180);
    assert.match(result.visits[0].label, /^Location near /);
    assert.match(result.visits[0].mapsUrl, /maps\/search/);
    assert.equal(result.visits[0].estimated, true);
});

test('tracking is authenticated, explicitly consented and limited to the work window', async t => {
    const f = await fixture(t);
    assert.equal((await f.request('/status', undefined, { uid: null })).status, 401);
    assert.equal((await f.request('/status', undefined, { cookie: null })).status, 403);
    assert.equal((await f.request('/start', {})).status, 400);
    assert.equal((await f.request('/start', { consent: 'true' })).status, 400);
    f.setTime(WINDOW.start - 1);
    assert.equal((await f.request('/start', { consent: true })).status, 403);
    f.setTime(WINDOW.start);
    const started = await f.request('/start', { consent: true });
    assert.equal(started.status, 200);
    assert.equal(started.data.withinWindow, true);
    assert.equal(started.data.schedule.timezone, 'Asia/Kolkata');
    assert.equal(started.data.session.startAt, WINDOW.start);
    assert.equal(started.data.schedule.end, '20:30');
    f.setTime(WINDOW.end);
    assert.equal((await f.request('/start', { consent: true })).status, 403);
    assert.equal((await f.request('/points', { points: [pt(599)] })).status, 403);
});

test('only the consenting member/browser can send locations; timestamp retries are immutable', async t => {
    const f = await fixture(t);
    assert.equal((await f.request('/points', { points: [pt(0)] })).status, 403);
    await f.request('/start', { consent: true });
    assert.equal((await f.request('/points', { uid: 'bob', points: [pt(0)] })).status, 400);
    assert.equal((await f.request('/points', { points: [pt(0)] }, { uid: 'bob' })).status, 403);
    const other = 'b'.repeat(64);
    const cookie = `placement_device=${other}.${hmac(other, COOKIE_SECRET)}`;
    assert.equal((await f.request('/points', { points: [pt(0)] }, { cookie })).status, 403);
    assert.equal((await f.request('/start', { consent: true }, { cookie })).status, 409);
    const first = await f.request('/points', { points: [pt(0)] });
    assert.equal(first.status, 200);
    assert.equal(first.data.accepted, 1);
    const repeat = await f.request('/points', { points: [pt(0, VENUE.longitude + 1)] });
    assert.equal(repeat.data.accepted, 0);
    const saved = Object.entries(f.db.dump()).filter(([key]) => key.startsWith('TrackingPoints/'));
    assert.equal(saved.length, 1);
    assert.equal(saved[0][1].longitude, VENUE.longitude);
    assert.ok(saved[0][1].expiresAt instanceof Date);
});

test('location validation rejects stale, future, outside-consent, invalid and excessive batches', async t => {
    const f = await fixture(t);
    f.setTime(pt(10).capturedAt);
    await f.request('/start', { consent: true });
    for (const points of [[], Array.from({ length: 31 }, () => pt(10)), [pt(9)], [pt(0)], [pt(11)], [{ ...pt(10), latitude: 91 }], [{ ...pt(10), accuracyMeters: 0 }], [{ ...pt(10), latitude: '12' }]]) {
        const result = await f.request('/points', { points });
        assert.equal(result.status, 400, JSON.stringify(points));
    }
    const inaccurate = await f.request('/points', { points: [pt(10, VENUE.longitude, 500)] });
    assert.equal(inaccurate.status, 200, 'poor accuracy is recorded as unknown rather than silently filling a timeline');
});

test('stopping rejects uploads; resuming needs renewed explicit consent and preserves reporting gaps', async t => {
    const f = await fixture(t);
    await f.request('/start', { consent: true });
    await f.request('/points', { points: [pt(0)] });
    f.setTime(pt(1).capturedAt);
    await f.request('/points', { points: [pt(1)] });
    const stopped = await f.request('/stop', {});
    assert.equal(stopped.status, 200);
    assert.equal(stopped.data.session.stoppedAt, pt(1).capturedAt);
    assert.equal((await f.request('/points', { points: [pt(1)] })).status, 403);
    f.setTime(pt(3).capturedAt);
    assert.equal((await f.request('/start', {})).status, 400);
    await f.request('/start', { consent: true });
    assert.equal((await f.request('/points', { points: [pt(2)] })).status, 400);
    await f.request('/points', { points: [pt(3)] });
    f.setTime(pt(4).capturedAt);
    await f.request('/points', { points: [pt(4)] });
    const result = await f.request(`/report?date=${DATE}`);
    assert.equal(result.status, 200);
    assert.equal(result.data.totals.insideSeconds, 120);
    assert.equal(result.data.totals.unknownSeconds, 120);
});

test('daily reports are private to the member; committee can view another member only by explicit UID', async t => {
    const f = await fixture(t);
    await f.request('/start', { consent: true });
    await f.request('/points', { points: [pt(0)] });
    const denied = await f.request(`/report?date=${DATE}&uid=alice`, undefined, { uid: 'bob' });
    assert.equal(denied.status, 403);
    const allowed = await f.request(`/report?date=${DATE}&uid=alice`, undefined, { uid: 'committee' });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.data.email, 'alice@example.org');
    assert.equal((await f.request('/report?date=2026-02-30')).status, 400);
    assert.equal((await f.request('/report?date=2026-11-05')).status, 400);
    assert.equal((await f.request(`/report?date=${DATE}&uid=bad/path`)).status, 400);
});

test('end-of-day finalizer creates a persistent report once after the closing grace period', async () => {
    const id = digest(`alice:${DATE}`);
    const db = createFakeFirestore({ [`TrackingDays/${id}`]: session(), 'TrackingPoints/one': { ...pt(0), dayId: id }, 'TrackingPoints/two': { ...pt(1), dayId: id } });
    const before = await finalizeDailyReports({ db, config: { venue: VENUE }, date: DATE, now: WINDOW.end });
    assert.equal(before.eligible, false);
    const first = await finalizeDailyReports({ db, config: { venue: VENUE }, date: DATE, now: WINDOW.end + 300000 });
    assert.equal(first.created, 1);
    const saved = db.dump()[`DailyReports/${id}`];
    assert.equal(saved.final, true);
    assert.equal(saved.totals.insideSeconds, 60);
    assert.ok(saved.expiresAt instanceof Date);
    const repeated = await finalizeDailyReports({ db, config: { venue: VENUE }, date: DATE, now: WINDOW.end + 600000 });
    assert.equal(repeated.created, 0);
    assert.equal(repeated.existing, 1);
    assert.deepEqual(db.dump()[`DailyReports/${id}`], saved);
});
