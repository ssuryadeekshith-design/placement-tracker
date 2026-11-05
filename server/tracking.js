const { HttpError, digest, readDevice, distanceMeters, indiaDate } = require('./security');

const TIMEZONE = 'Asia/Kolkata';
const CONSENT_VERSION = 'daily-location-v1';
const MAX_GAP_MS = 5 * 60 * 1000;
const MAX_POINTS = 1440;
const RETENTION_DAYS = 30;
const FINALIZATION_GRACE_MS = 5 * 60 * 1000;
const iso = value => new Date(value).toISOString();

function dayWindow(date) {
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || iso(Date.parse(date)).slice(0, 10) !== date) {
        throw new HttpError(400, 'Choose a valid report date (YYYY-MM-DD).');
    }
    return { start: Date.parse(`${date}T10:30:00+05:30`), end: Date.parse(`${date}T20:30:00+05:30`) };
}

function classification(point, venue) {
    if (!venue.configured || !Number.isFinite(venue.latitude) || !Number.isFinite(venue.longitude) || point.accuracyMeters > venue.maxAccuracyMeters) return 'unknown';
    const distance = distanceMeters(point.latitude, point.longitude, venue.latitude, venue.longitude);
    if (distance + point.accuracyMeters <= venue.radiusMeters) return 'inside';
    if (distance - point.accuracyMeters > venue.radiusMeters) return 'away';
    return 'unknown';
}

function consentCovers(session, from, to) {
    return (session?.consentPeriods || []).some(period => period.startAt <= from && (period.endAt ?? session.endAt) >= to);
}

/** Sample-based estimates, never an assertion about continuous GPS or exact crossing times. */
function buildDailyReport({ date, uid, points = [], session = null, venue, now = Date.now() }) {
    const window = dayWindow(date);
    const through = Math.max(window.start, Math.min(now, window.end));
    const valid = points.filter(point => [point.latitude, point.longitude, point.accuracyMeters, point.capturedAt].every(Number.isFinite) && point.capturedAt >= window.start && point.capturedAt <= through)
        .sort((a, b) => a.capturedAt - b.capturedAt)
        .filter((point, index, list) => index === 0 || point.capturedAt !== list[index - 1].capturedAt)
        .slice(0, MAX_POINTS)
        .map(point => ({ ...point, state: classification(point, venue) }));
    const segments = [];
    function append(startAt, endAt, state, reason) {
        if (endAt <= startAt) return;
        const previous = segments.at(-1);
        if (previous && previous.state === state && previous.reason === reason && previous.endAt === startAt) previous.endAt = endAt;
        else segments.push({ startAt, endAt, state, ...(reason ? { reason } : {}) });
    }
    let cursor = window.start;
    for (let index = 0; index < valid.length; index++) {
        const current = valid[index];
        const next = valid[index + 1];
        if (current.capturedAt > cursor) append(cursor, current.capturedAt, 'unknown', 'No location samples');
        if (next) {
            const duration = next.capturedAt - current.capturedAt;
            let state = 'unknown';
            let reason = 'Boundary crossing or inaccurate location';
            if (!consentCovers(session, current.capturedAt, next.capturedAt)) reason = 'Tracking was not active throughout this interval';
            else if (duration > MAX_GAP_MS) reason = 'Location reporting gap';
            else if (current.state === next.state && current.state !== 'unknown') { state = current.state; reason = undefined; }
            append(current.capturedAt, next.capturedAt, state, reason);
            cursor = next.capturedAt;
        } else cursor = current.capturedAt;
    }
    append(cursor, through, 'unknown', valid.length ? 'No later location sample' : 'No location samples');
    const totals = { insideSeconds: 0, awaySeconds: 0, unknownSeconds: 0 };
    for (const segment of segments) totals[`${segment.state}Seconds`] += (segment.endAt - segment.startAt) / 1000;
    const timeline = segments.map(segment => ({ ...segment, startAt: iso(segment.startAt), endAt: iso(segment.endAt), durationSeconds: (segment.endAt - segment.startAt) / 1000 }));
    const excursions = [];
    let lastInside = null;
    let excursion = null;
    for (const point of valid) {
        if (point.state === 'away') {
            if (!excursion) excursion = { first: point.capturedAt, last: point.capturedAt, previousInside: lastInside };
            excursion.last = point.capturedAt;
        } else if (point.state === 'inside') {
            if (excursion) { finishExcursion(point.capturedAt); excursion = null; }
            lastInside = point.capturedAt;
        }
    }
    if (excursion) finishExcursion(null);
    function finishExcursion(returnedAt) {
        const end = returnedAt ?? through;
        const overlap = state => segments.filter(segment => segment.state === state).reduce((sum, segment) => sum + Math.max(0, Math.min(end, segment.endAt) - Math.max(excursion.first, segment.startAt)) / 1000, 0);
        excursions.push({
            leftAt: iso(excursion.first), returnedAt: returnedAt === null ? null : iso(returnedAt),
            departureWindow: excursion.previousInside === null ? null : { after: iso(excursion.previousInside), before: iso(excursion.first) },
            returnWindow: returnedAt === null ? null : { after: iso(excursion.last), before: iso(returnedAt) },
            durationSeconds: overlap('away'), unknownSeconds: overlap('unknown'),
            elapsedSeconds: (end - excursion.first) / 1000, estimated: true,
        });
    }
    const visits = [];
    let cluster = [];
    function finishCluster() {
        if (cluster.length > 1) {
            const startAt = cluster[0].capturedAt;
            const endAt = cluster.at(-1).capturedAt;
            if (endAt - startAt >= 3 * 60 * 1000) {
                const latitude = cluster.reduce((sum, point) => sum + point.latitude, 0) / cluster.length;
                const longitude = cluster.reduce((sum, point) => sum + point.longitude, 0) / cluster.length;
                visits.push({ latitude, longitude, startAt: iso(startAt), endAt: iso(endAt), dwellSeconds: (endAt - startAt) / 1000,
                    label: `Location near ${latitude.toFixed(6)}, ${longitude.toFixed(6)}`,
                    mapsUrl: `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`, estimated: true });
            }
        }
        cluster = [];
    }
    for (const point of valid) {
        if (point.state !== 'away') { finishCluster(); continue; }
        if (cluster.length) {
            const anchor = cluster[0];
            const last = cluster.at(-1);
            if (point.capturedAt - last.capturedAt > MAX_GAP_MS || !consentCovers(session, last.capturedAt, point.capturedAt) ||
                distanceMeters(anchor.latitude, anchor.longitude, point.latitude, point.longitude) + anchor.accuracyMeters + point.accuracyMeters > 75) finishCluster();
        }
        cluster.push(point);
    }
    finishCluster();
    return {
        date, uid, timezone: TIMEZONE, window: { start: iso(window.start), end: iso(window.end) }, observedThrough: iso(through),
        final: now >= window.end, totals, timeline, excursions, visits,
        gaps: timeline.filter(segment => segment.state === 'unknown'),
        route: valid.map(point => ({ latitude: point.latitude, longitude: point.longitude, accuracyMeters: point.accuracyMeters, capturedAt: iso(point.capturedAt), state: point.state })),
        disclaimer: 'Estimates from phone samples, not proof of exact departure, return, floor, business name or uninterrupted presence. Unknown time includes missing, inaccurate and boundary-crossing intervals.',
    };
}

function registerTrackingRoutes({ app, db, config, now = Date.now, protectedRoute, asyncRoute, limit = () => {}, venueAccess = (req, res, next) => next() }) {
    const sessionRef = (uid, date) => db.collection('TrackingDays').doc(digest(`${uid}:${date}`));
    const deviceId = req => digest(readDevice(req, config.cookieSecret));
    const schedule = { timezone: TIMEZONE, start: '10:30', end: '20:30', sampleIntervalSeconds: 60, maximumGapSeconds: MAX_GAP_MS / 1000, retentionDays: RETENTION_DAYS, consentVersion: CONSENT_VERSION };
    const publicSession = (ref, session) => session ? { id: ref.id, date: session.date, startAt: session.startAt, endAt: session.endAt, stoppedAt: session.stoppedAt ?? null, pointCount: session.pointCount || 0 } : null;
    function within(window, time) { return time >= window.start && time < window.end; }
    function assertOwnBody(req) {
        if ('uid' in req.body || 'email' in req.body || 'deviceId' in req.body) throw new HttpError(400, 'Tracking belongs only to your signed-in account.');
    }
    async function status(req) {
        const date = indiaDate(now());
        const window = dayWindow(date);
        const ref = sessionRef(req.identity.uid, date);
        const snapshot = await ref.get();
        return { schedule, session: publicSession(ref, snapshot.exists ? snapshot.data() : null), withinWindow: within(window, now()), date };
    }
    app.get('/api/tracking/status', ...protectedRoute, asyncRoute(async (req, res) => res.json(await status(req))));
    app.post('/api/tracking/start', ...protectedRoute, venueAccess, asyncRoute(async (req, res) => {
        assertOwnBody(req);
        if (req.body.consent !== true) throw new HttpError(400, 'Explicit consent is required to record locations for today.');
        limit(`tracking-start:${req.identity.uid}`, 20);
        const time = now();
        const date = indiaDate(time);
        const window = dayWindow(date);
        if (!within(window, time)) throw new HttpError(403, 'Daily location tracking is available only from 10:30 AM to 8:30 PM India time.');
        if (!config.venue.configured) throw new HttpError(503, 'The venue location is not configured.');
        const ref = sessionRef(req.identity.uid, date);
        const boundDevice = deviceId(req);
        await db.runTransaction(async transaction => {
            const snapshot = await transaction.get(ref);
            const existing = snapshot.exists ? snapshot.data() : null;
            if (existing && !existing.stoppedAt) {
                if (existing.deviceId !== boundDevice) throw new HttpError(409, 'Tracking is already active in another browser. Stop it before starting here.');
                return;
            }
            const periods = existing?.consentPeriods || [];
            if (periods.length >= 20) throw new HttpError(429, 'Too many tracking restarts today. Contact the committee.');
            const record = { uid: req.identity.uid, email: req.email, date, deviceId: boundDevice, startAt: time, endAt: window.end, stoppedAt: null,
                consentVersion: CONSENT_VERSION, consentPeriods: [...periods, { startAt: time, endAt: null }],
                pointCount: existing?.pointCount || 0, expiresAt: new Date(window.end + RETENTION_DAYS * 86400000) };
            transaction.set(ref, record);
        });
        res.json(await status(req));
    }));
    app.post('/api/tracking/stop', ...protectedRoute, asyncRoute(async (req, res) => {
        assertOwnBody(req);
        const time = now();
        const ref = sessionRef(req.identity.uid, indiaDate(time));
        await db.runTransaction(async transaction => {
            const snapshot = await transaction.get(ref);
            if (!snapshot.exists || snapshot.data().stoppedAt) return;
            const record = snapshot.data();
            const stop = Math.min(time, record.endAt);
            const periods = record.consentPeriods.map((period, index) => index === record.consentPeriods.length - 1 ? { ...period, endAt: stop } : period);
            transaction.set(ref, { stoppedAt: stop, consentPeriods: periods }, { merge: true });
        });
        res.json(await status(req));
    }));
    app.post('/api/tracking/points', ...protectedRoute, asyncRoute(async (req, res) => {
        assertOwnBody(req);
        limit(`tracking-points:${req.identity.uid}`, 30);
        const time = now();
        const date = indiaDate(time);
        const window = dayWindow(date);
        if (!within(window, time)) throw new HttpError(403, 'Location collection is closed outside the daily tracking window.');
        const points = req.body.points;
        if (!Array.isArray(points) || points.length < 1 || points.length > 30) throw new HttpError(400, 'Send between 1 and 30 location samples.');
        const normalized = points.map(point => {
            const { latitude, longitude, accuracyMeters, capturedAt } = point || {};
            if (![latitude, longitude, accuracyMeters, capturedAt].every(value => typeof value === 'number' && Number.isFinite(value)) ||
                latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180 || accuracyMeters <= 0 || accuracyMeters > 10000 ||
                capturedAt < time - MAX_GAP_MS || capturedAt > time + 5000 || capturedAt < window.start || capturedAt >= window.end) {
                throw new HttpError(400, 'Location samples must be valid, captured within the last five minutes and within today’s tracking hours.');
            }
            return { latitude, longitude, accuracyMeters, capturedAt };
        });
        const unique = [...new Map(normalized.map(point => [point.capturedAt, point])).values()];
        const ref = sessionRef(req.identity.uid, date);
        const boundDevice = deviceId(req);
        let accepted = 0;
        await db.runTransaction(async transaction => {
            if (!within(window, now())) throw new HttpError(403, 'The daily location collection window has ended.');
            const snapshot = await transaction.get(ref);
            const session = snapshot.exists ? snapshot.data() : null;
            if (!session || session.consentVersion !== CONSENT_VERSION || session.stoppedAt || session.deviceId !== boundDevice) throw new HttpError(403, 'Start tracking with your consent in this browser before sending locations.');
            if (unique.some(point => point.capturedAt < session.startAt || point.capturedAt >= session.endAt)) throw new HttpError(400, 'Location was captured outside your active consent period.');
            const references = unique.map(point => db.collection('TrackingPoints').doc(digest(`${ref.id}:${point.capturedAt}`)));
            const existing = await Promise.all(references.map(pointRef => transaction.get(pointRef)));
            accepted = existing.filter(point => !point.exists).length;
            if ((session.pointCount || 0) + accepted > MAX_POINTS) throw new HttpError(429, 'Daily location sample limit reached.');
            for (let index = 0; index < unique.length; index++) {
                if (!existing[index].exists) transaction.create(references[index], { ...unique[index], dayId: ref.id, uid: req.identity.uid, date,
                    receivedAt: iso(time), expiresAt: new Date(window.end + RETENTION_DAYS * 86400000) });
            }
            transaction.set(ref, { pointCount: (session.pointCount || 0) + accepted }, { merge: true });
        });
        res.json({ accepted, duplicates: unique.length - accepted });
    }));
    app.get('/api/tracking/report', ...protectedRoute, venueAccess, asyncRoute(async (req, res) => {
        const date = req.query.date || indiaDate(now());
        const window = dayWindow(date);
        if (window.start > now()) throw new HttpError(400, 'Future reports are not available.');
        const uid = req.query.uid || req.identity.uid;
        if (typeof uid !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(uid)) throw new HttpError(400, 'Invalid member.');
        if (uid !== req.identity.uid && req.identity.committee !== true) throw new HttpError(403, 'Only committee members can view another person’s tracking report.');
        limit(`tracking-report:${req.identity.uid}`, 30);
        const ref = sessionRef(uid, date);
        const [session, points] = await Promise.all([ref.get(), db.collection('TrackingPoints').where('dayId', '==', ref.id).limit(MAX_POINTS).get()]);
        const record = session.exists ? session.data() : null;
        res.json({ ...buildDailyReport({ date, uid, session: record, points: points.docs.map(doc => doc.data()), venue: config.venue, now: now() }),
            email: record?.email || null, trackingConsented: Boolean(record), consentVersion: record?.consentVersion || null });
    }));
}

// Call from a trusted server scheduler, never a public member endpoint. The grace
// period lets in-flight requests settle; no location uploads are accepted after 20:30.
async function finalizeDailyReports({ db, config, now = Date.now(), date }) {
    const time = typeof now === 'function' ? now() : now;
    const window = dayWindow(date);
    if (time < window.end + FINALIZATION_GRACE_MS) return { date, eligible: false, created: 0, existing: 0 };
    const sessions = await db.collection('TrackingDays').where('date', '==', date).limit(1000).get();
    let created = 0;
    let existing = 0;
    for (const sessionDoc of sessions.docs) {
        const ref = db.collection('DailyReports').doc(sessionDoc.id);
        if ((await ref.get()).exists) { existing++; continue; }
        const session = sessionDoc.data();
        const points = await db.collection('TrackingPoints').where('dayId', '==', sessionDoc.id).limit(MAX_POINTS).get();
        const report = { ...buildDailyReport({ date, uid: session.uid, points: points.docs.map(doc => doc.data()), session, venue: config.venue, now: time }),
            email: session.email, trackingConsented: true, consentVersion: session.consentVersion,
            generatedAt: iso(time), expiresAt: new Date(window.end + RETENTION_DAYS * 86400000) };
        try { await ref.create(report); created++; }
        catch (error) { if (error.code === 6 || error.code === 'already-exists') existing++; else throw error; }
    }
    return { date, eligible: true, created, existing, truncated: sessions.docs.length === 1000 };
}

module.exports = { registerTrackingRoutes, buildDailyReport, finalizeDailyReports, dayWindow, classification, CONSENT_VERSION, MAX_GAP_MS };
