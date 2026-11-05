import { useCallback, useEffect, useRef, useState } from 'react';
import { browserSupportsWebAuthn, startAuthentication, startRegistration } from '@simplewebauthn/browser';
import api from './api';

function verificationMessage(error) {
  if (error.response?.data?.error) return error.response.data.error;
  if (['NotAllowedError', 'AbortError'].includes(error.name) || error.code === 'ERROR_CEREMONY_ABORTED') return 'Phone verification was cancelled or timed out. Attendance was not marked.';
  return error.message || 'Phone verification could not be completed. Please try again.';
}

export function useAttendanceVerification({ setError, setNotice, setBusy }) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const active = useRef(true);
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/biometrics');
      if (!data || !['required', 'registered', 'configured'].every(field => typeof data[field] === 'boolean')) throw new Error('Phone verification settings are unavailable. Please contact the committee.');
      if (active.current) setStatus(data);
      return true;
    } catch (error) {
      if (active.current) { setStatus(null); setError(verificationMessage(error)); }
      return false;
    } finally { if (active.current) setLoading(false); }
  }, [setError]);
  useEffect(() => { active.current = true; refresh(); return () => { active.current = false; }; }, [refresh]);
  const supported = browserSupportsWebAuthn();

  async function enroll() {
    setBusy(true); setError(''); setNotice('');
    try {
      if (!status?.configured || !supported) throw new Error('This browser cannot set up phone verification. Use a supported browser over HTTPS.');
      const { data } = await api.post('/biometrics/registration/options', {});
      const response = await startRegistration({ optionsJSON: data.options });
      const result = await api.post('/biometrics/registration/verify', { challengeId: data.challengeId, response });
      if (result.data?.verified !== true) throw new Error('Phone verification setup was not confirmed by the server.');
      if (await refresh()) setNotice('Phone verification is set up. Your fingerprint or face data stays on your phone.');
    } catch (error) { setError(verificationMessage(error)); }
    finally { setBusy(false); }
  }

  async function verify(eventId) {
    if (!status || loading) throw new Error('Wait for phone verification settings to load, then try again.');
    if (!status.required) return null;
    if (!status.configured || !status.registered || !supported) throw new Error('Set up phone verification on a supported phone before marking attendance.');
    try {
      const { data } = await api.post('/biometrics/authentication/options', { eventId });
      const response = await startAuthentication({ optionsJSON: data.options });
      const result = await api.post('/biometrics/authentication/verify', { challengeId: data.challengeId, response });
      if (result.data?.verified !== true || typeof result.data.proof !== 'string' || !result.data.proof) throw new Error('Phone verification was not confirmed by the server. Attendance was not marked.');
      return result.data.proof;
    } catch (error) { throw new Error(verificationMessage(error)); }
  }

  return { status, loading, supported, refresh, enroll, verify,
    ready: !loading && status && (!status.required || (status.configured && status.registered && supported)) };
}

export default function PhoneVerification({ verification, busy }) {
  const { status, loading, supported, enroll, refresh } = verification;
  if (loading) return <p className="field-help" role="status">Checking phone verification settings…</p>;
  if (!status) return <div className="callout"><p>Phone verification settings could not be loaded. Check-in is unavailable until they are confirmed.</p><button className="secondary" type="button" disabled={busy} onClick={refresh}>Retry phone verification settings</button></div>;
  if (!status.required) return null;
  return <div className="phone-verification">
    <h3>Phone verification</h3>
    <p className="field-help">Confirm attendance with your phone’s passkey. Depending on its settings, your phone may use fingerprint, face recognition or a device PIN. The app never receives your fingerprint or face data.</p>
    {!status.configured ? <p className="callout">The administrator must finish passkey configuration before check-in can be enabled.</p>
      : !supported ? <p className="callout">This browser does not support passkeys. Open the app in a supported phone browser over HTTPS, or ask the committee for help.</p>
        : status.registered ? <p className="verification-ready">Phone verification is ready. You will be prompted when you check in.</p>
          : <button className="secondary" type="button" disabled={busy} onClick={enroll}>Set up phone verification</button>}
  </div>;
}
