import { useEffect, useState } from 'react';
import api from './api';
const message = error => error.response?.data?.error || 'Could not contact the employee approval service.';

export function EmployeeApplication({ email, onApproved }) {
  const [fullName, setName] = useState('');
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function refresh() {
    setBusy(true); setError('');
    try {
      const { data } = await api.get('/registration/status');
      setStatus(data);
      if (data.approved) await onApproved();
    } catch (failure) { setError(message(failure)); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    let active = true;
    api.get('/registration/status').then(async ({ data }) => {
      if (!active) return;
      setStatus(data);
      if (data.approved) await onApproved();
    }).catch(failure => { if (active) setError(message(failure)); });
    return () => { active = false; };
  }, [onApproved]);
  return <section className="card auth-card"><h2>Employee access approval</h2><p>{email}</p>
    <p>Verify your work email, enter your full employee name, and request HR approval. Registration alone does not grant attendance access.</p>
    {error && <p role="alert">{error}</p>}
    {status?.status === 'pending' ? <p role="status">Your request is pending HR approval. You cannot mark attendance yet.</p>
      : status?.status === 'rejected' ? <p role="status">HR rejected this request: {status.reason}. Contact HR for review.</p>
        : status?.status === 'access-unavailable' ? <p role="status">Your account requires HR assistance. A new request cannot restore revoked access.</p>
          : <form onSubmit={async event => {
            event.preventDefault(); setBusy(true); setError('');
            try { const { data } = await api.post('/registration/request', { fullName }); setStatus(data); }
            catch (failure) { setError(message(failure)); } finally { setBusy(false); }
          }}><label htmlFor="employee-name">Full employee name</label><input id="employee-name" value={fullName} onChange={event => setName(event.target.value)} required minLength={2} maxLength={120} disabled={busy} /><button className="primary full-width" disabled={busy}>Request HR approval</button></form>}
    <button type="button" className="secondary full-width" disabled={busy} onClick={refresh}>Check approval status</button>
  </section>;
}

export function EmployeeAdministration() {
  const [employees, setEmployees] = useState([]); const [requests, setRequests] = useState([]);
  const [choices, setChoices] = useState({}); const [reasons, setReasons] = useState({});
  const [query, setQuery] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function refresh() {
    const [directory, pending] = await Promise.all([api.get('/employees'), api.get('/registration-requests')]);
    setEmployees(directory.data); setRequests(pending.data);
  }
  useEffect(() => {
    let active = true;
    Promise.all([api.get('/employees'), api.get('/registration-requests')]).then(([directory, pending]) => {
      if (active) { setEmployees(directory.data); setRequests(pending.data); }
    }).catch(failure => { if (active) setError(message(failure)); });
    return () => { active = false; };
  }, []);
  async function decide(id, action) {
    setBusy(true); setError('');
    try {
      await api.post(`/registration-requests/${id}/${action}`, action === 'approve' ? { employeeId: choices[id] } : { reason: reasons[id] });
      await refresh();
    } catch (failure) { setError(message(failure)); } finally { setBusy(false); }
  }
  return <section className="card committee-card"><h2>Employee directory and HR approvals</h2>
    {error && <p role="alert">{error}</p>}
    <p>Only a verified HR administrator can approve accounts. Job titles and team membership do not grant administrator access.</p>
    <h3>Pending employee requests ({Array.isArray(requests) ? requests.length : 0})</h3>
    {Array.isArray(requests) && requests.map(request => <article key={request.id} className="event-row"><strong>{request.fullName}</strong><p>{request.email}</p>
      <label htmlFor={`employee-${request.id}`}>Confirm employee identity</label><select id={`employee-${request.id}`} value={choices[request.id] || ''} onChange={event => setChoices(previous => ({ ...previous, [request.id]: event.target.value }))} disabled={busy}>
        <option value="">Choose the matching employee</option>{Array.isArray(employees) && employees.filter(e => e.active && (!e.uid || e.uid === request.uid)).map(e => <option key={e.employeeId} value={e.employeeId}>{e.fullName} · {e.department} · {e.team}</option>)}
      </select>
      <button className="primary full-width" disabled={busy || !choices[request.id]} onClick={() => decide(request.id, 'approve')}>Approve employee</button>
      <label htmlFor={`reason-${request.id}`}>Rejection reason</label><input id={`reason-${request.id}`} value={reasons[request.id] || ''} onChange={event => setReasons(previous => ({ ...previous, [request.id]: event.target.value }))} maxLength={300} />
      <button className="secondary full-width" disabled={busy || (reasons[request.id] || '').trim().length < 5} onClick={() => decide(request.id, 'reject')}>Reject request</button>
    </article>)}
    <h3>Directory ({Array.isArray(employees) ? employees.length : 0})</h3>
    <label htmlFor="employee-search">Search employees, departments or teams</label><input id="employee-search" value={query} onChange={event => setQuery(event.target.value)} />
    {Array.isArray(employees) && employees.filter(e => `${e.fullName} ${e.designation} ${e.department} ${e.team}`.toLowerCase().includes(query.toLowerCase())).map(e => <article key={e.employeeId} className="history-row"><div><strong>{e.fullName}</strong><p>{e.designation}</p><p>{e.department} · {e.team}</p><p>{e.email || 'No login email linked yet'}</p></div></article>)}
  </section>;
}
