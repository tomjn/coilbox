import { Button, useSetting } from "@picoframe/frame";
import { Pause, Play, RotateCcw, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { OptionSelect } from "@/components/OptionSelect";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  EVENT_GROUP_IDS,
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
import { previewEvent, stopPreview } from "./play";
import {
  DEFAULT_SOUND_VOLUME,
  defaultMusicVolume,
  MUSIC_PLAYING_KEY,
  musicOnByDefault,
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
          Music
        </h2>
        <MusicSource />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Groups
        </h2>
        {/* Music is always on the list now that coilbox bundles a track of its
            own, so the group always controls something whatever the
            distribution ships and whatever game is picked. */}
        {visibleGroupIds(true).map((id) => (
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
          the master, times the group it sits under, times its own. Play lets
          you hear one whether or not it is muted.
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
          {/* One `tbody` per group rather than one for the table, so each band
              of rows says which group's slider above controls it. */}
          {EVENT_GROUP_IDS.map((group) => (
            <tbody key={group}>
              <tr>
                <th
                  scope="colgroup"
                  colSpan={3}
                  className="border-b pt-5 pb-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                >
                  {GROUPS[group].label}
                </th>
              </tr>
              {VISIBLE_EVENT_IDS.filter((id) => EVENTS[id].group === group).map(
                (id) => (
                  <EventRow key={id} id={id} />
                ),
              )}
            </tbody>
          ))}
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
  const [playing, setPlaying] = useState(false);
  // Cleared on unmount and before each new press, so leaving the page mid-gong
  // cannot set state on a row that is gone, and a second press cannot be
  // stopped early by the first press's timer.
  const endsAt = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(endsAt.current), []);

  function preview() {
    window.clearTimeout(endsAt.current);
    if (playing) {
      stopPreview(id);
      setPlaying(false);
      return;
    }
    const seconds = previewEvent(id);
    if (seconds <= 0) return;
    setPlaying(true);
    endsAt.current = window.setTimeout(() => setPlaying(false), seconds * 1000);
  }

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
          {/* `shrink-0` so the dropdown is the same width on every row, however
              long the name of the sound in it. */}
          <div className="w-32 shrink-0">
            <OptionSelect
              value={chosen}
              // Picking the default clears the setting rather than storing
              // the id, so "unset means the default" stays true and a later
              // change to the default reaches a player who never chose
              // anything else.
              onValueChange={(v) => setSound(v === event.sound ? null : v)}
              size="sm"
              ariaLabel={`Sound for ${event.label}`}
              options={SOUND_IDS.map((soundId) => ({
                value: soundId,
                label: SOUNDS[soundId].label,
                group: SOUNDS[soundId].group,
                // Named in the list as well as offered by the reset button,
                // because a player browsing 21 sounds should be able to see
                // which one they started with.
                trailing:
                  soundId === event.sound ? (
                    <span className="text-xs text-muted-foreground">
                      Default
                    </span>
                  ) : undefined,
              }))}
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={preview}
            aria-label={
              playing ? `Stop ${event.label}` : `Preview ${event.label}`
            }
          >
            {playing ? <Square /> : <Play />}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSound(null)}
            disabled={chosen === event.sound}
            aria-label={`Reset ${event.label} to ${SOUNDS[event.sound].label}`}
          >
            <RotateCcw />
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
