const emails = require('../allowed-emails.json');
const { initializeFirebase } = require('../firebase');

async function seedAllowedEmails(db) {
    for (const email of emails) {
        const ref = db.collection('AllowedEmails').doc(email);
        // Preserve disabled accounts, UID ownership, and other existing fields.
        await db.runTransaction(async transaction => {
            const existing = await transaction.get(ref);
            if (!existing.exists) transaction.create(ref, { email, enabled: true, createdAt: new Date().toISOString() });
        });
    }
}

if (require.main === module) {
    seedAllowedEmails(initializeFirebase().db)
        .then(() => { console.log(`Ensured ${emails.length} approved email records exist.`); process.exit(0); })
        .catch(() => { console.error('Could not seed emails. Check Firebase credentials, project and Firestore access.'); process.exit(1); });
}
module.exports = { seedAllowedEmails };
