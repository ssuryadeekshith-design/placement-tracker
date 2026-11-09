import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { EmployeeApplication, EmployeeAdministration } from './EmployeeRegistration';
import api from './api';
jest.mock('./api', () => ({ get: jest.fn(), post: jest.fn() }));
beforeEach(() => { jest.clearAllMocks(); });

test('verified employee submits only a requested name and sees pending HR approval', async () => {
  api.get.mockResolvedValue({ data: { approved: false, status: 'not-requested' } });
  api.post.mockResolvedValue({ data: { status: 'pending' } });
  render(<EmployeeApplication email="employee@shikshavertex.in" onApproved={jest.fn()} />);
  const name = await screen.findByLabelText('Full employee name');
  fireEvent.change(name, { target: { value: 'Employee Name' } });
  fireEvent.click(screen.getByRole('button', { name: 'Request HR approval' }));
  expect(await screen.findByRole('status')).toHaveTextContent('pending HR approval');
  expect(api.post).toHaveBeenCalledWith('/registration/request', { fullName: 'Employee Name' });
});

test('approved status reloads the signed-in session while rejection cannot be resubmitted', async () => {
  const approved = jest.fn();
  api.get.mockResolvedValue({ data: { approved: true, status: 'approved' } });
  const { unmount } = render(<EmployeeApplication email="employee@shikshavertex.in" onApproved={approved} />);
  await waitFor(() => expect(approved).toHaveBeenCalled()); unmount();
  api.get.mockResolvedValue({ data: { approved: false, status: 'rejected', reason: 'Identity was not confirmed' } });
  render(<EmployeeApplication email="employee@shikshavertex.in" onApproved={jest.fn()} />);
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('HR rejected'));
  expect(screen.queryByRole('button', { name: 'Request HR approval' })).not.toBeInTheDocument();
});

test('HR chooses an explicit roster identity before approving and directory preserves job details', async () => {
  const employee = { employeeId: 'SV001', fullName: 'Arockia Joe Arnold', designation: 'Manager - Inside Sales', department: 'Inside Sales', team: 'Hogwarts', active: true };
  api.get.mockImplementation(path => Promise.resolve({ data: path === '/employees' ? [employee] : [{ id: 'new-user', uid: 'new-user', email: 'employee@shikshavertex.in', fullName: 'Applicant', emailVerified: true }] }));
  api.post.mockResolvedValue({ data: { approved: true } });
  render(<EmployeeAdministration />);
  const button = await screen.findByRole('button', { name: 'Approve employee' });
  expect(button).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Confirm employee identity'), { target: { value: 'SV001' } });
  fireEvent.click(screen.getByRole('checkbox', { name: /I have checked this applicant/ }));
  fireEvent.click(button);
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/registration-requests/new-user/approve', { employeeId: 'SV001' }));
  expect(within(screen.getByRole('region', { name: 'Employee directory results' })).getByText(/Manager - Inside Sales/)).toBeInTheDocument();
});

test('directory linking and job titles never imply a live verified Firebase account or administrator role', async () => {
  api.get.mockImplementation(path => Promise.resolve({ data: path === '/employees' ? [{ employeeId: 'HR1', fullName: 'Example HR Lead', designation: 'HR Team Leader', department: 'People', team: 'HR', active: true, email: 'lead@example.com', uid: 'linked-user' }] : [] }));
  render(<EmployeeAdministration />);
  expect(await screen.findByText('Profile linked')).toBeInTheDocument();
  expect(screen.getByText(/not a live Firebase Authentication status check/)).toBeInTheDocument();
  expect(screen.queryByText('Verified email')).not.toBeInTheDocument();
  expect(screen.getByText(/Job titles and team membership do not grant administrator access/)).toBeInTheDocument();
  expect(screen.getByText('No employee approval requests are pending.')).toBeInTheDocument();
});

test('HR profile search clears selection and requires renewed explicit identity confirmation', async () => {
  const employee = { employeeId: 'SV002', fullName: 'Matched Person', designation: 'Executive', department: 'Operations', team: 'Campus', active: true };
  api.get.mockImplementation(path => Promise.resolve({ data: path === '/employees' ? [employee] : [{ id: 'request', uid: 'request', fullName: 'Matched Person', email: 'person@example.com', emailVerified: true }] }));
  render(<EmployeeAdministration />);
  const approve = await screen.findByRole('button', { name: 'Approve employee' });
  fireEvent.change(screen.getByLabelText('Search matching employee profiles'), { target: { value: 'Matched Person' } });
  expect(approve).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Confirm employee identity'), { target: { value: 'SV002' } });
  expect(approve).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox', { name: /I have checked this applicant/ }));
  expect(approve).toBeEnabled();
  fireEvent.change(screen.getByLabelText('Search matching employee profiles'), { target: { value: 'Unrelated query' } });
  expect(screen.getByLabelText('Confirm employee identity')).toHaveValue('');
  expect(approve).toBeDisabled();
  expect(screen.getByRole('checkbox', { name: /I have checked this applicant/ })).not.toBeChecked();
});

test('directory Auth badges use reported Firebase metadata and never infer verification from a linked uid', async () => {
  const base = { designation: 'Executive', department: 'Operations', team: 'Campus', active: true };
  const employees = [
    { ...base, employeeId: 'verified', fullName: 'Verified Person', uid: 'verified-uid', email: 'verified@example.com', authStatus: { state: 'verified', checked: true, emailMatches: true } },
    { ...base, employeeId: 'missing', fullName: 'Missing Account', uid: 'missing-uid', email: 'missing@example.com', authStatus: { state: 'missing', checked: true, emailMatches: null } },
    { ...base, employeeId: 'unlinked', fullName: 'Unlinked Person', authStatus: { state: 'unlinked', checked: false, emailMatches: null } },
    { ...base, employeeId: 'legacy', fullName: 'Linked Without Metadata', uid: 'legacy-uid', email: 'legacy@example.com' },
    { ...base, employeeId: 'unknown', fullName: 'Uncheckable Account', uid: 'unknown-uid', email: 'unknown@example.com', authStatus: { state: 'unknown', checked: false, emailMatches: null } },
  ];
  api.get.mockImplementation(path => Promise.resolve({ data: path === '/employees' ? employees : [] }));
  render(<EmployeeAdministration />);
  expect(await screen.findByText('Firebase account email verified')).toBeInTheDocument();
  expect(screen.getByText('Firebase account missing')).toBeInTheDocument();
  expect(screen.getAllByText('Auth status not checked')).toHaveLength(2);
  expect(screen.getAllByText('Firebase account email verified')).toHaveLength(1);
  expect(screen.getAllByText('Profile linked')).toHaveLength(4);
  expect(screen.getByText('No login linked')).toBeInTheDocument();
});

test('a verified Firebase account email does not imply it matches the directory email', async () => {
  api.get.mockImplementation(path => Promise.resolve({ data: path === '/employees' ? [{ employeeId: 'mismatch', fullName: 'Email Mismatch', uid: 'linked-uid', email: 'directory@example.com', active: true, authStatus: { state: 'verified', checked: true, emailMatches: false } }] : [] }));
  render(<EmployeeAdministration />);
  expect(await screen.findByText('Firebase account email verified')).toBeInTheDocument();
  expect(screen.getByText('Directory email differs from Firebase account')).toBeInTheDocument();
  expect(screen.getByText('directory@example.com')).toBeInTheDocument();
});


test('malformed directory responses do not pretend the queue is empty', async () => {
  api.get.mockResolvedValue({ data: {} });
  render(<EmployeeAdministration />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Directory data is incomplete');
  expect(screen.queryByText('No employee approval requests are pending.')).not.toBeInTheDocument();
});

test('unconfirmed Auth metadata cannot produce a verified badge and directory IDs are searchable', async () => {
  api.get.mockImplementation(path => Promise.resolve({ data: path === '/employees' ? [{ employeeId: 'SV090', fullName: 'Sample Person', active: false, department: 'Operations', team: 'Campus', uid: 'sample', authStatus: { state: 'verified' } }] : [] }));
  render(<EmployeeAdministration />);
  expect(await screen.findByText('Auth status not checked')).toBeInTheDocument();
  expect(screen.queryByText('Firebase account email verified')).not.toBeInTheDocument();
  expect(screen.getByText('Directory profile inactive')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Search employees, departments or teams'), { target: { value: 'SV090 Campus' } });
  expect(screen.getByText('Sample Person')).toBeInTheDocument();
});

test('incompatible email links are excluded from profile matching', async () => {
  api.get.mockImplementation(path => Promise.resolve({ data: path === '/employees' ? [{ employeeId: 'SV001', fullName: 'Wrong Link', active: true, email: 'another@example.com' }] : [{ id: 'new', uid: 'new', fullName: 'Applicant', email: 'applicant@example.com', emailVerified: true }] }));
  render(<EmployeeAdministration />);
  expect(await screen.findByRole('button', { name: 'Approve employee' })).toBeDisabled();
  expect(screen.queryByRole('option', { name: /Wrong Link/ })).not.toBeInTheDocument();
});

test('a saved approval followed by failed refresh clears acted controls and reports success separately', async () => {
  let fail = false;
  const employee = { employeeId: 'SV001', fullName: 'Sample Employee', active: true };
  api.get.mockImplementation(path => fail ? Promise.reject(new Error('Offline')) : Promise.resolve({ data: path === '/employees' ? [employee] : [{ id: 'new', uid: 'new', fullName: 'Applicant', email: 'person@example.com', emailVerified: true }] }));
  api.post.mockImplementation(async () => { fail = true; return { data: { approved: true } }; });
  render(<EmployeeAdministration />);
  await screen.findByRole('button', { name: 'Approve employee' });
  fireEvent.change(screen.getByLabelText('Confirm employee identity'), { target: { value: 'SV001' } });
  fireEvent.click(screen.getByRole('checkbox', { name: /I have checked this applicant/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Approve employee' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Change saved, but');
  expect(screen.getByRole('status')).toHaveTextContent('Employee approved');
  expect(screen.queryByRole('button', { name: 'Approve employee' })).not.toBeInTheDocument();
  expect(screen.queryByText('Sample Employee')).not.toBeInTheDocument();
});


test('a contradictory request UID is not offered for identity matching', async () => {
  api.get.mockImplementation(path => Promise.resolve({ data: path === '/employees' ? [] : [{ id: 'one', uid: 'different', fullName: 'Applicant', email: 'person@example.com', emailVerified: true }] }));
  render(<EmployeeAdministration />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Directory data is incomplete');
  expect(screen.queryByRole('button', { name: 'Approve employee' })).not.toBeInTheDocument();
  expect(api.post).not.toHaveBeenCalled();
});
