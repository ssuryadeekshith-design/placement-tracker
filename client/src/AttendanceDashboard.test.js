import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import AttendanceDashboard, { buildAttendanceCsv } from './AttendanceDashboard';
import api from './api';

jest.mock('./api', () => ({ get: jest.fn() }));
const report = {
  date: '2026-11-04', events: [{ id: 'daily', title: 'Daily employee attendance' }],
  totals: { accounts: 2, marked: 1, notMarked: 1 },
  rows: [
    { name: 'Surya', email: 'surya_deekshith@shikshavertex.in', department: 'Business Operations', team: 'Bops', employeeId: 'SV064', status: 'marked', checkIns: [{ eventId: 'daily', eventTitle: 'Daily employee attendance', timestamp: '2026-11-04T05:10:00Z', method: 'self', attendanceMode: 'setup', locationChecked: false }] },
    { name: 'Supriti', email: 'supriti_m@shikshavertex.in', department: 'Inside Sales', team: 'Sales', status: 'not-marked', checkIns: [] },
  ],
};
beforeEach(() => { jest.clearAllMocks(); api.get.mockImplementation(async url => ({ data: { ...report, date: new URLSearchParams(url.split('?')[1]).get('date') } })); });

test('shows check-ins in India time, mode and registered-account totals with no edit controls', async () => {
  render(<AttendanceDashboard />);
  expect(await screen.findByText('Surya')).toBeInTheDocument();
  expect(screen.getByText('Setup · location not verified')).toBeInTheDocument();
  expect(screen.getByText(/10:40:00/)).toBeInTheDocument();
  expect(screen.getByText('Not marked yet', { selector: 'span' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /approve|override|delete|edit/i })).not.toBeInTheDocument();
});

test('search and status/department/team filters narrow rows without another API request', async () => {
  render(<AttendanceDashboard />); await screen.findByText('Surya');
  fireEvent.change(screen.getByLabelText('Department'), { target: { value: 'Business Operations' } });
  expect(screen.queryByText('Supriti')).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Team'), { target: { value: 'Bops' } });
  fireEvent.change(screen.getByLabelText('Search employees'), { target: { value: 'surya_deekshith' } });
  expect(screen.getByText('Surya')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Attendance status'), { target: { value: 'not-marked' } });
  expect(screen.getByText('No accounts match these filters.')).toBeInTheDocument();
  expect(api.get).toHaveBeenCalledTimes(1);
});

test('date/session selection and explicit refresh request the correct scope', async () => {
  render(<AttendanceDashboard />); await screen.findByText('Surya');
  fireEvent.change(screen.getByLabelText('Attendance date'), { target: { value: '2026-11-04' } });
  await waitFor(() => expect(api.get).toHaveBeenCalledWith('/attendance-report?date=2026-11-04'));
  await screen.findByText('Surya');
  fireEvent.change(screen.getByLabelText('Attendance session'), { target: { value: 'daily' } });
  await waitFor(() => expect(api.get).toHaveBeenCalledWith('/attendance-report?date=2026-11-04&eventId=daily'));
  await screen.findByText('Surya');
  fireEvent.click(screen.getByRole('button', { name: 'Refresh attendance records' }));
  await waitFor(() => expect(api.get.mock.calls.filter(([path]) => path.includes('eventId=daily')).length).toBe(2));
});

test('revoked access clears previously displayed records and export', async () => {
  render(<AttendanceDashboard />); await screen.findByText('Surya');
  api.get.mockRejectedValueOnce({ response: { data: { error: 'Attendance viewer access is required.' } } });
  fireEvent.click(screen.getByRole('button', { name: 'Refresh attendance records' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Attendance viewer access is required.');
  expect(screen.queryByText('Surya')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Download attendance CSV' })).not.toBeInTheDocument();
});

test('an older date response cannot replace a newly selected report', async () => {
  let resolveOld;
  api.get.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
  render(<AttendanceDashboard />);
  fireEvent.change(screen.getByLabelText('Attendance date'), { target: { value: '2026-11-03' } });
  expect(await screen.findByText('Surya')).toBeInTheDocument();
  await act(async () => resolveOld({ data: { ...report, rows: [{ ...report.rows[0], name: 'Stale record' }] } }));
  expect(screen.queryByText('Stale record')).not.toBeInTheDocument();
});

test('CSV includes filtered attendance and defuses formulas without exporting location histories', () => {
  const rows = [{ ...report.rows[0], name: '=HYPERLINK("bad")' }];
  const csv = buildAttendanceCsv(report, rows);
  expect(csv).toContain("'=HYPERLINK");
  expect(csv).toContain('2026-11-04T05:10:00.000Z');
  expect(csv).toContain('10:40:00');
  expect(csv).not.toContain('supriti_m@');
  expect(csv).not.toMatch(/latitude|longitude|credential|route/i);
});

test('mismatched dates, totals, statuses and session evidence are unavailable rather than unmarked', async () => {
  const badReports = [
    { ...report, date: '2026-11-03' },
    { ...report, totals: { accounts: 2, marked: 0, notMarked: 2 } },
    { ...report, rows: [{ ...report.rows[0], status: 'unknown' }, report.rows[1]] },
    { ...report, rows: [{ ...report.rows[0], checkIns: [{ ...report.rows[0].checkIns[0], eventId: 'unrelated' }] }, report.rows[1]] },
    { ...report, rows: [{ ...report.rows[0], checkIns: [{ ...report.rows[0].checkIns[0], phoneVerified: 'true' }] }, report.rows[1]] },
  ];
  for (const [index, bad] of badReports.entries()) {
    api.get.mockImplementationOnce(async url => ({ data: { ...bad, date: index === 0 ? '2000-01-01' : new URLSearchParams(url.split('?')[1]).get('date') } }));
    const { unmount } = render(<AttendanceDashboard />);
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be confirmed');
    expect(screen.queryByRole('region', { name: 'All-employees attendance records' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Download attendance CSV' })).not.toBeInTheDocument();
    unmount();
  }
});

test('clearing the date hides records and avoids an invalid attendance request', async () => {
  render(<AttendanceDashboard />); await screen.findByText('Surya');
  fireEvent.change(screen.getByLabelText('Attendance date'), { target: { value: '' } });
  expect(await screen.findByRole('alert')).toHaveTextContent('Choose a valid attendance date');
  expect(api.get).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('Surya')).not.toBeInTheDocument();
});

test('employee-ID and multi-field search work, department changes clear team and clear filters restores rows', async () => {
  render(<AttendanceDashboard />); await screen.findByText('Surya');
  fireEvent.change(screen.getByLabelText('Search employees'), { target: { value: 'SV064 Bops' } });
  expect(screen.getByText('Surya')).toBeInTheDocument();
  expect(screen.queryByText('Supriti')).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Team'), { target: { value: 'Bops' } });
  fireEvent.change(screen.getByLabelText('Department'), { target: { value: 'Inside Sales' } });
  expect(screen.getByLabelText('Team')).toHaveValue('');
  expect(screen.getByText('No accounts match these filters.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Clear employee filters' }));
  expect(screen.getByText('Surya')).toBeInTheDocument();
  expect(screen.getByText('Supriti')).toBeInTheDocument();
  expect(api.get).toHaveBeenCalledTimes(1);
});

test('employee filters persist after refresh and a date change, with report totals distinct from filtered count', async () => {
  render(<AttendanceDashboard />); await screen.findByText('Surya');
  fireEvent.change(screen.getByLabelText('Department'), { target: { value: 'Business Operations' } });
  fireEvent.change(screen.getByLabelText('Search employees'), { target: { value: 'Surya' } });
  fireEvent.click(screen.getByRole('button', { name: 'Refresh attendance records' }));
  await screen.findByText('Surya');
  expect(screen.getByLabelText('Department')).toHaveValue('Business Operations');
  fireEvent.change(screen.getByLabelText('Attendance date'), { target: { value: '2026-11-03' } });
  await screen.findByText('Surya');
  expect(screen.getByLabelText('Search employees')).toHaveValue('Surya');
  expect(screen.getByText(/Showing 1 of 2 accounts/)).toBeInTheDocument();
  expect(screen.getByText('Accounts in report').nextSibling).toHaveTextContent('2');
  expect(screen.getByLabelText('Export department (optional)')).toHaveValue('Business Operations');
});

test('a scoped report cannot contain another session even if the totals appear correct', async () => {
  render(<AttendanceDashboard />); await screen.findByText('Surya');
  api.get.mockImplementationOnce(async url => ({ data: { ...report, date: new URLSearchParams(url.split('?')[1]).get('date'), events: [...report.events, { id: 'other', title: 'Other' }], rows: [{ ...report.rows[0], checkIns: [{ ...report.rows[0].checkIns[0], eventId: 'other' }] }, report.rows[1]] } }));
  fireEvent.change(screen.getByLabelText('Attendance session'), { target: { value: 'daily' } });
  expect(await screen.findByRole('alert')).toHaveTextContent('could not be confirmed');
  expect(screen.queryByText('Surya')).not.toBeInTheDocument();
});

test('manual setup overrides keep their evidence label and missing times stay unavailable', async () => {
  api.get.mockImplementationOnce(async url => ({ data: { ...report, date: new URLSearchParams(url.split('?')[1]).get('date'), rows: [{ ...report.rows[0], checkIns: [{ ...report.rows[0].checkIns[0], method: 'committee', timestamp: null }] }, report.rows[1]] } }));
  render(<AttendanceDashboard />); await screen.findByText('Surya');
  const records = screen.getByRole('region', { name: 'All-employees attendance records' });
  expect(within(records).getByText('Committee override')).toBeInTheDocument();
  expect(within(records).getByText('Time unavailable')).toBeInTheDocument();
  expect(within(records).queryByText('Setup · location not verified')).not.toBeInTheDocument();
  const csv = buildAttendanceCsv(report, [{ ...report.rows[0], checkIns: [{ ...report.rows[0].checkIns[0], timestamp: 'yesterday', locationChecked: undefined }] }]);
  expect(csv).toContain('Unavailable'); expect(csv).not.toMatch(/yesterday|1970|"false"/);
});

test('a day with no sessions remains a report without turning missing attendance into absence', async () => {
  api.get.mockImplementationOnce(async url => ({ data: { ...report, date: new URLSearchParams(url.split('?')[1]).get('date'), events: [], totals: { accounts: 2, marked: 0, notMarked: 2 }, rows: report.rows.map(row => ({ ...row, status: 'not-marked', checkIns: [] })) } }));
  render(<AttendanceDashboard />); await screen.findByText('Surya');
  expect(screen.getByText(/No attendance session exists for this date/)).toBeInTheDocument();
  const records = screen.getByRole('region', { name: 'All-employees attendance records' });
  expect(within(records).getAllByText('Not marked yet')).toHaveLength(2);
  expect(within(records).queryByText(/absent/i)).not.toBeInTheDocument();
});

test('a known access denial during range export clears the daily snapshot and all export controls', async () => {
  render(<AttendanceDashboard />); await screen.findByText('Surya');
  api.get.mockRejectedValueOnce({ response: { status: 403, data: { error: 'Attendance viewer access is required.' } } });
  fireEvent.click(screen.getByText('Export attendance records by date range'));
  fireEvent.click(screen.getByRole('button', { name: 'Export attendance records (CSV)' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Range export stopped; no file was downloaded.');
  expect(screen.queryByText('Surya')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Download attendance CSV' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Export attendance records (CSV)' })).not.toBeInTheDocument();
});

test('retrying a failed local download clears its error and downloads the current filtered snapshot', async () => {
  const previousCreate = URL.createObjectURL, previousRevoke = URL.revokeObjectURL;
  const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  URL.createObjectURL = jest.fn().mockImplementationOnce(() => { throw new Error('Browser download blocked'); }).mockReturnValue('blob:attendance');
  URL.revokeObjectURL = jest.fn();
  try {
    render(<AttendanceDashboard />); await screen.findByText('Surya');
    fireEvent.change(screen.getByLabelText('Department'), { target: { value: 'Business Operations' } });
    fireEvent.click(screen.getByRole('button', { name: 'Download attendance CSV' }));
    expect(screen.getByRole('alert')).toHaveTextContent('download could not start');
    fireEvent.click(screen.getByRole('button', { name: 'Download attendance CSV' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText(/CSV download requested: 1 filtered accounts/)).toBeInTheDocument();
    expect(click).toHaveBeenCalledTimes(1);
    const csv = await new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsText(URL.createObjectURL.mock.calls[1][0]); });
    expect(csv).toContain('Surya'); expect(csv).not.toContain('Supriti');
  } finally { click.mockRestore(); URL.createObjectURL = previousCreate; URL.revokeObjectURL = previousRevoke; }
});

test('a shared data revision reloads the report while preserving local employee filters', async () => {
  const view = render(<AttendanceDashboard revision={0} />); await screen.findByText('Surya');
  fireEvent.change(screen.getByLabelText('Department'), { target: { value: 'Business Operations' } });
  fireEvent.change(screen.getByLabelText('Search employees'), { target: { value: 'SV064' } });
  view.rerender(<AttendanceDashboard revision={1} />);
  await screen.findByText('Surya');
  expect(api.get).toHaveBeenCalledTimes(2);
  expect(screen.getByLabelText('Department')).toHaveValue('Business Operations');
  expect(screen.getByLabelText('Search employees')).toHaveValue('SV064');
  expect(screen.queryByText('Supriti')).not.toBeInTheDocument();
});
