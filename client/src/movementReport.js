import { historyDate } from './AttendanceHistory';

export const movementInstant = value => typeof value === 'string' ? historyDate(value)?.getTime() ?? null : null;
export const movementTime = value => {
  const ms = movementInstant(value);
  return ms === null ? 'Not observed' : new Date(ms).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit' });
};
export function movementDuration(seconds) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return 'Not available';
  if (seconds > 0 && seconds < 60) return '<1 min';
  const minutes = Math.floor(seconds / 60);
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
export function movementCoordinates(location) {
  const { latitude, longitude } = location || {};
  if (![latitude, longitude].every(value => typeof value === 'number' && Number.isFinite(value)) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
}
const iso = ms => new Date(ms).toISOString();

/** Full-day projection: overlaps, uncovered gaps and later time never become presence. */
export function buildPresenceTimeline(report) {
  const start = movementInstant(report?.window?.start), end = movementInstant(report?.window?.end), through = movementInstant(report?.observedThrough);
  if (start === null || end === null || through === null || end <= start || through < start || through > end || !Array.isArray(report.timeline)) return null;
  let discarded = false;
  const intervals = report.timeline.flatMap(interval => {
    const rawStart = movementInstant(interval?.startAt), rawEnd = movementInstant(interval?.endAt);
    if (rawStart === null || rawEnd === null || rawEnd <= rawStart) { discarded = true; return []; }
    const from = Math.max(start, rawStart), to = Math.min(through, rawEnd);
    if (rawStart < start || rawEnd > through) discarded = true;
    return to > from ? [{ from, to, state: ['inside', 'away'].includes(interval.state) ? interval.state : 'unknown', reason: typeof interval.reason === 'string' ? interval.reason : '' }] : [];
  });
  const boundaries = [...new Set([start, through, end, ...intervals.flatMap(interval => [interval.from, interval.to])])].sort((a, b) => a - b);
  const segments = [];
  for (let index = 0; index < boundaries.length - 1; index++) {
    const from = boundaries[index], to = boundaries[index + 1]; if (to <= from) continue;
    const covering = intervals.filter(interval => interval.from <= from && interval.to >= to);
    const states = [...new Set(covering.map(interval => interval.state))];
    const future = from >= through;
    const state = !future && states.length === 1 ? states[0] : 'unknown';
    const reason = future ? 'Not yet observed in this snapshot' : states.length > 1 ? 'Conflicting location observations' : !covering.length ? 'No location observations' : state === 'unknown' ? covering.find(interval => interval.reason)?.reason || 'Uncertain location observations' : '';
    const previous = segments[segments.length - 1];
    if (previous?.state === state && previous.future === future && previous.reason === reason && previous.end === from) previous.end = to;
    else segments.push({ state, start: from, end: to, future, reason });
  }
  const totals = { insideSeconds: 0, awaySeconds: 0, unknownSeconds: 0 };
  for (const segment of segments) if (!segment.future) totals[`${segment.state}Seconds`] += (segment.end - segment.start) / 1000;
  const markers = [];
  const addMarker = (kind, value) => { const timestamp = movementInstant(value); if (timestamp !== null && timestamp >= start && timestamp <= through) markers.push({ kind, timestamp, left: (timestamp - start) / (end - start) * 100 }); };
  for (const excursion of Array.isArray(report.excursions) ? report.excursions : []) { addMarker('Estimated departure', excursion.leftAt); addMarker('Estimated return', excursion.returnedAt); }
  for (const visit of Array.isArray(report.visits) ? report.visits : []) addMarker('Approximate stop', visit.startAt);
  return { start, end, through, discarded, totals, futureSeconds: (end - through) / 1000, segments: segments.map(segment => ({ ...segment, left: (segment.start - start) / (end - start) * 100, width: (segment.end - segment.start) / (end - start) * 100 })), markers: markers.sort((a, b) => a.timestamp - b.timestamp) };
}

export function prepareMovementReport(report, date, uid) {
  const timeline = buildPresenceTimeline(report);
  const start = movementInstant(`${date}T10:30:00+05:30`), end = movementInstant(`${date}T20:30:00+05:30`);
  const fail = () => { throw new Error('Movement data could not be confirmed for the selected person and date. Reload the report.'); };
  if (!timeline || report.date !== date || report.uid !== uid || report.timezone !== 'Asia/Kolkata' || timeline.start !== start || timeline.end !== end || typeof report.final !== 'boolean' || report.final !== (timeline.through === end) || !['excursions', 'visits', 'route'].every(key => Array.isArray(report[key]))) fail();
  const inWindow = value => { const ms = movementInstant(value); return ms !== null && ms >= timeline.start && ms <= timeline.through; };
  const nonnegative = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
  if (!report.excursions.every(row => row && inWindow(row.leftAt) && (row.returnedAt === null || (inWindow(row.returnedAt) && movementInstant(row.returnedAt) >= movementInstant(row.leftAt))))) fail();
  if (!report.visits.every(row => row && inWindow(row.startAt) && inWindow(row.endAt) && movementInstant(row.endAt) >= movementInstant(row.startAt) && nonnegative(row.dwellSeconds) && row.dwellSeconds <= (movementInstant(row.endAt) - movementInstant(row.startAt)) / 1000 + 0.01)) fail();
  if (!report.route.every(row => row && inWindow(row.capturedAt) && movementCoordinates(row) !== null && nonnegative(row.accuracyMeters))) fail();
  const observedSegments = timeline.segments.filter(segment => !segment.future).map(segment => ({ state: segment.state, reason: segment.reason, startAt: iso(segment.start), endAt: iso(segment.end), durationSeconds: (segment.end - segment.start) / 1000 }));
  const overlap = (state, from, to) => timeline.segments.filter(segment => !segment.future && segment.state === state).reduce((sum, segment) => sum + Math.max(0, Math.min(segment.end, to) - Math.max(segment.start, from)) / 1000, 0);
  const validCrossing = (window, from, to) => window && inWindow(window.after) && inWindow(window.before) && movementInstant(window.after) <= movementInstant(window.before) && movementInstant(window.after) >= from && movementInstant(window.before) <= to ? { after: window.after, before: window.before } : null;
  const excursions = report.excursions.map(row => { const from = movementInstant(row.leftAt), to = row.returnedAt === null ? timeline.through : movementInstant(row.returnedAt); return { leftAt: row.leftAt, returnedAt: row.returnedAt, estimated: true, departureWindow: validCrossing(row.departureWindow, timeline.start, from), returnWindow: row.returnedAt === null ? null : validCrossing(row.returnWindow, from, to), durationSeconds: overlap('away', from, to), unknownSeconds: overlap('unknown', from, to), elapsedSeconds: (to - from) / 1000 }; });
  const adjusted = timeline.discarded || Object.keys(timeline.totals).some(key => !nonnegative(report.totals?.[key]) || Math.abs(report.totals[key] - timeline.totals[key]) > 0.01);
  const visits = report.visits.map(row => ({ startAt: row.startAt, endAt: row.endAt, dwellSeconds: row.dwellSeconds, estimated: true, ...(movementCoordinates(row) ? { latitude: row.latitude, longitude: row.longitude } : {}) }));
  const data = { ...report, visits, totals: timeline.totals, timeline: observedSegments, gaps: observedSegments.filter(segment => segment.state === 'unknown'), excursions };
  return { data, timeline, adjusted };
}
