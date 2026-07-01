import { useNavigate } from "react-router";
import { useSkirmishDraft } from "@/play/drafts";

/**
 * Preselect a game in the Singleplayer setup and jump there. Returns a
 * `playGame(gameName)` callback shared by the Games grid card and the game detail
 * banner, so both drive the launcher the same way.
 *
 * We write the persisted skirmish draft (the same source the launcher hydrates
 * from) rather than pass route state. Mod options are per-game, so clear any
 * carried over from a different previously-set game — the draft-hydration path in
 * the launcher deliberately skips its own per-switch reset.
 */
export function usePlayGame() {
  const [draft, setDraft] = useSkirmishDraft();
  const navigate = useNavigate();

  return (gameName: string) => {
    setDraft({
      ...draft,
      gameName,
      ...(gameName !== draft.gameName ? { modOptionValues: {} } : {}),
    });
    navigate("/play/skirmish");
  };
}
