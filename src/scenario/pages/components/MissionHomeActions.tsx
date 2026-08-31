/**
 * Where this mission lives, and the two buttons that move it (issue #2160).
 *
 * A scenario is always created in coilbox's own store, because inferring a home
 * from the game named in the setup would write a player's work into somebody
 * else's game folder. Putting one into a game is this, a deliberate act, and it
 * is a move rather than a copy, so a document has one home and there is no pair
 * to drift apart.
 *
 * Only a loose `.sdd` is offered, because a packaged archive cannot be written
 * into at all. The advanced-mode half of the plan's condition is already met by
 * being here: the whole scenario editor route is `gateAdvanced`-wrapped
 * (`src/scenario/index.ts`), so a player-focused build never reaches this page.
 */

import { Button, Input, useDrawer } from "@picoframe/frame";
import { Package, PackageOpen } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { Label } from "@/components/ui/label";
import type { GameItem } from "@/content/bindings";
import { isSdd } from "@/content/format";
import type { Scenario } from "../../model";
import {
  missionFolderName,
  putMissionInGame,
  takeMissionOutOfGame,
} from "../../moveIntoGame";
import {
  addGameMission,
  forgetGameMission,
  refreshScenarios,
} from "../../scenarios";
import type { LoadedScenario } from "../../storage";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function MissionHomeActions({
  scenario,
  loaded,
  game,
}: {
  scenario: Scenario;
  /** Where the document being edited was read from. Absent while it loads. */
  loaded?: LoadedScenario;
  /** The installed game the setup names, or null when it names none. */
  game: GameItem | null;
}) {
  const drawer = useDrawer();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canPutIn =
    loaded?.source === "local" &&
    !!game?.primaryArchive.path &&
    isSdd(game.primaryArchive);
  const inGame =
    loaded?.source === "game" && loaded.origin?.loose ? loaded.origin : null;

  if (!canPutIn && !inGame) return null;

  /** Re-read the list so the mission is found in its new home, then show it
   *  there. The document keeps its id either way, so the route is the same one
   *  and what changes under it is the source. */
  async function settle() {
    await refreshScenarios();
    navigate(`/scenario-builder/${scenario.id}`);
  }

  async function takeOut() {
    if (!loaded?.origin) return;
    setBusy(true);
    setError(null);
    try {
      await takeMissionOutOfGame(loaded);
      forgetGameMission(loaded.origin);
      await settle();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded border border-border/60 px-3 py-2">
      <p className="text-xs text-muted-foreground">
        {inGame
          ? `This mission lives in ${inGame.gameName}, under missions/${inGame.folder}/, so the game ships it to anyone who installs it.`
          : `This mission lives in coilbox. ${game?.name} is a loose folder, so it can hold the mission itself and ship it with the game.`}
      </p>
      <div>
        {inGame ? (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void takeOut()}
          >
            <PackageOpen className="size-3.5" />
            {busy ? "Taking it out" : "Take it out of the game"}
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              game &&
              drawer.open({
                title: `Put ${scenario.name} in ${game.name}`,
                width: "28rem",
                content: (
                  <PutInGameForm
                    scenario={scenario}
                    game={game}
                    onDone={settle}
                  />
                ),
              })
            }
          >
            <Package className="size-3.5" /> Put this mission in the game
          </Button>
        )}
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

/**
 * Naming the folder the game will keep the mission in.
 *
 * The folder is the game's own name for the mission and is not the document's
 * id, which is what keeps Content > Games from reading a game's real content as
 * one of coilbox's test leftovers. Whatever is typed is slugged, and the slug is
 * shown, so nobody presses the button on a name the write would refuse.
 */
function PutInGameForm({
  scenario,
  game,
  onDone,
}: {
  scenario: Scenario;
  game: GameItem;
  onDone: () => Promise<void>;
}) {
  const drawer = useDrawer();
  const [typed, setTyped] = useState(scenario.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const folder = missionFolderName(typed);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const origin = await putMissionInGame(scenario, game, typed);
      addGameMission({ scenario, source: "game", origin });
      drawer.close();
      await onDone();
    } catch (e) {
      setError(message(e));
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        The document and the compiled mission move into {game.name}. Coilbox
        keeps no second copy, so the game is where this mission is edited from
        now on. Take it out again to bring it back.
      </p>
      <Label className="flex flex-col items-stretch gap-1.5 text-sm font-normal">
        <span className="font-medium leading-none">Folder name</span>
        <Input value={typed} onChange={(e) => setTyped(e.target.value)} />
      </Label>
      <p className="text-xs text-muted-foreground">
        It is written to <code>missions/{folder}/</code> inside{" "}
        <code className="break-all">{game.primaryArchive.name}</code>.
      </p>
      <Button disabled={busy} onClick={() => void run()}>
        <Package className="size-4" />
        {busy ? "Moving it in" : "Put it in the game"}
      </Button>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
