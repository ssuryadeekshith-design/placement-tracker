import axios from 'axios';
import { auth } from './firebase';
import { ensureVenueAccess, currentVenueLocation, venueRevision, clearVenueAccess, isVenueRequired } from './venueAccess';

const api = axios.create({
  baseURL: process.env.REACT_APP_API_URL || '/api',
  withCredentials: true,
  timeout: 30000,
});

const exempt = new Set(['/registration/request', '/registration/status', '/venue', '/health', '/session', '/me', '/access/verify', '/access/lock', '/tracking/status', '/tracking/points', '/tracking/stop']);
const interactive = config => !exempt.has((config.url || '').split('?')[0]);

api.interceptors.request.use(async (config) => {
  if (auth?.currentUser) {
    config.headers.Authorization = `Bearer ${await auth.currentUser.getIdToken()}`;
  }
  if (interactive(config) && isVenueRequired()) {
    config.venueRevision = venueRevision();
    config.headers['X-Venue-Access'] = await ensureVenueAccess(api);
  }
  return config;
});

api.interceptors.response.use(response => {
  if (interactive(response.config) && isVenueRequired()) {
    currentVenueLocation();
    if (response.config.venueRevision !== venueRevision()) throw new Error('Venue access was locked.');
  }
  return response;
}, error => {
  const message = error.response?.data?.error || '';
  if (error.response?.status === 403 && (/venue access|venue location|app is locked|newer location/i.test(message) || error.config?.url === '/access/verify')) {
    clearVenueAccess(); window.dispatchEvent(new Event('venue-access-locked'));
  }
  return Promise.reject(error);
});

export default api;
