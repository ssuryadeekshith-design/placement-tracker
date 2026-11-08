import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
beforeEach(() => { jest.clearAllMocks(); api.get.mockResolvedValue({ data: report }); });

test('shows check-ins in India time, mode and registered-account totals with no edit controls', async () => {
  render(<AttendanceDashboard />);
  expect(await screen.findByText('Surya')).toBeInTheDocument();
  expect(screen.getByText('Setup · location not verified')).toBeInTheDocument();
  expect(screen.getByText(/10:40:00/)).toBeInTheDocument();
  expect(screen.getByText('Not marked yet', { selector: 'td' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /approve|override|delete|edit/i })).not.toBeInTheDocument();
});

test('search and status/department/team filters narrow rows without another API request', async () => {
  render(<AttendanceDashboard />); await screen.findByText('Surya');
  fireEvent.change(screen.getByLabelText('Department'), { target: { value: 'Business Operations' } });
  expect(screen.queryByText('Supriti')).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Team'), { target: { value: 'Bops' } });
  fireEvent.change(screen.getByLabelText('Search name, email, department or team'), { target: { value: 'surya_deekshith' } });
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
  expect(csv).toContain('2026-11-04T05:10:00Z');
  expect(csv).toContain('10:40:00');
  expect(csv).not.toContain('supriti_m@');
  expect(csv).not.toMatch(/latitude|longitude|credential|route/i);
});
