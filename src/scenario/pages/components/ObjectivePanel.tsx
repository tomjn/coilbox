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
import { Copy, ListChecks, Plus, Trash2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { OptionSelect } from "@/uberstress/pages/components/OptionSelect";
import type { Scenario, ScenarioObjective } from "../../model";
import type { MissionIssue } from "../../validate";
import { notifyDeleted } from "./deleteNotice";
import { focusListRow } from "./focusListRow";
import {
  EditorPanel,
  type EditorPanelHandle,
  FieldProblem,
  TextField,
} from "./panels";
import type { RowFocus } from "./problemTargets";
import {
  addObjective,
  duplicateObjective,
  editObjective,
  nextObjectiveId,
  removeObjective,
} from "./registries";
import { entryFieldProblem } from "./triggerProblems";

export function ObjectivePanel({
  scenario,
  onChange,
  onUndo,
  focus,
  issues,
}: {
  scenario: Scenario;
  onChange: (next: Scenario) => void;
  /** The page's own step back, the same one Cmd+Z and the map toolbar call.
   *  Handed to a delete's undo notice so that button does exactly what the
   *  shortcut does rather than a second way of getting there (issue #2280). */
  onUndo: () => void;
  /** An objective a mission problem's row points at (issue #2271): expand the
   *  panel, select it and land the cursor on its row in the list. */
  focus?: RowFocus | null;
  /** What the validator has found wrong with the mission (issue #2339). An
   *  objective with no text is the one of these an objective's own field can
   *  show, the way a team select already does (issue #2307): the rest name a
   *  placement or a def rather than a field on this panel. */
  issues: MissionIssue[];
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected =
    scenario.objectives.find((o) => o.id === selectedId) ??
    scenario.objectives[0] ??
    null;
  const panelRef = useRef<EditorPanelHandle>(null);
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());

  // biome-ignore lint/correctness/useExhaustiveDependencies: focus.id and focus.token are the trigger, not the object identity, the same reason TriggerPanel's matching effect gives.
  useEffect(() => {
    if (!focus) return;
    panelRef.current?.open();
    setSelectedId(focus.id);
    const raf = requestAnimationFrame(() => {
      const row = rowRefs.current.get(focus.id);
      if (row) focusListRow(row);
    });
    return () => cancelAnimationFrame(raf);
  }, [focus?.id, focus?.token]);

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
      ref={panelRef}
      title="Objectives"
      icon={ListChecks}
      summary={
        count === 0
          ? "Nothing to do yet"
          : `${primary} primary · ${count - primary} secondary`
      }
    >
      <div className="flex flex-col gap-4 lg:flex-row">
        <div className="flex shrink-0 flex-col gap-2 lg:w-72">
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
                    rowRef={(el) => {
                      if (el) rowRefs.current.set(objective.id, el);
                      else rowRefs.current.delete(objective.id);
                    }}
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
              onUndo={onUndo}
              issues={issues}
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
  rowRef,
}: {
  objective: ScenarioObjective;
  current: boolean;
  onSelect: () => void;
  /** Registers this row's button so a mission problem's row can scroll to
   *  and focus it (issue #2271). */
  rowRef?: (el: HTMLButtonElement | null) => void;
}) {
  return (
    <button
      ref={rowRef}
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

/** What the delete notice calls an objective: its own words if it has any,
 *  cut short so the toast reads as a line rather than a paragraph, and the id
 *  it was minted with if the author deleted it before typing anything. */
function objectiveLabel(objective: ScenarioObjective): string {
  const text = objective.text.trim();
  if (!text) return objective.id;
  return text.length > 40 ? `${text.slice(0, 40)}…` : text;
}

/** The selected objective: its id, its words, and how it is shown. */
function ObjectiveForm({
  objective,
  scenario,
  onChange,
  onSelect,
  onUndo,
  issues,
}: {
  objective: ScenarioObjective;
  scenario: Scenario;
  onChange: (next: Scenario) => void;
  onSelect: (id: string | null) => void;
  onUndo: () => void;
  issues: MissionIssue[];
}) {
  const edit = (patch: Partial<Omit<ScenarioObjective, "id">>) =>
    onChange(editObjective(scenario, objective.id, patch));
  const duplicate = () => {
    const id = nextObjectiveId(scenario);
    onChange(duplicateObjective(scenario, objective.id, id));
    onSelect(id);
  };
  const textDescribedBy = useId();
  // `checkText` in validate.ts reports this as a warning, never an error: a
  // blank objective still plays, it just shows a blank line on the panel
  // until somebody writes it. So this is shown next to the field the same
  // way a difficulty range problem is, without claiming the text was
  // refused.
  const textProblem = entryFieldProblem(
    issues,
    "objectives",
    objective.id,
    "text",
  );

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
          className="ml-auto h-7 gap-1.5 px-2 text-xs"
          onClick={duplicate}
        >
          <Copy className="size-3.5" /> Duplicate
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1.5 px-2 text-xs text-destructive hover:text-destructive"
          onClick={() => {
            onChange(removeObjective(scenario, objective.id));
            onSelect(null);
            notifyDeleted(
              `Deleted objective "${objectiveLabel(objective)}".`,
              onUndo,
            );
          }}
        >
          <Trash2 className="size-3.5" /> Delete
        </Button>
      </div>

      <div className="flex flex-col gap-0.5">
        <TextField
          value={objective.text}
          label="Objective text"
          placeholder="Hold the landing pad for two minutes"
          onCommit={(text) => edit({ text })}
          className="h-8 text-xs"
          describedBy={textDescribedBy}
        />
        <FieldProblem id={textDescribedBy} problem={textProblem} />
      </div>

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
