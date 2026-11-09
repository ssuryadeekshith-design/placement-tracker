const crypto = require('node:crypto');
const roster = require('./employees.json');
const { HttpError, normalizeEmail } = require('./security');
const normalizeName = value => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');

function validateEmailImport(body) {
    if (!Array.isArray(body?.employees) || !body.employees.length || body.employees.length > 100)
        throw new HttpError(400, 'Choose an employee email import containing 1–100 employees.');
    const ids = new Set(); const emails = new Set();
    return body.employees.map(row => {
        const known = roster.find(employee => employee.employeeId === row?.employeeId);
        const email = normalizeEmail(row?.email);
        if (!known || normalizeName(known.fullName) !== normalizeName(row.fullName) || !/^[^\s/@]+@shikshavertex\.in$/.test(email))
            throw new HttpError(400, 'Each entry needs a matching employee ID, full name and company email.');
        if (ids.has(row.employeeId) || emails.has(email)) throw new HttpError(400, 'The import contains duplicate employee IDs or emails.');
        ids.add(row.employeeId); emails.add(email);
        return { employeeId: row.employeeId, email };
    });
}

async function importEmployeeEmails({ db, body, actor, now = Date.now }) {
    const rows = validateEmailImport(body);
    const timestamp = new Date(now()).toISOString();
    const audit = db.collection('EmployeeEmailImports').doc(crypto.randomUUID());
    return db.runTransaction(async transaction => {
        // Read every known profile before writing so duplicate mailbox ownership
        // cannot be introduced, even by concurrent imports or HR approvals.
        const snapshots = await transaction.getAll(...roster.map(employee => db.collection('Employees').doc(employee.employeeId)));
        const existing = new Map(snapshots.filter(s => s.exists).map(s => [s.id, s.data()]));
        const changes = [];
        for (const row of rows) {
            const employee = existing.get(row.employeeId);
            if (!employee) throw new HttpError(409, `Directory profile ${row.employeeId} is missing. Refresh the directory before importing.`);
            if ((employee.email && normalizeEmail(employee.email) !== row.email) ||
                (employee.registrationEmail && normalizeEmail(employee.registrationEmail) !== row.email) ||
                [...existing].some(([id, other]) => id !== row.employeeId && [other.email, other.registrationEmail].some(email => email && normalizeEmail(email) === row.email)))
                throw new HttpError(409, `Email ownership conflicts with an existing profile (${row.employeeId}). No changes were saved; HR must review the binding.`);
            if (employee.registrationEmail !== row.email) changes.push(row);
        }
        for (const row of changes) transaction.set(db.collection('Employees').doc(row.employeeId), {
            registrationEmail: row.email, registrationEmailUpdatedAt: timestamp, registrationEmailUpdatedBy: actor,
        }, { merge: true });
        transaction.create(audit, { actor, timestamp, imported: changes.length, unchanged: rows.length - changes.length, employeeIds: rows.map(row => row.employeeId) });
        return { imported: changes.length, unchanged: rows.length - changes.length, approvalRequired: true };
    });
}
module.exports = { validateEmailImport, importEmployeeEmails };
