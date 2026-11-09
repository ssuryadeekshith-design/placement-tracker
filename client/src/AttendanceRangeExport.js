import { useCallback, useEffect, useId, useRef, useState } from 'react';
import api from './api';
import { attendanceToday as indiaToday, attendanceDateNumber as dateNumber, validAttendanceReport as validReport, attendanceColumns as columns, attendanceCsvRows, attendanceCsvText, downloadAttendanceCsv } from './attendanceReport';

const dayMs = 86400000;

/** Calendar-day range, independent of the browser's timezone or DST. */
export function attendanceRangeDates(from, to, today = indiaToday()) {
  const start = dateNumber(from), end = dateNumber(to), maximum = dateNumber(today);
  if (![start, end, maximum].every(Number.isFinite)) throw new Error('Choose valid start and end dates.');
  if (end < start) throw new Error('The end date must be on or after the start date.');
  if (end > maximum) throw new Error('Choose dates up to today, India time.');
  const count = Math.round((end - start) / dayMs) + 1;
  if (count > 31) throw new Error('Export up to 31 calendar days at a time.');
  return Array.from({ length: count }, (_, index) => new Date(start + index * dayMs).toISOString().slice(0, 10));
}

/** Explicit identity/check-in projection; no coordinates, credentials or route data. */
export function buildRangeAttendanceCsv(reports, department = '') {
  const rows = [columns];
  const filter = department.trim().toLowerCase();
  for (const report of reports) {
    if (!validReport(report, report?.date)) throw new Error('Attendance data is incomplete. Refresh and retry the export.');
    rows.push(...attendanceCsvRows(report, report.rows.filter(row => !filter || row.department.trim().toLowerCase() === filter)));
  }
  return attendanceCsvText(rows);
}

export default function AttendanceRangeExport({ date, departments = [], selectedDepartment = '', onAccessFailure }) {
  const initial = date || indiaToday();
  const [from, setFrom] = useState(initial);
  const [to, setTo] = useState(initial);
  const [department, setDepartment] = useState(selectedDepartment);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const sequence = useRef(0); const locked = useRef(false);
  const id = useId();
  const invalidate = useCallback(() => { sequence.current += 1; locked.current = false; }, []);

  useEffect(() => {
    invalidate(); setFrom(initial); setTo(initial); setLoading(false); setProgress(''); setError('');
  }, [initial, invalidate]);
  useEffect(() => { invalidate(); setDepartment(selectedDepartment); setLoading(false); setProgress(''); setError(''); }, [selectedDepartment, invalidate]);
  useEffect(() => invalidate, [invalidate]);

  async function exportRecords(event) {
    event.preventDefault();
    if (loading || locked.current) return;
    const request = ++sequence.current;
    setError(''); setProgress('');
    let dates;
    try { dates = attendanceRangeDates(from, to); }
    catch (failure) { setError(failure.message); return; }
    const chosenDepartment = department.trim();
    locked.current = true; setLoading(true);
    try {
      const reports = [];
      for (let index = 0; index < dates.length; index++) {
        if (request !== sequence.current) return;
        setProgress(`Loading day ${index + 1} of ${dates.length}: ${dates[index]}`);
        const { data } = await api.get(`/attendance-report?date=${encodeURIComponent(dates[index])}`);
        if (request !== sequence.current) return;
        if (!validReport(data, dates[index])) throw new Error(`Attendance data for ${dates[index]} is incomplete. No file was downloaded.`);
        reports.push(data);
      }
      const csv = buildRangeAttendanceCsv(reports, chosenDepartment);
      if (request !== sequence.current) return;
      downloadAttendanceCsv(csv, `attendance-records-${from}-to-${to}.csv`);
      const count = reports.reduce((sum, report) => sum + report.rows.filter(row => !chosenDepartment || row.department.trim().toLowerCase() === chosenDepartment.toLowerCase()).reduce((n, row) => n + Math.max(1, row.checkIns.length), 0), 0);
      setProgress(`Export complete: ${dates.length} ${dates.length === 1 ? 'day' : 'days'}. ${count} CSV data rows · ${chosenDepartment || 'All departments'} · all sessions. ${count ? '' : 'No matching records; the CSV contains headers only.'}`);
    } catch (failure) {
      if (request === sequence.current) {
        setProgress('');
        const message = failure.response?.data?.error || failure.message || 'Could not export attendance.';
        setError(`${message} No file was downloaded.`);
        if ([401, 403].includes(failure.response?.status)) onAccessFailure?.(`${message} Range export stopped; no file was downloaded.`);
      }
    } finally { if (request === sequence.current) { locked.current = false; setLoading(false); } }
  }

  return <details className="range-export">
    <summary>Export attendance records by date range</summary>
    <p className="field-help">Download up to 31 inclusive calendar days, India time. This export applies only the dates and export department below; it includes all sessions, teams and attendance statuses. Daily search, team, status and session filters do not limit this file.</p>
    <form className="report-controls" onSubmit={exportRecords}>
      <div><label htmlFor={`${id}-from`}>Export from</label><input id={`${id}-from`} type="date" required max={indiaToday()} value={from} disabled={loading} onChange={event => { setFrom(event.target.value); setError(''); setProgress(''); }} /></div>
      <div><label htmlFor={`${id}-to`}>Export through</label><input id={`${id}-to`} type="date" required min={from || undefined} max={indiaToday()} value={to} disabled={loading} onChange={event => { setTo(event.target.value); setError(''); setProgress(''); }} /></div>
      <div><label htmlFor={`${id}-department`}>Export department (optional)</label><input id={`${id}-department`} list={`${id}-departments`} placeholder="All departments" value={department} disabled={loading} onChange={event => { setDepartment(event.target.value); setError(''); setProgress(''); }} /><datalist id={`${id}-departments`}>{[...new Set(departments.filter(Boolean))].sort().map(value => <option key={value} value={value} />)}</datalist></div>
      <button type="submit" className="primary" disabled={loading || !from || !to}>{loading ? 'Preparing attendance CSV…' : 'Export attendance records (CSV)'}</button>
      {loading && <button type="button" className="secondary" onClick={() => { invalidate(); setLoading(false); setError(''); setProgress('Export cancelled. No file was downloaded.'); }}>Cancel export</button>}
    </form>
    {progress && <p className="field-help" role="status" aria-live="polite">{progress}</p>}
    {error && <p className="alert error" role="alert">{error}</p>}
    <p className="field-help">Department names reflect current profile metadata, including for past dates. Type an exact department name or leave it blank for all departments. Each day requires current viewing access; a failed day prevents a partial download. Changing the report date or refreshing the daily report cancels an ongoing export. “Not marked yet” is not an absence or leave decision. Days with no sessions retain an empty session field. This export contains no location history, biometric templates or raw verification credentials.</p>
  </details>;
}
