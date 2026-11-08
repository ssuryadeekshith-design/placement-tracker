import { useCallback, useEffect, useRef, useState } from 'react';
import api from './api';
import { csvCell } from './reportCsv';

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const time = value => {
  const date = new Date(value);
  return value && !Number.isNaN(date.getTime()) ? date.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'Unavailable';
};

export function buildAttendanceCsv(report, rows) {
  const data = [['date_india', 'name', 'email', 'employee_id', 'department', 'team', 'status', 'session', 'check_in_india', 'check_in_timestamp_utc', 'method', 'attendance_mode', 'location_checked']];
  for (const row of rows) for (const checkIn of row.checkIns.length ? row.checkIns : [null]) {
    data.push([report.date, row.name, row.email, row.employeeId, row.department, row.team,
      row.status === 'marked' ? 'Marked' : 'Not marked yet', checkIn?.eventTitle, checkIn ? time(checkIn.timestamp) : '', checkIn?.timestamp, checkIn?.method, checkIn?.attendanceMode, checkIn ? String(checkIn.locationChecked === true) : '']);
  }
  return data.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export default function AttendanceDashboard() {
  const [date, setDate] = useState(today);
  const [eventId, setEventId] = useState('');
  const [report, setReport] = useState(null);
  const [query, setQuery] = useState('');
  const [department, setDepartment] = useState('');
  const [team, setTeam] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const sequence = useRef(0);
  const load = useCallback(async () => {
    const request = ++sequence.current;
    setLoading(true); setError(''); setReport(null);
    try {
      const { data } = await api.get(`/attendance-report?date=${encodeURIComponent(date)}${eventId ? `&eventId=${encodeURIComponent(eventId)}` : ''}`);
      if (!Array.isArray(data?.rows) || !Array.isArray(data?.events)) throw new Error('Attendance report is unavailable.');
      if (request === sequence.current) setReport(data);
    } catch (failure) {
      if (request === sequence.current) setError(failure.response?.data?.error || failure.message || 'Could not load attendance.');
    } finally { if (request === sequence.current) setLoading(false); }
  }, [date, eventId]);
  const invalidate = useCallback(() => { sequence.current++; }, []);
  useEffect(() => { load(); return invalidate; }, [load, invalidate]);
  const rows = (report?.rows || []).filter(row =>
    `${row.name} ${row.email} ${row.department} ${row.team}`.toLowerCase().includes(query.toLowerCase()) &&
    (!department || row.department === department) && (!team || row.team === team) && (!status || row.status === status));
  const options = field => [...new Set((report?.rows || []).map(row => row[field]).filter(Boolean))].sort();
  function download() {
    if (!report || loading) return;
    const url = URL.createObjectURL(new Blob(['\ufeff', buildAttendanceCsv(report, rows)], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `attendance-${report.date}.csv`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
  return <section className="card attendance-dashboard" aria-labelledby="attendance-view-title">
    <h2 id="attendance-view-title">Everyone’s attendance</h2>
    <p>Read-only attendance records. Times are shown in India time.</p>
    <div className="report-controls">
      <div><label htmlFor="attendance-date">Attendance date</label><input id="attendance-date" type="date" max={today()} required value={date} onChange={e => { setReport(null); setDate(e.target.value); setEventId(''); setDepartment(''); setTeam(''); }} /></div>
      <div><label htmlFor="attendance-event">Attendance session</label><select id="attendance-event" value={eventId} onChange={e => { setReport(null); setEventId(e.target.value); }}><option value="">All sessions on this date</option>{report?.events.map(event => <option key={event.id} value={event.id}>{event.title}</option>)}</select></div>
      <button className="primary" onClick={load} disabled={loading || !date}>{loading ? 'Loading attendance…' : 'Refresh attendance records'}</button>
    </div>
    {error && <p role="alert" className="alert error">{error}</p>}
    {report && <>
      <dl className="report-totals"><div><dt>Accounts in report</dt><dd>{report.totals.accounts}</dd></div><div><dt>Marked attendance</dt><dd>{report.totals.marked}</dd></div><div><dt>Not marked yet</dt><dd>{report.totals.notMarked}</dd></div></dl>
      <p className="field-help">Includes current approved registered accounts and recorded check-ins for the selected day. Unregistered roster entries are excluded. “Not marked yet” is not an absence or leave decision. With all sessions selected, a check-in to any session counts as marked.</p>
      {!report.events.length && <p className="callout">No attendance session exists for this date.</p>}
      <label htmlFor="attendance-search">Search name, email, department or team</label><input id="attendance-search" value={query} onChange={e => setQuery(e.target.value)} />
      <div className="report-controls">
        <div><label htmlFor="attendance-department">Department</label><select id="attendance-department" value={department} onChange={e => setDepartment(e.target.value)}><option value="">All departments</option>{options('department').map(v => <option key={v}>{v}</option>)}</select></div>
        <div><label htmlFor="attendance-team">Team</label><select id="attendance-team" value={team} onChange={e => setTeam(e.target.value)}><option value="">All teams</option>{options('team').map(v => <option key={v}>{v}</option>)}</select></div>
        <div><label htmlFor="attendance-status">Attendance status</label><select id="attendance-status" value={status} onChange={e => setStatus(e.target.value)}><option value="">All statuses</option><option value="marked">Marked</option><option value="not-marked">Not marked yet</option></select></div>
      </div>
      <button className="secondary" onClick={download} disabled={loading}>Download attendance CSV</button>
      <p className="field-help">Showing {rows.length} of {report.rows.length} accounts. CSV includes these filtered rows. Refresh to retrieve new check-ins.</p>
      <div className="report-table-wrap"><table className="report-table"><thead><tr><th>Name / email</th><th>Department / team</th><th>Status</th><th>Check-ins, India time</th><th>Verification mode</th></tr></thead><tbody>{rows.map(row => <tr key={row.email}>
        <td><strong>{row.name || 'Name not linked'}</strong><br />{row.email}</td><td>{row.department || '—'}<br />{row.team || '—'}</td><td>{row.status === 'marked' ? 'Marked' : 'Not marked yet'}</td>
        <td>{row.checkIns.map((checkIn, index) => <p key={index}>{checkIn.eventTitle} · {time(checkIn.timestamp)}</p>)}</td>
        <td>{row.checkIns.map((checkIn, index) => <p key={index}>{checkIn.attendanceMode === 'setup' ? 'Setup · location not verified' : checkIn.method === 'committee' ? 'Committee override' : checkIn.locationChecked ? 'Onsite checks recorded' : 'Location not verified'}</p>)}</td>
      </tr>)}</tbody></table></div>
      {!rows.length && <p className="empty-state">No accounts match these filters.</p>}
    </>}
  </section>;
}
