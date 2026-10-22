import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";
import { open } from "@tauri-apps/plugin-dialog";
import { Music, Trash2, Video } from "lucide-react";
import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { describeError } from "@/i18n/uiError";
import { AUDIO_EXTS, VIDEO_EXTS } from "../../../lib/assetUrl";
import { campaignMediaImport } from "../../bindings";
import type { MediaPlayback, MediaRef } from "../../model";
import { useCampaignImage } from "../../panorama";
import { ArchiveMediaImportButton } from "./ArchiveMediaImportButton";
import { CampaignAudio, CampaignVideo, CUE_DEFAULTS } from "./MediaPlayer";

/**
 * Audio/video widgets for missions. Unlike images, AV is copied verbatim into the
 * campaign's `media/<id>/` folder ({@link campaignMediaImport}) and played straight
 * from the `coilbox://` protocol — never re-encoded or inlined as a data URI. Shared
 * by the mission editor (author-side {@link MissionAvField}) and the briefing screen
 * ({@link MissionMediaPlayer}).
 */

/** The briefing-screen players for a mission's voiceover (audio) and cutscene (video). */
export function MissionMediaPlayer({
  campaignId,
  voiceover,
  voiceoverPlayback,
  cutscene,
  cutscenePlayback,
}: {
  campaignId: string;
  voiceover?: MediaRef;
  voiceoverPlayback?: MediaPlayback;
  cutscene?: MediaRef;
  cutscenePlayback?: MediaPlayback;
}) {
  const { t } = useLingui();
  const audio = useCampaignImage(campaignId, voiceover);
  const video = useCampaignImage(campaignId, cutscene);
  if (!audio && !video) return null;
  return (
    <div className="flex flex-col gap-2">
      {audio && (
        <CampaignAudio
          src={audio}
          playback={voiceoverPlayback}
          label={t`Briefing voiceover`}
        />
      )}
      {video && (
        <CampaignVideo
          src={video}
          playback={cutscenePlayback}
          defaults={CUE_DEFAULTS}
          variant="inline"
          label={t`Intro cutscene`}
          className="max-h-64 w-full rounded-md bg-black"
        />
      )}
    </div>
  );
}

/**
 * A "choose / replace / remove" control for one mission audio or video slot. Picks a
 * file, imports it verbatim via {@link campaignMediaImport}, and reports the stored
 * `{ kind: "file" }` ref. Like the image fields, it deletes nothing itself: the
 * file it replaced goes when whoever owns the document can see that nothing else
 * names it (issue #2210).
 */
export function MissionAvField({
  campaignId,
  kind,
  value,
  onChange,
  label,
  help,
  gameName,
}: {
  campaignId: string;
  kind: "audio" | "video";
  value?: MediaRef;
  onChange: (next: MediaRef | undefined) => void;
  label: string;
  help?: string;
  /**
   * The mission's game name. When set, shows an "import from game files"
   * archive browser alongside the file picker, matching `kind`.
   */
  gameName?: string;
}) {
  const { t } = useLingui();
  const [error, setError] = useState<string | null>(null);
  const src = useCampaignImage(campaignId, value);
  const labelLower = label.toLowerCase();

  const pick = async () => {
    setError(null);
    try {
      const picked = await open({
        title: t`Choose ${labelLower}`,
        multiple: false,
        filters: [
          {
            name: kind === "audio" ? t`Audio` : t`Video`,
            extensions: kind === "audio" ? AUDIO_EXTS : VIDEO_EXTS,
          },
        ],
      });
      if (typeof picked !== "string") return;
      const { file } = await campaignMediaImport({
        campaignId,
        srcPath: picked,
      });
      onChange({ kind: "file", file });
    } catch (e) {
      setError(describeError(e));
    }
  };

  const Icon = kind === "audio" ? Music : Video;
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
      {src &&
        (kind === "audio" ? (
          // biome-ignore lint/a11y/useMediaCaption: author-supplied audio has no caption track
          <audio controls src={src} className="w-full" />
        ) : (
          // biome-ignore lint/a11y/useMediaCaption: author-supplied video has no caption track
          <video
            controls
            src={src}
            className="max-h-40 w-full rounded-md bg-black"
          />
        ))}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" className="gap-1.5" onClick={pick}>
          <Icon className="size-4" />{" "}
          {value
            ? t`Replace`
            : kind === "audio"
              ? t`Choose audio`
              : t`Choose video`}
        </Button>
        {gameName !== undefined && (
          <ArchiveMediaImportButton
            campaignId={campaignId}
            gameName={gameName}
            mediaType={kind}
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
            <Trash2 className="size-4" /> <Trans>Remove</Trans>
          </Button>
        )}
      </div>
    </div>
  );
}
