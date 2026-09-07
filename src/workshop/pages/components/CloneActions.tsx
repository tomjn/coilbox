/**
 * Making a copy of the selected unit, and taking one back out (issue #1272).
 *
 * Two things to fill in and one sentence saying what pressing the button will
 * do. The sentence is the point of the form: a name the game already uses
 * silently replaces that unit, which is sometimes exactly what somebody wants
 * and usually a slip, so it is said in words and the button changes its label
 * to match rather than the editor picking one for them.
 *
 * A popover rather than a dialog, so the unit being copied stays on screen
 * behind it.
 */
import { Button, Input } from "@picoframe/frame";
import { Copy, Trash2, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { Field } from "@/components/Field";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { checkCloneName, suggestCloneKey, type UnitClones } from "../../clones";

export function CloneUnitButton({
  sourceKey,
  sourceName,
  gameUnits,
  clones,
  nameOf,
  onCreate,
}: {
  /** The unit being copied, which may itself be a clone. */
  sourceKey: string;
  sourceName: string;
  /** The game's own units, so a name that lands on one can be named back. */
  gameUnits: Record<string, Record<string, unknown>>;
  clones: UnitClones;
  nameOf: (key: string, def: Record<string, unknown>) => string;
  onCreate: (key: string, displayName: string, replaces: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [displayName, setDisplayName] = useState("");

  // Filled in fresh each time it opens, so copying a second unit does not offer
  // the first one's names.
  const toggle = (next: boolean) => {
    setOpen(next);
    if (!next) return;
    setKey(
      suggestCloneKey(
        sourceKey,
        (k) => Object.hasOwn(gameUnits, k) || Object.hasOwn(clones, k),
      ),
    );
    setDisplayName(`${sourceName} copy`);
  };

  const check = checkCloneName(key, gameUnits, clones);
  const named = displayName.trim();
  const replaces = check.verdict === "replaces";
  const create = () => {
    if (!check.ok || !named) return;
    onCreate(check.key, named, replaces);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={toggle}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <Copy className="size-3.5" />
          Copy unit
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96">
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            create();
          }}
        >
          <div className="flex flex-col gap-1">
            <h3 className="text-sm font-medium">Copy {sourceName}</h3>
            <p className="text-xs text-muted-foreground">
              The copy starts as a whole definition of its own, exactly as{" "}
              <span className="font-mono">{sourceKey}</span> stands now.
              Changing it later changes nothing about the unit it came from.
            </p>
          </div>

          <Field
            label="Internal name"
            hint="What the game and every tool joins on. Lowercase, no spaces."
          >
            <Input
              value={key}
              onChange={(e) => setKey(e.target.value.toLowerCase())}
              className="h-8 font-mono text-xs"
              autoComplete="off"
              spellCheck={false}
            />
          </Field>

          <Field label="Name in game" hint="What a player sees it called.">
            <Input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="h-8"
              autoComplete="off"
            />
          </Field>

          <Outcome
            verdict={check.verdict}
            cloneKey={check.key}
            replacedName={
              replaces ? nameOf(check.key, gameUnits[check.key]) : ""
            }
          />
          {check.ok && !named && (
            <p className="text-xs text-muted-foreground">
              Give it a name players will see.
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => toggle(false)}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={!check.ok || !named}>
              {replaces ? `Replace ${check.key}` : "Add unit"}
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Take one of your own units back out.
 *
 * Asks first, because a copy carries every edit made to it since and there is
 * nothing to undo it with. The game's own units have no such button: they
 * cannot be removed, only edited.
 */
export function DeleteCloneButton({
  name,
  edits,
  onDelete,
}: {
  name: string;
  /** How many fields have been changed on it since it was made. */
  edits: number;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <Trash2 className="size-3.5" />
          Delete
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-80 flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-medium">Delete {name}?</h3>
          <p className="text-xs text-muted-foreground">
            It goes out of the tweak altogether
            {edits > 0
              ? `, along with the ${edits} change${edits === 1 ? "" : "s"} made to it since`
              : ""}
            . Nothing puts it back.
          </p>
        </div>
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setOpen(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
          >
            Delete
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** What the button is about to do, or why it cannot. */
function Outcome({
  verdict,
  cloneKey,
  replacedName,
}: {
  verdict: ReturnType<typeof checkCloneName>["verdict"];
  cloneKey: string;
  replacedName: string;
}) {
  if (verdict === "replaces")
    return (
      <p className="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400">
        <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span>
          <span className="font-mono">{cloneKey}</span> is already the game's{" "}
          {replacedName}. Your copy takes its place, and the game's own version
          is not in the tweak at all.
        </span>
      </p>
    );

  const message =
    verdict === "empty"
      ? "Give it an internal name."
      : verdict === "invalid"
        ? "An internal name can only use lowercase letters, numbers and underscores."
        : verdict === "taken"
          ? `You have already added a unit called ${cloneKey}. Rename that one, or edit it instead of copying again.`
          : `Adds ${cloneKey} as a new unit. Nothing in the game is called that.`;

  return <p className="text-xs text-muted-foreground">{message}</p>;
}
