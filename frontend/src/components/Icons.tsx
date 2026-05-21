/**
 * Lucide-style inline SVG icons. No npm dependency.
 *
 * Each icon accepts {size, className, strokeWidth} and inherits color via
 * `currentColor` so we can tint with Tailwind utilities (text-muted-foreground).
 */
import { SVGProps } from 'react';

interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  size?: number;
  strokeWidth?: number;
}

const base = (size = 18, strokeWidth = 1.75): SVGProps<SVGSVGElement> => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth,
  strokeLinecap: 'round' as any,
  strokeLinejoin: 'round' as any,
});

export const IconHome = ({ size, strokeWidth, ...p }: IconProps) => (
  <svg {...base(size, strokeWidth)} {...p}>
    <path d="M3 12 12 3l9 9" />
    <path d="M5 10v10h14V10" />
  </svg>
);
export const IconTasks = ({ size, strokeWidth, ...p }: IconProps) => (
  <svg {...base(size, strokeWidth)} {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M8 9l2 2 4-4" />
    <path d="M8 16h8" />
  </svg>
);
export const IconCalendar = ({ size, strokeWidth, ...p }: IconProps) => (
  <svg {...base(size, strokeWidth)} {...p}>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M16 3v4M8 3v4M3 10h18" />
  </svg>
);
export const IconInbox = ({ size, strokeWidth, ...p }: IconProps) => (
  <svg {...base(size, strokeWidth)} {...p}>
    <path d="M22 12h-6l-2 3h-4l-2-3H2" />
    <path d="M5.5 5h13l3 7v6a2 2 0 0 1-2 2h-15a2 2 0 0 1-2-2v-6z" />
  </svg>
);
export const IconReminder = ({ size, strokeWidth, ...p }: IconProps) => (
  <svg {...base(size, strokeWidth)} {...p}>
    <circle cx="12" cy="13" r="8" />
    <path d="M12 9v4l3 2M5 3 3 5M19 3l2 2" />
  </svg>
);
export const IconUsers = ({ size, strokeWidth, ...p }: IconProps) => (
  <svg {...base(size, strokeWidth)} {...p}>
    <circle cx="9" cy="8" r="4" />
    <path d="M2 21a7 7 0 0 1 14 0" />
    <circle cx="17" cy="6" r="3" />
    <path d="M22 21a5 5 0 0 0-7-4.6" />
  </svg>
);
export const IconUser = ({ size, strokeWidth, ...p }: IconProps) => (
  <svg {...base(size, strokeWidth)} {...p}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21a8 8 0 0 1 16 0" />
  </svg>
);
export const IconBriefcase = ({ size, strokeWidth, ...p }: IconProps) => (
  <svg {...base(size, strokeWidth)} {...p}>
    <rect x="2" y="7" width="20" height="14" rx="2" />
    <path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
    <path d="M2 13h20" />
  </svg>
);
export const IconFileText = ({ size, strokeWidth, ...p }: IconProps) => (
  <svg {...base(size, strokeWidth)} {...p}>
    <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
    <path d="M14 3v6h6M8 13h8M8 17h6" />
  </svg>
);
export const IconVideo = ({ size, strokeWidth, ...p }: IconProps) => (
  <svg {...base(size, strokeWidth)} {...p}>
    <rect x="2" y="6" width="14" height="12" rx="2" />
    <path d="m22 8-6 4 6 4z" />
  </svg>
);
export const IconPhone = ({ size, strokeWidth, ...p }: IconProps) => (
  <svg {...base(size, strokeWidth)} {...p}>
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
  </svg>
);
export const IconSend = ({ size, strokeWidth, ...p }: IconProps) => (
  <svg {...base(size, strokeWidth)} {...p}>
    <path d="m22 2-7 20-4-9-9-4z" />
    <path d="M22 2 11 13" />
  </svg>
);
export const IconFile = ({ size, strokeWidth, ...p }: IconProps) => (
  <svg {...base(size, strokeWidth)} {...p}>
    <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
    <path d="M14 3v6h6" />
  </svg>
);
export const IconBuilding = ({ size, strokeWidth, ...p }: IconProps) => (
  <svg {...base(size, strokeWidth)} {...p}>
    <rect x="4" y="3" width="16" height="18" rx="1.5" />
    <path d="M9 8h2M13 8h2M9 12h2M13 12h2M9 16h2M13 16h2" />
  </svg>
);
export const IconBuilding2 = ({ size, strokeWidth, ...p }: IconProps) => (
  <svg {...base(size, strokeWidth)} {...p}>
    <path d="M6 22V4a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v18" />
    <path d="M15 9h4a1 1 0 0 1 1 1v12" />
    <path d="M3 22h18M9 8h.01M9 12h.01M9 16h.01" />
  </svg>
);
export const IconBarChart = ({ size, strokeWidth, ...p }: IconProps) => (
  <svg {...base(size, strokeWidth)} {...p}>
    <path d="M3 21h18" />
    <rect x="5" y="11" width="3" height="9" />
    <rect x="11" y="6" width="3" height="14" />
    <rect x="17" y="14" width="3" height="6" />
  </svg>
);
export const IconSparkles = ({ size, strokeWidth, ...p }: IconProps) => (
  <svg {...base(size, strokeWidth)} {...p}>
    <path d="M12 3v3M12 18v3M3 12h3M18 12h3M6 6l2 2M16 16l2 2M16 8l2-2M6 18l2-2" />
    <path d="m12 9 1.5 3L17 13l-3.5 1L12 17l-1.5-3L7 13l3.5-1z" />
  </svg>
);
export const IconMailPlus = ({ size, strokeWidth, ...p }: IconProps) => (
  <svg {...base(size, strokeWidth)} {...p}>
    <path d="M22 13V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h9" />
    <path d="m22 7-10 5L2 7M19 16v6M16 19h6" />
  </svg>
);
export const IconUsersCog = ({ size, strokeWidth, ...p }: IconProps) => (
  <svg {...base(size, strokeWidth)} {...p}>
    <circle cx="9" cy="8" r="4" />
    <path d="M2 21a7 7 0 0 1 14 0" />
    <circle cx="18" cy="17" r="2" />
    <path d="M18 13v1M18 20v1M14.5 15l.9.6M21.5 19l-.9-.6M14.5 19l.9-.6M21.5 15l-.9.6" />
  </svg>
);
export const IconToggle = ({ size, strokeWidth, ...p }: IconProps) => (
  <svg {...base(size, strokeWidth)} {...p}>
    <rect x="2" y="7" width="20" height="10" rx="5" />
    <circle cx="16" cy="12" r="3" fill="currentColor" stroke="none" />
  </svg>
);
export const IconBell = ({ size, strokeWidth, ...p }: IconProps) => (
  <svg {...base(size, strokeWidth)} {...p}>
    <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
    <path d="M10 21a2 2 0 0 0 4 0" />
  </svg>
);
export const IconSearch = ({ size, strokeWidth, ...p }: IconProps) => (
  <svg {...base(size, strokeWidth)} {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
);
export const IconSettings = ({ size, strokeWidth, ...p }: IconProps) => (
  <svg {...base(size, strokeWidth)} {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9 1.65 1.65 0 0 0 4.27 7.18l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.36.61.97 1.01 1.65 1.01H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);
export const IconUserX = ({ size, strokeWidth, ...p }: IconProps) => (
  <svg {...base(size, strokeWidth)} {...p}>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M17 8l5 5M22 8l-5 5" />
  </svg>
);
// Training / LMS icons
export const IconGraduation = ({ size, strokeWidth, ...p }: IconProps) => (
  <svg {...base(size, strokeWidth)} {...p}>
    <path d="m22 10-10-5L2 10l10 5z" />
    <path d="M6 12v5c3 3 9 3 12 0v-5" />
  </svg>
);
export const IconBookOpen = ({ size, strokeWidth, ...p }: IconProps) => (
  <svg {...base(size, strokeWidth)} {...p}>
    <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
    <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
  </svg>
);
export const IconClipboard = ({ size, strokeWidth, ...p }: IconProps) => (
  <svg {...base(size, strokeWidth)} {...p}>
    <rect x="8" y="2" width="8" height="4" rx="1" />
    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
    <path d="M9 12h6M9 16h6" />
  </svg>
);
export const IconLogOut = ({ size, strokeWidth, ...p }: IconProps) => (
  <svg {...base(size, strokeWidth)} {...p}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="M16 17l5-5-5-5M21 12H9" />
  </svg>
);
