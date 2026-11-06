const { bootstrapHr } = require('./hr-bootstrap');
const { HttpError, normalizeEmail } = require('./security');
const data = snapshot => snapshot.exists ? snapshot.data() : null;
const idValid = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);

function registerEmployeeRoutes({ app, db, auth, config, now, interactiveRoute, committee, asyncRoute, limit }) {
    const applicant = asyncRoute(async (req, res, next) => {
        const match = /^Bearer ([^\s]+)$/.exec(req.headers.authorization || '');
        if (!match) throw new HttpError(401, 'Sign in and verify your work email first.');
        let identity;
        try { identity = await auth.verifyIdToken(match[1], true); } catch { throw new HttpError(401, 'Please sign in again.'); }
        if (!identity.email_verified || !idValid(identity.uid)) throw new HttpError(403, 'Verify your work email first.');
        const email = normalizeEmail(identity.email);
        if (!/^[^\s/@]+@shikshavertex\.in$/.test(email)) throw new HttpError(403, 'Use your verified @shikshavertex.in work email.');
        req.identity = identity; req.email = email; next();
    });
    app.get('/api/registration/status', applicant, asyncRoute(async (req, res) => {
        await bootstrapHr({ identity: req.identity, db, auth, config, now });
        const [allowedSnap, requestSnap] = await Promise.all([db.collection('AllowedEmails').doc(req.email).get(), db.collection('RegistrationRequests').doc(req.identity.uid).get()]);
        const allowed = data(allowedSnap); const request = data(requestSnap);
        const approved = allowed?.enabled === true && (!allowed.uid || allowed.uid === req.identity.uid);
        res.json({ approved, status: approved ? 'approved' : allowed ? 'access-unavailable' : request?.status || 'not-requested', requestedName: request?.fullName || '', reason: request?.reason || null });
    }));
    app.post('/api/registration/request', applicant, asyncRoute(async (req, res) => {
        limit(`registration:${req.identity.uid}`, 10);
        const fullName = req.body.fullName;
        if (typeof fullName !== 'string' || fullName.trim().length < 2 || fullName.length > 120) throw new HttpError(400, 'Enter your full name as it appears in the employee roster.');
        const ref = db.collection('RegistrationRequests').doc(req.identity.uid);
        let status;
        await db.runTransaction(async transaction => {
            const [allowedSnap, existingSnap] = await Promise.all([transaction.get(db.collection('AllowedEmails').doc(req.email)), transaction.get(ref)]);
            const allowed = data(allowedSnap); const existing = data(existingSnap);
            if (allowed && (allowed.enabled !== true || (allowed.uid && allowed.uid !== req.identity.uid))) throw new HttpError(403, 'Account access needs HR recovery. A new request cannot undo a revocation.');
            if (allowed?.enabled) { status = 'approved'; return; }
            if (existing) {
                if (existing.email !== req.email) throw new HttpError(403, 'Email changes need HR assistance.');
                status = existing.status; return;
            }
            status = 'pending';
            transaction.create(ref, { uid: req.identity.uid, email: req.email, fullName: fullName.trim(), status, requestedAt: new Date(now()).toISOString(), emailVerified: true });
        });
        res.json({ status });
    }));
    app.get('/api/employees', ...interactiveRoute, committee, asyncRoute(async (req, res) => {
        const snapshot = await db.collection('Employees').get();
        res.json(snapshot.docs.map(doc => ({ employeeId: doc.id, ...doc.data() })).sort((a, b) => a.fullName.localeCompare(b.fullName)));
    }));
    app.get('/api/registration-requests', ...interactiveRoute, committee, asyncRoute(async (req, res) => {
        const snapshot = await db.collection('RegistrationRequests').where('status', '==', 'pending').get();
        res.json(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }));
    app.post('/api/registration-requests/:uid/approve', ...interactiveRoute, committee, asyncRoute(async (req, res) => {
        const uid = req.params.uid; const employeeId = req.body.employeeId;
        if (!idValid(uid) || !/^SV\d{3}$/.test(employeeId || '')) throw new HttpError(400, 'Select a valid employee profile.');
        const ref = db.collection('RegistrationRequests').doc(uid);
        await db.runTransaction(async transaction => {
            const request = data(await transaction.get(ref));
            if (!request || request.status !== 'pending') throw new HttpError(409, 'This request is no longer pending.');
            const employeeRef = db.collection('Employees').doc(employeeId);
            const emailRef = db.collection('AllowedEmails').doc(request.email);
            const userRef = db.collection('Users').doc(uid);
            const [employeeSnap, allowedSnap, userSnap] = await Promise.all([transaction.get(employeeRef), transaction.get(emailRef), transaction.get(userRef)]);
            const employee = data(employeeSnap); const allowed = data(allowedSnap); const user = data(userSnap);
            if (!employee || employee.active !== true) throw new HttpError(400, 'Choose an active employee from the directory.');
            if ((employee.uid && employee.uid !== uid) || (employee.email && employee.email !== request.email) || (user?.employeeId && user.employeeId !== employeeId)) throw new HttpError(409, 'Employee identity is already linked. Verify the person before changing any binding.');
            if (allowed && (allowed.enabled !== true || (allowed.uid && allowed.uid !== uid))) throw new HttpError(409, 'Existing email access requires a separate recovery review.');
            const timestamp = new Date(now()).toISOString();
            transaction.set(emailRef, { email: request.email, uid, employeeId, enabled: true, approvedBy: req.identity.uid, approvedAt: timestamp }, { merge: true });
            transaction.set(employeeRef, { uid, email: request.email }, { merge: true });
            transaction.set(userRef, { uid, email: request.email, employeeId, fullName: employee.fullName, designation: employee.designation, department: employee.department, team: employee.team, ...(!user ? { createdAt: timestamp } : {}) }, { merge: true });
            transaction.set(ref, { status: 'approved', employeeId, reviewedBy: req.identity.uid, reviewedAt: timestamp }, { merge: true });
        });
        res.json({ approved: true });
    }));
    app.post('/api/registration-requests/:uid/reject', ...interactiveRoute, committee, asyncRoute(async (req, res) => {
        const { uid } = req.params; const { reason } = req.body;
        if (!idValid(uid) || typeof reason !== 'string' || reason.trim().length < 5 || reason.length > 300) throw new HttpError(400, 'A rejection reason of 5–300 characters is required.');
        const ref = db.collection('RegistrationRequests').doc(uid);
        await db.runTransaction(async transaction => {
            const request = data(await transaction.get(ref));
            if (!request || request.status !== 'pending') throw new HttpError(409, 'This request is no longer pending.');
            transaction.set(ref, { status: 'rejected', reason: reason.trim(), reviewedBy: req.identity.uid, reviewedAt: new Date(now()).toISOString() }, { merge: true });
        });
        res.json({ rejected: true });
    }));
}
module.exports = { registerEmployeeRoutes };
