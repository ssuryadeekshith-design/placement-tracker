const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const { once } = require('node:events');
const { isoCBOR } = require('@simplewebauthn/server/helpers');
const { registerBiometricRoutes, readAttendanceProof } = require('../biometrics');
const { createFakeFirestore } = require('./fake-firestore');
const { HttpError, hmac, digest } = require('../security');

const START = Date.parse('2026-11-04T06:00:00Z');
const b64 = value => Buffer.from(value).toString('base64url');
const sha256 = value => crypto.createHash('sha256').update(value).digest();
const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function authenticator() {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const jwk = publicKey.export({ format: 'jwk' });
    const id = crypto.randomBytes(32);
    const cose = isoCBOR.encode(new Map([[1, 2], [3, -7], [-1, 1], [-2, new Uint8Array(Buffer.from(jwk.x, 'base64url'))], [-3, new Uint8Array(Buffer.from(jwk.y, 'base64url'))]]));
    function data(options, type, origin) { return Buffer.from(JSON.stringify({ type, challenge: options.challenge, origin, crossOrigin: false })); }
    function header(rpID, flags, counter) {
        const count = Buffer.alloc(4); count.writeUInt32BE(counter);
        return Buffer.concat([sha256(rpID), Buffer.from([flags]), count]);
    }
    return {
        id: b64(id),
        register(options, { origin = 'https://attendance.example.org', uv = true } = {}) {
            const client = data(options, 'webauthn.create', origin);
            const len = Buffer.alloc(2); len.writeUInt16BE(id.length);
            const authData = Buffer.concat([header(options.rp.id, uv ? 0x45 : 0x41, 0), Buffer.alloc(16), len, id, Buffer.from(cose)]);
            const attestation = isoCBOR.encode(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', new Uint8Array(authData)]]));
            return { id: b64(id), rawId: b64(id), type: 'public-key', authenticatorAttachment: 'platform', clientExtensionResults: {}, response: { clientDataJSON: b64(client), attestationObject: b64(attestation), transports: ['internal'] } };
        },
        authenticate(options, { origin = 'https://attendance.example.org', uv = true, counter = 1, challenge } = {}) {
            const client = data({ ...options, ...(challenge ? { challenge } : {}) }, 'webauthn.get', origin);
            const authData = header(options.rpId, uv ? 0x05 : 0x01, counter);
            const signed = Buffer.concat([authData, sha256(client)]);
            return { id: b64(id), rawId: b64(id), type: 'public-key', authenticatorAttachment: 'platform', clientExtensionResults: {}, response: { clientDataJSON: b64(client), authenticatorData: b64(authData), signature: b64(crypto.sign('sha256', signed, privateKey)), userHandle: null } };
        },
    };
}

async function fixture(t, { configured = true } = {}) {
    let clock = START;
    const config = { cookieSecret: 'a'.repeat(64), biometrics: { required: true, configured, rpID: 'attendance.example.org', expectedOrigins: ['https://attendance.example.org'], rpName: 'Attendance' } };
    const db = createFakeFirestore({
        'Users/alice': { email: 'alice@example.org' }, 'Users/bob': { email: 'bob@example.org' },
        'Events/event': { checkInOpen: true, date: '2026-11-04' },
    });
    const cookies = {};
    for (const uid of ['alice', 'bob', 'second']) {
        const token = digest(uid);
        cookies[uid] = `placement_device=${token}.${hmac(token, config.cookieSecret)}`;
    }
    const app = express(); app.use(express.json());
    const protectedRoute = [(req, res, next) => {
        const uid = req.headers['x-user'] || 'alice';
        req.identity = { uid, email: `${uid}@example.org`, email_verified: true };
        req.email = req.identity.email; req.user = { fullName: uid };
        next();
    }];
    registerBiometricRoutes({ app, db, config, now: () => clock, protectedRoute, asyncRoute });
    app.use((error, req, res, next) => { res.status(error instanceof HttpError ? error.status : 500).json({ error: error.message }); });
    const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
    const base = `http://127.0.0.1:${server.address().port}/api/biometrics`;
    async function request(path = '', body, user = 'alice', cookie = cookies[user]) {
        const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'X-User': user, ...(cookie ? { Cookie: cookie } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
        return { status: response.status, data: await response.json() };
    }
    async function enroll(phone = authenticator()) {
        const begin = await request('/registration/options', {});
        assert.equal(begin.status, 200, JSON.stringify(begin.data));
        assert.equal(begin.data.options.authenticatorSelection.userVerification, 'required');
        const response = phone.register(begin.data.options);
        const finish = await request('/registration/verify', { challengeId: begin.data.challengeId, response });
        assert.equal(finish.status, 200, JSON.stringify(finish.data));
        return phone;
    }
    async function verify(phone, options = {}) {
        const begin = await request('/authentication/options', { eventId: 'event' });
        assert.equal(begin.status, 200, JSON.stringify(begin.data));
        const response = phone.authenticate(begin.data.options, options);
        return { ...await request('/authentication/verify', { challengeId: begin.data.challengeId, response }), payload: { challengeId: begin.data.challengeId, response } };
    }
    function proofRequest(proof, user = 'alice', cookie = cookies[user]) { return { identity: { uid: user }, body: { biometricProof: proof }, headers: { cookie } }; }
    return { db, config, request, enroll, verify, proofRequest, cookies, advance: ms => { clock += ms; }, now: () => clock };
}

test('passkey registration verifies real signed attestation and stores public keys without biometric templates', async t => {
    const f = await fixture(t);
    assert.deepEqual((await f.request()).data, { registered: false, required: true, configured: true, credentialCount: 0 });
    await f.enroll();
    assert.equal((await f.request()).data.registered, true);
    const record = Object.entries(f.db.dump()).find(([key]) => key.startsWith('BiometricCredentials/'))[1];
    assert.ok(record.publicKey); assert.equal(record.uid, 'alice'); assert.equal(record.counter, 0);
    assert.equal(JSON.stringify(record).includes('fingerprint'), false);
    assert.equal((await f.request('', undefined, 'alice', f.cookies.second)).data.registered, false);
});

test('registration rejects forged data, absent user verification, wrong origin, expired challenges and replay', async t => {
    const f = await fixture(t);
    for (const config of [{ uv: false }, { origin: 'https://attacker.example.org' }]) {
        const phone = authenticator(); const begin = await f.request('/registration/options', {});
        const result = await f.request('/registration/verify', { challengeId: begin.data.challengeId, response: phone.register(begin.data.options, config) });
        assert.equal(result.status, 403, JSON.stringify(result));
    }
    const phone = authenticator(); const begin = await f.request('/registration/options', {});
    const payload = { challengeId: begin.data.challengeId, response: phone.register(begin.data.options) };
    const forged = structuredClone(payload); forged.response.response.attestationObject = b64('forged');
    assert.equal((await f.request('/registration/verify', forged)).status, 403);
    assert.equal((await f.request('/registration/verify', payload)).status, 200);
    assert.equal((await f.request('/registration/verify', payload)).status, 403);
    const expired = await f.request('/registration/options', {});
    f.advance(5 * 60000 + 1);
    assert.equal((await f.request('/registration/verify', { challengeId: expired.data.challengeId, response: phone.register(expired.data.options) })).status, 403);
});

test('a real signed phone assertion mints an event and browser bound proof that is consumed exactly once', async t => {
    const f = await fixture(t); const phone = await f.enroll();
    const verified = await f.verify(phone);
    assert.equal(verified.status, 200, JSON.stringify(verified));
    const request = f.proofRequest(verified.data.proof);
    const proof = await f.db.runTransaction(async transaction => {
        const result = await readAttendanceProof(transaction, request, 'event', f.db, f.config, f.now());
        transaction.set(result.ref, { used: true }, { merge: true });
        return result;
    });
    assert.equal(proof.evidence.method, 'passkey-user-verification');
    assert.equal(proof.evidence.credentialId, phone.id);
    await assert.rejects(f.db.runTransaction(transaction => readAttendanceProof(transaction, request, 'event', f.db, f.config, f.now())), error => error.status === 403);
    assert.equal((await f.request('/authentication/verify', verified.payload)).status, 403);
});

test('authentication rejects wrong origin, challenge, UV flag, credential owner and unsigned biometric flags', async t => {
    const f = await fixture(t); const phone = await f.enroll();
    for (const changes of [{ origin: 'https://attacker.example.org' }, { challenge: b64('wrong-challenge') }, { uv: false }]) {
        const response = await f.verify(phone, changes);
        assert.equal(response.status, 403, JSON.stringify(response));
    }
    const begin = await f.request('/authentication/options', { eventId: 'event' });
    const payload = { challengeId: begin.data.challengeId, response: phone.authenticate(begin.data.options) };
    assert.equal((await f.request('/authentication/verify', payload, 'bob')).status, 403);
    assert.equal((await f.request('/authentication/verify', { biometric: true })).status, 400);
    await assert.rejects(f.db.runTransaction(transaction => readAttendanceProof(transaction, { ...f.proofRequest(undefined), body: { biometric: true } }, 'event', f.db, f.config, f.now())), error => error.status === 403);
});

test('proofs cannot move between account, browser or event, and expire after sixty seconds', async t => {
    const f = await fixture(t); const phone = await f.enroll(); const verification = await f.verify(phone);
    const proof = verification.data.proof;
    for (const [request, event] of [
        [f.proofRequest(proof, 'bob'), 'event'],
        [f.proofRequest(proof, 'alice', f.cookies.second), 'event'],
        [f.proofRequest(proof), 'another-event'],
    ]) {
        await assert.rejects(f.db.runTransaction(transaction => readAttendanceProof(transaction, request, event, f.db, f.config, f.now())), error => error.status === 403);
    }
    f.advance(60001);
    await assert.rejects(f.db.runTransaction(transaction => readAttendanceProof(transaction, f.proofRequest(proof), 'event', f.db, f.config, f.now())), error => error.status === 403);
});

test('production misconfiguration fails closed and credentials cannot register another account or browser', async t => {
    const f = await fixture(t, { configured: false });
    assert.equal((await f.request('/registration/options', {})).status, 503);
    await assert.rejects(f.db.runTransaction(transaction => readAttendanceProof(transaction, f.proofRequest('a'.repeat(64)), 'event', f.db, f.config, f.now())), error => error.status === 503);
    const g = await fixture(t); const phone = authenticator(); const begin = await g.request('/registration/options', {});
    const payload = { challengeId: begin.data.challengeId, response: phone.register(begin.data.options) };
    assert.equal((await g.request('/registration/verify', payload, 'bob')).status, 403);
    assert.equal((await g.request('/registration/verify', payload, 'alice', g.cookies.second)).status, 403);
});

test('credential IDs remain globally owned and revoked credentials cannot authorize attendance', async t => {
    const f = await fixture(t); const phone = await f.enroll();
    const bobBegin = await f.request('/registration/options', {}, 'bob');
    assert.equal(bobBegin.status, 200);
    const claim = await f.request('/registration/verify', { challengeId: bobBegin.data.challengeId, response: phone.register(bobBegin.data.options) }, 'bob');
    assert.equal(claim.status, 409);
    const verified = await f.verify(phone);
    assert.equal(verified.status, 200);
    await f.db.collection('BiometricCredentials').doc(digest(phone.id)).set({ active: false }, { merge: true });
    await assert.rejects(f.db.runTransaction(transaction => readAttendanceProof(transaction, f.proofRequest(verified.data.proof), 'event', f.db, f.config, f.now)), error => error.status === 403);
});

test('tampered signatures cannot mint a proof and proof expiry works with an injected clock function', async t => {
    const f = await fixture(t); const phone = await f.enroll();
    const begin = await f.request('/authentication/options', { eventId: 'event' });
    const response = phone.authenticate(begin.data.options); response.response.signature = b64('forged-signature');
    assert.equal((await f.request('/authentication/verify', { challengeId: begin.data.challengeId, response })).status, 403);
    assert.equal(Object.keys(f.db.dump()).filter(key => key.startsWith('BiometricProofs/')).length, 0);
    const verified = await f.verify(phone);
    assert.equal(verified.status, 200);
    f.advance(60001);
    await assert.rejects(f.db.runTransaction(transaction => readAttendanceProof(transaction, f.proofRequest(verified.data.proof), 'event', f.db, f.config, f.now)), error => error.status === 403);
});
