import { Input } from "@picoframe/frame";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import type { ConfigOption, GameItem } from "@/content/bindings";
import {
  effectiveValue,
  groupOptions,
  isChanged,
  type OptionGroup,
} from "@/play/modOptions";
import { OptionSelect } from "@/components/OptionSelect";

/** Start-position modes we expose (a subset of the engine's `StartPosType`). */
export const START_POS_OPTIONS = [
  { value: "0", label: "Fixed (map)" },
  { value: "2", label: "Choose in-game" },
  { value: "1", label: "Random" },
];

const startPosLabel = (v: number) =>
  START_POS_OPTIONS.find((o) => o.value === String(v))?.label ?? "Fixed";

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
 * Collapsible panel holding everything about the *game*: which game, the
 * start-position mode, and the game's mod options (rendered as checkboxes /
 * number / select / text inputs by type). Collapsed, its header shows a one-line
 * summary so the setup stays scannable.
 */
export function GameOptionsPanel({
  selectedGame,
  startPosType,
  onStartPosType,
  options,
  optionValues,
  onOptionChange,
  disabled,
}: {
  selectedGame?: GameItem | null;
  startPosType: number;
  onStartPosType: (v: number) => void;
  options: ConfigOption[];
  optionValues: Record<string, string>;
  onOptionChange: (key: string, value: string | undefined) => void;
  disabled?: boolean;
}) {
  const groups = groupOptions(options);
  const changed = options.filter((o) =>
    isChanged(o, optionValues[o.key]),
  ).length;
  const summary = [
    selectedGame?.name ?? "No game",
    startPosLabel(startPosType),
    changed > 0 ? `${changed} options changed` : "default options",
  ].join(" · ");

  return (
    <Collapsible
      defaultOpen
      className="rounded-lg border border-border/50 bg-card"
    >
      <CollapsibleTrigger className="group flex w-full items-center justify-between gap-3 rounded-lg px-4 py-3 text-left hover:bg-muted/30">
        <span className="flex min-w-0 items-baseline gap-3">
          <span className="text-sm font-semibold">Game options</span>
          <span className="truncate text-xs text-muted-foreground">
            {summary}
          </span>
        </span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="border-t border-border/40 px-4 pb-4 pt-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <span className="mb-1.5 block text-[11px] uppercase tracking-wide text-muted-foreground">
                Start positions
              </span>
              <OptionSelect
                value={String(startPosType)}
                disabled={disabled}
                options={START_POS_OPTIONS}
                onValueChange={(v) => onStartPosType(Number(v))}
              />
            </div>
          </div>

          {groups.length > 0 && (
            <>
              <div className="mb-2 mt-5 text-[11px] uppercase tracking-wide text-muted-foreground">
                Mod options
              </div>
              <div className="space-y-2">
                {groups.map((g) =>
                  g.name === undefined ? (
                    <OptionGrid
                      key={g.key}
                      group={g}
                      optionValues={optionValues}
                      disabled={disabled}
                      onOptionChange={onOptionChange}
                    />
                  ) : (
                    <OptionSection
                      key={g.key}
                      group={g}
                      optionValues={optionValues}
                      disabled={disabled}
                      onOptionChange={onOptionChange}
                    />
                  ),
                )}
              </div>
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
  optionValues: Record<string, string>;
  disabled?: boolean;
  onOptionChange: (key: string, value: string | undefined) => void;
}

/** A group's options in the two-column grid, with no header of their own. */
function OptionGrid({
  group,
  optionValues,
  disabled,
  onOptionChange,
}: GroupProps) {
  return (
    <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
      {group.options.map((o) => (
        <ModOptionField
          key={o.key}
          option={o}
          value={optionValues[o.key]}
          disabled={disabled}
          onChange={(v) => onOptionChange(o.key, v)}
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
  const { group, optionValues } = props;
  const changed = group.options.filter((o) =>
    isChanged(o, optionValues[o.key]),
  ).length;

  return (
    <Collapsible
      defaultOpen={changed > 0}
      className="rounded-md border border-border/40"
    >
      <CollapsibleTrigger className="group flex w-full items-center gap-2 rounded-md px-3 py-2 text-left hover:bg-muted/30">
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
      <CollapsibleContent>
        <div className="border-t border-border/40 px-3 pb-3 pt-2">
          <OptionGrid {...props} />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * Render one mod option as the control its type calls for. A section is a group
 * header rather than a setting, so it renders nothing here — callers that group
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

  if (o.type === "section") return null;

  if (o.type === "bool") {
    return (
      <label
        htmlFor={id}
        className="flex cursor-pointer items-center gap-2 py-1 text-sm"
        title={o.description ?? o.name}
      >
        <Checkbox
          id={id}
          checked={effective(o, value) === "1"}
          disabled={disabled}
          onCheckedChange={(v) => onChange(v === true ? "1" : "0")}
        />
        <span className="truncate">{o.name}</span>
      </label>
    );
  }

  if (o.type === "list" && o.listItems && o.listItems.length > 0) {
    return (
      <div>
        <span
          className="mb-1.5 block truncate text-xs text-muted-foreground"
          title={o.description ?? o.name}
        >
          {o.name}
        </span>
        <OptionSelect
          value={effective(o, value)}
          disabled={disabled}
          options={o.listItems.map((it) => ({ value: it.key, label: it.name }))}
          onValueChange={onChange}
        />
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
  // Held here rather than reported, so clearing the box writes nothing until
  // the edit is finished (and writes nothing at all if it never was).
  const [emptied, setEmptied] = useState(false);

  return (
    <Label htmlFor={id} className="block font-normal">
      <span
        className="mb-1.5 block truncate text-xs text-muted-foreground"
        title={o.description ?? o.name}
      >
        {o.name}
      </span>
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
  );
}
