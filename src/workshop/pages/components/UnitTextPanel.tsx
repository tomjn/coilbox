/**
 * What a unit is called and what its tooltip says (issue #2650).
 *
 * First on the page, above the numbers, because it is the first edit anyone
 * makes and the only one a player reads in words. Its own panel rather than two
 * more rows in the field list, because for a game like Beyond All Reason there
 * is no field: the name is not in the unit definition and the edit does not go
 * there either. `unitText.ts` holds that argument in full.
 *
 * The panel says where the edit lands. A modder who renames a BAR unit is
 * editing the game's localisation file, and that is worth knowing before they
 * wonder why their tweak did not survive a translation update.
 *
 * States are the field list's, so the page reads the same either way: the
 * inherited value greyed, an edited value in the foreground with what it
 * replaced underneath it, and a reset button that removes the edit rather than
 * writing the old value back over it.
 */
import { Button, cn, Input } from "@picoframe/frame";
import { RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import {
  LANGUAGE_UNITS_FILE,
  type TextField,
  type TextHome,
  type UnitTextRow,
} from "../../unitText";

/**
 * A box that reports its edit once it settles, on blur or on Enter, and drops a
 * half-typed value on Escape. The field list's boxes behave the same way, and
 * for the same reason: committing every keystroke would record "Comm" and
 * "Comman" on the way to "Commander".
 */
function SettlingText({
  value,
  multiline,
  label,
  muted,
  placeholder,
  onCommit,
}: {
  value: string;
  multiline: boolean;
  label: string;
  muted: boolean;
  placeholder?: string;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  // Follows the value when it changes from outside, which is what a reset and a
  // move to another unit both are.
  useEffect(() => setDraft(value), [value]);

  const commit = () => {
    if (draft !== value) onCommit(draft);
  };
  const keys = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") setDraft(value);
    if (e.key === "Enter" && !multiline) {
      e.preventDefault();
      commit();
    }
  };
  const className = cn("text-sm", muted && "text-muted-foreground");

  return multiline ? (
    <Textarea
      value={draft}
      aria-label={label}
      rows={2}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={keys}
      className={cn(className, "min-h-0 py-1.5")}
    />
  ) : (
    <Input
      value={draft}
      aria-label={label}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={keys}
      className={cn(className, "h-8")}
    />
  );
}

function TextRow({
  row,
  label,
  hint,
  multiline,
  placeholder,
  onChange,
  onReset,
}: {
  row: UnitTextRow;
  label: string;
  hint: string;
  multiline: boolean;
  placeholder: string;
  onChange: (value: string) => void;
  onReset: () => void;
}) {
  const overridden = row.state === "overridden";
  return (
    <div
      className={cn(
        "grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)_auto] items-start gap-3 rounded-md border-l-2 py-1.5 pl-2 pr-1",
        overridden ? "border-l-primary bg-primary/5" : "border-l-transparent",
      )}
    >
      <div className="flex min-w-0 flex-col gap-0.5 pt-1.5">
        <span className="text-xs font-medium">{label}</span>
        <span className="text-[10px] text-muted-foreground">{hint}</span>
      </div>

      <div className="flex min-w-0 flex-col gap-0.5">
        <SettlingText
          value={row.value}
          multiline={multiline}
          label={label}
          muted={!overridden}
          placeholder={placeholder}
          onCommit={onChange}
        />
        {overridden && (
          <span className="text-[10px] text-muted-foreground">
            {row.present
              ? `Game value: ${row.inherited}`
              : "The game says nothing here."}
          </span>
        )}
        {!overridden && !row.present && (
          <span className="text-[10px] text-muted-foreground">
            The game says nothing here. Anything you type is new.
          </span>
        )}
      </div>

      {overridden ? (
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={onReset}
          title={`Reset ${label} to the inherited value`}
          aria-label={`Reset ${label} to the inherited value`}
        >
          <RotateCcw className="size-3.5" />
        </Button>
      ) : (
        <span className="size-7" />
      )}
    </div>
  );
}

export function UnitTextPanel({
  rows,
  home,
  isClone,
  onChange,
  onReset,
}: {
  rows: Record<TextField, UnitTextRow>;
  /** Where this unit's words are kept, which is a fact about the game. */
  home: TextHome;
  /** Whether this is a unit the project added, whose definition is its own. */
  isClone: boolean;
  onChange: (field: TextField, value: string) => void;
  onReset: (field: TextField) => void;
}) {
  const destination = isClone
    ? "Kept in the unit's own definition, since this is a unit you added."
    : home === "def"
      ? `Kept in the unit definition, as ${rows.name.path} and ${rows.description.path}.`
      : `Kept in this game's ${LANGUAGE_UNITS_FILE}, not in the unit definition. This game names its units there, so that is where a rename has to go.`;

  return (
    <section className="flex flex-col gap-2 rounded-lg border border-border/50 p-2">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <h3 className="text-sm font-semibold">Name and description</h3>
        <span className="text-xs text-muted-foreground">{destination}</span>
      </div>
      <div className="flex flex-col gap-0.5">
        <TextRow
          row={rows.name}
          label="Name"
          hint="What a player sees"
          multiline={false}
          placeholder="Unnamed"
          onChange={(value) => onChange("name", value)}
          onReset={() => onReset("name")}
        />
        <TextRow
          row={rows.description}
          label="Description"
          hint="The tooltip under it"
          multiline
          placeholder="No description"
          onChange={(value) => onChange("description", value)}
          onReset={() => onReset("description")}
        />
      </div>
    </section>
  );
}
