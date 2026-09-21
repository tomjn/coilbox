import { useSetting } from "@picoframe/frame";
import { type ReactNode, useEffect } from "react";
import { setMasterLevel } from "./context";

/** Persisted settings keys (frame settings store). Volume is 0..100. */
export const SOUND_VOLUME_KEY = "sound.volume";
export const SOUND_MUTED_KEY = "sound.muted";

/** What a player gets before they ever open Sound settings. */
export const DEFAULT_SOUND_VOLUME = 100;

/**
 * Mirrors the master volume and mute into the audio graph. The cues play from
 * plain functions called out of the lobby event loop (`triggerRing` and friends),
 * which cannot call `useSetting`, so the values have to be pushed somewhere
 * synchronous. This is the same bridge shape `NotifyProvider` uses for the OS
 * notification toggle.
 */
export function SoundProvider({ children }: { children: ReactNode }) {
  const [volume] = useSetting<number>(SOUND_VOLUME_KEY, DEFAULT_SOUND_VOLUME);
  const [muted] = useSetting<boolean>(SOUND_MUTED_KEY, false);

  useEffect(() => {
    setMasterLevel(volume / 100, muted);
  }, [volume, muted]);

  return <>{children}</>;
}
