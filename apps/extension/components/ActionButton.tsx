/** Native button with a stable width: a busy state must not move the main action. */

interface Props {
  children: string;
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
  variant?: 'primary' | 'secondary';
}

export default function ActionButton({
  children,
  onClick,
  disabled = false,
  busy = false,
  variant = 'primary',
}: Props) {
  return (
    <button
      type="button"
      className={`action action--${variant}`}
      onClick={onClick}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
    >
      {children}
    </button>
  );
}
