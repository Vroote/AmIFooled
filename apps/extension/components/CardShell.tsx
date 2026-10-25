/** One result area: heading, its own status line, body, and its own retry. */

import type { ReactNode } from 'react';

interface Props {
  id: string;
  title: string;
  status: string;
  children: ReactNode;
  footer?: ReactNode;
}

export default function CardShell({ id, title, status, children, footer }: Props) {
  return (
    <section className="card" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`}>{title}</h2>
      <p className="card__status" aria-live="polite">
        {status}
      </p>
      <div className="card__body">{children}</div>
      {footer ? <div className="card__footer">{footer}</div> : null}
    </section>
  );
}
