const crypto = require('node:crypto');

class HttpError extends Error {
    constructor(status, message) { super(message); this.status = status; }
}
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const normalizeEmail = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
const hmac = (value, secret) => crypto.createHmac('sha256', secret).update(value).digest('hex');
const safeEqual = (a, b) => {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    return left.length === right.length && crypto.timingSafeEqual(left, right);
};

function readDevice(req, secret) {
    const raw = (req.headers.cookie || '').split(';').map(value => value.trim()).find(value => value.startsWith('placement_device='));
    if (!raw) return null;
    const parts = raw.slice('placement_device='.length).split('.');
    const [token, signature] = parts;
    if (parts.length !== 2 || !/^[a-f0-9]{64}$/.test(token || '') || !/^[a-f0-9]{64}$/.test(signature || '') || !safeEqual(signature, hmac(token, secret))) {
        throw new HttpError(403, 'Browser binding is invalid. Contact the committee for help.');
    }
    return token;
}

function distanceMeters(fromLat, fromLng, toLat, toLng) {
    const rad = angle => angle * Math.PI / 180;
    const a = Math.sin(rad(toLat - fromLat) / 2) ** 2 + Math.cos(rad(fromLat)) * Math.cos(rad(toLat)) * Math.sin(rad(toLng - fromLng) / 2) ** 2;
    return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}

function checkLocation(location, venue, now) {
    if (!venue.configured || !Number.isFinite(venue.latitude) || !Number.isFinite(venue.longitude)) {
        throw new HttpError(503, 'The venue pin has not been configured. Contact the committee.');
    }
    const { latitude, longitude, accuracyMeters, capturedAt } = location || {};
    if (![latitude, longitude, accuracyMeters, capturedAt].every(value => typeof value === 'number' && Number.isFinite(value)) ||
        latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180 || accuracyMeters <= 0) {
        throw new HttpError(400, 'A fresh location with latitude, longitude, accuracy and capture time is required.');
    }
    if (capturedAt < now - 60000 || capturedAt > now + 5000) throw new HttpError(400, 'Location has expired. Get a fresh location and try again.');
    if (accuracyMeters > venue.maxAccuracyMeters) throw new HttpError(400, 'Location is not accurate enough. Enable precise location and try again.');
    const distance = distanceMeters(latitude, longitude, venue.latitude, venue.longitude);
    // Require the reported accuracy circle to fit inside the venue radius.
    if (distance + accuracyMeters > venue.radiusMeters) throw new HttpError(403, 'You must be within the venue check-in area.');
    return { latitude, longitude, accuracyMeters, capturedAt: new Date(capturedAt).toISOString(), distanceMeters: Math.round(distance) };
}

const indiaDate = now => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
function checkEvent(event, now) {
    if (!event || event.checkInOpen !== true || event.date !== indiaDate(now)) throw new HttpError(403, 'Check-in is closed for this event. It must be open and scheduled for today (India time).');
}

module.exports = { HttpError, digest, normalizeEmail, hmac, safeEqual, readDevice, checkLocation, checkEvent, distanceMeters, indiaDate };
