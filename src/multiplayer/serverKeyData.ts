import { useCallback } from "react";
import { updateStoredSetting } from "../lib/storedSetting";
import { JOINED_CHANNELS_KEY, useJoinedChannels } from "./channels";
import { FAVOURITES_KEY, useFavourites } from "./friends";
import { IGNORED_KEY, useIgnored } from "./ignore";
import { NOTES_KEY, useNotes } from "./notes";

/**
 * Every settings-store record keyed by `serverKey` (`username@host:port`, see
 * `serverKeyFor` in `store.tsx`): the auto-join channel list, favourites,
 * ignores and notes (issue #2930). A login's saved keychain password is
 * server-key-shaped too but lives outside settings entirely, so it is moved
 * separately by `moveCredential` in `SettingsSection.tsx`.
 */

/**
 * Move one server-keyed settings record's entry from `oldKey` to `newKey`,
 * folding over storage as written rather than a render's copy (the same
 * reasoning as `rememberJoinedChannel`). Never overwrites an entry already
 * there under `newKey`. If both keys hold data, both are left in place.
 */
function moveKeyedEntry<T>(
  settingKey: string,
  write: (next: Record<string, T>) => void,
  oldKey: string,
  newKey: string,
) {
  updateStoredSetting<Record<string, T>>(settingKey, {}, write, (all) => {
    if (!(oldKey in all) || newKey in all) return all;
    const { [oldKey]: moving, ...rest } = all;
    return { ...rest, [newKey]: moving };
  });
}

/**
 * A login's server key changed: a rename, a server change, or the custom
 * server it uses changing host or port. Moves every server-keyed settings
 * record from the old key to the new one, so auto-join channels, favourites,
 * ignores and notes stay with the login rather than being orphaned under a
 * key nothing reads any more (issue #2930).
 */
export function useMoveServerKeyData() {
  const [, setChannels] = useJoinedChannels();
  const [, setFavourites] = useFavourites();
  const [, setIgnored] = useIgnored();
  const [, setNotes] = useNotes();

  return useCallback(
    (oldKey: string, newKey: string) => {
      if (oldKey === newKey) return;
      moveKeyedEntry(JOINED_CHANNELS_KEY, setChannels, oldKey, newKey);
      moveKeyedEntry(FAVOURITES_KEY, setFavourites, oldKey, newKey);
      moveKeyedEntry(IGNORED_KEY, setIgnored, oldKey, newKey);
      moveKeyedEntry(NOTES_KEY, setNotes, oldKey, newKey);
    },
    [setChannels, setFavourites, setIgnored, setNotes],
  );
}
