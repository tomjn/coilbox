import { Button, Input, useDrawer } from "@picoframe/frame";
import { ChevronDown, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { ButtonGroup } from "@/components/ui/button-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { useUnitsyncScan, useUnitsyncThumbnails } from "@/content/config";
import { nextDrawerKey } from "@/general/drawerKey";
import { relativeTime } from "@/lib/relativeTime";
import { usePreferredTarget } from "@/play/config";
import { useCampaigns } from "../../campaign/campaigns";
import {
  EmptyState,
  ErrorBanner,
  SkeletonList,
} from "../../content/pages/components/states";
import { newScenario } from "../create";
import { campaignsUsingScenario, isSetUp } from "../listing";
import type { Scenario } from "../model";
import { refreshScenarios, useScenarios } from "../scenarios";
import {
  deleteScenario,
  isEditable,
  type LoadedScenario,
  saveScenario,
} from "../storage";
import { ReclaimClipsForm } from "./components/ReclaimClipsForm";
import { ScenarioContentChips } from "./components/ScenarioContentChips";
import { ScenarioImportButton } from "./components/ScenarioImportButton";
import { ScenarioMapThumb } from "./components/ScenarioMapThumb";
import { ScenarioRowMenu } from "./components/ScenarioRowMenu";
import {
  filterScenarios,
  groupScenariosByGame,
  offeredSources,
  SOURCE_LABELS,
  type SourceFilter,
} from "./components/scenarioList";

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
 * list (issue #2179): the map, the name, the map it is set on, what it holds,
 * when it was last written, and the description. Ten smoke tests all called
 * "test" are separated by the edit time, which is also the only thing on screen
 * that explains why the list is in the order it is. What it holds is drawn as
 * icons and numbers rather than written out, so the counts line up down the
 * list instead of reading the same on every row (issue #2180).
 *
 * Past a screenful, scanning stops working, so the list is also searchable by
 * name, narrowable to one source, and gathered under the game each scenario is
 * set on (issue #2181). Grouping is what pays for the row: the game was the most
 * repeated text on the screen and it is now written once per group, which is
 * also the row's longest and least predictable line gone.
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

  // Search and filter are this mount's state, so opening a scenario and coming
  // back shows the whole list again. Searching is how an author reaches one
  // scenario, and once they are in it the search has done its job. A list still
  // narrowed on the way back, with no address bar in a desktop app to say why,
  // is a list that looks like it has lost documents.
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<SourceFilter>("all");
  // Computed from the whole list rather than the filtered one, so the chips
  // stay put while the search box is typed into.
  const sources = useMemo(() => offeredSources(scenarios), [scenarios]);
  const groups = useMemo(
    () => groupScenariosByGame(filterScenarios(scenarios, query, source)),
    [scenarios, query, source],
  );
  const showAll = () => {
    setQuery("");
    setSource("all");
  };

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

  // The list is re-read in place, so a rescan that changes nothing looks exactly
  // like a click that did nothing. The spinning button used to say it was
  // running. From inside a menu that closes on select there is nothing left to
  // spin, so the toast carries it instead. A rescan that fails sets the page's
  // error and the banner above the list says so.
  const rescan = async () => {
    if (rescanning) return;
    setRescanning(true);
    try {
      await refresh();
      toast.success("Rescanned. The scenario list is up to date.");
    } finally {
      setRescanning(false);
    }
  };

  // Reclaiming is a preview first and a delete only on confirm, so what the menu
  // item opens is the preview. A fresh form every time, because the drawer keeps
  // the last one mounted and it would still be showing the count it found the
  // time before (issue #1395).
  const openReclaim = () =>
    drawer.open({
      title: "Reclaim dialogue clips",
      width: "24rem",
      content: (
        <ReclaimClipsForm key={nextDrawerKey()} onDone={() => drawer.close()} />
      ),
    });

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

  // A closure rather than a component, because a row needs the thumbnails, the
  // installed maps, the campaigns and all three menu actions, and passing six
  // props down one level to say the same thing is a worse row.
  const row = (loaded: LoadedScenario) => {
    const { scenario, source: from, origin } = loaded;
    // A bundled scenario is a distribution's own file, so it is listed and
    // exportable but not editable or deletable. Same treatment as a bundled
    // campaign.
    //
    // A game's own mission is listed with them and shares the read-only half,
    // but never offers Delete even when it is editable: taking a mission out of
    // a game puts the document back in coilbox's store, which is its own action
    // rather than a delete (issue #2160).
    const bundled = from === "bundled";
    const fromGame = from === "game";
    // A scenario with no game or no map cannot be launched, by anything. The
    // group heading and the second line already say which of the two is
    // missing, so the badge carries the consequence rather than repeating the
    // gap.
    const draft = !isSetUp(scenario);
    const inCampaigns = usedBy(scenario.id);
    // Null for a document written by an older build, or hand-edited, which can
    // carry no stamp at all. Dropping the segment beats "edited Invalid Date".
    const edited = relativeTime(scenario.updatedAt);
    return (
      <li
        key={scenario.id}
        className="group flex items-center gap-3 rounded-lg border border-border/50 bg-card p-3 transition-colors hover:border-primary/40 hover:bg-accent/50"
      >
        {/* The whole row opens the scenario, which is what nearly every click on
            one wants. A read-only scenario goes to the same route and lands on
            the read-only view there, which says why it cannot be edited, so no
            row is a dead click. */}
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
                <Badge variant="outline" className="shrink-0 text-[10px]">
                  Draft
                </Badge>
              )}
              {bundled && (
                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                  Bundled
                </span>
              )}
              {fromGame && origin && (
                <Badge variant="secondary" className="shrink-0 text-[10px]">
                  From {origin.gameName}
                </Badge>
              )}
              {/* Not a link. The whole row is already one, and an anchor inside
                  an anchor is a click target neither browsers nor screen readers
                  agree on. Naming the campaigns on hover costs no tab stop and
                  no nesting. */}
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
            {/* The map alone. The heading above the group names the game, so
                repeating it here would be the one piece of text the grouping
                was meant to stop repeating (issue #2181). */}
            <span className="truncate text-xs text-muted-foreground">
              {scenario.setup.mapName || "No map"}
            </span>
            {/* The chips and the edit time share one line, and the chips are
                what makes room for it. The edit time is a fact about the
                document, as the counts are, where the line above is about the
                engine setup. */}
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              <ScenarioContentChips scenario={scenario} />
              {edited && <span className="truncate">edited {edited}</span>}
            </span>
            {/* Only when the author wrote one. An empty line here would be a row
                that is taller for having said nothing. */}
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
  };

  return (
    <div className="flex flex-col gap-5 p-4">
      <PageHeader
        title="Scenario Builder"
        description="Author a mission's in-engine content: what spawns, what the triggers watch for, and what wins it. A scenario stands alone, so you can play one on its own or attach it to a campaign mission later."
        actions={
          <>
            {/* The two the page exists for. Getting hold of a scenario and
                starting one are what an author came here to do, so they are the
                only two the header spends a button on (issue #2184). */}
            <ScenarioImportButton
              onImported={(scenario) =>
                navigate(`/scenario-builder/${scenario.id}`)
              }
            />
            <Button className="gap-1.5" onClick={openNew}>
              <Plus className="size-4" /> New scenario
            </Button>
            {/* Rescan and Reclaim clips are housekeeping on the store behind the
                list rather than authoring, and they were sitting at the same
                weight as the two above. Three weights now: filled for New
                scenario, outlined for Import, and this one ghosted.

                Labelled "More" rather than drawn as three dots alone. A row's
                menu is explained by the row it sits on. A header menu has no
                such neighbour, so an unlabelled trigger here would be a control
                nobody can name without opening it.

                Ghost, not hidden. It is muted at rest and takes its background
                on hover or when open, which changes emphasis without ever
                changing whether it is there (issue #2203). */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  className="gap-1.5 text-muted-foreground data-[state=open]:text-foreground"
                  aria-label="More scenario actions"
                >
                  More <ChevronDown className="size-4" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem
                  disabled={rescanning}
                  onSelect={() => void rescan()}
                >
                  {rescanning ? (
                    <Loader2
                      className="size-4 animate-spin"
                      aria-hidden="true"
                    />
                  ) : (
                    <RefreshCw className="size-4" aria-hidden="true" />
                  )}
                  Rescan
                </DropdownMenuItem>
                {/* Not marked destructive, because this item deletes nothing.
                    It opens a dry run that names the count and the size, and
                    the confirm inside it is the destructive control. */}
                <DropdownMenuItem onSelect={openReclaim}>
                  <Trash2 className="size-4" aria-hidden="true" /> Reclaim clips
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      >
        {/* The filter row belongs to the header rather than the list, because it
            acts on the whole page and has to stay put when the list under it
            empties out. Hidden only when there is nothing at all to filter. */}
        {scenarios.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search scenarios…"
              aria-label="Search scenarios by name"
              className="h-8 w-56"
            />
            {/* Only when this machine has more than one kind. Most authors have
                only their own scenarios, and a chip that can match nothing is a
                control that has to be tried before it can be dismissed. */}
            {sources.length > 0 && (
              <ButtonGroup>
                <Button
                  size="sm"
                  variant={source === "all" ? "default" : "outline"}
                  aria-pressed={source === "all"}
                  onClick={() => setSource("all")}
                >
                  All
                </Button>
                {sources.map((s) => (
                  <Button
                    key={s}
                    size="sm"
                    variant={source === s ? "default" : "outline"}
                    aria-pressed={source === s}
                    onClick={() => setSource(s)}
                  >
                    {SOURCE_LABELS[s]}
                  </Button>
                ))}
              </ButtonGroup>
            )}
          </div>
        )}
      </PageHeader>

      {error && <ErrorBanner message={error} />}

      {loading ? (
        <SkeletonList />
      ) : scenarios.length === 0 ? (
        <EmptyState label="No scenarios yet. Start one with New scenario, or import a shared one." />
      ) : groups.length === 0 ? (
        // A list that just goes blank reads as documents having been lost, so
        // this counts what is still there and offers the way back in one click
        // rather than leaving somebody to work out which control hid them.
        <EmptyState
          label={
            <span className="flex flex-col items-center gap-2">
              <span>
                No scenarios match. All {scenarios.length} are still here.
              </span>
              <Button variant="outline" size="sm" onClick={showAll}>
                Show all scenarios
              </Button>
            </span>
          }
        />
      ) : (
        <div className="flex flex-col gap-5">
          {groups.map((group) => (
            <section key={group.gameName} className="flex flex-col gap-2">
              {/* The game, written once. Not uppercased: these are archive
                  names, often with a version in them, and they should read the
                  way they are written everywhere else in the app. */}
              <h2 className="px-1 text-xs font-semibold text-muted-foreground">
                {group.gameName || "No game yet"}
              </h2>
              <ul className="flex flex-col gap-2">
                {group.scenarios.map(row)}
              </ul>
            </section>
          ))}
        </div>
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
