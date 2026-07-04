import { Button, Input, useDrawer } from "@picoframe/frame";
import { save } from "@tauri-apps/plugin-dialog";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Pencil,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { Textarea } from "@/components/ui/textarea";
import type { SkirmishDraft } from "@/play/drafts";
import { type SkirmishPreset, useSkirmishPresets } from "@/play/presets";
import {
  DetailLoading,
  ErrorBanner,
  NotFound,
} from "../../content/pages/components/states";
import { campaignExport, campaignImageDelete, campaignSave } from "../bindings";
import { refreshCampaigns, useCampaigns } from "../campaigns";
import type { Campaign, CampaignMission } from "../model";
import { resolvePanoramaDataUri } from "../panorama";
import { wrapCampaignForExport } from "../transfer";
import { MissionEditorDrawer } from "./components/MissionEditorDrawer";
import { PresetPickerDrawer } from "./components/PresetPickerDrawer";

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

/** Editor for one local campaign: its fields, ordered mission list, and export. */
export default function CampaignEditPage() {
  const { id } = useParams();
  const { campaigns, loading } = useCampaigns();
  const { presets } = useSkirmishPresets();
  const drawer = useDrawer();

  const loaded = campaigns.find((c) => c.campaign.id === id);
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [loadedId, setLoadedId] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  // Seed the editable copy once the (local) campaign for this id is available,
  // and re-seed if the route id changes under the same component instance.
  useEffect(() => {
    if (loaded?.source === "local" && loadedId !== loaded.campaign.id) {
      setCampaign(loaded.campaign);
      setLoadedId(loaded.campaign.id);
    }
  }, [loaded, loadedId]);

  const persist = useCallback(async (next: Campaign) => {
    const stamped: Campaign = { ...next, updatedAt: new Date().toISOString() };
    setCampaign(stamped);
    try {
      await campaignSave({ id: stamped.id, json: JSON.stringify(stamped) });
      await refreshCampaigns();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
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

  const move = (index: number, dir: -1 | 1) => {
    const j = index + dir;
    if (j < 0 || j >= campaign.missions.length) return;
    const missions = campaign.missions.slice();
    [missions[index], missions[j]] = [missions[j], missions[index]];
    void persist({ ...campaign, missions });
  };

  const removeMission = async (m: CampaignMission) => {
    if (m.panorama?.kind === "file") {
      await campaignImageDelete({
        campaignId: campaign.id,
        file: m.panorama.file,
      }).catch(() => {});
    }
    void persist({
      ...campaign,
      missions: campaign.missions.filter((x) => x.id !== m.id),
    });
  };

  const applyMission = async (updated: CampaignMission) => {
    const prev = campaign.missions.find((x) => x.id === updated.id);
    // The original panorama file is superseded — delete it now that we're saving.
    if (
      prev?.panorama?.kind === "file" &&
      (updated.panorama?.kind !== "file" ||
        updated.panorama.file !== prev.panorama.file)
    ) {
      await campaignImageDelete({
        campaignId: campaign.id,
        file: prev.panorama.file,
      }).catch(() => {});
    }
    await persist({
      ...campaign,
      missions: campaign.missions.map((x) =>
        x.id === updated.id ? updated : x,
      ),
    });
  };

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
          onPick={(preset) =>
            void persist({
              ...campaign,
              missions: [...campaign.missions, missionFromPreset(preset)],
            })
          }
        />
      ),
    });

  const exportCampaign = async () => {
    setError(null);
    try {
      // Inline every file panorama as a data URI so the export is self-contained.
      const missions = await Promise.all(
        campaign.missions.map(async (m) => {
          if (m.panorama?.kind !== "file") return m;
          try {
            const dataUri = await resolvePanoramaDataUri(
              campaign.id,
              m.panorama.file,
            );
            return {
              ...m,
              panorama: { kind: "data" as const, dataUri },
            };
          } catch {
            return { ...m, panorama: undefined };
          }
        }),
      );
      const file = wrapCampaignForExport({ ...campaign, missions });
      const dest = await save({
        title: "Export campaign",
        defaultPath: `${campaign.title || "campaign"}.json`,
        filters: [{ name: "Coilbox campaign", extensions: ["json"] }],
      });
      if (!dest) return;
      await campaignExport({ json: JSON.stringify(file, null, 2), dest });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="flex flex-col gap-5 p-4">
      <Link
        to={BACK}
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline"
      >
        <ArrowLeft className="size-3.5" /> Back to campaigns
      </Link>

      {error && <ErrorBanner message={error} />}

      <header className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <Input
            aria-label="Campaign title"
            value={campaign.title}
            onChange={(e) =>
              setCampaign((c) => (c ? { ...c, title: e.target.value } : c))
            }
            onBlur={() => void persist(campaign)}
            className="text-base font-semibold"
          />
          <Textarea
            aria-label="Campaign description"
            value={campaign.description}
            placeholder="Description"
            className="min-h-16"
            onChange={(e) =>
              setCampaign((c) =>
                c ? { ...c, description: e.target.value } : c,
              )
            }
            onBlur={() => void persist(campaign)}
          />
        </div>
        <Button variant="outline" className="gap-1.5" onClick={exportCampaign}>
          <Upload className="size-4" /> Export
        </Button>
      </header>

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-medium">
            Missions ({campaign.missions.length})
          </h2>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={openPresetPicker}
          >
            <Plus className="size-4" /> Add mission
          </Button>
        </div>

        {campaign.missions.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            No missions yet. Add one from a saved skirmish preset.
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {campaign.missions.map((m, i) => (
              <li
                key={m.id}
                className="flex items-center gap-3 rounded-lg border border-border/50 bg-card p-3"
              >
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
                    {m.skippable ? " · skippable" : ""}
                  </span>
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
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Remove ${m.title}`}
                    onClick={() => void removeMission(m)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
