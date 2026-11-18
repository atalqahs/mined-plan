/** Brand glyph: an engraved core with a single inclined orbit. */
export function BrandMark({ size = 30, className }: { size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path d="M16 9.5l5.6 3.2v6.6L16 22.5l-5.6-3.2v-6.6L16 9.5Z" stroke="currentColor" strokeWidth="1.4" />
      <path d="M16 13.3l2.4 1.4v2.6L16 18.7l-2.4-1.4v-2.6l2.4-1.4Z" fill="currentColor" opacity=".85" />
      <ellipse cx="16" cy="16" rx="14" ry="5.2" transform="rotate(-24 16 16)" stroke="currentColor" strokeWidth="1" opacity=".7" />
      <circle cx="28.2" cy="10.3" r="1.6" fill="currentColor" />
    </svg>
  );
}
