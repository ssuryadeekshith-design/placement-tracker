jest.mock('./VenueGate', () => ({ __esModule: true, default: ({ children }) => children }));
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createUserWithEmailAndPassword, onAuthStateChanged, reload, sendEmailVerification, signOut } from 'firebase/auth';
import * as firebaseConfig from './firebase';
import api from './api';
import App from './App';
import { browserSupportsWebAuthn, startAuthentication, startRegistration } from '@simplewebauthn/browser';

let mockAuthCallback;
let mockUser;
let mockBiometrics;
jest.mock('firebase/auth', () => ({
  onAuthStateChanged: jest.fn((auth, callback) => { mockAuthCallback = callback; callback(mockUser); return jest.fn(); }),
  createUserWithEmailAndPassword: jest.fn(), signInWithEmailAndPassword: jest.fn(),
  sendEmailVerification: jest.fn(), sendPasswordResetEmail: jest.fn(), reload: jest.fn(),
  signOut: jest.fn(),
}));
jest.mock('@simplewebauthn/browser', () => ({ browserSupportsWebAuthn: jest.fn(), startAuthentication: jest.fn(), startRegistration: jest.fn() }));
jest.mock('./firebase', () => ({ __esModule: true, auth: { currentUser: null }, firebaseConfigured: true }));
jest.mock('./api', () => ({ get: jest.fn(), post: jest.fn(), patch: jest.fn() }));
const venue = { configured: true, requiresRoomCode: true, address: 'Second floor, Srivari Arcade', radiusMeters: 100 };
const event = { id: 'drive-1', title: 'Placement workshop', date: '2026-11-04', checkInOpen: true, isMandatory: true };

beforeEach(() => {
  jest.clearAllMocks(); localStorage.clear(); firebaseConfig.firebaseConfigured = true;
  onAuthStateChanged.mockImplementation((auth, callback) => { mockAuthCallback = callback; callback(mockUser); return jest.fn(); });
  mockUser = { uid: 'u1', email: 'student@shikshavertex.in', emailVerified: true, getIdToken: jest.fn().mockResolvedValue('verified-token') };
  firebaseConfig.auth.currentUser = mockUser;
  api.post.mockResolvedValue({ data: { user: { uid: 'u1', email: mockUser.email, role: 'student' }, venue } });
  mockBiometrics = { required: false, configured: true, registered: false };
  browserSupportsWebAuthn.mockReturnValue(true);
  api.get.mockImplementation(path => Promise.resolve({ data: path === '/biometrics' ? mockBiometrics : path === '/events' ? [event] : { logs: [], mandatoryCount: 1 } }));
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: jest.fn() } });
  reload.mockResolvedValue(undefined); sendEmailVerification.mockResolvedValue(undefined);
  signOut.mockImplementation(async () => { mockUser = null; firebaseConfig.auth.currentUser = null; mockAuthCallback(null); });
});

async function dashboard() {
  render(<App />);
  await screen.findByRole('heading', { name: 'Mark your attendance' });
  await waitFor(() => expect(screen.queryByText('Checking phone verification settings…')).not.toBeInTheDocument());
}
function fillCheckIn() {
  fireEvent.change(screen.getByLabelText('Event'), { target: { value: 'drive-1' } });
  fireEvent.change(screen.getByLabelText('Room code'), { target: { value: '123456' } });
  fireEvent.click(screen.getByRole('checkbox', { name: /I agree to share and store my location/ }));
}

test('shows setup guidance when Firebase is not configured', () => {
  firebaseConfig.firebaseConfigured = false;
  render(<App />);
  expect(screen.getByRole('heading', { name: 'Registration is not available yet' })).toBeInTheDocument();
  expect(api.post).not.toHaveBeenCalled();
});

test('an unverified account cannot bind a device or access attendance', async () => {
  mockUser.emailVerified = false;
  render(<App />);
  expect(await screen.findByRole('heading', { name: 'Verify your email' })).toBeInTheDocument();
  expect(api.post).not.toHaveBeenCalled(); expect(api.get).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'I have verified my email' }));
  await waitFor(() => expect(reload).toHaveBeenCalledWith(mockUser));
  expect(api.post).not.toHaveBeenCalled();
  expect(await screen.findByText(/Your email is not verified yet/)).toBeInTheDocument();
});

test('registration sends an email verification link', async () => {
  mockUser = null; firebaseConfig.auth.currentUser = null;
  const newUser = { emailVerified: false, email: 'new@shikshavertex.in' };
  createUserWithEmailAndPassword.mockResolvedValue({ user: newUser });
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: 'Register', exact: true }));
  fireEvent.change(screen.getByLabelText('Email address'), { target: { value: newUser.email } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'long-password' } });
  fireEvent.click(screen.getByRole('button', { name: 'Register & verify email' }));
  await waitFor(() => expect(sendEmailVerification).toHaveBeenCalledWith(newUser));
  expect(api.post).not.toHaveBeenCalled();
});

test('does not request location on login and requires consent before check-in', async () => {
  await dashboard();
  expect(navigator.geolocation.getCurrentPosition).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Check location & mark attendance' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Event'), { target: { value: 'drive-1' } });
  fireEvent.change(screen.getByLabelText('Room code'), { target: { value: '123456' } });
  expect(screen.getByRole('button', { name: 'Check location & mark attendance' })).toBeDisabled();
});

test('captures a fresh position after consent and submits self attendance', async () => {
  await dashboard(); fillCheckIn();
  const timestamp = Date.now();
  navigator.geolocation.getCurrentPosition.mockImplementation(success => success({ coords: { latitude: 12.9, longitude: 77.6, accuracy: 12 }, timestamp }));
  fireEvent.click(screen.getByRole('button', { name: 'Check location & mark attendance' }));
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/attendance', {
    eventId: 'drive-1', roomCode: '123456', location: { latitude: 12.9, longitude: 77.6, accuracyMeters: 12, capturedAt: timestamp },
  }));
  expect(navigator.geolocation.getCurrentPosition).toHaveBeenCalledWith(expect.any(Function), expect.any(Function), { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
  expect(await screen.findByRole('status')).toHaveTextContent('Attendance recorded successfully.');
  expect(screen.getByRole('checkbox')).not.toBeChecked();
});

test('denied geolocation shows an actionable message and does not mark attendance', async () => {
  await dashboard(); fillCheckIn();
  navigator.geolocation.getCurrentPosition.mockImplementation((success, failure) => failure({ code: 1 }));
  fireEvent.click(screen.getByRole('button', { name: 'Check location & mark attendance' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Location permission was denied');
  expect(api.post).not.toHaveBeenCalledWith('/attendance', expect.anything());
});

test('a rejected geofence or room code is shown instead of success', async () => {
  await dashboard(); fillCheckIn();
  navigator.geolocation.getCurrentPosition.mockImplementation(success => success({ coords: { latitude: 12.9, longitude: 77.6, accuracy: 12 }, timestamp: Date.now() }));
  api.post.mockRejectedValueOnce({ response: { data: { error: 'You are outside the venue radius.' } } });
  fireEvent.click(screen.getByRole('button', { name: 'Check location & mark attendance' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('You are outside the venue radius.');
  expect(screen.queryByText('Attendance recorded successfully.')).not.toBeInTheDocument();
});

test('a device binding rejection prevents attendance access', async () => {
  api.post.mockRejectedValueOnce({ response: { data: { error: 'This browser is already bound to another email.' } } });
  render(<App />);
  expect(await screen.findByRole('alert')).toHaveTextContent('already bound to another email');
  expect(api.get).not.toHaveBeenCalled();
  expect(screen.queryByRole('heading', { name: 'Mark your attendance' })).not.toBeInTheDocument();
});

test('signing out keeps the first verified email remembered', async () => {
  await dashboard();
  expect(localStorage.getItem('placement-bound-email')).toBe(mockUser.email);
  fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
  expect(await screen.findByRole('heading', { name: 'Sign in to check in' })).toBeInTheDocument();
  expect(localStorage.getItem('placement-bound-email')).toBe('student@shikshavertex.in');
  expect(screen.getByText(/This browser was first registered to/)).toBeInTheDocument();
});

test('verified refresh establishes a session only after reloading verification status', async () => {
  mockUser.emailVerified = false;
  render(<App />);
  await screen.findByRole('heading', { name: 'Verify your email' });
  reload.mockImplementation(async () => { mockUser.emailVerified = true; });
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'I have verified my email' })));
  expect(await screen.findByRole('heading', { name: 'Mark your attendance' })).toBeInTheDocument();
  expect(mockUser.getIdToken).toHaveBeenCalledWith(true);
  expect(api.post).toHaveBeenCalledWith('/session');
});

test('committee can display a temporary room code and record an audited override without GPS', async () => {
  api.post.mockImplementation(path => Promise.resolve({ data: path === '/session'
    ? { user: { uid: 'u1', email: mockUser.email, role: 'committee' }, venue }
    : path.endsWith('/room-code') ? { code: '654321', expiresAt: Date.now() + 60000 } : { success: true } }));
  api.get.mockImplementation(path => Promise.resolve({ data: path === '/biometrics' ? mockBiometrics : path === '/events' ? [event] : path === '/students'
    ? [{ uid: 'u2', email: 'other@shikshavertex.in', fullName: 'Another Student' }]
    : { logs: [{ id: 'l1', eventId: 'drive-1', uid: 'u2', email: 'other@shikshavertex.in', timestamp: Date.now(), method: 'committee', reason: 'Phone unavailable' }], mandatoryCount: 1 } }));
  await dashboard();
  // Another attendee's record must not hide the committee member's own check-in.
  expect(screen.getByRole('option', { name: /Placement workshop ·/ })).toBeInTheDocument();
  expect(await screen.findByRole('heading', { name: 'Committee controls' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Generate room code' }));
  expect(await screen.findByText('654321')).toBeInTheDocument();
  expect(screen.getByText(/Expires in 60s/)).toBeInTheDocument();
  fireEvent.click(screen.getByText('Committee attendance override'));
  await within(screen.getByLabelText('Registered student')).findByRole('option', { name: 'other@shikshavertex.in' });
  fireEvent.change(screen.getByLabelText('Override event'), { target: { value: 'drive-1' } });
  fireEvent.change(screen.getByLabelText('Registered student'), { target: { value: 'other@shikshavertex.in' } });
  fireEvent.change(screen.getByLabelText('Reason for override'), { target: { value: 'Phone unavailable' } });
  fireEvent.click(screen.getByRole('button', { name: 'Record committee override' }));
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/attendance/manual', { eventId: 'drive-1', email: 'other@shikshavertex.in', reason: 'Phone unavailable' }));
  expect(navigator.geolocation.getCurrentPosition).not.toHaveBeenCalled();
  expect(screen.getByText(/Override reason: Phone unavailable/)).toBeInTheDocument();
  expect(screen.getByText(/Committee override/, { selector: 'p' })).toBeInTheDocument();
});


test('required phone verification supplies a server proof with self attendance', async () => {
  mockBiometrics = { required: true, configured: true, registered: true };
  api.post.mockImplementation(path => Promise.resolve({ data: path === '/session'
    ? { user: { uid: 'u1', email: mockUser.email, role: 'student' }, venue }
    : path === '/biometrics/authentication/options' ? { challengeId: 'challenge-1', options: { challenge: 'server-challenge' } }
      : path === '/biometrics/authentication/verify' ? { verified: true, proof: 'server-verified-proof' } : { success: true } }));
  startAuthentication.mockResolvedValue({ id: 'credential-id', response: { signature: 'signed-proof' } });
  await dashboard(); fillCheckIn();
  const timestamp = Date.now();
  navigator.geolocation.getCurrentPosition.mockImplementation(success => success({ coords: { latitude: 12.9, longitude: 77.6, accuracy: 12 }, timestamp }));
  fireEvent.click(screen.getByRole('button', { name: 'Check location & mark attendance' }));
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/attendance', {
    eventId: 'drive-1', roomCode: '123456', biometricProof: 'server-verified-proof', location: { latitude: 12.9, longitude: 77.6, accuracyMeters: 12, capturedAt: timestamp },
  }));
  expect(startAuthentication).toHaveBeenCalledWith({ optionsJSON: { challenge: 'server-challenge' } });
  expect(api.post).toHaveBeenCalledWith('/biometrics/authentication/verify', { challengeId: 'challenge-1', response: { id: 'credential-id', response: { signature: 'signed-proof' } } });
});

test('cancelled phone verification does not collect location or mark attendance', async () => {
  mockBiometrics = { required: true, configured: true, registered: true };
  await dashboard(); fillCheckIn();
  api.post.mockResolvedValue({ data: { challengeId: 'challenge-1', options: {} } });
  startAuthentication.mockRejectedValue(Object.assign(new Error('Cancelled'), { name: 'NotAllowedError' }));
  fireEvent.click(screen.getByRole('button', { name: 'Check location & mark attendance' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Phone verification was cancelled');
  expect(navigator.geolocation.getCurrentPosition).not.toHaveBeenCalled();
  expect(api.post).not.toHaveBeenCalledWith('/attendance', expect.anything());
});

test('a missing server phone-verification proof cannot mark attendance', async () => {
  mockBiometrics = { required: true, configured: true, registered: true };
  await dashboard(); fillCheckIn();
  api.post.mockImplementation(path => Promise.resolve({ data: path.endsWith('/options') ? { challengeId: 'challenge-1', options: {} } : { verified: true } }));
  startAuthentication.mockResolvedValue({ id: 'credential-id' });
  fireEvent.click(screen.getByRole('button', { name: 'Check location & mark attendance' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Phone verification was not confirmed by the server');
  expect(navigator.geolocation.getCurrentPosition).not.toHaveBeenCalled();
  expect(api.post).not.toHaveBeenCalledWith('/attendance', expect.anything());
});

test('enrollment registers a passkey before allowing phone-verified check-in', async () => {
  mockBiometrics = { required: true, configured: true, registered: false };
  await dashboard();
  expect(await screen.findByRole('button', { name: 'Set up phone verification' })).toBeInTheDocument();
  fillCheckIn();
  expect(screen.getByRole('button', { name: 'Check location & mark attendance' })).toBeDisabled();
  api.post.mockImplementation(path => {
    if (path.endsWith('/verify')) mockBiometrics = { required: true, configured: true, registered: true };
    return Promise.resolve({ data: path.endsWith('/options') ? { challengeId: 'registration-1', options: { challenge: 'registration-challenge' } } : { verified: true } });
  });
  startRegistration.mockResolvedValue({ id: 'new-credential', response: {} });
  fireEvent.click(screen.getByRole('button', { name: 'Set up phone verification' }));
  expect(await screen.findByText('Phone verification is ready. You will be prompted when you check in.')).toBeInTheDocument();
  expect(startRegistration).toHaveBeenCalledWith({ optionsJSON: { challenge: 'registration-challenge' } });
  expect(api.post).toHaveBeenCalledWith('/biometrics/registration/verify', { challengeId: 'registration-1', response: { id: 'new-credential', response: {} } });
  expect(navigator.geolocation.getCurrentPosition).not.toHaveBeenCalled();
});

test('unavailable phone verification settings fail closed', async () => {
  api.get.mockImplementation(path => path === '/biometrics' ? Promise.reject({ response: { data: { error: 'Phone verification is unavailable' } } })
    : Promise.resolve({ data: path === '/events' ? [event] : { logs: [], mandatoryCount: 1 } }));
  await dashboard(); fillCheckIn();
  expect(await screen.findByRole('alert')).toHaveTextContent('Phone verification is unavailable');
  expect(screen.getByRole('button', { name: 'Check location & mark attendance' })).toBeDisabled();
  expect(navigator.geolocation.getCurrentPosition).not.toHaveBeenCalled();
});


test('required Wi-Fi attendance cannot be marked from a browser that cannot observe its SSID', async () => {
  api.post.mockResolvedValue({ data: { user: { uid: 'u1', email: mockUser.email, role: 'student' }, venue: { ...venue, attendanceWifi: { required: true, ssid: 'Shikshavertex_5G' } } } });
  await dashboard(); fillCheckIn();
  expect(screen.getByText(/this browser cannot verify the connected network name/i)).toBeInTheDocument();
  const button = screen.getByRole('button', { name: 'Check location & mark attendance' });
  expect(button).toBeDisabled(); fireEvent.click(button);
  expect(navigator.geolocation.getCurrentPosition).not.toHaveBeenCalled();
  expect(api.post).not.toHaveBeenCalledWith('/attendance', expect.anything());
});

test('committee browser overrides cannot bypass required Wi-Fi attendance', async () => {
  api.post.mockResolvedValue({ data: { user: { uid: 'u1', email: mockUser.email, role: 'committee' }, venue: { ...venue, attendanceWifi: { required: true, ssid: 'Shikshavertex_5G' } } } });
  await dashboard();
  expect(await screen.findByText(/Browser committee overrides are unavailable/i)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Record committee override' })).not.toBeInTheDocument();
});
