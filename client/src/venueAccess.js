let accessRequired = true;
export function isSetupPolicy(venue) {
  return venue?.attendanceMode === 'setup' && venue?.accessRequired === false && venue?.locationRequired === false && venue?.attendanceWifi?.required === false && venue?.requiresRoomCode === false;
}
export function setVenuePolicy(venue) { accessRequired = !isSetupPolicy(venue); }
export function isVenueRequired() { return accessRequired; }
let location = null;
let token = null;
let expiresAt = 0;
let revision = 0;
let pending = null;
export function setVenueLocation(value) { location = value; }
export function clearVenueAccess() { location = null; token = null; expiresAt = 0; pending = null; revision += 1; }
export function venueRevision() { return revision; }
export function currentVenueLocation() {
  if (!location || document.hidden || Date.now() - location.capturedAt > 15000 || location.capturedAt > Date.now() + 5000) throw new Error('The app is locked. Confirm a fresh location at the venue.');
  return location;
}
export async function ensureVenueAccess(api) {
  const point = currentVenueLocation();
  if (token && expiresAt > Date.now() + 3000) return token;
  if (!pending) {
    const generation = revision;
    pending = api.post('/access/verify', { location: point }).then(({ data }) => {
      currentVenueLocation();
      if (revision !== generation) throw new Error('Venue access changed. Confirm your location again.');
      if (typeof data.token !== 'string' || !Number.isFinite(data.expiresAt) || data.expiresAt <= Date.now()) throw new Error('The server could not unlock venue access.');
      token = data.token; expiresAt = data.expiresAt;
      return token;
    }).finally(() => { if (generation === revision) pending = null; });
  }
  return pending;
}
