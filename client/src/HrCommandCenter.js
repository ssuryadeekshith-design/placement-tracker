import { useCallback, useEffect, useRef, useState } from 'react';
import { Copy, KeyRound, Plus, RefreshCw, ShieldCheck, X } from 'lucide-react';
import api from './api';
import AttendanceHistory, { historyDate, indiaDay } from './AttendanceHistory';
import './CommandCenter.css';

const errorMessage = error => error.response?.data?.error || error.message || 'The attendance service could not complete this action.';
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
function eligibleAccounts(data) {
  if (!Array.isArray(data) || data.some(account => !account || !validId(account.uid) || typeof account.email !== 'string' || !/^[^\s/@]+@[^\s/@]+\.[^\s/@]+$/.test(account.email) || typeof account.attendanceEligible !== 'boolean')) throw new Error('Registered account data is incomplete. Reopen this dialog to reload accounts.');
  return data.filter(account => account.attendanceEligible === true);
}
const auditTime = value => historyDate(value)?.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'medium' }) || 'Time unavailable';

function CommandModal({ title, onClose, children, working, view }) {
  const dialog = useRef(null); const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement;
    const element = dialog.current;
    const focusables = () => [...element.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[href],[tabindex="0"]')];
    const keyboard = event => {
      if (event.key === 'Escape') { event.preventDefault(); close.current(); }
      if (event.key === 'Tab') {
        const targets = focusables(); const first = targets[0], last = targets[targets.length - 1];
        if (!first) { event.preventDefault(); element.focus(); }
        else if (event.shiftKey && (document.activeElement === first || !element.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !element.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', keyboard);
    return () => { document.removeEventListener('keydown', keyboard); if (previous?.isConnected) previous.focus(); };
  }, []);
  useEffect(() => {
    const element = dialog.current;
    (element.querySelector('[data-autofocus]:not(:disabled)') || element.querySelector('button:not(:disabled)') || element).focus();
  }, [view, working]);
  return <div className="cc-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) close.current(); }}><section ref={dialog} className="cc-modal cc-session-modal" role="dialog" aria-modal="true" aria-labelledby="command-modal-title" tabIndex={-1}><header><div><p className="cc-eyebrow">HR WORKSPACE</p><h2 id="command-modal-title">{title}</h2></div><button type="button" className="cc-icon-button" aria-label="Close dialog" disabled={working} onClick={onClose}><X size={20} aria-hidden="true" /></button></header>{children}</section></div>;
}

function OverrideAudit({ logs, events }) {
  const overrides = logs.filter(log => log.method === 'committee' || log.method === 'manual');
  return <div className="cc-override-audit"><h3>Manual override audit</h3><p className="cc-help">Original saved records only. An override does not prove employee location or phone verification. Existing attendance is never replaced by a duplicate override.</p>{!overrides.length ? <p className="cc-empty">No manual overrides in the loaded records.</p> : <div className="cc-table-wrap" role="region" aria-label="Manual attendance override audit" tabIndex={0}><table className="cc-record-table"><caption className="cc-table-caption">Saved override evidence · India time</caption><thead><tr><th scope="col">Employee / session</th><th scope="col">Recorded at · IST</th><th scope="col">Recorded by</th><th scope="col">Reason</th></tr></thead><tbody>{overrides.map((log, index) => <tr key={log.id || index}><td><strong>{log.email || 'Employee unavailable'}</strong><p>{events.find(event => event.id === log.eventId)?.title || 'Session unavailable'}</p></td><td className="cc-time">{auditTime(log.timestamp)}</td><td>{typeof log.markedBy === 'string' && log.markedBy ? <>Administrator UID: <code>{log.markedBy}</code></> : 'Administrator not recorded'}</td><td>{typeof log.reason === 'string' && log.reason ? log.reason : 'Reason not recorded'}</td></tr>)}</tbody></table></div>}</div>;
}

export default function HrCommandCenter({ events = [], logs = [], venue, onRefresh, busy, setBusy, setError, setNotice }) {
  const [modal, setModal] = useState('');
  const [title, setTitle] = useState(''); const [date, setDate] = useState(''); const [mandatory, setMandatory] = useState(true);
  const [students, setStudents] = useState([]); const [studentsLoading, setStudentsLoading] = useState(false);
  const [manual, setManual] = useState({ eventId: '', email: '', reason: '' }); const [confirmed, setConfirmed] = useState(false);
  const [roomEvent, setRoomEvent] = useState(''); const [activeCode, setActiveCode] = useState(null); const [now, setNow] = useState(Date.now);
  const [pending, setPending] = useState(false); const [localError, setLocalError] = useState(''); const [localNotice, setLocalNotice] = useState(''); const [copied, setCopied] = useState(false); const [stale, setStale] = useState(false);
  const mounted = useRef(true); const lock = useRef(false); const accountRequest = useRef(0); const codeRequest = useRef(0);
  const invalidate = useCallback(() => { accountRequest.current++; codeRequest.current++; }, []);
  const working = busy || pending;
  const validEvents = Array.isArray(events) && events.every(event => event && validId(event.id) && typeof event.title === 'string' && validDate(event.date) && typeof event.checkInOpen === 'boolean');
  const validLogs = Array.isArray(logs) && logs.every(log => log && typeof log === 'object' && typeof log.eventId === 'string' && ['id', 'email', 'fullName', 'rollNumber', 'method', 'reason', 'markedBy'].every(key => log[key] == null || typeof log[key] === 'string'));
  const ready = !stale && validEvents && validLogs;
  const sessions = ready ? events : [];
  const today = indiaDay(now);
  const openEvents = sessions.filter(event => event.checkInOpen === true && event.date === today);
  const roomEnabled = venue?.requiresRoomCode !== false;
  const overrideEnabled = !!venue && venue.attendanceWifi?.required !== true;
  const currentCode = ready && roomEnabled && activeCode && openEvents.some(event => event.id === activeCode.eventId) ? activeCode : null;
  const seconds = currentCode ? Math.max(0, Math.ceil((currentCode.expiresAt - now) / 1000)) : 0;
  const target = students.find(student => student.email === manual.email);
  const targetEvent = sessions.find(event => event.id === manual.eventId);
  const canOverride = ready && overrideEnabled && !!target && !!targetEvent && confirmed && !studentsLoading && manual.reason.trim().length >= 5 && manual.reason.trim().length <= 500;
  useEffect(() => { mounted.current = true; const timer = setInterval(() => setNow(Date.now()), 1000); return () => { mounted.current = false; invalidate(); clearInterval(timer); }; }, [invalidate]);
  useEffect(() => { if (activeCode && (!ready || !roomEnabled || !openEvents.some(event => event.id === activeCode.eventId))) { setActiveCode(null); setCopied(false); } }, [activeCode, ready, roomEnabled, openEvents]);
  async function run(action, mutation = false) {
    if (working || lock.current) return;
    lock.current = true; setPending(true); setBusy(true); setError(''); setNotice(''); setLocalError(''); setLocalNotice('');
    try { await action(); }
    catch (failure) { if (mounted.current) { const message = errorMessage(failure); if (mutation) { setStale(true); setActiveCode(null); setConfirmed(false); } setError(message); setLocalError(`${message}${mutation ? ' Close this dialog if open and refresh current data before another change.' : ''}`); } }
    finally { lock.current = false; if (mounted.current) { setPending(false); setBusy(false); } }
  }
  async function refreshSnapshot(saved = false) {
    setStale(true); setActiveCode(null); setStudents([]); setConfirmed(false);
    try { await onRefresh(); if (mounted.current) setStale(false); }
    catch (failure) { if (!mounted.current) return; const message = `${saved ? 'Change saved, but current data could not refresh.' : 'Current data could not refresh.'} ${errorMessage(failure)} Refresh before another change.`; setError(message); setLocalError(message); }
  }
  async function save(action, notice) {
    await run(async () => {
      const result = await action();
      if (!mounted.current) return;
      const message = typeof notice === 'function' ? notice(result) : notice;
      setModal(''); setLocalNotice(message); setNotice(message); await refreshSnapshot(true);
    }, true);
  }
  function closeModal() { if (!working && !lock.current) { accountRequest.current++; codeRequest.current++; setModal(''); setLocalError(''); setCopied(false); setActiveCode(null); setStudents([]); setStudentsLoading(false); setConfirmed(false); } }
  function openModal(value) { setLocalError(''); setCopied(false); setActiveCode(null); setModal(value); }
  async function generate(id) {
    if (!ready || !roomEnabled || !openEvents.some(event => event.id === id)) { setLocalError('Choose a session that is open today (India time).'); return; }
    await run(async () => {
      setActiveCode(null); setCopied(false); const request = ++codeRequest.current;
      const { data } = await api.post(`/events/${encodeURIComponent(id)}/room-code`);
      if (!mounted.current || request !== codeRequest.current) return;
      if (typeof data?.code !== 'string' || !/^\d{6}$/.test(data.code) || !Number.isFinite(data?.expiresAt) || data.expiresAt <= Date.now()) throw new Error('The server did not return a current room code. Generate a new code.');
      setRoomEvent(id); setActiveCode({ code: data.code, expiresAt: data.expiresAt, eventId: id }); setNow(Date.now()); setModal('code');
    });
  }
  async function copyCode() {
    if (!currentCode || !seconds || currentCode.expiresAt <= Date.now()) { setNow(Date.now()); return; }
    const request = codeRequest.current;
    try { if (!navigator.clipboard?.writeText) throw new Error(); await navigator.clipboard.writeText(currentCode.code); if (mounted.current && request === codeRequest.current) setCopied(true); }
    catch { if (mounted.current && request === codeRequest.current) setLocalError('Copy is unavailable in this browser. Select the displayed code to copy it manually.'); }
  }
  function create(event) {
    event.preventDefault();
    if (!ready || !title.trim() || title.trim().length > 160 || !validDate(date)) return;
    save(async () => { const { data } = await api.post('/events', { title: title.trim(), date, isMandatory: mandatory }); if (!validId(data?.id) || data.checkInOpen !== false || data.title !== title.trim() || data.date !== date) throw new Error('Event creation could not be confirmed.'); setTitle(''); setDate(''); return data; }, 'Event created. Check-in is closed; open it when ready.');
  }
  function override(event) {
    event.preventDefault(); if (!canOverride) return;
    save(async () => { const { data } = await api.post('/attendance/manual', { ...manual, reason: manual.reason.trim() }); if (data?.success !== true || typeof data.alreadyMarked !== 'boolean') throw new Error('The override result could not be confirmed.'); setManual({ eventId: '', email: '', reason: '' }); return data; }, data => data.alreadyMarked ? 'Attendance already exists. The original record was preserved; no new override was recorded.' : 'Manual attendance override recorded. Administrator identity, reason and time were saved.');
  }
  function openOverride() {
    if (!ready || !overrideEnabled || working) return;
    openModal('override'); setManual({ eventId: '', email: '', reason: '' }); setConfirmed(false); setStudents([]); setStudentsLoading(true);
    const current = ++accountRequest.current;
    api.get('/students').then(({ data }) => { if (mounted.current && current === accountRequest.current) setStudents(eligibleAccounts(data)); }).catch(failure => { if (mounted.current && current === accountRequest.current) { setStudents([]); setLocalError(errorMessage(failure)); } }).finally(() => { if (mounted.current && current === accountRequest.current) setStudentsLoading(false); });
  }
  function changeManual(field, value) { setManual(previous => ({ ...previous, [field]: value })); setConfirmed(false); }
  return <section className="card cc-command-center" aria-labelledby="hr-command-title">
    <div className="cc-section-head"><div><p className="cc-eyebrow">HR WORKSPACE</p><h2 id="hr-command-title">HR session controls</h2><p>Manage attendance sessions, room verification and audited exceptions.</p></div><span className="cc-chip cc-chip-neutral"><ShieldCheck size={14} aria-hidden="true" />Administrator access</span></div>
    <div className="cc-action-bar"><button type="button" className="primary" disabled={working || !ready} onClick={() => openModal('create')}><Plus size={16} aria-hidden="true" />Create attendance event</button><button type="button" className="secondary" disabled={working || !ready || !openEvents.length || !roomEnabled} onClick={() => { setRoomEvent(openEvents[0]?.id || ''); openModal('room'); }}><KeyRound size={16} aria-hidden="true" />Room code display</button><button type="button" className="secondary" disabled={working || !ready || !overrideEnabled || !sessions.length} onClick={openOverride}>Committee attendance override</button><button type="button" className="cc-icon-button" aria-label="Refresh attendance sessions" disabled={working} onClick={() => run(() => refreshSnapshot())}><RefreshCw size={18} aria-hidden="true" /></button></div>
    {!roomEnabled && <p className="cc-context-note">Temporary setup mode: room codes are not required for check-in.</p>}
    {venue?.attendanceWifi?.required && <p className="cc-context-note">Browser committee overrides are unavailable while Wi-Fi attendance is required. Use the approved native attendance flow.</p>}
    <p className="cc-help">Session dates use India time. Room codes are available only for sessions open today. Manual overrides can record attendance for a closed or past session and must include a reason.</p>
    {localNotice && <p role="status" className="cc-saved-notice">{localNotice}</p>}
    {localError && !modal && <p role="alert" className="cc-error">{localError}</p>}
    {!ready && <p role="status" className="cc-context-note">Current sessions and audit records are unavailable. Refresh to reload before making a change.</p>}
    {ready && <><div className="cc-sessions"><div className="cc-subsection-head"><h3>Attendance sessions</h3><span>{sessions.length} sessions · {openEvents.length} open today</span></div>{!sessions.length && <p className="cc-empty">No attendance sessions yet. Create one, then open check-in when ready.</p>}{sessions.map(event => <article className="cc-session-row" key={event.id}><div><strong>{event.title}</strong><p>{event.date} · {event.isMandatory === false ? 'Optional' : 'Mandatory'} · <span className={`cc-status-text ${event.checkInOpen ? 'is-open' : 'is-closed'}`}>{event.checkInOpen ? 'Check-in open' : 'Check-in closed'}</span>{event.date !== today && ' · Not today'}</p></div><div className="cc-row-actions"><button type="button" className="secondary" aria-label={`${event.checkInOpen ? 'Close' : 'Open'} check-in for ${event.title}`} disabled={working} onClick={() => save(async () => { const desired = !event.checkInOpen; const { data } = await api.patch(`/events/${encodeURIComponent(event.id)}`, { checkInOpen: desired }); if (data?.success !== true) throw new Error('Session change could not be confirmed.'); return desired; }, desired => `${event.title}: check-in ${desired ? 'opened' : 'closed'}.`)}>{event.checkInOpen ? 'Close check-in' : 'Open check-in'}</button>{event.checkInOpen && event.date === today && roomEnabled && <button type="button" className="primary" disabled={working} onClick={() => generate(event.id)}>Generate room code</button>}</div></article>)}</div>
    <OverrideAudit logs={logs} events={sessions} /><div className="cc-master-records"><h3>Attendance records</h3><p className="cc-help">Recorded check-ins are retained. Room codes used are not stored. Use Everyone’s attendance for department filtering and attendance CSV export.</p><AttendanceHistory logs={logs} events={sessions} committee /></div></>}
    {modal && <CommandModal view={modal} working={working} title={modal === 'create' ? 'Create attendance event' : modal === 'override' ? 'Manual attendance override' : 'Room code display'} onClose={closeModal}>
      {localError && <p role="alert" className="cc-error">{localError}</p>}
      {modal === 'create' && <form className="cc-modal-form" onSubmit={create}><p className="cc-help">New sessions begin closed. Open check-in when employees should mark attendance. Event dates use India time.</p><label htmlFor="command-event-title">Event title</label><input id="command-event-title" data-autofocus value={title} onChange={event => setTitle(event.target.value)} required maxLength={160} disabled={working} /><label htmlFor="command-event-date">Event date</label><input id="command-event-date" type="date" value={date} onChange={event => setDate(event.target.value)} required disabled={working} /><label className="checkbox"><input type="checkbox" checked={mandatory} onChange={event => setMandatory(event.target.checked)} disabled={working} />Mandatory event</label><div className="cc-modal-actions"><button type="button" className="secondary" disabled={working} onClick={closeModal}>Cancel</button><button type="submit" className="primary" disabled={working || !ready || !title.trim() || !validDate(date)}>{working ? 'Creating…' : 'Create event'}</button></div></form>}
      {modal === 'override' && <form className="cc-modal-form" onSubmit={override}><p className="cc-context-note">Use only when an employee cannot check in themselves. This bypasses location and room-code checks; your administrator UID, reason and recording time are saved. It does not claim phone verification or backdate a check-in.</p><label htmlFor="command-manual-event">Override event</label><select id="command-manual-event" data-autofocus required value={manual.eventId} onChange={event => changeManual('eventId', event.target.value)} disabled={working || !ready}><option value="">Select an event</option>{sessions.map(event => <option key={event.id} value={event.id}>{event.title} · {event.date} · {event.checkInOpen ? 'Open' : 'Closed'}</option>)}</select><label htmlFor="command-manual-person">Registered employee</label><select id="command-manual-person" required value={manual.email} onChange={event => changeManual('email', event.target.value)} disabled={working || studentsLoading || !ready}><option value="">{studentsLoading ? 'Loading approved accounts…' : 'Select a registered email'}</option>{students.map(student => <option key={student.uid} value={student.email}>{student.email}</option>)}</select>{!studentsLoading && !students.length && !localError && <p className="cc-help" role="status">No attendance-eligible registered accounts are available.</p>}<label htmlFor="command-manual-reason">Reason for override</label><textarea id="command-manual-reason" required minLength={5} maxLength={500} value={manual.reason} onChange={event => changeManual('reason', event.target.value)} disabled={working || !ready} rows={3} /><p className="cc-help">5–500 characters. Existing attendance is preserved if this employee already checked in.</p>{target && targetEvent && <div className="cc-override-summary"><strong>Review before recording</strong><p>{typeof target.fullName === 'string' && target.fullName ? `${target.fullName} · ` : ''}{target.email}</p><p>{targetEvent.title} · {targetEvent.date} · {targetEvent.checkInOpen ? 'Open' : 'Closed'}</p></div>}<label className="cc-override-confirm"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} disabled={working || !ready || !target || !targetEvent} />I have checked the employee, session and reason and confirm this manual attendance exception.</label><div className="cc-modal-actions"><button type="button" className="secondary" disabled={working} onClick={closeModal}>Cancel</button><button type="submit" className="primary" disabled={working || !canOverride}>{working ? 'Recording…' : 'Record committee override'}</button></div></form>}
      {modal === 'room' && <form className="cc-modal-form" onSubmit={event => { event.preventDefault(); generate(roomEvent); }}><p className="cc-help">Display this short-lived code inside the room. Generating a new code replaces the previous code for this session.</p><label htmlFor="command-room-event">Room code session</label><select id="command-room-event" data-autofocus value={roomEvent} onChange={event => setRoomEvent(event.target.value)} disabled={working || !ready}>{openEvents.map(event => <option key={event.id} value={event.id}>{event.title}</option>)}</select>{!openEvents.length && <p className="cc-context-note">No session is open today (India time).</p>}<button className="primary" type="submit" disabled={working || !ready || !roomEnabled || !openEvents.some(event => event.id === roomEvent)}>Generate current code</button></form>}
      {modal === 'code' && <div className="cc-code-display"><p>{sessions.find(event => event.id === roomEvent)?.title || 'Attendance session'}</p>{currentCode && seconds > 0 ? <><strong className="cc-room-number" aria-label={`Room code ${currentCode.code}`}>{currentCode.code}</strong><p className="cc-countdown">Expires in {seconds}s · display inside the room</p><p role="status" className="cc-help">{copied ? 'Room code copied.' : 'Current room code is ready.'}</p><button type="button" data-autofocus className="primary" disabled={working || !seconds} onClick={copyCode}><Copy size={16} aria-hidden="true" />{copied ? 'Copied' : 'Copy room code'}</button></> : <p role="status" className="cc-context-note">{working ? 'Generating room code…' : openEvents.some(event => event.id === roomEvent) && roomEnabled ? activeCode ? 'Code expired. Generate a new code.' : 'No current room code. Generate a new code.' : 'Room code unavailable. The session must be open today and room codes enabled.'}</p>}<p className="cc-help">Codes expire after 60 seconds. Generating another replaces the previous code. GPS proximity and a room code cannot establish the second floor.</p><button type="button" className="secondary" disabled={working || !roomEnabled || !openEvents.some(event => event.id === roomEvent)} onClick={() => generate(roomEvent)}>Generate a new code</button></div>}
    </CommandModal>}
  </section>;
}
