import React, { useCallback, useEffect, useRef, useState } from 'react';
import AttendanceDashboard from './AttendanceDashboard';
import {
  createUserWithEmailAndPassword, onAuthStateChanged, reload,
  sendEmailVerification, sendPasswordResetEmail, signInWithEmailAndPassword, signOut,
} from 'firebase/auth';
import { CalendarDays, CheckCircle, LogOut, MapPin, ShieldCheck } from 'lucide-react';
import { auth, firebaseConfigured } from './firebase';
import api from './api';
import PhoneVerification, { useAttendanceVerification } from './PhoneVerification';
import DailyReport from './DailyReport';
import { EmployeeApplication, EmployeeAdministration } from './EmployeeRegistration';
import './App.css';
import VenueGate from './VenueGate';

const BINDING_KEY = 'placement-bound-email';
const ADDRESS = '2nd floor, Srivari Arcade, NGR Layout, Roopena Agrahara, Bommanahalli, Bengaluru, Karnataka 560068';
const MAPS_URL = 'https://maps.app.goo.gl/1t5uN5hefMxJEWKdA';

function rememberedEmail() {
  try { return localStorage.getItem(BINDING_KEY) || ''; } catch { return ''; }
}
function rememberEmail(email) {
  try { localStorage.setItem(BINDING_KEY, email); } catch { /* Server cookie enforces binding. */ }
}
function messageFor(error) {
  if (error.response?.data?.error) return error.response.data.error;
  const messages = {
    'auth/invalid-credential': 'The email or password is incorrect.',
    'auth/email-already-in-use': 'This email already has an account. Sign in instead.',
    'auth/weak-password': 'Choose a password with at least 6 characters.',
    'auth/invalid-email': 'Enter a valid email address.',
    'auth/too-many-requests': 'Too many attempts. Please wait and try again.',
    'auth/network-request-failed': 'Could not connect. Check your internet connection.',
  };
  return messages[error.code] || error.message || 'Something went wrong. Please try again.';
}
function displayDate(value) {
  if (!value) return '';
  const date = typeof value === 'object' && value._seconds ? new Date(value._seconds * 1000) : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
}

function Venue({ venue }) {
  return <section className="venue-banner" aria-label="Attendance venue">
    <MapPin size={22} aria-hidden="true" />
    <div><strong>Check in at the venue</strong><p>{venue?.address || ADDRESS}</p>
      <a href={venue?.mapsUrl || MAPS_URL} target="_blank" rel="noreferrer">View venue on Maps ↗</a>
    </div>
  </section>;
}

function CheckIn({ events, logs, venue, onRefresh, busy, setBusy, setError, setNotice }) {
  const [eventId, setEventId] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [consent, setConsent] = useState(false);
  const attended = new Set(logs.map(log => log.eventId));
  const available = events.filter(event => event.checkInOpen && !attended.has(event.id));
  const selected = available.find(event => event.id === eventId);
  const requiresRoomCode = venue?.requiresRoomCode !== false;
  const wifiRequired = venue?.attendanceWifi?.required === true;
  const locationRequired = venue?.locationRequired !== false;
  const verification = useAttendanceVerification({ setError, setNotice, setBusy });

  async function markAttendance(event) {
    event.preventDefault();
    if (!consent || !selected) return;
    if (wifiRequired) { setError(`Use the Android app while connected to ${venue.attendanceWifi.ssid}. This browser cannot verify the Wi-Fi name.`); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      const biometricProof = await verification.verify(eventId);
      let position = null;
      if (locationRequired) {
        if (!navigator.geolocation) throw new Error('Location is unavailable in this browser. Use a browser with location support.');
        position = await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject,
          { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 }));
      }
      await api.post('/attendance', {
        eventId,
        ...(position ? { location: {
          latitude: position.coords.latitude, longitude: position.coords.longitude,
          accuracyMeters: position.coords.accuracy, capturedAt: position.timestamp,
        } } : {}),
        ...(requiresRoomCode ? { roomCode: roomCode.trim() } : {}),
        ...(biometricProof ? { biometricProof } : {}),
      });
      setNotice('Attendance recorded successfully.');
      setConsent(false); setRoomCode(''); setEventId('');
      await onRefresh();
    } catch (error) {
      const locationErrors = {
        1: 'Location permission was denied. Allow location access in your browser settings, then try again.',
        2: 'Your location could not be determined. Move near a window and try again.',
        3: 'Location lookup timed out. Check your location settings and try again.',
      };
      setError(locationErrors[error.code] || messageFor(error));
    } finally { setBusy(false); }
  }

  return <section className="card check-in-card">
    <div className="section-heading"><div className="icon-box"><MapPin size={24} aria-hidden="true" /></div>
      <div><h2>Mark your attendance</h2><p>{locationRequired ? 'Be at the venue before checking in.' : 'Setup mode: self check-in without location verification.'}</p></div></div>
    {locationRequired && !venue?.configured && <p className="callout">Self check-in is unavailable until the venue location has been configured by the administrator.</p>}
    {wifiRequired && <p className="callout">Attendance requires Wi-Fi <strong>{venue.attendanceWifi.ssid}</strong>. Use the Android app to mark attendance; this browser cannot verify the connected network name.</p>}
    <PhoneVerification verification={verification} busy={busy} />
    <form onSubmit={markAttendance}>
      <label htmlFor="event">Event</label>
      <select id="event" value={eventId} onChange={event => setEventId(event.target.value)} required disabled={busy}>
        <option value="">{available.length ? 'Choose an open event' : 'No open events to check into'}</option>
        {available.map(event => <option key={event.id} value={event.id}>{event.title} · {event.date}</option>)}
      </select>
      {requiresRoomCode && <><label htmlFor="room-code">Room code</label>
        <input id="room-code" value={roomCode} onChange={event => setRoomCode(event.target.value)}
          inputMode="numeric" autoComplete="off" placeholder="Code displayed inside the room" required disabled={busy} />
        <p className="field-help">Ask the committee for the current code on the second floor. Codes expire after 60 seconds.</p></>}
      <label className="checkbox consent"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} disabled={busy} />
        <span>{locationRequired ? 'I agree to share and store my location for this check-in. The app records my coordinates, accuracy, and check-in time only when I press the button below.' : 'I confirm I am marking my own attendance. This setup check-in does not verify my physical location.'}</span></label>
      <button className="primary full-width" type="submit" disabled={busy || wifiRequired || !consent || !selected || (locationRequired && !venue?.configured) || !verification.ready}>
        <MapPin size={18} aria-hidden="true" /> {busy ? 'Recording attendance…' : locationRequired ? 'Check location & mark attendance' : 'Mark attendance'}
      </button>
    </form>
    {locationRequired && <p className="field-help">Location requires HTTPS (or localhost during development). Your browser will ask for permission. GPS checks proximity to the building; it cannot reliably identify a floor or prevent a spoofed location.</p>}
  </section>;
}

function Committee({ events, logs, venue, onRefresh, busy, setBusy, setError, setNotice }) {
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [isMandatory, setMandatory] = useState(true);
  const [codes, setCodes] = useState({});
  const [students, setStudents] = useState([]);
  const [manual, setManual] = useState({ eventId: '', email: '', reason: '' });
  useEffect(() => {
    let active = true;
    api.get('/students').then(({ data }) => { if (active) setStudents(data); }).catch(failure => { if (active) setError(messageFor(failure)); });
    return () => { active = false; };
  }, [setError]);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  async function run(action) {
    setBusy(true); setError(''); setNotice('');
    try { await action(); } catch (error) { setError(messageFor(error)); } finally { setBusy(false); }
  }
  function create(event) {
    event.preventDefault();
    run(async () => {
      await api.post('/events', { title: title.trim(), date, isMandatory });
      setTitle(''); setDate(''); setNotice('Event created. Open check-in when you are ready.'); await onRefresh();
    });
  }
  return <section className="card committee-card">
    <div className="section-heading"><div className="icon-box"><ShieldCheck aria-hidden="true" /></div><div><h2>Committee controls</h2><p>Manage events and display a code inside the room.</p></div></div>
    <form onSubmit={create} className="event-form">
      <label htmlFor="title">Event title</label><input id="title" value={title} onChange={event => setTitle(event.target.value)} required maxLength={160} disabled={busy} />
      <label htmlFor="date">Event date</label><input id="date" type="date" value={date} onChange={event => setDate(event.target.value)} required disabled={busy} />
      <label className="checkbox"><input type="checkbox" checked={isMandatory} onChange={event => setMandatory(event.target.checked)} disabled={busy} />Mandatory event</label>
      <button className="primary" type="submit" disabled={busy}>Create event</button>
    </form>
    <div className="event-controls">{events.map(event => {
      const code = codes[event.id];
      const seconds = code ? Math.max(0, Math.ceil((new Date(code.expiresAt).getTime() - now) / 1000)) : 0;
      return <article key={event.id} className="event-row"><div><strong>{event.title}</strong><p>{event.date} · {event.checkInOpen ? 'Check-in open' : 'Check-in closed'}</p></div>
        <div className="button-row">
          <button type="button" className="secondary" disabled={busy} onClick={() => run(async () => { await api.patch(`/events/${event.id}`, { checkInOpen: !event.checkInOpen }); await onRefresh(); })}>
            {event.checkInOpen ? 'Close check-in' : 'Open check-in'}</button>
          {event.checkInOpen && <button type="button" className="primary" disabled={busy} onClick={() => run(async () => { const { data } = await api.post(`/events/${event.id}/room-code`); setNow(Date.now()); setCodes(previous => ({ ...previous, [event.id]: data })); })}>Generate room code</button>}
        </div>
        {event.checkInOpen && code && <div className="room-code" aria-live="polite">{seconds ? <><strong>{code.code}</strong><span>Expires in {seconds}s · display inside the room</span></> : <span>Code expired. Generate a new code.</span>}</div>}
      </article>;
    })}</div>
    {venue?.attendanceWifi?.required ? <p className="callout">Browser committee overrides are unavailable while Wi-Fi attendance is required. The Wi-Fi rule also applies to committee submissions.</p> : <details className="manual-override"><summary>Committee attendance override</summary>
      <p className="field-help">Use only when a student cannot check in themselves. This bypasses location and room-code checks; your identity and reason will be recorded.</p>
      <form className="event-form" onSubmit={event => { event.preventDefault(); run(async () => {
        await api.post('/attendance/manual', manual); setNotice('Committee attendance override recorded.');
        setManual({ eventId: '', email: '', reason: '' }); await onRefresh();
      }); }}>
        <label htmlFor="manual-event">Override event</label><select id="manual-event" required value={manual.eventId} onChange={event => setManual(previous => ({ ...previous, eventId: event.target.value }))} disabled={busy}><option value="">Select an event</option>{events.map(event => <option key={event.id} value={event.id}>{event.title}</option>)}</select>
        <label htmlFor="manual-student">Registered student</label><select id="manual-student" required value={manual.email} onChange={event => setManual(previous => ({ ...previous, email: event.target.value }))} disabled={busy}><option value="">Select a registered email</option>{students.map(student => <option key={student.uid} value={student.email}>{student.email}</option>)}</select>
        <label htmlFor="manual-reason">Reason for override</label><input id="manual-reason" required minLength={5} maxLength={500} value={manual.reason} onChange={event => setManual(previous => ({ ...previous, reason: event.target.value }))} disabled={busy} />
        <button className="secondary full-width" type="submit" disabled={busy}>Record committee override</button>
      </form>
    </details>}
    <h3>Attendance records</h3>
    <p className="field-help">Location evidence is visible only to committee members and the attendee. A room code reduces remote check-ins but is not proof of a specific floor.</p>
    <History logs={logs} events={events} committee />
  </section>;
}

function History({ logs, events, committee = false }) {
  return !logs.length ? <p className="empty-state">No attendance recorded yet.</p> : <div className="history-list">{logs.map((log, index) => <article className="history-row" key={log.id || `${log.eventId}-${log.uid || index}`}>
    <CheckCircle size={20} aria-hidden="true" /><div><strong>{events.find(event => event.id === log.eventId)?.title || 'Event'}</strong>
      {committee && <p>{log.email || log.rollNumber || 'Attendee'}</p>}
      <p>{displayDate(log.timestamp)} · {['manual', 'committee'].includes(log.method) ? 'Committee override' : log.attendanceMode === 'setup' ? 'Self-reported attendance' : 'Present'}</p>
      {committee && log.reason && <p className="field-help">Override reason: {log.reason}</p>}
      {log.attendanceMode === 'setup' && <p className="field-help">Setup check-in · location not verified</p>}
      {log.location && <p className="field-help">Location: {log.location.latitude}, {log.location.longitude} · accuracy ±{Math.round(log.location.accuracyMeters)} m</p>}
    </div><span className="badge">Present</span>
  </article>)}</div>;
}

function AccountApp() {
  const [approvalRequired, setApprovalRequired] = useState(false);
  const [firebaseUser, setFirebaseUser] = useState(null);
  const [session, setSession] = useState(null);
  const [events, setEvents] = useState([]);
  const [summary, setSummary] = useState({ logs: [], mandatoryCount: 0 });
  const [authMode, setAuthMode] = useState('signin');
  const [email, setEmail] = useState(rememberedEmail);
  const [password, setPassword] = useState('');
  const [boundEmail, setBoundEmail] = useState(rememberedEmail);
  const [loading, setLoading] = useState(firebaseConfigured);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const sequence = useRef(0);

  const refresh = useCallback(async () => {
    const current = sequence.current;
    const [eventsResponse, summaryResponse] = await Promise.all([api.get('/events'), api.get('/attendance-summary')]);
    if (current === sequence.current) { setEvents(eventsResponse.data); setSummary(summaryResponse.data); }
  }, []);
  const establishSession = useCallback(async (user) => {
    const current = ++sequence.current;
    setApprovalRequired(false); setFirebaseUser(user); setSession(null); setEvents([]); setSummary({ logs: [], mandatoryCount: 0 });
    if (!user?.emailVerified) { setLoading(false); return; }
    setLoading(true); setError('');
    try {
      await user.getIdToken(true);
      let response;
      try { response = await api.post('/session'); } catch (failure) {
        if (failure.response?.data?.code !== 'TOKEN_REFRESH_REQUIRED') throw failure;
        await user.getIdToken(true); response = await api.post('/session');
      }
      const { data } = response;
      if (current !== sequence.current) return;
      rememberEmail(data.user.email); setBoundEmail(data.user.email);
      setSession(data);
      if (data.user.role !== 'attendance-viewer') await refresh();
    } catch (failure) { if (current === sequence.current) {
      if (failure.response?.data?.code === 'HR_APPROVAL_REQUIRED') { setApprovalRequired(true); setError(''); }
      else setError(messageFor(failure));
    } }
    finally { if (current === sequence.current) setLoading(false); }
  }, [refresh]);
  useEffect(() => {
    if (!firebaseConfigured) return undefined;
    const unsubscribe = onAuthStateChanged(auth, establishSession);
    return () => { sequence.current += 1; unsubscribe(); };
  }, [establishSession]);

  async function authenticate(event) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      if (authMode === 'register') {
        const result = await createUserWithEmailAndPassword(auth, email.trim(), password);
        await sendEmailVerification(result.user);
        setNotice('Verification email sent. Open it, then return here and select “I have verified my email”.');
      } else { await signInWithEmailAndPassword(auth, email.trim(), password); }
      setPassword('');
    } catch (failure) { setError(messageFor(failure)); }
    finally { setBusy(false); }
  }
  async function verifyAgain() {
    setBusy(true); setError(''); setNotice('');
    try {
      await reload(auth.currentUser);
      if (!auth.currentUser.emailVerified) setNotice('Your email is not verified yet. Open the verification link in your inbox first.');
      await establishSession(auth.currentUser);
    } catch (failure) { setError(messageFor(failure)); } finally { setBusy(false); }
  }
  async function logout() {
    setBusy(true); setError(''); setNotice('');
    try { await signOut(auth); } catch (failure) { setError(messageFor(failure)); } finally { setBusy(false); }
  }
  async function sendVerification() {
    setBusy(true); setError('');
    try { await sendEmailVerification(auth.currentUser); setNotice('Verification email sent. Check your inbox and spam folder.'); }
    catch (failure) { setError(messageFor(failure)); } finally { setBusy(false); }
  }
  async function resetPassword() {
    setBusy(true); setError('');
    try { await sendPasswordResetEmail(auth, email.trim()); setNotice('If this email has an account, a password reset link has been sent.'); }
    catch (failure) { setError(messageFor(failure)); } finally { setBusy(false); }
  }
  const retryApprovedSession = useCallback(() => establishSession(firebaseUser), [establishSession, firebaseUser]);
  const committee = session?.user.role === 'committee';
  const ownLogs = committee ? summary.logs.filter(log => log.uid === session?.user.uid) : summary.logs;
  return <div className="app-shell">
    <header className="app-header"><a className="brand" href="/" aria-label="TPAC Attendance home"><span className="brand-mark"><CheckCircle size={26} aria-hidden="true" /></span><span><strong>TPAC</strong><small>Attendance portal</small></span></a>
      {firebaseUser && <button type="button" className="header-button" onClick={logout} disabled={busy}><LogOut size={17} aria-hidden="true" /> Sign out</button>}
    </header>
    <main>
      <div className="page-intro"><p className="eyebrow">SHIKSHA VERTEX · BENGALURU</p><h1>{session ? `Welcome${session.user.fullName ? `, ${session.user.fullName}` : ''}` : 'Your presence counts.'}</h1><p>{session ? session.user.email : 'Verify your email, visit the venue, and check in for your event.'}</p></div>
      {error && <div className="alert error" role="alert">{error}</div>}
      {notice && <div className="alert success" role="status">{notice}</div>}
      {loading ? <section className="card auth-card" role="status">Loading your attendance portal…</section> : !firebaseConfigured ?
        <section className="card auth-card"><h2>Registration is not available yet</h2><p>The administrator needs to connect Firebase Authentication before anyone can register or sign in.</p><p className="field-help">Firebase web configuration is missing or invalid. See the deployment setup instructions.</p></section> : !firebaseUser ?
          <div className="auth-layout"><section className="card auth-card"><div className="icon-box"><ShieldCheck size={25} aria-hidden="true" /></div><h2>{authMode === 'register' ? 'Create your account' : 'Sign in to check in'}</h2><p>Use your Shiksha Vertex work email. New employee accounts need HR approval.</p>
            <div className="tabs" aria-label="Account action"><button type="button" className={authMode === 'signin' ? 'active' : ''} onClick={() => setAuthMode('signin')}>Sign in</button><button type="button" className={authMode === 'register' ? 'active' : ''} onClick={() => setAuthMode('register')}>Register</button></div>
            {boundEmail && <p className="callout">This browser was first registered to <strong>{boundEmail}</strong>. Signing out does not remove that binding.</p>}
            <form onSubmit={authenticate}><label htmlFor="email">Email address</label><input id="email" type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="you@shikshavertex.in" required disabled={busy} />
              <label htmlFor="password">Password</label><input id="password" type="password" autoComplete={authMode === 'register' ? 'new-password' : 'current-password'} value={password} onChange={event => setPassword(event.target.value)} minLength={6} required disabled={busy} />
              <button className="primary full-width" type="submit" disabled={busy}>{busy ? 'Please wait…' : authMode === 'register' ? 'Register & verify email' : 'Sign in'}</button>
            </form><button className="text-button" type="button" onClick={resetPassword} disabled={busy || !email.trim()}>Forgot your password?</button>
          </section><aside className="onboarding"><Venue /><h2>A simple, verified check-in</h2><ol><li><strong>Register with your email</strong><span>Verify ownership using the link sent to your inbox.</span></li><li><strong>Use your own browser</strong><span>Your first verified account is bound to this browser profile.</span></li><li><strong>Check in at the venue</strong><span>Share a one-time location reading and enter the room code when required.</span></li></ol><p className="field-help">A website cannot permanently identify a physical device. Clearing browser storage, private browsing, or another browser can bypass a browser binding.</p></aside></div>
          : !firebaseUser.emailVerified ? <section className="card auth-card"><div className="icon-box"><ShieldCheck size={25} aria-hidden="true" /></div><h2>Verify your email</h2><p>Open the verification link sent to <strong>{firebaseUser.email}</strong> before registering this browser or marking attendance.</p><div className="stack"><button className="primary" type="button" onClick={verifyAgain} disabled={busy}>I have verified my email</button><button className="secondary" type="button" onClick={sendVerification} disabled={busy}>Resend verification email</button></div></section>
            : !session && approvalRequired ? <EmployeeApplication email={firebaseUser.email} onApproved={retryApprovedSession} />
              : !session ? <section className="card auth-card"><h2>Account access unavailable</h2><p>Your account could not be registered for attendance. Check the message above or contact the placement committee.</p><button className="secondary" onClick={() => establishSession(firebaseUser)} disabled={busy}>Try again</button></section>
              : <><Venue venue={session.venue} />{session.user.canViewAllAttendance && <AttendanceDashboard key={session.user.uid} />}{session.user.role !== 'attendance-viewer' && <><div className="dashboard"><CheckIn events={events} logs={ownLogs} venue={session.venue} onRefresh={refresh} busy={busy} setBusy={setBusy} setError={setError} setNotice={setNotice} />
                <section className="card"><div className="section-heading"><div className="icon-box"><CalendarDays aria-hidden="true" /></div><div><h2>{committee ? 'Recent attendance' : 'Your attendance'}</h2><p>{committee ? 'Committee view' : 'Your recorded event check-ins'}</p></div></div><History logs={ownLogs} events={events} /></section></div>
                <DailyReport key={session.user.uid} user={session.user} />
                {committee && <EmployeeAdministration />}
                {committee && <Committee venue={session.venue} events={events} logs={summary.logs} onRefresh={refresh} busy={busy} setBusy={setBusy} setError={setError} setNotice={setNotice} />}
                </>}
                <p className="privacy-note"><ShieldCheck size={17} aria-hidden="true" />This browser is registered to {session.user.email}. {session.venue?.locationRequired === false ? 'Setup check-ins do not collect or verify your location.' : 'This website checks location while open to keep venue access unlocked. A check-in saves its own location.'} Daily movement tracking requires separate consent in the Android app. Signing out keeps the browser binding.</p></>}
    </main><footer>TPAC · Shiksha Vertex Attendance</footer>
  </div>;
}
export default function App() { return <VenueGate><AccountApp /></VenueGate>; }
