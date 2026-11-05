const { initializeFirebase } = require('../firebase');
const { normalizeEmail } = require('../security');

async function grant() {
    const email = normalizeEmail(process.argv[2]);
    if (!email || !email.includes('@')) throw new Error('Usage: npm run committee:grant -- member@example.com');
    const { db, auth } = initializeFirebase();
    const approved = await db.collection('AllowedEmails').doc(email).get();
    if (!approved.exists || approved.data().enabled !== true) throw new Error('This email must be approved first.');
    const user = await auth.getUserByEmail(email);
    if (!user.emailVerified) throw new Error('This user must verify their email first.');
    await auth.setCustomUserClaims(user.uid, { ...user.customClaims, committee: true });
    console.log('Committee access granted. Sign out and back in to refresh access.');
}
grant().catch(error => { console.error(error.code ? 'Could not grant access. Check credentials and the registered email.' : error.message); process.exitCode = 1; });
