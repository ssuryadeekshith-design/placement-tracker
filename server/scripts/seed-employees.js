const employees = require('../employees.json');
const { initializeFirebase } = require('../firebase');

async function seedEmployees(db) {
    for (const employee of employees) {
        const ref = db.collection('Employees').doc(employee.employeeId);
        await db.runTransaction(async transaction => {
            const existing = await transaction.get(ref);
            // Never overwrite HR's profile edits, account binding or revocation.
            if (!existing.exists) transaction.create(ref, { ...employee, active: true, createdAt: new Date().toISOString() });
        });
    }
}
if (require.main === module) seedEmployees(initializeFirebase().db)
    .then(() => { console.log(`Ensured ${employees.length} employee profiles exist; no login permissions changed.`); process.exit(0); })
    .catch(() => { console.error('Employee seed failed. Check Firebase project and Firestore access.'); process.exit(1); });
module.exports = { seedEmployees };
