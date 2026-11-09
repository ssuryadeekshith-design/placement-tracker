import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import AttendanceRangeExport, { attendanceRangeDates, buildRangeAttendanceCsv } from './AttendanceRangeExport';
import api from './api';

jest.mock('./api', () => ({ get: jest.fn() }));
const report = date => ({
  date, totals: { accounts: 2, marked: 1, notMarked: 1 }, events: [{ id: 'daily', title: 'Daily attendance' }],
  rows: [
    { name: 'Alice Example', email: 'alice@example.com', employeeId: 'SV001', department: 'Operations', team: 'One', status: 'marked', checkIns: [{ eventId: 'daily', eventTitle: 'Daily attendance', timestamp: `${date}T05:00:00Z`, method: 'self', attendanceMode: 'setup', locationChecked: false }] },
    { name: 'Bob Example', email: 'bob@example.com', department: 'Sales', team: 'Two', status: 'not-marked', checkIns: [] },
  ],
});
let downloads;
beforeEach(() => {
  jest.clearAllMocks(); downloads = [];
  api.get.mockImplementation(async url => ({ data: report(new URLSearchParams(url.split('?')[1]).get('date')) }));
  URL.createObjectURL = jest.fn(() => 'blob:attendance-test');
  URL.revokeObjectURL = jest.fn();
  jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () { downloads.push(this.download); });
});
afterEach(() => { jest.restoreAllMocks(); });

function openExport() { fireEvent.click(screen.getByText('Export attendance records by date range')); }

test('calendar ranges reject invalid/future dates and count leap days and the inclusive 31-day bound', () => {
  expect(attendanceRangeDates('2024-02-28', '2024-03-01', '2026-11-08')).toEqual(['2024-02-28', '2024-02-29', '2024-03-01']);
  expect(attendanceRangeDates('2026-01-01', '2026-01-31', '2026-11-08')).toHaveLength(31);
  expect(attendanceRangeDates('2026-03-08', '2026-03-09', '2026-11-08')).toEqual(['2026-03-08', '2026-03-09']);
  for (const [from, to] of [['2026-02-30', '2026-03-01'], ['2026-11-04', '2026-11-03'], ['2026-11-09', '2026-11-09'], ['2026-01-01', '2026-02-01'], ['', '2026-11-04']]) {
    expect(() => attendanceRangeDates(from, to, '2026-11-08')).toThrow();
  }
});

test('range CSV has one header, preserves check-in time and unmarked accounts, filters department and neutralizes formulas', () => {
  const first = report('2026-11-03'); first.rows[0].name = '=HYPERLINK("bad")';
  first.rows[0].checkIns[0].location = { latitude: 12.9, longitude: 77.6 };
  first.rows[0].checkIns[0].verification = { credentialId: 'private-credential' };
  const csv = buildRangeAttendanceCsv([first, report('2026-11-04')], ' operations ');
  expect(csv.match(/"date_india"/g)).toHaveLength(1);
  expect(csv).toContain("'=HYPERLINK");
  expect(csv).toContain('2026-11-03T05:00:00.000Z');
  expect(csv).toContain('10:30:00');
  expect(csv).not.toContain('Bob Example');
  expect(csv).not.toMatch(/latitude|longitude|private-credential|credentialId/);
  const noSessions = report('2026-11-03'); noSessions.events = []; noSessions.rows[0].checkIns = []; noSessions.rows[0].status = 'not-marked'; noSessions.totals = { accounts: 2, marked: 0, notMarked: 2 };
  const unfiltered = buildRangeAttendanceCsv([noSessions]);
  expect(unfiltered).toContain('Not marked yet');
  expect(unfiltered).not.toContain('Absent');
  const incomplete = report('2026-11-03'); incomplete.rows[0].checkIns = [];
  expect(() => buildRangeAttendanceCsv([incomplete])).toThrow(/incomplete/);
});

test('exports each selected day sequentially and freezes inputs until the complete download', async () => {
  let firstResolve;
  api.get.mockImplementationOnce(() => new Promise(resolve => { firstResolve = resolve; }));
  render(<AttendanceRangeExport date="2026-11-03" departments={['Operations']} />); openExport();
  fireEvent.change(screen.getByLabelText('Export through'), { target: { value: '2026-11-04' } });
  fireEvent.click(screen.getByRole('button', { name: 'Export attendance records (CSV)' }));
  expect(api.get).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText('Export from')).toBeDisabled();
  expect(screen.getByLabelText('Export department (optional)')).toBeDisabled();
  expect(URL.createObjectURL).not.toHaveBeenCalled();
  await act(async () => firstResolve({ data: report('2026-11-03') }));
  await waitFor(() => expect(downloads).toEqual(['attendance-records-2026-11-03-to-2026-11-04.csv']));
  expect(api.get.mock.calls.map(([url]) => url)).toEqual(['/attendance-report?date=2026-11-03', '/attendance-report?date=2026-11-04']);
  expect(screen.getByLabelText('Export through')).not.toBeDisabled();
  expect(screen.getByRole('status')).toHaveTextContent('Export complete: 2 days.');
});

test('a revoked second-day response prevents any partial CSV download', async () => {
  api.get.mockResolvedValueOnce({ data: report('2026-11-03') }).mockRejectedValueOnce({ response: { data: { error: 'Attendance viewer access is required.' } } });
  render(<AttendanceRangeExport date="2026-11-03" />); openExport();
  fireEvent.change(screen.getByLabelText('Export through'), { target: { value: '2026-11-04' } });
  fireEvent.click(screen.getByRole('button', { name: 'Export attendance records (CSV)' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Attendance viewer access is required.');
  expect(URL.createObjectURL).not.toHaveBeenCalled();
  expect(downloads).toEqual([]);
});

test('malformed or mismatched day data cannot be exported as a complete file', async () => {
  api.get.mockResolvedValueOnce({ data: { ...report('2026-11-04'), rows: [{ email: 'alice@example.com', department: 'Operations', status: 'marked', checkIns: {} }] } });
  render(<AttendanceRangeExport date="2026-11-04" />); openExport();
  fireEvent.click(screen.getByRole('button', { name: 'Export attendance records (CSV)' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Attendance data for 2026-11-04 is incomplete.');
  expect(downloads).toEqual([]);
});

test('changing the parent report date invalidates an in-flight export', async () => {
  let resolve;
  api.get.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const { rerender } = render(<AttendanceRangeExport date="2026-11-03" />); openExport();
  fireEvent.click(screen.getByRole('button', { name: 'Export attendance records (CSV)' }));
  rerender(<AttendanceRangeExport date="2026-11-04" />);
  await act(async () => resolve({ data: report('2026-11-03') }));
  expect(screen.getByLabelText('Export from')).toHaveValue('2026-11-04');
  expect(downloads).toEqual([]);
  expect(URL.createObjectURL).not.toHaveBeenCalled();
});

test('unmounting invalidates an in-flight export without starting more day requests', async () => {
  let resolve;
  api.get.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const { unmount } = render(<AttendanceRangeExport date="2026-11-03" />); openExport();
  fireEvent.change(screen.getByLabelText('Export through'), { target: { value: '2026-11-04' } });
  fireEvent.click(screen.getByRole('button', { name: 'Export attendance records (CSV)' }));
  unmount();
  await act(async () => resolve({ data: report('2026-11-03') }));
  expect(api.get).toHaveBeenCalledTimes(1);
  expect(downloads).toEqual([]);
});

test('cancelling discards the pending day without a partial file and allows a fresh export', async () => {
  let finish;
  api.get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  render(<AttendanceRangeExport date="2026-11-03" />); openExport();
  fireEvent.change(screen.getByLabelText('Export through'), { target: { value: '2026-11-04' } });
  fireEvent.click(screen.getByRole('button', { name: 'Export attendance records (CSV)' }));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel export' }));
  expect(screen.getByRole('status')).toHaveTextContent('Export cancelled. No file was downloaded.');
  await act(async () => finish({ data: report('2026-11-03') }));
  expect(api.get).toHaveBeenCalledTimes(1); expect(downloads).toEqual([]);
  fireEvent.click(screen.getByRole('button', { name: 'Export attendance records (CSV)' }));
  await waitFor(() => expect(downloads).toHaveLength(1));
  expect(api.get).toHaveBeenCalledTimes(3);
});

test('an exact department with no matching records downloads headers only and reports zero rows', async () => {
  render(<AttendanceRangeExport date="2026-11-03" />); openExport();
  fireEvent.change(screen.getByLabelText('Export department (optional)'), { target: { value: 'Does not exist' } });
  fireEvent.click(screen.getByRole('button', { name: 'Export attendance records (CSV)' }));
  await waitFor(() => expect(downloads).toHaveLength(1));
  expect(screen.getByRole('status')).toHaveTextContent('0 CSV data rows');
  expect(screen.getByRole('status')).toHaveTextContent('headers only');
  expect(buildRangeAttendanceCsv([report('2026-11-03')], 'Does not exist').trim().split('\r\n')).toHaveLength(1);
});

test('the selected daily department seeds range export and changing it invalidates an active export', async () => {
  let finish;
  api.get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const { rerender } = render(<AttendanceRangeExport date="2026-11-03" selectedDepartment="Operations" />); openExport();
  expect(screen.getByLabelText('Export department (optional)')).toHaveValue('Operations');
  fireEvent.click(screen.getByRole('button', { name: 'Export attendance records (CSV)' }));
  rerender(<AttendanceRangeExport date="2026-11-03" selectedDepartment="Sales" />);
  await act(async () => finish({ data: report('2026-11-03') }));
  expect(downloads).toEqual([]);
  expect(screen.getByLabelText('Export department (optional)')).toHaveValue('Sales');
});

test('inconsistent report totals cannot produce a complete CSV even when rows appear valid', async () => {
  const invalid = report('2026-11-03'); invalid.totals.marked = 2;
  api.get.mockResolvedValueOnce({ data: invalid });
  render(<AttendanceRangeExport date="2026-11-03" />); openExport();
  fireEvent.click(screen.getByRole('button', { name: 'Export attendance records (CSV)' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('incomplete. No file was downloaded.');
  expect(downloads).toEqual([]);
});
