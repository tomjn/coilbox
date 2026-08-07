import { Button, Input, useDrawer } from "@picoframe/frame";
import { ArrowLeft, Rocket } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { Textarea } from "@/components/ui/textarea";
import {
  DetailLoading,
  ErrorBanner,
  NotFound,
} from "../../content/pages/components/states";
import type { Scenario } from "../model";
import { refreshScenarios, useScenarios } from "../scenarios";
import { saveScenario } from "../storage";
import { DialoguePanel } from "./components/DialoguePanel";
import {
  type EditHistory,
  emptyHistory,
  isRedoKey,
  isTypingTarget,
  isUndoKey,
  recordEdit,
  redoEdit,
  undoEdit,
} from "./components/history";
import { ObjectivePanel } from "./components/ObjectivePanel";
import { orderPathId } from "./components/orderPaths";
import { RestrictionPanel } from "./components/RestrictionPanel";
import { ScenarioMapScene } from "./components/ScenarioMapScene";
import { ScenarioTestDrawer } from "./components/ScenarioTestDrawer";
import { SetupPanel } from "./components/SetupPanel";
import { createScenarioSaver, type ScenarioSaver } from "./components/saving";
import { TriggerPanel } from "./components/TriggerPanel";
import {
  applyPoint,
  type PointTarget,
  pointRepeats,
  stepAt,
  stepLabel,
} from "./components/triggers";
import { useGameUnits } from "./components/useGameUnits";
import { useScenarioGate } from "./components/useScenarioGate";
import { VarPanel } from "./components/VarPanel";

const BACK = "/scenario-builder";

/**
 * Editor for one scenario. The document's name and description, the skirmish
 * setup it is played on, and the map it is authored on as a 3D scene. The
 * placement modes and panels that hang off that scene arrive in #757 onwards.
 *
 * The working document is held in local state and written back with
 * {@link saveScenario} on every change, which stamps `updatedAt` and hands back
 * the stamped document, so what is on screen is what is on disk.
 */
export default function ScenarioEditPage() {
  const { id } = useParams();
  const { scenarios, loading } = useScenarios();
  const drawer = useDrawer();

  const stored = scenarios.find((s) => s.id === id);
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [loadedId, setLoadedId] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  // A trigger parameter waiting for a point on the map. Held here rather than in
  // the panel that asked, because the map that answers it is a sibling.
  const [pick, setPick] = useState<PointTarget | null>(null);
  const gameUnits = useGameUnits(scenario?.setup.gameName ?? "");
  // Read once for the page rather than in the trigger panel, because every
  // panel that renames a reference needs the game's own declared types to carry
  // that reference over (issue #913).
  const { gate, extensions, note } = useScenarioGate(scenario);
  const [history, setHistory] = useState<EditHistory>(emptyHistory);
  // Both are also held in refs, because an edit and a step through the history
  // read them at the moment they happen rather than at the last render: two
  // undos in quick succession are two presses before one re-render.
  const scenarioRef = useRef<Scenario | null>(scenario);
  scenarioRef.current = scenario;
  const historyRef = useRef(history);
  historyRef.current = history;

  // Seed the editable copy once this id's document is available, and re-seed if
  // the route id changes under the same component instance.
  useEffect(() => {
    if (stored && loadedId !== stored.id) {
      setScenario(stored);
      setLoadedId(stored.id);
      setHistory(emptyHistory);
      historyRef.current = emptyHistory;
    }
  }, [stored, loadedId]);

  // One queue for the whole editing session, so writes land in the order they
  // were asked for and only the newest one is shown. See `saving.ts`.
  const saver = useRef<ScenarioSaver>(undefined);
  if (!saver.current) {
    saver.current = createScenarioSaver({
      write: saveScenario,
      onWritten: async (written) => {
        scenarioRef.current = written;
        setScenario(written);
        await refreshScenarios();
      },
      onError: (e) => setError(e instanceof Error ? e.message : String(e)),
    });
  }

  /** Show a document and write it to disk. The whole editor's one way out,
   *  including a step through the history: undoing is an edit like any other,
   *  because there is no save button to defer it to. */
  const persist = useCallback((next: Scenario) => {
    scenarioRef.current = next;
    setScenario(next);
    saver.current?.save(next);
  }, []);

  /** An edit the author made, which is the only kind that goes in the history.
   *  Every panel and the map itself come through here. */
  const apply = useCallback(
    (next: Scenario) => {
      const before = scenarioRef.current;
      if (before) {
        const recorded = recordEdit(historyRef.current, before, next);
        historyRef.current = recorded;
        setHistory(recorded);
      }
      persist(next);
    },
    [persist],
  );

  const step = useCallback(
    (take: typeof undoEdit) => {
      const current = scenarioRef.current;
      if (!current) return;
      const taken = take(historyRef.current, current);
      if (!taken) return;
      historyRef.current = taken.history;
      setHistory(taken.history);
      persist(taken.document);
    },
    [persist],
  );

  const undo = useCallback(() => step(undoEdit), [step]);
  const redo = useCallback(() => step(redoEdit), [step]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target as HTMLElement | null)) return;
      if (isUndoKey(event)) {
        event.preventDefault();
        undo();
      } else if (isRedoKey(event)) {
        event.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  if (loading && !scenario) return <DetailLoading backTo={BACK} />;
  if (!scenario) return <NotFound backTo={BACK} label="scenario" />;

  const openTest = () =>
    drawer.open({
      title: `Test ${scenario.name} in game`,
      width: "32rem",
      content: <ScenarioTestDrawer scenario={scenario} />,
    });

  // Held loosely, the way a base being moved is: a step that has been deleted
  // stops the map waiting for a point nothing would receive.
  const asked = pick && stepAt(scenario, pick.ref);
  const picking =
    pick && asked
      ? {
          message:
            pick.order === undefined
              ? `Click the map to put ${stepLabel(asked.type)}'s ${pick.param} there`
              : `Click the map to add points to ${stepLabel(asked.type)}`,
          // Which path the points are going into, so the map draws that one with
          // knobs while it is being drawn (#847).
          pathId:
            pick.order === undefined
              ? undefined
              : orderPathId({
                  trigger: scenario.triggers.findIndex(
                    (t) => t.id === pick.ref.triggerId,
                  ),
                  list: pick.ref.list,
                  step: pick.ref.index,
                  param: pick.param,
                }),
          onPick: (pos: { x: number; z: number }) => {
            apply(applyPoint(scenario, pick, pos));
            if (!pointRepeats(pick)) setPick(null);
          },
          onDone: () => setPick(null),
        }
      : null;

  return (
    <div className="flex flex-col gap-5 p-4">
      <div className="flex items-center gap-3">
        <Link
          to={BACK}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline"
        >
          <ArrowLeft className="size-3.5" /> Back to scenarios
        </Link>
        {/* Testing belongs with the setup, because the setup is all a launch
            consumes: the game named there decides whether the scenario is
            played as itself or through the test mutator. */}
        <Button size="sm" className="ml-auto shrink-0" onClick={openTest}>
          <Rocket className="size-4" /> Test in game
        </Button>
      </div>

      {error && <ErrorBanner message={error} />}

      <header className="flex flex-col gap-3">
        <Input
          aria-label="Scenario name"
          value={scenario.name}
          onChange={(e) =>
            setScenario((s) => (s ? { ...s, name: e.target.value } : s))
          }
          onBlur={() => apply(scenario)}
          className="text-base font-semibold"
        />
        <Textarea
          aria-label="Scenario description"
          value={scenario.description}
          placeholder="Description"
          className="min-h-16"
          onChange={(e) =>
            setScenario((s) => (s ? { ...s, description: e.target.value } : s))
          }
          onBlur={() => apply(scenario)}
        />
      </header>

      {/* The setup: the game and map the scene below draws, and the
          participants everything placed on it belongs to. */}
      <SetupPanel scenario={scenario} onChange={(next) => apply(next)} />

      {/* The editing surface: the document's units drawn on the map, the mode
          strip that places more, and the picking and dragging that moves them.
          Zones and paths arrive in #759 onwards. */}
      {/* The history is the whole document's, panels included, but its buttons
          live on the map: it is the surface an author spends the time on, and
          the one that covers the page when it is expanded. */}
      <ScenarioMapScene
        scenario={scenario}
        onChange={(next) => apply(next)}
        picking={picking}
        history={{
          canUndo: history.past.length > 0,
          canRedo: history.future.length > 0,
          undo,
          redo,
        }}
      />

      {/* The panels: the parts of the document the map cannot show. Triggers
          first, because everything under them is something a trigger points
          at. */}
      <TriggerPanel
        scenario={scenario}
        onChange={(next) => apply(next)}
        units={gameUnits.units}
        unitsLoading={gameUnits.loading}
        gate={gate}
        extensions={extensions}
        note={note}
        picking={pick}
        onPick={setPick}
      />
      <ObjectivePanel
        scenario={scenario}
        onChange={(next) => apply(next)}
        extensions={extensions}
      />
      <DialoguePanel
        scenario={scenario}
        onChange={(next) => apply(next)}
        extensions={extensions}
      />
      <RestrictionPanel
        scenario={scenario}
        onChange={(next) => apply(next)}
        units={gameUnits.units}
        unitsLoading={gameUnits.loading}
      />
      <VarPanel
        scenario={scenario}
        onChange={(next) => apply(next)}
        extensions={extensions}
      />
    </div>
  );
}
