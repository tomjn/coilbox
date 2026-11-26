import { useLingui } from "@lingui/react/macro";
import { Button, useSetting } from "@picoframe/frame";
import { Volume2, VolumeX } from "lucide-react";
import { Slider } from "@/components/ui/slider";

/**
 * A volume slider, a percentage and a mute button, bound to a pair of settings
 * keys. The master, each group and each event are all the same three controls
 * over different keys, so they are one component rather than three copies.
 *
 * Mute is a speaker button rather than a switch: a switch that is on when the
 * sound is off read backwards next to a slider.
 */
export function LevelRow({
  id,
  label,
  muteLabel,
  volumeKey,
  mutedKey,
  defaultMuted = false,
  defaultVolume = 100,
}: {
  /** Used for the control ids, so the labels point at the right thing. */
  id: string;
  /** Names the controls for a screen reader, which sees no surrounding row. */
  label: string;
  /** Names the mute button when "Mute {label}" would read badly. */
  muteLabel?: string;
  volumeKey: string;
  mutedKey: string;
  /** Must match what SoundProvider pushes, or the button lies about the sound. */
  defaultMuted?: boolean;
  /** Also must match SoundProvider. Music takes its default from the profile. */
  defaultVolume?: number;
}) {
  const { t } = useLingui();
  const [volume, setVolume] = useSetting<number>(volumeKey, defaultVolume);
  const [muted, setMuted] = useSetting<boolean>(mutedKey, defaultMuted);
  const mute = muteLabel ?? t`Mute ${label}`;

  return (
    <div className="flex items-center gap-3">
      <Slider
        id={`${id}-volume`}
        className="w-28"
        min={0}
        max={100}
        step={1}
        value={[volume]}
        onValueChange={([v]) => setVolume(v)}
        disabled={muted}
        aria-label={t`${label} volume`}
      />
      <span className="w-9 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
        {volume}%
      </span>
      <Button
        id={`${id}-muted`}
        variant="ghost"
        size="icon"
        className={muted ? "text-muted-foreground" : undefined}
        onClick={() => setMuted(!muted)}
        aria-pressed={muted}
        aria-label={mute}
        title={mute}
      >
        {muted ? <VolumeX /> : <Volume2 />}
      </Button>
    </div>
  );
}
