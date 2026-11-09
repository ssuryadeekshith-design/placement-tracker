const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

function buildWeb({ env = process.env, run = execFileSync, write = fs.writeFileSync } = {}) {
    // Keep ordinary installs and tests offline. Render's npm ci must build both tiers.
    if (env.RENDER !== 'true') return { skipped: true };
    const keys = ['REACT_APP_FIREBASE_API_KEY', 'REACT_APP_FIREBASE_AUTH_DOMAIN', 'REACT_APP_FIREBASE_PROJECT_ID'];
    const supplied = keys.filter(key => Boolean(env[key]));
    if (supplied.length && supplied.length !== keys.length) throw new Error(`Firebase web overrides must set all three public values. Missing: ${keys.filter(key => !env[key]).join(', ')}`);
    const client = path.resolve(__dirname, '../../client');
    console.log('Building the attendance web interface for the Render service.');
    run('npm', ['ci', '--prefix', client], { stdio: 'inherit', env });
    run('npm', ['run', 'build', '--prefix', client], { stdio: 'inherit', env: { ...env, CI: 'true' } });
    const commit = /^[0-9a-f]{7,40}$/i.test(env.RENDER_GIT_COMMIT || '') ? env.RENDER_GIT_COMMIT : null;
    write(path.join(client, 'build/build-info.json'), `${JSON.stringify({ commit })}\n`);
    return { skipped: false, commit };
}
if (require.main === module) {
    try { buildWeb(); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { buildWeb };
