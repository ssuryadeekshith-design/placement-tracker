const test = require('node:test');
const assert = require('node:assert/strict');
const { employeeAuthStatus } = require('../employee-auth-status');
const employees = [{ employeeId: 'one', uid: 'verified', email: 'one@shikshavertex.in' }, { employeeId: 'two', uid: 'disabled' }, { employeeId: 'three', uid: 'missing' }, { employeeId: 'four' }];
test('directory auth badges use actual Admin results and never infer status from a UID link', async () => {
  const states = await employeeAuthStatus(employees, { getUsers: async identifiers => {
    assert.equal(identifiers.length, 3);
    return { users: [{ uid: 'verified', emailVerified: true, disabled: false, email: 'ONE@shikshavertex.in', customClaims: { committee: true }, tokensValidAfterTime: 'hidden' }, { uid: 'disabled', disabled: true, emailVerified: true }], notFound: [{ uid: 'missing' }] };
  } });
  assert.deepEqual(states.get('one'), { state: 'verified', checked: true, emailMatches: true });
  assert.equal(states.get('two').state, 'disabled'); assert.equal(states.get('three').state, 'missing'); assert.equal(states.get('four').state, 'unlinked');
  assert.equal(JSON.stringify([...states]).includes('customClaims'), false);
  const unavailable = await employeeAuthStatus(employees, { getUsers: async () => { throw Error('Unavailable'); } });
  assert.equal(unavailable.get('one').state, 'unknown'); assert.equal(unavailable.get('one').checked, false);
});
test('Auth lookup batches requests and omitted accounts stay unknown rather than missing or verified', async () => {
  const many = Array.from({ length: 205 }, (_, n) => ({ employeeId: String(n), uid: 'u' + n }));
  const sizes = [];
  const states = await employeeAuthStatus(many, { getUsers: async ids => { sizes.push(ids.length); return { users: [] }; } });
  assert.deepEqual(sizes, [100, 100, 5]); assert.equal(states.get('0').state, 'unknown');
});
