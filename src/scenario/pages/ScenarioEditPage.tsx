import { Button, Drawer, Input, useDrawer } from "@picoframe/frame";
import { ArrowLeft, Rocket, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { Textarea } from "@/components/ui/textarea";
import { UnitGameProvider } from "@/content/pages/components/UnitPicker";
import { useGameUnits } from "@/content/useGameUnits";
import {
  DetailLoading,
  ErrorBanner,
  NotFound,
} from "../../content/pages/components/states";
import type { Scenario } from "../model";
import { saveEditedScenario } from "../saveIntoGame";
import { refreshScenarios, useScenarios } from "../scenarios";
import { isEditable, type LoadedScenario } from "../storage";
import { missionProblemCount } from "../wording";
import { BlueprintPanel } from "./components/BlueprintPanel";
import { DialoguePanel } from "./components/DialoguePanel";
import { applyEdit, type ScenarioEdit } from "./components/edits";
import {
  type EditHistory,
  emptyHistory,
  isRedoKey,
  isTypingTarget,
  isUndoKey,
  redoEdit,
  undoEdit,
} from "./components/history";
import { MissionProblemsList } from "./components/MissionProblemsList";
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
import { useMissionProblems } from "./components/useMissionProblems";
import { useScenarioGate } from "./components/useScenarioGate";
import { useScenarioMapExtent } from "./components/useScenarioMapExtent";
import { VarPanel } from "./components/VarPanel";

const BACK = "/scenario-builder";

/**
 * Editor for one scenario. The document's name and description, the skirmish
 * setup it is played on, and the map it is authored on as a 3D scene. The
 * placement modes and panels that hang off that scene arrive in #757 onwards.
 *
 * The working document is held in local state and written back with
 * {@link saveEditedScenario} on every change, which stamps `updatedAt` and hands
 * back the stamped document, so what is on screen is what is on disk. Where it
 * is written depends on where it came from: coilbox's store for a local
 * scenario, the game's own `missions/<folder>/` for one of a game's missions.
 */
export default function ScenarioEditPage() {
  const { id } = useParams();
  const { scenarios, loading } = useScenarios();
  const drawer = useDrawer();

  const loaded = scenarios.find((l) => l.scenario.id === id);
  // A read-only scenario (bundled, or a game's own packaged mission) is never
  // opened here. The whole editor saves on every keystroke, and there is
  // nowhere for those saves to go (issue #786).
  const stored = loaded && isEditable(loaded) ? loaded.scenario : undefined;
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
  const { gate, extensions, note } = useScenarioGate(
    scenario,
    "author",
    loaded?.origin,
  );
  // What is wrong with the mission as it stands, on the validator the launch
  // refuses on. Held here rather than in the panel each problem belongs to,
  // because a reference is only broken relative to the whole document: the zone
  // panel cannot know that a trigger elsewhere was pointing at what it deleted.
  //
  // The units are handed over only once that read has settled. An empty list is
  // an answer to the validator ("coilbox could not read this game's units"), and
  // a read still in flight is not that answer.
  const mapExtent = useScenarioMapExtent(scenario?.setup.mapName ?? "");
  const problems = useMissionProblems(
    scenario,
    mapExtent,
    gameUnits.loading ? undefined : gameUnits.units,
  );
  const problemCount = missionProblemCount(
    problems.blocking.length,
    problems.warnings.length,
  );
  const [showProblems, setShowProblems] = useState(false);
  const [history, setHistory] = useState<EditHistory<Scenario>>(emptyHistory);
  // Both are also held in refs, because an edit and a step through the history
  // read them at the moment they happen rather than at the last render: two
  // undos in quick succession are two presses before one re-render.
  const scenarioRef = useRef<Scenario | null>(scenario);
  scenarioRef.current = scenario;
  const historyRef = useRef(history);
  historyRef.current = history;
  // Where the document came from, read at the moment a write happens rather
  // than at the render the saver was built on. The saver is built once, on the
  // first render, which is usually before the list has resolved and said
  // whether this document is one of a game's own missions.
  const loadedRef = useRef<LoadedScenario | undefined>(loaded);
  loadedRef.current = loaded;

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
      write: (document) => saveEditedScenario(loadedRef.current, document),
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
   *  Every panel and the map itself come through here. An edit is applied to the
   *  document as it stands rather than to the one the caller was rendered with,
   *  so two of them in one tick both land (issue #904). */
  const apply = useCallback(
    (edit: ScenarioEdit) => {
      const before = scenarioRef.current;
      if (!before) return;
      const applied = applyEdit(before, historyRef.current, edit);
      historyRef.current = applied.history;
      setHistory(applied.history);
      persist(applied.document);
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
  if (loaded && !isEditable(loaded)) {
    return <ReadOnlyScenario loaded={loaded} />;
  }
  if (!scenario) return <NotFound backTo={BACK} label="scenario" />;

  const openTest = () =>
    drawer.open({
      title: `Test ${scenario.name} in game`,
      width: "32rem",
      content: (
        <ScenarioTestDrawer scenario={scenario} origin={loaded?.origin} />
      ),
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
            apply((doc) => applyPoint(doc, pick, pos));
            if (!pointRepeats(pick)) setPick(null);
          },
          onDone: () => setPick(null),
        }
      : null;

  return (
    // Every unit field on this page, however deeply nested, picks from this
    // scenario's game, so it gets build pics and faction blocks without each
    // panel being handed the game name.
    <UnitGameProvider gameName={scenario.setup.gameName}>
      <div className="flex flex-col gap-5 p-4">
        <div className="flex items-center gap-3">
          <Link
            to={BACK}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline"
          >
            <ArrowLeft className="size-3.5" /> Back to scenarios
          </Link>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {/* What the validator has found, said while the mission is being
              made rather than when it fails to start (issue #2162). Styled as
              a problem, and destructive only when something in it actually
              stops a launch: an unwritten objective is not an emergency. */}
            {problemCount ? (
              <Button
                size="sm"
                variant={
                  problems.blocking.length > 0 ? "destructive" : "outline"
                }
                className={
                  problems.blocking.length > 0 ? undefined : "text-amber-300"
                }
                onClick={() => setShowProblems(true)}
              >
                <TriangleAlert className="size-4" /> {problemCount}
              </Button>
            ) : null}
            {/* Testing belongs with the setup, because the setup is all a launch
              consumes: the game named there decides whether the scenario is
              played as itself or through the test mutator. */}
            <Button size="sm" onClick={openTest}>
              <Rocket className="size-4" /> Test in game
            </Button>
          </div>
        </div>

        {/* The frame's own drawer takes a snapshot of its content when it
          opens, and this list changes as the author fixes what is in it, so
          this one is the controlled drawer instead. */}
        <Drawer
          open={showProblems}
          onOpenChange={setShowProblems}
          title={`Problems in ${scenario.name}`}
          width="32rem"
        >
          <MissionProblemsList problems={problems} />
        </Drawer>

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
              setScenario((s) =>
                s ? { ...s, description: e.target.value } : s,
              )
            }
            onBlur={() => apply(scenario)}
          />
        </header>

        {/* The setup: the game and map the scene below draws, and the
          participants everything placed on it belongs to. */}
        <SetupPanel
          scenario={scenario}
          loaded={loaded}
          onChange={(next) => apply(next)}
        />

        {/* The editing surface: the document's units drawn on the map, the mode
          strip that places more, and the picking and dragging that moves them.
          Zones and paths arrive in #759 onwards. */}
        {/* The history is the whole document's, panels included, but its buttons
          live on the map: it is the surface an author spends the time on, and
          the one that covers the page when it is expanded. */}
        <ScenarioMapScene
          scenario={scenario}
          onChange={(next) => apply(next)}
          extensions={extensions}
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
        {/* The layouts the document holds, and the way in and out of a game's own
          blueprint file. It sits with the panels rather than on the map because
          it is about the whole document, and because a layout arriving from a
          file is not a click on the map. */}
        <BlueprintPanel
          scenario={scenario}
          onChange={(edit) => apply(edit)}
          units={gameUnits.units}
        />
        <VarPanel
          scenario={scenario}
          onChange={(next) => apply(next)}
          extensions={extensions}
        />
      </div>
    </UnitGameProvider>
  );
}

/**
 * What a read-only scenario's route shows instead of the editor: it is
 * there, it plays, and it is not yours to change. A bundled scenario and a
 * game's own packaged mission land here for different reasons, so each says
 * its own reason rather than one generic message.
 */
function ReadOnlyScenario({ loaded }: { loaded: LoadedScenario }) {
  const reason =
    loaded.source === "game"
      ? `This mission ships inside ${loaded.origin?.gameName ?? "this game"}, which is packaged, so it cannot be edited here. Share it to make a copy of your own.`
      : "It came with this copy of coilbox, so it is read-only. Play it from Scenarios, or Export it and import that file back to get a copy you can edit.";
  return (
    <div className="flex flex-col gap-4 p-4">
      <Link
        to={BACK}
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline"
      >
        <ArrowLeft className="size-3.5" /> Back to scenarios
      </Link>
      <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-10 text-center">
        <p className="text-sm font-medium">
          {loaded.scenario.name} can't be edited
        </p>
        <p className="text-sm text-muted-foreground">{reason}</p>
      </div>
    </div>
  );
}
