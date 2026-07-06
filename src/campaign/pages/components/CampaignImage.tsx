import { Button, cn } from "@picoframe/frame";
import { open } from "@tauri-apps/plugin-dialog";
import { ImageIcon, Milestone, Trash2 } from "lucide-react";
import { type ReactNode, useState } from "react";
import { mediaKind } from "../../../lib/assetUrl";
import {
  type CampaignImageKind,
  campaignImageImport,
  campaignMediaImport,
} from "../../bindings";
import type { ImageRef } from "../../model";
import { useCampaignImage } from "../../panorama";

/**
 * A stored campaign image (icon / background / side graphic) resolved to a data URL
 * and rendered as a plain `<img>`. While unresolved or absent it renders `fallback`
 * (or nothing). The scrolling briefing panorama has its own component
 * ({@link PanoramaScroller}); this is for the still images.
 */
export function CampaignImage({
  campaignId,
  image,
  alt,
  className,
  fallback = null,
}: {
  campaignId: string;
  image?: ImageRef;
  alt: string;
  className?: string;
  fallback?: ReactNode;
}) {
  const src = useCampaignImage(campaignId, image);
  if (!src) return <>{fallback}</>;
  // A side graphic can be a looping muted video, not just a still image.
  if (mediaKind(src) === "video") {
    return (
      <video
        src={src}
        aria-label={alt || undefined}
        className={className}
        autoPlay
        loop
        muted
        playsInline
      />
    );
  }
  return <img src={src} alt={alt} className={className} />;
}

/**
 * The campaign emblem in a bordered box, used across the lists and headers. Falls
 * back to a generic glyph so a campaign with no icon still reads as one. Uses
 * `object-contain` so a non-square logo isn't cropped.
 */
export function CampaignIconBox({
  campaignId,
  icon,
  className,
}: {
  campaignId: string;
  icon?: ImageRef;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border/50 bg-muted",
        className,
      )}
    >
      <CampaignImage
        campaignId={campaignId}
        image={icon}
        alt=""
        className="size-full object-contain p-1"
        fallback={<Milestone className="size-1/2 text-muted-foreground/50" />}
      />
    </div>
  );
}

/**
 * A reusable "choose / replace / remove" control for one campaign image field
 * (icon, background, side graphic). Picks a file, imports it with the given `kind`
 * (so the plugin encodes it correctly — alpha PNG for icons/side graphics), and
 * reports the new {@link ImageRef} via `onChange`.
 *
 * It never deletes the previously-stored file: like the mission panorama's
 * cancel case, superseded files are left as orphans and reclaimed wholesale when
 * the campaign is deleted (the image folder is removed then). This keeps the
 * control simple and can never delete a file that's still referenced.
 */
export function CampaignImageField({
  campaignId,
  kind,
  value,
  onChange,
  label,
  help,
  preview,
  allowVideo = false,
}: {
  campaignId: string;
  kind: CampaignImageKind;
  value?: ImageRef;
  onChange: (next: ImageRef | undefined) => void;
  label: string;
  help?: string;
  /** The preview element to show when a value is set (sized by the caller). */
  preview: ReactNode;
  /**
   * Also accept a video file. A picked video is copied verbatim via
   * `campaignMediaImport` (not re-encoded) and stored as a `file` ref; the resolver
   * serves it over `coilbox://`. Used for the mission side graphic, which can loop a
   * muted video. Off for icon/background (images only).
   */
  allowVideo?: boolean;
}) {
  const [error, setError] = useState<string | null>(null);

  const pick = async () => {
    setError(null);
    try {
      const imageExts = ["png", "jpg", "jpeg", "webp", "bmp"];
      const videoExts = ["mp4", "webm", "mov", "ogv"];
      const src = await open({
        title: `Choose ${label.toLowerCase()}`,
        multiple: false,
        filters: [
          {
            name: allowVideo ? "Image or video" : "Image",
            extensions: allowVideo ? [...imageExts, ...videoExts] : imageExts,
          },
        ],
      });
      if (typeof src !== "string") return;
      // Videos are copied as-is; images are decoded, downscaled and re-encoded.
      const { file } =
        allowVideo && mediaKind(src) === "video"
          ? await campaignMediaImport({ campaignId, srcPath: src })
          : await campaignImageImport({ campaignId, srcPath: src, kind });
      onChange({ kind: "file", file });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium">{label}</span>
      {help && <p className="text-xs text-muted-foreground">{help}</p>}
      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
          {error}
        </p>
      )}
      {value && preview}
      <div className="flex gap-2">
        <Button size="sm" variant="outline" className="gap-1.5" onClick={pick}>
          <ImageIcon className="size-4" /> {value ? "Replace" : "Choose image"}
        </Button>
        {value && (
          <Button
            size="sm"
            variant="ghost"
            className="gap-1.5"
            onClick={() => onChange(undefined)}
          >
            <Trash2 className="size-4" /> Remove
          </Button>
        )}
      </div>
    </div>
  );
}
