/**
 * One field of a unit, in whichever of its states it is in (issue #1271).
 *
 * Inherited draws the game's own value greyed, because it is a fact about the
 * game rather than a decision the user has made. Overridden draws the user's
 * value in the foreground colour with the inherited one still on screen
 * underneath, since a number means nothing without the number it replaced. Reset
 * is the button that appears alongside, and it removes the override rather than
 * writing the old value back over it.
 *
 * Which control a field gets is decided from the value in front of us first and
 * the engine's declared type second. A game may write a string where the engine
 * reads a number, and the control has to fit what is actually there. Anything
 * that is not a scalar or a list of numbers draws as a raw key and value row,
 * which is also what a key only the game declares gets when its value is a table.
 */
import { Button, cn, Input } from "@picoframe/frame";
import { RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { Switch } from "@/components/ui/switch";
// The "?" tooltip mapconv already built for its own labelled fields. Shared
// rather than copied: it is a generic control that happens to live in that
// plugin's folder.
import { HelpTip } from "@/mapconv/pages/components/Help";
import type { FieldRow } from "../../unitSections";

/** Which editor a value gets, or none. */
type ControlKind = "boolean" | "number" | "numberList" | "text" | "raw";

function controlKind(row: FieldRow): ControlKind {
  const value = row.value;
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  if (typeof value === "string") return "text";
  if (Array.isArray(value) && value.every((v) => typeof v === "number"))
    return "numberList";
  // Nothing to look at, so fall back to what the engine says it will read.
  if (value === undefined || value === null) {
    if (row.field.type === "boolean") return "boolean";
    if (row.field.type === "number" || row.field.type === "integer")
      return "number";
    if (row.field.type === "string") return "text";
    if (row.field.type === "float3" || row.field.type === "float4")
      return "numberList";
  }
  return "raw";
}

/** How a value reads in a text box. */
function toDraft(value: unknown, kind: ControlKind): string {
  if (value === undefined || value === null) return "";
  if (kind === "numberList" && Array.isArray(value)) return value.join(", ");
  return String(value);
}

/** How a value reads when it is only being shown, never edited. */
function display(value: unknown): string {
  if (value === undefined) return "not set";
  if (typeof value === "string") return value;
  return JSON.stringify(value) ?? String(value);
}

/**
 * A text box that only reports an edit once it settles, on blur or on Enter.
 *
 * Committing every keystroke would write an override for "5" and then "50" on
 * the way to "500", and half of those are values the user never meant. A number
 * box also has to tolerate a half-typed "-" or "1." that parses to nothing yet.
 * `SetupPanel` holds its noisy controls the same way.
 */
function SettlingInput({
  value,
  kind,
  muted,
  ariaLabel,
  onCommit,
}: {
  value: unknown;
  kind: ControlKind;
  muted: boolean;
  ariaLabel: string;
  onCommit: (parsed: unknown) => void;
}) {
  const settled = toDraft(value, kind);
  const [draft, setDraft] = useState(settled);
  // Follows the value when it changes from outside, which is what a reset is.
  useEffect(() => setDraft(settled), [settled]);

  const commit = () => {
    if (draft === settled) return;
    if (kind === "text") {
      onCommit(draft);
      return;
    }
    if (kind === "number") {
      const parsed = Number(draft.trim());
      if (draft.trim() === "" || Number.isNaN(parsed)) {
        setDraft(settled);
        return;
      }
      onCommit(parsed);
      return;
    }
    const parts = draft
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);
    if (parts.length === 0 || parts.some(Number.isNaN)) {
      setDraft(settled);
      return;
    }
    onCommit(parts);
  };

  return (
    <Input
      value={draft}
      aria-label={ariaLabel}
      inputMode={kind === "number" ? "decimal" : undefined}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        }
        if (e.key === "Escape") setDraft(settled);
      }}
      className={cn("h-8 font-mono text-xs", muted && "text-muted-foreground")}
    />
  );
}

/**
 * One row. `onChange` is handed the new value and is expected to drop the
 * override when it matches what was inherited, which is what `setOverride`
 * does, so this component never has to decide whether an edit is really an edit.
 */
export function UnitFieldRow({
  row,
  inheritedLabel = "Game value",
  onChange,
  onReset,
}: {
  row: FieldRow;
  /** What the value under an edit is. The game's, unless the unit is one the
   *  project added, in which case the game never had an opinion about it. */
  inheritedLabel?: string;
  onChange: (value: unknown) => void;
  onReset: () => void;
}) {
  const kind = controlKind(row);
  const overridden = row.state === "overridden";
  const muted = !overridden;

  return (
    <div
      className={cn(
        "grid grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto] items-center gap-3 rounded-md border-l-2 py-1.5 pl-2 pr-1",
        overridden ? "border-l-primary bg-primary/5" : "border-l-transparent",
      )}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="flex items-center gap-1.5 text-xs font-medium">
          <span className="truncate" title={row.path}>
            {row.label}
          </span>
          {row.field.help && <HelpTip>{row.field.help}</HelpTip>}
          {!row.field.known && (
            <span
              className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground"
              title="The engine does not declare this key. Only this game's own Lua reads it."
            >
              game
            </span>
          )}
        </span>
        <span className="truncate font-mono text-[10px] text-muted-foreground">
          {row.path}
          {row.field.unit ? ` · ${row.field.unit}` : ""}
        </span>
      </div>

      <div className="flex min-w-0 flex-col gap-0.5">
        {kind === "boolean" ? (
          <Switch
            checked={row.value === true}
            aria-label={row.label}
            onCheckedChange={(v) => onChange(v)}
          />
        ) : kind === "raw" ? (
          <code className="truncate rounded bg-muted px-1.5 py-1 font-mono text-xs text-muted-foreground">
            {display(row.value)}
          </code>
        ) : (
          <SettlingInput
            value={row.value}
            kind={kind}
            muted={muted}
            ariaLabel={row.label}
            onCommit={onChange}
          />
        )}
        {overridden && (
          <span className="truncate text-[10px] text-muted-foreground">
            {row.present ? inheritedLabel : "Engine default"}:{" "}
            {display(row.inherited)}
          </span>
        )}
        {!overridden && !row.present && (
          <span className="truncate text-[10px] text-muted-foreground">
            Not set by this game.{" "}
            {row.field.engine && row.field.default === undefined
              ? `The engine uses ${row.field.engine.defaults.join(" or ") || "a value it works out itself"}.`
              : "Showing the engine's default."}
          </span>
        )}
      </div>

      {overridden ? (
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={onReset}
          title={`Reset ${row.label} to the inherited value`}
          aria-label={`Reset ${row.label} to the inherited value`}
        >
          <RotateCcw className="size-3.5" />
        </Button>
      ) : (
        <span className="size-7" />
      )}
    </div>
  );
}
