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
 * A table has no control at all, so it is shown as the Lua the game wrote,
 * small ones in the row and large ones in a drawer. `LuaTableValue` holds that
 * and the reasoning behind it (issue #2695).
 *
 * A field that names a file in the game's archive draws it under the box, which
 * `AssetPreview` holds and which is where the model, the picture and the way
 * into the unit builder live (issue #2694).
 *
 * A custom parameter also carries a note naming the Lua file that reads it
 * (issue #2661), which for most of them is the only thing on the page that says
 * what the value does.
 *
 * On a game the edit-in-place route can write, a field the patcher cannot
 * change in the unit's own file is read only, with the reason and the file's
 * Lua a click away, and an offer to send that one change through the mutator
 * route instead (issue #2633). `InPlaceNote` below draws that.
 *
 * A field the game's own post files change as it loads says so, with what
 * they do to the game's own value (issue #3057). The game runs them over a
 * value typed here too, so the number typed is not always the number the game
 * loads. `PostProcessedNote` below draws that.
 */
import { Button, cn, Input } from "@picoframe/frame";
import {
  FileCog,
  FileLock2,
  FolderOpen,
  RotateCcw,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useState } from "react";
import { OptionSelect } from "@/components/OptionSelect";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
// The "?" tooltip mapconv already built for its own labelled fields. Shared
// rather than copied: it is a generic control that happens to live in that
// plugin's folder.
import { luaLiteral } from "@/lib/lua";
import { HelpTip } from "@/mapconv/pages/components/Help";
import {
  type AssetBrowsing,
  assetFieldOf,
  assetState,
} from "../../assetFields";
import type { PostNote } from "../../beforePost";
import type { ConsumerNote } from "../../customParamConsumers";
import type { FieldCheck, LuaExcerpt } from "../../inPlace";
import type { FieldRow } from "../../unitSections";
import { AssetPicker } from "./AssetPicker";
import { AssetPreview } from "./AssetPreview";
import { LuaTableValue } from "./LuaTableValue";

/** Which editor a value gets, or none. */
export type ControlKind = "boolean" | "number" | "numberList" | "text" | "raw";

export function controlKind(row: FieldRow): ControlKind {
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

/** Whether a value is a table, which is the case the row has no control for
 *  and shows as Lua instead (issue #2695). */
const isTable = (
  value: unknown,
): value is Record<string, unknown> | unknown[] =>
  typeof value === "object" && value !== null;

/**
 * How a value reads when it is only being shown, never edited, on one line.
 *
 * Lua rather than JSON, for the reason `LuaTableValue` gives, but flattened:
 * this is the one-line summary under an overridden row, where a table's own
 * line breaks would push the rows below it off the screen.
 */
function display(value: unknown): string {
  if (value === undefined) return "not set";
  if (typeof value === "string") return value;
  return luaLiteral(value).replace(/\s*\n\s*/g, " ");
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
  disabled,
  ariaLabel,
  onCommit,
}: {
  value: unknown;
  kind: ControlKind;
  muted: boolean;
  disabled: boolean;
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
      disabled={disabled}
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

/** What the edit-in-place route makes of one field (issue #2633). */
export interface InPlaceField {
  /** The dry run's answer. `refusal` is null when the field can be written. */
  check: FieldCheck;
  /** Whether the user sent this field's change through the mutator route. */
  routed: boolean;
  onRoute: (routed: boolean) => void;
}

/** The unit file's Lua around a refusal, with the lines it is about marked. */
function Excerpt({
  excerpt,
  from,
  to,
}: {
  excerpt: LuaExcerpt;
  from: number;
  to: number;
}) {
  return (
    <pre className="max-h-64 overflow-auto rounded bg-muted py-1.5 font-mono text-[11px] leading-snug">
      {excerpt.lines.map((line, i) => {
        const number = excerpt.firstLine + i;
        const marked = number >= from && number <= to;
        return (
          <div
            key={number}
            data-marked={marked || undefined}
            className={cn(
              "flex gap-2 px-1.5",
              marked && "bg-amber-500/15 text-foreground",
            )}
          >
            <span className="w-7 shrink-0 select-none text-right text-muted-foreground">
              {number}
            </span>
            <span className="whitespace-pre">{line}</span>
          </div>
        );
      })}
    </pre>
  );
}

/**
 * Why a field is read only for the edit-in-place route, and the way round it
 * (issue #2633). The reason and the Lua sit in a popover rather than the row,
 * because a unit whose table two units share has every row refused, and forty
 * excerpts inline would bury the values.
 */
function InPlaceNote({
  label,
  field,
  overridden,
}: {
  label: string;
  field: InPlaceField;
  overridden: boolean;
}) {
  const refusal = field.check.refusal;
  const where = refusal?.file
    ? `${refusal.file}${refusal.location ? `, line ${refusal.location.start.line}` : ""}`
    : null;
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-muted-foreground">
      <FileLock2 className="size-3 shrink-0" />
      <span>
        {field.routed
          ? "Goes through the mutator route. Writing in place skips this field."
          : overridden
            ? "Read only for edit in place. This change stops an in-place write."
            : "Read only for edit in place."}
      </span>
      {refusal && (
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="underline underline-offset-2 hover:text-foreground focus-visible:text-foreground"
              aria-label={`Why ${label} cannot be written in place`}
            >
              Why?
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="flex w-[32rem] flex-col gap-2"
          >
            <h3 className="text-sm font-medium">
              Coilbox cannot write {label} into the game's own file
            </h3>
            <p className="text-xs">{refusal.message}</p>
            {where && (
              <p className="font-mono text-[11px] text-muted-foreground">
                {where}
              </p>
            )}
            {field.check.excerpt && refusal.location && (
              <Excerpt
                excerpt={field.check.excerpt}
                from={refusal.location.start.line}
                to={refusal.location.end.line}
              />
            )}
            <p className="text-xs text-muted-foreground">
              A mutator overrides the value however the file works it out, so
              this one change can go that way while the rest of the project is
              written in place.
            </p>
          </PopoverContent>
        </Popover>
      )}
      <Button
        variant="outline"
        size="sm"
        className="h-6 px-2 text-[10px]"
        onClick={() => field.onRoute(!field.routed)}
        aria-label={
          field.routed
            ? `Stop sending ${label} through the mutator route`
            : `Send ${label} through the mutator route`
        }
      >
        {field.routed
          ? "Undo"
          : overridden
            ? "Send this change to the mutator"
            : "Change it through the mutator"}
      </Button>
    </span>
  );
}

/**
 * What the game's post files do to this field as it loads (issue #3057).
 *
 * "May" because what they do to a typed value depends on the game's Lua and
 * on the route the project reaches the game by: a mutator that ships its own
 * `gamedata/unitdefs_post.lua` covers the game's (`postHook.ts`), and a copy
 * or a tweak slot does not. The mutator route loads the game with its own
 * files before a test or a package and writes a value that loads as the
 * typed one, where that load proves it (`loadsAs.ts`, issue #3059). The other
 * two routes write the value as typed, so the note still says "may".
 */
function PostProcessedNote({ post }: { post: PostNote }) {
  const what =
    post.kind === "changed"
      ? `The game changes this field as it loads. Its files say ${display(post.file)} and it loads as ${display(post.loaded)}.`
      : post.loaded === undefined
        ? "The game sets this field as it loads. Its own files leave it unset."
        : `The game sets this field as it loads, to ${display(post.loaded)}. Its own files leave it unset.`;
  return (
    <span className="flex items-start gap-1 text-[10px] text-muted-foreground">
      <FileCog className="mt-px size-3 shrink-0" />
      <span>
        {what} It may change a value typed here too. A mutator archive gets a
        value the game turns into the typed one, where loading the game proves
        it. Beyond All Reason's tweak slots and edit in place write it as typed.
      </span>
    </span>
  );
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
  inPlace,
  post,
  readOnly: locked = false,
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
  /** What the edit-in-place route makes of this field, on a game it can write
   *  and only when there is something to say: the field cannot be written in
   *  place, or its change was sent through the mutator route (issue #2633). */
  inPlace?: InPlaceField;
  /** What the game's post files do to this field, when they change it (issue
   *  #3057). Said only on a row that can be typed into. */
  post?: PostNote;
  /** Shown and not offered, for a field nothing on this page can change, such
   *  as one on a weapon definition several units share (issue #2639). The
   *  reason is said once above the rows rather than on each of them. */
  readOnly?: boolean;
  onChange: (value: unknown) => void;
  onReset: () => void;
}) {
  const kind = controlKind(row);
  const overridden = row.state === "overridden";
  const muted = !overridden;
  // Read only until the user sends the change through the mutator route. A
  // reset stays on offer, since taking a change out never stops a write.
  const readOnly =
    locked || (Boolean(inPlace?.check.refusal) && !inPlace?.routed);

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
      disabled={readOnly}
      ariaLabel={row.label}
      onCommit={onChange}
    />
  );

  // The one file the field names, once the archive has been found to hold it
  // (issue #2694). Absent for a field with nothing written in it and for one
  // whose path reaches nothing, where the warning below says so instead.
  const preview = asset && assets && pointsAt?.member ? pointsAt.member : "";

  /**
   * Whether the value column holds more than a control's worth of height.
   *
   * Two of them now. A model viewport is 12rem (issue #2694) and a table shown
   * where it stands is up to eight lines of Lua (issue #2695), and against
   * either a centred label sits halfway down the row, a long way from the thing
   * it names. Every other row is one control against a two-line label, which is
   * what the centring is for.
   *
   * A table is counted whichever way it draws, rather than only when it draws
   * inline. Knowing which it is means serialising it, and the row would be
   * doing that for every table field on the page purely to choose an alignment.
   * The other way it draws is a button the same height as an input, so on that
   * one the two alignments are a pixel apart.
   */
  const tall = Boolean(preview) || isTable(row.value);

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
      // Named for the change ledger's own link back to the field (issue
      // #2653): a row a broken change traces to is something a link can
      // scroll to rather than a path somebody then has to search this list
      // for. The path rather than the label, because it is unique and it is
      // what the ledger already carries.
      id={`field-${row.path}`}
      className={cn(
        "grid grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto] gap-3 rounded-md border-l-2 py-1.5 pl-2 pr-1",
        tall ? "items-start" : "items-center",
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
            disabled={readOnly}
            onCheckedChange={(v) => onChange(v)}
          />
        ) : choices && kind === "text" ? (
          <OptionSelect
            size="sm"
            ariaLabel={row.label}
            placeholder={choices.placeholder}
            disabled={readOnly}
            value={current}
            onValueChange={onChange}
            options={options}
          />
        ) : kind === "raw" && isTable(row.value) ? (
          <LuaTableValue value={row.value} label={row.label} path={row.path} />
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
              disabled={readOnly}
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
        {inPlace && (
          <InPlaceNote
            label={row.label}
            field={inPlace}
            overridden={overridden}
          />
        )}
        {post && !readOnly && kind !== "raw" && (
          <PostProcessedNote post={post} />
        )}
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
