import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { session } from '../test/data';
import { TopBar } from './TopBar';

describe('TopBar', () => {
  it('shows the user, and Sign out calls onLogout', async () => {
    const onLogout = vi.fn();
    render(<TopBar session={session} onLogout={onLogout} />);
    expect(screen.getByText('Priya Shah')).toBeInTheDocument();
    expect(screen.getByTitle('priya@example.com')).toHaveTextContent('P');
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(onLogout).toHaveBeenCalledOnce();
  });

  it('highlights the section of the current page', async () => {
    window.location.hash = '#/';
    render(<TopBar session={session} onLogout={() => {}} />);
    expect(screen.getByRole('link', { name: 'Uploads' })).toHaveClass('on');
    expect(screen.getByRole('link', { name: 'Templates' })).not.toHaveClass('on');
    await act(async () => {
      window.location.hash = '#/templates/new';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(screen.getByRole('link', { name: 'Templates' })).toHaveClass('on');
  });

  it('the logo goes home', async () => {
    window.location.hash = '#/templates';
    render(<TopBar session={session} onLogout={() => {}} />);
    await userEvent.click(screen.getByRole('link', { name: /DataDesk/ }));
    expect(window.location.hash).toBe('#/');
  });

  it('renders extra content passed by a page', () => {
    render(
      <TopBar session={session} onLogout={() => {}}>
        <span>extra</span>
      </TopBar>,
    );
    expect(screen.getByText('extra')).toBeInTheDocument();
  });
});
