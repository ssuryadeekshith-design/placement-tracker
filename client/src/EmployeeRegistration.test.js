import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  expect(await screen.findByRole('status')).toHaveTextContent('HR rejected');
  expect(screen.queryByRole('button', { name: 'Request HR approval' })).not.toBeInTheDocument();
});

test('HR chooses an explicit roster identity before approving and directory preserves job details', async () => {
  const employee = { employeeId: 'SV001', fullName: 'Arockia Joe Arnold', designation: 'Manager - Inside Sales', department: 'Inside Sales', team: 'Hogwarts', active: true };
  api.get.mockImplementation(path => Promise.resolve({ data: path === '/employees' ? [employee] : [{ id: 'new-user', uid: 'new-user', email: 'employee@shikshavertex.in', fullName: 'Applicant' }] }));
  api.post.mockResolvedValue({ data: { approved: true } });
  render(<EmployeeAdministration />);
  const button = await screen.findByRole('button', { name: 'Approve employee' });
  expect(button).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Confirm employee identity'), { target: { value: 'SV001' } });
  fireEvent.click(button);
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/registration-requests/new-user/approve', { employeeId: 'SV001' }));
  expect(screen.getByText('Manager - Inside Sales')).toBeInTheDocument();
});
