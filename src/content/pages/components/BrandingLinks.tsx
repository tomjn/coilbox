import { Button } from "@picoframe/frame";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLink, Play } from "lucide-react";
import type { BrandingEntry } from "../../branding";

/**
 * Branding links + video links for a game (the dead-`modinfo`-site backfill).
 * Everything opens in the system browser; videos are never embedded.
 */
export function BrandingLinks({ entry }: { entry: BrandingEntry }) {
  const videos = entry.videos ?? [];
  const links = entry.links ?? [];
  if (videos.length === 0 && links.length === 0) return null;

  const videoUrl = (v: NonNullable<BrandingEntry["videos"]>[number]) =>
    v.kind === "youtube" ? `https://youtu.be/${v.id}` : v.url;

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium">Links</h2>
      <div className="flex flex-wrap gap-2">
        {links.map((l) => (
          <Button
            key={l.url}
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => openUrl(l.url).catch(() => {})}
          >
            <ExternalLink className="size-4" /> {l.label}
          </Button>
        ))}
        {videos.map((v) => (
          <Button
            key={videoUrl(v)}
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => openUrl(videoUrl(v)).catch(() => {})}
          >
            <Play className="size-4" /> {v.title ?? "Video"}
          </Button>
        ))}
      </div>
    </section>
  );
}
