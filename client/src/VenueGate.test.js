import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import VenueGate, { evaluateVenue } from './VenueGate';

const venue = { configured: true, latitude: 12.912773610440954, longitude: 77.62322878099566, radiusMeters: 100, maxAccuracyMeters: 50 };
const position = (overrides = {}) => ({ coords: { latitude: venue.latitude, longitude: venue.longitude, accuracy: 5, ...overrides }, timestamp: Date.now() });
beforeEach(() => {
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { watchPosition: jest.fn(), getCurrentPosition: jest.fn(), clearWatch: jest.fn() } });
});
test('opening and resuming the workspace never requests location or starts an access watcher', () => {
  render(<VenueGate><div>Account screens remain available</div></VenueGate>);
  expect(screen.getByText('Account screens remain available')).toBeInTheDocument();
  fireEvent(document, new Event('visibilitychange'));
  fireEvent(window, new Event('venue-access-locked'));
  expect(screen.getByText('Account screens remain available')).toBeInTheDocument();
  expect(navigator.geolocation.watchPosition).not.toHaveBeenCalled();
  expect(navigator.geolocation.getCurrentPosition).not.toHaveBeenCalled();
  expect(screen.queryByText(/app locked|setup mode/i)).not.toBeInTheDocument();
});
test('attendance geofence still rejects an outside, uncertain or stale observation', () => {
  expect(evaluateVenue(position(), venue)).toBe(true);
  expect(evaluateVenue(position({ latitude: 13.1 }), venue)).toBe(false);
  expect(evaluateVenue(position({ latitude: venue.latitude + .00072, accuracy: 30 }), venue)).toBe(false);
  expect(evaluateVenue(position({ accuracy: 51 }), venue)).toBe(false);
  expect(evaluateVenue({ ...position(), timestamp: Date.now() - 15001 }, venue)).toBe(false);
});
