import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { apiError, mockApi } from '../test/mockApi';
import { LoginPage } from './LoginPage';

const user = { id: 'u1', name: 'Priya Shah', email: 'priya@example.com' };

describe('LoginPage', () => {
  it('signs in and hands the session to the app', async () => {
    const m = mockApi({ 'POST /api/auth/login': { body: { user } } });
    const onLogin = vi.fn();
    render(<LoginPage onLogin={onLogin} />);
    await userEvent.type(screen.getByLabelText('Email'), 'priya@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'password123');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(onLogin).toHaveBeenCalledWith({ userId: 'u1', name: 'Priya Shah', email: 'priya@example.com' });
    expect(m.calls[0].body).toEqual({ email: 'priya@example.com', password: 'password123' });
  });

  it('shows the server message for a wrong password, and re-enables the button', async () => {
    mockApi({ 'POST /api/auth/login': apiError(401, 'invalid_credentials', 'Incorrect email or password.') });
    render(<LoginPage onLogin={vi.fn()} />);
    await userEvent.type(screen.getByLabelText('Email'), 'a@b.co');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Incorrect email or password.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  });

  it('sign up: 8-character minimum in the form, field errors from the server shown under the field', async () => {
    mockApi({ 'POST /api/auth/signup': apiError(409, 'email_taken', 'An account with this email already exists.', { email: 'An account with this email already exists.' }) });
    render(<LoginPage onLogin={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Create an account' }));
    expect(screen.getByRole('heading', { name: 'Create your account' })).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toHaveAttribute('minLength', '8');
    expect(screen.getByText('At least 8 characters.')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Name'), 'Priya');
    await userEvent.type(screen.getByLabelText('Email'), 'taken@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'password123');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('An account with this email already exists.')).toHaveClass('field-error');
  });

  it('switching between sign in and sign up clears errors; there is no demo-account shortcut', async () => {
    mockApi({ 'POST /api/auth/login': apiError(401, 'invalid_credentials', 'Incorrect email or password.') });
    render(<LoginPage onLogin={vi.fn()} />);
    expect(screen.queryByText(/demo account/i)).toBeNull();
    await userEvent.type(screen.getByLabelText('Email'), 'a@b.co');
    await userEvent.type(screen.getByLabelText('Password'), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByText('Incorrect email or password.');
    await userEvent.click(screen.getByRole('button', { name: 'Create an account' }));
    expect(screen.queryByText('Incorrect email or password.')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });
});
