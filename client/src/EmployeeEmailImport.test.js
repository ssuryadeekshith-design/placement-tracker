import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import EmployeeEmailImport from './EmployeeEmailImport';
import api from './api';
jest.mock('./api', () => ({ post: jest.fn() }));
const employees = [{ employeeId: 'SV001', fullName: 'Sample Employee', email: 'sample@shikshavertex.in' }];
const file = data => ({ size: 100, text: async () => JSON.stringify(data) });
beforeEach(() => jest.clearAllMocks());

test('HR reviews a private file and explicitly confirms before the only import request', async () => {
  api.post.mockResolvedValue({ data: { imported: 1, unchanged: 0 } });
  const onImported = jest.fn(); const onBusy = jest.fn();
  render(<EmployeeEmailImport disabled={false} onBusy={onBusy} onImported={onImported} />);
  fireEvent.change(screen.getByLabelText('Employee email JSON file'), { target: { files: [file({ employees })] } });
  expect(await screen.findByRole('button', { name: 'Save registration emails' })).toBeDisabled();
  expect(api.post).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Save registration emails' }));
  await waitFor(() => expect(onImported).toHaveBeenCalled());
  expect(api.post).toHaveBeenCalledWith('/employees/registration-emails', { employees });
  expect(screen.getByRole('status')).toHaveTextContent('Employee approval is still required');
  expect(onBusy.mock.calls).toEqual([[true], [false]]);
});
test('duplicate email rows are rejected before any request', async () => {
  render(<EmployeeEmailImport onBusy={jest.fn()} onImported={jest.fn()} />);
  fireEvent.change(screen.getByLabelText('Employee email JSON file'), { target: { files: [file({ employees: [...employees, { ...employees[0], employeeId: 'SV002' }] })] } });
  expect(await screen.findByRole('alert')).toHaveTextContent('Duplicate');
  expect(api.post).not.toHaveBeenCalled();
});
test('server ownership conflicts are shown without a successful import message', async () => {
  api.post.mockRejectedValue({ response: { data: { error: 'Email ownership conflicts with an existing profile (SV001).' } } });
  const onImported = jest.fn();
  render(<EmployeeEmailImport onBusy={jest.fn()} onImported={onImported} />);
  fireEvent.change(screen.getByLabelText('Employee email JSON file'), { target: { files: [file({ employees })] } });
  await screen.findByRole('button', { name: 'Save registration emails' }); fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Save registration emails' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('ownership conflicts');
  expect(onImported).not.toHaveBeenCalled();
});
