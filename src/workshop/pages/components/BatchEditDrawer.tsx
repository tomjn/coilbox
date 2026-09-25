/**
 * One arithmetic change across every unit in a collection, with a
 * before-and-after preview before anything is written (issue #2655).
 *
 * A drawer, matching `CollectionsDrawer` and `WeaponLibraryDrawer`: the unit
 * being worked on stays where it was. Picking a collection first, then a
 * field (resolved the same way `searchQuery.ts` resolves one for a search or
 * a rule), then an operation and a rounding rule, builds the preview in
 * `batchEdit.ts`. Applying writes one override per unit whose value would
 * actually change, folded into the caller's own `updateOverrides`, so it
 * lands as one undo step regardless of how many units it touches.
 */
import { Button, Drawer, Input } from "@picoframe/frame";
import { Sigma } from "lucide-react";
import { useMemo, useState } from "react";
import { Field } from "@/components/Field";
import { OptionSelect } from "@/components/OptionSelect";
import {
  type BatchOperation,
  type BatchRounding,
  type BatchRow,
  batchChangeCount,
  computeBatchRows,
} from "../../batchEdit";
import { type PostChange, postNoteOf } from "../../beforePost";
import type { UnitClones } from "../../clones";
import {
  type Collections,
  collectionTree,
  collectionUnits,
} from "../../collections";
import type { UnitOverrides } from "../../overrides";
import { resolveField } from "../../searchQuery";
import type { EquippedWeapons, WeaponLibrary } from "../../weaponLibrary";

/** How many preview rows are drawn before asking to narrow the collection
 *  instead. Mirrors `CollectionsDrawer`'s `SHOWN`: the apply button still acts
 *  on every unit the collection names, this only caps what is rendered. */
const SHOWN_ROWS = 300;

const OPERATION_KINDS = [
  { value: "multiply", label: "Multiply by" },
  { value: "offset", label: "Add" },
];

const ROUNDING_KINDS = [
  { value: "none", label: "No rounding" },
  { value: "integer", label: "Nearest whole number" },
  { value: "nearest", label: "Nearest multiple of…" },
];

function skipLabel(row: BatchRow): string {
  return row.skipped === "missing" ? "No such field" : "Not a number";
}

export function BatchEditDrawer({
  open,
  onOpenChange,
  collections,
  units,
  overrides,
  nameOf,
  beforePost,
  onApply,
  weaponDefs,
  library,
  equipped,
  clones,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  collections: Collections;
  /** The game's units with the project's own clones already in among them,
   *  the same table `UnitList` and `CollectionsDrawer` take. */
  units: Record<string, Record<string, unknown>>;
  overrides: UnitOverrides;
  nameOf: (key: string, def: Record<string, unknown>) => string;
  /** What the game's post files change per unit (issue #3057), for the note
   *  beside an affected field. Absent when the game's read has not said. */
  beforePost?: { units: Record<string, PostChange> };
  /** Apply every row that would change, folded into the caller's own
   *  `updateOverrides` so it counts as one undo step. */
  onApply: (rows: BatchRow[]) => void;
  /** The game's own weapon table, the project's weapon library and what is
   *  equipped where (issue #3085), so a collection's rule can match a
   *  `derivedStats.ts` number the same way `UnitPage`'s own filter does. */
  weaponDefs: Record<string, Record<string, unknown>>;
  library: WeaponLibrary;
  equipped: EquippedWeapons;
  clones: UnitClones;
}) {
  const [collectionId, setCollectionId] = useState("");
  const [fieldInput, setFieldInput] = useState("");
  const [opKind, setOpKind] = useState<"multiply" | "offset">("multiply");
  const [opValue, setOpValue] = useState("");
  const [roundingKind, setRoundingKind] = useState<
    "none" | "integer" | "nearest"
  >("none");
  const [roundingStep, setRoundingStep] = useState("");

  const tree = useMemo(() => collectionTree(collections), [collections]);
  const live = useMemo(
    () => ({
      units,
      overrides,
      weapons: { weaponDefs, library, equipped, clones },
    }),
    [units, overrides, weaponDefs, library, equipped, clones],
  );
  const unitSet = collectionId
    ? collectionUnits(collections, collectionId, live)
    : undefined;
  const unitKeys = useMemo(
    () =>
      unitSet
        ? [...unitSet].sort((a, b) =>
            nameOf(a, units[a] ?? {}).localeCompare(nameOf(b, units[b] ?? {})),
          )
        : [],
    [unitSet, units, nameOf],
  );

  const trimmedField = fieldInput.trim();
  const fieldResult = trimmedField ? resolveField(trimmedField) : undefined;

  const factor = Number(opValue);
  const operationValid = opValue.trim() !== "" && Number.isFinite(factor);
  const operation: BatchOperation | undefined = !operationValid
    ? undefined
    : opKind === "multiply"
      ? { kind: "multiply", factor }
      : { kind: "offset", amount: factor };

  const step = Number(roundingStep);
  const rounding: BatchRounding | undefined =
    roundingKind === "none"
      ? { kind: "none" }
      : roundingKind === "integer"
        ? { kind: "integer" }
        : roundingStep.trim() !== "" && Number.isFinite(step) && step > 0
          ? { kind: "nearest", step }
          : undefined;

  const rows: BatchRow[] =
    fieldResult?.ok && operation && rounding && unitKeys.length > 0
      ? computeBatchRows(
          unitKeys,
          fieldResult.keys,
          units,
          overrides,
          operation,
          rounding,
        )
      : [];
  const changeCount = batchChangeCount(rows);

  const apply = () => {
    if (changeCount === 0) return;
    onApply(rows);
    onOpenChange(false);
  };

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title="Batch edit"
      description="One arithmetic change across every unit in a collection, previewed before it writes anything."
      width="36rem"
    >
      <div className="flex flex-col gap-6">
        {tree.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No collections yet. Create one from the Collections button first,
            then come back here to pick it.
          </p>
        ) : (
          <>
            <Field label="Collection">
              <OptionSelect
                value={collectionId}
                onValueChange={setCollectionId}
                options={tree.map(({ collection, depth }) => ({
                  value: collection.id,
                  label: `${"— ".repeat(depth)}${collection.name}`,
                }))}
                placeholder="Pick a collection"
                size="sm"
                ariaLabel="Collection"
              />
            </Field>

            <Field
              label="Field"
              hint="A field name, the same as the search box: hp, speed, cost, metal, energy, buildtime, los, or a unit field's own name."
            >
              <Input
                value={fieldInput}
                onChange={(e) => setFieldInput(e.target.value)}
                placeholder="e.g. cost"
                className="h-8 font-mono text-xs"
                autoComplete="off"
                spellCheck={false}
              />
            </Field>
            {fieldResult && !fieldResult.ok && (
              <p className="text-xs text-destructive">{fieldResult.error}</p>
            )}

            <div className="flex gap-2">
              <Field label="Operation" className="flex-1">
                <OptionSelect
                  value={opKind}
                  onValueChange={(v) => setOpKind(v as "multiply" | "offset")}
                  options={OPERATION_KINDS}
                  size="sm"
                  ariaLabel="Operation"
                />
              </Field>
              <Field label="Value" className="w-28">
                <Input
                  type="number"
                  value={opValue}
                  onChange={(e) => setOpValue(e.target.value)}
                  placeholder={opKind === "multiply" ? "0.9" : "-20"}
                  className="h-8"
                />
              </Field>
            </div>

            <div className="flex gap-2">
              <Field label="Rounding" className="flex-1">
                <OptionSelect
                  value={roundingKind}
                  onValueChange={(v) =>
                    setRoundingKind(v as "none" | "integer" | "nearest")
                  }
                  options={ROUNDING_KINDS}
                  size="sm"
                  ariaLabel="Rounding"
                />
              </Field>
              {roundingKind === "nearest" && (
                <Field label="Step" className="w-28">
                  <Input
                    type="number"
                    value={roundingStep}
                    onChange={(e) => setRoundingStep(e.target.value)}
                    placeholder="5"
                    className="h-8"
                  />
                </Field>
              )}
            </div>

            {collectionId && unitKeys.length === 0 && (
              <p className="text-sm text-muted-foreground">
                This collection has no units.
              </p>
            )}

            {rows.length > 0 && (
              <section className="flex flex-col gap-2 border-t border-border/60 pt-4">
                <h3 className="text-sm font-medium">
                  Preview{" "}
                  <span className="text-xs font-normal text-muted-foreground">
                    {changeCount} of {rows.length} unit
                    {rows.length === 1 ? "" : "s"} change
                  </span>
                </h3>
                <ul className="flex max-h-72 flex-col gap-0.5 overflow-y-auto rounded-md border border-border/60 p-1 text-sm">
                  {rows.slice(0, SHOWN_ROWS).map((row) => {
                    const note =
                      row.path !== undefined && beforePost
                        ? postNoteOf(
                            beforePost.units[row.unit],
                            row.path,
                            units[row.unit],
                          )
                        : undefined;
                    return (
                      <li
                        key={row.unit}
                        className="flex items-center justify-between gap-2 rounded px-2 py-1"
                      >
                        <span className="min-w-0 truncate">
                          {nameOf(row.unit, units[row.unit] ?? {})}
                        </span>
                        {row.skipped ? (
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {skipLabel(row)}
                          </span>
                        ) : (
                          <span className="shrink-0 font-mono text-xs">
                            {row.before} {"→"} {row.after}
                            {!row.changed && (
                              <span className="ml-1 text-muted-foreground">
                                (unchanged)
                              </span>
                            )}
                            {note && (
                              <span
                                className="ml-1 text-muted-foreground"
                                title="The game's post files may change this field again as it loads."
                              >
                                *
                              </span>
                            )}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
                {rows.length > SHOWN_ROWS && (
                  <p className="text-xs text-muted-foreground">
                    Showing the first {SHOWN_ROWS} of {rows.length} units. All
                    of them still apply.
                  </p>
                )}
              </section>
            )}

            <Button
              onClick={apply}
              disabled={changeCount === 0}
              title={
                changeCount === 0
                  ? "Pick a collection, a field and an operation that changes at least one unit"
                  : undefined
              }
            >
              <Sigma className="mr-1 size-3.5" />
              Apply to {changeCount} unit{changeCount === 1 ? "" : "s"}
            </Button>
          </>
        )}
      </div>
    </Drawer>
  );
}
