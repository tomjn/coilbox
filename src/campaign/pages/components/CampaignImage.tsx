import { Button, cn } from "@picoframe/frame";
import { open } from "@tauri-apps/plugin-dialog";
import { ImageIcon, Milestone, Trash2 } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { IMAGE_EXTS, mediaKind, VIDEO_EXTS } from "../../../lib/assetUrl";
import {
  type CampaignImageKind,
  campaignImageImport,
  campaignMediaImport,
} from "../../bindings";
import type { ImageRef, MediaPlayback } from "../../model";
import { useCampaignImage } from "../../panorama";
import { ArchiveMediaImportButton } from "./ArchiveMediaImportButton";
import {
  CampaignVideo,
  DECORATIVE_DEFAULTS,
  type PlaybackDefaults,
} from "./MediaPlayer";

/**
 * A stored campaign image (icon / background / side graphic) resolved to a data URL
 * and rendered as a plain `<img>`. While unresolved or absent it renders `fallback`
 * (or nothing). The scrolling briefing panorama has its own component
 * ({@link PanoramaScroller}); this is for the still images.
 *
 * A video ref renders as a looping muted `<video>`. Pass `controls` to swap in the
 * full {@link CampaignVideo} inline player (pause/play + mute/unmute overlay,
 * honouring `playback`) — used at runtime for the side graphic and campaign
 * background. Left off, it stays a silent decorative loop (icon / editor previews).
 */
export function CampaignImage({
  campaignId,
  image,
  alt,
  className,
  fallback = null,
  playback,
  playbackDefaults = DECORATIVE_DEFAULTS,
  controls = false,
  videoVariant = "inline",
}: {
  campaignId: string;
  image?: ImageRef;
  alt: string;
  className?: string;
  fallback?: ReactNode;
  /** Playback config applied when `image` resolves to a video. */
  playback?: MediaPlayback;
  /** Default profile merged under `playback` (decorative by default). */
  playbackDefaults?: PlaybackDefaults;
  /** Render the controllable inline player instead of a bare decorative loop. */
  controls?: boolean;
  /** How a controllable video fits: `inline` (natural size) or `background` (cover-fill). */
  videoVariant?: "inline" | "background";
}) {
  const src = useCampaignImage(campaignId, image);
  if (!src) return <>{fallback}</>;
  // A side graphic / background can be a video, not just a still image.
  if (mediaKind(src) === "video") {
    if (controls) {
      return (
        <CampaignVideo
          src={src}
          playback={playback}
          defaults={playbackDefaults}
          variant={videoVariant}
          label={alt}
          className={className}
        />
      );
    }
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
 * It deletes nothing itself. Whoever owns the document decides that, because
 * only they can see whether another slot still names the file this one replaced:
 * `CampaignEditPage` diffs the whole campaign on save, and the mission drawer
 * clears its own unsaved imports (issue #2210). This control can never delete a
 * file that is still referenced, because it never deletes one.
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
  gameName,
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
   * `campaignMediaImport` (not re-encoded) and stored as a `file` ref, and the
   * resolver serves it over `coilbox://`. Used for the mission side graphic,
   * which can loop a muted video. Off for icon/background (images only).
   */
  allowVideo?: boolean;
  /**
   * The mission's (or, for campaign-level fields, the best-effort first
   * mission's) game name. When set, shows an "import from game files" archive
   * browser alongside the file picker, for images. When `allowVideo` is also
   * set, a second browser is shown for video members.
   */
  gameName?: string;
}) {
  const [error, setError] = useState<string | null>(null);

  const pick = async () => {
    setError(null);
    try {
      const src = await open({
        title: `Choose ${label.toLowerCase()}`,
        multiple: false,
        filters: [
          {
            name: allowVideo ? "Image or video" : "Image",
            extensions: allowVideo
              ? [...IMAGE_EXTS, ...VIDEO_EXTS]
              : [...IMAGE_EXTS],
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
        <Alert variant="destructive" className="p-2">
          <AlertDescription className="text-xs text-destructive">
            {error}
          </AlertDescription>
        </Alert>
      )}
      {value && preview}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" className="gap-1.5" onClick={pick}>
          <ImageIcon className="size-4" /> {value ? "Replace" : "Choose image"}
        </Button>
        {gameName !== undefined && (
          <ArchiveMediaImportButton
            campaignId={campaignId}
            gameName={gameName}
            mediaType="image"
            imageKind={kind}
            triggerLabel={allowVideo ? "Image from game files" : undefined}
            onImported={(file) => onChange({ kind: "file", file })}
          />
        )}
        {allowVideo && gameName !== undefined && (
          <ArchiveMediaImportButton
            campaignId={campaignId}
            gameName={gameName}
            mediaType="video"
            triggerLabel="Video from game files"
            onImported={(file) => onChange({ kind: "file", file })}
          />
        )}
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
