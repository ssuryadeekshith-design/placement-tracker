import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, ShieldCheck } from 'lucide-react';
import api from './api';
import AttendanceRangeExport from './AttendanceRangeExport';
import { attendanceMode } from './AttendanceHistory';
import { attendanceToday as today, attendanceDateNumber, validAttendanceReport, attendanceTime, attendanceColumns, attendanceCsvRows, attendanceCsvText, downloadAttendanceCsv } from './attendanceReport';
import './AttendanceDashboard.css';

export function buildAttendanceCsv(report, rows) {
  // Validate the selected projection too: an unknown status must never become unmarked.
  const marked = rows.filter(row => row.status === 'marked').length;
  if (!validAttendanceReport({ ...report, rows, totals: { accounts: rows.length, marked, notMarked: rows.length - marked } }, report?.date)) throw new Error('Attendance data is incomplete. Refresh before exporting.');
  return attendanceCsvText([attendanceColumns, ...attendanceCsvRows(report, rows)]);
}
const matches = (row, query) => {
  const text = `${row.employeeId || ''} ${row.name} ${row.email} ${row.department} ${row.team}`.toLowerCase();
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean).every(term => text.includes(term));
};

export default function AttendanceDashboard({ revision = 0 }) {
  const [date, setDate] = useState(today); const [eventId, setEventId] = useState('');
  const [report, setReport] = useState(null); const [sessions, setSessions] = useState([]);
  const [query, setQuery] = useState(''); const [department, setDepartment] = useState(''); const [team, setTeam] = useState(''); const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false); const [error, setError] = useState(''); const [downloadNotice, setDownloadNotice] = useState('');
  const sequence = useRef(0);
  const invalidate = useCallback(() => { sequence.current++; }, []);
  const load = useCallback(async () => {
    const request = ++sequence.current;
    setLoading(true); setError(''); setReport(null); setDownloadNotice('');
    try {
      if (!Number.isFinite(attendanceDateNumber(date)) || date > today()) throw new Error('Choose a valid attendance date up to today, India time.');
      const { data } = await api.get(`/attendance-report?date=${encodeURIComponent(date)}${eventId ? `&eventId=${encodeURIComponent(eventId)}` : ''}`);
      if (request !== sequence.current) return;
      if (!validAttendanceReport(data, date, eventId)) throw new Error('Attendance data could not be confirmed. Refresh attendance to retry.');
      setReport(data); setSessions(data.events);
    } catch (failure) {
      if (request === sequence.current) { setSessions([]); setError(failure.response?.data?.error || failure.message || 'Could not load attendance.'); }
    } finally { if (request === sequence.current) setLoading(false); }
  }, [date, eventId]);
  useEffect(() => { load(); return invalidate; }, [load, invalidate, revision]);
  const clearDeniedReport = useCallback(message => { invalidate(); setReport(null); setSessions([]); setLoading(false); setDownloadNotice(''); setError(message); }, [invalidate]);
  const rows = (report?.rows || []).filter(row => matches(row, query) && (!department || row.department === department) && (!team || row.team === team) && (!status || row.status === status));
  const options = field => [...new Set([...(report?.rows || []).filter(row => field !== 'team' || !department || row.department === department).map(row => row[field]), field === 'department' ? department : team].filter(Boolean))].sort();
  function changeDate(value) { invalidate(); setReport(null); setSessions([]); setDownloadNotice(''); setDate(value); setEventId(''); }
  function changeSession(value) { invalidate(); setReport(null); setDownloadNotice(''); setEventId(value); }
  function download() {
    if (!report || loading) return;
    setDownloadNotice(''); setError('');
    try { downloadAttendanceCsv(buildAttendanceCsv(report, rows), `attendance-${report.date}.csv`); setDownloadNotice(`CSV download requested: ${rows.length} filtered accounts for ${report.date}. Multiple check-ins produce separate CSV rows.`); }
    catch { setError('The CSV download could not start. Try again or check your browser download settings.'); }
  }
  return <section className="card attendance-dashboard" aria-labelledby="attendance-view-title">
    <div className="attendance-heading"><div><p className="eyebrow">EMPLOYEE ATTENDANCE</p><h2 id="attendance-view-title">Everyone’s attendance</h2><p>Review recorded check-ins and export attendance. All times use India time.</p></div><span className="attendance-badge attendance-badge-neutral"><ShieldCheck size={14} aria-hidden="true" />Read-only access</span></div>
    <div className="report-controls attendance-scope">
      <div><label htmlFor="attendance-date">Attendance date</label><input id="attendance-date" type="date" max={today()} required value={date} onChange={e => changeDate(e.target.value)} /></div>
      <div><label htmlFor="attendance-event">Attendance session</label><select id="attendance-event" value={eventId} disabled={loading} onChange={e => changeSession(e.target.value)}><option value="">All sessions on this date</option>{eventId && !sessions.some(event => event.id === eventId) && <option value={eventId}>Selected session unavailable · choose All sessions</option>}{sessions.map(event => <option key={event.id} value={event.id}>{event.title}</option>)}</select></div>
      <button type="button" className="primary" onClick={load} disabled={loading || !date}>{loading ? 'Loading attendance…' : 'Refresh attendance records'}</button>
    </div>
    {loading && <p role="status" className="attendance-info">Loading the selected date and session. Previous records and exports are cleared.</p>}
    {error && <p role="alert" className="alert error">{error}</p>}
    {!loading && !report && <p className="attendance-info">Attendance is unavailable for this selection. Choose a date or refresh to retry.</p>}
    {report && <>
      <dl className="report-totals"><div><dt>Accounts in report</dt><dd>{report.totals.accounts}</dd></div><div><dt>Marked attendance</dt><dd>{report.totals.marked}</dd></div><div><dt>Not marked yet</dt><dd>{report.totals.notMarked}</dd></div></dl>
      <p className="field-help">Totals cover the selected date and session before employee filters. Includes current approved registered accounts and recorded check-ins; unregistered roster entries are excluded. Profile names and departments reflect current metadata, including for past dates. “Not marked yet” is not an absence or leave decision. With all sessions selected, any recorded check-in counts as marked.</p>
      <p className="field-help">Report generated: {attendanceTime(report.generatedAt)}{report.generatedAt ? ' IST' : ''}. Refresh to retrieve new check-ins.</p>
      {!report.events.length && <p className="attendance-info">No attendance session exists for this date. Unmarked accounts do not imply absence.</p>}
      <div className="attendance-filters"><div className="attendance-search"><label htmlFor="attendance-search">Search employees</label><input id="attendance-search" placeholder="Employee ID, name, email, department or team" value={query} onChange={e => { setQuery(e.target.value); setDownloadNotice(''); }} /></div>
      <div className="report-controls">
        <div><label htmlFor="attendance-department">Department</label><select id="attendance-department" value={department} onChange={e => { setDepartment(e.target.value); setTeam(''); setDownloadNotice(''); }}><option value="">All departments</option>{options('department').map(v => <option key={v}>{v}</option>)}</select></div>
        <div><label htmlFor="attendance-team">Team</label><select id="attendance-team" value={team} onChange={e => { setTeam(e.target.value); setDownloadNotice(''); }}><option value="">All teams</option>{options('team').map(v => <option key={v}>{v}</option>)}</select></div>
        <div><label htmlFor="attendance-status">Attendance status</label><select id="attendance-status" value={status} onChange={e => { setStatus(e.target.value); setDownloadNotice(''); }}><option value="">All statuses</option><option value="marked">Marked</option><option value="not-marked">Not marked yet</option></select></div>
      </div></div>
      <div className="attendance-results-toolbar"><p className="field-help" role="status">Showing {rows.length} of {report.rows.length} accounts · {rows.filter(row => row.status === 'marked').length} marked in these results.</p>{(query || department || team || status) && <button type="button" className="secondary" onClick={() => { setQuery(''); setDepartment(''); setTeam(''); setStatus(''); setDownloadNotice(''); }}>Clear employee filters</button>}<button type="button" className="secondary" onClick={download} disabled={loading}><Download size={16} aria-hidden="true" />Download attendance CSV</button></div>
      <p className="field-help">The daily CSV includes the filtered accounts and selected session shown below. The separate range export applies its own dates and department.</p>
      {downloadNotice && <p className="attendance-download-notice" role="status">{downloadNotice}</p>}
      <div className="report-table-wrap" role="region" aria-label="All-employees attendance records" tabIndex={0}><table className="report-table"><caption>Recorded check-ins · selected session date {report.date} · original recording times shown in IST</caption><thead><tr><th scope="col">Employee / email</th><th scope="col">Department / team</th><th scope="col">Status</th><th scope="col">Original check-ins · IST</th><th scope="col">Verification mode</th></tr></thead><tbody>{rows.map((row, rowIndex) => <tr key={`${row.email}-${rowIndex}`}>
        <td><strong>{row.name || 'Name not linked'}</strong><span>{row.email || 'Email unavailable'}</span><span>{row.employeeId || 'Employee ID not linked'}</span></td><td>{row.department || 'Department not linked'}<br />{row.team || 'Team not linked'}</td><td><span className={`attendance-badge attendance-badge-${row.status === 'marked' ? 'success' : 'warning'}`}>{row.status === 'marked' ? 'Marked' : 'Not marked yet'}</span></td>
        <td>{row.checkIns.length ? row.checkIns.map((checkIn, index) => <p key={index}><strong>{checkIn.eventTitle || report.events.find(event => event.id === checkIn.eventId)?.title || 'Attendance session'}</strong><br />{attendanceTime(checkIn.timestamp)}</p>) : 'No check-in recorded'}</td>
        <td>{row.checkIns.length ? row.checkIns.map((checkIn, index) => { const mode = attendanceMode({ ...checkIn, locationVerified: checkIn.locationChecked }); return <div className="attendance-check-evidence" key={index}><span className={`attendance-badge attendance-badge-${mode.tone}`}>{mode.label}</span>{checkIn.phoneVerified === true && <p>Phone passkey verified</p>}{checkIn.venueWifiObserved === true && <p>Venue Wi-Fi observed</p>}</div>; }) : 'No verification record'}</td>
      </tr>)}</tbody></table></div>
      {!rows.length && <p className="empty-state">{report.rows.length ? 'No accounts match these filters.' : 'No accounts or recorded check-ins are available for this date.'}</p>}
      <AttendanceRangeExport date={date} departments={options('department')} selectedDepartment={department} onAccessFailure={clearDeniedReport} />
    </>}
  </section>;
}
