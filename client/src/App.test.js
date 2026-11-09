jest.mock('./VenueGate', () => ({ __esModule: true, default: ({ children }) => children }));
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createUserWithEmailAndPassword, onAuthStateChanged, reload, sendEmailVerification, signOut, signInWithEmailAndPassword } from 'firebase/auth';
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
  event.date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  jest.clearAllMocks(); localStorage.clear(); firebaseConfig.firebaseConfigured = true;
  delete window.webkit;
  onAuthStateChanged.mockImplementation((auth, callback) => { mockAuthCallback = callback; callback(mockUser); return jest.fn(); });
  mockUser = { uid: 'u1', email: 'student@shikshavertex.in', emailVerified: true, getIdToken: jest.fn().mockResolvedValue('verified-token') };
  firebaseConfig.auth.currentUser = mockUser;
  api.post.mockImplementation(path => Promise.resolve({ data: path === '/attendance' ? receiptResponse() : { user: { uid: 'u1', email: mockUser.email, role: 'student' }, venue } }));
  mockBiometrics = { required: false, configured: true, registered: false };
  browserSupportsWebAuthn.mockReturnValue(true);
  api.get.mockImplementation(path => Promise.resolve({ data: path === '/biometrics' ? mockBiometrics : path === '/events' ? [event] : { logs: [], mandatoryCount: 1 } }));
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: jest.fn() } });
  reload.mockResolvedValue(undefined); sendEmailVerification.mockResolvedValue(undefined);
  signOut.mockImplementation(async () => { mockUser = null; firebaseConfig.auth.currentUser = null; mockAuthCallback(null); });
});

function receiptResponse() { return { success: true, alreadyMarked: false, attendance: { id: 'saved', uid: 'u1', eventId: 'drive-1', email: mockUser.email, timestamp: new Date().toISOString(), method: 'self', attendanceMode: 'setup', locationVerified: false } }; }

async function dashboard() {
  render(<App />);
  await screen.findByRole('heading', { name: 'Mark your attendance' });
  await waitFor(() => expect(screen.queryByText('Checking phone verification settings…')).not.toBeInTheDocument());
}
function fillCheckIn() {
  fireEvent.change(screen.getByLabelText('Event'), { target: { value: 'drive-1' } });
  fireEvent.click(screen.getByRole('checkbox', { name: /I agree to share and store my location/ }));
}

test('iPhone check-in uses native verification and displays only a confirmed server receipt', async () => {
  const postMessage = jest.fn().mockResolvedValue({ status: 200, data: { success: true, alreadyMarked: false, attendance: { id: 'saved', uid: 'u1', eventId: 'drive-1', email: 'student@shikshavertex.in', timestamp: new Date().toISOString(), method: 'self', attendanceMode: 'onsite', locationVerified: true } } });
  window.webkit = { messageHandlers: { attendance: { postMessage } } };
  mockBiometrics = { required: true, registered: true, configured: true };
  startAuthentication.mockResolvedValue({ id: 'credential' });
  api.post.mockImplementation(path => Promise.resolve({ data: path.endsWith('/options') ? { challengeId: 'c1', options: {} } : path.endsWith('/verify') ? { verified: true, proof: 'phone-proof' } : { user: { uid: 'u1', email: mockUser.email, role: 'student' }, venue } }));
  await dashboard(); fillCheckIn();
  fireEvent.click(screen.getByRole('button', { name: 'Check location & mark attendance' }));
  expect(await screen.findByText('Attendance recorded successfully.')).toBeInTheDocument();
  expect(postMessage).toHaveBeenCalledWith({ action: 'markAttendance', eventId: 'drive-1', biometricProof: 'phone-proof', idToken: 'verified-token' });
  expect(api.post).not.toHaveBeenCalledWith('/attendance', expect.anything());
  expect(navigator.geolocation.getCurrentPosition).not.toHaveBeenCalled();
});

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
  expect(screen.getByRole('button', { name: 'Check location & mark attendance' })).toBeDisabled();
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
  expect(await screen.findByText(/Sessions and approvals can be managed from anywhere/i)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Record committee override' })).not.toBeInTheDocument();
});

test('a viewer-only account sees attendance reporting without employee or HR controls', async () => {
  api.post.mockResolvedValue({ data: { user: { uid: 'u1', email: mockUser.email, role: 'attendance-viewer', canViewAllAttendance: true }, venue } });
  api.get.mockImplementation(async url => ({ data: { date: new URLSearchParams(url.split('?')[1]).get('date'), rows: [], events: [], totals: { accounts: 0, marked: 0, notMarked: 0 } } }));
  render(<App />);
  expect(await screen.findByRole('heading', { name: 'Everyone’s attendance' })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Mark your attendance' })).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Daily location report' })).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'HR session controls' })).not.toBeInTheDocument();
  expect(api.get.mock.calls.some(([path]) => ['/events', '/attendance-summary', '/biometrics'].includes(path))).toBe(false);
});


test('password visibility is explicit and switching registration modes clears the secret', () => {
  mockUser = null; firebaseConfig.auth.currentUser = null;
  render(<App />);
  const password = screen.getByLabelText('Password');
  fireEvent.change(password, { target: { value: 'chosen-app-password' } });
  fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
  expect(password).toHaveAttribute('type', 'text');
  fireEvent.click(screen.getByRole('button', { name: 'Hide password' }));
  expect(password).toHaveAttribute('type', 'password');
  fireEvent.click(screen.getByRole('button', { name: 'Register', exact: true }));
  expect(password).toHaveValue('');
  expect(createUserWithEmailAndPassword).not.toHaveBeenCalled();
});

test('invalid Firebase credentials give registration/reset guidance without binding or querying attendance', async () => {
  mockUser = null; firebaseConfig.auth.currentUser = null;
  signInWithEmailAndPassword.mockRejectedValueOnce({ code: 'auth/invalid-credential', message: 'The supplied auth credential is incorrect, malformed or has expired.' });
  render(<App />);
  fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'surya_deekshith@shikshavertex.in' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'private-choice' } });
  fireEvent.click(screen.getAllByRole('button', { name: 'Sign in', exact: true }).at(-1));
  expect(await screen.findByRole('alert')).toHaveTextContent('Register if this is your first time');
  expect(api.post).not.toHaveBeenCalled(); expect(api.get).not.toHaveBeenCalled();
});

test('verification resend has a visible cooldown and never resends automatically', async () => {
  jest.useFakeTimers();
  try {
    mockUser.emailVerified = false;
    render(<App />);
    await screen.findByRole('heading', { name: 'Verify your email' });
    fireEvent.click(screen.getByRole('button', { name: 'Resend verification email' }));
    expect(await screen.findByRole('button', { name: 'Resend in 60s' })).toBeDisabled();
    act(() => jest.advanceTimersByTime(60000));
    expect(screen.getByRole('button', { name: 'Resend verification email' })).toBeEnabled();
    expect(sendEmailVerification).toHaveBeenCalledTimes(1);
  } finally { jest.useRealTimers(); }
});

test('past and future open sessions are not offered for self check-in', async () => {
  const initialGet = api.get.getMockImplementation();
  api.get.mockImplementation(path => path === '/events' ? Promise.resolve({ data: [
    { ...event, date: '2020-01-01' }, { ...event, id: 'future', date: '2099-01-01' },
  ] }) : initialGet(path));
  await dashboard();
  expect(screen.getByRole('option', { name: 'No open events to check into' })).toBeInTheDocument();
  expect(screen.queryByRole('option', { name: /Placement workshop ·/ })).not.toBeInTheDocument();
});


test('retired setup flags cannot enable browser check-in or expose old prerequisite wording', async () => {
  api.post.mockResolvedValue({ data: { user: { uid: 'u1', email: mockUser.email, role: 'student' }, venue: { ...venue, attendanceMode: 'setup', accessRequired: false, locationRequired: false, attendanceWifi: { required: false }, requiresRoomCode: true } } });
  await dashboard(); fillCheckIn();
  expect(screen.getByRole('button', { name: 'Check location & mark attendance' })).toBeDisabled();
  expect(document.body.textContent).not.toMatch(/temporary setup mode|wi-fi|room.?code/i);
  expect(navigator.geolocation.getCurrentPosition).not.toHaveBeenCalled();
  expect(api.post).not.toHaveBeenCalledWith('/attendance', expect.anything());
});
