import React, { useEffect, useRef, useState } from 'react';
import api from './api';
import { buildDailyReportCsv } from './reportCsv';
import { indiaDay } from './AttendanceHistory';
import { movementTime as time, movementDuration as duration, movementCoordinates as coordinates, prepareMovementReport } from './movementReport';
import './WorkforcePanels.css';
import './MovementReport.css';
export { buildPresenceTimeline } from './movementReport';

const indiaToday = () => indiaDay(Date.now());
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const errorMessage = error => error.response?.data?.error || error.message || 'Could not load this movement report. Please try again.';
const iso = value => new Date(value).toISOString();
const stateLabel = segment => segment.future ? 'Not yet observed in this snapshot' : segment.state === 'inside' ? 'Estimated at venue' : segment.state === 'away' ? 'Estimated away' : 'Unknown — no reliable location evidence';

function PresenceTimeline({ timeline }) {
  return <figure className="presence-figure" aria-labelledby="presence-timeline-title">
    <figcaption id="presence-timeline-title"><strong>Workday presence timeline</strong><span>India time · estimates from consented location samples</span></figcaption>
    <div className="presence-legend"><span className="legend-inside">Estimated at venue</span><span className="legend-away">Estimated away</span><span className="legend-unknown">Unknown / not yet observed</span></div>
    <div className="presence-track" role="img" aria-label={`Workday location observation timeline. Estimated venue time ${duration(timeline.totals.insideSeconds)}, estimated away time ${duration(timeline.totals.awaySeconds)}, elapsed unknown time ${duration(timeline.totals.unknownSeconds)}. Later time not yet observed: ${duration(timeline.futureSeconds)}. A text list of unknown gaps and all intervals follows.`}>
      {timeline.segments.map((segment, index) => <span key={index} className={`presence-segment ${segment.state}${segment.future ? ' future' : ''}`} style={{ left: `${segment.left}%`, width: `${segment.width}%` }} title={`${stateLabel(segment)}: ${time(iso(segment.start))}–${time(iso(segment.end))}`} />)}
      {timeline.markers.map((marker, index) => <span key={index} className={`presence-marker ${marker.kind === 'Approximate stop' ? 'stop' : ''}`} style={{ left: `${marker.left}%` }} title={`${marker.kind} · ${time(iso(marker.timestamp))}`} />)}
    </div>
    <div className="presence-axis"><span>{time(iso(timeline.start))}</span><span>{time(iso(timeline.end))}</span></div>
    <p className="field-help">Striped sections have no reliable location evidence. Later hours after the snapshot cutoff are separate from elapsed unknown gaps. Neither proves presence, absence or a particular floor.</p>
    {timeline.markers.length > 0 && <ul className="presence-markers" aria-label="Departure, return and approximate stop markers">{timeline.markers.map((marker, index) => <li key={index}><span className="workforce-badge neutral">{marker.kind}</span><time dateTime={iso(marker.timestamp)}>{time(iso(marker.timestamp))}</time></li>)}</ul>}
  </figure>;
}

export default function DailyReport({ user, accountsRevision = 0 }) {
  const committee = user.role === 'committee';
  const authorized = validId(user.uid) && ['student', 'committee'].includes(user.role);
  const [date, setDate] = useState(indiaToday); const [uid, setUid] = useState('');
  const [students, setStudents] = useState([]); const [rosterLoading, setRosterLoading] = useState(false); const [rosterError, setRosterError] = useState('');
  const [result, setResult] = useState(null); const [loading, setLoading] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const request = useRef(0); const lock = useRef(false);
  const subject = committee && uid ? uid : user.uid;
  const reportKey = `${user.uid}:${user.role}:${subject}:${date}`;
  const loaded = authorized && result?.key === reportKey ? result : null;
  const report = loaded?.data; const timeline = loaded?.timeline;
  const gaps = timeline?.segments.filter(segment => !segment.future && segment.state === 'unknown') || [];

  useEffect(() => {
    let active = true;
    request.current += 1; lock.current = false; setResult(null); setError(''); setNotice(''); setUid(''); setLoading(false); setStudents([]); setRosterError(''); setRosterLoading(committee && authorized);
    if (committee && authorized) api.get('/students').then(({ data }) => {
      if (!active) return;
      if (!Array.isArray(data) || data.some(row => !row || !validId(row.uid) || typeof row.email !== 'string') || new Set(data.map(row => row.uid)).size !== data.length) throw new Error('Registered accounts could not be confirmed. Reload this screen to retry the account list.');
      setStudents(data);
    }).catch(failure => { if (active) setRosterError(errorMessage(failure)); }).finally(() => { if (active) setRosterLoading(false); });
    return () => { active = false; request.current += 1; lock.current = false; };
  }, [user.uid, user.role, committee, authorized, accountsRevision]);

  function changeSelection(update) { request.current += 1; lock.current = false; setResult(null); setLoading(false); setError(''); setNotice(''); update(); }
  function exportCsv() {
    if (!loaded) return;
    setError(''); setNotice('');
    try {
      const url = URL.createObjectURL(new Blob(['\uFEFF', buildDailyReportCsv(report, loaded.member)], { type: 'text/csv;charset=utf-8' }));
      const anchor = document.createElement('a');
      try { anchor.href = url; anchor.download = `attendance-location-${report.date}.csv`; document.body.appendChild(anchor); anchor.click(); }
      finally { anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 0); }
      setNotice('Movement CSV download requested for the loaded person and date. Unknown intervals remain unknown.');
    } catch { setError('This browser could not download the CSV report. Check your browser download settings and try again.'); }
  }
  async function load(event) {
    event.preventDefault(); if (!authorized || loading || lock.current) return;
    const current = ++request.current; lock.current = true;
    setResult(null); setError(''); setNotice(''); setLoading(true);
    const params = new URLSearchParams({ date });
    if (committee && uid) params.set('uid', uid);
    try {
      const day = new Date(`${date}T00:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== date || date > indiaToday()) throw new Error('Choose a valid report date up to today, India time.');
      const member = subject === user.uid ? user : students.find(student => student.uid === subject);
      if (!member) throw new Error('Select a confirmed registered account before loading their movement report.');
      const { data } = await api.get(`/tracking/report?${params}`);
      if (current !== request.current) return;
      const prepared = prepareMovementReport(data, date, subject);
      setResult({ key: reportKey, ...prepared, member: { uid: subject, email: typeof data.email === 'string' && data.email ? data.email : member.email || '', fullName: typeof member.fullName === 'string' ? member.fullName : '' } });
    } catch (failure) { if (current === request.current) setError(errorMessage(failure)); }
    finally { if (current === request.current) { lock.current = false; setLoading(false); } }
  }

  if (!authorized) return <section className="card movement-panel"><h2>Movement report</h2><p className="workforce-notice">Movement reports require employee or HR access. Read-only attendance access does not grant movement-history access.</p></section>;
  return <section className="card daily-report movement-panel" aria-labelledby="daily-report-heading">
    <header className="workforce-panel-heading"><div><p className="eyebrow">Movement & presence</p><h2 id="daily-report-heading">Daily location report</h2></div><span className="workforce-badge neutral">10:30 AM – 8:30 PM IST</span></header>
    <p>Estimated venue time, away time and stops from the selected day’s phone location samples.</p>
    <p className="field-help">Daily consent and sharing controls are in the Android app. This website displays reports and does not collect background locations. Missing data does not establish where a person was.</p>
    <form className="report-controls" onSubmit={load}>
      <div><label htmlFor="report-date">Report date</label><input id="report-date" type="date" required max={indiaToday()} value={date} onChange={event => changeSelection(() => setDate(event.target.value))} /></div>
      {committee && <div><label htmlFor="report-member">Report for</label><select id="report-member" value={uid} disabled={rosterLoading} onChange={event => changeSelection(() => setUid(event.target.value))}>
        <option value="">My report ({user.email})</option>
        {students.filter(student => student.uid !== user.uid).map(student => <option key={student.uid} value={student.uid}>{student.email}</option>)}
      </select></div>}
      <button className="primary" type="submit" disabled={loading || !date}>{loading ? 'Loading report…' : 'Load daily report'}</button>
    </form>
    {rosterLoading && <p role="status" className="field-help">Loading registered accounts for explicit HR selection…</p>}
    {rosterError && <p className="movement-context-note" role="alert">{rosterError} You can try loading your own report.</p>}
    {loading && <p role="status" className="workforce-notice">Loading the selected person and date. Previous report and export are cleared.</p>}
    {error && <p className="alert error" role="alert">{error}</p>}
    {!report && !loading && !error && <p className="workforce-notice">Choose a date{committee ? ' and person' : ''}, then load a report. A report is a snapshot, not a live location indicator.</p>}
    {notice && <p role="status" className="movement-saved-notice">{notice}</p>}
    {report && <div className="report-results">
      <header className="workforce-panel-heading report-result-heading"><div><p className="eyebrow">Loaded report · {loaded.member.email || loaded.member.uid}</p><h3>Report for {report.date}</h3></div><button className="secondary" type="button" aria-label="Export CSV" onClick={exportCsv}>Export movement report (CSV)</button></header>
      <div className="movement-snapshot"><span className={`workforce-badge ${report.final ? 'neutral' : 'warning'}`}>{report.final ? 'Day window ended' : 'Partial-day snapshot'}</span><p>Data considered through <strong>{time(report.observedThrough)} IST</strong>. This does not establish the employee’s current location.</p>{timeline.futureSeconds > 0 && <p><strong>Not yet observed: {duration(timeline.futureSeconds)}</strong> after this cutoff. These later hours are separate from elapsed unknown time.</p>}</div>
      <p className="field-help">All times use India time. Estimates are not payroll hours, exact boundary crossings or proof of uninterrupted presence.</p>
      {loaded.adjusted && <p className="movement-context-note" role="status">Summary and export use the conservative timeline projection. Incomplete or conflicting intervals remain unknown; supplied totals were not used to fill them.</p>}
      <dl className="report-totals">
        <div><dt>Estimated at venue</dt><dd>{duration(report.totals.insideSeconds)}</dd></div>
        <div><dt>Estimated away</dt><dd>{duration(report.totals.awaySeconds)}</dd></div>
        <div><dt>Unknown before cutoff</dt><dd>{duration(report.totals.unknownSeconds)}</dd></div>
      </dl>
      {!report.route.length && !report.excursions.length && !report.visits.length && report.totals.insideSeconds === 0 && report.totals.awaySeconds === 0 && <p className="movement-context-note">No confirmed movement observations are available for this day. Do not interpret this as a full day of attendance.</p>}
      <PresenceTimeline timeline={timeline} />
      <section className="movement-section" aria-labelledby="movement-crossings-title"><h3 id="movement-crossings-title">Departures and returns</h3><p className="field-help">Departure is the first outside sample; return is the next inside sample. Crossing windows show the bounds supplied by surrounding samples, not exact crossing times.</p>
      {report.excursions.length ? <div className="report-table-wrap" role="region" aria-label="Estimated departures and returns" tabIndex={0}><table className="report-table"><caption>Sample-based excursion estimates · India time</caption><thead><tr><th scope="col">Estimated departure</th><th scope="col">Estimated return</th><th scope="col">Estimated away duration</th><th scope="col">Unknown during excursion</th></tr></thead><tbody>
        {report.excursions.map((excursion, index) => <tr key={`${excursion.leftAt}-${index}`}><td><strong>{time(excursion.leftAt)}</strong><p className="field-help">First outside sample</p>{excursion.departureWindow ? <p>Between {time(excursion.departureWindow.after)} and {time(excursion.departureWindow.before)}</p> : <p>No earlier venue sample bounds departure.</p>}</td><td><strong>{excursion.returnedAt ? time(excursion.returnedAt) : 'Return not observed'}</strong>{excursion.returnedAt && <p className="field-help">Next inside sample</p>}{excursion.returnWindow && <p>Between {time(excursion.returnWindow.after)} and {time(excursion.returnWindow.before)}</p>}{!excursion.returnedAt && <p>Later location cannot be established from this snapshot.</p>}</td><td>{duration(excursion.durationSeconds)}<p className="field-help">Elapsed interval: {duration(excursion.elapsedSeconds)}; unknown portions are not counted as away.</p></td><td><span className="workforce-badge warning">{duration(excursion.unknownSeconds)}</span></td></tr>)}
      </tbody></table></div> : <p className="empty-state">No departure or return estimate is available. Missing samples do not establish that the employee remained at the venue.</p>}</section>
      <section className="movement-section" aria-labelledby="movement-stops-title"><h3 id="movement-stops-title">Approximate offsite stops</h3><p className="field-help">Nearby samples grouped into estimated stops. Coordinates and dwell time do not verify a business, address, purpose, floor or continuous stay.</p>
      {report.visits.length ? <div className="movement-stop-list">{report.visits.map((visit, index) => {
        const coordinateLabel = coordinates(visit);
        return <article className="movement-stop" key={`${visit.startAt}-${index}`}><span className="workforce-badge neutral">Approximate stop {index + 1}</span><strong>{coordinateLabel ? `Location near ${coordinateLabel}` : 'Coordinates unavailable'}</strong>
          <p>{time(visit.startAt)}–{time(visit.endAt)} IST</p><p>Estimated dwell: <strong>{duration(visit.dwellSeconds)}</strong></p>
          {coordinateLabel && <a href={`https://www.google.com/maps?q=${encodeURIComponent(`${visit.latitude},${visit.longitude}`)}`} target="_blank" rel="noreferrer">View approximate location on Maps ↗</a>}
        </article>;
      })}</div> : <p className="empty-state">No qualifying offsite stop estimate is available. Travel or missing observations may still have occurred.</p>}</section>
      <section className="movement-section" aria-labelledby="movement-gaps-title"><h3 id="movement-gaps-title">Unknown observation gaps</h3><p className="field-help">Elapsed gaps before the cutoff are never assigned to the venue or an offsite place.</p>
      {gaps.length ? <ol className="movement-gap-list">{gaps.map((segment, index) => <li key={index}><span className="workforce-badge warning">Unknown — no reliable location evidence</span><strong>{time(iso(segment.start))}–{time(iso(segment.end))} IST · {duration((segment.end - segment.start) / 1000)}</strong><p>{segment.reason}</p></li>)}</ol> : <p className="empty-state">No elapsed unknown gap appears in this snapshot. This does not prove uninterrupted presence.</p>}
      {timeline.futureSeconds > 0 && <p className="movement-context-note">Not yet observed in this snapshot: {time(report.observedThrough)}–{time(report.window.end)} IST · {duration(timeline.futureSeconds)}. These later hours are not elapsed absence.</p>}</section>
      <details className="movement-intervals"><summary>All observation intervals ({timeline.segments.length})</summary><ol className="report-timeline">{timeline.segments.map((interval, index) => <li className={interval.state} key={index}><strong>{stateLabel(interval)}</strong><span>{time(iso(interval.start))}–{time(iso(interval.end))} IST · {duration((interval.end - interval.start) / 1000)}</span>{interval.reason && <span>{interval.reason}</span>}</li>)}</ol></details>
      <p className="field-help movement-export-note">CSV downloads this selected person’s loaded report and location samples locally; nothing is emailed. It uses the same conservative totals and elapsed gaps, retains unknown time and ISO timestamps, and excludes later unobserved hours from elapsed totals.</p>
    </div>}
  </section>;
}
