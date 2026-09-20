import { Button, useSetting } from "@picoframe/frame";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { playChime } from "./library";
import {
  DEFAULT_SOUND_VOLUME,
  SOUND_MUTED_KEY,
  SOUND_VOLUME_KEY,
} from "./SoundProvider";

/** Settings section at /settings/sound. */
export default function SoundSettings() {
  const [volume, setVolume] = useSetting<number>(
    SOUND_VOLUME_KEY,
    DEFAULT_SOUND_VOLUME,
  );
  const [muted, setMuted] = useSetting<boolean>(SOUND_MUTED_KEY, false);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <label htmlFor="sound-volume" className="flex flex-col">
          <span className="text-sm font-medium">Master volume</span>
          <span className="text-xs text-muted-foreground">
            Scales every sound Coilbox makes: the autohost ring, chat mentions
            and the host launching a game. Audio played by a campaign briefing
            or a profile page has its own controls and is not affected.
          </span>
        </label>
        <div className="flex items-center gap-4">
          <Slider
            id="sound-volume"
            className="max-w-xs"
            min={0}
            max={100}
            step={1}
            value={[volume]}
            onValueChange={([v]) => setVolume(v)}
            disabled={muted}
            aria-label="Master volume"
          />
          <span className="w-10 text-sm tabular-nums text-muted-foreground">
            {volume}%
          </span>
        </div>
      </div>

      <label
        htmlFor="sound-muted"
        className="flex items-center justify-between gap-4"
      >
        <span className="flex flex-col">
          <span className="text-sm font-medium">Mute all sound</span>
          <span className="text-xs text-muted-foreground">
            Silence everything without losing your volume setting.
          </span>
        </span>
        <Switch id="sound-muted" checked={muted} onCheckedChange={setMuted} />
      </label>

      <div>
        <Button variant="outline" onClick={() => playChime()}>
          Play a test sound
        </Button>
      </div>
    </div>
  );
}
