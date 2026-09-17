// The MaSign icon (logo/MaSign_logo_icon.svg) inlined so the "ink" paths can
// follow the theme: black on the light logo, near-white on the dark UI. The
// accent stroke keeps the logo blue.
export function Logo({ size = 40, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      className={`logo ${className}`.trim()}
      width={size}
      height={Math.round((size * 106.72) / 155.97)}
      viewBox="0 0 155.97 106.72"
      aria-hidden="true"
      focusable="false"
    >
      <path
        className="logo-accent"
        d="M10.46,97.69c-4.48-4.48-5.04-11.77-1.92-17.23C27.78,59.83,43.89,33.34,63.09,13.1c6.07-6.4,7.79-10.16,17.83-8.54,7.91,1.28,12.33,11.05,9.07,18.25L26.7,100.17c-5.44,2.4-11.98,1.77-16.24-2.49Z"
      />
      <path
        className="logo-ink"
        d="M104.79,36.05c12.52-2.89,21.11,8.46,15.39,20.08-2.43,4.94-30.29,39.21-34.47,42.1-12.53,8.69-26.63-2.82-20.72-16.02,2.23-4.98,26.82-35.51,31.63-40.28,2.4-2.38,4.66-5.08,8.17-5.89Z"
      />
      <path className="logo-ink" d="M129.8,4.8c21.36-4.93,23.95,22.7,7.09,25.93-16.34,3.13-22.61-22.35-7.09-25.93Z" />
      <path className="logo-ink" d="M15.7,4.8C36.59-.01,39.72,27.49,22.79,30.73,6.45,33.86.18,8.38,15.7,4.8Z" />
    </svg>
  )
}
