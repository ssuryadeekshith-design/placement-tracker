import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import VenueGate, { evaluateVenue } from './VenueGate';
import api from './api';
import { clearVenueAccess, isVenueRequired } from './venueAccess';

jest.mock('./api', () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn() } }));
jest.mock('./firebase', () => ({ auth: null }));
jest.mock('firebase/auth', () => ({ signOut: jest.fn() }));
const venue = { configured: true, latitude: 12.912773610440954, longitude: 77.62322878099566, radiusMeters: 100, maxAccuracyMeters: 50 };
let success, failure;
const position = (overrides = {}) => ({ coords: { latitude: venue.latitude, longitude: venue.longitude, accuracy: 5, ...overrides }, timestamp: Date.now() });
beforeEach(() => {
  jest.clearAllMocks(); clearVenueAccess();
  api.get.mockResolvedValue({ data: venue }); api.post.mockResolvedValue({ data: {} });
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
    watchPosition: jest.fn((ok, fail) => { success = ok; failure = fail; return 7; }), clearWatch: jest.fn(),
  } });
});
afterEach(() => { jest.useRealTimers(); });
async function begin() {
  render(<VenueGate><div>Private attendance content</div></VenueGate>);
  fireEvent.click(screen.getByRole('button', { name: 'Check venue location' }));
  await waitFor(() => expect(navigator.geolocation.watchPosition).toHaveBeenCalled());
}
test('does not request GPS or show private screens until the member checks location', () => {
  render(<VenueGate><div>Private attendance content</div></VenueGate>);
  expect(screen.getByRole('heading', { name: 'App locked' })).toBeInTheDocument();
  expect(navigator.geolocation.watchPosition).not.toHaveBeenCalled();
  expect(screen.queryByText('Private attendance content')).not.toBeInTheDocument();
});
test('inside fix unlocks, moving outside immediately removes private content, new inside fix unlocks again', async () => {
  await begin();
  act(() => success(position()));
  expect(screen.getByText('Private attendance content')).toBeInTheDocument();
  act(() => success(position({ latitude: 13.1 })));
  expect(screen.queryByText('Private attendance content')).not.toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'App locked' })).toBeInTheDocument();
  act(() => success(position()));
  expect(screen.getByText('Private attendance content')).toBeInTheDocument();
});
test('permission failure keeps the app locked', async () => {
  await begin(); act(() => failure({ code: 1 }));
  expect(screen.getByRole('status')).toHaveTextContent('permission was denied');
  expect(screen.queryByText('Private attendance content')).not.toBeInTheDocument();
});
test('hiding the page clears location monitoring and removes private content', async () => {
  await begin(); act(() => success(position()));
  Object.defineProperty(document, 'hidden', { configurable: true, value: true });
  fireEvent(document, new Event('visibilitychange'));
  expect(navigator.geolocation.clearWatch).toHaveBeenCalledWith(7);
  expect(screen.queryByText('Private attendance content')).not.toBeInTheDocument();
  act(() => success(position()));
  expect(screen.queryByText('Private attendance content')).not.toBeInTheDocument();
});
test('the last inside fix expires rather than holding the app open indefinitely', async () => {
  jest.useFakeTimers(); await begin(); act(() => success(position()));
  act(() => jest.advanceTimersByTime(16000));
  expect(screen.queryByText('Private attendance content')).not.toBeInTheDocument();
});
test('geofence includes uncertainty and rejects invalid, inaccurate or old coordinates', () => {
  expect(evaluateVenue(position(), venue)).toBe(true);
  expect(evaluateVenue(position({ latitude: venue.latitude + .00072, accuracy: 30 }), venue)).toBe(false);
  expect(evaluateVenue(position({ accuracy: 51 }), venue)).toBe(false);
  expect(evaluateVenue({ ...position(), timestamp: Date.now() - 15001 }, venue)).toBe(false);
  expect(evaluateVenue(position({ latitude: 91 }), venue)).toBe(false);
});

test('explicit setup mode opens without any location permission and explains unverified presence', async () => {
  api.get.mockResolvedValue({ data: { ...venue, attendanceMode: 'setup', accessRequired: false, locationRequired: false, attendanceWifi: { required: false }, requiresRoomCode: false } });
  const { unmount } = render(<VenueGate><div>Private attendance content</div></VenueGate>);
  expect(await screen.findByText('Private attendance content')).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('does not verify physical presence');
  expect(navigator.geolocation.watchPosition).not.toHaveBeenCalled();
  expect(isVenueRequired()).toBe(false);
  unmount();
  expect(isVenueRequired()).toBe(true);
});

test('missing, incomplete or failed policy cannot silently enable setup mode', async () => {
  api.get.mockResolvedValue({ data: { attendanceMode: 'setup', accessRequired: false } });
  render(<VenueGate><div>Private attendance content</div></VenueGate>);
  await waitFor(() => expect(api.get).toHaveBeenCalledWith('/venue'));
  expect(screen.queryByText('Private attendance content')).not.toBeInTheDocument();
  expect(isVenueRequired()).toBe(true);
});
