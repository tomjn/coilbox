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

import { Button, Drawer, Input } from "@picoframe/frame";
import { useState } from "react";
import { Field } from "@/components/Field";
import { OptionSelect } from "@/components/OptionSelect";
import { Textarea } from "@/components/ui/textarea";
import { defaultProjectName, type ModProject } from "../../project";

/** What the form hands back, with the name already filled in if it was left
 *  blank. `gameName` is the project's own when one is being renamed. */
export interface ProjectDetails {
  name: string;
  description: string;
  gameName: string;
}

export function ProjectDetailsDrawer({
  open,
  onOpenChange,
  project,
  games,
  scanning,
  existing,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The project being renamed. Absent when one is being started. */
  project?: ModProject;
  /** The installed games, for the menu a new project picks from. */
  games: readonly { name: string }[];
  /** Whether the content scan is still running, so the menu says so. */
  scanning: boolean;
  /** The projects already saved, so a nameless one gets a name nothing else
   *  has. */
  existing: readonly { name: string }[];
  onSubmit: (details: ProjectDetails) => void;
}) {
  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title={project ? "Rename project" : "New tweak project"}
      description={
        project
          ? "What this project is called, and what it is for."
          : "A project changes one game. Start another for a second game."
      }
      width="26rem"
    >
      <ProjectDetailsForm
        project={project}
        games={games}
        scanning={scanning}
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
  scanning,
  existing,
  onSubmit,
}: {
  project?: ModProject;
  games: readonly { name: string }[];
  scanning: boolean;
  existing: readonly { name: string }[];
  onSubmit: (details: ProjectDetails) => void;
}) {
  const [gameName, setGameName] = useState(project?.gameName ?? "");
  const [name, setName] = useState(project?.name ?? "");
  const [description, setDescription] = useState(project?.description ?? "");

  // The name the project would get if the box is left empty, shown greyed in
  // the box so the default is something you can read and overtype rather than
  // something you find out about afterwards. Renaming has no default: a project
  // already has a name, so an empty box there means "I have not finished
  // typing" and is refused.
  const fallback = gameName ? defaultProjectName(gameName, existing) : "";
  const chosen = name.trim() || (project ? "" : fallback);
  const noGames = !scanning && games.length === 0;

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
        <Field label="Game" hint="A project cannot be moved to another game.">
          <p className="text-muted-foreground text-sm">{project.gameName}</p>
        </Field>
      ) : (
        <Field
          label="Game"
          hint="Every edit in the project is a patch against this game's own units."
        >
          <OptionSelect
            size="sm"
            ariaLabel="Game for the new project"
            placeholder={scanning ? "Scanning…" : "Pick a game"}
            value={gameName}
            onValueChange={setGameName}
            options={games.map((g) => ({ value: g.name, label: g.name }))}
          />
        </Field>
      )}

      {noGames && !project ? (
        <p className="text-muted-foreground text-xs">
          No games are installed. Add one from the Library.
        </p>
      ) : null}

      <Field
        label="Name"
        hint={
          project
            ? undefined
            : "Optional. Left empty it takes the game's name, and you can change it later."
        }
      >
        <Input
          autoFocus={!!project}
          aria-label={project ? "Project name" : "Name for the new project"}
          value={name}
          placeholder={fallback || "Name"}
          onChange={(event) => setName(event.target.value)}
        />
      </Field>

      <Field
        label="Description"
        hint="Optional. Shown on the project's card, and to anybody you send it to."
      >
        <Textarea
          aria-label="What the project is for"
          value={description}
          placeholder="What this changes, and why."
          className="min-h-20"
          onChange={(event) => setDescription(event.target.value)}
        />
      </Field>

      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={!gameName || !chosen}>
          {project ? "Save" : "Start editing"}
        </Button>
      </div>
    </form>
  );
}
