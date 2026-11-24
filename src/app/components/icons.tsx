// Inline stroke icons, drawn from the design canvas. Decorative: the text
// beside each one carries the meaning.
const common = { width: 15, height: 15, viewBox: "0 0 15 15", fill: "none", "aria-hidden": true } as const;
const stroke = { stroke: "currentColor", strokeWidth: 1.3 } as const;

export const CaptureIcon = () => (
  <svg {...common}>
    <rect x="1.5" y="2.5" width="12" height="10" rx="1.6" {...stroke} />
    <path d="M1.5 9.5 4.8 6.2l2.7 2.7 2-2 4 3.6" {...stroke} strokeLinejoin="round" />
  </svg>
);

export const ReviewIcon = () => (
  <svg {...common}>
    <rect x="1.5" y="3.5" width="9" height="8" rx="1.4" {...stroke} />
    <path d="M4.5 3.5v-1a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-1" {...stroke} />
  </svg>
);

export const JournalIcon = () => (
  <svg {...common}>
    <path d="M3 1.5h9v12H3z" {...stroke} strokeLinejoin="round" />
    <path d="M5.5 1.5v12M7.5 5h3M7.5 8h3" {...stroke} strokeLinecap="round" />
  </svg>
);

export const GrammarIcon = () => (
  <svg {...common}>
    <path d="M1.5 4.5 7.5 1.5l6 3-6 3-6-3Z" {...stroke} strokeLinejoin="round" />
    <path d="M3.5 6.5v4c0 .9 1.8 2 4 2s4-1.1 4-2v-4" {...stroke} strokeLinecap="round" />
  </svg>
);

export const SettingsIcon = () => (
  <svg {...common} width={18} height={18}>
    <circle cx="7.5" cy="7.5" r="2" {...stroke} />
    <path
      d="M7.5 1.5v1.6M7.5 11.9v1.6M13.5 7.5h-1.6M3.1 7.5H1.5M11.7 3.3l-1.1 1.1M4.4 10.6l-1.1 1.1M11.7 11.7l-1.1-1.1M4.4 4.4 3.3 3.3"
      {...stroke}
      strokeLinecap="round"
    />
  </svg>
);

export const MicIcon = () => (
  <svg {...common}>
    <rect x="5" y="1.5" width="5" height="8" rx="2.5" {...stroke} />
    <path d="M2.8 7.2a4.7 4.7 0 0 0 9.4 0M7.5 11.9v1.8" {...stroke} strokeLinecap="round" />
  </svg>
);
