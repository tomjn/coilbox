import { Button, cn } from "@picoframe/frame";
import { Pause, Play, Volume2, VolumeX } from "lucide-react";
import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Switch } from "@/components/ui/switch";
import type { MediaPlayback } from "../../model";

/**
 * Shared, controllable player for campaign media. Consolidates the video/audio
 * playback that was duplicated (and hardcoded to `autoPlay loop muted`) across
 * {@link ../PanoramaScroller}, {@link ../CampaignImage} and the briefing media
 * fields, and adds a custom pause/play + mute/unmute overlay to every slot.
 *
 * Autoplay never attempts *unmuted* sound (browsers block it); an autoplay
 * decorative slot is always muted, and the viewer unmutes with the control.
 */

/** A fully-resolved playback config (all fields present). */
export interface PlaybackDefaults {
  autoplay: boolean;
  loop: boolean;
  muted: boolean;
  scroll: boolean;
}

/** Decorative loops (background panorama, side-graphic video, campaign background). */
export const DECORATIVE_DEFAULTS: PlaybackDefaults = {
  autoplay: true,
  loop: true,
  muted: true,
  scroll: true,
};

/** User-initiated cues (cutscene, voiceover) — start paused and audible. */
export const CUE_DEFAULTS: PlaybackDefaults = {
  autoplay: false,
  loop: false,
  muted: false,
  scroll: false,
};

/**
 * Merge a stored {@link MediaPlayback} over a per-slot default profile. Per-field
 * `??` (not object spread) so an omitted field takes the default while a stored
 * `false` is honoured.
 */
export function resolvePlayback(
  p: MediaPlayback | undefined,
  d: PlaybackDefaults,
): PlaybackDefaults {
  return {
    autoplay: p?.autoplay ?? d.autoplay,
    loop: p?.loop ?? d.loop,
    muted: p?.muted ?? d.muted,
    scroll: p?.scroll ?? d.scroll,
  };
}

/** Live `prefers-reduced-motion: reduce` state, for gating decorative autoplay. */
function usePrefersReducedMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduce(mq.matches);
    const onChange = () => setReduce(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduce;
}

/**
 * Track play/mute state of a media element and expose toggles. Subscribes to the
 * element's own events so it stays correct whether playback is started by autoplay,
 * the overlay, or (in future) a keyboard shortcut. Sets `el.muted` imperatively —
 * React's `muted` attribute is unreliable on first mount.
 */
function useMediaControls(
  ref: RefObject<HTMLMediaElement | null>,
  initialMuted: boolean,
) {
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(initialMuted);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.muted = initialMuted;
    setMuted(el.muted);
    setPlaying(!el.paused);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onVol = () => setMuted(el.muted);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("volumechange", onVol);
    return () => {
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("volumechange", onVol);
    };
  }, [ref, initialMuted]);

  const togglePlay = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => {});
    else el.pause();
  }, [ref]);

  const toggleMute = useCallback(() => {
    const el = ref.current;
    if (el) el.muted = !el.muted;
  }, [ref]);

  return { playing, muted, togglePlay, toggleMute };
}

/**
 * The pause/play + mute/unmute button cluster. Reveals on hover/focus, and is
 * always visible on coarse (touch) pointers that can't hover. Buttons carry visible
 * icons plus text `aria-label`s and a 40px hit area.
 */
function MediaControlsCluster({
  playing,
  muted,
  onTogglePlay,
  onToggleMute,
  label,
}: {
  playing: boolean;
  muted: boolean;
  onTogglePlay: () => void;
  onToggleMute: () => void;
  label: string;
}) {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-end justify-end p-2">
      <div className="pointer-events-auto flex gap-1 rounded-md bg-black/55 p-1 opacity-0 backdrop-blur-sm transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100 motion-reduce:transition-none [@media(pointer:coarse)]:opacity-100">
        <Button
          size="icon"
          variant="ghost"
          className="size-10 text-white hover:bg-white/20 hover:text-white"
          onClick={onTogglePlay}
          aria-label={playing ? `Pause ${label}` : `Play ${label}`}
        >
          {playing ? <Pause className="size-5" /> : <Play className="size-5" />}
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="size-10 text-white hover:bg-white/20 hover:text-white"
          onClick={onToggleMute}
          aria-label={muted ? `Unmute ${label}` : `Mute ${label}`}
        >
          {muted ? (
            <VolumeX className="size-5" />
          ) : (
            <Volume2 className="size-5" />
          )}
        </Button>
      </div>
    </div>
  );
}

/**
 * A controllable campaign video. `variant="background"` fills its container
 * (`object-cover`) and marks the video decorative (`aria-hidden`) while keeping the
 * control cluster reachable; `variant="inline"` sizes to content (`object-contain`)
 * and labels the video itself. Autoplay is suppressed under reduced motion (manual
 * play still works).
 */
export function CampaignVideo({
  src,
  playback,
  defaults,
  variant,
  label,
  className,
}: {
  src: string;
  playback?: MediaPlayback;
  defaults: PlaybackDefaults;
  variant: "background" | "inline";
  label: string;
  className?: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const resolved = resolvePlayback(playback, defaults);
  const reduce = usePrefersReducedMotion();
  const { playing, muted, togglePlay, toggleMute } = useMediaControls(
    ref,
    resolved.muted,
  );
  const isBackground = variant === "background";
  const controls = (
    <MediaControlsCluster
      playing={playing}
      muted={muted}
      onTogglePlay={togglePlay}
      onToggleMute={toggleMute}
      label={label}
    />
  );
  // Background: the wrapper takes the caller's sizing and the video fills it
  // (object-cover). Inline: the video takes the caller's sizing and renders at its
  // natural aspect; the wrapper shrinks to it so the overlay lines up.
  if (isBackground) {
    return (
      <div className={cn("group relative overflow-hidden", className)}>
        {/* biome-ignore lint/a11y/useMediaCaption: author-supplied backdrop video has no caption track */}
        <video
          ref={ref}
          src={src}
          autoPlay={resolved.autoplay && !reduce}
          loop={resolved.loop}
          playsInline
          aria-hidden
          className="h-full w-full object-cover"
        />
        {controls}
      </div>
    );
  }
  return (
    <div className="group relative w-fit max-w-full">
      {/* biome-ignore lint/a11y/useMediaCaption: author-supplied campaign video has no caption track */}
      <video
        ref={ref}
        src={src}
        autoPlay={resolved.autoplay && !reduce}
        loop={resolved.loop}
        playsInline
        aria-label={label}
        className={cn("block", className)}
      />
      {controls}
    </div>
  );
}

/**
 * A controllable campaign audio clip (mission voiceover) — a slim bar with the same
 * pause/play + mute/unmute controls. No scrubber by design; audio here is a short
 * briefing cue, not a media file to seek. Autoplay honours the (muted) resolved
 * config; browsers block audible autoplay regardless.
 */
export function CampaignAudio({
  src,
  playback,
  label,
}: {
  src: string;
  playback?: MediaPlayback;
  label: string;
}) {
  const ref = useRef<HTMLAudioElement>(null);
  const resolved = resolvePlayback(playback, CUE_DEFAULTS);
  const { playing, muted, togglePlay, toggleMute } = useMediaControls(
    ref,
    resolved.muted,
  );
  return (
    <div className="flex items-center gap-2 rounded-md border border-border/50 bg-muted/30 p-1.5">
      {/* biome-ignore lint/a11y/useMediaCaption: author-supplied voiceover has no caption track */}
      <audio
        ref={ref}
        src={src}
        autoPlay={resolved.autoplay}
        loop={resolved.loop}
        aria-label={label}
      />
      <Button
        size="icon"
        variant="ghost"
        className="size-9"
        onClick={togglePlay}
        aria-label={playing ? `Pause ${label}` : `Play ${label}`}
      >
        {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="size-9"
        onClick={toggleMute}
        aria-label={muted ? `Unmute ${label}` : `Mute ${label}`}
      >
        {muted ? (
          <VolumeX className="size-4" />
        ) : (
          <Volume2 className="size-4" />
        )}
      </Button>
      <span className="truncate text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

/** One labelled switch row, matching the map-preview tuning panel's style. */
function SwitchRow({
  label,
  checked,
  disabled,
  onCheckedChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (v: boolean) => void;
}) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: wraps the <Switch> control (implicit label association)
    <label className="flex items-center justify-between gap-2 text-xs">
      <span className="font-medium">{label}</span>
      <Switch
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
      />
    </label>
  );
}

/**
 * Author playback tuning for a media slot. Shows only the switches relevant to the
 * slot (video slots get autoplay/loop/muted; an image panorama gets scroll; audio
 * gets loop/muted). Switch state reflects the *resolved* value (stored override
 * merged over the slot defaults) so the author sees the effective behaviour. On
 * decorative slots, enabling autoplay forces (and locks) muted — browsers block
 * unmuted autoplay and this feature deliberately doesn't attempt auto-unmute.
 */
export function PlaybackTuning({
  playback,
  defaults,
  decorative = false,
  showAutoplay = false,
  showLoop = false,
  showMuted = false,
  showScroll = false,
  onChange,
}: {
  playback: MediaPlayback | undefined;
  defaults: PlaybackDefaults;
  decorative?: boolean;
  showAutoplay?: boolean;
  showLoop?: boolean;
  showMuted?: boolean;
  showScroll?: boolean;
  onChange: (playback: MediaPlayback) => void;
}) {
  const r = resolvePlayback(playback, defaults);
  const set = (patch: Partial<MediaPlayback>) =>
    onChange({ ...playback, ...patch });
  return (
    <div className="flex flex-col gap-3 rounded-md border border-border/50 bg-muted/20 p-3">
      {showScroll && (
        <SwitchRow
          label="Scroll"
          checked={r.scroll}
          onCheckedChange={(v) => set({ scroll: v })}
        />
      )}
      {showAutoplay && (
        <SwitchRow
          label="Autoplay"
          checked={r.autoplay}
          onCheckedChange={(v) =>
            set(
              decorative && v
                ? { autoplay: true, muted: true }
                : { autoplay: v },
            )
          }
        />
      )}
      {showLoop && (
        <SwitchRow
          label="Loop"
          checked={r.loop}
          onCheckedChange={(v) => set({ loop: v })}
        />
      )}
      {showMuted && (
        <SwitchRow
          label="Start muted"
          checked={r.muted}
          disabled={decorative && r.autoplay}
          onCheckedChange={(v) => set({ muted: v })}
        />
      )}
    </div>
  );
}
