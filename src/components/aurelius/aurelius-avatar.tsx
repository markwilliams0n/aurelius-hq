export function AureliusAvatar({ className }: { className?: string }) {
  return (
    <div
      className={`w-8 h-8 rounded-full bg-gold/20 border border-gold/40 flex items-center justify-center ${className}`}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-gold"
      >
        {/* Stoic column/pillar icon */}
        <path d="M4 20h16" />
        <path d="M6 20v-8" />
        <path d="M18 20v-8" />
        <path d="M4 12h16" />
        <path d="M6 12V8" />
        <path d="M18 12V8" />
        <path d="M4 8h16" />
        <path d="M8 8V4h8v4" />
      </svg>
    </div>
  );
}
