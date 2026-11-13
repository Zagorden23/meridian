// Provider marks for the sign-in buttons. Inline SVG: no network request, and
// they inherit size from the button.
export function GoogleMark({ className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden focusable="false">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z" />
    </svg>
  );
}

export function MicrosoftMark({ className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden focusable="false">
      <rect x="2.5" y="2.5" width="9" height="9" fill="#F25022" />
      <rect x="12.5" y="2.5" width="9" height="9" fill="#7FBA00" />
      <rect x="2.5" y="12.5" width="9" height="9" fill="#00A4EF" />
      <rect x="12.5" y="12.5" width="9" height="9" fill="#FFB900" />
    </svg>
  );
}

export function AppleMark({ className }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden focusable="false">
      <path d="M16.36 12.76c0-2.3 1.88-3.4 1.97-3.46-1.08-1.57-2.75-1.79-3.34-1.81-1.42-.15-2.77.84-3.49.84-.72 0-1.83-.82-3.01-.8-1.55.02-2.97.9-3.77 2.28-1.61 2.8-.41 6.94 1.16 9.21.76 1.1 1.67 2.34 2.87 2.3 1.15-.05 1.58-.75 2.97-.75s1.78.75 3 .73c1.24-.02 2.02-1.12 2.78-2.23.87-1.28 1.23-2.51 1.25-2.57-.03-.01-2.4-.92-2.43-3.74zM14.16 4.06c.64-.77 1.07-1.85.95-2.92-.92.04-2.03.61-2.69 1.38-.59.68-1.11 1.77-.97 2.82 1.02.08 2.07-.52 2.71-1.28z" />
    </svg>
  );
}

// The Amazon smile: an arc ending in an arrowhead.
export function AmazonMark({ className }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="#FF9900" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden focusable="false">
      <path d="M3.5 13.5c4.9 4.1 11.6 4.3 16.6.4" />
      <path d="M17.2 12.6l3.3 1-1.2 3.2" />
    </svg>
  );
}

export const PROVIDER_MARKS = {
  google: GoogleMark,
  microsoft: MicrosoftMark,
  apple: AppleMark,
  amazon: AmazonMark,
};
