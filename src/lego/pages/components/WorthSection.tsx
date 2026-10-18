/**
 * What the unit is worth: its totals, and the table that sets them (issue
 * #3280). The builder has no editor for one unit's health or cost. Those come
 * from this table, and a number for one unit is changed on the workshop's unit
 * page. See `worth.ts` for how the totals are worked out.
 */

import { Button, Input, useSetting } from "@picoframe/frame";
import { formatNumber } from "@/lib/format";
import type { LegoProject } from "../../model";
import type { LoadedPack } from "../../pack";
import {
  effectiveWorth,
  type LegoWorth,
  parseWorth,
  usedShapes,
  WORTH_FIELDS,
  type WorthAmounts,
  type WorthField,
  worthTotals,
} from "../../worth";

const LABEL: Record<WorthField, string> = {
  health: "Health",
  metal: "Metal",
  energy: "Energy",
  buildTime: "Build time",
  mass: "Mass",
};

interface Props {
  project: LegoProject;
  pack: LoadedPack;
  onWorthChange: (worth: LegoWorth) => void;
}

/** A typed amount, or null when it is blank or not a usable number. */
function typed(text: string): number | null {
  if (text.trim() === "") return null;
  const value = Number(text);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function capital(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function WorthSection({ project, pack, onWorthChange }: Props) {
  // Shared between units through an app setting, because the table itself lives
  // on each unit so an export needs nothing from outside the document.
  const [stored, setStored] = useSetting<LegoWorth | null>(
    "lego.worthTable",
    null,
  );
  const savedTable = parseWorth(stored);
  const table = effectiveWorth(project);
  const totals = worthTotals(project, pack);
  const shapes = usedShapes(project, pack);

  function setRow(row: "base" | "perVolume", field: WorthField, text: string) {
    const next: WorthAmounts = {
      ...table[row],
      [field]: typed(text) ?? 0,
    };
    onWorthChange({ ...table, [row]: next });
  }

  function setShape(shape: string, field: WorthField, text: string) {
    const { [field]: _old, ...rest } = table.shapes?.[shape] ?? {};
    const value = typed(text);
    const entry = value === null ? rest : { ...rest, [field]: value };
    const { [shape]: _gone, ...others } = table.shapes ?? {};
    const shapesNext =
      Object.keys(entry).length > 0 ? { ...others, [shape]: entry } : others;
    const { shapes: _shapes, ...withoutShapes } = table;
    onWorthChange(
      Object.keys(shapesNext).length > 0
        ? { ...withoutShapes, shapes: shapesNext }
        : withoutShapes,
    );
  }

  return (
    <div className="flex flex-col gap-2 border-b border-border/60 px-3 py-2">
      <p className="text-sm font-medium">Worth</p>
      {totals ? (
        <dl className="grid grid-cols-5 gap-1 text-xs tabular-nums">
          {WORTH_FIELDS.map((field) => (
            <div key={field} className="min-w-0">
              <dt className="truncate text-muted-foreground">{LABEL[field]}</dt>
              <dd>
                <output aria-label={`Total ${LABEL[field].toLowerCase()}`}>
                  {formatNumber(totals[field])}
                </output>
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-xs text-muted-foreground">
          This unit has no parts, so there is nothing to total.
        </p>
      )}
      {!project.worth ? (
        <p className="text-xs text-muted-foreground">
          Placeholder amounts. Set your game's.
        </p>
      ) : null}

      {totals ? (
        <>
          <WorthRow
            label="Per unit"
            amounts={table.base}
            onChange={(field, text) => setRow("base", field, text)}
          />
          <WorthRow
            label="Per volume"
            amounts={table.perVolume}
            onChange={(field, text) => setRow("perVolume", field, text)}
          />
          {shapes.map((shape) => (
            <WorthRow
              key={shape}
              label={capital(shape)}
              amounts={table.shapes?.[shape] ?? {}}
              fallback={table.perVolume}
              onChange={(field, text) => setShape(shape, field, text)}
            />
          ))}
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setStored(table)}
              title="Keep this table to use on other units"
            >
              Save table
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!savedTable}
              onClick={() => savedTable && onWorthChange(savedTable)}
              title="Replace this unit's table with the saved one"
            >
              Use saved table
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}

function WorthRow({
  label,
  amounts,
  fallback,
  onChange,
}: {
  label: string;
  amounts: Partial<WorthAmounts>;
  /** Shown as the hint where a shape leaves a field to the per volume rate. */
  fallback?: WorthAmounts;
  onChange: (field: WorthField, text: string) => void;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="grid grid-cols-5 gap-1">
        {WORTH_FIELDS.map((field) => (
          <Input
            key={field}
            type="number"
            min={0}
            step="any"
            className="h-7 px-1 text-xs"
            aria-label={`${label} ${LABEL[field].toLowerCase()}`}
            placeholder={fallback ? String(fallback[field]) : undefined}
            title={LABEL[field]}
            value={amounts[field] ?? ""}
            onChange={(event) => onChange(field, event.target.value)}
          />
        ))}
      </div>
    </div>
  );
}
