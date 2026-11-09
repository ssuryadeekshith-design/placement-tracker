import React, { useCallback, useEffect, useRef, useState } from 'react';
import AttendanceDashboard from './AttendanceDashboard';
import History from './AttendanceHistory';
import Committee from './HrCommandCenter';
import {
  createUserWithEmailAndPassword, onAuthStateChanged, reload,
  sendEmailVerification, sendPasswordResetEmail, signInWithEmailAndPassword, signOut,
} from 'firebase/auth';
import { CalendarDays, CheckCircle, LogOut, MapPin, ShieldCheck, Mail, Eye, EyeOff } from 'lucide-react';
import { auth, firebaseConfigured } from './firebase';
import api from './api';
import PhoneVerification, { useAttendanceVerification } from './PhoneVerification';
import DailyReport from './DailyReport';
import { EmployeeApplication, EmployeeAdministration } from './EmployeeRegistration';
import './App.css';
import VenueGate from './VenueGate';
import { attendanceToday } from './attendanceReport';
import { hasAppleAttendance, markAppleAttendance } from './appleAttendance';

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
  if (['auth/invalid-credential', 'auth/wrong-password', 'auth/user-not-found'].includes(error.code)) return 'Email or password was not accepted. Register if this is your first time, or reset your app password.';
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
function Venue({ venue }) {
  return <section className="venue-banner" aria-label="Attendance venue">
    <MapPin size={22} aria-hidden="true" />
    <div><strong>Check in at the venue</strong><p>{venue?.address || ADDRESS}</p>
      <a href={venue?.mapsUrl || MAPS_URL} target="_blank" rel="noreferrer">View venue on Maps ↗</a>
    </div>
  </section>;
}

function CheckIn({ events, logs, venue, employeeUid, onRecorded, onRefresh, busy, setBusy, setError, setNotice }) {
  const [eventId, setEventId] = useState('');
  const [consent, setConsent] = useState(false);
  const [refreshRequired, setRefreshRequired] = useState(false);
  const mounted = useRef(true); const submitting = useRef(false);
  const [day, setDay] = useState(attendanceToday);
  useEffect(() => { mounted.current = true; const timer = setInterval(() => setDay(attendanceToday()), 1000); return () => { mounted.current = false; clearInterval(timer); }; }, []);
  const attended = new Set(logs.map(log => log.eventId));
  const available = events.filter(event => event.checkInOpen === true && event.date === day && !attended.has(event.id));
  const selected = available.find(event => event.id === eventId);
  const wifiRequired = !hasAppleAttendance();
  const locationRequired = true;
  const verification = useAttendanceVerification({ setError, setNotice, setBusy });

  async function markAttendance(event) {
    event.preventDefault();
    if (busy || submitting.current || refreshRequired || !consent || !selected) return;
    if (selected.date !== attendanceToday()) { setError('The India date changed. Refresh attendance before checking in.'); return; }
    if (wifiRequired) { setError(`Use the Android or iPhone app while connected to ${(venue?.attendanceWifi?.ssid || 'Shikshavertex_5G')}. This browser cannot confirm the office connection.`); return; }
    submitting.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const biometricProof = await verification.verify(eventId);
      if (!mounted.current) return;
      // Native code obtains fresh location + office-network observations and
      // submits once over a connection that cannot fall back to cellular data.
      const { data } = await markAppleAttendance(eventId, biometricProof);
      if (!mounted.current) return;
      const record = data?.attendance;
      if (data?.success !== true || !record || record.uid !== employeeUid || record.eventId !== eventId) throw new Error('The attendance result could not be confirmed. Refresh before trying again.');
      onRecorded(record);
      setNotice(data.alreadyMarked ? 'Attendance was already recorded. The original check-in is preserved.' : 'Attendance recorded successfully.');
      setConsent(false); setEventId('');
      try { await onRefresh(); } catch (failure) { if (mounted.current) { setRefreshRequired(true); setError(`Attendance saved, but current records could not refresh. The saved receipt is retained; refresh before another check-in. ${messageFor(failure)}`); } }
    } catch (error) {
      if (!mounted.current) return;
      const locationErrors = {
        1: 'Location permission was denied. Allow location access in your browser settings, then try again.',
        2: 'Your location could not be determined. Move near a window and try again.',
        3: 'Location lookup timed out. Check your location settings and try again.',
      };
      setError(locationErrors[error.code] || messageFor(error));
    } finally { submitting.current = false; if (mounted.current) setBusy(false); }
  }

  async function refreshRecords() {
    if (busy || submitting.current) return;
    submitting.current = true; setBusy(true); setError(''); setNotice(''); setRefreshRequired(true);
    try { await onRefresh(); if (mounted.current) { setRefreshRequired(false); setNotice('Attendance records refreshed.'); } }
    catch (failure) { if (mounted.current) setError(`Current attendance could not refresh. Check-in is unavailable until a successful refresh. ${messageFor(failure)}`); }
    finally { submitting.current = false; if (mounted.current) setBusy(false); }
  }

  return <section className="card check-in-card">
    <div className="section-heading"><div className="icon-box"><MapPin size={24} aria-hidden="true" /></div>
      <div><h2>Mark your attendance</h2><p>{locationRequired ? 'Be at the venue before checking in.' : 'Be at the venue before checking in.'}</p></div></div>
    {locationRequired && !venue?.configured && <p className="callout">Self check-in is unavailable until the venue location has been configured by the administrator.</p>}
    {wifiRequired && <p className="callout">Attendance requires the office connection <strong>{(venue?.attendanceWifi?.ssid || 'Shikshavertex_5G')}</strong>. Use the Android or iPhone app to mark attendance; this browser cannot verify the connected network name.</p>}
    {!wifiRequired && <p className="field-help">Your iPhone will request precise location when you check in. Be at the office and connected to {venue?.attendanceWifi?.ssid || 'Shikshavertex_5G'}.</p>}
    <PhoneVerification verification={verification} busy={busy} />
    <button type="button" className="secondary" disabled={busy} onClick={refreshRecords}>Refresh my attendance</button>
    {refreshRequired && <p className="callout">Refresh attendance before making another check-in. Any confirmed saved receipt remains in your history.</p>}
    <form onSubmit={markAttendance}>
      <label htmlFor="event">Event</label>
      <select id="event" value={eventId} onChange={event => setEventId(event.target.value)} required disabled={busy || refreshRequired}>
        <option value="">{refreshRequired ? 'Refresh attendance to choose a session' : available.length ? 'Choose an open event' : 'No open events to check into'}</option>
        {!refreshRequired && available.map(event => <option key={event.id} value={event.id}>{event.title} · {event.date}</option>)}
      </select>
      <label className="checkbox consent"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} disabled={busy} />
        <span>{locationRequired ? 'I agree to share and store my location for this check-in. The app records my coordinates, accuracy, and check-in time only when I press the button below.' : 'I confirm I am marking my own attendance. My venue presence is checked on submission.'}</span></label>
      <button className="primary full-width" type="submit" disabled={busy || refreshRequired || wifiRequired || !consent || !selected || (locationRequired && !venue?.configured) || !verification.ready}>
        <MapPin size={18} aria-hidden="true" /> {busy ? 'Recording attendance…' : locationRequired ? 'Check location & mark attendance' : 'Mark attendance'}
      </button>
    </form>
    {locationRequired && <p className="field-help">Location requires HTTPS (or localhost during development). Your browser will ask for permission. GPS checks proximity to the building; it cannot reliably identify a floor or prevent a spoofed location.</p>}
  </section>;
}

function AccountApp() {
  const [approvalRequired, setApprovalRequired] = useState(false);
  const [firebaseUser, setFirebaseUser] = useState(null);
  const [session, setSession] = useState(null);
  const [events, setEvents] = useState([]);
  const [reportRevision, setReportRevision] = useState(0);
  const [accountsRevision, setAccountsRevision] = useState(0);
  const [summary, setSummary] = useState({ logs: [], mandatoryCount: 0 });
  const [authMode, setAuthMode] = useState('signin');
  const [email, setEmail] = useState(rememberedEmail);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [resendUntil, setResendUntil] = useState(0);
  const [verificationNow, setVerificationNow] = useState(Date.now);
  const [boundEmail, setBoundEmail] = useState(rememberedEmail);
  const [loading, setLoading] = useState(firebaseConfigured);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const sequence = useRef(0); const refreshSequence = useRef(0);

  const refresh = useCallback(async () => {
    const current = sequence.current; const refreshId = ++refreshSequence.current;
    setReportRevision(value => value + 1);
    const [eventsResponse, summaryResponse] = await Promise.all([api.get('/events'), api.get('/attendance-summary')]);
    if (current !== sequence.current || refreshId !== refreshSequence.current) return;
    if (!Array.isArray(eventsResponse.data) || !Array.isArray(summaryResponse.data?.logs) || !Number.isInteger(summaryResponse.data?.mandatoryCount) || summaryResponse.data.mandatoryCount < 0) throw new Error('Current attendance data is incomplete. Refresh before continuing.');
    setEvents(eventsResponse.data); setSummary(summaryResponse.data);
  }, []);
  const recorded = useCallback(record => {
    setSummary(previous => ({ ...previous, logs: [record, ...previous.logs.filter(log => !(log.uid === record.uid && log.eventId === record.eventId))] }));
  }, []);
  const accountsChanged = useCallback(() => { setAccountsRevision(value => value + 1); setReportRevision(value => value + 1); }, []);
  const establishSession = useCallback(async (user) => {
    const current = ++sequence.current;
    setBusy(false); setApprovalRequired(false); setFirebaseUser(user); setSession(null); setEvents([]); setSummary({ logs: [], mandatoryCount: 0 });
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

  useEffect(() => {
    if (!resendUntil || !firebaseUser || firebaseUser.emailVerified) return undefined;
    const timer = setInterval(() => { const now = Date.now(); setVerificationNow(now); if (now >= resendUntil) clearInterval(timer); }, 1000);
    return () => clearInterval(timer);
  }, [resendUntil, firebaseUser]);
  const resendWait = Math.max(0, Math.ceil((resendUntil - verificationNow) / 1000));
  async function authenticate(event) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      if (authMode === 'register') {
        const result = await createUserWithEmailAndPassword(auth, email.trim(), password);
        await sendEmailVerification(result.user); setResendUntil(Date.now() + 60000); setVerificationNow(Date.now());
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
    try { if (resendWait) return; await sendEmailVerification(auth.currentUser); setResendUntil(Date.now() + 60000); setVerificationNow(Date.now()); setNotice('Verification email sent. Check your inbox and spam folder.'); }
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
    <header className="app-header"><a className="brand" href="/" aria-label="Shikshavertex Attendance home"><span className="brand-mark"><CheckCircle size={24} aria-hidden="true" /></span><span><strong>SHIKSHAVERTEX</strong><small>Employee workspace</small></span></a>
      <div className="header-actions">{session && <span className="role-badge">{committee ? 'HR administrator' : session.user.role === 'attendance-viewer' ? 'Attendance viewer' : 'Employee'}</span>}{firebaseUser && <button className="header-button" type="button" onClick={logout} disabled={busy}><LogOut size={16} aria-hidden="true" /> Sign out</button>}</div>
    </header>
    <main className="workspace-main">
      <div className="page-intro"><p className="eyebrow">PEOPLE & ATTENDANCE · BENGALURU</p><h1>{session ? `Welcome${session.user.fullName ? `, ${session.user.fullName}` : ''}` : 'Your workday, in one place.'}</h1><p>{session ? 'Attendance, account access and clearly labelled reports.' : 'Register with your work email, verify your identity and manage your attendance.'}</p></div>
      {error && <div className="alert error" role="alert">{error}</div>}
      {notice && <div className="alert success" role="status">{notice}</div>}
      {loading ? <section className="card auth-card loading-card" role="status"><span className="loading-dot" />Loading your attendance portal…</section> : !firebaseConfigured ?
        <section className="card auth-card"><h2>Registration is not available yet</h2><p>The administrator needs to connect Firebase Authentication before anyone can register or sign in.</p><p className="field-help">Firebase web configuration is missing or invalid. See the deployment setup instructions.</p></section> : !firebaseUser ?
          <div className="auth-layout"><section className="card auth-card"><div className="icon-box"><ShieldCheck size={25} aria-hidden="true" /></div><h2>{authMode === 'register' ? 'Create your account' : 'Sign in to check in'}</h2><p>Use your Shikshavertex work email and your attendance account password.</p>
            <div className="tabs" aria-label="Account action"><button type="button" className={authMode === 'signin' ? 'active' : ''} onClick={() => { setAuthMode('signin'); setPassword(''); }}>Sign in</button><button type="button" className={authMode === 'register' ? 'active' : ''} onClick={() => { setAuthMode('register'); setPassword(''); }}>Register</button></div>
            {authMode === 'register' && <p className="callout">Directory listing does not create a login. Register once with your work email. Employee access requires HR approval.</p>}
            {boundEmail && <p className="callout">This browser was first registered to <strong>{boundEmail}</strong>. Signing out does not remove that binding.</p>}
            <form onSubmit={authenticate}><label htmlFor="email">Email address</label><input id="email" type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="you@shikshavertex.in" required disabled={busy} />
              <label htmlFor="password">Password</label><div className="password-field"><input id="password" type={showPassword ? 'text' : 'password'} autoComplete={authMode === 'register' ? 'new-password' : 'current-password'} value={password} onChange={event => setPassword(event.target.value)} minLength={6} required disabled={busy} /><button type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} disabled={busy} onClick={() => setShowPassword(value => !value)}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></div>
              <button className="primary full-width" type="submit" disabled={busy}>{busy ? 'Please wait…' : authMode === 'register' ? 'Register & verify email' : 'Sign in'}</button>
            </form><button className="text-button" type="button" onClick={resetPassword} disabled={busy || !email.trim()}>Forgot your password?</button>
          </section><aside className="onboarding"><div className="onboarding-art" aria-hidden="true"><span>SV</span><ShieldCheck size={56} /></div><p className="eyebrow">A CLEAR START TO YOUR WORKDAY</p><h2>One account. Your attendance.</h2><ol><li><strong>Create your account</strong><span>Register once using your own verified work email.</span></li><li><strong>Confirm your identity</strong><span>Follow the email link and complete HR approval when required.</span></li><li><strong>Check in with your phone</strong><span>Verify your identity and check in at the office.</span></li></ol><p className="field-help">A browser profile binding is retained at sign-out. Clearing storage or using another profile can reset it; it is not a permanent phone identifier.</p></aside></div>
          : !firebaseUser.emailVerified ? <section className="card auth-card verification-card"><ol className="account-stepper" aria-label="Account setup progress"><li>1 · Account</li><li aria-current="step">2 · Verify email</li><li>3 · Approval</li></ol><div className="icon-box mail-pulse"><Mail size={28} aria-hidden="true" /></div><h2>Verify your email</h2><p>Open the verification link sent to <strong>{firebaseUser.email}</strong>, then return here.</p><div className="stack"><button className="primary" type="button" onClick={verifyAgain} disabled={busy}>I have verified my email</button><button className="secondary" type="button" onClick={sendVerification} disabled={busy || resendWait > 0}>{resendWait ? `Resend in ${resendWait}s` : 'Resend verification email'}</button></div></section>
            : !session && approvalRequired ? <EmployeeApplication email={firebaseUser.email} onApproved={retryApprovedSession} />
              : !session ? <section className="card auth-card"><h2>Account access unavailable</h2><p>Your account could not be registered for attendance. Check the message above or contact HR.</p><button className="secondary" onClick={() => establishSession(firebaseUser)} disabled={busy}>Try again</button></section>
              : <div className="workspace-layout"><nav className="workspace-nav" aria-label="Workspace navigation"><p className="eyebrow">YOUR WORKSPACE</p><p className="nav-identity">{session.user.email}</p>
                  {session.user.role !== 'attendance-viewer' && <><a href="#my-check-in"><MapPin size={17} aria-hidden="true" />My check-in</a><a href="#my-history"><CalendarDays size={17} aria-hidden="true" />Attendance history</a></>}
                  {(session.user.canViewAllAttendance || committee) && <a href="#all-attendance"><CheckCircle size={17} aria-hidden="true" />Everyone’s attendance</a>}
                  {committee && <><a href="#hr-directory"><ShieldCheck size={17} aria-hidden="true" />Directory & approvals</a><a href="#hr-controls"><CalendarDays size={17} aria-hidden="true" />Session controls</a></>}
                  {session.user.role !== 'attendance-viewer' && <a href="#movement-report"><MapPin size={17} aria-hidden="true" />{committee ? 'Movement reports' : 'My movement report'}</a>}
                  <p className="field-help">{session.user.role === 'attendance-viewer' ? 'Read-only attendance access.' : 'Check-ins and location sharing have separate consent.'}</p>
                </nav><div className="workspace-content">
                {session.user.role !== 'attendance-viewer' && <><section id="my-check-in" className="workspace-section"><Venue venue={session.venue} /><CheckIn key={session.user.uid} employeeUid={session.user.uid} onRecorded={recorded} events={events} logs={ownLogs} venue={session.venue} onRefresh={refresh} busy={busy} setBusy={setBusy} setError={setError} setNotice={setNotice} /></section>
                  <section id="my-history" className="card workspace-section"><div className="section-heading"><div className="icon-box"><CalendarDays aria-hidden="true" /></div><div><h2>Your attendance</h2><p>Your original recorded session check-ins.</p></div></div><History logs={ownLogs} events={events} /></section></>}
                {(session.user.canViewAllAttendance || committee) && <div id="all-attendance" className="workspace-section"><AttendanceDashboard key={session.user.uid} revision={reportRevision} /></div>}
                {committee && <><div id="hr-directory" className="workspace-section"><EmployeeAdministration onChanged={accountsChanged} /></div><div id="hr-controls" className="workspace-section"><Committee venue={session.venue} events={events} logs={summary.logs} onRefresh={refresh} busy={busy} setBusy={setBusy} setError={setError} setNotice={setNotice} /></div></>}
                {session.user.role !== 'attendance-viewer' && <div id="movement-report" className="workspace-section"><DailyReport key={session.user.uid} user={session.user} accountsRevision={accountsRevision} /></div>}
                <p className="privacy-note"><ShieldCheck size={17} aria-hidden="true" />This browser is registered to {session.user.email}. Location is checked when you submit attendance, not when you open the app. Signing out preserves the browser binding.</p>
              </div></div>}
    </main><footer>Shikshavertex · Employee attendance workspace · Times shown in India time</footer>
  </div>;
}
export default function App() { return <VenueGate><AccountApp /></VenueGate>; }
