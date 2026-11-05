const admin = require('firebase-admin');
const fs = require('node:fs');
const path = require('node:path');

function initializeFirebase() {
    if (!admin.apps.length) {
        const legacyFile = path.join(__dirname, 'serviceAccountKey.json');
        // Prefer Application Default Credentials, including a host-mounted secret file.
        const credential = !process.env.GOOGLE_APPLICATION_CREDENTIALS && fs.existsSync(legacyFile)
            ? admin.credential.cert(require(legacyFile))
            : admin.credential.applicationDefault();
        admin.initializeApp({ credential, ...(process.env.GCLOUD_PROJECT ? { projectId: process.env.GCLOUD_PROJECT } : {}) });
    }
    return { db: admin.firestore(), auth: admin.auth() };
}

module.exports = { initializeFirebase };
