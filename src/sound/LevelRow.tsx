import { useSetting } from "@picoframe/frame";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";

/**
 * A volume slider, a percentage and a mute switch, bound to a pair of settings
 * keys. The master, each group and each event are all the same three controls
 * over different keys, so they are one component rather than three copies.
 */
export function LevelRow({
  id,
  label,
  volumeKey,
  mutedKey,
  defaultMuted = false,
  defaultVolume = 100,
  compact = false,
}: {
  /** Used for the control ids, so the labels point at the right thing. */
  id: string;
  /** Names the controls for a screen reader, which sees no surrounding table. */
  label: string;
  volumeKey: string;
  mutedKey: string;
  /** Must match what SoundProvider pushes, or the switch lies about the sound. */
  defaultMuted?: boolean;
  /** Also must match SoundProvider. Music takes its default from the profile. */
  defaultVolume?: number;
  /** Tighter layout for a table cell, rather than a settings row. */
  compact?: boolean;
}) {
  const [volume, setVolume] = useSetting<number>(volumeKey, defaultVolume);
  const [muted, setMuted] = useSetting<boolean>(mutedKey, defaultMuted);

  return (
    <div className="flex items-center gap-3">
      <Slider
        id={`${id}-volume`}
        className={compact ? "w-24" : "max-w-xs"}
        min={0}
        max={100}
        step={1}
        value={[volume]}
        onValueChange={([v]) => setVolume(v)}
        disabled={muted}
        aria-label={`${label} volume`}
      />
      <span className="w-10 shrink-0 text-xs tabular-nums text-muted-foreground">
        {volume}%
      </span>
      <Switch
        id={`${id}-muted`}
        checked={muted}
        onCheckedChange={setMuted}
        aria-label={`Mute ${label}`}
      />
    </div>
  );
}
