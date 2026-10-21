/**
 * What a tweak project is called, what it is for, and which game it changes
 * (issue #2707).
 *
 * Starting a project used to be a popover with a game menu in it, and the
 * project came out called "Balanced Annihilation V15.9.8 tweaks". Pressing New
 * project is the one moment somebody has the whole idea in their head, so it is
 * the moment to ask for a name, and a popover holding one menu has nowhere to
 * put the question. This is a drawer for the reason every other create-and-open
 * form in the app is one.
 *
 * The name is asked for and not required. Somebody trying a change out has no
 * name for it yet, and refusing to start until they invent one is a toll on the
 * cheapest thing this page does. So the field shows the name the project would
 * get, greyed, and an empty box takes it.
 *
 * The same form renames one, which is where renaming lives now that the card no
 * longer carries a pencil (issue #2706). The game is fixed once a project has
 * edits in it, since every one of the five stores is a patch against one game's
 * unit table, so renaming shows the game and does not offer to change it.
 */

import { Trans, useLingui } from "@lingui/react/macro";
import { Button, Drawer, Input } from "@picoframe/frame";
import { useState } from "react";
import { Field } from "@/components/Field";
import { Textarea } from "@/components/ui/textarea";
import type { GameItem } from "@/content/bindings";
import { ScanFailed } from "@/content/pages/components/states";
import { GamePickerButton } from "@/play/pages/components/GamePickerButton";
import { GamePickerPanel } from "@/play/pages/components/GamePickerPanel";
import { defaultProjectName, type ModProject } from "../../project";

/** What the form hands back, with the name already filled in if it was left
 *  blank. `gameName` is the project's own when one is being renamed. */
export interface ProjectDetails {
  name: string;
  description: string;
  gameName: string;
}

const NO_ART = new Map<string, string>();

export function ProjectDetailsDrawer({
  open,
  onOpenChange,
  project,
  games,
  headers = NO_ART,
  scanning,
  scanFailure = null,
  existing,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The project being renamed. Absent when one is being started. */
  project?: ModProject;
  /** The installed games, for the picker a new project chooses from. */
  games: readonly GameItem[];
  /** Loading-screen art for the picker, keyed by game name. Only a new project
   *  shows the picker, so a rename can leave it out. */
  headers?: Map<string, string>;
  /** Whether the content scan is still running, so the menu says so. */
  scanning: boolean;
  /** Why the scan could not list games (its unitsync `Init` failed), so the
   *  empty list is not read as "no games installed" (issue #3398). */
  scanFailure?: string | null;
  /** The projects already saved, so a nameless one gets a name nothing else
   *  has. */
  existing: readonly { name: string }[];
  onSubmit: (details: ProjectDetails) => void;
}) {
  const { t } = useLingui();
  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title={project ? t`Rename project` : t`New tweak project`}
      description={
        project
          ? t`What this project is called, and what it is for.`
          : t`A project changes one game. Start another for a second game.`
      }
      width="26rem"
    >
      <ProjectDetailsForm
        project={project}
        games={games}
        headers={headers}
        scanning={scanning}
        scanFailure={scanFailure}
        existing={existing}
        onSubmit={onSubmit}
      />
    </Drawer>
  );
}

/**
 * The fields themselves.
 *
 * Separate from the drawer so that the drawer closing unmounts it, which is
 * what puts the fields back to empty for the next project without a reset
 * effect watching `open`.
 */
function ProjectDetailsForm({
  project,
  games,
  headers,
  scanning,
  scanFailure,
  existing,
  onSubmit,
}: {
  project?: ModProject;
  games: readonly GameItem[];
  headers: Map<string, string>;
  scanning: boolean;
  scanFailure: string | null;
  existing: readonly { name: string }[];
  onSubmit: (details: ProjectDetails) => void;
}) {
  const { t } = useLingui();
  const [gameName, setGameName] = useState(project?.gameName ?? "");
  const [name, setName] = useState(project?.name ?? "");
  const [description, setDescription] = useState(project?.description ?? "");
  // Swaps the drawer's content for the game picker rather than stacking a
  // second drawer on this one (issue #2995).
  const [pickingGame, setPickingGame] = useState(false);

  // The name the project would get if the box is left empty, shown greyed in
  // the box so the default is something you can read and overtype rather than
  // something you find out about afterwards. Renaming has no default: a project
  // already has a name, so an empty box there means "I have not finished
  // typing" and is refused.
  const fallback = gameName ? defaultProjectName(gameName, existing) : "";
  const chosen = name.trim() || (project ? "" : fallback);
  const noGames = !scanning && games.length === 0;

  if (pickingGame) {
    return (
      <GamePickerPanel
        games={games}
        headers={headers}
        selectedName={gameName}
        onSelect={setGameName}
        onBack={() => setPickingGame(false)}
        backLabel={t`Back to the project details`}
        gamesLoading={scanning}
      />
    );
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!gameName || !chosen) return;
        onSubmit({ name: chosen, description: description.trim(), gameName });
      }}
    >
      {project ? (
        <Field
          label={t`Game`}
          hint={t`A project cannot be moved to another game.`}
        >
          <p className="text-muted-foreground text-sm">{project.gameName}</p>
        </Field>
      ) : (
        <Field
          label={t`Game`}
          hint={t`Every edit in the project is a patch against this game's own units.`}
        >
          <GamePickerButton
            ariaLabel={t`Game for the new project`}
            placeholder={scanning ? t`Scanning…` : t`Pick a game`}
            value={gameName}
            games={games}
            headers={headers}
            onClick={() => setPickingGame(true)}
          />
        </Field>
      )}

      {noGames && !project ? (
        scanFailure ? (
          <ScanFailed noun="games" reason={scanFailure} />
        ) : (
          <p className="text-muted-foreground text-xs">
            <Trans>No games are installed. Add one from the Library.</Trans>
          </p>
        )
      ) : null}

      <Field
        label={t`Name`}
        hint={
          project
            ? undefined
            : t`Optional. Left empty it takes the game's name, and you can change it later.`
        }
      >
        <Input
          autoFocus={!!project}
          aria-label={project ? t`Project name` : t`Name for the new project`}
          value={name}
          placeholder={fallback || t`Name`}
          onChange={(event) => setName(event.target.value)}
        />
      </Field>

      <Field
        label={t`Description`}
        hint={t`Optional. Shown on the project's card, and to anybody you send it to.`}
      >
        <Textarea
          aria-label={t`What the project is for`}
          value={description}
          placeholder={t`What this changes, and why.`}
          className="min-h-20"
          onChange={(event) => setDescription(event.target.value)}
        />
      </Field>

      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={!gameName || !chosen}>
          {project ? t`Save` : t`Start editing`}
        </Button>
      </div>
    </form>
  );
}
