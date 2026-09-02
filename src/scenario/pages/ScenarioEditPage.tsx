import { Button, Drawer, Input, useDrawer } from "@picoframe/frame";
import {
  ArrowLeft,
  Check,
  Copy,
  FileCode2,
  Keyboard,
  Loader2,
  MoreVertical,
  Rocket,
  Share2,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { type SaveState, SaveStatus } from "@/components/SaveStatus";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useUnitsyncScan } from "@/content/config";
import { UnitGameProvider } from "@/content/pages/components/UnitPicker";
import { useGameUnits } from "@/content/useGameUnits";
import { usePreferredTarget } from "@/play/config";
import { useCampaigns } from "../../campaign/campaigns";
import { scenarioIsAttached } from "../../campaign/missionScenario";
import {
  DetailLoading,
  ErrorBanner,
  NotFound,
} from "../../content/pages/components/states";
import type { Scenario } from "../model";
import { saveEditedScenario } from "../saveIntoGame";
import { refreshScenarios, useScenarios } from "../scenarios";
import { deleteScenario, isEditable, type LoadedScenario } from "../storage";
import type { MissionIssue } from "../validate";
import { missionProblemCount } from "../wording";
import { BlueprintPanel } from "./components/BlueprintPanel";
import { DialoguePanel } from "./components/DialoguePanel";
import { duplicateScenario } from "./components/duplicate";
import { applyEdit, type ScenarioEdit } from "./components/edits";
import {
  type EditHistory,
  emptyHistory,
  isRedoKey,
  isTypingTarget,
  isUndoKey,
  modKeyLabel,
  redoEdit,
  undoEdit,
} from "./components/history";
import { MissionLuaView } from "./components/MissionLuaView";
import { MissionProblemsList } from "./components/MissionProblemsList";
import { ObjectivePanel } from "./components/ObjectivePanel";
import { orderPathId } from "./components/orderPaths";
import {
  type ProblemTarget,
  problemTarget,
  type RowFocus,
} from "./components/problemTargets";
import { RestrictionPanel } from "./components/RestrictionPanel";
import {
  ScenarioMapScene,
  type ScenarioMapSceneHandle,
} from "./components/ScenarioMapScene";
import {
  DELETE_SCENARIO_DESCRIPTION,
  DeleteScenarioForm,
} from "./components/ScenarioRowMenu";
import { ScenarioTestDrawer } from "./components/ScenarioTestDrawer";
import { SetupPanel } from "./components/SetupPanel";
import { ShortcutsList } from "./components/ShortcutsList";
import { createScenarioSaver, type ScenarioSaver } from "./components/saving";
import { isDuplicateKey, isTestKey } from "./components/shortcuts";
import {
  TriggerPanel,
  type TriggerPanelHandle,
} from "./components/TriggerPanel";
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
  const navigate = useNavigate();
  // The same games list the share on the list page carries, read only for the
  // modinfo shortname the export records beside the archive name (#1335). This
  // is the scan `useGameUnits` below already runs for this page, served from
  // the same cache, so the header costs no extra read.
  const { target } = usePreferredTarget();
  const scan = useUnitsyncScan(target?.enginePath, target?.dataDir);
  // Whether a campaign mission is carrying a copy of this scenario, which
  // decides whether deleting it takes the dialogue clips with it (issue #866).
  // The same question the list asks, asked the same way, because a delete from
  // here has to leave a campaign playing exactly what a delete from there does.
  const { campaigns } = useCampaigns();

  const loaded = scenarios.find((l) => l.scenario.id === id);
  // A read-only scenario (bundled, or a game's own packaged mission) is never
  // opened here. The whole editor saves on every keystroke, and there is
  // nowhere for those saves to go (issue #786).
  const stored = loaded && isEditable(loaded) ? loaded.scenario : undefined;
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [loadedId, setLoadedId] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  // Where the saver's last write got to (issue #2270). The editor has no save
  // button, so this is the only way an author can tell a write that landed
  // from one that never happened.
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
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
  // The same problems, flattened for the panels that put one next to the
  // field it is about (issue #2287). The drawer keeps the split between what
  // stops a launch and what merely plays wrong. A field just needs to know
  // whether it is the reason, not which of the two lists that reason sits in.
  const missionIssues = useMemo(
    () => [...problems.blocking, ...problems.warnings],
    [problems],
  );
  const problemCount = missionProblemCount(
    problems.blocking.length,
    problems.warnings.length,
  );
  // The problems button's own state, kept apart from `problemCount` because a
  // read still in flight and a clean read both leave that string empty, and an
  // author cannot tell those two apart from nothing on screen (issue #2272).
  const problemsPhase: "checking" | "clean" | "problems" = gameUnits.loading
    ? "checking"
    : problemCount
      ? "problems"
      : "clean";
  const [showProblems, setShowProblems] = useState(false);
  // Where a mission problem's own row points, once it has been activated
  // (issue #2271): which panel, or the map, it names and a token that
  // changes on every activation, so the second click on the same row still
  // scrolls and focuses rather than being a no-op because nothing changed.
  const [problemFocus, setProblemFocus] = useState<{
    target: ProblemTarget;
    token: number;
  } | null>(null);
  const problemFocusTokenRef = useRef(0);
  // Set by `onActivateProblem`, read and cleared by the drawer's own
  // `onCloseAutoFocus` once its close animation actually ends, rather than
  // guessed at with a timer (issue #2310). Empty when the drawer closed some
  // other way, which leaves picoframe's own restore-to-opener default in
  // place.
  const pendingProblemFocusRef = useRef<{
    target: ProblemTarget;
    token: number;
  } | null>(null);
  /** A problem row was activated: close the drawer, and hand the panel or
   *  the map that owns the problem a target to take it from there once the
   *  drawer's own close animation ends. A row with no target
   *  ({@link problemTarget} returned null) never calls this at all, so there
   *  is nothing to guard here. */
  const onActivateProblem = useCallback((issue: MissionIssue) => {
    const target = problemTarget(issue.path);
    if (!target) return;
    problemFocusTokenRef.current += 1;
    pendingProblemFocusRef.current = {
      target,
      token: problemFocusTokenRef.current,
    };
    setShowProblems(false);
  }, []);
  const rowFocus = (
    kind: "trigger" | "objective" | "variable" | "map",
  ): RowFocus | null => {
    const target = problemFocus?.target;
    if (!target || target.kind !== kind) return null;
    const id =
      target.kind === "trigger"
        ? target.triggerId
        : target.kind === "objective"
          ? target.id
          : target.kind === "variable"
            ? target.name
            : target.key;
    return { id, token: problemFocus.token };
  };
  const [showLua, setShowLua] = useState(false);
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
  // Cmd+D's two possible targets (issue #2277), reached through a ref because
  // both the trigger being edited and the map's selected placement are owned
  // by their own components rather than lifted here.
  const triggerPanelRef = useRef<TriggerPanelHandle>(null);
  const mapSceneRef = useRef<ScenarioMapSceneHandle>(null);

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
      onQueued: () => setSave({ kind: "saving" }),
      onWritten: async (written) => {
        scenarioRef.current = written;
        setScenario(written);
        setError(null);
        setSave({ kind: "saved", at: new Date() });
        await refreshScenarios();
      },
      onError: (e) => {
        setError(e instanceof Error ? e.message : String(e));
        setSave({ kind: "failed" });
      },
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

  // Read through the refs rather than the `scenario`/`loaded` this render
  // holds, so this can sit above the early returns below and still say
  // nothing when there is, as yet, no document to test (issue #2277).
  const openTest = useCallback(() => {
    const current = scenarioRef.current;
    if (!current) return;
    drawer.open({
      title: `Test ${current.name} in game`,
      description:
        "Compiles the mission, checks it loads, then starts the engine.",
      width: "32rem",
      content: (
        <ScenarioTestDrawer
          scenario={current}
          origin={loadedRef.current?.origin}
        />
      ),
    });
  }, [drawer]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target as HTMLElement | null)) return;
      if (isUndoKey(event)) {
        event.preventDefault();
        undo();
      } else if (isRedoKey(event)) {
        event.preventDefault();
        redo();
      } else if (isTestKey(event)) {
        event.preventDefault();
        openTest();
      } else if (isDuplicateKey(event)) {
        event.preventDefault();
        // The trigger panel claims this first, and only when the author's
        // focus is inside the form of the trigger it would duplicate: that is
        // the one unambiguous "editing this" signal available here. The map's
        // selected placement is the fallback, so a selection left over from
        // earlier work does not silently steal a duplicate meant for the
        // trigger in front of the author, and neither fires when nothing is
        // selected anywhere (issue #2277).
        if (!triggerPanelRef.current?.duplicateSelected()) {
          mapSceneRef.current?.duplicateSelected();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, openTest]);

  if (loading && !scenario) return <DetailLoading backTo={BACK} />;
  if (loaded && !isEditable(loaded)) {
    return <ReadOnlyScenario loaded={loaded} />;
  }
  if (!scenario) return <NotFound backTo={BACK} label="scenario" />;

  // Share: the same code, link and file the list offers (issue #1336), loaded
  // on demand so the editor does not carry the export path until it is asked
  // for.
  const openShare = async () => {
    const { ShareScenarioForm } = await import(
      "./components/ShareScenarioForm"
    );
    drawer.open({
      title: `Share ${scenario.name}`,
      description:
        "Get the code, link and file that let someone else load this scenario.",
      width: "28rem",
      content: (
        <ShareScenarioForm
          scenario={scenario}
          installed={scan.data?.games ?? []}
        />
      ),
    });
  };

  // The page's own shortcuts, listed for an author who has not found them by
  // trial and error (issue #2277). Not a mode of its own on the map, so this
  // sits with Share and Delete rather than beside Test in game.
  const openShortcuts = () =>
    drawer.open({
      title: "Keyboard shortcuts",
      description: "What this editor answers to, beyond the mouse.",
      width: "24rem",
      content: <ShortcutsList />,
    });

  // Duplicate: a copy of the document as it stands, its dialogue clips copied
  // into the copy's own media folder, opened in place of this one (issue
  // #2183). The most common moment to want a variant is mid-edit, with the
  // mission on screen, so the list's row menu is a shortcut rather than the
  // only way in.
  //
  // The copy is made from the working document, not from what the list is
  // holding, so an edit made a keystroke ago is in it. The saver writes on
  // every change, so the two are the same thing but for the write in flight.
  //
  // Only for a scenario coilbox stores, for the same reason the list has it:
  // a game's own mission keeps its clips inside the game archive, where there
  // is nothing for a copy to read them out of.
  const duplicable = loaded?.source === "local";
  const duplicate = async () => {
    try {
      const copy = await duplicateScenario(
        scenario,
        scenarios.map((l) => l.scenario.name),
      );
      await refreshScenarios();
      navigate(`/scenario-builder/${copy.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  // Only a scenario in coilbox's own store is deleted. A game's own mission is
  // editable here when the game is a loose `.sdd`, but taking it out of the
  // game is a move rather than a delete, and that is what the setup panel's
  // "Take out of game" is for (issue #2160).
  const deletable = loaded?.source === "local";

  // Deleting the document that is open leaves the editor with nothing to edit,
  // so it goes back to the list. Cancelling is the drawer closing and nothing
  // else: the author is still here, on the scenario they were editing.
  const attached = scenarioIsAttached(
    campaigns.map((c) => c.campaign),
    scenario.id,
  );
  const confirmDelete = () =>
    drawer.open({
      title: `Delete ${scenario.name}`,
      description: DELETE_SCENARIO_DESCRIPTION,
      width: "24rem",
      content: (
        <DeleteScenarioForm
          scenario={scenario}
          attached={attached}
          onDelete={async () => {
            await deleteScenario(scenario.id, { keepMedia: attached });
            await refreshScenarios();
            navigate(BACK);
          }}
          onDone={() => drawer.close()}
        />
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
        {/* Test in game, Mission Lua and the problems count are the actions an
          author reaches for on every test run, so the row stays on screen
          rather than scrolling off above the map (issue #2276). Sticky
          within the editor's own scroll container (picoframe's `<main>`),
          thin (no padding beyond the border) so it costs the map as little
          height as possible, and left plain so the save indicator and an
          always-present problems button have a row to land in without
          another restructure. Undo and redo stayed off it: they already have
          a home on the map toolbar, and issue #2280 answered "a panel delete
          has no visible way back" with a notice at the delete itself rather
          than a second pair of buttons up here. */}
        <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-border/50 bg-background py-2">
          <Link
            to={BACK}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline"
          >
            <ArrowLeft className="size-3.5" /> Back to scenarios
          </Link>
          {/* Every edit here writes to disk as it is made, with no save
            button, so this is the only sign an author gets that a write
            landed, is still going, or was refused (issue #2270). */}
          <SaveStatus state={save} onRetry={() => persist(scenario)} />
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {/* What the validator has found, said while the mission is being
              made rather than when it fails to start (issue #2162). Present
              in all three states the validator can be in, because a button
              that only exists when something is wrong looks the same as one
              for a mission nobody has checked yet (issue #2272). Only the
              problems state gets the warning colour: destructive when
              something in it actually stops a launch, amber when it does
              not, muted while checking or clean. */}
            <Button
              size="sm"
              disabled={problemsPhase === "checking"}
              variant={
                problemsPhase === "problems" && problems.blocking.length > 0
                  ? "destructive"
                  : "outline"
              }
              className={
                problemsPhase === "problems"
                  ? problems.blocking.length > 0
                    ? undefined
                    : "text-amber-300"
                  : "text-muted-foreground"
              }
              onClick={() => setShowProblems(true)}
            >
              {problemsPhase === "checking" ? (
                <Loader2 className="size-4 motion-safe:animate-spin" />
              ) : problemsPhase === "problems" ? (
                <TriangleAlert className="size-4" />
              ) : (
                <Check className="size-4" />
              )}
              {problemsPhase === "checking"
                ? "Checking…"
                : problemsPhase === "problems"
                  ? problemCount
                  : "No problems"}
            </Button>
            {/* The file the engine is handed, beside the problems found in it:
              an author who has read a problem and does not believe it reads the
              mission next (issue #2163). */}
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowLua(true)}
            >
              <FileCode2 className="size-4" /> Mission Lua
            </Button>
            {/* Testing belongs with the setup, because the setup is all a launch
              consumes: the game named there decides whether the scenario is
              played as itself or through the test mutator. */}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="sm" onClick={openTest}>
                    <Rocket className="size-4" /> Test in game
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{modKeyLabel()} Enter</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            {/* What can be done to the scenario as a document rather than to
              its contents: sharing it, and deleting it (issue #2203). The
              moment an author wants either is usually with the scenario open,
              so the list's row menu is a shortcut rather than the only way.

              A menu rather than two more buttons. The header already carries
              the problem count, Mission Lua and Test in game, all of which act
              on the mission being made. These act on the file it is kept in,
              and Delete has no business sitting one click away from Test. */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-8 shrink-0 text-muted-foreground"
                  aria-label={`Actions for ${scenario.name}`}
                >
                  <MoreVertical className="size-4" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                {duplicable && (
                  <DropdownMenuItem onSelect={() => void duplicate()}>
                    <Copy className="size-4" aria-hidden="true" /> Duplicate
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onSelect={() => void openShare()}>
                  <Share2 className="size-4" aria-hidden="true" /> Share
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={openShortcuts}>
                  <Keyboard className="size-4" aria-hidden="true" /> Keyboard
                  shortcuts
                </DropdownMenuItem>
                {deletable && (
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={confirmDelete}
                  >
                    <Trash2 className="size-4" aria-hidden="true" /> Delete
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* The frame's own drawer takes a snapshot of its content when it
          opens, and this list changes as the author fixes what is in it, so
          this one is the controlled drawer instead. */}
        <Drawer
          open={showProblems}
          onOpenChange={setShowProblems}
          title={`Problems in ${scenario.name}`}
          description="Issues found while compiling the mission, with a fix where one exists."
          width="32rem"
          onCloseAutoFocus={(event) => {
            const pending = pendingProblemFocusRef.current;
            if (!pending) return;
            pendingProblemFocusRef.current = null;
            event.preventDefault();
            setProblemFocus(pending);
          }}
        >
          <MissionProblemsList
            problems={problems}
            scenario={scenario}
            onActivate={onActivateProblem}
          />
        </Drawer>

        {/* Controlled for the same reason: the compiled mission is recompiled
          from the document on every edit, so an author can leave this open and
          watch a change land in the file. */}
        <Drawer
          open={showLua}
          onOpenChange={setShowLua}
          title={`${scenario.name} as mission.lua`}
          description="The compiled mission.lua, updated as you edit."
          width="44rem"
        >
          <MissionLuaView scenario={scenario} />
        </Drawer>

        {error && <ErrorBanner message={error} />}

        <header className="flex flex-col gap-3">
          <Input
            aria-label="Scenario name"
            value={scenario.name}
            onChange={(e) => {
              setScenario((s) => (s ? { ...s, name: e.target.value } : s));
              setSave({ kind: "unsaved" });
            }}
            onBlur={() => apply(scenario)}
            className="text-base font-semibold"
          />
          <Textarea
            aria-label="Scenario description"
            value={scenario.description}
            placeholder="Description"
            className="min-h-16"
            onChange={(e) => {
              setScenario((s) =>
                s ? { ...s, description: e.target.value } : s,
              );
              setSave({ kind: "unsaved" });
            }}
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
          ref={mapSceneRef}
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
          focus={rowFocus("map")}
        />

        {/* The panels: the parts of the document the map cannot show. Triggers
          first, because everything under them is something a trigger points
          at. */}
        <TriggerPanel
          ref={triggerPanelRef}
          scenario={scenario}
          onChange={(next) => apply(next)}
          units={gameUnits.units}
          unitsLoading={gameUnits.loading}
          gate={gate}
          extensions={extensions}
          note={note}
          issues={missionIssues}
          picking={pick}
          onPick={setPick}
          onUndo={undo}
          focus={rowFocus("trigger")}
        />
        <ObjectivePanel
          scenario={scenario}
          onChange={(next) => apply(next)}
          onUndo={undo}
          focus={rowFocus("objective")}
        />
        <DialoguePanel scenario={scenario} onChange={(next) => apply(next)} />
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
          onUndo={undo}
          focus={rowFocus("variable")}
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
