import { Button, Input, useDrawer } from "@picoframe/frame";
import { ArrowLeft } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { PresetPickerDrawer } from "@/campaign/pages/components/PresetPickerDrawer";
import { Textarea } from "@/components/ui/textarea";
import type { SkirmishDraft } from "@/play/drafts";
import { useSkirmishPresets } from "@/play/presets";
import {
  DetailLoading,
  ErrorBanner,
  NotFound,
} from "../../content/pages/components/states";
import type { Scenario } from "../model";
import { refreshScenarios, useScenarios } from "../scenarios";
import { saveScenario } from "../storage";
import { DialoguePanel } from "./components/DialoguePanel";
import { ObjectivePanel } from "./components/ObjectivePanel";
import { RestrictionPanel } from "./components/RestrictionPanel";
import { ScenarioMapScene } from "./components/ScenarioMapScene";
import { TriggerPanel } from "./components/TriggerPanel";
import {
  applyPoint,
  type PointTarget,
  pointRepeats,
  stepAt,
  stepLabel,
} from "./components/triggers";
import { useGameUnits } from "./components/useGameUnits";
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
  const { presets } = useSkirmishPresets();
  const drawer = useDrawer();

  const stored = scenarios.find((s) => s.id === id);
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [loadedId, setLoadedId] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  // A trigger parameter waiting for a point on the map. Held here rather than in
  // the panel that asked, because the map that answers it is a sibling.
  const [pick, setPick] = useState<PointTarget | null>(null);
  const gameUnits = useGameUnits(scenario?.setup.gameName ?? "");

  // Seed the editable copy once this id's document is available, and re-seed if
  // the route id changes under the same component instance.
  useEffect(() => {
    if (stored && loadedId !== stored.id) {
      setScenario(stored);
      setLoadedId(stored.id);
    }
  }, [stored, loadedId]);

  const persist = useCallback(async (next: Scenario) => {
    setScenario(next);
    try {
      setScenario(await saveScenario(next));
      await refreshScenarios();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  if (loading && !scenario) return <DetailLoading backTo={BACK} />;
  if (!scenario) return <NotFound backTo={BACK} label="scenario" />;

  // A preset is the skirmish setup a scenario is played on, deep-copied in the
  // way a campaign mission snapshots one, so editing the preset afterwards
  // cannot reach into the scenario.
  const openPresetPicker = () =>
    drawer.open({
      title: "Set up from preset",
      width: "32rem",
      content: (
        <PresetPickerDrawer
          presets={presets}
          onPick={(preset) => {
            const setup: SkirmishDraft = structuredClone({
              participants: preset.participants,
              gameName: preset.gameName,
              mapName: preset.mapName,
              startPosType: preset.startPosType,
              modOptionValues: preset.modOptionValues,
            });
            void persist({ ...scenario, setup, teams: {} });
          }}
        />
      ),
    });

  const { participants } = scenario.setup;

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
          onPick: (pos: { x: number; z: number }) => {
            void persist(applyPoint(scenario, pick, pos));
            if (!pointRepeats(pick)) setPick(null);
          },
          onDone: () => setPick(null),
        }
      : null;

  return (
    <div className="flex flex-col gap-5 p-4">
      <Link
        to={BACK}
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline"
      >
        <ArrowLeft className="size-3.5" /> Back to scenarios
      </Link>

      {error && <ErrorBanner message={error} />}

      <header className="flex flex-col gap-3">
        <Input
          aria-label="Scenario name"
          value={scenario.name}
          onChange={(e) =>
            setScenario((s) => (s ? { ...s, name: e.target.value } : s))
          }
          onBlur={() => void persist(scenario)}
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
          onBlur={() => void persist(scenario)}
        />
      </header>

      <section className="flex items-center gap-3 rounded-lg border border-border/50 bg-card p-4">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="text-sm font-medium">Setup</h2>
          <span className="truncate text-xs text-muted-foreground">
            {scenario.setup.gameName || "No game"} ·{" "}
            {scenario.setup.mapName || "No map"} · {participants.length}{" "}
            participant{participants.length === 1 ? "" : "s"}
          </span>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="ml-auto shrink-0"
          onClick={openPresetPicker}
        >
          {scenario.setup.gameName ? "Change setup" : "Set up from preset"}
        </Button>
      </section>

      {/* The editing surface: the document's units drawn on the map, the mode
          strip that places more, and the picking and dragging that moves them.
          Zones and paths arrive in #759 onwards. */}
      <ScenarioMapScene
        scenario={scenario}
        onChange={(next) => void persist(next)}
        picking={picking}
      />

      {/* The panels: the parts of the document the map cannot show. Triggers
          first, because everything under them is something a trigger points
          at. */}
      <TriggerPanel
        scenario={scenario}
        onChange={(next) => void persist(next)}
        units={gameUnits.units}
        unitsLoading={gameUnits.loading}
        picking={pick}
        onPick={setPick}
      />
      <ObjectivePanel
        scenario={scenario}
        onChange={(next) => void persist(next)}
      />
      <DialoguePanel
        scenario={scenario}
        onChange={(next) => void persist(next)}
      />
      <RestrictionPanel
        scenario={scenario}
        onChange={(next) => void persist(next)}
        units={gameUnits.units}
        unitsLoading={gameUnits.loading}
      />
      <VarPanel scenario={scenario} onChange={(next) => void persist(next)} />
    </div>
  );
}
