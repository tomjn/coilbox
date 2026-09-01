import { Button, Input, useDrawer } from "@picoframe/frame";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Copy,
  Pencil,
  Plus,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useParams } from "react-router";
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
import { deleteDroppedMedia } from "../media";
import { missionFromScenario, scenarioAttachment } from "../missionScenario";
import type { Campaign, CampaignMission } from "../model";
import { CampaignImage, CampaignImageField } from "./components/CampaignImage";
import { DECORATIVE_DEFAULTS, PlaybackTuning } from "./components/MediaPlayer";
import { MissionEditorDrawer } from "./components/MissionEditorDrawer";
import { MissionRemoveButton } from "./components/MissionRemoveButton";
import { MissionScenarioUpdateButton } from "./components/MissionScenarioUpdateButton";
import { PanoramaScroller } from "./components/PanoramaScroller";
import { PresetPickerDrawer } from "./components/PresetPickerDrawer";
import { type SaveState, SaveStatus } from "./components/SaveStatus";
import { ScenarioPickerDrawer } from "./components/ScenarioPicker";

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

  const loaded = campaigns.find((c) => c.campaign.id === id);
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [loadedId, setLoadedId] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [save, setSave] = useState<SaveState>({ kind: "idle" });

  // Seed the editable copy once the (local) campaign for this id is available,
  // and re-seed if the route id changes under the same component instance.
  useEffect(() => {
    if (loaded?.source === "local" && loadedId !== loaded.campaign.id) {
      setCampaign(loaded.campaign);
      setLoadedId(loaded.campaign.id);
    }
  }, [loaded, loadedId]);

  // One queue for the whole editing session, so writes land in the order they
  // were asked for and only the newest one reports (issue #2221). Every write
  // carries the whole document, so two of them in flight at once left whichever
  // the plugin happened to finish last in the file. See `documentSaver.ts`.
  const saver = useRef<DocumentSaver<Campaign>>(undefined);
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
      onWritten: async () => {
        setError(null);
        setSave({ kind: "saved", at: new Date() });
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

  const move = (index: number, dir: -1 | 1) => {
    const j = index + dir;
    if (j < 0 || j >= campaign.missions.length) return;
    const missions = campaign.missions.slice();
    [missions[index], missions[j]] = [missions[j], missions[index]];
    void persist({ ...campaign, missions });
  };

  /** Persist, having taken off disk whatever the new document stops naming.
   *  Every edit that can drop or replace an imported file comes through here,
   *  because a slot the delete forgets leaks a file nothing on this page can
   *  see again (issue #2210). `media.ts` owns which slots those are. */
  const persistMedia = async (next: Campaign) => {
    await deleteDroppedMedia(campaign.id, campaign, next);
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

  const openMission = (m: CampaignMission) =>
    drawer.open({
      title: `Edit mission: ${m.title}`,
      width: "46rem",
      content: (
        <MissionEditorDrawer
          campaignId={campaign.id}
          mission={m}
          onApply={applyMission}
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
        <SaveStatus state={save} onRetry={() => void persist(campaign)} />
      </div>

      {error && <ErrorBanner message={error} />}

      <header className="flex flex-col gap-3">
        <Input
          aria-label="Campaign title"
          value={campaign.title}
          onChange={(e) => edit((c) => ({ ...c, title: e.target.value }))}
          onBlur={() => void persist(campaign)}
          className="text-base font-semibold"
        />
        <Textarea
          aria-label="Campaign description"
          value={campaign.description}
          placeholder="Description"
          className="min-h-16"
          onChange={(e) => edit((c) => ({ ...c, description: e.target.value }))}
          onBlur={() => void persist(campaign)}
        />
      </header>

      <section className="grid gap-4 rounded-lg border border-border/50 bg-card p-4 sm:grid-cols-2">
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
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-medium">
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

        {campaign.missions.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            No missions yet. Add one from a saved skirmish preset, or from a
            scenario.
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {campaign.missions.map((m, i) => {
              const thumb = thumbs.get(m.snapshot.mapName)?.url;
              const attachment = scenarioAttachment(m, scenarios);
              return (
                <li
                  key={m.id}
                  className="overflow-hidden rounded-lg border border-border/50 bg-card"
                >
                  {/* Header strip: the mission panorama, with the map minimap
                      overlaid so a mission is identifiable at a glance. */}
                  <div className="relative h-20">
                    {m.panorama ? (
                      <PanoramaScroller
                        campaignId={campaign.id}
                        panorama={m.panorama}
                        className="h-20 rounded-none"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center bg-muted text-xs text-muted-foreground">
                        No panorama
                      </div>
                    )}
                    {thumb && (
                      <img
                        src={thumb}
                        alt=""
                        className="absolute right-2 top-2 size-16 rounded border border-black/50 object-cover shadow-md"
                      />
                    )}
                  </div>

                  <div className="flex items-center gap-3 p-3">
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
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="truncate text-sm font-medium">
                        {i + 1}. {m.title}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {m.subtitle ? `${m.subtitle} · ` : ""}
                        {m.snapshot.gameName || "No game"} ·{" "}
                        {m.snapshot.mapName || "No map"}
                        {m.scenario ? ` · scenario: ${m.scenario.name}` : ""}
                        {m.skippable ? " · skippable" : ""}
                      </span>
                      {attachment.state === "stale" && (
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs text-amber-600 dark:text-amber-500">
                            The scenario has been edited since this copy was
                            attached.
                          </span>
                          <MissionScenarioUpdateButton
                            mission={m}
                            attachment={attachment}
                            onUpdate={applyMission}
                          />
                        </div>
                      )}
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
          </ul>
        )}
      </section>
    </div>
  );
}
