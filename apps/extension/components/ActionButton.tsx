/** Native button with a stable width: a busy state must not move the main action. */

interface Props {
  type?: 'button' | 'submit';
  children: string;
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
  variant?: 'primary' | 'secondary';
}

export default function ActionButton({
  type = 'button',
  children,
  onClick,
  disabled = false,
  busy = false,
  variant = 'primary',
}: Props) {
  return (
    <button
      type={type}
      className={`action action--${variant}`}
      onClick={onClick}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
    >
      {children}
    </button>
  );
}
