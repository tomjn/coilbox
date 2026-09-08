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
 *
 * A custom parameter also carries a note naming the Lua file that reads it
 * (issue #2661), which for most of them is the only thing on the page that says
 * what the value does.
 */
import { Button, cn, Input } from "@picoframe/frame";
import { FolderOpen, RotateCcw, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { OptionSelect } from "@/components/OptionSelect";
import { Switch } from "@/components/ui/switch";
// The "?" tooltip mapconv already built for its own labelled fields. Shared
// rather than copied: it is a generic control that happens to live in that
// plugin's folder.
import { HelpTip } from "@/mapconv/pages/components/Help";
import {
  type AssetBrowsing,
  assetFieldOf,
  assetState,
} from "../../assetFields";
import type { ConsumerNote } from "../../customParamConsumers";
import type { FieldRow } from "../../unitSections";
import { AssetPicker } from "./AssetPicker";
import { AssetPreview } from "./AssetPreview";

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
 * A field whose value has to name something the game declares, so it is picked
 * (issue #2651).
 *
 * A value already in the box that is not on the list is offered anyway, at the
 * top and said to be unknown. It is either a name this game spells in a file
 * nothing here read, or a name carried in from a game that did have it, and
 * dropping it out of the list would replace the user's value with an empty box
 * the moment they opened the page.
 */
export interface FieldChoices {
  options: { value: string; label: string; description?: string }[];
  placeholder: string;
  /** What to say about a value the list does not contain. */
  unknownLabel: (value: string) => string;
}

/**
 * One row. `onChange` is handed the new value and is expected to drop the
 * override when it matches what was inherited, which is what `setOverride`
 * does, so this component never has to decide whether an edit is really an edit.
 */
export function UnitFieldRow({
  row,
  note,
  assets,
  choices,
  warning,
  inheritedLabel = "Game value",
  onChange,
  onReset,
}: {
  row: FieldRow;
  /** What this field is allowed to name, when the game declares a list of it
   *  (issue #2651). Absent for every field that is free text. */
  choices?: FieldChoices;
  /** Something wrong with the value that only its neighbours reveal, such as a
   *  movement class on a unit that does not move (issue #2651). */
  warning?: string;
  /** The game's archive, for a field that names a file in it (issue #2648).
   *  Absent until the listing lands, and on a page with no game picked. */
  assets?: AssetBrowsing;
  /** What the game's own Lua says about this field, for a custom parameter
   *  (issue #2661). Absent for every other field, and for a custom parameter
   *  whose scan has not come back. */
  note?: ConsumerNote;
  /** What the value under an edit is. The game's, unless the unit is one the
   *  project added, in which case the game never had an opinion about it. */
  inheritedLabel?: string;
  onChange: (value: unknown) => void;
  onReset: () => void;
}) {
  const kind = controlKind(row);
  const overridden = row.state === "overridden";
  const muted = !overridden;

  const [picking, setPicking] = useState(false);
  // Only once the archive listing has landed. Without it there is nothing to
  // offer and nothing to check a value against, and a Browse button that opens
  // an empty drawer is worse than no button.
  const asset =
    assets && assets.index.files.length > 0 && kind === "text"
      ? assetFieldOf(row, assets.derived)
      : undefined;
  const pointsAt =
    asset && assets ? assetState(assets.index, asset, row.value) : undefined;
  // The typo this picker exists to catch, said where it was made rather than at
  // the point the game refuses to load the unit. A field with nothing written in
  // it has no path to be wrong about, so it says nothing.
  const missing =
    asset && assets && pointsAt && pointsAt.member === undefined
      ? `${assets.archiveLabel} has no ${asset.kind.noun} at this path.`
      : undefined;

  const input = (
    <SettlingInput
      value={row.value}
      kind={kind}
      muted={muted}
      ariaLabel={row.label}
      onCommit={onChange}
    />
  );

  // The one file the field names, once the archive has been found to hold it
  // (issue #2694). Absent for a field with nothing written in it and for one
  // whose path reaches nothing, where the warning below says so instead.
  const preview = asset && assets && pointsAt?.member ? pointsAt.member : "";

  const current = typeof row.value === "string" ? row.value.trim() : "";
  const options =
    choices && current && !choices.options.some((o) => o.value === current)
      ? [
          {
            value: current,
            label: current,
            description: choices.unknownLabel(current),
          },
          ...choices.options,
        ]
      : (choices?.options ?? []);

  return (
    <div
      className={cn(
        "grid grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto] gap-3 rounded-md border-l-2 py-1.5 pl-2 pr-1",
        // Centred for the two-line rows that are almost all of them, and topped
        // for a row carrying a preview: a model viewport is 12rem tall and a
        // centred label would sit halfway down it, a long way from the box it
        // names.
        preview ? "items-start" : "items-center",
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
          {/* A label nobody wrote is the engine's key wearing a label's clothes,
              and the reader cannot tell which they are looking at. Saying so is
              worth more than quietly dropping the key, which is the only thing
              they can search the engine for (issue #2679). */}
          {row.field.known && !row.field.described && (
            <span
              className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground"
              title="Coilbox has no description for this field yet, so this is the engine's own key rather than a label."
            >
              engine key
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
        ) : choices && kind === "text" ? (
          <OptionSelect
            size="sm"
            ariaLabel={row.label}
            placeholder={choices.placeholder}
            value={current}
            onValueChange={onChange}
            options={options}
          />
        ) : kind === "raw" ? (
          <code className="truncate rounded bg-muted px-1.5 py-1 font-mono text-xs text-muted-foreground">
            {display(row.value)}
          </code>
        ) : asset && assets ? (
          <div className="flex items-center gap-1.5">
            {input}
            <Button
              variant="outline"
              size="sm"
              className="h-8 shrink-0 gap-1.5"
              onClick={() => setPicking(true)}
              title={`Choose a ${asset.kind.noun} from ${assets.archiveLabel}`}
              aria-label={`Browse for ${row.label}`}
            >
              <FolderOpen className="size-3.5" />
              Browse
            </Button>
            {picking && (
              <AssetPicker
                open
                onOpenChange={setPicking}
                field={asset}
                label={row.label}
                current={pointsAt?.member}
                index={assets.index}
                archive={assets.archive}
                archiveLabel={assets.archiveLabel}
                enginePath={assets.enginePath}
                dataDir={assets.dataDir}
                onPick={onChange}
              />
            )}
          </div>
        ) : (
          input
        )}
        {/* The file the field names, drawn (issue #2694). */}
        {preview && asset && assets && (
          <AssetPreview
            field={asset}
            member={preview}
            assets={assets}
            label={row.label}
          />
        )}
        {[missing, warning].filter(Boolean).map((text) => (
          <span
            key={text}
            className="flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-500"
          >
            <TriangleAlert className="size-3 shrink-0" />
            {text}
          </span>
        ))}
        {note && (
          <span className="flex flex-wrap items-baseline gap-x-1.5 text-[10px] text-muted-foreground">
            {note.text}
            {note.files.map((file) => (
              <code key={file} className="break-all font-mono">
                {file}
              </code>
            ))}
          </span>
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
