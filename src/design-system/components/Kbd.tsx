export function Kbd({ children }: { children: string }) {
  return (
    <kbd
      style={{
        fontFamily: 'var(--font-ui)',
        fontSize: 'var(--fs-xs)',
        padding: '1px 6px',
        border: '1px solid var(--edge-strong)',
        borderBottomWidth: 2,
        color: 'var(--text-2)',
        background: 'var(--surface-raised)',
      }}
    >
      {children}
    </kbd>
  );
}
