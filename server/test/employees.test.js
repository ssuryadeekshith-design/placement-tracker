const test = require('node:test');
const assert = require('node:assert/strict');
const roster = require('../employees.json');
const { seedEmployees } = require('../scripts/seed-employees');
const { bootstrapHr } = require('../hr-bootstrap');
const { createFakeFirestore } = require('./fake-firestore');
const { loadConfig } = require('../config');
const { digest } = require('../security');

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

function hrFixture(initial = {}, email = 'hr@shikshavertex.in', uid = 'hr') {
    const db = createFakeFirestore(initial); let writes = 0;
    const account = { uid, email, emailVerified: true, customClaims: { retained: true } };
    const auth = { getUser: async () => account, setCustomUserClaims: async (actualUid, claims) => { assert.equal(actualUid, uid); assert.equal(claims.committee, true); assert.equal(claims.retained, true); writes++; } };
    const args = { identity: { uid, email: account.email, email_verified: true }, db, auth, config: loadConfig({}), now: () => Date.now() };
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

test('owner-designated additional administrator receives the same claim without replacing the first administrator', async () => {
    const first = hrFixture(); await bootstrapHr(first.args);
    const before = first.db.dump()['System/initial-hr-admin'];
    const additional = hrFixture({}, 'hr_kowshik@shikshavertex.in', 'kowshik');
    additional.args.db = first.db;
    assert.equal(await bootstrapHr(additional.args), true);
    await bootstrapHr(additional.args); assert.equal(additional.writes(), 1);
    const records = first.db.dump();
    assert.deepEqual(records['System/initial-hr-admin'], before);
    assert.equal(records[`System/additional-hr-admin-${digest(additional.account.email)}`].uid, 'kowshik');
    assert.equal(records['AllowedEmails/hr_kowshik@shikshavertex.in'].uid, 'kowshik');
    assert.equal(records['AllowedEmails/hr@shikshavertex.in'].uid, 'hr');
    // A removed role or recreated identity is not silently granted again.
    additional.account.customClaims.committee = false;
    await bootstrapHr(additional.args); assert.equal(additional.writes(), 1);
    await bootstrapHr({ ...additional.args, identity: { ...additional.args.identity, uid: 'replacement' } });
    assert.equal(additional.writes(), 1);
});

test('additional HR authorization requires the exact verified enabled mailbox and preserves revoked access and bindings', async () => {
    const email = 'hr_kowshik@shikshavertex.in';
    for (const initial of [
        { [`AllowedEmails/${email}`]: { enabled: false, uid: 'kowshik' } },
        { [`AllowedEmails/${email}`]: { enabled: true, uid: 'someone-else' } },
        { 'Users/kowshik': { email: 'previous@shikshavertex.in' } },
    ]) {
        const f = hrFixture(initial, email, 'kowshik');
        await assert.rejects(bootstrapHr(f.args), e => e.status === 403);
        assert.deepEqual(f.db.dump(), initial); assert.equal(f.writes(), 0);
    }
    const unverified = hrFixture({}, email, 'kowshik');
    await bootstrapHr({ ...unverified.args, identity: { ...unverified.args.identity, email_verified: false } });
    assert.equal(unverified.writes(), 0);
    unverified.account.emailVerified = false;
    await assert.rejects(bootstrapHr(unverified.args), e => e.status === 403);
    const disabled = hrFixture({}, email, 'kowshik'); disabled.account.disabled = true;
    await assert.rejects(bootstrapHr(disabled.args), e => e.status === 403);
    const other = hrFixture({}, 'kowshik@shikshavertex.in', 'kowshik');
    await bootstrapHr(other.args); assert.equal(other.writes(), 0);
    assert.deepEqual(loadConfig({ HR_ADDITIONAL_ADMIN_EMAILS: '' }).additionalHrAdminEmails, []);
    assert.deepEqual(loadConfig({}).additionalHrAdminEmails, ['hr_kowshik@shikshavertex.in', 'surya_deekshith@shikshavertex.in']);
    assert.throws(() => loadConfig({ HR_ADDITIONAL_ADMIN_EMAILS: 'someone@example.com' }), /Invalid HR_ADDITIONAL_ADMIN_EMAILS/);
});
test('bootstrap cannot resurrect revoked HR access or an unverified/disabled mailbox', async () => {
    const revoked = hrFixture({ 'AllowedEmails/hr@shikshavertex.in': { enabled: false, uid: 'hr' } });
    await assert.rejects(bootstrapHr(revoked.args), e => e.status === 403); assert.equal(revoked.writes(), 0);
    const unverified = hrFixture(); unverified.account.emailVerified = false;
    await assert.rejects(bootstrapHr(unverified.args), e => e.status === 403);
    const disabled = hrFixture(); disabled.account.disabled = true;
    await assert.rejects(bootstrapHr(disabled.args), e => e.status === 403);
});
