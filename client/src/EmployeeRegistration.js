import { useCallback, useEffect, useRef, useState } from 'react';
import api from './api';
import './WorkforcePanels.css';
const message = error => error.response?.data?.error || 'Could not contact the employee approval service.';
const matches = (employee, query) => {
  const text = `${employee.employeeId || ''} ${employee.fullName || ''} ${employee.designation || ''} ${employee.department || ''} ${employee.team || ''} ${employee.email || ''}`.toLowerCase();
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean).every(term => text.includes(term));
};
const eligibleFor = (employee, request) => employee.active === true && /^SV\d{3}$/.test(employee.employeeId || '') &&
  (!employee.uid || employee.uid === request.uid) && (!employee.email || employee.email === request.email);
function validateDirectory(directory, pending) {
  if (!Array.isArray(directory) || !Array.isArray(pending) ||
    !directory.every(row => row && typeof row.employeeId === 'string' && typeof row.fullName === 'string' &&
      (row.uid == null || typeof row.uid === 'string') && (row.email == null || typeof row.email === 'string') &&
      ['designation', 'department', 'team'].every(key => row[key] == null || typeof row[key] === 'string')) ||
    !pending.every(row => row && typeof row.id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(row.id) && row.uid === row.id && typeof row.fullName === 'string' && typeof row.email === 'string'))
    throw new Error('Directory data is incomplete. Refresh before reviewing requests.');
}

function AuthStatusBadge({ status, linked }) {
  if (!linked) return null;
  const states = {
    verified: ['Firebase account email verified', 'success'],
    unverified: ['Firebase account email unverified', 'warning'],
    disabled: ['Firebase account disabled', 'danger'],
    missing: ['Firebase account missing', 'danger'],
    unknown: ['Auth status unavailable', 'muted'],
  };
  const [label, tone] = status?.checked === true ? states[status.state] || ['Auth status unavailable', 'muted'] : ['Auth status not checked', 'muted'];
  return <><span className={`workforce-badge ${tone}`}>{label}</span>{status?.checked === true && status.emailMatches === false && <span className="workforce-badge warning">Directory email differs from Firebase account</span>}</>;
}

export function EmployeeApplication({ email, onApproved }) {
  const [fullName, setName] = useState('');
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const request = useRef(0);
  const invalidate = useCallback(() => { request.current++; }, []);
  async function refresh() {
    const current = ++request.current;
    setBusy(true); setError('');
    try {
      const { data } = await api.get('/registration/status');
      if (current !== request.current) return;
      setStatus(data);
      if (data.approved) await onApproved();
    } catch (failure) { if (current === request.current) setError(message(failure)); }
    finally { if (current === request.current) setBusy(false); }
  }
  useEffect(() => {
    let active = true;
    setBusy(true);
    api.get('/registration/status').then(async ({ data }) => {
      if (!active) return;
      setStatus(data);
      if (data.approved) await onApproved();
    }).catch(failure => { if (active) setError(message(failure)); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; invalidate(); };
  }, [onApproved, invalidate]);
  const state = status?.status;
  return <section className="card auth-card approval-gate" aria-labelledby="employee-approval-title">
    <p className="eyebrow">Your account setup</p><h2 id="employee-approval-title">Employee access approval</h2>
    <ol className="access-steps" aria-label="Account setup progress"><li className="complete">1 · Email verified</li><li className="current" aria-current="step">2 · HR identity review</li><li>3 · Employee attendance</li></ol>
    <div className="verified-mail"><span className="workforce-badge success">Verified work email</span><p>{email}</p></div>
    <p>Verify your work email, enter your full employee name, and request HR approval. Registration alone does not grant attendance access.</p>
    {error && <p role="alert" className="alert error">{error}</p>}
    {!status && busy && <p className="workforce-notice" role="status">Checking your approval status…</p>}
    {state === 'pending' ? <div className="approval-state pending" role="status"><span className="workforce-badge warning">Pending review</span><h3>Your request is with HR</h3><p>Your request is pending HR approval. You cannot mark attendance yet.</p><p className="field-help">HR will match your verified email to the correct employee profile. Check again after they review it.</p></div>
      : state === 'rejected' ? <div className="approval-state rejected" role="status"><span className="workforce-badge danger">Request rejected</span><h3>Contact HR for a review</h3><p>HR rejected this request: {status.reason}. Contact HR for review.</p></div>
        : state === 'access-unavailable' ? <div className="approval-state rejected" role="status"><h3>Administrator assistance required</h3><p>Your account requires HR assistance. A new request cannot restore revoked access.</p></div>
          : status?.approved ? <div className="approval-state approved" role="status"><h3>Access approved</h3><p>Your approved session is being refreshed.</p></div>
            : status && <form onSubmit={async event => {
              event.preventDefault(); setBusy(true); setError('');
              try { const { data } = await api.post('/registration/request', { fullName: fullName.trim() }); setStatus(data); }
              catch (failure) { setError(message(failure)); } finally { setBusy(false); }
            }}><label htmlFor="employee-name">Full employee name</label><input id="employee-name" value={fullName} onChange={event => setName(event.target.value)} required minLength={2} maxLength={120} autoComplete="name" disabled={busy} /><p className="field-help">Use the name in the company employee directory.</p><button className="primary full-width" disabled={busy || fullName.trim().length < 2}>{busy ? 'Sending request…' : 'Request HR approval'}</button></form>}
    <button type="button" className="secondary full-width" disabled={busy} onClick={refresh}>{busy ? 'Checking status…' : 'Check approval status'}</button>
  </section>;
}

export function EmployeeAdministration({ onChanged }) {
  const [employees, setEmployees] = useState([]); const [requests, setRequests] = useState([]);
  const [choices, setChoices] = useState({}); const [reasons, setReasons] = useState({}); const [matchQueries, setMatchQueries] = useState({});
  const [confirmed, setConfirmed] = useState({}); const [checkedAt, setCheckedAt] = useState(null);
  const [query, setQuery] = useState(''); const [queueQuery, setQueueQuery] = useState('');
  const [busy, setBusy] = useState(true); const [loaded, setLoaded] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const sequence = useRef(0);
  const invalidate = useCallback(() => { sequence.current++; }, []);
  const clearSnapshot = useCallback(() => {
    setEmployees([]); setRequests([]); setLoaded(false); setCheckedAt(null);
    setChoices({}); setConfirmed({}); setReasons({}); setMatchQueries({});
  }, []);
  const load = useCallback(async current => {
    const [directory, pending] = await Promise.all([api.get('/employees'), api.get('/registration-requests')]);
    if (current !== sequence.current) return;
    validateDirectory(directory.data, pending.data);
    setEmployees(directory.data); setRequests(pending.data); setLoaded(true); setCheckedAt(new Date());
    setChoices({}); setConfirmed({}); setReasons({}); setMatchQueries({});
  }, []);
  useEffect(() => {
    const current = ++sequence.current;
    load(current).catch(failure => { if (current === sequence.current) { clearSnapshot(); setError(failure.response?.data?.error || failure.message || message(failure)); } })
      .finally(() => { if (current === sequence.current) setBusy(false); });
    return invalidate;
  }, [load, invalidate, clearSnapshot]);
  async function reload() {
    if (busy) return;
    const current = ++sequence.current;
    setBusy(true); setError(''); setNotice(''); clearSnapshot();
    try { await load(current); }
    catch (failure) { if (current === sequence.current) { clearSnapshot(); setError(failure.response?.data?.error || failure.message || message(failure)); } }
    finally { if (current === sequence.current) setBusy(false); }
  }
  async function decide(id, action) {
    if (busy) return;
    const applicant = requests.find(request => request.id === id);
    if (!applicant || !['approve', 'reject'].includes(action)) return;
    if (action === 'approve' && (applicant.emailVerified !== true || !confirmed[id] || !employees.some(employee => employee.employeeId === choices[id] && eligibleFor(employee, applicant)))) {
      setError('Select the matching active profile and confirm this verified applicant’s identity before approving.'); return;
    }
    if (action === 'reject' && (reasons[id] || '').trim().length < 5) { setError('Give HR’s rejection reason using at least 5 characters.'); return; }
    const current = ++sequence.current;
    const payload = action === 'approve' ? { employeeId: choices[id] } : { reason: reasons[id].trim() };
    const saved = action === 'approve' ? 'Employee approved. They can refresh their approval status.' : 'Request rejected with the recorded reason.';
    setBusy(true); setError(''); setNotice('');
    try {
      await api.post(`/registration-requests/${encodeURIComponent(id)}/${action}`, payload);
      if (current !== sequence.current) return;
      clearSnapshot(); setNotice(saved); onChanged?.();
      try { await load(current); }
      catch (failure) { if (current === sequence.current) setError(`Change saved, but current HR data could not refresh. Refresh directory & requests to continue. ${failure.response?.data?.error || failure.message || message(failure)}`); }
    } catch (failure) {
      if (current === sequence.current) { clearSnapshot(); setError(`The change could not be confirmed. Refresh before trying again. ${message(failure)}`); }
    } finally { if (current === sequence.current) setBusy(false); }
  }
  const filtered = employees.filter(employee => matches(employee, query));
  const queue = requests.filter(request => `${request.fullName} ${request.email}`.toLowerCase().includes(queueQuery.trim().toLowerCase()));
  return <section className="card committee-card workforce-admin" aria-labelledby="workforce-admin-title">
    <header className="workforce-panel-heading"><div><p className="eyebrow">People & access</p><h2 id="workforce-admin-title">Employee directory and HR approvals</h2><p>Match the right person to the right work account.</p></div><button className="secondary" type="button" onClick={reload} disabled={busy}>{busy ? 'Refreshing…' : 'Refresh directory & requests'}</button></header>
    <p className="field-help">Only a verified HR administrator can approve accounts. Job titles and team membership do not grant administrator access. No login linked describes the directory link only; it does not prove that no Firebase account exists.</p>
    {error && <p role="alert" className="alert error">{error}</p>}{notice && <p role="status" className="alert success">{notice}</p>}
    {busy && !loaded && <p role="status" className="workforce-notice">Loading the employee directory and approval queue…</p>}
    <div className="workforce-split">
      <section className="approval-queue" aria-labelledby="pending-requests-title"><div className="workforce-subheading"><h3 id="pending-requests-title">Pending employee requests ({loaded ? requests.length : '—'})</h3><span className="workforce-badge warning">HR review</span></div>
        <label htmlFor="request-search">Search pending names or emails</label><input id="request-search" type="search" value={queueQuery} onChange={event => setQueueQuery(event.target.value)} />
        {loaded && !requests.length && <div className="workforce-empty"><strong>All caught up</strong><p>No employee approval requests are pending.</p></div>}
        {loaded && requests.length > 0 && !queue.length && <p className="workforce-empty">No requests match this search.</p>}
        {queue.map(request => {
          const eligible = employees.filter(employee => eligibleFor(employee, request));
          const options = eligible.filter(employee => matches(employee, matchQueries[request.id] || ''));
          const selected = eligible.find(employee => employee.employeeId === choices[request.id]);
          return <article key={request.id} className="approval-request"><div className="workforce-subheading"><strong>{request.fullName}</strong>{request.emailVerified === true && <span className="workforce-badge success">Email verified when requested</span>}</div><p className="workforce-email">{request.email}</p>
            <label htmlFor={`match-search-${request.id}`}>Search matching employee profiles</label><input id={`match-search-${request.id}`} type="search" placeholder="Employee ID, name, team, department or work email" value={matchQueries[request.id] || ''} onChange={event => { setMatchQueries(previous => ({ ...previous, [request.id]: event.target.value })); setChoices(previous => ({ ...previous, [request.id]: '' })); setConfirmed(previous => ({ ...previous, [request.id]: false })); }} disabled={busy} />
            <label htmlFor={`employee-${request.id}`}>Confirm employee identity</label><select id={`employee-${request.id}`} value={choices[request.id] || ''} onChange={event => { setChoices(previous => ({ ...previous, [request.id]: event.target.value })); setConfirmed(previous => ({ ...previous, [request.id]: false })); }} disabled={busy}>
              <option value="">Choose the matching employee</option>{options.map(employee => <option key={employee.employeeId} value={employee.employeeId}>{employee.employeeId} · {employee.fullName} · {employee.department} · {employee.team}</option>)}
            </select>
            {!options.length && <p className="field-help">No matching available profile. Clear the search or ask an administrator to review the roster.</p>}
            <p className="field-help">Check the person and email before selecting. Approval links one account to one employee profile.</p>
            {selected && <p className="directory-match-summary">Selected: {selected.employeeId} · {selected.fullName}<br />{selected.designation} · {selected.department} · {selected.team}</p>}
            <label className="directory-match-confirm"><input type="checkbox" checked={confirmed[request.id] === true} disabled={busy || !selected} onChange={event => setConfirmed(previous => ({ ...previous, [request.id]: event.target.checked }))} />I have checked this applicant’s identity and confirm the selected directory profile belongs to them.</label>
            {request.emailVerified !== true && <p className="field-help">Work email verification is not confirmed in this request. Refresh or review the account before approving.</p>}
            <button className="primary full-width" disabled={busy || request.emailVerified !== true || !selected || !confirmed[request.id]} onClick={() => decide(request.id, 'approve')}>Approve employee</button>
            <details className="reject-disclosure"><summary>Reject this request</summary><label htmlFor={`reason-${request.id}`}>Rejection reason</label><input id={`reason-${request.id}`} value={reasons[request.id] || ''} onChange={event => setReasons(previous => ({ ...previous, [request.id]: event.target.value }))} maxLength={300} disabled={busy} /><button className="secondary full-width" disabled={busy || (reasons[request.id] || '').trim().length < 5} onClick={() => decide(request.id, 'reject')}>Reject request</button></details>
          </article>;
        })}
      </section>
      <section className="employee-directory" aria-labelledby="directory-title"><div className="workforce-subheading"><h3 id="directory-title">Directory ({loaded ? employees.length : '—'})</h3><span className="workforce-badge neutral">Employee profiles</span></div>
        <label htmlFor="employee-search">Search employees, departments or teams</label><input id="employee-search" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Employee ID, name, designation, department, team or email" />
        <p className="field-help">{loaded ? `${filtered.length} of ${employees.length} profiles.` : 'Directory counts are not loaded yet.'} A linked profile is not a live Firebase Authentication status check. Auth badges reflect the latest loaded lookup; they do not grant attendance approval or an HR role.</p>
        {checkedAt && <p className="field-help">Directory loaded: {checkedAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'medium' })} IST. Refresh to recheck account status.</p>}
        {loaded && !filtered.length && <p className="workforce-empty">No employee profiles match these filters.</p>}
        <div className="directory-list" role="region" aria-label="Employee directory results" tabIndex={0}>{filtered.map(employee => <article key={employee.employeeId} className="directory-person"><div className="workforce-avatar" aria-hidden="true">{String(employee.fullName || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(name => name[0]).join('').toUpperCase()}</div><div><div className="workforce-subheading"><strong>{employee.fullName}</strong><span className={`workforce-badge ${employee.uid && employee.email ? 'neutral' : employee.uid ? 'warning' : 'muted'}`}>{employee.uid && employee.email ? 'Profile linked' : employee.uid ? 'Profile link incomplete' : 'No login linked'}</span><span className={`workforce-badge ${employee.active === true ? 'neutral' : employee.active === false ? 'warning' : 'muted'}`}>{employee.active === true ? 'Directory profile active' : employee.active === false ? 'Directory profile inactive' : 'Directory activity unavailable'}</span><AuthStatusBadge status={employee.authStatus} linked={Boolean(employee.uid)} /></div><p>{employee.employeeId} · {employee.designation}</p><p>{employee.department} · {employee.team}</p><p className="workforce-email">{employee.email || 'No login email linked yet'}</p></div></article>)}</div>
      </section>
    </div>
  </section>;
}
