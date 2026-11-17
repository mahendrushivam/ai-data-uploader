import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

export interface ConfirmOptions {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  /** red confirm button for destructive actions */
  danger?: boolean;
}

/**
 * Centred, accessible confirmation dialog (replaces window.confirm).
 * Escape, the backdrop and Cancel all cancel. Focus starts on Cancel (the safe choice for destructive
 * actions), stays inside the dialog (Tab cycles), and returns to where it was when the dialog closes.
 */
function ConfirmDialog({ options, onClose }: { options: ConfirmOptions; onClose: (ok: boolean) => void }) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; // no scrolling the page behind the dialog
    return () => {
      document.body.style.overflow = overflow;
      previouslyFocused?.focus?.();
    };
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose(false);
    } else if (e.key === 'Tab') {
      const buttons = dialogRef.current?.querySelectorAll<HTMLButtonElement>('button');
      if (!buttons?.length) return;
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose(false)}>
      <div
        ref={dialogRef}
        className="modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-message"
        onKeyDown={onKeyDown}
      >
        <div className={`modal-icon${options.danger ? ' danger' : ''}`} aria-hidden>
          {options.danger ? '!' : '?'}
        </div>
        <h2 id="confirm-title">{options.title}</h2>
        <div id="confirm-message" className="modal-message">
          {options.message}
        </div>
        <div className="modal-actions">
          <button ref={cancelRef} className="btn" onClick={() => onClose(false)}>
            Cancel
          </button>
          <button className={`btn ${options.danger ? 'danger-solid' : 'primary'}`} onClick={() => onClose(true)}>
            {options.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/** `const { confirm, dialog } = useConfirm();` then `if (await confirm({...})) doIt();` and render {dialog}. */
export function useConfirm() {
  const [pending, setPending] = useState<{ options: ConfirmOptions; resolve: (ok: boolean) => void } | null>(null);
  const confirm = useCallback(
    (options: ConfirmOptions) => new Promise<boolean>((resolve) => setPending({ options, resolve })),
    [],
  );
  const dialog = pending ? (
    <ConfirmDialog
      options={pending.options}
      onClose={(ok) => {
        pending.resolve(ok);
        setPending(null);
      }}
    />
  ) : null;
  return { confirm, dialog };
}
