import { Button, Input, useDrawer } from "@picoframe/frame";
import { Loader2, Plus, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useUnitsyncScan, useUnitsyncThumbnails } from "@/content/config";
import { usePreferredTarget } from "@/play/config";
import { useCampaigns } from "../../campaign/campaigns";
import {
  EmptyState,
  ErrorBanner,
  SkeletonList,
} from "../../content/pages/components/states";
import { newScenario } from "../create";
import { campaignsUsingScenario, isSetUp, scenarioSummary } from "../listing";
import type { Scenario } from "../model";
import { refreshScenarios, useScenarios } from "../scenarios";
import { deleteScenario, isEditable, saveScenario } from "../storage";
import { ReclaimClipsButton } from "./components/ReclaimClipsButton";
import { ScenarioImportButton } from "./components/ScenarioImportButton";
import { ScenarioMapThumb } from "./components/ScenarioMapThumb";
import { ScenarioRowMenu } from "./components/ScenarioRowMenu";

/**
 * Scenario Builder landing: create a scenario, import a shared one, and list
 * every stored scenario with the route into its editor. Advanced-gated by its
 * route, beside Campaign Builder.
 *
 * A scenario is the in-engine half of a mission (spawns, zones, triggers,
 * objectives, dialogue) and a standalone document, so it is created here and
 * only later attached to a campaign mission.
 *
 * A row says what an author needs to tell two scenarios apart while scanning the
 * list (issue #2179): the map, the name, the game and map it is set on, what it
 * holds, when it was last written, and the description. Ten smoke tests all
 * called "test" are separated by the edit time, which is also the only thing on
 * screen that explains why the list is in the order it is.
 */
export default function ScenarioBuilderPage() {
  const { scenarios, loading, error, refresh } = useScenarios();
  const { campaigns } = useCampaigns();
  // The engine and content root every row's map is looked up against, and that
  // an export reads the modinfo shortname from to record beside the game's
  // archive name (issue #1335).
  const { target } = usePreferredTarget();
  const scan = useUnitsyncScan(target?.enginePath, target?.dataDir);
  // One batch of rendered minimaps for the whole list, session cached and
  // already primed at startup, rather than a render per row (issue #2177).
  const { thumbs, loading: thumbsLoading } = useUnitsyncThumbnails(
    target?.enginePath,
    target?.dataDir,
  );
  // What the rows need to tell a map they cannot draw from a map this machine
  // does not have. Null while the scan is still running, so no row accuses a
  // map of being missing on the strength of a list that is not finished.
  const installedMaps = useMemo(
    () => (scan.data ? new Set(scan.data.maps.map((m) => m.name)) : null),
    [scan.data],
  );
  const navigate = useNavigate();
  const drawer = useDrawer();
  const [rescanning, setRescanning] = useState(false);

  const openNew = () =>
    drawer.open({
      title: "New scenario",
      width: "28rem",
      content: (
        <NewScenarioForm
          onCreated={(id) => {
            drawer.close();
            navigate(`/scenario-builder/${id}`);
          }}
        />
      ),
    });

  const rescan = async () => {
    setRescanning(true);
    try {
      await refresh();
    } finally {
      setRescanning(false);
    }
  };

  // Share: a code, a link or a file (issue #1336). The drawer owns all three,
  // and says so when the scenario's dialogue clips make it too big for a code.
  // The scanned games go with it only so the export can name the scenario's game
  // by its modinfo shortname as well as its archive name (issue #1335).
  const openShare = async (scenario: Scenario) => {
    const { ShareScenarioForm } = await import(
      "./components/ShareScenarioForm"
    );
    drawer.open({
      title: `Share ${scenario.name}`,
      width: "28rem",
      content: (
        <ShareScenarioForm
          scenario={scenario}
          installed={scan.data?.games ?? []}
        />
      ),
    });
  };

  // A campaign mission that attached this scenario carries the document but
  // still loads its dialogue clips out of the scenario media store by name, so
  // deleting the scenario keeps the clips when a campaign is still playing them
  // (issue #866). The row says so too, because that is a reason to think twice
  // about a scenario before reaching for its menu at all (issue #2178).
  const usedBy = (id: string) =>
    campaignsUsingScenario(
      campaigns.map((c) => c.campaign),
      id,
    );

  // Failure is reported by the confirmation drawer that asked for the delete,
  // which is what somebody is looking at when it fails, so nothing is caught
  // here.
  const remove = async (id: string) => {
    await deleteScenario(id, { keepMedia: usedBy(id).length > 0 });
    await refreshScenarios();
  };

  return (
    <div className="flex flex-col gap-5 p-4">
      <PageHeader
        title="Scenario Builder"
        description="Author a mission's in-engine content: what spawns, what the triggers watch for, and what wins it. A scenario stands alone, so you can play one on its own or attach it to a campaign mission later."
        actions={
          <>
            <Button
              variant="outline"
              className="gap-1.5"
              onClick={rescan}
              disabled={rescanning}
            >
              {rescanning ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCw className="size-4" />
              )}
              Rescan
            </Button>
            <ReclaimClipsButton />
            <ScenarioImportButton
              onImported={(scenario) =>
                navigate(`/scenario-builder/${scenario.id}`)
              }
            />
            <Button className="gap-1.5" onClick={openNew}>
              <Plus className="size-4" /> New scenario
            </Button>
          </>
        }
      />

      {error && <ErrorBanner message={error} />}

      {loading ? (
        <SkeletonList />
      ) : scenarios.length === 0 ? (
        <EmptyState label="No scenarios yet. Start one with New scenario, or import a shared one." />
      ) : (
        <ul className="flex flex-col gap-2">
          {scenarios.map((loaded) => {
            const { scenario, source, origin } = loaded;
            // A bundled scenario is a distribution's own file, so it is listed
            // and exportable but not editable or deletable. Same treatment as a
            // bundled campaign.
            //
            // A game's own mission is listed with them and shares the read-only
            // half, but never offers Delete even when it is editable: taking a
            // mission out of a game puts the document back in coilbox's store,
            // which is its own action rather than a delete (issue #2160).
            const bundled = source === "bundled";
            const fromGame = source === "game";
            // A scenario with no game or no map cannot be launched, by anything.
            // The second line already says which of the two is missing, so the
            // badge carries the consequence rather than repeating the gap.
            const draft = !isSetUp(scenario);
            const inCampaigns = usedBy(scenario.id);
            return (
              <li
                key={scenario.id}
                className="group flex items-center gap-3 rounded-lg border border-border/50 bg-card p-3 transition-colors hover:border-primary/40 hover:bg-accent/50"
              >
                {/* The whole row opens the scenario, which is what nearly every
                    click on one wants. A read-only scenario goes to the same
                    route and lands on the read-only view there, which says why
                    it cannot be edited, so no row is a dead click. */}
                <Link
                  to={`/scenario-builder/${scenario.id}`}
                  className="flex min-w-0 flex-1 items-center gap-3"
                >
                  <ScenarioMapThumb
                    mapName={scenario.setup.mapName}
                    thumbs={thumbs}
                    installedMaps={installedMaps}
                    loading={thumbsLoading}
                  />
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">
                        {scenario.name}
                      </span>
                      {draft && (
                        <Badge
                          variant="outline"
                          className="shrink-0 text-[10px]"
                        >
                          Draft
                        </Badge>
                      )}
                      {bundled && (
                        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                          Bundled
                        </span>
                      )}
                      {fromGame && origin && (
                        <Badge
                          variant="secondary"
                          className="shrink-0 text-[10px]"
                        >
                          From {origin.gameName}
                        </Badge>
                      )}
                      {/* Not a link. The whole row is already one, and an anchor
                          inside an anchor is a click target neither browsers nor
                          screen readers agree on. Naming the campaigns on hover
                          costs no tab stop and no nesting. */}
                      {inCampaigns.length > 0 && (
                        <Badge
                          variant="secondary"
                          className="shrink-0 text-[10px]"
                          title={`Used by ${inCampaigns.join(", ")}`}
                        >
                          {inCampaigns.length === 1
                            ? "In campaign"
                            : `In ${inCampaigns.length} campaigns`}
                        </Badge>
                      )}
                    </div>
                    <span className="truncate text-xs text-muted-foreground">
                      {scenario.setup.gameName || "No game"} ·{" "}
                      {scenario.setup.mapName || "No map"}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {scenarioSummary(scenario)}
                    </span>
                    {/* Only when the author wrote one. An empty line here would
                        be a row that is taller for having said nothing. */}
                    {scenario.description && (
                      <span className="truncate text-xs text-muted-foreground">
                        {scenario.description}
                      </span>
                    )}
                  </div>
                </Link>
                <ScenarioRowMenu
                  scenario={scenario}
                  editable={isEditable(loaded)}
                  deletable={!bundled && !fromGame}
                  attached={inCampaigns.length > 0}
                  onShare={() => void openShare(scenario)}
                  onDelete={() => remove(scenario.id)}
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * The new-scenario form, shown in the drawer behind the New scenario button.
 * It saves the empty scenario itself, so the page only has to open the editor
 * on the id it hands back. Mirrors the campaign builder's own form.
 */
function NewScenarioForm({ onCreated }: { onCreated: (id: string) => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await saveScenario(
        newScenario(trimmed, description.trim()),
      );
      await refreshScenarios();
      onCreated(saved.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <Input
        value={name}
        placeholder="Name"
        onChange={(e) => setName(e.target.value)}
      />
      <Textarea
        value={description}
        placeholder="Description (optional)"
        className="min-h-16"
        onChange={(e) => setDescription(e.target.value)}
      />
      {error && <ErrorBanner message={error} />}
      <Button
        className="gap-1.5"
        onClick={create}
        disabled={!name.trim() || busy}
      >
        <Plus className="size-4" /> {busy ? "Creating…" : "Create"}
      </Button>
    </div>
  );
}
