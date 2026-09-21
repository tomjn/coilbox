import { Button, useSetting } from "@picoframe/frame";
import { Play } from "lucide-react";
import { OptionSelect } from "@/components/OptionSelect";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  EVENTS,
  type EventId,
  eventMutedKey,
  eventSoundKey,
  eventVolumeKey,
  GROUPS,
  groupMutedKey,
  groupVolumeKey,
  VISIBLE_EVENT_IDS,
  VISIBLE_GROUP_IDS,
} from "./events";
import { LevelRow } from "./LevelRow";
import { isSoundId, SOUND_IDS, SOUNDS } from "./library";
import { playEvent } from "./play";
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
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <label htmlFor="sound-volume" className="flex flex-col">
            <span className="text-sm font-medium">Master volume</span>
            <span className="text-xs text-muted-foreground">
              Scales every sound Coilbox makes. Audio played by a campaign
              briefing or a profile page has its own controls and is not
              affected.
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
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Groups
        </h2>
        {VISIBLE_GROUP_IDS.map((id) => (
          <div key={id} className="flex items-center justify-between gap-4">
            <span className="flex flex-col">
              <span className="text-sm font-medium">{GROUPS[id].label}</span>
              <span className="text-xs text-muted-foreground">
                {GROUPS[id].description}
              </span>
            </span>
            <LevelRow
              id={`sound-group-${id}`}
              label={GROUPS[id].label}
              volumeKey={groupVolumeKey(id)}
              mutedKey={groupMutedKey(id)}
              compact
            />
          </div>
        ))}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Sounds
        </h2>
        <p className="text-xs text-muted-foreground">
          Each of these plays a sound you can change. A sound's final volume is
          the master, times its group, times its own.
        </p>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th scope="col" className="py-2 pr-4 font-medium">
                When
              </th>
              <th scope="col" className="py-2 pr-4 font-medium">
                Sound
              </th>
              <th scope="col" className="py-2 font-medium">
                Volume
              </th>
            </tr>
          </thead>
          <tbody>
            {VISIBLE_EVENT_IDS.map((id) => (
              <EventRow key={id} id={id} />
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function EventRow({ id }: { id: EventId }) {
  const event = EVENTS[id];
  const [sound, setSound] = useSetting<string | null>(eventSoundKey(id), null);
  const chosen = isSoundId(sound) ? sound : event.sound;

  return (
    <tr className="border-b align-top last:border-0">
      <th scope="row" className="py-3 pr-4 text-left font-normal">
        <span className="block text-sm font-medium">{event.label}</span>
        <span className="block max-w-sm text-xs font-normal text-muted-foreground">
          {event.description}
        </span>
      </th>
      <td className="py-3 pr-4">
        <div className="flex items-center gap-2">
          <div className="w-32">
            <OptionSelect
              value={chosen}
              onValueChange={setSound}
              size="sm"
              ariaLabel={`Sound for ${event.label}`}
              options={SOUND_IDS.map((soundId) => ({
                value: soundId,
                label: SOUNDS[soundId].label,
              }))}
            />
          </div>
          {/* Plays through the same gain chain as the real event, so what you
              hear here is what you will hear then. */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => playEvent(id)}
            aria-label={`Preview ${event.label}`}
          >
            <Play />
          </Button>
        </div>
      </td>
      <td className="py-3">
        <LevelRow
          id={`sound-event-${id}`}
          label={event.label}
          volumeKey={eventVolumeKey(id)}
          mutedKey={eventMutedKey(id)}
          compact
        />
      </td>
    </tr>
  );
}
