import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';

/**
 * Line-icon set, ported 1:1 from frontend/src/components/Icons.tsx (Lucide-style,
 * viewBox 0 0 24 24, round caps). Same paths → the app's icons match the site's.
 *
 * react-native-svg is already a native dependency, so this adds no build cost.
 * Colour is passed explicitly (RN has no `currentColor`); default strokeWidth
 * 1.75 matches the web base.
 */

export type IconName =
  | 'home'
  | 'inbox'
  | 'briefcase'
  | 'graduation'
  | 'more'
  | 'x'
  | 'logout'
  | 'sun'
  | 'moon'
  | 'chevronRight'
  | 'tasks'
  | 'calendar'
  | 'reminder'
  | 'users'
  | 'user'
  | 'usersCog'
  | 'fileText'
  | 'video'
  | 'file'
  | 'building'
  | 'building2'
  | 'barChart'
  | 'sparkles'
  | 'mailPlus'
  | 'toggle'
  | 'userX'
  | 'phone'
  | 'bookOpen'
  | 'clipboard'
  | 'shield'
  | 'bell';

export function Icon({
  name,
  size = 22,
  color = '#000',
  strokeWidth = 1.75,
}: {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
}) {
  const s = {
    stroke: color,
    strokeWidth,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    fill: 'none' as const,
  };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {render(name, s, color)}
    </Svg>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function render(name: IconName, s: any, color: string) {
  switch (name) {
    case 'home':
      return (
        <>
          <Path d="M3 12 12 3l9 9" {...s} />
          <Path d="M5 10v10h14V10" {...s} />
        </>
      );
    case 'inbox':
      return (
        <>
          <Path d="M22 12h-6l-2 3h-4l-2-3H2" {...s} />
          <Path d="M5.5 5h13l3 7v6a2 2 0 0 1-2 2h-15a2 2 0 0 1-2-2v-6z" {...s} />
        </>
      );
    case 'briefcase':
      return (
        <>
          <Rect x="2" y="7" width="20" height="14" rx="2" {...s} />
          <Path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" {...s} />
          <Path d="M2 13h20" {...s} />
        </>
      );
    case 'graduation':
      return (
        <>
          <Path d="m22 10-10-5L2 10l10 5z" {...s} />
          <Path d="M6 12v5c3 3 9 3 12 0v-5" {...s} />
        </>
      );
    case 'more':
      return (
        <>
          <Circle cx="5" cy="12" r="1.6" fill={color} stroke="none" />
          <Circle cx="12" cy="12" r="1.6" fill={color} stroke="none" />
          <Circle cx="19" cy="12" r="1.6" fill={color} stroke="none" />
        </>
      );
    case 'x':
      return (
        <>
          <Path d="M18 6 6 18" {...s} />
          <Path d="m6 6 12 12" {...s} />
        </>
      );
    case 'logout':
      return (
        <>
          <Path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" {...s} />
          <Path d="M16 17l5-5-5-5M21 12H9" {...s} />
        </>
      );
    case 'sun':
      return (
        <>
          <Circle cx="12" cy="12" r="5" {...s} />
          <Line x1="12" y1="1" x2="12" y2="3" {...s} />
          <Line x1="12" y1="21" x2="12" y2="23" {...s} />
          <Line x1="4.22" y1="4.22" x2="5.64" y2="5.64" {...s} />
          <Line x1="18.36" y1="18.36" x2="19.78" y2="19.78" {...s} />
          <Line x1="1" y1="12" x2="3" y2="12" {...s} />
          <Line x1="21" y1="12" x2="23" y2="12" {...s} />
          <Line x1="4.22" y1="19.78" x2="5.64" y2="18.36" {...s} />
          <Line x1="18.36" y1="5.64" x2="19.78" y2="4.22" {...s} />
        </>
      );
    case 'moon':
      return <Path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" {...s} />;
    case 'chevronRight':
      return <Path d="m9 18 6-6-6-6" {...s} />;
    case 'tasks':
      return (
        <>
          <Rect x="3" y="4" width="18" height="16" rx="2" {...s} />
          <Path d="M8 9l2 2 4-4" {...s} />
          <Path d="M8 16h8" {...s} />
        </>
      );
    case 'calendar':
      return (
        <>
          <Rect x="3" y="5" width="18" height="16" rx="2" {...s} />
          <Path d="M16 3v4M8 3v4M3 10h18" {...s} />
        </>
      );
    case 'reminder':
      return (
        <>
          <Circle cx="12" cy="13" r="8" {...s} />
          <Path d="M12 9v4l3 2M5 3 3 5M19 3l2 2" {...s} />
        </>
      );
    case 'users':
      return (
        <>
          <Circle cx="9" cy="8" r="4" {...s} />
          <Path d="M2 21a7 7 0 0 1 14 0" {...s} />
          <Circle cx="17" cy="6" r="3" {...s} />
          <Path d="M22 21a5 5 0 0 0-7-4.6" {...s} />
        </>
      );
    case 'user':
      return (
        <>
          <Circle cx="12" cy="8" r="4" {...s} />
          <Path d="M4 21a8 8 0 0 1 16 0" {...s} />
        </>
      );
    case 'usersCog':
      return (
        <>
          <Circle cx="9" cy="8" r="4" {...s} />
          <Path d="M2 21a7 7 0 0 1 14 0" {...s} />
          <Circle cx="18" cy="17" r="2" {...s} />
          <Path
            d="M18 13v1M18 20v1M14.5 15l.9.6M21.5 19l-.9-.6M14.5 19l.9-.6M21.5 15l-.9.6"
            {...s}
          />
        </>
      );
    case 'fileText':
      return (
        <>
          <Path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" {...s} />
          <Path d="M14 3v6h6M8 13h8M8 17h6" {...s} />
        </>
      );
    case 'video':
      return (
        <>
          <Rect x="2" y="6" width="14" height="12" rx="2" {...s} />
          <Path d="m22 8-6 4 6 4z" {...s} />
        </>
      );
    case 'file':
      return (
        <>
          <Path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" {...s} />
          <Path d="M14 3v6h6" {...s} />
        </>
      );
    case 'building':
      return (
        <>
          <Rect x="4" y="3" width="16" height="18" rx="1.5" {...s} />
          <Path d="M9 8h2M13 8h2M9 12h2M13 12h2M9 16h2M13 16h2" {...s} />
        </>
      );
    case 'building2':
      return (
        <>
          <Path d="M6 22V4a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v18" {...s} />
          <Path d="M15 9h4a1 1 0 0 1 1 1v12" {...s} />
          <Path d="M3 22h18M9 8h.01M9 12h.01M9 16h.01" {...s} />
        </>
      );
    case 'barChart':
      return (
        <>
          <Path d="M3 21h18" {...s} />
          <Rect x="5" y="11" width="3" height="9" {...s} />
          <Rect x="11" y="6" width="3" height="14" {...s} />
          <Rect x="17" y="14" width="3" height="6" {...s} />
        </>
      );
    case 'sparkles':
      return (
        <>
          <Path d="M12 3v3M12 18v3M3 12h3M18 12h3M6 6l2 2M16 16l2 2M16 8l2-2M6 18l2-2" {...s} />
          <Path d="m12 9 1.5 3L17 13l-3.5 1L12 17l-1.5-3L7 13l3.5-1z" {...s} />
        </>
      );
    case 'mailPlus':
      return (
        <>
          <Path d="M22 13V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h9" {...s} />
          <Path d="m22 7-10 5L2 7M19 16v6M16 19h6" {...s} />
        </>
      );
    case 'toggle':
      return (
        <>
          <Rect x="2" y="7" width="20" height="10" rx="5" {...s} />
          <Circle cx="16" cy="12" r="3" fill={color} stroke="none" />
        </>
      );
    case 'userX':
      return (
        <>
          <Path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" {...s} />
          <Circle cx="9" cy="7" r="4" {...s} />
          <Path d="M17 8l5 5M22 8l-5 5" {...s} />
        </>
      );
    case 'phone':
      return (
        <Path
          d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"
          {...s}
        />
      );
    case 'bookOpen':
      return (
        <>
          <Path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" {...s} />
          <Path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" {...s} />
        </>
      );
    case 'clipboard':
      return (
        <>
          <Rect x="8" y="2" width="8" height="4" rx="1" {...s} />
          <Path
            d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"
            {...s}
          />
          <Path d="M9 12h6M9 16h6" {...s} />
        </>
      );
    case 'shield':
      return <Path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" {...s} />;
    case 'bell':
      return (
        <>
          <Path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" {...s} />
          <Path d="M13.73 21a2 2 0 0 1-3.46 0" {...s} />
        </>
      );
    default:
      return null;
  }
}
