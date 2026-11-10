import { useRef, useState } from 'react';
import api from './api';

export default function EmployeeEmailImport({ disabled, onBusy, onImported }) {
  const [rows, setRows] = useState(null); const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const version = useRef(0); const submitting = useRef(false);
  async function choose(event) {
    const current = ++version.current;
    setRows(null); setConfirmed(false); setError(''); setNotice('');
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      if (file.size > 65536) throw new Error('Choose the employee email JSON file, smaller than 64 KB.');
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data.employees) || !data.employees.length || data.employees.length > 100 ||
          data.employees.some(row => !/^SV\d{3}$/.test(row.employeeId || '') || typeof row.fullName !== 'string' || !/^[^\s/@]+@shikshavertex\.in$/i.test(row.email || '')))
        throw new Error('The file must contain employee IDs, full names and company email addresses.');
      if (new Set(data.employees.map(row => row.employeeId)).size !== data.employees.length || new Set(data.employees.map(row => row.email.toLowerCase())).size !== data.employees.length)
        throw new Error('Duplicate employee IDs or email addresses were found.');
      if (version.current === current) setRows(data.employees);
    } catch (failure) { if (version.current === current) setError(failure.message || 'The import file could not be read.'); }
  }
  async function save() {
    if (disabled || submitting.current || !rows || !confirmed) return;
    submitting.current = true; onBusy(true); setError(''); setNotice('');
    try {
      const { data } = await api.post('/employees/registration-emails', { employees: rows });
      setNotice(`${data.imported} registration emails saved; ${data.unchanged} already matched. Employee approval is still required.`);
      setRows(null); setConfirmed(false);
      try { await onImported(); } catch { setError('Import saved, but the directory could not refresh. Refresh the directory before approving employees.'); }
    } catch (failure) { setError(failure.response?.data?.error || 'The import could not be confirmed. Refresh before retrying.'); }
    finally { submitting.current = false; onBusy(false); }
  }
  return <details className="email-import"><summary>Import official registration emails</summary>
    <p>Upload the private employee email JSON file. This adds official email matching to existing profiles. It does not create passwords, approve accounts or grant HR permissions. Existing links, disabled profiles and employees omitted from the file are preserved.</p>
    <label htmlFor="employee-email-file">Employee email JSON file</label><input id="employee-email-file" type="file" accept=".json,application/json" disabled={disabled} onChange={choose} />
    {rows && <><p role="status">Ready to import {rows.length} employee emails.</p><label className="checkbox"><input type="checkbox" checked={confirmed} disabled={disabled} onChange={event => setConfirmed(event.target.checked)} />I have checked that this is the official company employee email list.</label><button type="button" className="primary" disabled={disabled || !confirmed} onClick={save}>Save registration emails</button></>}
    {error && <p role="alert" className="alert error">{error}</p>}{notice && <p role="status" className="alert success">{notice}</p>}
  </details>;
}
