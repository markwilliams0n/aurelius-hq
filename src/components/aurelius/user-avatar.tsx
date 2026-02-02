/* eslint-disable @next/next/no-img-element */
export function UserAvatar({ className }: { className?: string }) {
  return (
    <div
      className={`w-8 h-8 rounded-full overflow-hidden bg-secondary border border-border flex items-center justify-center ${className}`}
    >
      <img
        src="/avatars/mark.png"
        alt="You"
        width={32}
        height={32}
        className="w-full h-full object-cover"
      />
    </div>
  );
}
