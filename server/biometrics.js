const crypto = require('node:crypto');
const webauthnDefault = require('@simplewebauthn/server');
const { HttpError, digest, readDevice, checkEvent } = require('./security');

const CHALLENGE_MS = 5 * 60000;
const PROOF_MS = 60000;
const base64Id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,2048}$/.test(value);
const snapshotData = snapshot => snapshot.exists ? snapshot.data() : null;

function biometricConfig(config) {
    const settings = config.biometrics || {};
    return { ...settings, required: settings.required !== false };
}
function deviceId(req, config) {
    const token = readDevice(req, config.cookieSecret);
    if (!token) throw new HttpError(403, 'Register this browser or app before setting up phone verification.');
    return digest(token);
}
function settingsReady(config) {
    const settings = biometricConfig(config);
    if (!settings.configured || !settings.rpID || !Array.isArray(settings.expectedOrigins) || !settings.expectedOrigins.length) {
        throw new HttpError(503, 'Phone verification is not configured for this deployment. Contact the administrator.');
    }
    return settings;
}
function assertChallenge(challenge, req, config, now, kind) {
    if (!challenge || challenge.kind !== kind || challenge.used || challenge.expiresAt <= now || challenge.uid !== req.identity.uid || challenge.deviceId !== deviceId(req, config)) {
        throw new HttpError(403, 'Phone verification expired or belongs to another session. Start again.');
    }
}
function credentialRef(db, id) { return db.collection('BiometricCredentials').doc(digest(id)); }

// This consumes no biometric templates. It verifies a platform passkey's signed
// WebAuthn user-verification flag. The OS may use a fingerprint, face or device PIN.
function registerBiometricRoutes({ app, db, config, now = Date.now, protectedRoute, asyncRoute, limit = () => {}, webauthn = webauthnDefault }) {
    async function credentialsFor(req) {
        const currentDevice = deviceId(req, config);
        const snapshot = await db.collection('BiometricCredentials').where('uid', '==', req.identity.uid).get();
        return snapshot.docs.map(doc => doc.data()).filter(value => value.active !== false && value.deviceId === currentDevice);
    }
    app.get('/api/biometrics', ...protectedRoute, asyncRoute(async (req, res) => {
        const settings = biometricConfig(config);
        const credentials = await credentialsFor(req);
        res.json({ registered: credentials.length > 0, required: settings.required, configured: settings.configured === true, credentialCount: credentials.length });
    }));
    app.post('/api/biometrics/registration/options', ...protectedRoute, asyncRoute(async (req, res) => {
        const settings = settingsReady(config);
        limit(`biometric-enroll:${req.identity.uid}`, 10);
        const credentials = await credentialsFor(req);
        const userSnap = await db.collection('Users').doc(req.identity.uid).get();
        if ((userSnap.data()?.biometricCredentialCount || 0) >= 5) throw new HttpError(409, 'This account has reached its phone-verification credential limit. Contact the committee.');
        const options = await webauthn.generateRegistrationOptions({
            rpName: settings.rpName || 'Shiksha Vertex Attendance', rpID: settings.rpID,
            userName: req.email, userID: Buffer.from(digest(req.identity.uid), 'hex'),
            userDisplayName: req.user?.fullName || req.email,
            attestationType: 'none', timeout: 60000,
            authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'required', userVerification: 'required' },
            excludeCredentials: credentials.map(value => ({ id: value.id, transports: value.transports })),
            supportedAlgorithmIDs: [-7, -257],
        });
        const challengeId = crypto.randomBytes(24).toString('hex');
        await db.collection('BiometricChallenges').doc(challengeId).set({
            uid: req.identity.uid, deviceId: deviceId(req, config), kind: 'registration', challenge: options.challenge,
            expiresAt: now() + CHALLENGE_MS, expiresAtDate: new Date(now() + CHALLENGE_MS), used: false,
        });
        res.json({ challengeId, options });
    }));
    app.post('/api/biometrics/registration/verify', ...protectedRoute, asyncRoute(async (req, res) => {
        const settings = settingsReady(config);
        limit(`biometric-verify:${req.identity.uid}`, 15);
        const { challengeId, response } = req.body;
        if (!/^[a-f0-9]{48}$/.test(challengeId || '') || !response || !base64Id(response.id)) throw new HttpError(400, 'A valid phone registration response is required.');
        const challengeRef = db.collection('BiometricChallenges').doc(challengeId);
        const challenge = snapshotData(await challengeRef.get());
        assertChallenge(challenge, req, config, now(), 'registration');
        let result;
        try {
            result = await webauthn.verifyRegistrationResponse({ response, expectedChallenge: challenge.challenge, expectedOrigin: settings.expectedOrigins, expectedRPID: settings.rpID, requireUserVerification: true, requireUserPresence: true, supportedAlgorithmIDs: [-7, -257] });
        } catch { throw new HttpError(403, 'The phone registration signature could not be verified. Start again on this device.'); }
        if (!result.verified || !result.registrationInfo?.userVerified) throw new HttpError(403, 'The phone did not verify its user.');
        const info = result.registrationInfo;
        if (!base64Id(info.credential?.id) || info.credential.id !== response.id || !info.credential.publicKey?.length) throw new HttpError(403, 'Invalid phone credential.');
        const ref = credentialRef(db, info.credential.id);
        const userRef = db.collection('Users').doc(req.identity.uid);
        await db.runTransaction(async transaction => {
            const [latestChallenge, existingCredential, userSnap] = await Promise.all([transaction.get(challengeRef), transaction.get(ref), transaction.get(userRef)]);
            assertChallenge(snapshotData(latestChallenge), req, config, now(), 'registration');
            if (existingCredential.exists) throw new HttpError(409, 'This phone credential is already registered.');
            const user = snapshotData(userSnap);
            if (!user) throw new HttpError(403, 'Complete email registration before setting up phone verification.');
            const count = user.biometricCredentialCount || 0;
            if (count >= 5) throw new HttpError(409, 'Phone credential limit reached. Contact the committee.');
            transaction.create(ref, {
                id: info.credential.id, uid: req.identity.uid, deviceId: deviceId(req, config),
                publicKey: Buffer.from(info.credential.publicKey).toString('base64'), counter: info.credential.counter,
                transports: (info.credential.transports || response.response?.transports || []).filter(value => ['usb', 'ble', 'nfc', 'internal', 'hybrid', 'smart-card'].includes(value)),
                credentialDeviceType: info.credentialDeviceType, credentialBackedUp: info.credentialBackedUp,
                createdAt: new Date(now()).toISOString(), active: true,
            });
            transaction.set(userRef, { biometricCredentialCount: count + 1 }, { merge: true });
            transaction.set(challengeRef, { used: true }, { merge: true });
        });
        res.json({ verified: true });
    }));
    app.post('/api/biometrics/authentication/options', ...protectedRoute, asyncRoute(async (req, res) => {
        const settings = settingsReady(config);
        limit(`biometric-options:${req.identity.uid}`, 15);
        const { eventId } = req.body;
        if (typeof eventId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(eventId)) throw new HttpError(400, 'Select an attendance event.');
        const event = snapshotData(await db.collection('Events').doc(eventId).get());
        checkEvent(event, now());
        const credentials = await credentialsFor(req);
        if (!credentials.length) throw new HttpError(409, 'Set up phone verification in this browser or app first.');
        const options = await webauthn.generateAuthenticationOptions({ rpID: settings.rpID, userVerification: 'required', timeout: 60000, allowCredentials: credentials.map(value => ({ id: value.id, transports: value.transports })) });
        const challengeId = crypto.randomBytes(24).toString('hex');
        await db.collection('BiometricChallenges').doc(challengeId).set({
            uid: req.identity.uid, deviceId: deviceId(req, config), kind: 'authentication', challenge: options.challenge, eventId,
            expiresAt: now() + CHALLENGE_MS, expiresAtDate: new Date(now() + CHALLENGE_MS), used: false,
        });
        res.json({ challengeId, options });
    }));
    app.post('/api/biometrics/authentication/verify', ...protectedRoute, asyncRoute(async (req, res) => {
        const settings = settingsReady(config);
        limit(`biometric-verify:${req.identity.uid}`, 15);
        const { challengeId, response } = req.body;
        if (!/^[a-f0-9]{48}$/.test(challengeId || '') || !response || !base64Id(response.id)) throw new HttpError(400, 'A valid phone-verification response is required.');
        const challengeRef = db.collection('BiometricChallenges').doc(challengeId);
        const challenge = snapshotData(await challengeRef.get());
        assertChallenge(challenge, req, config, now(), 'authentication');
        const ref = credentialRef(db, response.id);
        const credential = snapshotData(await ref.get());
        if (!credential || credential.active !== true || credential.uid !== req.identity.uid || credential.deviceId !== deviceId(req, config)) throw new HttpError(403, 'This credential does not belong to the registered user and session.');
        let result;
        try {
            result = await webauthn.verifyAuthenticationResponse({
                response, expectedChallenge: challenge.challenge, expectedOrigin: settings.expectedOrigins, expectedRPID: settings.rpID,
                credential: { id: credential.id, publicKey: new Uint8Array(Buffer.from(credential.publicKey, 'base64')), counter: credential.counter, transports: credential.transports }, requireUserVerification: true,
            });
        } catch { throw new HttpError(403, 'The phone-verification signature could not be verified. Try again.'); }
        if (!result.verified || !result.authenticationInfo?.userVerified) throw new HttpError(403, 'The phone did not verify its user.');
        const proof = crypto.randomBytes(32).toString('hex');
        await db.runTransaction(async transaction => {
            const [latestChallenge, latestCredential] = await Promise.all([transaction.get(challengeRef), transaction.get(ref)]);
            assertChallenge(snapshotData(latestChallenge), req, config, now(), 'authentication');
            const current = snapshotData(latestCredential);
            if (!current || current.active !== true || current.counter !== credential.counter || current.uid !== req.identity.uid || current.deviceId !== deviceId(req, config)) throw new HttpError(409, 'Phone verification changed. Try again.');
            transaction.set(challengeRef, { used: true }, { merge: true });
            transaction.set(ref, { counter: result.authenticationInfo.newCounter, lastUsedAt: new Date(now()).toISOString() }, { merge: true });
            transaction.create(db.collection('BiometricProofs').doc(digest(proof)), {
                uid: req.identity.uid, deviceId: deviceId(req, config), eventId: challenge.eventId, credentialId: credential.id,
                verifiedAt: new Date(now()).toISOString(), expiresAt: now() + PROOF_MS, expiresAtDate: new Date(now() + PROOF_MS), used: false,
            });
        });
        res.json({ verified: true, proof, expiresAt: now() + PROOF_MS });
    }));
}

async function readAttendanceProof(transaction, req, eventId, db, config, now) {
    if (!biometricConfig(config).required) return null;
    settingsReady(config);
    const time = typeof now === 'function' ? now() : now;
    if (!Number.isFinite(time)) throw new HttpError(503, 'Phone verification time could not be checked.');
    const token = req.body.biometricProof;
    if (!/^[a-f0-9]{64}$/.test(token || '')) throw new HttpError(403, 'Verify with your phone before marking attendance.');
    const ref = db.collection('BiometricProofs').doc(digest(token));
    const record = snapshotData(await transaction.get(ref));
    const currentDevice = deviceId(req, config);
    if (!record || record.used || record.expiresAt <= time || record.uid !== req.identity.uid || record.deviceId !== currentDevice || record.eventId !== eventId) {
        throw new HttpError(403, 'Phone verification expired or was already used. Verify again.');
    }
    const credential = snapshotData(await transaction.get(credentialRef(db, record.credentialId)));
    if (!credential || credential.active !== true || credential.uid !== req.identity.uid || credential.deviceId !== currentDevice) throw new HttpError(403, 'Phone verification has been revoked. Contact the committee.');
    return { ref, evidence: { method: 'passkey-user-verification', credentialId: record.credentialId, verifiedAt: record.verifiedAt } };
}

module.exports = { registerBiometricRoutes, readAttendanceProof };
