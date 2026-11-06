const path = require('node:path');
const fs = require('node:fs');
const express = require('express');
const { createApp } = require('./app');
const { loadConfig } = require('./config');
const { initializeFirebase } = require('./firebase');
const { seedEmployees } = require('./scripts/seed-employees');
const { seedAllowedEmails } = require('./scripts/seed-emails');
const { finalizeDailyReports } = require('./tracking');
const { indiaDate } = require('./security');

async function start() {
    const config = loadConfig();
    const { db, auth } = initializeFirebase();
    await seedAllowedEmails(db);
    await seedEmployees(db);
    const app = createApp({ db, auth, config });
    // One origin supports secure browser binding cookies and location over HTTPS.
    const build = path.join(__dirname, '../client/build');
    if (fs.existsSync(path.join(build, 'index.html'))) {
        app.use(express.static(build));
        app.get('/{*path}', (req, res) => res.sendFile(path.join(build, 'index.html')));
    }
    const server = app.listen(config.port, () => {
        console.log(`Placement Tracker listening on port ${config.port}. Venue configured: ${config.venue.configured}`);
    });
    // Final reports are created after 20:35 IST, with seven-day startup catch-up.
    // Idempotent writes allow an external scheduler or multiple replicas safely.
    const finished = new Set();
    let reporting = false;
    async function finalizeReports(catchUp = false) {
        if (reporting) return;
        reporting = true;
        try {
            for (let offset = catchUp ? 7 : 0; offset >= 0; offset--) {
                const date = indiaDate(Date.now() - offset * 86400000);
                if (finished.has(date)) continue;
                const result = await finalizeDailyReports({ db, config, now: Date.now, date });
                if (result.eligible && !result.truncated) finished.add(date);
            }
            if (finished.size > 10) finished.delete(finished.values().next().value);
        } catch { console.error('Daily report finalization unavailable; it will retry.'); }
        finally { reporting = false; }
    }
    void finalizeReports(true);
    const reportTimer = setInterval(() => { void finalizeReports(); }, 60000);
    reportTimer.unref();
    const stop = () => { clearInterval(reportTimer); server.close(() => process.exit(0)); };
    process.on('SIGTERM', stop);
    process.on('SIGINT', stop);
}

if (require.main === module) start().catch(() => {
    console.error('Startup failed. Check Firebase credentials, Firestore access and environment configuration.');
    process.exitCode = 1;
});
module.exports = { start };
