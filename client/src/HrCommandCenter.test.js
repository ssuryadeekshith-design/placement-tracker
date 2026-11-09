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

test('room code modal copies only a current code and removes the expired value', async () => {
  jest.useFakeTimers().setSystemTime(new Date('2026-11-08T06:00:00Z'));
  events[0].date = '2026-11-08';
  await renderHr();
  fireEvent.click(screen.getByRole('button', { name: 'Generate room code' }));
  const modal = await screen.findByRole('dialog', { name: 'Room code display' });
  expect(within(modal).getByText('654321')).toBeInTheDocument();
  expect(within(modal).getByText(/Expires in 60s/)).toBeInTheDocument();
  await act(async () => { fireEvent.click(within(modal).getByRole('button', { name: 'Copy room code' })); });
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith('654321');
  act(() => jest.advanceTimersByTime(61000));
  expect(within(modal).getByText('Code expired. Generate a new code.')).toBeInTheDocument();
  expect(within(modal).queryByText('654321')).not.toBeInTheDocument();
  expect(within(modal).queryByRole('button', { name: 'Copy room code' })).not.toBeInTheDocument();
});

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

test('override requires a registered target and a reason and shows server rejection without success', async () => {
  await renderHr();
  fireEvent.click(screen.getByRole('button', { name: 'Committee attendance override' }));
  const modal = screen.getByRole('dialog', { name: 'Manual attendance override' });
  await within(modal).findByRole('option', { name: 'alice@shikshavertex.in' });
  const submit = within(modal).getByRole('button', { name: 'Record committee override' });
  expect(submit).toBeDisabled();
  fireEvent.change(within(modal).getByLabelText('Override event'), { target: { value: 'daily' } });
  fireEvent.change(within(modal).getByLabelText('Registered employee'), { target: { value: 'alice@shikshavertex.in' } });
  fireEvent.change(within(modal).getByLabelText('Reason for override'), { target: { value: 'No' } });
  expect(submit).toBeDisabled();
  api.post.mockRejectedValueOnce({ response: { data: { error: 'The account is no longer approved.' } } });
  fireEvent.change(within(modal).getByLabelText('Reason for override'), { target: { value: 'Phone unavailable' } });
  fireEvent.click(within(modal).getByRole('checkbox', { name: /I have checked the employee/ }));
  fireEvent.click(submit);
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/attendance/manual', { eventId: 'daily', email: 'alice@shikshavertex.in', reason: 'Phone unavailable' }));
  expect(await within(modal).findByRole('alert')).toHaveTextContent('The account is no longer approved.');
  expect(props.onRefresh).not.toHaveBeenCalled();
  expect(props.setNotice).not.toHaveBeenCalledWith('Committee attendance override recorded.');
});

test('Wi-Fi enforcement disables browser overrides and setup mode disables unneeded room codes', async () => {
  await renderHr({ venue: { requiresRoomCode: false, attendanceWifi: { required: true } } });
  expect(screen.getByRole('button', { name: 'Committee attendance override' })).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Generate room code' })).not.toBeInTheDocument();
  expect(screen.getByText(/Browser committee overrides are unavailable/)).toBeInTheDocument();
});

test('server-declared viewer-only accounts are not offered as manual attendance targets', async () => {
  api.get.mockResolvedValue({ data: [
    { uid: 'alice', email: 'alice@shikshavertex.in', attendanceEligible: true },
    { uid: 'viewer', email: 'viewer@shikshavertex.in', attendanceEligible: false },
  ] });
  await renderHr();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Committee attendance override' })); });
  const modal = screen.getByRole('dialog');
  expect(within(modal).getByRole('option', { name: 'alice@shikshavertex.in' })).toBeInTheDocument();
  expect(within(modal).queryByRole('option', { name: 'viewer@shikshavertex.in' })).not.toBeInTheDocument();
});

async function prepareOverride() {
  fireEvent.click(screen.getByRole('button', { name: 'Committee attendance override' }));
  const dialog = screen.getByRole('dialog');
  await within(dialog).findByRole('option', { name: 'alice@shikshavertex.in' });
  fireEvent.change(within(dialog).getByLabelText('Override event'), { target: { value: 'daily' } });
  fireEvent.change(within(dialog).getByLabelText('Registered employee'), { target: { value: 'alice@shikshavertex.in' } });
  fireEvent.change(within(dialog).getByLabelText('Reason for override'), { target: { value: 'Phone unavailable' } });
  return dialog;
}

test('an override requires identity/session/reason confirmation and changes clear that confirmation', async () => {
  await renderHr();
  const dialog = await prepareOverride();
  const submit = within(dialog).getByRole('button', { name: 'Record committee override' });
  const confirm = within(dialog).getByRole('checkbox', { name: /I have checked the employee/ });
  expect(submit).toBeDisabled();
  fireEvent.click(confirm); expect(submit).toBeEnabled();
  fireEvent.change(within(dialog).getByLabelText('Reason for override'), { target: { value: 'Phone broken; confirmed employee identity' } });
  expect(confirm).not.toBeChecked(); expect(submit).toBeDisabled();
  expect(within(dialog).getByText('Review before recording')).toBeInTheDocument();
});

test('an already marked response preserves the original and does not claim a new override audit', async () => {
  api.post.mockResolvedValue({ data: { success: true, alreadyMarked: true } });
  await renderHr(); const dialog = await prepareOverride();
  fireEvent.click(within(dialog).getByRole('checkbox', { name: /I have checked the employee/ }));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Record committee override' }));
  expect(await screen.findByText(/Attendance already exists. The original record was preserved/)).toBeInTheDocument();
  expect(screen.queryByText(/^Manual attendance override recorded/)).not.toBeInTheDocument();
  expect(props.onRefresh).toHaveBeenCalledTimes(1);
});

test('a saved override followed by a failed refresh keeps success distinct and blocks stale actions', async () => {
  props.onRefresh.mockRejectedValue(new Error('Offline'));
  await renderHr({ logs: [{ id: 'old', eventId: 'daily', email: 'old@example.org', method: 'committee', reason: 'Old reason' }] });
  const dialog = await prepareOverride();
  fireEvent.click(within(dialog).getByRole('checkbox', { name: /I have checked the employee/ }));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Record committee override' }));
  expect(await screen.findByText(/Change saved, but current data could not refresh/)).toBeInTheDocument();
  expect(screen.getByText(/^Manual attendance override recorded/)).toBeInTheDocument();
  expect(screen.queryByRole('region', { name: 'Manual attendance override audit' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Create attendance event' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Committee attendance override' })).toBeDisabled();
  props.onRefresh.mockResolvedValue();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh attendance sessions' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Create attendance event' })).toBeEnabled());
});

test('failed account reload never retains old eligible options or infers eligibility', async () => {
  await renderHr(); await prepareOverride();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  api.get.mockRejectedValueOnce(new Error('Account lookup unavailable'));
  fireEvent.click(screen.getByRole('button', { name: 'Committee attendance override' }));
  let dialog = screen.getByRole('dialog');
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('Account lookup unavailable');
  expect(within(dialog).queryByRole('option', { name: 'alice@shikshavertex.in' })).not.toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  api.get.mockResolvedValueOnce({ data: [{ uid: 'alice', email: 'alice@shikshavertex.in' }] });
  fireEvent.click(screen.getByRole('button', { name: 'Committee attendance override' }));
  dialog = screen.getByRole('dialog');
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('Registered account data is incomplete');
  expect(within(dialog).queryByRole('option', { name: 'alice@shikshavertex.in' })).not.toBeInTheDocument();
});

test('a late account response from a dismissed dialog cannot replace the reopened account snapshot', async () => {
  let resolveOld;
  api.get.mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve; }));
  await renderHr();
  fireEvent.click(screen.getByRole('button', { name: 'Committee attendance override' }));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  fireEvent.click(screen.getByRole('button', { name: 'Committee attendance override' }));
  const dialog = screen.getByRole('dialog');
  await within(dialog).findByRole('option', { name: 'alice@shikshavertex.in' });
  await act(async () => resolveOld({ data: [{ uid: 'old', email: 'old@example.org', attendanceEligible: true }] }));
  expect(within(dialog).queryByRole('option', { name: 'old@example.org' })).not.toBeInTheDocument();
});

test('room generation failure hides the previous code and malformed codes are rejected', async () => {
  await renderHr();
  fireEvent.click(screen.getByRole('button', { name: 'Generate room code' }));
  const dialog = await screen.findByRole('dialog');
  expect(await within(dialog).findByText('654321')).toBeInTheDocument();
  api.post.mockRejectedValueOnce(new Error('Room service unavailable'));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Generate a new code' }));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('Room service unavailable');
  expect(within(dialog).queryByText('654321')).not.toBeInTheDocument();
  expect(within(dialog).queryByRole('button', { name: 'Copy room code' })).not.toBeInTheDocument();
  api.post.mockResolvedValueOnce({ data: { code: 123456, expiresAt: Date.now() + 60000 } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Generate a new code' }));
  await waitFor(() => expect(within(dialog).getByRole('alert')).toHaveTextContent('did not return a current room code'));
  expect(within(dialog).queryByText('123456')).not.toBeInTheDocument();
});

test('room codes disappear when the session closes or the India date changes', async () => {
  jest.useFakeTimers().setSystemTime(new Date('2026-11-08T18:29:40Z'));
  const current = [{ ...events[0], date: '2026-11-08' }];
  let view;
  await act(async () => { view = render(<HrCommandCenter {...props} events={current} />); });
  fireEvent.click(screen.getByRole('button', { name: 'Generate room code' }));
  const dialog = await screen.findByRole('dialog');
  expect(await within(dialog).findByText('654321')).toBeInTheDocument();
  act(() => jest.advanceTimersByTime(21000));
  expect(within(dialog).queryByText('654321')).not.toBeInTheDocument();
  expect(within(dialog).getByText(/Room code unavailable/)).toBeInTheDocument();
  view.rerender(<HrCommandCenter {...props} events={[{ ...current[0], date: '2026-11-09', checkInOpen: false }]} />);
  expect(screen.queryByRole('button', { name: 'Generate room code' })).not.toBeInTheDocument();
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
