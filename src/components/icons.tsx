import type { ReactNode } from "react";

/** Minimal 16-grid line icons — one visual language (1.4 stroke, round caps). */
type P = { size?: number; className?: string };

function Svg({ size = 15, className, children }: P & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/** Crop frame — the OCR capture box. */
export const IconFrame = (p: P) => (
  <Svg {...p}>
    <path d="M2 5V2h3" />
    <path d="M11 2h3v3" />
    <path d="M14 11v3h-3" />
    <path d="M5 14H2v-3" />
  </Svg>
);

/** Eye — test read. */
export const IconEye = (p: P) => (
  <Svg {...p}>
    <path d="M1 8s2.6-4.5 7-4.5S15 8 15 8s-2.6 4.5-7 4.5S1 8 1 8Z" />
    <circle cx="8" cy="8" r="1.9" />
  </Svg>
);

/** Pop-out — external overlay window. */
export const IconPopout = (p: P) => (
  <Svg {...p}>
    <path d="M9 2h5v5" />
    <path d="M14 2 7.5 8.5" />
    <path d="M12 9.5V13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3.5" />
  </Svg>
);

/** Copy — duplicate waypoint. */
export const IconCopy = (p: P) => (
  <Svg {...p}>
    <rect x="5" y="5" width="9" height="9" rx="1.4" />
    <path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5" />
  </Svg>
);

/** Trash — delete. */
export const IconTrash = (p: P) => (
  <Svg {...p}>
    <path d="M2.5 4h11" />
    <path d="M6 4V2.5h4V4" />
    <path d="M3.6 4l.7 9a1 1 0 0 0 1 .9h5.4a1 1 0 0 0 1-.9l.7-9" />
  </Svg>
);

/** Check — copied confirmation. */
export const IconCheck = (p: P) => (
  <Svg {...p}>
    <path d="M3 8.5 6.5 12 13 4" />
  </Svg>
);

/** Radar — concentric scope. */
export const IconRadar = (p: P) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="6" />
    <circle cx="8" cy="8" r="3" />
    <path d="M8 8 L12.2 3.8" />
  </Svg>
);
