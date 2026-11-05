const crypto = require('node:crypto');
const { HttpError, digest, readDevice, checkLocation } = require('./security');

function createVenueAccess({ db, config, now = Date.now, limit = () => {} }) {
    const access = config.access || {};
    const required = access.required !== false;
    const leaseSeconds = access.leaseSeconds ?? 30;
    const maximumAge = access.maxLocationAgeMs ?? 15000;
    function clock() {
        const value = typeof now === 'function' ? now() : now;
        if (!Number.isFinite(value)) throw new HttpError(503, 'Venue access time could not be checked.');
        return value;
    }
    function binding(req) {
        const uid = req.identity?.uid;
        if (typeof uid !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(uid)) throw new HttpError(401, 'Sign in before unlocking venue access.');
        const token = readDevice(req, config.cookieSecret);
        if (!token) throw new HttpError(403, 'Register this browser or app before unlocking venue access.');
        const deviceId = digest(token);
        return { uid, deviceId, stateRef: db.collection('VenueAccessState').doc(digest(`${uid}:${deviceId}`)) };
    }
    function settingsReady() {
        if (!Number.isInteger(leaseSeconds) || leaseSeconds < 1 || leaseSeconds > 60 ||
            !Number.isInteger(maximumAge) || maximumAge < 1 || maximumAge > 60000 || !config.venue) {
            throw new HttpError(503, 'Venue access is not configured. Contact the administrator.');
        }
    }
    const data = snapshot => snapshot.exists ? snapshot.data() : null;

    // Keep only access state and timestamps. Coordinates are used for this check
    // and deliberately never written into either access collection.
    async function revoke(req) {
        const bound = binding(req);
        const time = clock();
        const candidate = req.body?.location?.capturedAt;
        const rejectedCapture = typeof candidate === 'number' && Number.isFinite(candidate) && candidate <= time + 5000 ? candidate : time;
        await db.runTransaction(async transaction => {
            const previous = data(await transaction.get(bound.stateRef));
            transaction.set(bound.stateRef, {
                uid: bound.uid, deviceId: bound.deviceId, currentTokenHash: null,
                revokedAt: time, lastRejectedCapturedAt: Math.max(previous?.lastRejectedCapturedAt || 0, rejectedCapture),
                expiresAtDate: new Date(time + 86400000),
            });
        });
    }

    function register(app, protectedRoute, asyncRoute) {
        app.post('/api/access/lock', ...protectedRoute, asyncRoute(async (req, res) => { await revoke(req); res.json({ locked: true }); }));
        app.post('/api/access/verify', ...protectedRoute, asyncRoute(async (req, res) => {
            const bound = binding(req);
            const time = clock();
            try {
                settingsReady();
                limit(`venue-access:${bound.uid}`, 30);
                if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) throw new HttpError(400, 'A fresh location is required to unlock the app.');
                if ('uid' in req.body || 'email' in req.body || 'deviceId' in req.body || 'inside' in req.body) throw new HttpError(400, 'Venue access is checked only for the signed-in account and its location.');
                const location = req.body.location;
                checkLocation(location, config.venue, time);
                if (location.capturedAt < time - maximumAge) throw new HttpError(403, 'Your venue location has expired. Get a fresh location to unlock the app.');
                const token = crypto.randomBytes(32).toString('hex');
                const tokenHash = digest(token);
                const expiresAt = Math.min(time + leaseSeconds * 1000, location.capturedAt + maximumAge);
                const record = { uid: bound.uid, deviceId: bound.deviceId, expiresAt, expiresAtDate: new Date(expiresAt), issuedAt: time };
                await db.runTransaction(async transaction => {
                    const previous = data(await transaction.get(bound.stateRef));
                    if (previous?.lastRejectedCapturedAt !== undefined && location.capturedAt <= previous.lastRejectedCapturedAt) {
                        throw new HttpError(403, 'A newer location is required after venue access was locked.');
                    }
                    transaction.create(db.collection('VenueAccessLeases').doc(tokenHash), record);
                    transaction.set(bound.stateRef, { ...record, currentTokenHash: tokenHash,
                        ...(previous?.lastRejectedCapturedAt !== undefined ? { lastRejectedCapturedAt: previous.lastRejectedCapturedAt } : {}),
                        expiresAtDate: new Date(time + 86400000) });
                });
                res.json({ token, expiresAt, venue: config.venue });
            } catch (error) {
                // Outside, inaccurate, stale or failed verification immediately
                // invalidates this account/profile's earlier lease.
                await revoke(req);
                throw error;
            }
        }));
    }

    function middleware(req, res, next) {
        if (!required) return next();
        Promise.resolve().then(async () => {
            settingsReady();
            const time = clock();
            const bound = binding(req);
            const token = req.headers['x-venue-access'];
            if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw new HttpError(403, 'The app is locked. Verify a fresh location at the venue to continue.');
            const tokenHash = digest(token);
            const [leaseSnapshot, stateSnapshot] = await Promise.all([
                db.collection('VenueAccessLeases').doc(tokenHash).get(), bound.stateRef.get(),
            ]);
            const lease = data(leaseSnapshot);
            const state = data(stateSnapshot);
            if (!lease || !state || !Number.isFinite(lease.expiresAt) || lease.expiresAt <= time ||
                lease.uid !== bound.uid || lease.deviceId !== bound.deviceId ||
                state.uid !== bound.uid || state.deviceId !== bound.deviceId || state.currentTokenHash !== tokenHash) {
                throw new HttpError(403, 'Venue access has expired or been locked. Get a fresh location at the venue.');
            }
            req.venueAccess = { expiresAt: lease.expiresAt };
            next();
        }).catch(next);
    }

    return { register, middleware, revoke };
}

module.exports = { createVenueAccess };
