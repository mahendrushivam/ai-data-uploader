import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { useConfirm, type ConfirmOptions } from './ConfirmDialog';

/** A tiny host page: a button that asks, and shows the answer. */
function Host({ options }: { options: ConfirmOptions }) {
  const { confirm, dialog } = useConfirm();
  return (
    <>
      <button onClick={async () => (document.title = String(await confirm(options)))}>Delete it</button>
      {dialog}
    </>
  );
}
const options: ConfirmOptions = { title: 'Remove this upload?', message: <b>October tickets</b>, confirmLabel: 'Remove upload', danger: true };
const open = async () => {
  render(<Host options={options} />);
  await userEvent.click(screen.getByRole('button', { name: 'Delete it' }));
  return screen.getByRole('alertdialog');
};

describe('confirmation dialog', () => {
  it('is an accessible modal dialog with the title and message, focused on Cancel', async () => {
    const dialog = await open();
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName('Remove this upload?');
    expect(dialog).toHaveAccessibleDescription('October tickets');
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Remove upload' })).toHaveClass('danger-solid');
    expect(document.body.style.overflow).toBe('hidden'); // the page behind doesn't scroll
  });

  it('confirm → true, and the dialog closes and restores focus and scrolling', async () => {
    await open();
    await userEvent.click(screen.getByRole('button', { name: 'Remove upload' }));
    expect(document.title).toBe('true');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Delete it' })).toHaveFocus();
    expect(document.body.style.overflow).toBe('');
  });

  it.each([
    ['Cancel', async () => userEvent.click(screen.getByRole('button', { name: 'Cancel' }))],
    ['Escape', async () => userEvent.keyboard('{Escape}')],
    ['a click on the backdrop', async () => userEvent.click(document.querySelector('.modal-backdrop')!)],
  ])('%s → false', async (_label, action) => {
    await open();
    await action();
    expect(document.title).toBe('false');
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('a click inside the dialog does not close it', async () => {
    const dialog = await open();
    await userEvent.click(dialog.querySelector('h2')!);
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });

  it('Tab and Shift+Tab stay inside the dialog', async () => {
    await open();
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    const remove = screen.getByRole('button', { name: 'Remove upload' });
    await userEvent.tab();
    expect(remove).toHaveFocus();
    await userEvent.tab();
    expect(cancel).toHaveFocus(); // wrapped around
    await userEvent.tab({ shift: true });
    expect(remove).toHaveFocus();
  });

  it('a non-destructive question uses the primary button style', async () => {
    render(<Host options={{ ...options, danger: false, confirmLabel: 'OK' }} />);
    await act(async () => screen.getByRole('button', { name: 'Delete it' }).click());
    expect(screen.getByRole('button', { name: 'OK' })).toHaveClass('primary');
  });
});
