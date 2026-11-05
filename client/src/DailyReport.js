import React, { useEffect, useRef, useState } from 'react';
import api from './api';
import { buildDailyReportCsv } from './reportCsv';

function indiaToday() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)?.value).join('-');
}
function duration(seconds) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return 'Not available';
  const minutes = Math.floor(seconds / 60);
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m${seconds > 0 && seconds < 60 ? ' (less than a minute)' : ''}`;
}
function time(value) {
  if (!value) return 'Not observed';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
function coordinates(location) {
  const { latitude, longitude } = location || {};
  if (![latitude, longitude].every(value => typeof value === 'number' && Number.isFinite(value))) return null;
  return `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
}
function errorMessage(error) {
  return error.response?.data?.error || 'Could not load this daily report. Please try again.';
}

export default function DailyReport({ user }) {
  const committee = user.role === 'committee';
  const [date, setDate] = useState(indiaToday);
  const [uid, setUid] = useState('');
  const [students, setStudents] = useState([]);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const request = useRef(0);
  const subject = committee && uid ? uid : user.uid;
  const reportKey = `${user.uid}:${subject}:${date}`;
  const report = result?.key === reportKey ? result.data : null;

  useEffect(() => {
    let active = true;
    request.current += 1; setResult(null); setError(''); setUid(''); setLoading(false); setStudents([]);
    if (committee) api.get('/students').then(({ data }) => {
      if (active) setStudents(Array.isArray(data) ? data : []);
    }).catch(failure => { if (active) setError(errorMessage(failure)); });
    return () => { active = false; request.current += 1; };
  }, [user.uid, committee]);

  function changeSelection(update) {
    request.current += 1; setResult(null); setLoading(false); setError(''); update();
  }
  function exportCsv() {
    if (!report) return;
    try {
      const member = subject === user.uid ? user : students.find(student => student.uid === subject) || { uid: subject, email: '' };
      const blob = new Blob(['\uFEFF', buildDailyReportCsv(report, member)], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `attendance-location-${String(report.date || date).replace(/[^0-9-]/g, '')}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch { setError('This browser could not download the CSV report. Please try another browser.'); }
  }
  async function load(event) {
    event.preventDefault();
    const current = ++request.current;
    setResult(null); setError(''); setLoading(true);
    const params = new URLSearchParams({ date });
    if (committee && uid) params.set('uid', uid);
    try {
      const { data } = await api.get(`/tracking/report?${params}`);
      if (current === request.current) setResult({ key: reportKey, data });
    } catch (failure) {
      if (current === request.current) setError(errorMessage(failure));
    } finally {
      if (current === request.current) setLoading(false);
    }
  }

  return <section className="card daily-report" aria-labelledby="daily-report-heading">
    <h2 id="daily-report-heading">Daily location report</h2>
    <p>Tracking hours: <strong>10:30 AM–8:30 PM, India time</strong>. Start tracking in the Android app after giving consent each day. The app shows a tracking notification and a stop control.</p>
    <p className="field-help">This website displays reports; it does not collect background locations. If the phone stops sending locations, those periods are unknown. Missing data is not evidence that a person was at or away from the venue.</p>
    <form className="report-controls" onSubmit={load}>
      <div><label htmlFor="report-date">Report date</label><input id="report-date" type="date" required max={indiaToday()} value={date} onChange={event => changeSelection(() => setDate(event.target.value))} /></div>
      {committee && <div><label htmlFor="report-member">Report for</label><select id="report-member" value={uid} onChange={event => changeSelection(() => setUid(event.target.value))}>
        <option value="">My report ({user.email})</option>
        {students.filter(student => student.uid !== user.uid).map(student => <option key={student.uid} value={student.uid}>{student.email}</option>)}
      </select></div>}
      <button className="primary" type="submit" disabled={loading || !date}>{loading ? 'Loading report…' : 'Load daily report'}</button>
    </form>
    {error && <p className="alert error" role="alert">{error}</p>}
    {report && <div className="report-results">
      <h3>Report for {report.date || date}</h3>
      <button className="secondary" type="button" onClick={exportCsv}>Export CSV</button>
      <p className="field-help">Downloads the selected person’s loaded report and location samples to this device. Nothing is emailed. Exported timestamps use ISO format with their UTC offset.</p>
      <p className="field-help">All times below are in India time. {report.observedThrough && <>Data considered through {time(report.observedThrough)}.</>} Durations and crossing times are estimates from location samples.</p>
      <dl className="report-totals">
        <div><dt>Observed at venue</dt><dd>{duration(report.totals?.insideSeconds)}</dd></div>
        <div><dt>Observed away</dt><dd>{duration(report.totals?.awaySeconds)}</dd></div>
        <div><dt>Unknown time</dt><dd>{duration(report.totals?.unknownSeconds)}</dd></div>
      </dl>
      {!report.route?.length && !report.excursions?.length && !report.visits?.length && <p className="callout">No confirmed movement observations are available for this day. Do not interpret this as a full day of attendance.</p>}
      <h3>Departures and returns</h3>
      {report.excursions?.length ? <div className="report-table-wrap"><table className="report-table"><thead><tr><th scope="col">Estimated departure</th><th scope="col">Estimated return</th><th scope="col">Observed away duration</th><th scope="col">Unknown during excursion</th></tr></thead><tbody>
        {report.excursions.map((excursion, index) => <tr key={`${excursion.leftAt}-${index}`}><td>{time(excursion.leftAt)}{excursion.departureWindow && <p className="field-help">Between {time(excursion.departureWindow.after)} and {time(excursion.departureWindow.before)}</p>}</td><td>{time(excursion.returnedAt)}{excursion.returnWindow && <p className="field-help">Between {time(excursion.returnWindow.after)} and {time(excursion.returnWindow.before)}</p>}</td><td>{duration(excursion.durationSeconds)}</td><td>{duration(excursion.unknownSeconds)}</td></tr>)}
      </tbody></table></div> : <p className="empty-state">No departure and return pair was confirmed by the available samples.</p>}
      <h3>Observed stops away from the venue</h3>
      <p className="field-help">Stops identify approximate coordinates, not a verified business, address or purpose of travel.</p>
      {report.visits?.length ? <div className="history-list">{report.visits.map((visit, index) => {
        const coordinateLabel = coordinates(visit);
        return <article className="history-row" key={`${visit.startAt}-${index}`}><div><strong>{coordinateLabel ? `Location near ${coordinateLabel}` : 'Approximate stop'}</strong>
          <p>{time(visit.startAt)}–{time(visit.endAt)} · observed duration {duration(visit.dwellSeconds)}</p>
          {coordinateLabel && <a href={`https://www.google.com/maps?q=${encodeURIComponent(`${visit.latitude},${visit.longitude}`)}`} target="_blank" rel="noreferrer">View approximate location on Maps ↗</a>}
        </div></article>;
      })}</div> : <p className="empty-state">No stationary off-site stop was confirmed.</p>}
      <h3>Observation timeline</h3>
      {report.timeline?.length ? <ol className="report-timeline">{report.timeline.map((interval, index) => <li key={`${interval.startAt}-${index}`}>
        <strong>{interval.state === 'inside' ? 'At venue' : interval.state === 'away' ? 'Away from venue' : 'Unknown — no reliable location evidence'}</strong>
        <span>{time(interval.startAt)}–{time(interval.endAt)} · {duration(interval.durationSeconds)}</span>
      </li>)}</ol> : <p className="empty-state">No observation intervals are available.</p>}
    </div>}
  </section>;
}
