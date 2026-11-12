// Small inline icon set (24px grid, 1.75 stroke) so the shell has no icon-package dependency.
type IconProps = { size?: number };

function Svg({ size = 18, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

export const CalendarIcon = (p: IconProps) => (
  <Svg {...p}><rect x="3.5" y="5" width="17" height="15" rx="2.5" /><path d="M3.5 10h17M8 3.5v3M16 3.5v3" /></Svg>
);
export const TagIcon = (p: IconProps) => (
  <Svg {...p}><path d="M3.5 12.2V5.5a2 2 0 0 1 2-2h6.7a2 2 0 0 1 1.4.6l7 7a2 2 0 0 1 0 2.8l-6.7 6.7a2 2 0 0 1-2.8 0l-7-7a2 2 0 0 1-.6-1.4Z" /><circle cx="8.5" cy="8.5" r="1.2" /></Svg>
);
export const UsersIcon = (p: IconProps) => (
  <Svg {...p}><circle cx="9" cy="8.5" r="3.2" /><path d="M2.8 20c.4-3.2 3-5 6.2-5s5.8 1.8 6.2 5" /><path d="M16 5.6a3 3 0 0 1 0 5.8M18.5 15.2c1.6.6 2.6 2 2.8 4.3" /></Svg>
);
export const SparkIcon = (p: IconProps) => (
  <Svg {...p}><path d="M12 3.5 13.9 9l5.6 1.9-5.6 1.9L12 18.5l-1.9-5.7L4.5 10.9 10.1 9 12 3.5Z" /><path d="M19 3.5v3M17.5 5h3" /></Svg>
);
export const SettingsIcon = (p: IconProps) => (
  <Svg {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 14.5a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3h0a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5h0a1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8v0a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z" /></Svg>
);
export const PlusIcon = (p: IconProps) => (<Svg {...p}><path d="M12 5v14M5 12h14" /></Svg>);
export const ChevronLeftIcon = (p: IconProps) => (<Svg {...p}><path d="m15 5-7 7 7 7" /></Svg>);
export const ChevronRightIcon = (p: IconProps) => (<Svg {...p}><path d="m9 5 7 7-7 7" /></Svg>);
export const CloseIcon = (p: IconProps) => (<Svg {...p}><path d="M6 6l12 12M18 6 6 18" /></Svg>);
export const InfinityIcon = (p: IconProps) => (<Svg {...p}><path d="M12 12c-1.6-2.2-3-3.5-4.8-3.5a3.5 3.5 0 0 0 0 7C9 15.5 10.4 14.2 12 12Zm0 0c1.6 2.2 3 3.5 4.8 3.5a3.5 3.5 0 0 0 0-7C15 8.5 13.6 9.8 12 12Z" /></Svg>);
export const ChatIcon = (p: IconProps) => (
  <Svg {...p}><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H11l-4.5 4v-4h0A2.5 2.5 0 0 1 4 13.5Z" /></Svg>
);
export const TrendIcon = (p: IconProps) => (<Svg {...p}><path d="m3.5 16 5.5-5.5 4 4L20.5 7" /><path d="M15 7h5.5v5.5" /></Svg>);
export const PulseIcon = (p: IconProps) => (
  <Svg {...p}><path d="M3 12h4l2.5-6 4 12 2.5-6H21" /></Svg>
);
export const AlertIcon = (p: IconProps) => (
  <Svg {...p}><path d="M12 4 3 19.5h18L12 4Z" /><path d="M12 10v4.5M12 17.2v.1" /></Svg>
);
export const ExternalIcon = (p: IconProps) => (
  <Svg {...p}><path d="M14 4h6v6M20 4l-9 9" /><path d="M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10" /></Svg>
);
export const MenuIcon = (p: IconProps) => (
  <Svg {...p}><path d="M4 7h16M4 12h16M4 17h16" /></Svg>
);
export const BoxIcon = (p: IconProps) => (
  <Svg {...p}><path d="M12 3 3.5 7.5v9L12 21l8.5-4.5v-9L12 3Z" /><path d="M3.5 7.5 12 12l8.5-4.5M12 12v9" /></Svg>
);
export const StoreIcon = (p: IconProps) => (
  <Svg {...p}><path d="M4 9.5 5.5 4h13L20 9.5" /><path d="M4 9.5a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0" /><path d="M5.5 12.5V20h13v-7.5M10 20v-4.5h4V20" /></Svg>
);
export const ClockIcon = (p: IconProps) => (
  <Svg {...p}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></Svg>
);
export const TerminalIcon = (p: IconProps) => (
  <Svg {...p}><rect x="3" y="4.5" width="18" height="15" rx="2.5" /><path d="m7.5 10 3 2.5-3 2.5M13 15.2h3.5" /></Svg>
);
