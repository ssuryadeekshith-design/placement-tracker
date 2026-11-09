import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import HrCommandCenter from './HrCommandCenter';
import { indiaDay } from './AttendanceHistory';
import api from './api';

jest.mock('./api', () => ({ get: jest.fn(), post: jest.fn(), patch: jest.fn() }));
const events = [{ id: 'daily', title: 'Daily employee attendance', date: indiaDay(Date.now()), checkInOpen: true }];
let props;
beforeEach(() => {
  jest.clearAllMocks();
  events[0].date = indiaDay(Date.now());
  props = { events, logs: [], venue: { requiresRoomCode: true }, busy: false, onRefresh: jest.fn().mockResolvedValue(), setBusy: jest.fn(), setError: jest.fn(), setNotice: jest.fn() };
  api.get.mockResolvedValue({ data: [{ uid: 'alice', email: 'alice@shikshavertex.in', attendanceEligible: true }] });
  api.patch.mockResolvedValue({ data: { success: true } });
  api.post.mockImplementation((path, body) => Promise.resolve({ data: path.endsWith('/room-code') ? { code: '654321', expiresAt: Date.now() + 60000 } : path === '/events' ? { id: 'created', ...body, checkInOpen: false } : { success: true, alreadyMarked: false } }));
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: jest.fn().mockResolvedValue() } });
});
afterEach(() => jest.useRealTimers());
async function renderHr(overrides = {}) { await act(async () => { render(<HrCommandCenter {...props} {...overrides} />); }); }

test('modal traps focus, closes on Escape and restores the opening button', async () => {
  await renderHr();
  const trigger = screen.getByRole('button', { name: 'Create attendance event' });
  trigger.focus(); fireEvent.click(trigger);
  const modal = screen.getByRole('dialog');
  expect(within(modal).getByLabelText('Event title')).toHaveFocus();
  const cancel = within(modal).getByRole('button', { name: 'Cancel' });
  cancel.focus(); fireEvent.keyDown(document, { key: 'Tab' });
  expect(within(modal).getByRole('button', { name: 'Close dialog' })).toHaveFocus();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});

test('event creation preserves server contract and sessions begin closed', async () => {
  await renderHr();
  fireEvent.click(screen.getByRole('button', { name: 'Create attendance event' }));
  const modal = screen.getByRole('dialog');
  expect(within(modal).getByText(/New sessions begin closed/)).toBeInTheDocument();
  fireEvent.change(within(modal).getByLabelText('Event title'), { target: { value: ' Training ' } });
  fireEvent.change(within(modal).getByLabelText('Event date'), { target: { value: '2026-11-08' } });
  fireEvent.click(within(modal).getByRole('button', { name: 'Create event' }));
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/events', { title: 'Training', date: '2026-11-08', isMandatory: true }));
  expect(props.onRefresh).toHaveBeenCalled();
});

test('Wi-Fi enforcement disables browser overrides and setup mode disables unneeded room codes', async () => {
  await renderHr({ venue: { requiresRoomCode: false, attendanceWifi: { required: true } } });
  expect(screen.getByRole('button', { name: 'Committee attendance override' })).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Generate room code' })).not.toBeInTheDocument();
  expect(screen.getByText(/Sessions and approvals can be managed from anywhere/)).toBeInTheDocument();
});

test('open and close controls send an explicit desired state and show saved status', async () => {
  await renderHr();
  fireEvent.click(screen.getByRole('button', { name: 'Close check-in for Daily employee attendance' }));
  await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/events/daily', { checkInOpen: false }));
  expect(await screen.findByText('Daily employee attendance: check-in closed.')).toBeInTheDocument();
  expect(props.onRefresh).toHaveBeenCalledTimes(1);
});

test('audit rows show persisted administrator UID, reason and IST time without inventing missing fields', async () => {
  await renderHr({ logs: [
    { id: 'audit', eventId: 'daily', email: 'alice@shikshavertex.in', method: 'committee', markedBy: 'hr-original', reason: 'Phone unavailable', timestamp: '2026-11-08T06:00:00Z' },
    { id: 'legacy', eventId: 'missing-session', method: 'manual', timestamp: false },
    { id: 'self', eventId: 'daily', method: 'self', markedBy: 'not-an-override' },
  ] });
  const audit = screen.getByRole('region', { name: 'Manual attendance override audit' });
  expect(within(audit).getByText('hr-original')).toBeInTheDocument();
  expect(within(audit).getByText('Phone unavailable')).toBeInTheDocument();
  expect(within(audit).getByText(/11:30:00 am/i)).toBeInTheDocument();
  expect(within(audit).getByText('Administrator not recorded')).toBeInTheDocument();
  expect(within(audit).getByText('Reason not recorded')).toBeInTheDocument();
  expect(within(audit).getByText('Time unavailable')).toBeInTheDocument();
  expect(within(audit).queryByText('not-an-override')).not.toBeInTheDocument();
});

test('malformed session snapshots do not appear empty or enable creation', async () => {
  await renderHr({ events: [{ id: 'broken', title: 'Unknown state', date: '2026-02-30' }] });
  expect(screen.getByText(/Current sessions and audit records are unavailable/)).toBeInTheDocument();
  expect(screen.queryByText(/No attendance sessions yet/)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Create attendance event' })).toBeDisabled();
});


test('HR can manage sessions anywhere without obsolete controls or browser attendance bypass', async () => {
  await renderHr({ venue: { requiresRoomCode: true, attendanceWifi: { required: false } } });
  expect(screen.getByRole('button', { name: 'Create attendance event' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Committee attendance override' })).toBeDisabled();
  expect(document.body.textContent).not.toMatch(/wi-fi|room.?code|temporary setup mode/i);
  expect(api.post).not.toHaveBeenCalled();
});
