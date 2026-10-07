import { Button, Input } from "@picoframe/frame";
import { ChevronDown, RotateCcw } from "lucide-react";
import { useState } from "react";
import { OptionSelect } from "@/components/OptionSelect";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { ConfigOption, GameItem } from "@/content/bindings";
import {
  changedOptions,
  defaultLabel,
  effectiveValue,
  groupOptions,
  isChanged,
  type OptionGroup,
  resetOptionValues,
} from "@/play/modOptions";

/** The value in effect for an option, as a control-ready string. */
const effective = (o: ConfigOption, value?: string) =>
  effectiveValue(o, value) ?? "";

/**
 * What a control reports when it is changed. `undefined` means the option is no
 * longer overridden and falls back to the game's default, which is not the same
 * as setting it to the default: an option nobody chose stays out of a saved
 * preset, so it follows the game if the game's default changes (see
 * `withOption`).
 */
export type OptionChange = (value: string | undefined) => void;

/**
 * Collapsible panel holding everything about the *game*: which game, and the
 * game's mod options (rendered as checkboxes / number / select / text inputs by
 * type). Collapsed, its header shows a one-line summary so the setup stays
 * scannable. Start positions are not here: the mode and the boxes it enables are
 * read against the minimap, so `StartPosCard` sits under the map instead.
 */
export function GameOptionsPanel({
  selectedGame,
  options,
  optionValues,
  onOptionChange,
  onOptionValuesChange,
  disabled,
}: {
  selectedGame?: GameItem | null;
  options: ConfigOption[];
  optionValues: Record<string, string>;
  onOptionChange: (key: string, value: string | undefined) => void;
  /**
   * Replace the whole set of values. Lets a reset change many options in one
   * update, which looping over `onOptionChange` cannot do for a caller that
   * builds its next state from a stale copy. Without it the panel offers no
   * reset for a group.
   */
  onOptionValuesChange?: (values: Record<string, string>) => void;
  disabled?: boolean;
}) {
  const groups = groupOptions(options);
  const changed = changedOptions(options, (o) => optionValues[o.key]).length;
  const resetGroup = onOptionValuesChange
    ? (members: ConfigOption[]) =>
        onOptionValuesChange(resetOptionValues(members, optionValues))
    : undefined;
  const summary = [
    selectedGame?.name ?? "No game",
    changed > 0 ? `${changed} options changed` : "default options",
  ].join(" · ");

  return (
    <Collapsible
      defaultOpen
      className="rounded-lg border border-border/50 bg-card"
    >
      <div className="flex items-center gap-1 pr-3">
        <CollapsibleTrigger className="flex min-w-0 flex-1 items-baseline gap-3 rounded-lg px-4 py-3 text-left hover:bg-muted/30">
          <span className="text-sm font-semibold">Game options</span>
          <span className="truncate text-xs text-muted-foreground">
            {summary}
          </span>
        </CollapsibleTrigger>
        {resetGroup && !disabled && (
          <GroupReset
            count={changed}
            label="Game options"
            onConfirm={() => resetGroup(options)}
          />
        )}
        {/* The arrow sits after the reset, so it is a trigger of its own: a
            button cannot hold the reset button. The header beside it is the
            one a keyboard or a screen reader uses. */}
        <CollapsibleTrigger
          tabIndex={-1}
          aria-hidden
          className="group shrink-0 rounded p-1 hover:bg-muted/30"
        >
          <ChevronDown className="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
        </CollapsibleTrigger>
      </div>

      <CollapsibleContent>
        <div className="border-t border-border/40 px-4 pb-4 pt-3">
          {/* Start positions used to fill this panel whatever the game, so with
              them moved under the map a game declaring no options would open
              onto nothing at all. Say so instead. */}
          {groups.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              This game declares no options.
            </p>
          ) : (
            <>
              <div className="mb-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                Mod options
              </div>
              <ModOptionGroups
                options={options}
                readValue={(o) => optionValues[o.key]}
                disabled={disabled}
                onChange={(o, v) => onOptionChange(o.key, v)}
                onResetGroup={resetGroup}
              />
            </>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/** Shared props for the two ways a group renders. */
interface GroupProps {
  group: OptionGroup;
  readValue: (o: ConfigOption) => string | undefined;
  disabled?: boolean;
  onChange: (o: ConfigOption, value: string | undefined) => void;
  onResetGroup?: (options: ConfigOption[]) => void;
}

/**
 * A game's mod options, grouped the way the game itself groups them.
 *
 * Shared by the Singleplayer setup and the battle room's options drawer. The
 * room used to render one flat column, which for Beyond All Reason's ~180
 * options meant a screen and a half of scrolling past multipliers to reach
 * anything else, while Singleplayer had already solved it: two columns, and a
 * collapsible section per `section` option the game declares, opened when it
 * holds a change so a non-default can never hide behind a shut header.
 *
 * The two surfaces read and write an option differently, one from a plain
 * record and one from the battle's script tags with edits in flight, so the
 * lookup and the write are passed in rather than assumed. So is the reset of a
 * section: `onResetGroup` is handed every option the section declares, and the
 * caller works out which of them are changed and how to put them back. Without
 * it a section offers no reset.
 */
export function ModOptionGroups({
  options,
  readValue,
  disabled,
  onChange,
  onResetGroup,
}: {
  options: ConfigOption[];
  readValue: (o: ConfigOption) => string | undefined;
  disabled?: boolean;
  onChange: (o: ConfigOption, value: string | undefined) => void;
  onResetGroup?: (options: ConfigOption[]) => void;
}) {
  const groups = groupOptions(options);
  return (
    <div className="space-y-2">
      {groups.map((g) =>
        g.name === undefined ? (
          <OptionGrid
            key={g.key}
            group={g}
            readValue={readValue}
            disabled={disabled}
            onChange={onChange}
          />
        ) : (
          <OptionSection
            key={g.key}
            group={g}
            readValue={readValue}
            disabled={disabled}
            onChange={onChange}
            onResetGroup={onResetGroup}
          />
        ),
      )}
    </div>
  );
}

/** A group's options in the two-column grid, with no header of their own. */
function OptionGrid({ group, readValue, disabled, onChange }: GroupProps) {
  return (
    <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
      {group.options.map((o) => (
        <ModOptionField
          key={o.key}
          option={o}
          value={readValue(o)}
          disabled={disabled}
          onChange={(v) => onChange(o, v)}
        />
      ))}
    </div>
  );
}

/**
 * One collapsible section of options. Sections start closed to keep long option
 * lists scannable, but one holding changes opens by default and says how many,
 * so a non-default setting can never hide behind a collapsed header.
 */
function OptionSection(props: GroupProps) {
  const { group, readValue, disabled, onResetGroup } = props;
  const changed = changedOptions(group.options, readValue).length;

  return (
    <Collapsible
      defaultOpen={changed > 0}
      className="rounded-md border border-border/40"
    >
      <div className="flex items-center gap-1 pr-2">
        <CollapsibleTrigger className="group flex min-w-0 flex-1 items-center gap-2 rounded-md px-3 py-2 text-left hover:bg-muted/30">
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
          <span
            className="truncate text-xs font-medium"
            title={group.description ?? group.name}
          >
            {group.name}
          </span>
          <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
            {changed > 0 ? `${changed} changed` : group.options.length}
          </span>
        </CollapsibleTrigger>
        {onResetGroup && !disabled && (
          <GroupReset
            count={changed}
            label={group.name ?? "section"}
            onConfirm={() => onResetGroup(group.options)}
          />
        )}
      </div>
      <CollapsibleContent>
        <div className="border-t border-border/40 px-3 pb-3 pt-2">
          <OptionGrid {...props} />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * An option's own description, as a dimmed line under its control.
 *
 * It used to be a `title`, so it took a hover and a wait to read and never
 * appeared at all for anybody not using a mouse. The text is written to be read
 * while deciding, which is a poor fit for something you have to go looking for.
 */
function OptionHelp({
  option,
  className,
}: {
  option: ConfigOption;
  className?: string;
}) {
  if (!option.description || option.description === option.name) return null;
  // `text-muted-foreground` undimmed, because there is no tier below it: #1034
  // measured that the ramp has no room for one that still clears AA. The help
  // reads as secondary from where it sits and how small it is, not from a
  // quieter ink.
  return (
    <span
      className={`block text-xs leading-snug text-muted-foreground ${className ?? ""}`}
    >
      {option.description}
    </span>
  );
}

/**
 * The mark on an option whose value differs from the game's declared default:
 * the word "changed" and the default it changed from, so it reads without
 * colour. The pill matches the one on a unit tweak field that has been edited,
 * so the app has one way of showing a change. Shared by every option row, in
 * Singleplayer and in the battle room.
 */
function ChangedMark({
  option,
  value,
  onReset,
}: {
  option: ConfigOption;
  value?: string;
  /** Put this one option back to its default. Absent where it cannot be edited. */
  onReset?: () => void;
}) {
  if (!isChanged(option, value)) return null;
  return (
    <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
      <span className="shrink-0 rounded-full bg-primary/15 px-1.5 font-medium text-primary">
        changed
      </span>
      <span className="truncate">Default: {defaultLabel(option)}</span>
      {onReset && (
        <button
          type="button"
          aria-label={`Reset ${option.name} to its default`}
          title="Reset to default"
          onClick={onReset}
          className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <RotateCcw className="size-3" />
        </button>
      )}
    </span>
  );
}

/**
 * A "Reset" for a group of options, asking first because it changes many at
 * once. A popover rather than a dialog, so it stays beside the button it came
 * from. Shown only while something in the group is changed.
 */
export function GroupReset({
  count,
  label,
  onConfirm,
  busy,
}: {
  count: number;
  /** What is being reset, for the button's accessible name. */
  label: string;
  onConfirm: () => void;
  /** A previous reset is still being sent. */
  busy?: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (count === 0) return null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 shrink-0 px-2 text-[11px]"
          disabled={busy}
          aria-label={`Reset ${label}`}
        >
          Reset
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-64 flex-col gap-3">
        <p className="text-sm">
          Reset {count} {count === 1 ? "option" : "options"} to{" "}
          {count === 1 ? "its default" : "their defaults"}?
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setOpen(false);
              onConfirm();
            }}
          >
            Reset
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Render one mod option as the control its type calls for. A section is a group
 * header rather than a setting, so it renders nothing here: callers that group
 * (see `groupOptions`) never pass one, and those that don't would otherwise show
 * it as an empty text box.
 */
export function ModOptionField({
  option: o,
  value,
  disabled,
  onChange,
}: {
  option: ConfigOption;
  value?: string;
  disabled?: boolean;
  onChange: OptionChange;
}) {
  const id = `modopt-${o.key}`;
  // Reporting `undefined` is how a field says "back to the default", whichever
  // way its screen stores that. Not offered on a field nobody can edit.
  const reset = disabled ? undefined : () => onChange(undefined);

  if (o.type === "section") return null;

  if (o.type === "bool") {
    return (
      <label
        htmlFor={id}
        className="flex cursor-pointer items-start gap-2 py-1 text-sm"
      >
        <Checkbox
          id={id}
          checked={effective(o, value) === "1"}
          disabled={disabled}
          onCheckedChange={(v) => onChange(v === true ? "1" : "0")}
          className="mt-0.5"
        />
        <span className="flex min-w-0 flex-col gap-0.5">
          <span>{o.name}</span>
          <OptionHelp option={o} />
          <ChangedMark option={o} value={value} onReset={reset} />
        </span>
      </label>
    );
  }

  if (o.type === "list" && o.listItems && o.listItems.length > 0) {
    return (
      <div>
        <span className="mb-1.5 block text-xs text-muted-foreground">
          {o.name}
        </span>
        <OptionHelp option={o} className="mb-1.5" />
        <OptionSelect
          value={effective(o, value)}
          disabled={disabled}
          options={o.listItems.map((it) => ({ value: it.key, label: it.name }))}
          onValueChange={onChange}
        />
        <ChangedMark option={o} value={value} onReset={reset} />
      </div>
    );
  }

  return (
    <TypedOptionField
      option={o}
      value={value}
      disabled={disabled}
      onChange={onChange}
    />
  );
}

/**
 * A number or text option. The box holds the game's default as real text, the
 * way the tick box and the dropdown beside it show theirs, so no setting in the
 * panel reads as blank when the game will in fact use a value for it.
 *
 * Emptying the box is a state of its own: it stays empty while you retype, and
 * the default returns when you leave it. Leaving is also when an option you had
 * changed drops its override, so the box and the stored value agree. An empty
 * box is not a number the engine can use, and reverting to the default is what
 * clearing a field that always has a value can honestly mean. Dropping the
 * override rather than storing the default keeps an option nobody chose out of
 * saved state, so it still follows the game if the game changes its mind.
 */
function TypedOptionField({
  option: o,
  value,
  disabled,
  onChange,
}: {
  option: ConfigOption;
  value?: string;
  disabled?: boolean;
  onChange: OptionChange;
}) {
  const id = `modopt-${o.key}`;
  const isNumber = o.type === "number";
  const reset = disabled ? undefined : () => onChange(undefined);
  // Held here rather than reported, so clearing the box writes nothing until
  // the edit is finished (and writes nothing at all if it never was).
  const [emptied, setEmptied] = useState(false);

  return (
    <div>
      <Label htmlFor={id} className="block font-normal">
        <span className="mb-1.5 block text-xs text-muted-foreground">
          {o.name}
        </span>
        <OptionHelp option={o} className="mb-1.5" />
        <Input
          id={id}
          type={isNumber ? "number" : "text"}
          min={isNumber ? o.numberMin : undefined}
          max={isNumber ? o.numberMax : undefined}
          step={isNumber ? o.numberStep : undefined}
          value={emptied ? "" : effective(o, value)}
          placeholder={o.default}
          disabled={disabled}
          onChange={(e) => {
            const next = e.target.value;
            setEmptied(next === "");
            if (next !== "") onChange(next);
          }}
          onBlur={() => {
            if (!emptied) return;
            setEmptied(false);
            if (value !== undefined) onChange(undefined);
          }}
        />
      </Label>
      <ChangedMark option={o} value={value} onReset={reset} />
    </div>
  );
}
