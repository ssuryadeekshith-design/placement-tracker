import { auth } from './firebase';
import { hasAppleAttendance, markAppleAttendance } from './appleAttendance';
jest.mock('./firebase', () => ({ auth: { currentUser: { getIdToken: jest.fn().mockResolvedValue('firebase-id-token') } } }));
beforeEach(() => { auth.currentUser.getIdToken.mockResolvedValue('firebase-id-token'); });
afterEach(() => { delete window.webkit; });

test('ordinary browsers cannot submit office-network attendance', async () => {
  expect(hasAppleAttendance()).toBe(false);
  await expect(markAppleAttendance('session-1', 'proof')).rejects.toThrow('Open the iPhone app');
});
test('native attendance receives only the current token, session and server-issued phone proof', async () => {
  const postMessage = jest.fn().mockResolvedValue({ status: 200, data: { success: true } });
  window.webkit = { messageHandlers: { attendance: { postMessage } } };
  expect((await markAppleAttendance('session-1', 'proof')).data.success).toBe(true);
  expect(auth.currentUser.getIdToken).toHaveBeenCalled();
  expect(postMessage).toHaveBeenCalledWith({ action: 'markAttendance', eventId: 'session-1', biometricProof: 'proof', idToken: 'firebase-id-token' });
  // Coordinates and network observations are obtained by native code, not JS.
  expect(postMessage.mock.calls[0][0]).not.toHaveProperty('location');
  expect(postMessage.mock.calls[0][0]).not.toHaveProperty('wifi');
});
test('server rejection and uncertain responses never become a success receipt', async () => {
  const postMessage = jest.fn().mockResolvedValue({ status: 403, data: { error: 'Outside the venue' } });
  window.webkit = { messageHandlers: { attendance: { postMessage } } };
  await expect(markAppleAttendance('session-1', 'proof')).rejects.toMatchObject({ response: { status: 403, data: { error: 'Outside the venue' } } });
  postMessage.mockResolvedValue({});
  await expect(markAppleAttendance('session-1', 'proof')).rejects.toThrow('could not be confirmed');
});
