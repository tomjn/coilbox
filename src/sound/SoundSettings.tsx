import { Trans, useLingui } from "@lingui/react/macro";
import { Button, useSetting } from "@picoframe/frame";
import { Pause, Play, RotateCcw, Square } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { HelpPopover } from "@/components/HelpPopover";
import { OptionSelect } from "@/components/OptionSelect";
import { SettingList, SettingRow } from "@/components/SettingRow";
import { getProfileSound } from "@/profile/profile";
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
} from "./events";
import { LevelRow } from "./LevelRow";
import { isSoundId, SOUND_IDS, SOUNDS } from "./library";
import { MusicSource } from "./MusicSource";
import {
  clearTurnedOffByHang,
  getTurnedOffByHang,
  subscribeTurnedOffByHang,
} from "./music";
import { defaultMusicSource, MUSIC_SOURCE_KEY } from "./musicSourceKeys";
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
  const { t, i18n } = useLingui();
  const turnedOffByHang = useSyncExternalStore(
    subscribeTurnedOffByHang,
    getTurnedOffByHang,
  );

  return (
    <div className="flex flex-col gap-10 pb-8">
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">
          <Trans>Volume</Trans>
        </h2>
        <SettingList>
          <SettingRow
            id="sound-volume"
            label={t`Master volume`}
            helpLabel={t`About the master volume`}
            help={
              <p>
                <Trans>
                  Scales every sound Coilbox makes. Audio played by a campaign
                  briefing or a profile page has its own controls and is not
                  affected. Muting keeps your volume setting.
                </Trans>
              </p>
            }
          >
            <LevelRow
              id="sound"
              label={t`Master`}
              muteLabel={t`Mute all sound`}
              volumeKey={SOUND_VOLUME_KEY}
              mutedKey={SOUND_MUTED_KEY}
              defaultVolume={DEFAULT_SOUND_VOLUME}
            />
          </SettingRow>
          {EVENT_GROUP_IDS.map((id) => (
            <SettingRow
              key={id}
              id={`sound-group-${id}-volume`}
              label={i18n._(GROUPS[id].label)}
              description={i18n._(GROUPS[id].description)}
            >
              <LevelRow
                id={`sound-group-${id}`}
                label={i18n._(GROUPS[id].label)}
                volumeKey={groupVolumeKey(id)}
                mutedKey={groupMutedKey(id)}
                defaultMuted={groupMutedByDefault(id)}
              />
            </SettingRow>
          ))}
        </SettingList>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">
          <Trans>Music</Trans>
        </h2>
        <SettingList>
          <MusicSource />
          {/* Music is always listed now that coilbox bundles a track of its
              own, so this row always controls something whatever the
              distribution ships and whatever game is picked. */}
          <SettingRow
            id="sound-group-music-volume"
            label={t`Music volume`}
            error={
              turnedOffByHang
                ? t`Music was turned off because the last attempt to play it stopped Coilbox responding.`
                : null
            }
          >
            <div className="flex items-center gap-2">
              <MusicToggle />
              <LevelRow
                id="sound-group-music"
                label={i18n._(GROUPS.music.label)}
                volumeKey={groupVolumeKey("music")}
                mutedKey={groupMutedKey("music")}
                defaultMuted={groupMutedByDefault("music")}
                defaultVolume={defaultMusicVolume()}
              />
            </div>
          </SettingRow>
        </SettingList>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-1">
          <h2 className="text-sm font-semibold">
            <Trans>Sounds</Trans>
          </h2>
          <HelpPopover label={t`About sounds`}>
            <p>
              <Trans>
                A sound's final volume is the master, times its group, times its
                own. Play lets you hear one whether or not it is muted.
              </Trans>
            </p>
          </HelpPopover>
        </div>
        {EVENT_GROUP_IDS.map((group) => (
          <div key={group} className="flex flex-col gap-1.5">
            <h3 className="text-xs text-muted-foreground">
              {i18n._(GROUPS[group].label)}
            </h3>
            <SettingList>
              {VISIBLE_EVENT_IDS.filter((id) => EVENTS[id].group === group).map(
                (id) => (
                  <EventRow key={id} id={id} />
                ),
              )}
            </SettingList>
          </div>
        ))}
      </section>
    </div>
  );
}

/**
 * Play and pause for the soundtrack. Separate from the group's mute, which is
 * about how loud everything under it is. Pausing stops a track, muting leaves
 * it where it was. Off while the source is No music, where it would do nothing.
 */
function MusicToggle() {
  const { t } = useLingui();
  const [playing, setPlaying] = useSetting<boolean>(
    MUSIC_PLAYING_KEY,
    musicOnByDefault(),
  );
  const [source] = useSetting<string>(
    MUSIC_SOURCE_KEY,
    defaultMusicSource(getProfileSound() !== null),
  );
  return (
    <Button
      variant="ghost"
      size="icon"
      disabled={source === "off"}
      onClick={() => {
        // Pressing play is a new attempt under the same guard, so the line
        // about the last one goes.
        clearTurnedOffByHang();
        setPlaying(!playing);
      }}
      aria-label={playing ? t`Pause music` : t`Play music`}
      title={playing ? t`Pause music` : t`Play music`}
    >
      {playing ? <Pause /> : <Play />}
    </Button>
  );
}

function EventRow({ id }: { id: EventId }) {
  const { t, i18n } = useLingui();
  const event = EVENTS[id];
  const eventLabel = i18n._(event.label);
  const defaultSoundLabel = SOUNDS[event.sound].label;
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
    <SettingRow
      id={`sound-event-${id}-sound`}
      label={eventLabel}
      description={i18n._(event.description)}
    >
      <div className="flex items-center gap-2">
        {/* Fixed width so the dropdown is the same on every row, however long
            the name of the sound in it. */}
        <div className="w-32">
          <OptionSelect
            id={`sound-event-${id}-sound`}
            value={chosen}
            // Picking the default clears the setting rather than storing the
            // id, so "unset means the default" stays true and a later change
            // to the default reaches a player who never chose anything else.
            onValueChange={(v) => setSound(v === event.sound ? null : v)}
            size="sm"
            ariaLabel={t`Sound for ${eventLabel}`}
            options={SOUND_IDS.map((soundId) => ({
              value: soundId,
              label: SOUNDS[soundId].label,
              group: i18n._(SOUNDS[soundId].group),
              // Named in the list as well as offered by the reset button,
              // because a player browsing 21 sounds should be able to see
              // which one they started with.
              trailing:
                soundId === event.sound ? (
                  <span className="text-xs text-muted-foreground">
                    <Trans>Default</Trans>
                  </span>
                ) : undefined,
            }))}
          />
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={preview}
          aria-label={
            playing ? t`Stop ${eventLabel}` : t`Preview ${eventLabel}`
          }
          title={playing ? t`Stop ${eventLabel}` : t`Preview ${eventLabel}`}
        >
          {playing ? <Square /> : <Play />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setSound(null)}
          disabled={chosen === event.sound}
          aria-label={t`Reset ${eventLabel} to ${defaultSoundLabel}`}
          title={t`Reset ${eventLabel} to ${defaultSoundLabel}`}
        >
          <RotateCcw />
        </Button>
        <LevelRow
          id={`sound-event-${id}`}
          label={eventLabel}
          volumeKey={eventVolumeKey(id)}
          mutedKey={eventMutedKey(id)}
        />
      </div>
    </SettingRow>
  );
}
