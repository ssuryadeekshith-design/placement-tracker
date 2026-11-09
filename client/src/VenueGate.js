import React, { useCallback, useEffect, useRef, useState } from 'react';
import { signOut } from 'firebase/auth';
import { auth } from './firebase';
import api from './api';
import { clearVenueAccess, setVenueLocation, setVenuePolicy, isSetupPolicy } from './venueAccess';

export function evaluateVenue(position, venue, now = Date.now()) {
  const c = position?.coords;
  if (!venue?.configured || !c || ![c.latitude, c.longitude, c.accuracy, position.timestamp].every(Number.isFinite)) return false;
  if (c.latitude < -90 || c.latitude > 90 || c.longitude < -180 || c.longitude > 180 || c.accuracy <= 0 || c.accuracy > venue.maxAccuracyMeters || now - position.timestamp > 15000 || position.timestamp > now + 5000) return false;
  const rad = v => v * Math.PI / 180;
  const a = Math.sin(rad(c.latitude - venue.latitude) / 2) ** 2 + Math.cos(rad(c.latitude)) * Math.cos(rad(venue.latitude)) * Math.sin(rad(c.longitude - venue.longitude) / 2) ** 2;
  const distance = 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
  return distance + c.accuracy <= venue.radiusMeters;
}

export default function VenueGate({ children }) {
  const [unlocked, setUnlocked] = useState(false);
  const [setup, setSetup] = useState(false);
  const setupMode = useRef(false);
  const [message, setMessage] = useState('Confirm your current location to unlock the attendance app at the venue.');
  const watch = useRef(null);
  const fix = useRef(null);
  const venue = useRef(null);
  const generation = useRef(0);
  const active = useRef(true);
  const beganAt = useRef(0);
  const lock = useCallback((reason) => {
    const hadLocation = Boolean(fix.current);
    fix.current = null; clearVenueAccess();
    if (hadLocation && auth?.currentUser?.emailVerified) api.post('/access/lock', {}).catch(() => {});
    if (active.current) { setUnlocked(false); setMessage(reason); }
  }, []);
  const stop = useCallback(() => {
    generation.current += 1;
    if (watch.current !== null) navigator.geolocation?.clearWatch(watch.current);
    watch.current = null;
  }, []);
  useEffect(() => {
    active.current = true;
    api.get('/venue').then(({ data }) => {
      if (!active.current) return;
      setVenuePolicy(data);
      if (isSetupPolicy(data)) {
        setupMode.current = true; setSetup(true); setUnlocked(true);
      }
    }).catch(() => {});
    const visibility = () => {
      if (setupMode.current) return;
      stop(); lock('The app is locked. Check your location again after returning to this window.');
    };
    const timer = setInterval(() => {
      if (fix.current && !evaluateVenue(fix.current, venue.current)) lock('Your location is stale or outside the venue. Get a fresh precise location to unlock.');
    }, 1000);
    const denied = () => { setupMode.current = false; setSetup(false); setVenuePolicy(null); lock('The server locked venue access. Get a new precise location and retry.'); };
    window.addEventListener('venue-access-locked', denied);
    document.addEventListener('visibilitychange', visibility);
    return () => { active.current = false; stop(); clearVenueAccess(); setVenuePolicy(null); clearInterval(timer); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('venue-access-locked', denied); };
  }, [lock, stop]);

  async function start() {
    stop(); lock('Checking the venue and waiting for a fresh precise location…');
    const current = generation.current;
    if (document.hidden) return;
    try {
      const { data } = await api.get('/venue');
      if (!active.current || current !== generation.current || document.hidden) return;
      setVenuePolicy(data);
      if (isSetupPolicy(data)) { setupMode.current = true; setSetup(true); setUnlocked(true); return; }
      setupMode.current = false; setSetup(false);
      if (!navigator.geolocation) throw new Error('This browser has no location support. Use a supported browser.');
      if (!data?.configured) throw new Error('The venue has not been configured by the administrator.');
      venue.current = data; beganAt.current = Date.now();
      watch.current = navigator.geolocation.watchPosition(position => {
        if (!active.current || current !== generation.current || document.hidden) return;
        if (position.timestamp < beganAt.current || !evaluateVenue(position, data)) {
          lock('Access is locked: you are outside the venue area, or your location is not fresh and accurate enough.'); return;
        }
        fix.current = position;
        setVenueLocation({ latitude: position.coords.latitude, longitude: position.coords.longitude, accuracyMeters: position.coords.accuracy, capturedAt: position.timestamp });
        setUnlocked(true); setMessage('Venue access is unlocked.');
      }, () => lock('Location is unavailable or permission was denied. Enable precise location and retry.'), { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 });
    } catch (error) { if (active.current && current === generation.current) setMessage(error.response?.data?.error || error.message || 'Venue access is unavailable.'); }
  }
  if (unlocked) return <>{setup && <div className="alert setup-global-notice" role="status">Temporary setup mode: venue, Wi-Fi and GPS are not checked. Attendance does not verify physical presence.</div>}{children}</>;
  return <main className="venue-lock"><section className="card auth-card">
    <p className="eyebrow">SHIKSHA VERTEX · BENGALURU</p><h1>App locked</h1>
    <p role="status">{message}</p>
    <p>Visit the venue at Srivari Arcade, NGR Layout, Roopena Agrahara, Bommanahalli, Bengaluru. A fresh precise position must be inside the configured 100 m venue area. GPS cannot identify the second floor.</p>
    <p className="field-help">By checking your location, you allow foreground location checks while this page is visible. Access checks do not save a location history. Attendance and daily Android tracking have separate consent. Leaving or hiding this page locks its main screens.</p>
    <button className="primary full-width" onClick={start}>Check venue location</button>
    <p><a href="https://maps.app.goo.gl/1t5uN5hefMxJEWKdA" target="_blank" rel="noreferrer">View venue on Maps</a></p>
    {auth?.currentUser && <><button className="secondary" onClick={async () => {
      try { await api.post('/tracking/stop', {}); setMessage('Location sharing stopped.'); } catch { setMessage('Could not reach the server. Use the Android tracking notification to stop collection on the phone.'); }
    }}>Stop location sharing</button><button className="text-button" onClick={() => signOut(auth).then(() => setMessage('Signed out. Venue access remains locked.')).catch(() => setMessage('Could not sign out. Please retry.'))}>Sign out</button></>}
  </section></main>;
}
