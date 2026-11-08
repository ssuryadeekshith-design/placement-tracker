const { HttpError, normalizeEmail, indiaDate } = require('./security');
const data = snapshot => snapshot.exists ? snapshot.data() : null;

// Owner-selected mailboxes get viewing access only, after verified Firebase sign-in.
// Bind the grant to its first UID and preserve disabled grants/account revocations.
async function viewerAccess({ identity, db, config, now }) {
    const email = normalizeEmail(identity.email);
    if (!(config.attendanceViewerEmails || []).includes(email)) return false;
    const ref = db.collection('AttendanceViewers').doc(email);
    return db.runTransaction(async tx => {
        const [grantSnap, approvedSnap] = await Promise.all([tx.get(ref), tx.get(db.collection('AllowedEmails').doc(email))]);
        const grant = data(grantSnap), approved = data(approvedSnap);
        if ((grant && grant.uid !== identity.uid) ||
            (approved && (approved.enabled !== true || (approved.uid && approved.uid !== identity.uid)))) {
            throw new HttpError(403, 'This account requires administrator recovery.');
        }
        if (grant && grant.enabled !== true) return false;
        if (!grant) tx.create(ref, { email, uid: identity.uid, enabled: true, createdAt: new Date(now()).toISOString() });
        return true;
    });
}

async function attendanceReport({ db, date, eventId, now }) {
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date || date > indiaDate(now())) {
        throw new HttpError(400, 'Choose a valid date up to today, India time.');
    }
    if (eventId !== undefined && (typeof eventId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(eventId))) throw new HttpError(400, 'Choose a valid attendance session.');
    const [eventSnapshot, users, approved] = await Promise.all([
        db.collection('Events').where('date', '==', date).get(), db.collection('Users').get(), db.collection('AllowedEmails').get(),
    ]);
    const events = eventSnapshot.docs.map(d => ({ id: d.id, title: d.data().title, checkInOpen: d.data().checkInOpen === true }));
    if (eventId && !events.some(e => e.id === eventId)) throw new HttpError(400, 'The selected session is not on this date.');
    const selected = events.filter(e => !eventId || e.id === eventId);
    if (selected.length > 100) throw new HttpError(400, 'Too many sessions for one report. Select a session.');
    const logs = await Promise.all(selected.map(e => db.collection('AttendanceLogs').where('eventId', '==', e.id).get()));
    const profiles = new Map(users.docs.map(d => [d.id, d.data()]));
    const rows = new Map();
    function row(uid, email) {
        if (!rows.has(uid)) {
            const user = profiles.get(uid) || {};
            rows.set(uid, { name: user.fullName || '', email: user.email || email || '', employeeId: user.employeeId || '', department: user.department || '', team: user.team || '', status: 'not-marked', checkIns: [] });
        }
        return rows.get(uid);
    }
    for (const d of approved.docs) {
        const a = d.data(), user = profiles.get(a.uid);
        if (a.enabled === true && user && user.email === d.id) row(a.uid, d.id);
    }
    for (const group of logs) for (const d of group.docs) {
        const log = d.data();
        if (typeof log.uid !== 'string' || !log.uid) continue; // Never guess ownership of old roll-number records.
        const r = row(log.uid, log.email);
        r.status = 'marked';
        // Deliberately omit location coordinates, biometric proofs, device IDs and movement history.
        r.checkIns.push({ eventId: log.eventId, eventTitle: events.find(e => e.id === log.eventId)?.title || '', timestamp: log.timestamp, method: log.method, attendanceMode: log.attendanceMode || 'legacy', locationChecked: log.locationVerified === true,
            phoneVerified: log.verification?.method === 'passkey-user-verification',
            venueWifiObserved: log.wifi?.verification === 'native-client-observation' && log.wifi?.ssid === 'Shikshavertex_5G' });
    }
    const result = [...rows.values()].sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));
    for (const r of result) r.checkIns.sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
    const marked = result.filter(r => r.status === 'marked').length;
    return { date, events, rows: result, totals: { accounts: result.length, marked, notMarked: result.length - marked }, generatedAt: new Date(now()).toISOString() };
}

module.exports = { viewerAccess, attendanceReport };
