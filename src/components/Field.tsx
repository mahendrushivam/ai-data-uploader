import { useId, type InputHTMLAttributes } from 'react';

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  /** shown under the input in red, and announced with it (aria-describedby + aria-invalid) */
  error?: string;
  /** shown under the input when there's no error */
  hint?: string;
  compact?: boolean;
}

/**
 * Labelled input. Hints and errors are linked to the input rather than put inside the <label>, so the
 * field's accessible name stays just its label ("Password", not "Password At least 8 characters.").
 */
export function Field({ label, error, hint, compact, className, ...input }: Props) {
  const id = useId();
  const noteId = `${id}-note`;
  const note = error ?? hint;
  return (
    <div className={`field${compact ? ' compact' : ''}${className ? ` ${className}` : ''}`}>
      <label htmlFor={id}>{label}</label>
      <input id={id} aria-invalid={error ? true : undefined} aria-describedby={note ? noteId : undefined} {...input} />
      {note && (
        <span id={noteId} className={error ? 'field-error' : 'muted small'}>
          {note}
        </span>
      )}
    </div>
  );
}
