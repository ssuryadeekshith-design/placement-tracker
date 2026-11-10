import { auth } from './firebase';

// Only the iOS app installs this message handler. Safari and desktop browsers
// remain unable to confirm the office connection and cannot submit check-in.
export function hasAppleAttendance() {
  return typeof window.webkit?.messageHandlers?.attendance?.postMessage === 'function';
}

export async function markAppleAttendance(eventId, biometricProof) {
  if (!hasAppleAttendance() || !auth?.currentUser) throw new Error('Open the iPhone app and sign in before checking in.');
  const reply = await window.webkit.messageHandlers.attendance.postMessage({
    action: 'markAttendance', eventId, biometricProof,
    idToken: await auth.currentUser.getIdToken(),
  });
  if (!reply || !Number.isInteger(reply.status) || !reply.data) throw new Error('The attendance result could not be confirmed. Refresh your attendance before trying again.');
  if (reply.status < 200 || reply.status >= 300) {
    const error = new Error(reply.data.error || 'Attendance was not confirmed. Refresh before trying again.');
    error.response = { status: reply.status, data: reply.data };
    throw error;
  }
  return reply;
}
