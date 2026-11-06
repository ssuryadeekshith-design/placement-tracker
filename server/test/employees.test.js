const test = require('node:test');
const assert = require('node:assert/strict');
const roster = require('../employees.json');
const { seedEmployees } = require('../scripts/seed-employees');
const { bootstrapHr } = require('../hr-bootstrap');
const { createFakeFirestore } = require('./fake-firestore');

test('64 supplied profiles seed repeatedly without invented emails, app privileges or overwritten HR edits', async () => {
    assert.equal(roster.length, 64); assert.equal(new Set(roster.map(e => e.employeeId)).size, 64);
    assert.equal(roster[0].fullName, 'Arockia Joe Arnold');
    assert.equal(roster[63].fullName, 'Surya Deekshith Palakurthi');
    const db = createFakeFirestore(); await seedEmployees(db);
    await db.collection('Employees').doc('SV001').set({ email: 'verified@shikshavertex.in', uid: 'owner', active: false, team: 'HR corrected team' }, { merge: true });
    const before = db.dump(); await seedEmployees(db); assert.deepEqual(db.dump(), before);
    assert.equal(Object.keys(before).filter(k => k.startsWith('Employees/')).length, 64);
    assert.equal(Object.keys(before).some(k => k.startsWith('AllowedEmails/') || k.startsWith('Users/')), false);
    assert.ok(roster.every(e => e.email === null && !('role' in e)));
});

function hrFixture(initial = {}) {
    const db = createFakeFirestore(initial); let writes = 0;
    const account = { uid: 'hr', email: 'hr@shikshavertex.in', emailVerified: true, customClaims: { retained: true } };
    const auth = { getUser: async () => account, setCustomUserClaims: async (uid, claims) => { assert.equal(uid, 'hr'); assert.equal(claims.committee, true); assert.equal(claims.retained, true); writes++; } };
    const args = { identity: { uid: 'hr', email: account.email, email_verified: true }, db, auth, config: { bootstrapHrEmail: account.email }, now: () => Date.now() };
    return { args, db, account, writes: () => writes };
}
test('configured HR mailbox is provisioned once only after verified identity, preserving other claims', async () => {
    const f = hrFixture();
    await bootstrapHr({ ...f.args, identity: { uid: 'another', email: 'manager@shikshavertex.in', email_verified: true } }); assert.equal(f.writes(), 0);
    await bootstrapHr({ ...f.args, identity: { ...f.args.identity, email_verified: false } }); assert.equal(f.writes(), 0);
    await bootstrapHr(f.args); await bootstrapHr(f.args); assert.equal(f.writes(), 1);
    assert.equal(f.db.dump()['System/initial-hr-admin'].status, 'granted');
    assert.equal(f.db.dump()['AllowedEmails/hr@shikshavertex.in'].uid, 'hr');
});
test('bootstrap cannot resurrect revoked HR access or an unverified/disabled mailbox', async () => {
    const revoked = hrFixture({ 'AllowedEmails/hr@shikshavertex.in': { enabled: false, uid: 'hr' } });
    await assert.rejects(bootstrapHr(revoked.args), e => e.status === 403); assert.equal(revoked.writes(), 0);
    const unverified = hrFixture(); unverified.account.emailVerified = false;
    await assert.rejects(bootstrapHr(unverified.args), e => e.status === 403);
    const disabled = hrFixture(); disabled.account.disabled = true;
    await assert.rejects(bootstrapHr(disabled.args), e => e.status === 403);
});
