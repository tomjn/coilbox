import { Input } from "@picoframe/frame";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import type { ConfigOption, GameItem } from "@/content/bindings";
import { cn } from "@/lib/utils";
import { OptionSelect } from "@/uberstress/pages/components/OptionSelect";

/** Start-position modes we expose (a subset of the engine's `StartPosType`). */
export const START_POS_OPTIONS = [
  { value: "0", label: "Fixed (map)" },
  { value: "2", label: "Choose in-game" },
  { value: "1", label: "Random" },
];

const startPosLabel = (v: number) =>
  START_POS_OPTIONS.find((o) => o.value === String(v))?.label ?? "Fixed";

/** The value in effect for an option: the user's override, else its default. */
const effective = (o: ConfigOption, value?: string) => value ?? o.default ?? "";

/** Whether the user has overridden an option away from its default. */
const isChanged = (o: ConfigOption, value?: string) =>
  value !== undefined && value !== (o.default ?? "");

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
  onOptionChange: (key: string, value: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(true);
  const changed = options.filter((o) =>
    isChanged(o, optionValues[o.key]),
  ).length;
  const summary = [
    selectedGame?.name ?? "No game",
    startPosLabel(startPosType),
    changed > 0 ? `${changed} options changed` : "default options",
  ].join(" · ");

  return (
    <div className="rounded-lg border border-border/50 bg-card">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 rounded-lg px-4 py-3 text-left hover:bg-muted/30"
      >
        <span className="flex min-w-0 items-baseline gap-3">
          <span className="text-sm font-semibold">Game options</span>
          <span className="truncate text-xs text-muted-foreground">
            {summary}
          </span>
        </span>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
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

          {options.length > 0 && (
            <>
              <div className="mb-2 mt-5 text-[11px] uppercase tracking-wide text-muted-foreground">
                Mod options
              </div>
              <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
                {options.map((o) => (
                  <ModOptionField
                    key={o.key}
                    option={o}
                    value={optionValues[o.key]}
                    disabled={disabled}
                    onChange={(v) => onOptionChange(o.key, v)}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Render one mod option as the control its type calls for. */
function ModOptionField({
  option: o,
  value,
  disabled,
  onChange,
}: {
  option: ConfigOption;
  value?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const id = `modopt-${o.key}`;

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

  const isNumber = o.type === "number";
  return (
    <label htmlFor={id} className="block">
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
        value={value ?? ""}
        placeholder={o.default}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
