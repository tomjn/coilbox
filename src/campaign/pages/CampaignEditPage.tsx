import { Button, Input, useDrawer } from "@picoframe/frame";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ChevronRight,
  Copy,
  Eye,
  GripVertical,
  Pencil,
  Plus,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import { type SaveState, SaveStatus } from "@/components/SaveStatus";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useUnitsyncThumbnails } from "@/content/config";
import { refIsVideo } from "@/lib/assetUrl";
import { createDocumentSaver, type DocumentSaver } from "@/lib/documentSaver";
import { usePreferredTarget } from "@/play/config";
import type { SkirmishDraft } from "@/play/drafts";
import { type SkirmishPreset, useSkirmishPresets } from "@/play/presets";
import { useScenarios } from "@/scenario/scenarios";
import {
  DetailLoading,
  ErrorBanner,
  NotFound,
} from "../../content/pages/components/states";
import { campaignSave } from "../bindings";
import { refreshCampaigns, useCampaigns } from "../campaigns";
import { copyTitle } from "../duplicate";
import { campaignUnplayableReason } from "../listing";
import { campaignMediaFiles, deleteUnnamedMedia } from "../media";
import { missionFromScenario, scenarioAttachment } from "../missionScenario";
import type { Campaign, CampaignMission } from "../model";
import { CampaignImage, CampaignImageField } from "./components/CampaignImage";
import { DECORATIVE_DEFAULTS, PlaybackTuning } from "./components/MediaPlayer";
import { MissionEditorDrawer } from "./components/MissionEditorDrawer";
import { MissionFacts, MissionSetup } from "./components/MissionFacts";
import { MissionPositionField } from "./components/MissionPositionField";
import { MissionRemoveButton } from "./components/MissionRemoveButton";
import { MissionScenarioUpdateButton } from "./components/MissionScenarioUpdateButton";
import { useMissionDrag } from "./components/missionDrag";
import { PanoramaScroller } from "./components/PanoramaScroller";
import { PresetPickerDrawer } from "./components/PresetPickerDrawer";
import {
  presentationOpen,
  presentationSummary,
  useStoredPresentationOpen,
} from "./components/presentationOpen";
import { ScenarioPickerDrawer } from "./components/ScenarioPicker";
import { StaleScenarioBadge } from "./components/StaleScenarioBadge";

const BACK = "/campaign-builder";

/** Build a fresh mission from a preset, deep-copying its setup into the snapshot. */
function missionFromPreset(preset: SkirmishPreset): CampaignMission {
  // structuredClone so the snapshot is a true copy — later preset edits never
  // reach through into an already-attached mission.
  const snapshot: SkirmishDraft = structuredClone({
    participants: preset.participants,
    gameName: preset.gameName,
    mapName: preset.mapName,
    startPosType: preset.startPosType,
    modOptionValues: preset.modOptionValues,
  });
  return {
    id: crypto.randomUUID(),
    title: preset.name,
    briefing: "",
    objectives: [],
    snapshot,
    disabledUnits: [],
    skippable: false,
  };
}

/**
 * A copy of one mission, for the row's Duplicate action (issue #2196).
 *
 * The whole mission is deep-copied, so the copy's scenario, its launch snapshot
 * and its objectives are its own. Two missions sharing one scenario object would
 * hold until something edited it in place, and then the edit would land on both.
 *
 * What it does *not* copy is the media. A ref names a bare file in the
 * campaign's own `images/<id>/` or `media/<id>/` folder, and the copy is in that
 * same campaign, so both missions read the same file and the copy shows the
 * original's panorama straight away. Writing a second set of bytes would double
 * the disk for a variant whose art is almost always the same art, and it would
 * mean a round trip through the `coilbox://` protocol that can fail, on an
 * action that otherwise cannot. Deleting either mission afterwards is safe:
 * `droppedMediaFiles` asks what the whole document still names, so a file the
 * other mission plays is kept.
 */
export function duplicateMission(
  mission: CampaignMission,
  taken: Iterable<string>,
): CampaignMission {
  return {
    ...structuredClone(mission),
    id: crypto.randomUUID(),
    title: copyTitle(mission.title, taken),
  };
}

/**
 * Where a dragged mission would land, drawn along the edge of the card it
 * would land against (issue #2262).
 *
 * The author has to see the answer before letting go, not after, so this is
 * the one thing on the page that has to be readable at a glance mid-gesture:
 * a solid accent bar in the app's own primary colour, with a ring in the page
 * background behind it so it stays visible over a mission's panorama art as
 * well as over a plain card.
 */
function DropLine({ atEnd = false }: { atEnd?: boolean }) {
  return (
    <span
      data-drop-line={atEnd ? "end" : "before"}
      aria-hidden="true"
      className={`absolute inset-x-0 z-10 h-1 rounded-full bg-primary ring-1 ring-background ${
        atEnd ? "bottom-0" : "top-0"
      }`}
    />
  );
}

/** Editor for one local campaign: its fields, ordered mission list, and export. */
export default function CampaignEditPage() {
  const { id } = useParams();
  const { campaigns, loading } = useCampaigns();
  const { presets } = useSkirmishPresets();
  const { scenarios: loadedScenarios } = useScenarios();
  // The documents alone: a campaign mission attaches a copy of one, and where
  // it came from makes no difference to that.
  const scenarios = loadedScenarios.map((l) => l.scenario);
  const drawer = useDrawer();
  // Map minimaps for the mission-row thumbnails, keyed by map name.
  const { target } = usePreferredTarget();
  const { thumbs } = useUnitsyncThumbnails(target?.enginePath, target?.dataDir);
  // The game preselected from game detail's "New campaign" action (issue
  // #372), carried through navigation state from the create step. Scopes the
  // first "Add mission from preset" picker to that game by default.
  const location = useLocation();
  const presetGame = (location.state as { presetGame?: string } | null)
    ?.presetGame;
  const navigate = useNavigate();

  const loaded = campaigns.find((c) => c.campaign.id === id);
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [loadedId, setLoadedId] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  // A view preference, not part of the document, so it never goes through
  // `persist` (issue #2194). See `presentationOpen.ts`.
  const [storedArtOpen, setStoredArtOpen] = useStoredPresentationOpen();
  // What the mission list last did, for the live region below it (issue
  // #2394). Reordering rewrites the list in place and moves nothing on screen
  // that a screen reader is looking at, so without this a mission moved by an
  // arrow, by a drag or by a typed position is a change nobody is told about.
  const [said, say] = useState("");

  // Seed the editable copy once the (local) campaign for this id is available,
  // and re-seed if the route id changes under the same component instance.
  useEffect(() => {
    if (loaded?.source === "local" && loadedId !== loaded.campaign.id) {
      setCampaign(loaded.campaign);
      setLoadedId(loaded.campaign.id);
      // `undeleted` only ever initialised when empty, so it never noticed
      // this id change and kept folding the newly opened campaign's files
      // into the old campaign's pending clean-up (issue #2385). A write
      // already queued for the old campaign still lands and still writes
      // its own document correctly, but its delete pass is given up on here.
      // Losing that one delete is a smaller loss than handing another
      // campaign's filenames to it.
      undeleted.current = null;
      // None of `writeFailed`, `error` or `save` carry a campaign id either,
      // so a write refused for the old campaign was still on screen once
      // this page opened the new one: its own "Not saved" banner, the old
      // campaign's error message, and a Preview button held disabled by
      // `writeFailed.current` (issue #2386). This only runs on the id
      // actually changing, not on every render, so a genuine failure on the
      // campaign still being edited stays up until its own next write
      // resolves.
      writeFailed.current = false;
      setError(null);
      setSave({ kind: "idle" });
    }
  }, [loaded, loadedId]);

  // One queue for the whole editing session, so writes land in the order they
  // were asked for and only the newest one reports (issue #2221). Every write
  // carries the whole document, so two of them in flight at once left whichever
  // the plugin happened to finish last in the file. See `documentSaver.ts`.
  const saver = useRef<DocumentSaver<Campaign>>(undefined);
  // Whether the last write the saver reported on was refused. `save` is state,
  // so a handler that waits for a write reads it as it was before that write
  // and never after it. Preview is the one thing here that has to know.
  const writeFailed = useRef(false);
  // Every file any document has named since the first media edit this session
  // that is still on disk, or null when nothing is owed (issue #2232). Files
  // rather than one document, because a file imported and then replaced
  // before either edit reaches disk is named by neither the oldest document
  // nor the newest, so comparing just those two missed it (issue #2374). Each
  // `persistMedia` call folds in the files of both the document it started
  // from and the one it is asking for, so a file that only ever existed in a
  // document that never reached disk is still remembered.
  //
  // The campaign id travels with the set, and the set itself is cleared by
  // the seeding effect above the moment that id changes, because this ref
  // outlives a route change under the same component instance (issue
  // #2385). Without both, a route change while a write is still in flight
  // could fold the newly opened campaign's files into the old campaign's
  // pending clean-up, and a write for one campaign landing could then be
  // handed filenames that only ever lived in another campaign's folder.
  const undeleted = useRef<{ id: string; files: Set<string> } | null>(null);
  if (!saver.current) {
    saver.current = createDocumentSaver<Campaign>({
      write: async (document) => {
        await campaignSave({ id: document.id, json: JSON.stringify(document) });
        // The plugin stores what it is handed, so the document written is the
        // document now on disk.
        return document;
      },
      // Only reached for the newest write, so nothing here can claim a
      // superseded document saved.
      onWritten: async (written) => {
        writeFailed.current = false;
        setError(null);
        setSave({ kind: "saved", at: new Date() });
        // The document on disk is now this one, so whatever it stopped naming
        // can go. Deleting before the write was the loss in issue #2232: a
        // refused write left the stored campaign pointing at a file that had
        // already gone. `written.id` rather than the campaign in scope, because
        // the saver is built on the first render and that render has no
        // campaign yet, and because a delete owed by one campaign must not
        // reach into another's folder.
        const dropped = undeleted.current;
        undeleted.current = null;
        if (dropped?.id === written.id) {
          await deleteUnnamedMedia(written.id, dropped.files, written);
        }
        // Re-reading the campaign list is what keeps the sidebar and the
        // campaigns page in step, and it is a separate read. One that fails
        // leaves those stale but says nothing about whether the edit reached
        // disk, so counting it as a failed save would send the author to retry
        // a write that worked.
        try {
          await refreshCampaigns();
        } catch (e) {
          console.error("campaign list refresh failed", e);
        }
      },
      onError: (e) => {
        writeFailed.current = true;
        setError(e instanceof Error ? e.message : String(e));
        setSave({ kind: "failed" });
      },
    });
  }

  /** Show a document and queue it for disk. Every edit on this page comes
   *  through here, because there is no save button to defer one to. Resolves
   *  once the queue has drained, which is what the mission drawer waits on
   *  before it closes. */
  const persist = useCallback(async (next: Campaign) => {
    const stamped: Campaign = { ...next, updatedAt: new Date().toISOString() };
    setCampaign(stamped);
    setSave({ kind: "saving" });
    saver.current?.save(stamped);
    await saver.current?.settled();
  }, []);

  /** Take the mission at `from` out of the list and put it back at `to`.
   *
   *  The one reorder on this page. The arrow buttons call it a step at a time,
   *  a dragged row calls it with wherever it was dropped, and a typed position
   *  calls it with the position typed, so all three write the same way and
   *  none of them can drift from the others. Which is also why the
   *  announcement is made here and not in any of the three: whichever one the
   *  author reached for, the same sentence says what happened. It sits up here
   *  with the hooks rather than beside the other mission actions because the
   *  drag hook below is a hook, and the page returns early further down. */
  const moveTo = useCallback(
    (from: number, to: number) => {
      if (!campaign) return;
      if (from === to || to < 0 || to >= campaign.missions.length) return;
      const missions = campaign.missions.slice();
      const [carried] = missions.splice(from, 1);
      if (!carried) return;
      missions.splice(to, 0, carried);
      say(
        `Moved ${carried.title} to position ${to + 1} of ${missions.length}.`,
      );
      void persist({ ...campaign, missions });
    },
    [campaign, persist],
  );
  const { drag, listProps } = useMissionDrag(moveTo);

  if (loading && !campaign) return <DetailLoading backTo={BACK} />;
  if (loaded?.source === "bundled") {
    return (
      <div className="flex flex-col gap-4 p-4">
        <Link
          to={BACK}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline"
        >
          <ArrowLeft className="size-3.5" /> Back
        </Link>
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          This campaign is bundled and read-only. Import it or create a new one
          to edit.
        </div>
      </div>
    );
  }
  if (!campaign) return <NotFound backTo={BACK} label="campaign" />;

  /** Change the document without writing it. The text boxes edit as they are
   *  typed in and only persist on blur, so until then what is on screen is
   *  ahead of what is on disk and the indicator has to say so. */
  const edit = (change: (c: Campaign) => Campaign) => {
    setCampaign((c) => (c ? change(c) : c));
    setSave({ kind: "unsaved" });
  };

  const move = (index: number, dir: -1 | 1) => moveTo(index, index + dir);

  /** Persist, and take off disk whatever the new document stops naming once
   *  that document is the one on disk. Every edit that can drop or replace an
   *  imported file comes through here, because a slot the delete forgets leaks
   *  a file nothing on this page can see again (issue #2210). `media.ts` owns
   *  which slots those are.
   *
   *  What is remembered is the files, not the document: a second drop made
   *  while the first is unwritten is owed too, and a file that arrives and
   *  leaves again inside that window is named by neither the document that
   *  window started from nor the one it ends on, so comparing only those two
   *  missed it (issue #2374). Folding both this edit's `campaign` and its
   *  `next` into the running set catches it either way, and a file some later
   *  edit names again stays in the set but is then kept, because the delete
   *  only ever drops what the written document does not name. The delete
   *  itself is `onWritten`'s, because that is the one place that knows a
   *  write landed and which document landed. An author who gives up on a
   *  refused write leaves the files on disk, which is the failure worth
   *  having. */
  const persistMedia = async (next: Campaign) => {
    undeleted.current ??= { id: campaign.id, files: new Set() };
    for (const file of campaignMediaFiles(campaign)) {
      undeleted.current.files.add(file);
    }
    for (const file of campaignMediaFiles(next)) {
      undeleted.current.files.add(file);
    }
    await persist(next);
  };

  /** Copy the mission at `index` in directly after it.
   *
   *  After the original rather than at the end, because array order is play
   *  order: a variant of mission 3 appended to a ten-mission campaign is a
   *  mission the author now has to walk back up the list, and it reads as
   *  mission 11 until they do. Nothing is deleted or replaced, so this goes
   *  through `persist` rather than `persistMedia`. */
  const duplicateMissionAt = (index: number) => {
    const missions = campaign.missions.slice();
    const source = missions[index];
    if (!source) return;
    const copy = duplicateMission(
      source,
      missions.map((x) => x.title),
    );
    missions.splice(index + 1, 0, copy);
    void persist({ ...campaign, missions });
  };

  /**
   * Open the page a player opens: the campaign's detail page, or one mission's
   * briefing (issue #2197).
   *
   * These are the player's own pages, reached by their own routes. Drawing a
   * copy of them in the editor was the alternative and it is the worse one:
   * the copy would drift from the real page the first time either changed, and
   * a preview that differs from the page it claims to show teaches the author
   * something false. Nothing needs building for that, because neither route is
   * gated. `/campaign/:id` renders any stored campaign, finished or not, and a
   * briefing is reachable by id whether or not the player's own progress has
   * unlocked it. That is the whole point of the per-mission link. The detail
   * page locks everything past the first mission, so without it an author has
   * no way to look at mission five's art at all.
   *
   * Getting back is the top bar's Back button, so the editor is one click away
   * and there is no return trip to build either.
   *
   * The wait is the part that matters. The title and description boxes only
   * write on blur, so the click that opens the preview is racing the write
   * that the same click's blur just asked for. Draining the queue first is
   * what stops the preview showing the document as it was a keystroke ago.
   * A refused write stays put: the header is showing "Not saved" with the
   * retry beside it, and leaving would take that retry away and show a page
   * built from the older document on disk.
   */
  const openPreview = async (missionId?: string) => {
    await saver.current?.settled();
    if (writeFailed.current) return;
    const to = `/campaign/${encodeURIComponent(campaign.id)}`;
    navigate(missionId ? `${to}/${encodeURIComponent(missionId)}` : to);
  };

  const removeMission = (m: CampaignMission) =>
    persistMedia({
      ...campaign,
      missions: campaign.missions.filter((x) => x.id !== m.id),
    });

  const applyMission = (updated: CampaignMission) =>
    persistMedia({
      ...campaign,
      missions: campaign.missions.map((x) =>
        x.id === updated.id ? updated : x,
      ),
    });

  // The scenario list goes with the mission (issue #2392). The drawer's
  // Scenario group starts shut, and its summary cannot ask whether the attached
  // copy has fallen behind without reading every stored scenario, which is the
  // content scan that shutting the group avoids paying for (issue #2265). This
  // page has already read them, for the row's own "Out of date" badge, so the
  // answer costs the drawer nothing on the way in.
  const openMission = (m: CampaignMission) =>
    drawer.open({
      title: `Edit mission: ${m.title}`,
      width: "46rem",
      content: (
        <MissionEditorDrawer
          campaignId={campaign.id}
          mission={m}
          scenarios={scenarios}
          onSave={applyMission}
        />
      ),
    });

  const openPresetPicker = () =>
    drawer.open({
      title: "Add mission from preset",
      width: "32rem",
      content: (
        <PresetPickerDrawer
          presets={presets}
          initialGameName={
            campaign.missions.length === 0 ? presetGame : undefined
          }
          onPick={(preset) =>
            void persist({
              ...campaign,
              missions: [...campaign.missions, missionFromPreset(preset)],
            })
          }
        />
      ),
    });

  const openScenarioPicker = () =>
    drawer.open({
      title: "Add mission from scenario",
      width: "32rem",
      content: (
        <ScenarioPickerDrawer
          scenarios={scenarios}
          initialGameName={
            campaign.missions.length === 0 ? presetGame : undefined
          }
          onPick={(scenario) =>
            void persist({
              ...campaign,
              missions: [...campaign.missions, missionFromScenario(scenario)],
            })
          }
        />
      ),
    });

  return (
    <div className="flex flex-col gap-5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link
          to={BACK}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline"
        >
          <ArrowLeft className="size-3.5" /> Back to campaigns
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <SaveStatus state={save} onRetry={() => void persist(campaign)} />
          {/* A campaign with no missions has no row to click in the play list
              either (issue #2219), so there is no page for a player to open
              and nothing here to show them. The other way a campaign is
              unfinished, a mission short a game or a map, keeps its link
              there, so it keeps this one. */}
          {campaign.missions.length === 0 && (
            <span className="text-xs text-muted-foreground">
              {campaignUnplayableReason(campaign)}
            </span>
          )}
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            disabled={campaign.missions.length === 0}
            onClick={() => void openPreview()}
          >
            <Eye className="size-4" /> Preview
          </Button>
        </div>
      </div>

      {error && <ErrorBanner message={error} />}

      {/* The top of the page is the campaign, not a form (issue #2193). Both
          boxes used to be bare bordered inputs with nothing saying what either
          one was for, and a lone bordered box across the top of a page is the
          shape of a search field.

          The title is now the page's heading and is still edited where it
          sits, the way the lego builder edits a unit's name
          (`src/lego/pages/BuilderPage.tsx`): a real input carrying no box of
          its own, drawn at the size the campaign's own detail page draws the
          same string, showing its border on hover and on keyboard focus. It
          stays an input rather than becoming text that swaps for one on click,
          so it is in the tab order already and there is no edit mode for a
          keyboard to have to find. Enter leaves the box, which is what writes
          it, so renaming never needs the mouse.

          It is also the page's first `h1`. There were two `h2`s below and
          nothing above them, so the outline started at level two.

          The description keeps its box and gains a visible label instead. It
          is a field about the campaign rather than the campaign's identity,
          and a second borderless line would leave an empty description with
          nothing to see and no affordance at all. */}
      <header className="flex flex-col gap-3">
        <h1>
          <Input
            aria-label="Campaign title"
            value={campaign.title}
            placeholder="Untitled campaign"
            onChange={(e) => edit((c) => ({ ...c, title: e.target.value }))}
            onBlur={() => void persist(campaign)}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            className="-mx-2 h-auto border-transparent bg-transparent px-2 py-1 text-lg font-semibold shadow-none hover:border-border focus-visible:border-border"
          />
        </h1>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="campaign-description" className="text-sm font-medium">
            Description
          </Label>
          <Textarea
            id="campaign-description"
            value={campaign.description}
            placeholder="What this campaign is about. Players read it on the campaign's own page."
            className="min-h-16"
            onChange={(e) =>
              edit((c) => ({ ...c, description: e.target.value }))
            }
            onBlur={() => void persist(campaign)}
          />
        </div>
      </header>

      {/* The art is set once and the missions are edited constantly, so the
          pickers start out of the way and say what they are hiding (issue
          #2194). An empty campaign opens them, because there is nothing below
          them to be in the way of. */}
      <Collapsible
        open={presentationOpen(storedArtOpen, campaign.missions.length)}
        onOpenChange={setStoredArtOpen}
        className="flex flex-col gap-2"
      >
        <h2 className="text-base font-semibold">
          <CollapsibleTrigger className="group flex w-full items-center gap-2 rounded-md py-1 text-left hover:text-foreground/80">
            <ChevronRight className="size-4 shrink-0 transition-transform group-data-[state=open]:rotate-90" />
            Presentation
            <span className="truncate text-xs font-normal text-muted-foreground">
              {presentationSummary(!!campaign.icon, !!campaign.background)}
            </span>
          </CollapsibleTrigger>
        </h2>

        <CollapsibleContent className="grid gap-4 rounded-lg border border-border/50 bg-card p-4 sm:grid-cols-2">
          <CampaignImageField
            campaignId={campaign.id}
            kind="icon"
            value={campaign.icon}
            onChange={(icon) => void persistMedia({ ...campaign, icon })}
            label="Icon"
            help="Small emblem shown on this campaign in lists. Transparency is kept."
            gameName={campaign.missions[0]?.snapshot.gameName}
            preview={
              <div className="flex size-20 items-center justify-center overflow-hidden rounded-md border border-border/50 bg-muted">
                <CampaignImage
                  campaignId={campaign.id}
                  image={campaign.icon}
                  alt=""
                  className="size-full object-contain p-1.5"
                />
              </div>
            }
          />
          <CampaignImageField
            campaignId={campaign.id}
            kind="background"
            value={campaign.background}
            onChange={(background) =>
              void persistMedia({ ...campaign, background })
            }
            label="Background"
            help="Backdrop behind the campaign's mission list — an image or a looping video. A video imported here only plays back on this machine (it isn't bundled into a single-file export)."
            gameName={campaign.missions[0]?.snapshot.gameName}
            allowVideo
            preview={
              <div className="overflow-hidden rounded-md border border-border/50 bg-muted">
                <CampaignImage
                  campaignId={campaign.id}
                  image={campaign.background}
                  alt=""
                  className="h-24 w-full object-cover"
                />
              </div>
            }
          />
          {refIsVideo(campaign.background) && (
            <PlaybackTuning
              playback={campaign.backgroundPlayback}
              defaults={DECORATIVE_DEFAULTS}
              decorative
              showAutoplay
              showLoop
              showMuted
              onChange={(backgroundPlayback) =>
                void persist({ ...campaign, backgroundPlayback })
              }
            />
          )}
        </CollapsibleContent>
      </Collapsible>

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold">
            Missions ({campaign.missions.length})
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={openPresetPicker}
            >
              <Plus className="size-4" /> From preset
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={openScenarioPicker}
            >
              <Plus className="size-4" /> From scenario
            </Button>
          </div>
        </div>

        {/* What just happened to the order (issue #2394). A reorder rewrites
            the list under the author without moving anything they are reading,
            so a screen reader has nothing to notice unless the page says it.
            One region for the whole list rather than one per row, because the
            rows are the very things that move and a live region that is moved
            in the document is not one that reliably speaks.

            Mounted whether or not there is anything to say, because a live
            region only announces text that changes in an element already in
            the DOM, the lesson `SaveStatus` documents. Not `role="status"`,
            which `SaveStatus` already carries at the top of this page: a
            second one would make "the status region" ambiguous both to a
            screen reader and to a test asking for it by role.

            A live region only speaks when its text changes, so asking twice
            running for the very same sentence is said once. Two reorders in a
            row cannot produce it, because a mission asked to move to where it
            already is does not move. Typing the same refused position twice
            can, and that is the one case this says nothing about. */}
        <p aria-live="polite" aria-atomic="true" className="sr-only">
          {said}
        </p>

        {campaign.missions.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            No missions yet. Add one from a saved skirmish preset, or from a
            scenario.
          </div>
        ) : (
          <ul
            {...listProps}
            className={`flex flex-col gap-3 ${drag ? "select-none" : ""}`}
          >
            {campaign.missions.map((m, i) => {
              const thumb = thumbs.get(m.snapshot.mapName)?.url;
              const attachment = scenarioAttachment(m, scenarios);
              return (
                <li
                  key={m.id}
                  data-mission-row={i}
                  className={`relative overflow-hidden rounded-lg border border-border/50 bg-card ${
                    drag?.from === i ? "opacity-50" : ""
                  }`}
                >
                  {/* Where the mission lands if it is let go now (issue
                      #2262). Drawn on the card it would land above, and on
                      the bottom edge of the last card for the end of the
                      list, because the card is clipped to its own rounded
                      corners and a line in the gap between two cards would be
                      cut off by both. */}
                  {drag?.gap === i && <DropLine />}
                  {drag?.gap === campaign.missions.length &&
                    i === campaign.missions.length - 1 && <DropLine atEnd />}
                  {/* Header strip: the mission panorama, with the map minimap
                      overlaid so a mission is identifiable at a glance. With
                      no panorama the minimap is the mission's real identity,
                      so it fills a slimmer band instead of a full-height strip
                      captioning the absence. With neither, there is nothing
                      to show and the strip is skipped rather than left as an
                      empty band. */}
                  {(m.panorama || thumb) && (
                    <div className={m.panorama ? "relative h-20" : "h-10"}>
                      {m.panorama ? (
                        <PanoramaScroller
                          campaignId={campaign.id}
                          panorama={m.panorama}
                          className="h-20 rounded-none"
                        />
                      ) : (
                        <img
                          src={thumb}
                          alt=""
                          className="h-10 w-full rounded-none object-cover"
                        />
                      )}
                      {m.panorama && thumb && (
                        <img
                          src={thumb}
                          alt=""
                          className="absolute right-2 top-2 size-16 rounded border border-black/50 object-cover shadow-md"
                        />
                      )}
                    </div>
                  )}

                  <div className="flex items-center gap-3 p-3">
                    {/* Drag to reorder (issue #2262). A handle rather than the
                        whole card, so selecting a title or pressing one of the
                        row's five buttons never starts a drag by accident.

                        It is hidden from a screen reader and stays out of the
                        tab order on purpose. The two arrow buttons beside it
                        do the same move, they are named, and they work without
                        a pointer, which a drag never can. A focusable handle
                        would only add a tab stop that does nothing when it is
                        reached. */}
                    <span
                      data-drag-handle
                      aria-hidden="true"
                      title="Drag to reorder"
                      className="flex size-8 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground active:cursor-grabbing"
                    >
                      <GripVertical className="size-4" />
                    </span>
                    <div className="flex flex-col">
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Move ${m.title} up`}
                        disabled={i === 0}
                        onClick={() => move(i, -1)}
                      >
                        <ArrowUp className="size-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Move ${m.title} down`}
                        disabled={i === campaign.missions.length - 1}
                        onClick={() => move(i, 1)}
                      >
                        <ArrowDown className="size-4" />
                      </Button>
                    </div>
                    {/* One press to reach any position, for the author who
                        cannot drag (issue #2394). Beside the arrows rather
                        than under them, because a third control stacked in
                        that column would make every row taller and a
                        ten-mission campaign is already longer than the
                        window. */}
                    <MissionPositionField
                      index={i}
                      count={campaign.missions.length}
                      title={m.title}
                      onMove={(to) => moveTo(i, to)}
                      onSay={say}
                    />
                    <div className="flex min-w-0 flex-col gap-1">
                      {/* The only bold line on the card: everything below is
                          one muted metadata row, so a scan down the list reads
                          titles first and details only on demand. */}
                      <span className="truncate text-sm font-semibold">
                        {i + 1}. {m.title}
                      </span>
                      <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
                        {/* Against the title, because that is where the
                            briefing screen puts it: a location line under the
                            name. */}
                        {m.subtitle && (
                          <>
                            <span className="truncate">{m.subtitle}</span>
                            <span aria-hidden="true">·</span>
                          </>
                        )}
                        <MissionSetup snapshot={m.snapshot} />
                        <span aria-hidden="true">·</span>
                        <MissionFacts mission={m} />
                        {/* The same badge the mission editor's Scenario
                            heading carries, on the same answer this row
                            already worked out (issue #2392). */}
                        {attachment.state === "stale" && (
                          <>
                            <StaleScenarioBadge />
                            <MissionScenarioUpdateButton
                              mission={m}
                              attachment={attachment}
                              onUpdate={applyMission}
                            />
                          </>
                        )}
                      </div>
                    </div>
                    <div className="ml-auto flex shrink-0 items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5"
                        onClick={() => openMission(m)}
                      >
                        <Pencil className="size-4" /> Edit
                      </Button>
                      {/* Straight to this mission's briefing, because the
                          detail page will not take the author there: it locks
                          every mission the player has not reached. */}
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Preview ${m.title}`}
                        onClick={() => void openPreview(m.id)}
                      >
                        <Eye className="size-4" />
                      </Button>
                      {/* No confirmation, the way campaign duplication has
                          none: a copy takes nothing away, and removing it is
                          one click on the row it just made. */}
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Duplicate ${m.title}`}
                        onClick={() => duplicateMissionAt(i)}
                      >
                        <Copy className="size-4" />
                      </Button>
                      <MissionRemoveButton
                        mission={m}
                        others={campaign.missions.filter((x) => x.id !== m.id)}
                        scenarios={scenarios}
                        onRemove={() => removeMission(m)}
                      />
                    </div>
                  </div>
                </li>
              );
            })}
            {/* The header's two actions, repeated where the mission they add
                actually lands. A long campaign scrolls the header out of
                view, so without this a tenth mission means scrolling up to
                reach the buttons and back down to see what they made. */}
            <li className="flex flex-wrap items-center justify-center gap-2 rounded-lg border border-dashed border-border/50 p-3">
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={openPresetPicker}
              >
                <Plus className="size-4" /> From preset
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={openScenarioPicker}
              >
                <Plus className="size-4" /> From scenario
              </Button>
            </li>
          </ul>
        )}
      </section>
    </div>
  );
}
