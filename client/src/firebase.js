import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import publicConfig from './firebase-public.json';

const suppliedConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
};

// This is public client metadata from the supplied Android Firebase configuration.
// An explicit partial override must fail closed rather than mix two projects.
const config = Object.values(suppliedConfig).some(Boolean) ? suppliedConfig : publicConfig;
let initializedAuth = null;
if (Object.values(config).every(Boolean)) {
  try { initializedAuth = getAuth(initializeApp(config)); }
  catch { /* Invalid deployment configuration should not crash the portal. */ }
}
export const auth = initializedAuth;
export const firebaseConfigured = Boolean(auth);
