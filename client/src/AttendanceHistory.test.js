import { fireEvent, render, screen, within } from '@testing-library/react';
import AttendanceHistory, { attendanceMode, historyDate, indiaDay } from './AttendanceHistory';

const events = [{ id: 'a', title: 'Morning attendance' }, { id: 'b', title: 'Learning session' }];
const logs = [
  { id: 'one', eventId: 'a', email: 'alice@shikshavertex.in', timestamp: '2026-11-04T05:15:00Z', attendanceMode: 'setup', method: 'self', verification: { method: 'passkey-user-verification', credentialId: 'private-credential-id' }, location: { latitude: 12.9, longitude: 77.6 } },
  { id: 'two', eventId: 'b', email: 'bob@shikshavertex.in', timestamp: '2026-11-06T06:00:00Z', attendanceMode: 'onsite', method: 'committee', reason: 'Phone unavailable', locationVerified: false, phoneVerified: true },
];
beforeEach(() => { jest.useFakeTimers().setSystemTime(new Date('2026-11-08T06:00:00Z')); });
afterEach(() => jest.useRealTimers());

test('calendar records India dates and never labels an empty day as an absence', () => {
  expect(indiaDay('2026-11-03T20:00:00Z')).toBe('2026-11-04');
  render(<AttendanceHistory logs={logs} events={events} />);
  expect(screen.getByRole('button', { name: '2026-11-04: 1 recorded check-in' })).toHaveClass('has-record');
  fireEvent.click(screen.getByRole('button', { name: '2026-11-03: No check-in recorded' }));
  expect(screen.getByText('No attendance records match these filters.')).toBeInTheDocument();
  expect(screen.queryByText('Absent')).not.toBeInTheDocument();
  expect(screen.getByText('A day without a record is not an absence or leave decision.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Next attendance month' })).toBeDisabled();
});

test('table sorts exact original timestamps, filters sessions and searches employee emails', () => {
  render(<AttendanceHistory logs={logs} events={events} committee />);
  const table = screen.getByRole('table');
  expect(within(table).getAllByRole('row')[1]).toHaveTextContent('Learning session');
  fireEvent.change(screen.getByLabelText('Sort attendance history'), { target: { value: 'oldest' } });
  expect(within(table).getAllByRole('row')[1]).toHaveTextContent('Morning attendance');
  expect(within(table).getByText(/10:45:00/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Search attendance history'), { target: { value: 'alice@' } });
  expect(within(table).queryByText('bob@shikshavertex.in')).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('History session'), { target: { value: 'b' } });
  expect(screen.getByText('No attendance records match these filters.')).toBeInTheDocument();
});

test('only persisted phone evidence creates a verification badge and private fields are omitted', () => {
  const { container } = render(<AttendanceHistory logs={logs} events={events} committee />);
  expect(screen.getAllByText('Phone passkey verified')).toHaveLength(1);
  expect(screen.getByText('Committee override')).toBeInTheDocument();
  expect(screen.getByText('Override reason: Phone unavailable')).toBeInTheDocument();
  expect(container.textContent).not.toMatch(/private-credential-id|latitude|longitude|12\.9/);
  expect(attendanceMode({ method: 'committee', attendanceMode: 'onsite', locationVerified: true }).label).toBe('Committee override');
  expect(attendanceMode({ attendanceMode: 'onsite', locationVerified: 'true' }).label).toBe('Onsite · location not verified');
});


test('empty history still offers a calendar without assigning absence', () => {
  render(<AttendanceHistory />);
  expect(screen.getByRole('group', { name: 'Attendance record calendar' })).toBeInTheDocument();
  expect(screen.getByText('No attendance recorded yet.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '2026-11-04: No check-in recorded' }));
  expect(screen.getByRole('table')).toBeInTheDocument();
  expect(screen.getByText('No attendance records match these filters.')).toBeInTheDocument();
});

test('column headers sort both directions and keep unavailable timestamps last', () => {
  const invalid = [{ id: 'bad-a', eventId: 'a', timestamp: false }, { id: 'bad-b', eventId: 'b', timestamp: 'invalid' }];
  render(<AttendanceHistory logs={[...logs, ...invalid]} events={events} />);
  const rows = () => within(screen.getByRole('table')).getAllByRole('row').slice(1);
  const time = screen.getByRole('button', { name: 'Original check-in · IST' });
  fireEvent.click(time);
  expect(rows()[0]).toHaveTextContent('Morning attendance');
  expect(time.closest('th')).toHaveAttribute('aria-sort', 'ascending');
  expect(rows()[2]).toHaveTextContent('Time unavailable');
  fireEvent.click(time);
  expect(rows()[0]).toHaveTextContent('Learning session');
  fireEvent.click(screen.getByRole('button', { name: 'Session' }));
  expect(rows()[0]).toHaveTextContent('Learning session');
  fireEvent.click(screen.getByRole('button', { name: 'Session' }));
  expect(rows()[0]).toHaveTextContent('Morning attendance');
});

test('calendar counts records independently of table filters and returns to this month', () => {
  render(<AttendanceHistory logs={[...logs, { ...logs[0], id: 'extra' }]} events={events} />);
  const date = screen.getByRole('button', { name: '2026-11-04: 2 recorded check-ins' });
  expect(date).toHaveClass('record-level-2');
  fireEvent.change(screen.getByLabelText('History session'), { target: { value: 'b' } });
  expect(date).toHaveClass('record-level-2');
  fireEvent.click(screen.getByRole('button', { name: 'Previous attendance month' }));
  fireEvent.click(screen.getByRole('button', { name: 'This month' }));
  expect(screen.getByRole('button', { name: '2026-11-04: 2 recorded check-ins' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Clear history filters' }));
  expect(screen.getByLabelText('History session')).toHaveValue('');
});

test('malformed timestamps never invent calendar dates; supported Firestore times retain India dates', () => {
  for (const value of [null, false, true, '', '1', '2026-02-30T10:00:00Z', {}, { seconds: '100' }, { seconds: 1, nanoseconds: -1 }]) {
    expect(historyDate(value)).toBeNull();
    expect(indiaDay(value)).toBe('');
  }
  expect(indiaDay({ seconds: Date.parse('2026-11-03T20:00:00Z') / 1000, nanoseconds: 123 })).toBe('2026-11-04');
});
