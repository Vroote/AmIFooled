/** Small local SVGs share one stroke; decorative beside readable labels. */
const paths = {
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></>,
  cookie: <><path d="M20 12a8 8 0 1 1-8-8 4 4 0 0 0 4 4 4 4 0 0 0 4 4Z" /><path d="M8 10h.01M12 15h.01M7 15h.01" /></>,
  breach: <><path d="m12 3 8 4v5c0 5-8 9-8 9s-8-4-8-9V7Z" /><path d="M12 8v5m0 3h.01" /></>,
  document: <><path d="M14 3H5v18h14V8Z" /><path d="M14 3v5h5M8 12h8M8 16h6" /></>,
  arrow: <><path d="M4 12h15m-6-6 6 6-6 6" /></>,
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18Z" /></>,
  check: <path d="m5 12 4 4L19 6" />,
};
export type IconName = keyof typeof paths;
export default function Icon({ name, className = '' }: { name: IconName; className?: string }) {
  return <svg className={`icon ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
