import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import DailyReport from './DailyReport';
import api from './api';

jest.mock('./api', () => ({ get: jest.fn() }));
const member = { uid: 'member-1', email: 'one@shikshavertex.in', role: 'student' };
const emptyReport = {
  date: '2026-11-04', timezone: 'Asia/Kolkata',
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
  expect(screen.getByText('Unknown — no reliable location evidence')).toBeInTheDocument();
  expect(getCurrentPosition).not.toHaveBeenCalled(); expect(watchPosition).not.toHaveBeenCalled();
});

test('estimated visits and return times show coordinates, durations and a safe Maps link', async () => {
  api.get.mockResolvedValue({ data: { ...emptyReport,
    totals: { insideSeconds: 600, awaySeconds: 1200, unknownSeconds: 34200 },
    excursions: [{ leftAt: '2026-11-04T06:00:00Z', returnedAt: '2026-11-04T06:20:00Z', durationSeconds: 1200 }],
    visits: [{ latitude: 12.92, longitude: 77.63, startAt: '2026-11-04T06:05:00Z', endAt: '2026-11-04T06:15:00Z', dwellSeconds: 600, label: 'Do not claim this is a cafe', mapsUrl: 'javascript:alert(1)' }],
  } });
  render(<DailyReport user={member} />); chooseDate();
  fireEvent.click(screen.getByRole('button', { name: 'Load daily report' }));
  expect(await screen.findByText('Location near 12.92000, 77.63000')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /View approximate location/ })).toHaveAttribute('href', 'https://www.google.com/maps?q=12.92%2C77.63');
  expect(screen.queryByText('Do not claim this is a cafe')).not.toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: 'Estimated departure' })).toBeInTheDocument();
  expect(screen.getByText(/observed duration 0h 10m/)).toBeInTheDocument();
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
  api.get.mockImplementation(path => Promise.resolve({ data: path === '/students' ? [member, { uid: 'other-uid', email: 'two@shikshavertex.in' }] : emptyReport }));
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
