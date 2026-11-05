// Quoting alone does not prevent spreadsheet formula execution. Prefix cells
// that could be interpreted as formulas, including control/space prefixes.
export function csvCell(value) {
  let text = value === null || value === undefined ? '' : String(value);
  let firstContent = 0;
  while (firstContent < text.length && (text.charCodeAt(firstContent) <= 32 || /\s/.test(text[firstContent]))) firstContent += 1;
  if (['=', '+', '-', '@'].includes(text[firstContent]) || ['\t', '\r', '\n'].includes(text[0])) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function buildDailyReportCsv(report, member) {
  const columns = ['report_date', 'report_timezone', 'member_email', 'member_uid', 'record_type', 'label', 'start_at_iso', 'end_at_iso', 'duration_seconds', 'unknown_seconds', 'latitude', 'longitude', 'accuracy_meters', 'details'];
  const identity = [report.date, report.timezone || 'Asia/Kolkata', member.email, member.uid];
  const rows = [columns];
  const add = (kind, label, values = {}) => rows.push([...identity, kind, label,
    values.startAt, values.endAt, values.durationSeconds, values.unknownSeconds,
    values.latitude, values.longitude, values.accuracyMeters, values.details]);
  add('metadata', 'observation_window', { startAt: report.window?.start, endAt: report.window?.end, details: 'ISO timestamps retain their UTC offset. Location samples are estimates, not proof of uninterrupted presence.' });
  add('metadata', 'observed_through', { endAt: report.observedThrough, details: report.final === true ? 'Completed observation window' : 'Report may be incomplete; unknown intervals must remain unknown.' });
  for (const state of ['inside', 'away', 'unknown']) add('total', state, { durationSeconds: report.totals?.[`${state}Seconds`] });
  for (const interval of report.timeline || []) add('timeline', interval.state, { ...interval, details: interval.state === 'unknown' ? 'No reliable location evidence; do not infer attendance or absence.' : 'Estimated from location samples.' });
  for (const excursion of report.excursions || []) add('excursion', 'estimated_departure_return', {
    startAt: excursion.leftAt, endAt: excursion.returnedAt, durationSeconds: excursion.durationSeconds, unknownSeconds: excursion.unknownSeconds,
    details: [
      'Crossing times are estimates; duration includes only observed away time.',
      excursion.departureWindow ? `Departure between ${excursion.departureWindow.after} and ${excursion.departureWindow.before}.` : 'No earlier at-venue reading bounds departure.',
      excursion.returnWindow ? `Return between ${excursion.returnWindow.after} and ${excursion.returnWindow.before}.` : 'Return was not observed.',
    ].join(' '),
  });
  for (const visit of report.visits || []) add('visit', 'approximate_offsite_stop', { ...visit, durationSeconds: visit.dwellSeconds, details: 'Estimated coordinates and dwell time; business name, address and purpose are not verified.' });
  for (const point of report.route || []) add('location_sample', point.state, { ...point, startAt: point.capturedAt, details: 'Phone-reported coordinates; no location is inferred between distant or missing samples.' });
  return rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
