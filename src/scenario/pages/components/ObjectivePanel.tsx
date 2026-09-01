/**
 * The objectives panel: the list of objectives, and the form for the one
 * selected.
 *
 * An objective is what the player is told to do, and the only thing the mission
 * shows them of its own logic. It carries no state of its own here: the runtime
 * hands the player's panel 0 active, 1 complete or -1 failed, and a trigger's
 * `complete_objective` or `fail_objective` is what moves it. So this panel is
 * the words, whether it is a primary or a side job, and whether it is on the
 * panel from the start.
 *
 * The id is not one of them. It is what those two actions point at, what the
 * compiled mission is addressed by, and what a mission problem names an
 * objective by, so it is minted once and shown here rather than edited (issue
 * #2248). It used to be the name box, and typing in it rewrote every trigger
 * that pointed at the objective.
 *
 * The document is never held here. Every edit goes out through `onChange` and
 * comes back as a new `scenario`, the way the trigger panel works.
 */

import { Button } from "@picoframe/frame";
import { ListChecks, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { OptionSelect } from "@/uberstress/pages/components/OptionSelect";
import type { Scenario, ScenarioObjective } from "../../model";
import { EditorPanel, TextField } from "./panels";
import {
  addObjective,
  editObjective,
  nextObjectiveId,
  removeObjective,
} from "./registries";

export function ObjectivePanel({
  scenario,
  onChange,
}: {
  scenario: Scenario;
  onChange: (next: Scenario) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected =
    scenario.objectives.find((o) => o.id === selectedId) ??
    scenario.objectives[0] ??
    null;

  const count = scenario.objectives.length;
  const primary = scenario.objectives.filter(
    (o) => o.kind === "primary",
  ).length;
  const create = () => {
    const id = nextObjectiveId(scenario);
    onChange(addObjective(scenario, id));
    setSelectedId(id);
  };

  return (
    <EditorPanel
      title="Objectives"
      icon={ListChecks}
      summary={
        count === 0
          ? "Nothing to do yet"
          : `${primary} primary · ${count - primary} secondary`
      }
    >
      <div className="flex flex-col gap-4 lg:flex-row">
        <div className="flex shrink-0 flex-col gap-2 lg:w-60">
          {count === 0 ? (
            <p className="text-xs text-muted-foreground">
              An objective is what the player is told to do. A trigger completes
              or fails it, and the panel in game shows it until then.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {scenario.objectives.map((objective) => (
                <li key={objective.id}>
                  <ObjectiveRow
                    objective={objective}
                    current={objective.id === selected?.id}
                    onSelect={() => setSelectedId(objective.id)}
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
            <Plus className="size-3.5" /> New objective
          </Button>
        </div>

        {selected && (
          <div className="min-w-0 flex-1">
            <ObjectiveForm
              key={selected.id}
              objective={selected}
              scenario={scenario}
              onChange={onChange}
              onSelect={setSelectedId}
            />
          </div>
        )}
      </div>
    </EditorPanel>
  );
}

/** One objective in the list: what it says, and what sort it is. */
function ObjectiveRow({
  objective,
  current,
  onSelect,
}: {
  objective: ScenarioObjective;
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
        <span className="min-w-0 flex-1 truncate text-xs">
          {objective.text.trim() || (
            <span className="text-muted-foreground">No text yet</span>
          )}
        </span>
        {objective.hidden && (
          <span className="shrink-0 text-[10px] text-amber-300">hidden</span>
        )}
      </span>
      <span className="truncate font-mono text-[11px] text-muted-foreground">
        {objective.id} · {objective.kind}
      </span>
    </button>
  );
}

/** The selected objective: its id, its words, and how it is shown. */
function ObjectiveForm({
  objective,
  scenario,
  onChange,
  onSelect,
}: {
  objective: ScenarioObjective;
  scenario: Scenario;
  onChange: (next: Scenario) => void;
  onSelect: (id: string | null) => void;
}) {
  const edit = (patch: Partial<Omit<ScenarioObjective, "id">>) =>
    onChange(editObjective(scenario, objective.id, patch));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {/* Read only. The mission problems list names an objective by this, so
            it is worth being able to read, and nothing moves it (issue #2248). */}
        <span className="font-mono text-xs text-muted-foreground">
          {objective.id}
        </span>
        <OptionSelect
          size="sm"
          className="w-36"
          value={objective.kind}
          onValueChange={(kind) =>
            edit({ kind: kind === "secondary" ? "secondary" : "primary" })
          }
          options={[
            { value: "primary", label: "Primary" },
            { value: "secondary", label: "Secondary" },
          ]}
        />
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto h-7 gap-1.5 px-2 text-xs text-destructive hover:text-destructive"
          onClick={() => {
            onChange(removeObjective(scenario, objective.id));
            onSelect(null);
          }}
        >
          <Trash2 className="size-3.5" /> Delete
        </Button>
      </div>

      <TextField
        value={objective.text}
        label="Objective text"
        placeholder="Hold the landing pad for two minutes"
        onCommit={(text) => edit({ text })}
        className="h-8 text-xs"
      />

      <div className="flex items-center gap-2">
        <Switch
          id={`objective-hidden-${objective.id}`}
          checked={objective.hidden}
          onCheckedChange={(hidden) => edit({ hidden })}
        />
        <Label
          htmlFor={`objective-hidden-${objective.id}`}
          className="text-xs font-medium"
        >
          Hidden until it is settled
        </Label>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Triggers move an objective with <code>complete_objective</code> and{" "}
        <code>fail_objective</code>, and the first of the two to run is the one
        that sticks. A hidden objective stays off the player's panel until one
        of them does, so it is how a mission springs a surprise job rather than
        a secret the player never sees.
      </p>
    </div>
  );
}
