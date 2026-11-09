const express = require('express');
const cors = require('cors');
const crypto = require('node:crypto');
const { bootstrapHr } = require('./hr-bootstrap');
const { viewerAccess, attendanceReport } = require('./attendance-viewers');
const { registerEmployeeRoutes } = require('./employee-registration');
const { checkAttendanceWifi } = require('./wifi-attendance');
const { createVenueAccess } = require('./venue-access');
const { registerTrackingRoutes } = require('./tracking');
const { registerBiometricRoutes, readAttendanceProof } = require('./biometrics');
const { HttpError, digest, normalizeEmail, hmac, safeEqual, readDevice, checkLocation, checkEvent, indiaDate } = require('./security');

const asyncRoute = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const snapshotData = snapshot => snapshot.exists ? snapshot.data() : null;
const eventView = doc => {
    const event = doc.data();
    return { id: doc.id, title: event.title, date: event.date, isMandatory: event.isMandatory !== false, checkInOpen: event.checkInOpen === true };
};
const profile = (user, token, access = {}) => ({ uid: token.uid, email: normalizeEmail(token.email), fullName: user.fullName || '', role: access.viewerOnly ? 'attendance-viewer' : token.committee === true ? 'committee' : 'student', canViewAllAttendance: token.committee === true || access.viewer === true, employeeId: user.employeeId || null, designation: user.designation || '', department: user.department || '', team: user.team || '' });
const validId = id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id);

function createApp({ db, auth, config, now = Date.now }) {
    const app = express();
    app.disable('x-powered-by');
    if (config.trustProxy) app.set('trust proxy', config.trustProxy);
    if (config.allowedOrigins?.length) {
        app.use(cors({ origin: config.allowedOrigins, credentials: true }));
    }
    app.use(express.json({ limit: '16kb' }));
    app.use('/api', (req, res, next) => {
        if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.body !== undefined && (!req.body || typeof req.body !== 'object' || Array.isArray(req.body))) {
            return next(new HttpError(400, 'A JSON object request body is required.'));
        }
        if (req.body === undefined) req.body = {};
        next();
    });
    app.use('/api', (req, res, next) => {
        res.set('Cache-Control', 'no-store');
        res.set('X-Content-Type-Options', 'nosniff');
        next();
    });
    // Per-instance limiter; use a shared gateway limiter when running multiple replicas.
    const hits = new Map();
    function limit(key, maximum, windowMs = 60000) {
        const time = now();
        const current = hits.get(key);
        if (!current || current.until <= time) hits.set(key, { count: 1, until: time + windowMs });
        else if (++current.count > maximum) throw new HttpError(429, 'Too many attempts. Please wait a minute and try again.');
        if (hits.size > 10000) {
            for (const [id, hit] of hits) if (hit.until <= time) hits.delete(id);
            if (hits.size > 10000) throw new HttpError(503, 'Check-in is busy. Please try again shortly.');
        }
    }
    app.use('/api', asyncRoute(async (req, res, next) => { limit(`ip:${req.ip}`, 240); next(); }));

    const authenticate = asyncRoute(async (req, res, next) => {
        const match = /^Bearer ([^\s]+)$/.exec(req.headers.authorization || '');
        if (!match) throw new HttpError(401, 'Please sign in with your verified email.');
        try { req.identity = await auth.verifyIdToken(match[1], true); }
        catch { throw new HttpError(401, 'Your session has expired. Please sign in again.'); }
        if (!req.identity.email_verified || !req.identity.email || !validId(req.identity.uid)) throw new HttpError(403, 'Verify your email address before continuing.');
        const email = normalizeEmail(req.identity.email);
        const bootstrapped = await bootstrapHr({ identity: req.identity, db, auth, config, now });
        if (bootstrapped && req.identity.committee !== true) { const error = new HttpError(401, 'Refresh your signed session after HR access was granted.'); error.publicCode = 'TOKEN_REFRESH_REQUIRED'; throw error; }
        const approved = snapshotData(await db.collection('AllowedEmails').doc(email).get());
        req.viewer = await viewerAccess({ identity: req.identity, db, config, now });
        if (!approved && !req.viewer) { const error = new HttpError(403, 'HR approval is required before attendance access.'); error.publicCode = 'HR_APPROVAL_REQUIRED'; throw error; }
        if (approved && (approved.enabled !== true || (approved.uid && approved.uid !== req.identity.uid))) throw new HttpError(403, 'This email is not approved for attendance. Contact the committee.');
        req.viewerOnly = !approved;
        req.email = email;
        next();
    });
    const deviceBound = asyncRoute(async (req, res, next) => {
        const deviceToken = readDevice(req, config.cookieSecret);
        if (!deviceToken) throw new HttpError(403, 'Register this browser by signing in first.');
        const device = snapshotData(await db.collection('Devices').doc(digest(deviceToken)).get());
        const user = snapshotData(await db.collection('Users').doc(req.identity.uid).get());
        if (!device || device.uid !== req.identity.uid || device.email !== req.email || !user || user.email !== req.email) {
            throw new HttpError(403, 'This browser is linked to a different email or its binding was revoked. Contact the committee.');
        }
        req.user = profile(user, req.identity, req);
        next();
    });
    function committee(req, res, next) {
        if (req.identity.committee !== true) return next(new HttpError(403, 'Committee access is required.'));
        next();
    }
    const protectedRoute = [authenticate, deviceBound];
    const employeeAccount = (req, res, next) => req.viewerOnly ? next(new HttpError(403, 'This account has read-only attendance access. Employee approval is required for employee features.')) : next();
    const employeeRoute = [...protectedRoute, employeeAccount];
    const venueAccess = createVenueAccess({ db, config, now, limit });
    venueAccess.register(app, protectedRoute, asyncRoute);
    const interactiveRoute = [...employeeRoute, venueAccess.middleware];

    app.get('/.well-known/assetlinks.json', (req, res) => {
        const fingerprints = config.android?.fingerprints || [];
        res.json(fingerprints.length ? [{
            relation: ['delegate_permission/common.handle_all_urls', 'delegate_permission/common.get_login_creds'],
            target: { namespace: 'android_app', package_name: config.android.appId, sha256_cert_fingerprints: fingerprints }
        }] : []);
    });
    registerTrackingRoutes({ app, db, config, now, protectedRoute: employeeRoute, committee, asyncRoute, limit, venueAccess: venueAccess.middleware });
    registerBiometricRoutes({ app, db, config, now, protectedRoute: interactiveRoute, asyncRoute, limit });

    registerEmployeeRoutes({ app, db, auth, config, now, interactiveRoute, committee, asyncRoute, limit });

    app.get('/api/health', (req, res) => res.json({ status: 'ok', venueConfigured: config.venue.configured, deploymentCommit: config.deploymentCommit || null }));
    app.get('/api/venue', (req, res) => res.json(config.venue));
    app.post('/api/session', authenticate, asyncRoute(async (req, res) => {
        limit(`session:${req.identity.uid}`, 30);
        const oldToken = readDevice(req, config.cookieSecret);
        const deviceToken = oldToken || crypto.randomBytes(32).toString('hex');
        const deviceRef = db.collection('Devices').doc(digest(deviceToken));
        const userRef = db.collection('Users').doc(req.identity.uid);
        const approvedRef = db.collection('AllowedEmails').doc(req.email);
        let user;
        await db.runTransaction(async transaction => {
            const [deviceSnap, userSnap, approvedSnap, viewerSnap] = await Promise.all([transaction.get(deviceRef), transaction.get(userRef), transaction.get(approvedRef), transaction.get(db.collection('AttendanceViewers').doc(req.email))]);
            const device = snapshotData(deviceSnap);
            const existing = snapshotData(userSnap);
            const approved = snapshotData(approvedSnap);
            const grant = snapshotData(viewerSnap);
            if (approved ? approved.enabled !== true || (approved.uid && approved.uid !== req.identity.uid) : !(req.viewer && grant?.enabled === true && grant.uid === req.identity.uid)) throw new HttpError(403, 'Email registration is unavailable. Contact the committee.');
            if (oldToken && !device) throw new HttpError(403, 'This browser binding was revoked. Contact the committee.');
            if (device && (device.email !== req.email || device.uid !== req.identity.uid)) throw new HttpError(403, 'This browser is already linked to a different email. Use its original email.');
            if (existing && existing.email !== req.email) throw new HttpError(403, 'Account email changes require committee help.');
            user = existing || { uid: req.identity.uid, email: req.email, fullName: typeof req.identity.name === 'string' ? req.identity.name.slice(0, 120) : '', createdAt: new Date(now()).toISOString() };
            if (!existing) transaction.create(userRef, user);
            if (!device) transaction.create(deviceRef, { uid: req.identity.uid, email: req.email, createdAt: new Date(now()).toISOString() });
            if (approved) transaction.set(approvedRef, { uid: req.identity.uid }, { merge: true });
        });
        // Logout deliberately leaves this cookie in place. It is a browser binding, not an auth session.
        res.cookie('placement_device', `${deviceToken}.${hmac(deviceToken, config.cookieSecret)}`, {
            httpOnly: true, secure: config.production, sameSite: 'lax', maxAge: 365 * 24 * 60 * 60 * 1000, path: '/'
        });
        res.json({ user: profile(user, req.identity, req), venue: config.venue });
    }));
    app.get('/api/me', ...protectedRoute, (req, res) => res.json({ user: req.user, venue: config.venue }));
    app.get('/api/attendance-report', ...protectedRoute, venueAccess.middleware, asyncRoute(async (req, res) => {
        if (!req.user.canViewAllAttendance) throw new HttpError(403, 'Attendance viewer access is required.');
        if (Object.keys(req.query).some(key => !['date', 'eventId'].includes(key))) throw new HttpError(400, 'Choose a date and optional attendance session.');
        res.json(await attendanceReport({ db, date: req.query.date ?? indiaDate(now()), eventId: req.query.eventId, now }));
    }));
    app.get('/api/students', ...interactiveRoute, committee, asyncRoute(async (req, res) => {
        const [snapshot, approvals] = await Promise.all([db.collection('Users').get(), db.collection('AllowedEmails').get()]);
        const approved = new Map(approvals.docs.map(doc => [doc.id, doc.data()]));
        res.json(snapshot.docs.map(doc => {
            const user = doc.data(), access = approved.get(user.email);
            return { uid: doc.id, email: user.email, fullName: user.fullName || '', attendanceEligible: access?.enabled === true && access.uid === doc.id };
        }));
    }));
    app.get('/api/events', ...interactiveRoute, asyncRoute(async (req, res) => {
        const snapshot = await db.collection('Events').get();
        res.json(snapshot.docs.map(eventView).sort((a, b) => String(b.date).localeCompare(String(a.date))));
    }));
    app.post('/api/events', ...interactiveRoute, committee, asyncRoute(async (req, res) => {
        const { title, date, isMandatory = true } = req.body;
        if (typeof title !== 'string' || !title.trim() || title.length > 160 || typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date || typeof isMandatory !== 'boolean') throw new HttpError(400, 'Provide an event title, valid date and mandatory flag.');
        const event = { title: title.trim(), date, isMandatory, checkInOpen: false, createdBy: req.identity.uid, createdAt: new Date(now()).toISOString() };
        const ref = db.collection('Events').doc();
        await ref.set(event);
        res.status(201).json({ id: ref.id, ...event });
    }));
    app.patch('/api/events/:id', ...interactiveRoute, committee, asyncRoute(async (req, res) => {
        if (!validId(req.params.id) || typeof req.body.checkInOpen !== 'boolean') throw new HttpError(400, 'Provide a valid event and check-in status.');
        const ref = db.collection('Events').doc(req.params.id);
        await db.runTransaction(async transaction => {
            if (!(await transaction.get(ref)).exists) throw new HttpError(404, 'Event not found.');
            transaction.set(ref, { checkInOpen: req.body.checkInOpen, updatedBy: req.identity.uid }, { merge: true });
        });
        res.json({ success: true });
    }));
    app.post('/api/events/:id/room-code', ...interactiveRoute, committee, asyncRoute(async (req, res) => {
        if (!config.venue.requiresRoomCode) throw new HttpError(410, 'This attendance step is no longer used.');
        if (!validId(req.params.id)) throw new HttpError(400, 'Invalid event.');
        limit(`room:${req.identity.uid}`, 20);
        const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
        const expiresAt = now() + 60000;
        const eventRef = db.collection('Events').doc(req.params.id);
        await db.runTransaction(async transaction => {
            const event = snapshotData(await transaction.get(eventRef));
            checkEvent(event, now());
            transaction.set(db.collection('EventCheckinCodes').doc(req.params.id), { hash: hmac(`${req.params.id}:${code}`, config.cookieSecret), expiresAt, createdBy: req.identity.uid });
        });
        res.json({ code, expiresAt });
    }));
    app.post('/api/attendance', ...interactiveRoute, asyncRoute(async (req, res) => {
        limit(`checkin:${req.identity.uid}`, 15);
        const { eventId, location, roomCode } = req.body;
        if (!validId(eventId)) throw new HttpError(400, 'Select a valid event.');
        if ('email' in req.body || 'uid' in req.body || 'rollNumber' in req.body) throw new HttpError(400, 'You can only mark attendance for your signed-in account.');
        const wifi = checkAttendanceWifi(req.body.wifi, config.wifi, now(), req.ip);
        const locationRequired = config.venue.locationRequired !== false;
        const savedLocation = locationRequired ? checkLocation(location, config.venue, now()) : null;
        const eventRef = db.collection('Events').doc(eventId);
        const logRef = db.collection('AttendanceLogs').doc(digest(`${eventId}:${req.identity.uid}`));
        let attendance;
        let alreadyMarked = false;
        await db.runTransaction(async transaction => {
            const [eventSnap, logSnap, codeSnap, approvedSnap, deviceSnap] = await Promise.all([
                transaction.get(eventRef), transaction.get(logRef),
                transaction.get(db.collection('EventCheckinCodes').doc(eventId)),
                transaction.get(db.collection('AllowedEmails').doc(req.email)),
                transaction.get(db.collection('Devices').doc(digest(readDevice(req, config.cookieSecret))))
            ]);
            const approved = snapshotData(approvedSnap);
            const device = snapshotData(deviceSnap);
            if (!approved || approved.enabled !== true || approved.uid !== req.identity.uid || !device || device.uid !== req.identity.uid || device.email !== req.email) throw new HttpError(403, 'Your attendance access has been revoked.');
            checkEvent(snapshotData(eventSnap), now());
            if (logSnap.exists) { attendance = { id: logRef.id, ...logSnap.data() }; alreadyMarked = true; return; }
            const biometric = await readAttendanceProof(transaction, req, eventId, db, config, now);
            if (config.venue.requiresRoomCode) {
                const activeCode = snapshotData(codeSnap);
                if (typeof roomCode !== 'string' || !/^\d{6}$/.test(roomCode) || !activeCode || activeCode.expiresAt <= now() || !safeEqual(activeCode.hash, hmac(`${eventId}:${roomCode}`, config.cookieSecret))) throw new HttpError(403, 'Enter the current room code shown by the committee. Codes expire after 60 seconds.');
            }
            const record = { eventId, uid: req.identity.uid, email: req.email, timestamp: new Date(now()).toISOString(), location: savedLocation, method: 'self', attendanceMode: locationRequired ? 'onsite' : 'setup', locationVerified: locationRequired, venueAddress: savedLocation ? config.venue.address : null, ...(wifi ? { wifi } : {}), ...(biometric ? { verification: biometric.evidence } : {}) };
            if (biometric) transaction.set(biometric.ref, { used: true, usedAt: new Date(now()).toISOString() }, { merge: true });
            transaction.create(logRef, record);
            attendance = { id: logRef.id, ...record };
        });
        res.json({ success: true, alreadyMarked, attendance });
    }));
    app.post('/api/attendance/manual', ...interactiveRoute, committee, asyncRoute(async (req, res) => {
        const wifi = checkAttendanceWifi(req.body.wifi, config.wifi, now(), req.ip);
        const operatorLocation = config.wifi.required !== false ? checkLocation(req.body.location, config.venue, now()) : null;
        const { eventId, reason } = req.body;
        const email = normalizeEmail(req.body.email);
        if (!validId(eventId) || !/^[^\s/@]+@[^\s/@]+\.[^\s/@]+$/.test(email) || typeof reason !== 'string' || reason.trim().length < 5 || reason.length > 500) throw new HttpError(400, 'Select an event, registered email and a reason of 5–500 characters.');
        let alreadyMarked = false;
        await db.runTransaction(async transaction => {
            const [approvedSnap, eventSnap] = await Promise.all([transaction.get(db.collection('AllowedEmails').doc(email)), transaction.get(db.collection('Events').doc(eventId))]);
            const approved = snapshotData(approvedSnap);
            if (!approved || approved.enabled !== true || !approved.uid) throw new HttpError(400, 'The student must register with an approved email first.');
            if (!eventSnap.exists) throw new HttpError(404, 'Event not found.');
            const targetUser = snapshotData(await transaction.get(db.collection('Users').doc(approved.uid)));
            if (!targetUser || targetUser.email !== email) throw new HttpError(400, 'The student must complete registration first.');
            const ref = db.collection('AttendanceLogs').doc(digest(`${eventId}:${approved.uid}`));
            const existing = await transaction.get(ref);
            if (existing.exists) { alreadyMarked = true; return; }
            transaction.create(ref, { eventId, uid: approved.uid, email, method: 'committee', ...(operatorLocation ? { operatorLocation } : {}), attendanceMode: config.venue.locationRequired === false ? 'setup' : 'onsite', locationVerified: false, ...(wifi ? { wifi } : {}), markedBy: req.identity.uid, reason: reason.trim(), timestamp: new Date(now()).toISOString(), location: null });
        });
        res.json({ success: true, alreadyMarked });
    }));
    app.get('/api/attendance-summary', ...interactiveRoute, asyncRoute(async (req, res) => {
        const query = req.identity.committee === true ? db.collection('AttendanceLogs') : db.collection('AttendanceLogs').where('uid', '==', req.identity.uid);
        const [attendance, events] = await Promise.all([query.get(), db.collection('Events').get()]);
        res.json({ logs: attendance.docs.map(doc => ({ id: doc.id, ...doc.data() })), mandatoryCount: events.docs.filter(doc => doc.data().isMandatory !== false).length });
    }));
    app.use('/api', (req, res) => res.status(404).json({ error: 'API route not found.' }));
    app.use((error, req, res, next) => {
        if (res.headersSent) return next(error);
        const status = error instanceof HttpError ? error.status : error.type === 'entity.parse.failed' ? 400 : error.type === 'entity.too.large' ? 413 : 503;
        if (status === 503) console.error('Attendance service request failed:', error.code || error.name || 'UnknownError');
        res.status(status).json({ ...(error.publicCode ? { code: error.publicCode } : {}), error: error instanceof HttpError ? error.message : status === 400 ? 'Invalid JSON request.' : status === 413 ? 'Request is too large.' : 'The attendance service is unavailable. Please try again or contact the committee.' });
    });
    return app;
}

module.exports = { createApp };
