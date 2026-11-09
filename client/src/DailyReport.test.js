import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import DailyReport, { buildPresenceTimeline } from './DailyReport';
import api from './api';

jest.mock('./api', () => ({ get: jest.fn() }));
const member = { uid: 'member-1', email: 'one@shikshavertex.in', role: 'student' };
const emptyReport = {
  date: '2026-11-04', uid: member.uid, timezone: 'Asia/Kolkata',
  window: { start: '2026-11-04T05:00:00Z', end: '2026-11-04T15:00:00Z' }, observedThrough: '2026-11-04T15:00:00Z', final: true,
  totals: { insideSeconds: 0, awaySeconds: 0, unknownSeconds: 36000 },
  excursions: [], visits: [], route: [], timeline: [{ state: 'unknown', startAt: '2026-11-04T05:00:00Z', endAt: '2026-11-04T15:00:00Z', durationSeconds: 36000 }],
};
beforeEach(() => {
  jest.clearAllMocks();
  api.get.mockResolvedValue({ data: emptyReport });
});
function chooseDate() {
  fireEvent.change(screen.getByLabelText('Report date'), { target: { value: '2026-11-04' } });
}

test('a member requests only their own report and never starts browser tracking', async () => {
  const getCurrentPosition = jest.fn(); const watchPosition = jest.fn();
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition, watchPosition } });
  render(<DailyReport user={member} />);
  expect(api.get).not.toHaveBeenCalled();
  expect(screen.queryByLabelText('Report for')).not.toBeInTheDocument();
  chooseDate(); fireEvent.click(screen.getByRole('button', { name: 'Load daily report' }));
  await waitFor(() => expect(api.get).toHaveBeenCalledWith('/tracking/report?date=2026-11-04'));
  expect(await screen.findByText('10h 0m', { selector: 'dd' })).toBeInTheDocument();
  expect(screen.getByText(/No confirmed movement observations/)).toBeInTheDocument();
  expect(within(screen.getByRole('region', { name: 'Unknown observation gaps' })).getByText('Unknown — no reliable location evidence')).toBeInTheDocument();
  expect(getCurrentPosition).not.toHaveBeenCalled(); expect(watchPosition).not.toHaveBeenCalled();
});

test('estimated visits and return times show coordinates, durations and a safe Maps link', async () => {
  api.get.mockResolvedValue({ data: { ...emptyReport,
    totals: { insideSeconds: 600, awaySeconds: 1200, unknownSeconds: 34200 },
    timeline: [{ state: 'inside', startAt: '2026-11-04T05:00:00Z', endAt: '2026-11-04T05:10:00Z' }, { state: 'unknown', startAt: '2026-11-04T05:10:00Z', endAt: '2026-11-04T06:00:00Z' }, { state: 'away', startAt: '2026-11-04T06:00:00Z', endAt: '2026-11-04T06:20:00Z' }, { state: 'unknown', startAt: '2026-11-04T06:20:00Z', endAt: '2026-11-04T15:00:00Z' }],
    excursions: [{ leftAt: '2026-11-04T06:00:00Z', returnedAt: '2026-11-04T06:20:00Z', durationSeconds: 1200 }],
    visits: [{ latitude: 12.92, longitude: 77.63, startAt: '2026-11-04T06:05:00Z', endAt: '2026-11-04T06:15:00Z', dwellSeconds: 600, label: 'Do not claim this is a cafe', mapsUrl: 'javascript:alert(1)' }],
  } });
  render(<DailyReport user={member} />); chooseDate();
  fireEvent.click(screen.getByRole('button', { name: 'Load daily report' }));
  expect(await screen.findByText('Location near 12.92000, 77.63000')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /View approximate location/ })).toHaveAttribute('href', 'https://www.google.com/maps?q=12.92%2C77.63');
  expect(screen.queryByText('Do not claim this is a cafe')).not.toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: 'Estimated departure' })).toBeInTheDocument();
  expect(screen.getByText(/Estimated dwell:/)).toHaveTextContent('0h 10m');
});

test('permission errors clear a previously loaded report', async () => {
  render(<DailyReport user={member} />); chooseDate();
  fireEvent.click(screen.getByRole('button', { name: 'Load daily report' }));
  await screen.findByRole('heading', { name: 'Report for 2026-11-04' });
  api.get.mockRejectedValueOnce({ response: { data: { error: 'Committee access is required.' } } });
  fireEvent.click(screen.getByRole('button', { name: 'Load daily report' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Committee access is required.');
  expect(screen.queryByRole('heading', { name: 'Report for 2026-11-04' })).not.toBeInTheDocument();
});

test('committee explicitly selects a registered member before requesting their report', async () => {
  api.get.mockImplementation(path => Promise.resolve({ data: path === '/students' ? [member, { uid: 'other-uid', email: 'two@shikshavertex.in' }] : { ...emptyReport, uid: new URLSearchParams(path.split('?')[1]).get('uid') || member.uid } }));
  render(<DailyReport user={{ ...member, role: 'committee' }} />);
  expect(await screen.findByRole('option', { name: 'two@shikshavertex.in' })).toBeInTheDocument();
  expect(api.get).toHaveBeenCalledTimes(1);
  chooseDate(); fireEvent.change(screen.getByLabelText('Report for'), { target: { value: 'other-uid' } });
  fireEvent.click(screen.getByRole('button', { name: 'Load daily report' }));
  await waitFor(() => expect(api.get).toHaveBeenCalledWith('/tracking/report?date=2026-11-04&uid=other-uid'));
});

test('changing the selected date discards an older pending response', async () => {
  let finish;
  api.get.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  render(<DailyReport user={member} />); chooseDate();
  fireEvent.click(screen.getByRole('button', { name: 'Load daily report' }));
  fireEvent.change(screen.getByLabelText('Report date'), { target: { value: '2026-11-03' } });
  await act(async () => finish({ data: emptyReport }));
  expect(screen.queryByRole('heading', { name: 'Report for 2026-11-04' })).not.toBeInTheDocument();
});

test('CSV export is available only for the loaded selection and downloads locally', async () => {
  URL.createObjectURL = jest.fn().mockReturnValue('blob:local-report');
  URL.revokeObjectURL = jest.fn();
  const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  render(<DailyReport user={member} />); chooseDate();
  expect(screen.queryByRole('button', { name: 'Export CSV' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Load daily report' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Export CSV' }));
  expect(URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
  expect(click).toHaveBeenCalledTimes(1);
  expect(api.get).toHaveBeenCalledTimes(1);
  fireEvent.change(screen.getByLabelText('Report date'), { target: { value: '2026-11-03' } });
  expect(screen.queryByRole('button', { name: 'Export CSV' })).not.toBeInTheDocument();
  click.mockRestore();
});

test('full-workday timeline leaves reporting gaps and time beyond observed-through unknown', () => {
  const result = buildPresenceTimeline({ ...emptyReport, observedThrough: '2026-11-04T06:00:00Z', timeline: [{ state: 'inside', startAt: '2026-11-04T05:15:00Z', endAt: '2026-11-04T06:30:00Z' }] });
  expect(result.start).toBe(Date.parse('2026-11-04T05:00:00Z'));
  expect(result.end).toBe(Date.parse('2026-11-04T15:00:00Z'));
  expect(result.segments.map(segment => segment.state)).toEqual(['unknown', 'inside', 'unknown']);
  expect(result.segments[0].width).toBeCloseTo(2.5);
  expect(result.segments[1].end).toBe(Date.parse('2026-11-04T06:00:00Z'));
  expect(result.segments.reduce((sum, segment) => sum + segment.width, 0)).toBeCloseTo(100);
});

test('contradictory overlapping movement states remain unknown and markers come only from actual timestamps', () => {
  const result = buildPresenceTimeline({ ...emptyReport, timeline: [
    { state: 'inside', startAt: '2026-11-04T05:00:00Z', endAt: '2026-11-04T06:00:00Z' },
    { state: 'away', startAt: '2026-11-04T05:30:00Z', endAt: '2026-11-04T06:30:00Z' },
  ], excursions: [{ leftAt: '2026-11-04T05:30:00Z', returnedAt: null }], visits: [{ startAt: 'bad-time' }, { startAt: '2026-11-04T06:15:00Z' }] });
  expect(result.segments.map(segment => segment.state)).toEqual(['inside', 'unknown', 'away', 'unknown']);
  expect(result.markers.map(marker => marker.kind)).toEqual(['Estimated departure', 'Approximate stop']);
  expect(result.markers[0].left).toBeCloseTo(5);
  expect(buildPresenceTimeline({ date: 'bad', timeline: [] })).toBeNull();
});

test('partial-day reports separate elapsed unknown gaps from later unobserved hours', async () => {
  api.get.mockResolvedValue({ data: { ...emptyReport, observedThrough: '2026-11-04T06:00:00Z', final: false } });
  render(<DailyReport user={member} />); chooseDate(); fireEvent.click(screen.getByRole('button', { name: 'Load daily report' }));
  await screen.findByRole('heading', { name: 'Report for 2026-11-04' });
  expect(screen.getByText('Unknown before cutoff').nextSibling).toHaveTextContent('1h 0m');
  expect(screen.getByText('Partial-day snapshot')).toBeInTheDocument();
  expect(screen.getByText('Not yet observed: 9h 0m')).toBeInTheDocument();
  expect(screen.getByText(/supplied totals were not used/)).toBeInTheDocument();
  const gaps = screen.getByRole('region', { name: 'Unknown observation gaps' });
  expect(within(gaps).getByText(/11:30:00 am.*08:30:00 pm/i)).toHaveTextContent('9h 0m');
});

test('missing cutoff, foreign identity/date and incomplete arrays never become a full-day report or export', async () => {
  const invalid = [
    { ...emptyReport, observedThrough: undefined }, { ...emptyReport, uid: 'another-person' },
    { ...emptyReport, date: '2026-11-03' }, { ...emptyReport, timeline: {} },
    { ...emptyReport, observedThrough: 'yesterday' }, { ...emptyReport, route: null },
  ];
  for (const data of invalid) {
    api.get.mockResolvedValueOnce({ data });
    const view = render(<DailyReport user={member} />); chooseDate(); fireEvent.click(screen.getByRole('button', { name: 'Load daily report' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be confirmed');
    expect(screen.queryByRole('button', { name: 'Export CSV' })).not.toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /Workday location/ })).not.toBeInTheDocument();
    view.unmount();
  }
});

test('open excursions show no invented return or all-away elapsed duration', async () => {
  api.get.mockResolvedValueOnce({ data: { ...emptyReport, observedThrough: '2026-11-04T06:00:00Z', final: false,
    totals: { insideSeconds: 0, awaySeconds: 600, unknownSeconds: 3000 },
    timeline: [{ state: 'away', startAt: '2026-11-04T05:00:00Z', endAt: '2026-11-04T05:10:00Z' }],
    excursions: [{ leftAt: '2026-11-04T05:00:00Z', returnedAt: null, durationSeconds: 3600, unknownSeconds: 0 }],
  } });
  render(<DailyReport user={member} />); chooseDate(); fireEvent.click(screen.getByRole('button', { name: 'Load daily report' }));
  const crossings = await screen.findByRole('region', { name: 'Estimated departures and returns' });
  expect(within(crossings).getByText('Return not observed')).toBeInTheDocument();
  expect(within(crossings).getByText(/No earlier venue sample bounds departure/)).toBeInTheDocument();
  expect(within(crossings).getByRole('cell', { name: /0h 10m Elapsed interval: 1h 0m/ })).toBeInTheDocument();
  expect(within(crossings).getByText('0h 50m')).toBeInTheDocument();
});

test('invalid stop coordinates never produce a Maps link or a named place', async () => {
  api.get.mockResolvedValueOnce({ data: { ...emptyReport, visits: [{ startAt: '2026-11-04T06:00:00Z', endAt: '2026-11-04T06:05:00Z', dwellSeconds: 300, latitude: 91, longitude: 77.63, label: 'A named cafe', mapsUrl: 'javascript:alert(1)' }] } });
  render(<DailyReport user={member} />); chooseDate(); fireEvent.click(screen.getByRole('button', { name: 'Load daily report' }));
  expect(await screen.findByText('Coordinates unavailable')).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /View approximate location/ })).not.toBeInTheDocument();
  expect(screen.queryByText('A named cafe')).not.toBeInTheDocument();
});

test('CSV and summary agree when overlapping or missing intervals must become unknown', async () => {
  URL.createObjectURL = jest.fn().mockReturnValue('blob:movement'); URL.revokeObjectURL = jest.fn();
  const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  api.get.mockResolvedValueOnce({ data: { ...emptyReport, totals: { insideSeconds: 3600, awaySeconds: 3600, unknownSeconds: 28800 },
    timeline: [{ state: 'inside', startAt: '2026-11-04T05:00:00Z', endAt: '2026-11-04T06:00:00Z' }, { state: 'away', startAt: '2026-11-04T05:30:00Z', endAt: '2026-11-04T06:30:00Z' }],
  } });
  try {
    render(<DailyReport user={member} />); chooseDate(); fireEvent.click(screen.getByRole('button', { name: 'Load daily report' }));
    await screen.findByRole('button', { name: 'Export CSV' });
    expect(screen.getByText('Estimated at venue', { selector: 'dt' }).nextSibling).toHaveTextContent('0h 30m');
    expect(screen.getByText('Estimated away', { selector: 'dt' }).nextSibling).toHaveTextContent('0h 30m');
    expect(screen.getByText('Unknown before cutoff').nextSibling).toHaveTextContent('9h 0m');
    expect(screen.getByText('Conflicting location observations', { selector: 'p' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    const csv = await new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsText(URL.createObjectURL.mock.calls[0][0]); });
    expect(csv).toContain('"total","inside","","","1800"');
    expect(csv).toContain('"total","away","","","1800"');
    expect(csv).toContain('"total","unknown","","","32400"');
    expect(csv).toContain('"timeline","unknown","2026-11-04T05:30:00.000Z","2026-11-04T06:00:00.000Z","1800"');
  } finally { click.mockRestore(); }
});

test('a role change clears an HR report immediately and read-only attendance viewers cannot request movement data', async () => {
  api.get.mockImplementation(path => Promise.resolve({ data: path === '/students' ? [{ uid: 'other', email: 'other@shikshavertex.in' }] : { ...emptyReport, uid: 'other' } }));
  const view = render(<DailyReport user={{ ...member, role: 'committee' }} />);
  await screen.findByRole('option', { name: 'other@shikshavertex.in' }); chooseDate();
  fireEvent.change(screen.getByLabelText('Report for'), { target: { value: 'other' } }); fireEvent.click(screen.getByRole('button', { name: 'Load daily report' }));
  await screen.findByRole('button', { name: 'Export CSV' });
  view.rerender(<DailyReport user={{ ...member, role: 'attendance-viewer' }} />);
  expect(screen.queryByRole('button', { name: 'Export CSV' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Load daily report' })).not.toBeInTheDocument();
  expect(screen.getByText(/Read-only attendance access does not grant movement-history access/)).toBeInTheDocument();
  expect(api.get).toHaveBeenCalledTimes(2);
});

test('a failed or malformed roster never fabricates members and still allows requesting the own report', async () => {
  api.get.mockResolvedValueOnce({ data: { rows: [member] } }).mockResolvedValueOnce({ data: emptyReport });
  render(<DailyReport user={{ ...member, role: 'committee' }} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Registered accounts could not be confirmed');
  expect(screen.getAllByRole('option')).toHaveLength(1); chooseDate();
  fireEvent.click(screen.getByRole('button', { name: 'Load daily report' }));
  await screen.findByRole('heading', { name: 'Report for 2026-11-04' });
  expect(api.get).toHaveBeenLastCalledWith('/tracking/report?date=2026-11-04');
});

test('blank report dates do not start API reads or retain previous exports', async () => {
  render(<DailyReport user={member} />); chooseDate(); fireEvent.click(screen.getByRole('button', { name: 'Load daily report' }));
  await screen.findByRole('button', { name: 'Export CSV' });
  fireEvent.change(screen.getByLabelText('Report date'), { target: { value: '' } });
  expect(screen.getByRole('button', { name: 'Load daily report' })).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Export CSV' })).not.toBeInTheDocument();
  expect(api.get).toHaveBeenCalledTimes(1);
});
