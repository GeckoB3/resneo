/**
 * Minimal chrome for iframe embeds: full width, no dashboard padding, predictable sizing.
 */
export default function EmbedLayout({ children }: { children: React.ReactNode }) {
  return <div className="block w-full min-w-0 max-w-full bg-white">{children}</div>;
}
