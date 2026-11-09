const test = require('node:test');
const assert = require('node:assert/strict');
const { buildWeb } = require('../scripts/render-web-build');

test('normal installs do not trigger a web dependency install or build', () => {
    const result = buildWeb({ env: {}, run: () => { throw Error('Unexpected install'); } });
    assert.equal(result.skipped, true);
});
test('partial explicit Firebase configuration fails before changing the hosted build', () => {
    assert.throws(() => buildWeb({ env: { RENDER: 'true', REACT_APP_FIREBASE_PROJECT_ID: 'another-project' }, run: () => { throw Error('Must not install'); } }), /must set all three/);
});
test('a failed web build cannot publish a success marker', () => {
    let calls = 0, marker = false;
    assert.throws(() => buildWeb({ env: { RENDER: 'true' }, run: () => { if (++calls === 2) throw Error('Compile failed'); }, write: () => { marker = true; } }), /Compile failed/);
    assert.equal(marker, false);
});
