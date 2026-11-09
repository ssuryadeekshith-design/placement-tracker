const variables = ['REACT_APP_FIREBASE_API_KEY', 'REACT_APP_FIREBASE_AUTH_DOMAIN', 'REACT_APP_FIREBASE_PROJECT_ID'];
let saved;
jest.mock('firebase/app', () => ({ initializeApp: jest.fn(() => ({ name: 'fixture' })) }));
jest.mock('firebase/auth', () => ({ getAuth: jest.fn(() => ({ fixture: true })) }));
beforeEach(() => { saved = variables.map(key => process.env[key]); variables.forEach(key => delete process.env[key]); jest.resetModules(); });
afterEach(() => variables.forEach((key, index) => { if (saved[index] === undefined) delete process.env[key]; else process.env[key] = saved[index]; }));

test('the hosted portal uses the supplied public Firebase project when no overrides exist', () => {
  const { firebaseConfigured } = require('./firebase');
  const { initializeApp } = require('firebase/app');
  expect(firebaseConfigured).toBe(true);
  expect(initializeApp).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'placementtracker-a1a87', authDomain: 'placementtracker-a1a87.firebaseapp.com' }));
});
test('partial overrides never mix an API key with a different project', () => {
  process.env.REACT_APP_FIREBASE_PROJECT_ID = 'another-project';
  const { firebaseConfigured } = require('./firebase');
  const { initializeApp } = require('firebase/app');
  expect(firebaseConfigured).toBe(false);
  expect(initializeApp).not.toHaveBeenCalled();
});
