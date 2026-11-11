const { HttpError, normalizeEmail, digest } = require('./security');

// Provision only the explicitly configured, verified mailbox once. No title or
// client-submitted role grants privileges. Completed bootstrap never regrants.
async function bootstrapHr({ identity, db, auth, config, now }) {
    const email = normalizeEmail(identity.email);
    const initialAdmin = Boolean(config.bootstrapHrEmail && email === config.bootstrapHrEmail);
    if (!initialAdmin && !(config.additionalHrAdminEmails || []).includes(email)) return;
    // Preserve the original administrator's existing one-time grant. Each new
    // owner-designated mailbox has its own state so it cannot replace that UID.
    const stateRef = db.collection('System').doc(initialAdmin ? 'initial-hr-admin' : `additional-hr-admin-${digest(email)}`);
    const stateSnap = await stateRef.get();
    if (stateSnap.exists && stateSnap.data().status === 'granted') return;
    if (!identity.email_verified) return;
    const account = await auth.getUser(identity.uid);
    if (account.disabled || !account.emailVerified || normalizeEmail(account.email) !== email) throw new HttpError(403, 'Verify the configured HR mailbox before administrative access.');
    const emailRef = db.collection('AllowedEmails').doc(email);
    const userRef = db.collection('Users').doc(identity.uid);
    let provision = false;
    await db.runTransaction(async transaction => {
        const [state, approved, user] = await Promise.all([transaction.get(stateRef), transaction.get(emailRef), transaction.get(userRef)]);
        if (state.exists) {
            const previous = state.data();
            if (previous.uid !== identity.uid || previous.email !== email) throw new HttpError(403, 'HR administrator recovery requires an authorized operator.');
            if (previous.status === 'granted') return;
        }
        if (approved.exists && (approved.data().enabled !== true || (approved.data().uid && approved.data().uid !== identity.uid))) throw new HttpError(403, 'Revoked or reassigned HR access cannot be bootstrapped.');
        if (user.exists && normalizeEmail(user.data().email) !== email) throw new HttpError(403, 'Existing account identity requires administrator recovery.');
        transaction.set(emailRef, { email, uid: identity.uid, enabled: true }, { merge: true });
        if (!user.exists) transaction.create(userRef, { uid: identity.uid, email, fullName: account.displayName || '', createdAt: new Date(now()).toISOString() });
        transaction.set(stateRef, { email, uid: identity.uid, status: 'pending' }, { merge: true });
        provision = true;
    });
    if (!provision) return;
    await auth.setCustomUserClaims(identity.uid, { ...(account.customClaims || {}), committee: true });
    await stateRef.set({ status: 'granted', grantedAt: new Date(now()).toISOString() }, { merge: true });
    return true;
}
module.exports = { bootstrapHr };
