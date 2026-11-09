import { historyDate, indiaDay } from './AttendanceHistory';
import { csvCell } from './reportCsv';

export const attendanceToday = () => indiaDay(Date.now());
export function attendanceDateNumber(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value ? ms : NaN;
}
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);

/** Validate a complete report without inferring missing attendance or evidence. */
export function validAttendanceReport(report, date, eventId = '') {
  if (!report || !Number.isFinite(attendanceDateNumber(date)) || report.date !== date || !Array.isArray(report.events) || !Array.isArray(report.rows) || !report.totals) return false;
  const ids = new Set();
  for (const event of report.events) {
    if (!event || !validId(event.id) || typeof event.title !== 'string' || ids.has(event.id) || (event.checkInOpen !== undefined && typeof event.checkInOpen !== 'boolean')) return false;
    ids.add(event.id);
  }
  if (eventId && !ids.has(eventId)) return false;
  let marked = 0;
  for (const row of report.rows) {
    if (!row || !['name', 'email', 'department', 'team'].every(key => typeof row[key] === 'string') || (row.employeeId !== undefined && typeof row.employeeId !== 'string') || !['marked', 'not-marked'].includes(row.status) || !Array.isArray(row.checkIns) || (row.status === 'marked') !== (row.checkIns.length > 0)) return false;
    if (row.status === 'marked') marked++;
    for (const check of row.checkIns) {
      if (!check || !ids.has(check.eventId) || (eventId && check.eventId !== eventId) ||
        !['eventTitle', 'method', 'attendanceMode'].every(key => check[key] === undefined || typeof check[key] === 'string') ||
        !['locationChecked', 'phoneVerified', 'venueWifiObserved'].every(key => check[key] === undefined || typeof check[key] === 'boolean')) return false;
      // Legacy records can lack a usable timestamp; retain their recorded state.
      if (check.timestamp !== undefined && check.timestamp !== null && !['string', 'number', 'object'].includes(typeof check.timestamp)) return false;
    }
  }
  return report.totals.accounts === report.rows.length && report.totals.marked === marked && report.totals.notMarked === report.rows.length - marked;
}
export const attendanceTime = value => historyDate(value)?.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'medium' }) || 'Time unavailable';
export const attendanceCheckTime = value => historyDate(value)?.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' }) || 'Unavailable';

export const attendanceColumns = ['date_india', 'name', 'email', 'employee_id', 'department', 'team', 'status', 'session', 'check_in_india', 'check_in_timestamp_utc', 'method', 'attendance_mode', 'location_checked'];
/** Whitelist projection shared by the day and range exports. */
export function attendanceCsvRows(report, rows) {
  const data = [];
  for (const row of rows) for (const check of row.checkIns.length ? row.checkIns : [null]) {
    data.push([report.date, row.name, row.email, row.employeeId, row.department, row.team,
      row.status === 'marked' ? 'Marked' : 'Not marked yet', check?.eventTitle,
      check ? attendanceCheckTime(check.timestamp) : '', check ? historyDate(check.timestamp)?.toISOString() : '', check?.method, check?.attendanceMode,
      typeof check?.locationChecked === 'boolean' ? String(check.locationChecked) : '']);
  }
  return data;
}
export const attendanceCsvText = rows => rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
export function downloadAttendanceCsv(csv, name) {
  const url = URL.createObjectURL(new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  try { link.href = url; link.download = name; document.body.appendChild(link); link.click(); }
  finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 0); }
}
