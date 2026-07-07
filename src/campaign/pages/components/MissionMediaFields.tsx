import { Button } from "@picoframe/frame";
import { open } from "@tauri-apps/plugin-dialog";
import { Music, Trash2, Video } from "lucide-react";
import { useState } from "react";
import { AUDIO_EXTS, VIDEO_EXTS } from "../../../lib/assetUrl";
import { campaignMediaImport } from "../../bindings";
import type { MediaPlayback, MediaRef } from "../../model";
import { useCampaignImage } from "../../panorama";
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
  const audio = useCampaignImage(campaignId, voiceover);
  const video = useCampaignImage(campaignId, cutscene);
  if (!audio && !video) return null;
  return (
    <div className="flex flex-col gap-2">
      {audio && (
        <CampaignAudio
          src={audio}
          playback={voiceoverPlayback}
          label="Briefing voiceover"
        />
      )}
      {video && (
        <CampaignVideo
          src={video}
          playback={cutscenePlayback}
          defaults={CUE_DEFAULTS}
          variant="inline"
          label="Intro cutscene"
          className="max-h-64 w-full rounded-md bg-black"
        />
      )}
    </div>
  );
}

/**
 * A "choose / replace / remove" control for one mission audio or video slot. Picks a
 * file, imports it verbatim via {@link campaignMediaImport}, and reports the stored
 * `{ kind: "file" }` ref. Like the image fields, it never deletes a superseded file
 * (reclaimed wholesale when the campaign is deleted).
 */
export function MissionAvField({
  campaignId,
  kind,
  value,
  onChange,
  label,
  help,
}: {
  campaignId: string;
  kind: "audio" | "video";
  value?: MediaRef;
  onChange: (next: MediaRef | undefined) => void;
  label: string;
  help?: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const src = useCampaignImage(campaignId, value);

  const pick = async () => {
    setError(null);
    try {
      const picked = await open({
        title: `Choose ${label.toLowerCase()}`,
        multiple: false,
        filters: [
          {
            name: kind === "audio" ? "Audio" : "Video",
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
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const Icon = kind === "audio" ? Music : Video;
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium">{label}</span>
      {help && <p className="text-xs text-muted-foreground">{help}</p>}
      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
          {error}
        </p>
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
      <div className="flex gap-2">
        <Button size="sm" variant="outline" className="gap-1.5" onClick={pick}>
          <Icon className="size-4" /> {value ? "Replace" : `Choose ${kind}`}
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
