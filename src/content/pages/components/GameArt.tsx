/**
 * The two base layers of a game's hero art, shared by the game detail banner and
 * the Games-grid card so a game's placeholder and resolved art always match: a
 * deterministic gradient placeholder, with the loading-screen image (when
 * available) cropped over it and fading in as it arrives. Callers supply their own
 * scrim and overlaid content on top; this fills its positioned parent (`inset-0`).
 */
export function GameArt({
  name,
  artUrl,
  alt,
}: {
  name: string;
  artUrl?: string;
  alt: string;
}) {
  return (
    <>
      <div
        className="absolute inset-0"
        style={{ background: gradientFor(name) }}
        aria-hidden
      />
      {artUrl && (
        <img
          src={artUrl}
          alt={alt}
          className="absolute inset-0 size-full animate-[fadein_240ms_ease-out] object-cover object-center motion-reduce:animate-none"
        />
      )}
    </>
  );
}

/** A stable dark diagonal gradient derived from the game name (placeholder art). */
export function gradientFor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  const h1 = Math.abs(hash) % 360;
  const h2 = (h1 + 40) % 360;
  return `linear-gradient(135deg, hsl(${h1} 45% 22%), hsl(${h2} 50% 12%))`;
}
