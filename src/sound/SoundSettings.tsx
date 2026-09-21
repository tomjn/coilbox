import { Button, useSetting } from "@picoframe/frame";
import { Pause, Play } from "lucide-react";
import { OptionSelect } from "@/components/OptionSelect";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { getProfileSound } from "@/profile/profile";
import {
  EVENTS,
  type EventId,
  eventMutedKey,
  eventSoundKey,
  eventVolumeKey,
  GROUPS,
  groupMutedByDefault,
  groupMutedKey,
  groupVolumeKey,
  VISIBLE_EVENT_IDS,
  visibleGroupIds,
} from "./events";
import { LevelRow } from "./LevelRow";
import { isSoundId, SOUND_IDS, SOUNDS } from "./library";
import { MusicSource } from "./MusicSource";
import { playEvent } from "./play";
import {
  DEFAULT_SOUND_VOLUME,
  defaultMusicVolume,
  MUSIC_PLAYING_KEY,
  musicOnByDefault,
  SOUND_MUTED_KEY,
  SOUND_VOLUME_KEY,
} from "./SoundProvider";
import { useGameMusic } from "./useGameMusic";

/** Settings section at /settings/sound. */
export default function SoundSettings() {
  const [volume, setVolume] = useSetting<number>(
    SOUND_VOLUME_KEY,
    DEFAULT_SOUND_VOLUME,
  );
  const [muted, setMuted] = useSetting<boolean>(SOUND_MUTED_KEY, false);
  // Derived from the hook rather than from the player's module state, so
  // picking a game with music makes the Music group appear straight away.
  const { tracks } = useGameMusic();
  const anyMusic = getProfileSound() !== null || tracks.length > 0;

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
          Music
        </h2>
        <MusicSource />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Groups
        </h2>
        {visibleGroupIds(anyMusic).map((id) => (
          <div key={id} className="flex items-center justify-between gap-4">
            <span className="flex flex-col">
              <span className="text-sm font-medium">{GROUPS[id].label}</span>
              <span className="text-xs text-muted-foreground">
                {GROUPS[id].description}
              </span>
            </span>
            <div className="flex items-center gap-3">
              {id === "music" && <MusicToggle />}
              <LevelRow
                id={`sound-group-${id}`}
                label={GROUPS[id].label}
                volumeKey={groupVolumeKey(id)}
                mutedKey={groupMutedKey(id)}
                defaultMuted={groupMutedByDefault(id)}
                defaultVolume={id === "music" ? defaultMusicVolume() : 100}
                compact
              />
            </div>
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

/**
 * Play and pause for the soundtrack. Separate from the group's mute, which is
 * about how loud everything under it is. Pausing stops a track, muting leaves
 * it where it was.
 */
function MusicToggle() {
  const [playing, setPlaying] = useSetting<boolean>(
    MUSIC_PLAYING_KEY,
    musicOnByDefault(),
  );
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => setPlaying(!playing)}
      aria-label={playing ? "Pause music" : "Play music"}
    >
      {playing ? <Pause /> : <Play />}
    </Button>
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
                group: SOUNDS[soundId].group,
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
