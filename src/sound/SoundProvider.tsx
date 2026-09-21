import { useSetting } from "@picoframe/frame";
import { type ReactNode, useEffect } from "react";
import { HIGHLIGHT_SOUND_KEY } from "@/multiplayer/chat/highlight";
import { getProfileSound } from "@/profile/profile";
import { BUNDLED_TRACKS } from "./bundledMusic";
import { setMasterLevel } from "./context";
import {
  EVENT_IDS,
  type EventId,
  eventMutedKey,
  eventSoundKey,
  eventVolumeKey,
  GROUP_IDS,
  type GroupId,
  groupMutedByDefault,
  groupMutedKey,
  groupVolumeKey,
} from "./events";
import { GameMusic } from "./GameMusic";
import { isSoundId } from "./library";
import {
  initMusic,
  setMusicLevel,
  setMusicSuspended,
  setMusicWanted,
  setTracks,
} from "./music";
import { defaultMusicSource, MUSIC_SOURCE_KEY } from "./musicSourceKeys";
import { setEventLevel, setEventSound, setGroupLevel } from "./play";

/** Persisted settings keys (frame settings store). Volume is 0..100. */
export const SOUND_VOLUME_KEY = "sound.volume";
export const SOUND_MUTED_KEY = "sound.muted";
export const MUSIC_PLAYING_KEY = "sound.music.playing";

/** What a player gets before they ever open Sound settings. */
export const DEFAULT_SOUND_VOLUME = 100;

/**
 * Whether music starts on launch. Off unless the distribution that shipped the
 * tracks asked for it, because starting a soundtrack unbidden is the kind of
 * thing people remember an app for.
 */
export function musicOnByDefault(): boolean {
  return getProfileSound()?.enabled === true;
}

/** The music group's starting volume, from the profile or a middling default. */
export function defaultMusicVolume(): number {
  return getProfileSound()?.volume ?? 50;
}

/**
 * Mirrors every stored volume, mute and sound choice into the audio graph.
 * Sounds play from plain functions called out of the lobby event loop, which
 * cannot call `useSetting`, so the values have to be pushed somewhere
 * synchronous. This is the same bridge shape `NotifyProvider` uses for the OS
 * notification toggle.
 *
 * One child component per group and per event, rather than a loop of hooks in
 * here, so each owns its own subscription and re-renders alone when it changes.
 */
export function SoundProvider({ children }: { children: ReactNode }) {
  const [volume] = useSetting<number>(SOUND_VOLUME_KEY, DEFAULT_SOUND_VOLUME);
  const [muted] = useSetting<boolean>(SOUND_MUTED_KEY, false);

  useEffect(() => {
    setMasterLevel(volume / 100, muted);
  }, [volume, muted]);

  return (
    <>
      <MentionKeyMigration />
      <Music />
      <GameMusic />
      {GROUP_IDS.map((id) => (
        <GroupLevel key={id} id={id} />
      ))}
      {EVENT_IDS.map((id) => (
        <EventLevel key={id} id={id} />
      ))}
      {children}
    </>
  );
}

/**
 * Loads the profile's tracks, then keeps the music paused whenever something
 * else deserves the room.
 *
 * A game running is the obvious one, since coilbox sits behind the engine for
 * most of a session. Losing focus counts too: if you have tabbed away to a
 * browser, music from a window you cannot see is noise from nowhere.
 */
function Music() {
  const [wanted] = useSetting<boolean>(MUSIC_PLAYING_KEY, musicOnByDefault());
  const [source] = useSetting<string>(
    MUSIC_SOURCE_KEY,
    defaultMusicSource(getProfileSound() !== null),
  );

  useEffect(() => {
    // "off" has to clear the list as well as stop playing, or the Music group
    // stays in settings controlling a soundtrack the player turned off.
    if (source === "profile") initMusic();
    else if (source === "nostalgia") setTracks(BUNDLED_TRACKS);
    else if (source === "off") setTracks([]);
  }, [source]);

  useEffect(() => {
    setMusicWanted(wanted);
  }, [wanted]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    // Both checks are needed. `visibilityState` catches being minimised or
    // covered by another app in full screen, and stays "visible" for a window
    // that is merely not the focused one, which is the alt-tab case.
    const update = () =>
      setMusicSuspended(
        "unfocused",
        document.visibilityState === "hidden" || !document.hasFocus(),
      );
    update();
    document.addEventListener("visibilitychange", update);
    window.addEventListener("blur", update);
    window.addEventListener("focus", update);
    return () => {
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("blur", update);
      window.removeEventListener("focus", update);
    };
  }, []);

  return null;
}

function GroupLevel({ id }: { id: GroupId }) {
  const [volume] = useSetting<number>(
    groupVolumeKey(id),
    id === "music" ? defaultMusicVolume() : 100,
  );
  const [muted] = useSetting<boolean>(
    groupMutedKey(id),
    groupMutedByDefault(id),
  );
  useEffect(() => {
    // Music streams through an `HTMLAudioElement` rather than the gain graph,
    // because a track is minutes long, so its group level goes to the element.
    if (id === "music") setMusicLevel(volume / 100, muted);
    else setGroupLevel(id, volume / 100, muted);
  }, [id, volume, muted]);
  return null;
}

function EventLevel({ id }: { id: EventId }) {
  const [volume] = useSetting<number>(eventVolumeKey(id), 100);
  const [muted] = useSetting<boolean>(eventMutedKey(id), false);
  const [sound] = useSetting<string | null>(eventSoundKey(id), null);
  useEffect(() => {
    setEventLevel(id, volume / 100, muted);
  }, [id, volume, muted]);
  useEffect(() => {
    // A sound that has been removed from the library since the choice was made
    // falls back to the event's default rather than silencing the event.
    setEventSound(id, isSoundId(sound) ? sound : null);
  }, [id, sound]);
  return null;
}

/**
 * Carries a player's old "play a sound on mention" choice onto the new key.
 *
 * The old toggle was worded the other way round, so it inverts. It only writes
 * when the new key has never been set, which is what `null` distinguishes from
 * a stored `false` - otherwise this would fight the player every time they
 * unmuted the event.
 */
function MentionKeyMigration() {
  const [current, setCurrent] = useSetting<boolean | null>(
    eventMutedKey("mention"),
    null,
  );
  const [old] = useSetting<boolean | null>(HIGHLIGHT_SOUND_KEY, null);

  useEffect(() => {
    if (current === null && old !== null) setCurrent(!old);
  }, [current, old, setCurrent]);

  return null;
}
