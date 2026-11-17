import { useEffect, useState } from 'react';
import { CalendarDays, CheckCircle, MapPin, ShieldCheck } from 'lucide-react';

export default function WorkspaceNavigation({ user, committee }) {
  const [anchor, setAnchor] = useState(() => window.location.hash);
  useEffect(() => {
    const update = () => setAnchor(window.location.hash);
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  const viewer = user.role === 'attendance-viewer';
  const personal = !viewer ? [['#my-check-in', 'My check-in', MapPin], ['#my-history', 'Attendance history', CalendarDays]] : [];
  const reports = user.canViewAllAttendance || committee ? [['#all-attendance', 'Everyone’s attendance', CheckCircle]] : [];
  const hr = committee ? [['#hr-directory', 'Directory & approvals', ShieldCheck], ['#hr-controls', 'Session controls', CalendarDays]] : [];
  const links = [
    ...(committee ? [...reports, ...hr, ...personal] : [...personal, ...reports]),
    ...(!viewer ? [['#movement-report', committee ? 'Movement reports' : 'My movement report', MapPin]] : []),
  ];
  const current = links.some(([href]) => href === anchor) ? anchor : (committee || viewer ? '#all-attendance' : '#my-check-in');
  return <nav className="workspace-nav" aria-label="Workspace navigation">
    <p className="eyebrow">YOUR WORKSPACE</p>
    <p className="nav-identity">{user.email}</p>
    <div className="workspace-nav-links">{links.map(([href, label, Icon]) => <a key={href} href={href} className={current === href ? 'is-active' : ''} aria-current={current === href ? 'location' : undefined}><Icon size={18} aria-hidden="true" />{label}</a>)}</div>
    <div className="workspace-nav-note"><ShieldCheck size={18} aria-hidden="true" /><p className="field-help">{viewer ? 'Read-only attendance access.' : 'Check-ins and location sharing have separate consent.'}</p></div>
  </nav>;
}
