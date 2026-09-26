/**
 * Cmd+K (Ctrl+K on Windows and Linux) inside an open tweak project (issue
 * #3118): jump straight to a unit, a field, a section or an action, rather
 * than searching the unit list, opening the unit, switching tabs and
 * scrolling to find one field among a unit's couple of hundred.
 *
 * `cmdk`, wrapped by `src/components/ui/command.tsx`, does the list and the
 * keyboard handling. What is worth showing for a given query is this file's
 * own job, done with `shouldFilter={false}` so cmdk draws exactly the
 * results {@link buildResults} returns rather than fuzzy-matching them again.
 *
 * A query is read three ways at once:
 *
 * - As a field search against the unit already open, so a single word like
 *   "range" finds it there first.
 * - As a unit name or key, through `searchQuery.ts`'s own predicate parser
 *   (issue #2656), the same one the unit list searches with.
 * - As "<unit> <field>" in one query (issue #3118's own "zeus range"): every
 *   split of the typed words into a leading unit phrase and a trailing field
 *   phrase is tried, longest unit phrase first, and the first split that
 *   matches a unit and finds a field under it wins. This is not a full
 *   cross-product search of every unit's every field for every keystroke,
 *   which would be several hundred units times a couple of hundred fields
 *   apiece. A field is only ever resolved for a unit the split has already
 *   matched by name.
 *
 * Choosing a field or a unit reuses `projectPath` (`routes.ts`), the same
 * link the Changes and Checks pages already build. `UnitPage.tsx` scrolls to
 * a `?field=` link's row and now focuses its control too, and forces the row
 * into view even where the Relevant filter would otherwise hide it (issue
 * #3118 extends `unitFieldView`'s and `weaponSlots.ts`'s own `always` field
 * for exactly this).
 */
import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { UnitOverrides } from "../../overrides";
import {
  PROJECT_SECTIONS,
  projectPath,
  referencePath,
  sectionPath,
} from "../../routes";
import { evaluateUnitQuery, parseUnitQuery } from "../../searchQuery";
import { unitFieldView } from "../../unitSections";
import { weaponSlots, weaponSlotView } from "../../weaponSlots";

/** One field found under a unit, for the "Fields" group. */
interface FieldHit {
  path: string;
  label: string;
}

type PaletteResult =
  | { kind: "field"; unitKey: string; unitLabel: string; hit: FieldHit }
  | { kind: "unit"; key: string; label: string }
  | {
      kind: "section";
      id: (typeof PROJECT_SECTIONS)[number]["id"];
      label: string;
    }
  | { kind: "reference" }
  | { kind: "test" };

/** How many unit matches a "<unit> <field>" split resolves fields for.
 *  A query that names something as common as "arm" would otherwise walk
 *  every Armada unit's field list for the sake of one that meant it. */
const MAX_UNITS_PER_SPLIT = 6;
/** How many rows the palette draws at once. cmdk scrolls a long list fine,
 *  this is only about not resolving fields for hundreds of stray matches. */
const RESULT_CAP = 40;

/** Every field `unitFieldView` and the weapons tab would draw for one unit,
 *  in the "all" view so a field the Relevant filter would hide is still
 *  found (issue #3118: opening it is what pulls it back into view). Read off
 *  the game's own def, so a unit's clone or override state does not change
 *  which fields exist to search, only what they currently hold. */
function fieldsOf(
  key: string,
  def: Record<string, unknown> | undefined,
  overrides: UnitOverrides,
  weaponDefs: Record<string, Record<string, unknown>>,
  unitName: string,
): FieldHit[] {
  const own = unitFieldView(def, overrides, key, "all", []);
  const ownRows = own.groups.flatMap((g) => g.sections.flatMap((s) => s.rows));
  const slots = weaponSlots(def, weaponDefs, [key]);
  const weaponRows = slots.flatMap((slot) => {
    const view = weaponSlotView(slot, overrides, key, "all", unitName);
    return view.groups.flatMap((g) => g.sections.flatMap((s) => s.rows));
  });
  return [...ownRows, ...weaponRows].map((r) => ({
    path: r.path,
    label: r.label,
  }));
}

/** What the palette searches over: units, and their fields, read lazily and
 *  cached per unit key, since building a unit's field list is not free and a
 *  keystroke should not redo it for every unit the query already matched. */
interface PaletteContext {
  units: Record<string, Record<string, unknown>>;
  overrides: UnitOverrides;
  weaponDefs: Record<string, Record<string, unknown>>;
  nameOf: (key: string, def: Record<string, unknown> | undefined) => string;
  currentUnitKey: string;
}

/**
 * How well a field matches a typed phrase, lower is better, `undefined` for
 * no match at all. A registry of a couple of hundred fields per unit has
 * several whose label merely mentions the typed word ("Radar range" also
 * contains "range"), so an exact label match is worth ranking ahead of one
 * that only contains the word, which is what puts "zeus range" (issue
 * #3118) on the field actually called Range rather than one beside it.
 */
function scoreField(hit: FieldHit, needle: string): number | undefined {
  const label = hit.label.toLowerCase();
  const path = hit.path.toLowerCase();
  const lower = needle.toLowerCase();
  if (label === lower || path === lower) return 0;
  if (label.startsWith(lower) || path.endsWith(`.${lower}`)) return 1;
  if (label.includes(lower) || path.includes(lower)) return 2;
  return undefined;
}

/** `fields`, kept to the ones matching `needle` and ordered best match
 *  first. */
function rankedFields(fields: FieldHit[], needle: string): FieldHit[] {
  return fields
    .map((hit) => ({ hit, score: scoreField(hit, needle) }))
    .filter(
      (scored): scored is { hit: FieldHit; score: number } =>
        scored.score !== undefined,
    )
    .sort((a, b) => a.score - b.score)
    .map((scored) => scored.hit);
}

function buildResults(
  query: string,
  ctx: PaletteContext,
  fieldCache: Map<string, FieldHit[]>,
): PaletteResult[] {
  const trimmed = query.trim();
  const results: PaletteResult[] = [];
  const seen = new Set<string>();
  const push = (result: PaletteResult, dedupeKey: string) => {
    if (seen.has(dedupeKey) || results.length >= RESULT_CAP) return;
    seen.add(dedupeKey);
    results.push(result);
  };
  const cachedFieldsOf = (key: string): FieldHit[] => {
    const cached = fieldCache.get(key);
    if (cached) return cached;
    const def = ctx.units[key];
    const built = fieldsOf(
      key,
      def,
      ctx.overrides,
      ctx.weaponDefs,
      ctx.nameOf(key, def),
    );
    fieldCache.set(key, built);
    return built;
  };

  if (!trimmed) {
    for (const section of PROJECT_SECTIONS)
      push(
        { kind: "section", id: section.id, label: section.label },
        `s:${section.id}`,
      );
    push({ kind: "reference" }, "reference");
    push({ kind: "test" }, "test");
    return results;
  }

  // The unit already open: a bare field word like "range" finds it there
  // before anything else, which is the common case of tweaking the unit you
  // are already looking at.
  if (ctx.currentUnitKey && ctx.units[ctx.currentUnitKey]) {
    const unitLabel = ctx.nameOf(
      ctx.currentUnitKey,
      ctx.units[ctx.currentUnitKey],
    );
    for (const hit of rankedFields(cachedFieldsOf(ctx.currentUnitKey), trimmed))
      push(
        { kind: "field", unitKey: ctx.currentUnitKey, unitLabel, hit },
        `f:${ctx.currentUnitKey}:${hit.path}`,
      );
  }

  // The whole query as a unit name or key, through the same predicate parser
  // the unit list searches with (issue #2656).
  const wholeQuery = parseUnitQuery(trimmed);
  if (wholeQuery.ok) {
    for (const [key, def] of Object.entries(ctx.units)) {
      if (
        evaluateUnitQuery(wholeQuery.query, {
          key,
          name: ctx.nameOf(key, def),
          def,
        })
      )
        push({ kind: "unit", key, label: ctx.nameOf(key, def) }, `u:${key}`);
    }
  }

  // "<unit> <field>" in one query (issue #3118's "zeus range"): every split
  // of the typed words, longest leading unit phrase first, stopping at the
  // first split that both names a unit and finds a field under it.
  const words = trimmed.split(/\s+/).filter(Boolean);
  for (let split = words.length - 1; split >= 1; split--) {
    const unitPart = words.slice(0, split).join(" ");
    const fieldPart = words.slice(split).join(" ");
    const parsedUnit = parseUnitQuery(unitPart);
    if (!parsedUnit.ok) continue;
    const matchedUnits = Object.entries(ctx.units)
      .filter(([key, def]) =>
        evaluateUnitQuery(parsedUnit.query, {
          key,
          name: ctx.nameOf(key, def),
          def,
        }),
      )
      .slice(0, MAX_UNITS_PER_SPLIT);
    if (matchedUnits.length === 0) continue;
    let foundAny = false;
    for (const [key, def] of matchedUnits) {
      const unitLabel = ctx.nameOf(key, def);
      for (const hit of rankedFields(cachedFieldsOf(key), fieldPart)) {
        push(
          { kind: "field", unitKey: key, unitLabel, hit },
          `f:${key}:${hit.path}`,
        );
        foundAny = true;
      }
    }
    if (foundAny) break;
  }

  const lower = trimmed.toLowerCase();
  for (const section of PROJECT_SECTIONS)
    if (section.label.toLowerCase().includes(lower))
      push(
        { kind: "section", id: section.id, label: section.label },
        `s:${section.id}`,
      );
  if ("reference".includes(lower)) push({ kind: "reference" }, "reference");
  if ("test".includes(lower)) push({ kind: "test" }, "test");

  return results;
}

export function CommandPalette({
  open,
  onOpenChange,
  projectId,
  units,
  overrides,
  weaponDefs,
  nameOf,
  currentUnitKey,
  onRequestTest,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  units: Record<string, Record<string, unknown>>;
  overrides: UnitOverrides;
  weaponDefs: Record<string, Record<string, unknown>>;
  nameOf: (key: string, def: Record<string, unknown> | undefined) => string;
  currentUnitKey: string;
  /** Run the Test action (issue #3118): the palette itself has no drawer of
   *  its own to open, `PlayLocallyButton` already carries that. */
  onRequestTest: () => void;
}) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  // A unit's fields, once read, are kept for as long as the palette stays
  // mounted rather than re-read on every keystroke that still names it.
  const fieldCache = useRef(new Map<string, FieldHit[]>());

  const ctx: PaletteContext = useMemo(
    () => ({ units, overrides, weaponDefs, nameOf, currentUnitKey }),
    [units, overrides, weaponDefs, nameOf, currentUnitKey],
  );
  const results = useMemo(
    () => buildResults(query, ctx, fieldCache.current),
    [query, ctx],
  );
  const fields = results.filter(
    (r): r is Extract<PaletteResult, { kind: "field" }> => r.kind === "field",
  );
  const unitResults = results.filter(
    (r): r is Extract<PaletteResult, { kind: "unit" }> => r.kind === "unit",
  );
  const sections = results.filter(
    (r): r is Extract<PaletteResult, { kind: "section" }> =>
      r.kind === "section",
  );
  const actions = results.filter(
    (r): r is Extract<PaletteResult, { kind: "reference" | "test" }> =>
      r.kind === "reference" || r.kind === "test",
  );

  const runResult = (result: PaletteResult) => {
    onOpenChange(false);
    setQuery("");
    switch (result.kind) {
      case "unit":
        navigate(projectPath(projectId, result.key));
        break;
      case "field":
        navigate(projectPath(projectId, result.unitKey, result.hit.path));
        break;
      case "section":
        navigate(sectionPath(projectId, result.id));
        break;
      case "reference":
        navigate(referencePath(projectId));
        break;
      case "test":
        onRequestTest();
        break;
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setQuery("");
      }}
    >
      <DialogHeader className="sr-only">
        <DialogTitle>Command palette</DialogTitle>
        <DialogDescription>
          Jump to a unit, a field, a section or an action
        </DialogDescription>
      </DialogHeader>
      <DialogContent className="overflow-hidden p-0">
        {/* `shouldFilter={false}`: `buildResults` has already decided what
          matches the query, so cmdk's own fuzzy filter, which would score
          against each item's `value` rather than the label on screen, would
          only hide results a second time for the wrong reason. */}
        <Command
          shouldFilter={false}
          className="**:data-[slot=command-input-wrapper]:h-12 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group]]:px-2 [&_[cmdk-group]:not([hidden])_~[cmdk-group]]:pt-0 [&_[cmdk-input-wrapper]_svg]:h-5 [&_[cmdk-input-wrapper]_svg]:w-5 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-3 [&_[cmdk-item]_svg]:h-5 [&_[cmdk-item]_svg]:w-5"
        >
          <CommandInput
            placeholder="Jump to a unit, a field ('zeus range'), a section or an action..."
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            <CommandEmpty>Nothing found.</CommandEmpty>
            {fields.length > 0 && (
              <CommandGroup heading="Fields">
                {fields.map((r) => (
                  <CommandItem
                    key={`f:${r.unitKey}:${r.hit.path}`}
                    value={`f:${r.unitKey}:${r.hit.path}`}
                    onSelect={() => runResult(r)}
                  >
                    {r.unitLabel}
                    <span className="text-muted-foreground">
                      {" "}
                      &rsaquo; {r.hit.label}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {unitResults.length > 0 && (
              <CommandGroup heading="Units">
                {unitResults.map((r) => (
                  <CommandItem
                    key={`u:${r.key}`}
                    value={`u:${r.key}`}
                    onSelect={() => runResult(r)}
                  >
                    {r.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {sections.length > 0 && (
              <CommandGroup heading="Sections">
                {sections.map((r) => (
                  <CommandItem
                    key={`s:${r.id}`}
                    value={`s:${r.id}`}
                    onSelect={() => runResult(r)}
                  >
                    {r.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {actions.length > 0 && (
              <CommandGroup heading="Actions">
                {actions.map((r) => (
                  <CommandItem
                    key={r.kind}
                    value={r.kind}
                    onSelect={() => runResult(r)}
                  >
                    {r.kind === "reference" ? "Reference" : "Test"}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
