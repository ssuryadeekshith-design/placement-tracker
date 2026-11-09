import { useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Search, ShieldCheck } from 'lucide-react';
import './CommandCenter.css';

const india = { timeZone: 'Asia/Kolkata' };
export function historyDate(value) {
  let raw;
  if (value instanceof Date) raw = value.getTime();
  else if (typeof value === 'number' && Number.isFinite(value)) raw = value;
  else if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    const datePart = value.slice(0, 10);
    const calendarDate = new Date(`${datePart}T00:00:00Z`);
    if (Number.isNaN(calendarDate.getTime()) || calendarDate.toISOString().slice(0, 10) !== datePart) return null;
    raw = value;
  } else if (value && typeof value === 'object') {
    const seconds = value._seconds ?? value.seconds;
    const nanos = value._nanoseconds ?? value.nanoseconds ?? 0;
    if (typeof seconds !== 'number' || !Number.isFinite(seconds) || typeof nanos !== 'number' || !Number.isFinite(nanos) || nanos < 0 || nanos >= 1e9) return null;
    raw = seconds * 1000 + nanos / 1e6;
  } else return null;
  const parsed = new Date(raw);
  return !Number.isNaN(parsed.getTime()) ? parsed : null;
}
export function indiaDay(value) {
  const date = historyDate(value);
  if (!date) return '';
  const parts = new Intl.DateTimeFormat('en-CA', { ...india, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)?.value).join('-');
}
const displayTime = value => historyDate(value)?.toLocaleString('en-IN', { ...india, dateStyle: 'medium', timeStyle: 'medium' }) || 'Time unavailable';
const monthLabel = value => new Date(`${value}-01T12:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const shiftMonth = (month, delta) => { const date = new Date(`${month}-01T12:00:00Z`); date.setUTCMonth(date.getUTCMonth() + delta); return date.toISOString().slice(0, 7); };

export function attendanceMode(log) {
  if (['manual', 'committee'].includes(log.method)) return { label: 'Committee override', tone: 'warning' };
  if (log.attendanceMode === 'setup') return { label: 'Historical · location not verified', tone: 'warning' };
  if (log.attendanceMode === 'onsite' && log.locationVerified === true) return { label: 'Onsite checks recorded', tone: 'success' };
  if (log.attendanceMode === 'onsite') return { label: 'Onsite · location not verified', tone: 'neutral' };
  return { label: 'Legacy · verification unavailable', tone: 'neutral' };
}

/** A record calendar, not an absence/leave calendar. All timestamps use India time. */
export default function AttendanceHistory({ logs = [], events = [], committee = false }) {
  const today = indiaDay(Date.now());
  const [month, setMonth] = useState(today.slice(0, 7));
  const [day, setDay] = useState('');
  const [query, setQuery] = useState('');
  const [session, setSession] = useState('');
  const [sort, setSort] = useState('newest');
  const eventById = useMemo(() => new Map(events.map(event => [event.id, event])), [events]);
  const counts = useMemo(() => logs.reduce((all, log) => { const date = indiaDay(log.timestamp); if (date) all.set(date, (all.get(date) || 0) + 1); return all; }, new Map()), [logs]);
  const filtered = useMemo(() => logs.filter(log => {
    const title = eventById.get(log.eventId)?.title || 'Attendance session';
    return (!day || indiaDay(log.timestamp) === day) && (!session || log.eventId === session) &&
      `${title} ${log.fullName || ''} ${log.email || ''}`.toLowerCase().includes(query.trim().toLowerCase());
  }).sort((a, b) => {
    if (sort === 'session' || sort === 'session-desc') return (sort === 'session' ? 1 : -1) * (eventById.get(a.eventId)?.title || 'Attendance session').localeCompare(eventById.get(b.eventId)?.title || 'Attendance session');
    const aTime = historyDate(a.timestamp)?.getTime(); const bTime = historyDate(b.timestamp)?.getTime();
    if (aTime === undefined && bTime === undefined) return 0;
    if (aTime === undefined) return 1;
    if (bTime === undefined) return -1;
    return sort === 'oldest' ? aTime - bTime : bTime - aTime;
  }), [logs, eventById, query, day, session, sort]);
  const first = new Date(`${month}-01T12:00:00Z`);
  const start = (first.getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const lastRecorded = [...logs].map(log => historyDate(log.timestamp)).filter(Boolean).sort((a, b) => b.getTime() - a.getTime())[0];
  function changeMonth(delta) { setMonth(previous => shiftMonth(previous, delta)); setDay(''); }

  return <div className="cc-history">
    <div className="cc-section-head"><div><p className="cc-eyebrow">ATTENDANCE RECORDS</p><h3>Attendance history</h3><p>Original check-in times · India time</p></div><span className="cc-chip cc-chip-neutral"><CalendarDays size={14} aria-hidden="true" />{logs.length} recorded check-ins</span></div>
    {!logs.length && <p className="cc-empty">No attendance recorded yet.</p>}
    <>
      {!committee && <div className="cc-history-stats"><div><span>Days with a record</span><strong>{counts.size}</strong></div><div><span>Latest check-in</span><strong>{lastRecorded ? lastRecorded.toLocaleDateString('en-IN', { ...india, day: 'numeric', month: 'short' }) : 'Unavailable'}</strong></div></div>}
      <div className={`cc-history-layout${committee ? ' cc-history-all' : ''}`}>
        {!committee && <div className="cc-calendar" role="group" aria-label="Attendance record calendar">
          <div className="cc-calendar-head"><button type="button" aria-label="Previous attendance month" onClick={() => changeMonth(-1)}><ChevronLeft size={18} aria-hidden="true" /></button><strong aria-live="polite">{monthLabel(month)}</strong><button type="button" aria-label="Next attendance month" disabled={month >= today.slice(0, 7)} onClick={() => changeMonth(1)}><ChevronRight size={18} aria-hidden="true" /></button></div>
          <div className="cc-calendar-grid" aria-hidden="true">{['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((label, index) => <span key={index} className="cc-weekday">{label}</span>)}</div>
          <div className="cc-calendar-grid">{Array.from({ length: start }, (_, index) => <span key={`spacer-${index}`} />)}{Array.from({ length: days }, (_, index) => {
            const date = `${month}-${String(index + 1).padStart(2, '0')}`; const count = counts.get(date) || 0;
            return <button type="button" key={date} aria-label={`${date}: ${count ? `${count} recorded check-in${count === 1 ? '' : 's'}` : 'No check-in recorded'}`} aria-pressed={day === date} disabled={date > today} className={`${count ? `has-record record-level-${Math.min(count, 3)}` : ''} ${day === date ? 'selected-day' : ''}`} onClick={() => setDay(previous => previous === date ? '' : date)}>{index + 1}<span className="cc-calendar-dot" aria-hidden="true" /></button>;
          })}</div>
          <p className="cc-calendar-key"><i aria-hidden="true" />Recorded check-in · darker = 2 or 3+ records</p><p className="cc-help">A day without a record is not an absence or leave decision.</p>
          <p className="cc-help">Calendar shading counts all loaded check-ins, independently of table search and session filters.</p>
          {month !== today.slice(0, 7) && <button type="button" className="cc-text-action" onClick={() => { setMonth(today.slice(0, 7)); setDay(''); }}>This month</button>}
          {day && <button type="button" className="cc-text-action" onClick={() => setDay('')}>Clear selected date</button>}
        </div>}
        <div className="cc-history-records">
          <div className={`cc-history-filters${committee ? ' is-team' : ''}`}><div><label htmlFor={`history-search-${committee ? 'all' : 'own'}`}><Search size={14} aria-hidden="true" />Search attendance history</label><input id={`history-search-${committee ? 'all' : 'own'}`} value={query} onChange={event => setQuery(event.target.value)} placeholder={committee ? 'Session, employee or email' : 'Find a session'} /></div>{committee && <div><label htmlFor="history-record-date">History date</label><input id="history-record-date" type="date" max={today} value={day} onChange={event => setDay(event.target.value)} /></div>}<div><label htmlFor={`history-session-${committee ? 'all' : 'own'}`}>History session</label><select id={`history-session-${committee ? 'all' : 'own'}`} value={session} onChange={event => setSession(event.target.value)}><option value="">All sessions</option>{events.map(event => <option key={event.id} value={event.id}>{event.title}</option>)}</select></div><div><label htmlFor={`history-sort-${committee ? 'all' : 'own'}`}>Sort attendance history</label><select id={`history-sort-${committee ? 'all' : 'own'}`} value={sort} onChange={event => setSort(event.target.value)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="session">Session name</option><option value="session-desc">Session name · Z–A</option></select></div></div>
          <p className="cc-help" role="status">{filtered.length} of {logs.length} records{day ? ` · ${day}` : ' · All recorded dates'}</p>
          {(query || day || session) && <button type="button" className="cc-text-action" onClick={() => { setQuery(''); setDay(''); setSession(''); }}>Clear history filters</button>}
          <div className="cc-table-wrap" role="region" aria-label="Attendance check-in records" tabIndex={0}><table className="cc-record-table"><caption className="cc-table-caption">Recorded check-ins · India time · no absence or leave decisions</caption><thead><tr><th scope="col" aria-sort={sort === 'session' ? 'ascending' : sort === 'session-desc' ? 'descending' : 'none'}><button type="button" className="cc-sort-button" onClick={() => setSort(value => value === 'session' ? 'session-desc' : 'session')}>Session <span aria-hidden="true">{sort === 'session' ? '↑' : sort === 'session-desc' ? '↓' : '↕'}</span></button></th>{committee && <th scope="col">Employee</th>}<th scope="col" aria-sort={sort === 'newest' ? 'descending' : sort === 'oldest' ? 'ascending' : 'none'}><button type="button" className="cc-sort-button" onClick={() => setSort(value => value === 'newest' ? 'oldest' : 'newest')}>Original check-in · IST <span aria-hidden="true">{sort === 'newest' ? '↓' : sort === 'oldest' ? '↑' : '↕'}</span></button></th><th scope="col">Evidence</th></tr></thead><tbody>{filtered.map((log, index) => {
            const mode = attendanceMode(log);
            const phoneVerified = log.verification?.method === 'passkey-user-verification';
            const wifiObserved = log.wifi?.verification === 'native-client-observation' && log.wifi?.ssid === 'Shikshavertex_5G';
            return <tr key={log.id || `${log.eventId}-${log.uid || 'self'}-${index}`}><td><strong>{eventById.get(log.eventId)?.title || 'Attendance session'}</strong>{committee && log.reason && <p className="cc-help">Override reason: {log.reason}</p>}</td>{committee && <td>{log.fullName && <strong>{log.fullName}<br /></strong>}{log.email || log.rollNumber || 'Identity unavailable'}</td>}<td className="cc-time">{displayTime(log.timestamp)}</td><td><p className={`cc-chip cc-chip-${mode.tone}`}>{mode.label}</p>{phoneVerified && <span className="cc-evidence"><ShieldCheck size={13} aria-hidden="true" />Phone passkey verified</span>}{wifiObserved && <span className="cc-evidence">Office connection observed</span>}</td></tr>;
          })}</tbody></table></div>
          {!filtered.length && <p className="cc-empty">No attendance records match these filters.</p>}
        </div>
      </div>
    </>
  </div>;
}
