import { useSetting } from "@picoframe/frame";
import { type ReactNode, useEffect } from "react";
import { HIGHLIGHT_SOUND_KEY } from "@/multiplayer/chat/highlight";
import { setMasterLevel } from "./context";
import {
  EVENT_IDS,
  type EventId,
  eventMutedKey,
  eventSoundKey,
  eventVolumeKey,
  GROUP_IDS,
  type GroupId,
  groupMutedKey,
  groupVolumeKey,
} from "./events";
import { isSoundId } from "./library";
import { setEventLevel, setEventSound, setGroupLevel } from "./play";

/** Persisted settings keys (frame settings store). Volume is 0..100. */
export const SOUND_VOLUME_KEY = "sound.volume";
export const SOUND_MUTED_KEY = "sound.muted";

/** What a player gets before they ever open Sound settings. */
export const DEFAULT_SOUND_VOLUME = 100;

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

function GroupLevel({ id }: { id: GroupId }) {
  const [volume] = useSetting<number>(groupVolumeKey(id), 100);
  const [muted] = useSetting<boolean>(groupMutedKey(id), false);
  useEffect(() => {
    setGroupLevel(id, volume / 100, muted);
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
