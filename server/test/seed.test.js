const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakeFirestore } = require('./fake-firestore');
const { seedAllowedEmails } = require('../scripts/seed-emails');

const APPROVED_EMAILS = [
  'supriti_m@shikshavertex.in',
  'cbhavitha@shikshavertex.in',
  'sudhamanaswini@shikshavertex.in',
  'jahnavi_m@shikshavertex.in',
  'punyatoya_n@shikshavertex.in',
  'pavanendra_r@shikshavertex.in',
  'sanjay_reddy@shikshavertex.in',
  'surya_deekshith@shikshavertex.in',
];

test('seed creates exactly the eight requested approved-email database records and is repeatable', async () => {
  const db = createFakeFirestore();
  await seedAllowedEmails(db);
  const initial = db.dump();
  assert.deepEqual(Object.keys(initial).sort(), APPROVED_EMAILS.map(email => `AllowedEmails/${email}`).sort());
  for (const email of APPROVED_EMAILS) {
    assert.equal(initial[`AllowedEmails/${email}`].email, email);
    assert.equal(initial[`AllowedEmails/${email}`].enabled, true);
  }
  await seedAllowedEmails(db);
  assert.deepEqual(db.dump(), initial);
});

test('seed preserves revocations, registered UID ownership and existing unrelated approved members', async () => {
  const protectedEmail = APPROVED_EMAILS[0];
  const existing = { email: protectedEmail, uid: 'verified-owner', enabled: false, createdAt: 'earlier', notes: 'Revoked by committee' };
  const db = createFakeFirestore({
    [`AllowedEmails/${protectedEmail}`]: existing,
    'AllowedEmails/other@example.org': { email: 'other@example.org', enabled: true, uid: 'other' },
  });
  await seedAllowedEmails(db);
  await seedAllowedEmails(db);
  assert.deepEqual(db.dump()[`AllowedEmails/${protectedEmail}`], existing);
  assert.deepEqual(db.dump()['AllowedEmails/other@example.org'], { email: 'other@example.org', enabled: true, uid: 'other' });
  assert.equal(Object.keys(db.dump()).length, 9);
});
