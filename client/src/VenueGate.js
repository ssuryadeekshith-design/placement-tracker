import React from 'react';

export function evaluateVenue(position, venue, now = Date.now()) {
  const c = position?.coords;
  if (!venue?.configured || !c || ![c.latitude, c.longitude, c.accuracy, position.timestamp].every(Number.isFinite)) return false;
  if (c.latitude < -90 || c.latitude > 90 || c.longitude < -180 || c.longitude > 180 || c.accuracy <= 0 || c.accuracy > venue.maxAccuracyMeters || now - position.timestamp > 15000 || position.timestamp > now + 5000) return false;
  const rad = v => v * Math.PI / 180;
  const a = Math.sin(rad(c.latitude - venue.latitude) / 2) ** 2 + Math.cos(rad(c.latitude)) * Math.cos(rad(venue.latitude)) * Math.sin(rad(c.longitude - venue.longitude) / 2) ** 2;
  const distance = 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
  return distance + c.accuracy <= venue.radiusMeters;
}

// Opening the workspace never requests or monitors location.
// Authentication still controls its content; attendance is checked by the API.
export default function VenueGate({ children }) {
  return <>{children}</>;
}
