const { initializeFirebase } = require('../firebase');
const { loadConfig } = require('../config');
const { finalizeDailyReports } = require('../tracking');
const { indiaDate } = require('../security');

async function run() {
    const date = process.argv[2] || indiaDate(Date.now());
    const result = await finalizeDailyReports({ db: initializeFirebase().db, config: loadConfig(), now: Date.now, date });
    console.log(JSON.stringify(result));
    if (!result.eligible || result.truncated) process.exitCode = 1;
}
if (require.main === module) run().catch(() => {
    console.error('Could not finalize reports. Check the date, Firebase configuration and Firestore access.');
    process.exitCode = 1;
});
