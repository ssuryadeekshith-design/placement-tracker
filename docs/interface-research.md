# Shikshavertex interface refresh — 18 November 2026

Scope: Android and web presentation. Authentication, access roles, office checks,
saved timestamps, reporting APIs and separate movement-sharing consent remain intact.

## Sources reviewed

- [Odoo attendance menu implementation](https://github.com/odoo/odoo/blob/18.0/addons/hr_attendance/static/src/components/attendance_menu/attendance_menu.xml):
  prominent attendance action, explicit position-loading feedback and a separate
  view of recorded activity. Apply action/status hierarchy; do not copy worked-hour
  totals or checkout behavior that Shikshavertex does not implement.
- [Kimai project overview](https://github.com/kimai/kimai): responsive interfaces,
  role/team permissions, search/filtering and reporting. Apply clear employee/HR
  surfaces and usable report controls, without implying feature parity.
- [Material Android cards](https://github.com/material-components/material-components-android/blob/master/docs/components/Card.md):
  distinguish headline, supporting content and actions; use consistent surfaces,
  restrained elevation and visible pressed/disabled states.
- [WCAG use of color](https://github.com/w3c/wcag/blob/main/understanding/20/use-of-color.html):
  convey status through text as well as color. Preserve explicit ready, pending,
  unconfirmed, error and saved states.
- [WCAG contrast minimum](https://github.com/w3c/wcag/blob/main/understanding/20/contrast-minimum.html):
  aim for at least 4.5:1 normal text contrast; test the chosen text/surface pairs.
- [WCAG target size](https://github.com/w3c/wcag/blob/main/understanding/22/target-size-minimum.html):
  minimum target guidance and the larger enhanced target. Use comfortable 44–52px
  web controls and at least 48dp native actions, with keyboard focus retained.

Direct vendor marketing sites and the Material website were unavailable through
the research network policy. Their designs were not used as evidence. The primary
sources above were successfully retrieved and reviewed. This is a design
recommendation, not a claim that one vendor has the universally “best” frontend.

## Design decisions

Keep the approved red Shiksha Vertex logo, Inter typeface, indigo/royal blue,
white surfaces and amber/green/red semantic states. Use a navy workspace sidebar,
a focused public sign-in layout, stronger heading hierarchy, generous card spacing,
clear form boundaries and responsive report tables. Native screens share the same
visual system and show actual loaded session/receipt counts rather than invented
hours, payroll, attendance percentages or live staffing statistics.

Shorten dense readiness content with an accessible disclosure, while leaving the
current-state labels and the distinction from saved attendance visible. Do not
infer successful attendance from readiness. Respect reduced motion, large fonts,
keyboard focus, missing data, loading states and read-only roles.

## Validation

Run the existing web tests and full browser integration fixture; inspect sign-in,
registration, employee, HR and viewer layouts at desktop/mobile widths. Run the
native compile, unit and lint checks in GitHub's Android environment. Native
hardware behavior still requires a real phone; styling checks do not validate GPS,
office connectivity, passkeys or background collection.
