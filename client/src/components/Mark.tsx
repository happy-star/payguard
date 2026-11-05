export function Mark({ className = "size-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="currentColor" />
      <path
        d="M8 16.5h16M16 16.5V23"
        fill="none"
        stroke="#f6f1e7"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M10 13.2c0-2.8 2.2-4.7 6-4.7s6 1.9 6 4.7"
        fill="none"
        stroke="#f6f1e7"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}
