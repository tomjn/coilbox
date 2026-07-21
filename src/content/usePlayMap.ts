import { useNavigate } from "react-router";
import { useSkirmishDraft } from "@/play/drafts";

/**
 * Preselect a map in the Singleplayer setup and jump there. Returns a
 * `playMap(mapName)` callback, the map counterpart to `usePlayGame`, so a map
 * detail banner or map card can drive the launcher the same way.
 *
 * We write the persisted skirmish draft (the same source the launcher hydrates
 * from) rather than pass route state. Only the map name changes — the picked
 * game, opponents and mod options carry over untouched, so choosing a map to
 * play drops the user into their existing setup with just the map swapped.
 */
export function usePlayMap() {
  const [draft, setDraft] = useSkirmishDraft();
  const navigate = useNavigate();

  return (mapName: string) => {
    setDraft({ ...draft, mapName });
    navigate("/play/skirmish");
  };
}
