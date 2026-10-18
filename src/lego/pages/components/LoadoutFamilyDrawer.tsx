/**
 * Every loadout of the chassis side by side (issue #3283): a picture, the name
 * and the export name at the head of each column, then what sits on each mount
 * point and the stats. Rows where the loadouts differ are marked. Rows that are
 * the same everywhere are hidden behind a switch, with their count beside it.
 *
 * The pictures are the ones the picker took of each loadout while it was on the
 * chassis, not live 3D, so a loadout nobody has opened yet has none.
 * Clicking a column's head makes that loadout the active one.
 */

import { Button } from "@picoframe/frame";
import { X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useState } from "react";

import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { type FamilyRow, loadoutFamily } from "../../loadoutFamily";
import type { LegoProject } from "../../model";
import type { LoadedPack } from "../../pack";
import type { RawGeometry } from "../../rawGeometry";
import { unitBounds } from "../../s3oBuild";
import { legoUnitDef } from "../../unitDef";
import { unitStats } from "../../unitStats";
import {
  mountedWeapons,
  pickedWeapon,
  weaponExportPlan,
} from "../../weaponModule";
import { worthTotals } from "../../worth";
import { useWeaponSource, type WeaponSource } from "./WeaponsSection";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: LegoProject;
  /** Absent until the library has loaded, which leaves the stats out. */
  pack: LoadedPack | null;
  raw: RawGeometry | null;
  /** A picture of each loadout by id, as a data URL. */
  pictures: Record<string, string>;
  onSwitch: (id: string) => void;
}

/**
 * The stats of one loadout, read as the next export of it would write them. A
 * field kept because the game's file was edited by hand is not followed, which
 * the stats panel does for the unit on screen.
 */
function statsOf(
  unit: LegoProject,
  pack: LoadedPack,
  raw: RawGeometry | null,
  source: WeaponSource,
) {
  const def = legoUnitDef(
    unit,
    unitBounds(unit, pack, raw),
    "def",
    worthTotals(unit, pack),
    weaponExportPlan(unit, source.projects).slots,
  );
  const weapons = mountedWeapons(unit).flatMap(({ fires }) => {
    const picked = pickedWeapon(
      fires,
      source.gameName ?? "",
      source.weaponDefs,
      source.projects,
    );
    return picked && "def" in picked ? [{ def: picked.def }] : [];
  });
  return unitStats(def, weapons);
}

export function LoadoutFamilyDrawer(props: Props) {
  return (
    <DialogPrimitive.Root open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/55 backdrop-blur-[1px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed inset-y-0 right-0 z-50 flex w-[820px] max-w-[96vw] flex-col border-l border-border bg-background shadow-xl duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right"
        >
          <div className="flex items-center justify-between border-b border-border/60 px-5 py-4">
            <DialogPrimitive.Title className="text-base font-semibold">
              Compare loadouts
            </DialogPrimitive.Title>
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Close">
                <X className="size-4" />
              </Button>
            </DialogPrimitive.Close>
          </div>
          <FamilyTable {...props} />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function FamilyTable({ project, pack, raw, pictures, onSwitch }: Props) {
  const source = useWeaponSource(project);
  const [showSame, setShowSame] = useState(false);
  const family = loadoutFamily(project, (unit) =>
    pack ? statsOf(unit, pack, raw, source) : null,
  );
  if (!family) return null;

  const same = family.rows.filter((row) => !row.differs);
  const shown = family.rows.filter((row) => row.differs || showSame);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 px-5 pt-4 pb-6">
      <div className="flex items-center gap-2">
        <Checkbox
          id="lego-family-same"
          checked={showSame}
          onCheckedChange={(checked) => setShowSame(checked === true)}
        />
        <Label htmlFor="lego-family-same">
          Show {same.length} identical {same.length === 1 ? "row" : "rows"}
        </Label>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-xs tabular-nums">
          <thead>
            <tr>
              <td />
              {family.columns.map((column) => (
                <th
                  key={column.id}
                  scope="col"
                  className="min-w-36 p-1 align-top font-normal"
                >
                  <button
                    type="button"
                    onClick={() => onSwitch(column.id)}
                    aria-label={`Switch to ${column.name}`}
                    aria-current={column.active ? "true" : undefined}
                    className={cn(
                      "flex w-full flex-col items-center gap-1 rounded-md border p-2 text-center hover:bg-accent",
                      column.active ? "border-primary" : "border-border",
                    )}
                  >
                    <span className="flex size-24 items-center justify-center overflow-hidden rounded bg-muted/40">
                      {pictures[column.id] ? (
                        <img
                          src={pictures[column.id]}
                          alt=""
                          className="max-h-full max-w-full object-contain"
                        />
                      ) : (
                        <span className="px-1 text-muted-foreground">
                          Not opened yet
                        </span>
                      )}
                    </span>
                    <span className="max-w-full truncate text-sm font-medium">
                      {column.name}
                    </span>
                    <span className="max-w-full truncate text-muted-foreground">
                      {column.exportName}
                    </span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 ? (
              <tr>
                <td
                  colSpan={family.columns.length + 1}
                  className="p-3 text-muted-foreground"
                >
                  These loadouts are the same.
                </td>
              </tr>
            ) : (
              shown.map((row) => <Row key={row.id} row={row} />)
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Row({ row }: { row: FamilyRow }) {
  return (
    <tr
      data-differs={row.differs ? "true" : undefined}
      className={cn("border-t border-border/60", row.differs && "bg-accent/50")}
    >
      <th
        scope="row"
        className="p-1.5 text-left font-normal text-muted-foreground"
      >
        {row.label}
      </th>
      {row.cells.map((cell, index) => (
        // Columns never reorder, so the position names the cell.
        // biome-ignore lint/suspicious/noArrayIndexKey: see above
        <td key={index} className="p-1.5 text-center">
          <span className={cn(row.differs && "font-medium")}>
            {cell ?? <span className="text-muted-foreground">None</span>}
          </span>
          {row.highest?.includes(index) ? (
            <span className="ml-1 text-muted-foreground">highest</span>
          ) : null}
          {row.lowest?.includes(index) ? (
            <span className="ml-1 text-muted-foreground">lowest</span>
          ) : null}
        </td>
      ))}
    </tr>
  );
}
