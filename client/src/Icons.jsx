// Small stroke icon set (24x24 grid, currentColor) so the UI does not depend on an icon font.
const base = {
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
};

const make = (children) =>
  function Icon({ size = 16, ...rest }) {
    return (
      <svg {...base} width={size} height={size} {...rest}>
        {children}
      </svg>
    );
  };

export const IconUndo = make(<><path d="M9 14 4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 0 10h-3" /></>);
export const IconRedo = make(<><path d="m15 14 5-5-5-5" /><path d="M20 9H9a5 5 0 0 0 0 10h3" /></>);
export const IconBulletList = make(<><path d="M9 6h11M9 12h11M9 18h11" /><circle cx="4" cy="6" r="1" /><circle cx="4" cy="12" r="1" /><circle cx="4" cy="18" r="1" /></>);
export const IconNumberList = make(<><path d="M10 6h10M10 12h10M10 18h10" /><path d="M4 4h1v4M4 8h2" /><path d="M4 14.5a1.5 1.5 0 0 1 3 0c0 1.5-3 2-3 3.5h3" /></>);
export const IconQuote = make(<><path d="M4 17V11a5 5 0 0 1 5-5" /><path d="M14 17V11a5 5 0 0 1 5-5" /><path d="M4 17h4v-4H4zM14 17h4v-4h-4z" /></>);
export const IconCode = make(<><path d="m8 7-5 5 5 5" /><path d="m16 7 5 5-5 5" /></>);
export const IconDivider = make(<><path d="M3 12h18" /><path d="M8 7h8M8 17h8" opacity=".35" /></>);
export const IconStrike = make(<><path d="M4 12h16" /><path d="M16 7a4 3 0 0 0-4-2c-2.5 0-4 1.3-4 3 0 1 .5 1.8 1.5 2.4" /><path d="M8 17a4 3 0 0 0 4 2c2.5 0 4-1.3 4-3 0-.6-.2-1.2-.5-1.6" /></>);
export const IconPlus = make(<><path d="M12 5v14M5 12h14" /></>);
export const IconUpload = make(<><path d="M12 15V4" /><path d="m7 9 5-5 5 5" /><path d="M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3" /></>);
export const IconSearch = make(<><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>);
export const IconDoc = make(<><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h4" /></>);
export const IconUsers = make(<><circle cx="9" cy="8" r="3.5" /><path d="M3 20a6 6 0 0 1 12 0" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a5.5 5.5 0 0 1 3 6" /></>);
export const IconShare = make(<><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4" /></>);
export const IconHistory = make(<><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /><path d="M12 7v5l3 2" /></>);
export const IconOutline = make(<><path d="M4 6h16M8 12h12M12 18h8" /></>);
export const IconMore = make(<><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>);
export const IconCopy = make(<><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" /></>);
export const IconTrash = make(<><path d="M4 7h16M10 11v6M14 11v6" /><path d="M6 7l1 13h10l1-13M9 7V4h6v3" /></>);
export const IconDownload = make(<><path d="M12 4v11" /><path d="m7 10 5 5 5-5" /><path d="M5 20h14" /></>);
export const IconPrint = make(<><path d="M7 9V3h10v6" /><rect x="3" y="9" width="18" height="8" rx="2" /><path d="M7 14h10v7H7z" /></>);
export const IconLogout = make(<><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" /><path d="m10 8-4 4 4 4M6 12h10" /></>);
export const IconCheck = make(<><path d="m5 12 5 5L20 7" /></>);
export const IconLock = make(<><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>);
export const IconSpark = make(<><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" /></>);
export const IconFileIn = make(<><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /><path d="M12 11v6M9 14l3 3 3-3" /></>);
