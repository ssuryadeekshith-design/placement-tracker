import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';

const config = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
};

let initializedAuth = null;
if (Object.values(config).every(Boolean)) {
  try { initializedAuth = getAuth(initializeApp(config)); }
  catch { /* Invalid deployment configuration should not crash the portal. */ }
}
export const auth = initializedAuth;
export const firebaseConfigured = Boolean(auth);
