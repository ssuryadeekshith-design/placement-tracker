import { buildDailyReportCsv, csvCell } from './reportCsv';

test('CSV cells quote dates, delimiters, newlines and quotes', () => {
  expect(csvCell('2026-11-04')).toBe('"2026-11-04"');
  expect(csvCell('a,"quoted"\nvalue')).toBe('"a,""quoted""\nvalue"');
  expect(csvCell(null)).toBe('""');
  expect(csvCell(600)).toBe('"600"');
});

test('CSV cells neutralize formulas including whitespace and control prefixes', () => {
  for (const value of ['=HYPERLINK("https://example.com")', '+SUM(1,2)', '-1+2', '@SUM(1)', '\t=1+2', '\n@SUM(1)', '\r+1', '  =1+1', '\u00a0=1+1', '\u0000+1', '\tplain']) {
    expect(csvCell(value).startsWith('"\'')).toBe(true);
  }
  expect(csvCell('one@example.com')).toBe('"one@example.com"');
});

test('CSV exports selected member identity, unknown evidence, excursions, stops and route samples honestly', () => {
  const csv = buildDailyReportCsv({
    date: '2026-11-04', timezone: 'Asia/Kolkata',
    window: { start: '2026-11-04T05:00:00Z', end: '2026-11-04T15:00:00Z' },
    observedThrough: '2026-11-04T15:00:00Z', final: true,
    totals: { insideSeconds: 600, awaySeconds: 1200, unknownSeconds: 34200 },
    timeline: [{ state: 'unknown', startAt: '2026-11-04T05:00:00Z', endAt: '2026-11-04T05:05:00Z', durationSeconds: 300 }],
    excursions: [{ leftAt: '2026-11-04T06:00:00Z', returnedAt: null, durationSeconds: 1200, unknownSeconds: 600, departureWindow: { after: '2026-11-04T05:59:00Z', before: '2026-11-04T06:00:00Z' } }],
    visits: [{ latitude: 12.92, longitude: 77.63, startAt: '2026-11-04T06:05:00Z', endAt: '2026-11-04T06:15:00Z', dwellSeconds: 600, label: 'Do not invent a cafe name' }],
    route: [{ latitude: 12.92, longitude: 77.63, accuracyMeters: 5, capturedAt: '2026-11-04T06:05:00Z', state: 'away' }],
  }, { uid: 'selected-member', email: '=evil@example.com' });
  expect(csv.startsWith('"report_date","report_timezone","member_email","member_uid"')).toBe(true);
  expect(csv).toContain('"2026-11-04","Asia/Kolkata","\'=evil@example.com","selected-member"');
  expect(csv).toContain('"total","unknown","","","34200"');
  expect(csv).toContain('"timeline","unknown","2026-11-04T05:00:00Z","2026-11-04T05:05:00Z","300"');
  expect(csv).toContain('No reliable location evidence; do not infer attendance or absence.');
  expect(csv).toContain('"excursion","estimated_departure_return","2026-11-04T06:00:00Z","","1200","600"');
  expect(csv).toContain('Return was not observed.');
  expect(csv).toContain('"visit","approximate_offsite_stop"');
  expect(csv).toContain('"location_sample","away","2026-11-04T06:05:00Z"');
  expect(csv).not.toContain('Do not invent a cafe name');
});
