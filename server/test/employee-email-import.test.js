const test = require('node:test');
const assert = require('node:assert/strict');
const { importEmployeeEmails, validateEmailImport } = require('../employee-email-import');
const { createFakeFirestore } = require('./fake-firestore');
const roster = require('../employees.json');
const body = () => ({ employees: [{ employeeId: 'SV001', fullName: roster[0].fullName, email: 'JOE.TEST@shikshavertex.in' }] });
const initial = () => Object.fromEntries(roster.map(row => [`Employees/${row.employeeId}`, { ...row, active: true }]));

test('email import is idempotent metadata only, preserves HR edits, links, omitted profiles and revocations', async () => {
    const db = createFakeFirestore({ ...initial(), 'Employees/SV001': { ...roster[0], team: 'HR corrected team', active: false, uid: 'existing', email: 'joe.test@shikshavertex.in' }, 'AllowedEmails/joe.test@shikshavertex.in': { enabled: false, uid: 'existing' } });
    const args = { db, body: body(), actor: 'hr', now: () => 1 };
    assert.equal((await importEmployeeEmails(args)).imported, 1);
    assert.equal((await importEmployeeEmails(args)).unchanged, 1);
    const data = db.dump(); const profile = data['Employees/SV001'];
    assert.equal(profile.registrationEmail, 'joe.test@shikshavertex.in');
    assert.equal(profile.uid, 'existing'); assert.equal(profile.active, false); assert.equal(profile.team, 'HR corrected team');
    assert.equal(data['AllowedEmails/joe.test@shikshavertex.in'].enabled, false);
    assert.deepEqual(data['Employees/SV058'], initial()['Employees/SV058']);
    assert.equal(Object.keys(data).some(key => key.startsWith('Users/')), false);
    assert.equal(Object.keys(data).filter(key => key.startsWith('EmployeeEmailImports/')).length, 2);
});
test('an ownership conflict rolls back the whole import instead of silently rebinding accounts', async () => {
    const data = initial(); data['Employees/SV002'].email = 'joe.test@shikshavertex.in';
    const db = createFakeFirestore(data); const before = db.dump();
    await assert.rejects(importEmployeeEmails({ db, body: body(), actor: 'hr' }), e => e.status === 409);
    assert.deepEqual(db.dump(), before);
    data['Employees/SV002'].email = null; data['Employees/SV001'].registrationEmail = 'other@shikshavertex.in';
    await assert.rejects(importEmployeeEmails({ db: createFakeFirestore(data), body: body(), actor: 'hr' }), e => e.status === 409);
});
test('malformed emails, mismatched identities, duplicates and empty imports are rejected', () => {
    const row = body().employees[0];
    for (const payload of [{}, { employees: [] }, { employees: [row, row] }, { employees: [{ ...row, fullName: 'Another person' }] }, { employees: [{ ...row, email: 'someone@example.com' }] }]) {
        assert.throws(() => validateEmailImport(payload), e => e.status === 400);
    }
});
