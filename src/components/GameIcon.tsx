import { Gamepad2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useBrandingCatalog, useBrandingImage } from "@/content/branding";
import {
  useScanTargetSelection,
  useUnitsyncGameHeaders,
  useUnitsyncScan,
} from "@/content/config";
import { gameIconArt } from "@/content/gameIcon";
import { cn } from "@/lib/utils";

interface IconSrc {
  src: string;
  /** A logo keeps its proportions. Banner and loading-screen art is cropped. */
  fit: "contain" | "cover";
}

/** A logo wider or taller than this is a wordmark, too thin to read at icon size. */
const MAX_LOGO_ASPECT = 1.5;

/**
 * The pictures for the game a name refers to, best first, from art coilbox
 * already holds: the branding catalog's logo, then its banner, then the game's
 * own loading-screen art. Empty while none has resolved, and when none exists.
 *
 * Nothing here waits on the network. Catalog art arrives through the cached
 * image path, which serves a file already on disk and gives up quietly when it
 * cannot fetch one. To read the hub's `logo` instead, this is the one place to
 * change.
 */
function useGameIconCandidates(name: string): IconSrc[] {
  const { selected } = useScanTargetSelection();
  const { data } = useUnitsyncScan(selected?.enginePath, selected?.rootPath);
  const { headers } = useUnitsyncGameHeaders(
    selected?.enginePath,
    selected?.rootPath,
  );
  const entries = useBrandingCatalog();
  const art = useMemo(
    () => gameIconArt(name, data?.games ?? null, entries),
    [name, data, entries],
  );
  const logo = useBrandingImage(art.logo);
  const banner = useBrandingImage(art.banner, true);
  const header = art.headerGame ? headers.get(art.headerGame) : undefined;
  const found: IconSrc[] = [];
  if (logo) found.push({ src: logo, fit: "contain" });
  if (banner) found.push({ src: banner, fit: "cover" });
  if (header) found.push({ src: header, fit: "cover" });
  return found;
}

/**
 * A game's icon at a small fixed size, for a page that names the game right
 * beside it, so the image has empty alt text. The box is always drawn at
 * `size`, so a row does not shift when the picture arrives, and a game with no
 * picture (or one that fails to load) shows a neutral mark of the same size.
 */
export function GameIcon({
  name,
  size = 32,
  className,
}: {
  /** The game's archive name or title, with or without a version. */
  name: string;
  size?: number;
  className?: string;
}) {
  const candidates = useGameIconCandidates(name);
  // Sources that failed to load or turned out to be the wrong shape.
  const [rejected, setRejected] = useState<ReadonlySet<string>>(new Set());
  const reject = (src: string) => setRejected((prev) => new Set(prev).add(src));
  const shown = candidates.find((c) => !rejected.has(c.src));
  return (
    <span
      data-testid="game-icon"
      data-state={shown ? "image" : "placeholder"}
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted/60 ring-1 ring-border/60",
        className,
      )}
      style={{ width: size, height: size }}
    >
      {shown ? (
        <img
          src={shown.src}
          alt=""
          draggable={false}
          onError={() => reject(shown.src)}
          onLoad={(e) => {
            const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
            if (shown.fit === "contain" && w && h) {
              const aspect = Math.max(w / h, h / w);
              if (aspect > MAX_LOGO_ASPECT) reject(shown.src);
            }
          }}
          className={cn(
            "size-full",
            shown.fit === "contain" ? "object-contain p-0.5" : "object-cover",
          )}
        />
      ) : (
        <Gamepad2
          className="text-muted-foreground"
          style={{ width: size / 2, height: size / 2 }}
        />
      )}
    </span>
  );
}
