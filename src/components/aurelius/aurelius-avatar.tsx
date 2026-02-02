/* eslint-disable @next/next/no-img-element */
export function AureliusAvatar({ className }: { className?: string }) {
  return (
    <div
      className={`w-8 h-8 rounded-full overflow-hidden bg-gold/20 border border-gold/40 flex items-center justify-center ${className}`}
    >
      <img
        src="/avatars/agent.png"
        alt="Aurelius"
        width={32}
        height={32}
        className="w-full h-full object-cover"
      />
    </div>
  );
}
