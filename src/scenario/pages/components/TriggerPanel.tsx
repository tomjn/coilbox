/**
 * The trigger panel: the list of triggers, and the form for the one selected.
 *
 * A trigger is the mission's logic, so this is where a scenario stops being a
 * pile of units and starts being a mission. What it holds is a flat list of
 * conditions under one all-or-any, and a list of actions in the order they run.
 * There is no nesting inside the conditions, because triggers that enable and
 * disable other triggers already make the flat list a state machine, and that
 * reads better than a boolean tree.
 *
 * A trigger has an id nothing renames and a name the author edits (issue #2205).
 * `enable_trigger` points at the id and so does the selection here, so renaming
 * one rewrites nothing and this panel never has to work out which trigger a name
 * belongs to.
 *
 * The document is never held here. Every edit goes out through `onChange` and
 * comes back as a new `scenario`, the way the map scene works.
 */

import { Button, Input } from "@picoframe/frame";
import { ArrowDown, ArrowUp, Plus, Trash2, Zap } from "lucide-react";
import { useMemo, useState } from "react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { UnitDatasetEntry } from "@/content/bindings";
import { useFieldText } from "@/lib/useFieldText";
import { OptionSelect } from "@/uberstress/pages/components/OptionSelect";
import type { ExtensionTypes } from "../../extensions";
import type { PaletteGate } from "../../gating";
import type { Scenario, ScenarioTrigger } from "../../model";
import { DifficultyRangeFields } from "./DifficultyRangeFields";
import { EditorPanel } from "./panels";
import { AddStep, StepRow } from "./TriggerSteps";
import {
  addStep,
  addTrigger,
  editTrigger,
  moveStep,
  moveTrigger,
  nextTriggerId,
  type PointTarget,
  removeStep,
  removeTrigger,
  renameTrigger,
  type StepList,
  setStepParam,
  stepsOf,
  triggerSummary,
} from "./triggers";

/**
 * The trigger the panel is showing.
 *
 * The id is held rather than the name, and nothing changes an id, so this is a
 * lookup and not a search. It was neither before issue #2205: the id was the
 * name, a rename moved the thing the selection was held by, and an undo left the
 * panel holding a string the document no longer had. It showed the first trigger
 * in the list at that point, so an author who undid a rename and carried on
 * typing was editing a trigger they had not picked (issue #2202). PR #2204 got
 * that right by recording every rename the panel made and walking the record.
 * A stable id means there is nothing to record.
 *
 * Nothing is found when the selected trigger has gone from the document, which
 * is what undoing a new trigger does, and what deleting one does until it is put
 * back. The panel shows no form then, so it never puts a trigger nobody picked
 * under the cursor.
 */
function selectedTrigger(
  triggers: ScenarioTrigger[],
  selectedId: string | null,
): ScenarioTrigger | null {
  if (selectedId === null) return triggers[0] ?? null;
  return triggers.find((t) => t.id === selectedId) ?? null;
}

export function TriggerPanel({
  scenario,
  onChange,
  units,
  unitsLoading,
  gate,
  extensions,
  note,
  picking,
  onPick,
}: {
  scenario: Scenario;
  onChange: (next: Scenario) => void;
  /** The scenario's game's units, for a parameter naming a unit type. */
  units: UnitDatasetEntry[];
  unitsLoading: boolean;
  /** What the runtime that will play this scenario can and cannot run. Passed
   *  in because the panels that rename a reference need the same read. */
  gate: PaletteGate;
  extensions: ExtensionTypes;
  /** Which runtime the palette is measured against, when it stops anything. */
  note: string | null;
  /** The point the map is waiting for, or null when it is not waiting. */
  picking: PointTarget | null;
  onPick: (target: PointTarget | null) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = selectedTrigger(scenario.triggers, selectedId);
  const unitDefs = useMemo(() => units.map((u) => u.name), [units]);

  const count = scenario.triggers.length;
  const create = () => {
    const id = nextTriggerId(scenario.triggers);
    onChange(addTrigger(scenario, id));
    setSelectedId(id);
  };

  return (
    <EditorPanel
      title="Triggers"
      icon={Zap}
      summary={
        count === 0
          ? "Nothing happens yet"
          : `${count} trigger${count === 1 ? "" : "s"}`
      }
    >
      {note && (
        <p className="mb-3 max-w-prose text-[11px] text-muted-foreground">
          {note} Types it does not implement are listed but cannot be added, and
          a step already in a trigger that needs one is flagged.
        </p>
      )}
      {extensions.problems.length > 0 && (
        // The game developer wrote missions/extensions.lua, not the person
        // reading this, so it says what was dropped rather than asking them to
        // fix it.
        <p className="mb-3 max-w-prose text-[11px] text-amber-300">
          {scenario.setup.gameName} declares trigger types coilbox could not
          read, so they are not offered: {extensions.problems.join("; ")}
        </p>
      )}
      <div className="flex flex-col gap-4 lg:flex-row">
        <div className="flex shrink-0 flex-col gap-2 lg:w-60">
          {count === 0 ? (
            <p className="text-xs text-muted-foreground">
              A trigger runs its actions when its conditions hold. Everything a
              mission does beyond placing units is one of these.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {scenario.triggers.map((trigger) => (
                <li key={trigger.id}>
                  <TriggerRow
                    trigger={trigger}
                    current={trigger.id === selected?.id}
                    onSelect={() => setSelectedId(trigger.id)}
                  />
                </li>
              ))}
            </ul>
          )}
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 px-2 text-xs"
            onClick={create}
          >
            <Plus className="size-3.5" /> New trigger
          </Button>
        </div>

        {selected && (
          <div className="min-w-0 flex-1">
            <TriggerForm
              key={selected.id}
              trigger={selected}
              scenario={scenario}
              units={units}
              unitsLoading={unitsLoading}
              unitDefs={unitDefs}
              gate={gate}
              extensions={extensions}
              picking={picking}
              onPick={onPick}
              onChange={onChange}
            />
          </div>
        )}
        {!selected && count > 0 && (
          <p className="min-w-0 flex-1 text-xs text-muted-foreground">
            The trigger you were on has gone. Pick one from the list, or step
            back to bring it back.
          </p>
        )}
      </div>
    </EditorPanel>
  );
}

/** One trigger in the list: what it is called, what it holds, and whether it is
 *  armed. */
function TriggerRow({
  trigger,
  current,
  onSelect,
}: {
  trigger: ScenarioTrigger;
  current: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full flex-col gap-0.5 rounded-md border px-2 py-1.5 text-left ${
        current
          ? "border-primary/60 bg-primary/10"
          : "border-border/50 hover:bg-muted/40"
      }`}
    >
      <span className="flex items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate font-mono text-xs">
          {trigger.name}
        </span>
        {!trigger.enabled && (
          <span className="shrink-0 text-[10px] text-amber-300">disarmed</span>
        )}
        {trigger.repeat && (
          <span className="shrink-0 text-[10px] text-muted-foreground">
            repeats{trigger.cooldown ? ` · ${trigger.cooldown}s` : ""}
          </span>
        )}
      </span>
      <span className="truncate text-[11px] text-muted-foreground">
        {triggerSummary(trigger)}
      </span>
    </button>
  );
}

/** The selected trigger: what it is called, when it fires, and the two lists. */
function TriggerForm({
  trigger,
  scenario,
  units,
  unitsLoading,
  unitDefs,
  gate,
  extensions,
  picking,
  onPick,
  onChange,
}: {
  trigger: ScenarioTrigger;
  scenario: Scenario;
  units: UnitDatasetEntry[];
  unitsLoading: boolean;
  unitDefs: string[];
  /** The types the target runtime cannot run, for the two pickers. */
  gate: PaletteGate;
  /** The types the scenario's game declares for itself, which both pickers
   *  offer on top of coilbox's own. */
  extensions: ExtensionTypes;
  picking: PointTarget | null;
  onPick: (target: PointTarget | null) => void;
  onChange: (next: Scenario) => void;
}) {
  const at = scenario.triggers.indexOf(trigger);
  const edit = (patch: Partial<Omit<ScenarioTrigger, "id">>) =>
    onChange(editTrigger(scenario, trigger.id, patch));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <TriggerName
          name={trigger.name}
          onRename={(name) => {
            const next = renameTrigger(scenario, trigger.id, name);
            if (next === scenario) return false;
            onChange(next);
            return true;
          }}
        />
        <Button
          size="sm"
          variant="ghost"
          className="size-7 p-0"
          aria-label="Move this trigger up"
          disabled={at <= 0}
          onClick={() => onChange(moveTrigger(scenario, trigger.id, -1))}
        >
          <ArrowUp className="size-3.5" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="size-7 p-0"
          aria-label="Move this trigger down"
          disabled={at < 0 || at >= scenario.triggers.length - 1}
          onClick={() => onChange(moveTrigger(scenario, trigger.id, 1))}
        >
          <ArrowDown className="size-3.5" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto h-7 gap-1.5 px-2 text-xs text-destructive hover:text-destructive"
          // The selection is left on the deleted trigger's id rather than
          // cleared. Nothing else answers to that id, so the panel shows no form
          // until a step back puts the trigger itself back, and then the author
          // is on the trigger they were on (issue #2205).
          onClick={() => {
            onChange(removeTrigger(scenario, trigger.id));
            onPick(null);
          }}
        >
          <Trash2 className="size-3.5" /> Delete
        </Button>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Triggers are evaluated in this order, and other triggers point at this
        one by its name.
      </p>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <div className="flex items-center gap-2">
          <Switch
            id="trigger-enabled"
            checked={trigger.enabled}
            onCheckedChange={(enabled) => edit({ enabled })}
          />
          <Label htmlFor="trigger-enabled" className="text-xs font-medium">
            Armed at the start
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            id="trigger-repeat"
            checked={trigger.repeat}
            onCheckedChange={(repeat) => edit({ repeat })}
          />
          <Label htmlFor="trigger-repeat" className="text-xs font-medium">
            Fires every time
          </Label>
        </div>
        {(trigger.repeat || trigger.cooldown !== undefined) && (
          <CooldownField
            seconds={trigger.cooldown}
            onChange={(cooldown) => edit({ cooldown })}
          />
        )}
      </div>

      {/* Which difficulties this trigger runs at (issue #2164). A trigger
          outside its range is not armed and cannot be armed, so "on hard the
          reinforcements arrive twice" is a second trigger set to hard rather
          than a difficulty test written into the one that already exists. */}
      <div className="max-w-sm">
        <DifficultyRangeFields
          value={trigger.difficulty}
          onChange={(difficulty) => edit({ difficulty })}
        />
      </div>

      <StepSection
        list="conditions"
        trigger={trigger}
        scenario={scenario}
        units={units}
        unitsLoading={unitsLoading}
        unitDefs={unitDefs}
        gate={gate.conditions}
        extensions={extensions}
        picking={picking}
        onPick={onPick}
        onChange={onChange}
      />
      <StepSection
        list="actions"
        trigger={trigger}
        scenario={scenario}
        units={units}
        unitsLoading={unitsLoading}
        unitDefs={unitDefs}
        gate={gate.actions}
        extensions={extensions}
        picking={picking}
        onPick={onPick}
        onChange={onChange}
      />
    </div>
  );
}

/**
 * The trigger's name. A label and nothing else since issue #2205: it is not what
 * anything points at, so it may be anything but empty, and an empty box is put
 * back rather than stored because a row with no label cannot be picked out.
 *
 * The box follows the name when the name changes on its own, which is what undo
 * and redo do (issue #2185). That used to be free here, because the form around
 * this field was keyed by the id, the id was the name, and a rename remounted
 * the whole form. It is not free any more. A rename leaves the id alone, so
 * nothing remounts, and the hook is the only thing keeping the box in step.
 */
function TriggerName({
  name: stored,
  onRename,
}: {
  name: string;
  onRename: (name: string) => boolean;
}) {
  const [name, setName] = useFieldText(stored);

  return (
    <Input
      aria-label="Trigger name"
      value={name}
      onChange={(e) => setName(e.target.value)}
      onBlur={() => {
        if (name.trim() === stored) return setName(stored);
        if (!onRename(name)) setName(stored);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      className="h-7 w-52 font-mono text-xs"
    />
  );
}

/**
 * How long a repeating trigger waits between firings. Seconds, because that is
 * what the runtime reads and what an author thinks in.
 *
 * The box follows the wait when the wait changes on its own, which is what an
 * undo does (issue #2185). Nothing remounts this field: the form it sits in is
 * keyed by the trigger's name, and changing the wait leaves the name alone. So
 * the box carried on showing the wait from before the step back, and the next
 * keystroke wrote it over the restored one.
 */
function CooldownField({
  seconds,
  onChange,
}: {
  seconds: number | undefined;
  onChange: (seconds: number | undefined) => void;
}) {
  const [text, setText] = useFieldText(
    seconds === undefined ? "" : String(seconds),
  );

  const commit = () => {
    const next = Number(text.trim());
    if (text.trim() === "" || !Number.isFinite(next) || next <= 0) {
      setText("");
      return onChange(undefined);
    }
    setText(String(next));
    if (next !== seconds) onChange(next);
  };

  return (
    <div className="flex items-center gap-2">
      <Label htmlFor="trigger-cooldown" className="text-xs font-medium">
        Waits
      </Label>
      <Input
        id="trigger-cooldown"
        type="number"
        min={0}
        value={text}
        placeholder="0"
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        className="h-7 w-20 text-xs"
      />
      <span className="text-xs text-muted-foreground">
        seconds between firings
      </span>
    </div>
  );
}

/** One of the trigger's two lists: its conditions, or its actions. */
function StepSection({
  list,
  trigger,
  scenario,
  units,
  unitsLoading,
  unitDefs,
  gate,
  extensions,
  picking,
  onPick,
  onChange,
}: {
  list: StepList;
  trigger: ScenarioTrigger;
  scenario: Scenario;
  units: UnitDatasetEntry[];
  unitsLoading: boolean;
  unitDefs: string[];
  /** Why each type this list cannot offer is unavailable, by type name. */
  gate: Record<string, string>;
  /** The types the scenario's game declares for itself. */
  extensions: ExtensionTypes;
  picking: PointTarget | null;
  onPick: (target: PointTarget | null) => void;
  onChange: (next: Scenario) => void;
}) {
  const steps = stepsOf(trigger, list);
  const conditions = list === "conditions";

  return (
    <section className="flex flex-col gap-2 rounded-md border border-border/50 p-2">
      <header className="flex items-center gap-2">
        <h3 className="text-xs font-medium">
          {conditions ? "Fires when" : "Then"}
        </h3>
        {conditions && (
          <OptionSelect
            size="sm"
            className="w-40"
            value={trigger.conditions.op}
            onValueChange={(op) =>
              onChange(
                editTrigger(scenario, trigger.id, {
                  conditions: {
                    ...trigger.conditions,
                    op: op === "any" ? "any" : "all",
                  },
                }),
              )
            }
            options={[
              { value: "all", label: "all of these hold" },
              { value: "any", label: "any of these hold" },
            ]}
          />
        )}
        <span className="ml-auto text-[11px] text-muted-foreground">
          {steps.length === 0
            ? conditions
              ? trigger.conditions.op === "all"
                ? "with none, it fires on the first pass"
                : "with none, it never fires"
              : "with none, firing does nothing"
            : `${steps.length} ${conditions ? "condition" : "action"}${steps.length === 1 ? "" : "s"}`}
        </span>
      </header>

      {steps.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {steps.map((step, index) => (
            <StepRow
              // biome-ignore lint/suspicious/noArrayIndexKey: a step has no id and its place in the list is what names it, in the document and in a point pick alike
              key={`${index}-${step.type}`}
              step={step}
              at={{ triggerId: trigger.id, list, index }}
              scenario={scenario}
              extensions={extensions}
              // A step already in the document is flagged rather than greyed:
              // it cannot be un-added, and the launch route refuses it, so the
              // panel says which step is the reason (issue #855).
              unsupported={gate[step.type]}
              units={units}
              unitsLoading={unitsLoading}
              picking={picking}
              onPick={onPick}
              onParam={(name, value) =>
                onChange(
                  setStepParam(
                    scenario,
                    { triggerId: trigger.id, list, index },
                    name,
                    value,
                  ),
                )
              }
              // Conditions hold together under one all-or-any, so their order
              // says nothing. Actions run in the order they are listed.
              onMove={
                conditions
                  ? null
                  : (delta) =>
                      onChange(
                        moveStep(
                          scenario,
                          { triggerId: trigger.id, list, index },
                          delta,
                        ),
                      )
              }
              onRemove={() => {
                onPick(null);
                onChange(
                  removeStep(scenario, { triggerId: trigger.id, list, index }),
                );
              }}
            />
          ))}
        </ul>
      )}

      <AddStep
        list={list}
        scenario={scenario}
        extensions={extensions}
        unitDefs={unitDefs}
        gate={gate}
        onAdd={(step) => onChange(addStep(scenario, trigger.id, list, step))}
      />
    </section>
  );
}
