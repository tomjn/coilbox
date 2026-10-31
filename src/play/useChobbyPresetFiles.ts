import { useEffect, useMemo, useState } from "react";
import { useContentState } from "../content/contentState";
import { playChobbyPresetsFind } from "./bindings";

/**
 * The `optionsPresets.json` files BYAR-Chobby has left in the player's data
 * folders (issue #1297), empty when there are none.
 *
 * Chobby saves the file in the data folder its game ran from, so the search
 * covers every folder coilbox tracks. A folder coilbox only reads from, and the
 * distribution's bundled one, cannot be where a lobby saved anything and could
 * not be written to anyway.
 *
 * Looked for each time `enabled` turns on, so a file Chobby saved while the
 * sheet was closed is there when it opens.
 */
export function useChobbyPresetFiles(enabled: boolean): string[] {
  const { state } = useContentState();
  const roots = useMemo(
    () =>
      (state?.roots ?? [])
        .filter((r) => r.exists && !r.bundled && !r.readOnly)
        .map((r) => r.path),
    [state],
  );
  const [files, setFiles] = useState<string[]>([]);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    playChobbyPresetsFind({ roots })
      .then((found) => live && setFiles(found.files))
      // Nothing to offer is the right answer to a search that failed.
      .catch(() => live && setFiles([]));
    return () => {
      live = false;
    };
  }, [enabled, roots]);

  return files;
}
