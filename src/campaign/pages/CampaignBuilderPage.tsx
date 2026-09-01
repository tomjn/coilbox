import { Button, Input, useDrawer } from "@picoframe/frame";
import { open, save } from "@tauri-apps/plugin-dialog";
import { Download, Loader2, Plus, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { PageHeader } from "@/components/PageHeader";
import { Textarea } from "@/components/ui/textarea";
import { useUnitsyncScan } from "../../content/config";
import { ResolveContentGate } from "../../content/pages/components/ResolveContentDrawer";
import {
  EmptyState,
  ErrorBanner,
  SkeletonList,
} from "../../content/pages/components/states";
import {
  exactGameRequirement,
  exactMapRequirement,
} from "../../content/resolveContent";
import { useGamePresetParam } from "../../content/useGamePresetParam";
import { usePreferredTarget } from "../../play/config";
import {
  campaignDelete,
  campaignExport,
  campaignImport,
  campaignSave,
} from "../bindings";
import { refreshCampaigns, useCampaigns } from "../campaigns";
import { inlineCampaignImages, materializeCampaignImages } from "../images";
import type { Campaign } from "../model";
import {
  collectCampaignScenarioMedia,
  dropUnavailableDialogueMedia,
  restoreCampaignScenarioMedia,
} from "../scenarioMedia";
import {
  type CampaignExportContents,
  parseCampaignExport,
  wrapCampaignForExport,
} from "../transfer";
import { CampaignIconBox } from "./components/CampaignImage";
import { CampaignRowMenu } from "./components/CampaignRowMenu";

/** Every game+map a campaign's missions need installed, deduped by the shared
 * gate itself (#387) — a campaign with several missions on one game only
 * lists it once. */
function requirementsForCampaign(campaign: Campaign) {
  return campaign.missions.flatMap((m) => [
    exactGameRequirement(m.snapshot.gameName),
    exactMapRequirement(m.snapshot.mapName),
  ]);
}

/**
 * Campaign builder landing: create a new campaign, import a shared one, and list
 * every stored campaign. Every row opens the campaign. A local one also carries a
 * menu of Edit, Export and Delete, and a bundled one carries a badge and lands on
 * the editor's read-only view. Advanced-gated by its route.
 */
export default function CampaignBuilderPage() {
  const { campaigns, loading, error, refresh } = useCampaigns();
  const navigate = useNavigate();
  const drawer = useDrawer();
  const [busy, setBusy] = useState(false);
  const [rescanning, setRescanning] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const openNew = (initialTitle?: string) =>
    drawer.open({
      title: "New campaign",
      width: "28rem",
      content: (
        <NewCampaignForm
          initialTitle={initialTitle}
          onCreated={(id) => {
            drawer.close();
            navigate(`/campaign-builder/${id}`, { state: { presetGame } });
          }}
        />
      ),
    });

  // Game detail's "New campaign" action (issue #372) lands here with the game
  // preselected in the query string. There's no campaign-level game field (a
  // campaign's game is set per-mission from a preset), so this only seeds the
  // title and is carried forward to prefill the first "Add mission" picker.
  const presetGame = useGamePresetParam();
  // biome-ignore lint/correctness/useExhaustiveDependencies: run once when the preset arrives, not on every drawer identity change
  useEffect(() => {
    if (presetGame) openNew(`${presetGame} Campaign`);
  }, [presetGame]);

  const rescan = async () => {
    setRescanning(true);
    try {
      await refresh();
    } finally {
      setRescanning(false);
    }
  };

  const [pendingCampaign, setPendingCampaign] =
    useState<CampaignExportContents | null>(null);
  const { target, loading: targetLoading } = usePreferredTarget();
  // Read only for the modinfo shortname an export records beside the game's
  // archive name (issue #1335).
  const scan = useUnitsyncScan(target?.enginePath, target?.dataDir);

  // Mint a fresh id so importing never collides with an existing campaign,
  // materialize every inlined (data-URI) image (icon, background and each
  // mission's panorama + side graphic) to disk as files under the new id, write
  // any attached scenario's dialogue clips into the scenario media store, then
  // save. Only runs once every mission's game+map clears the resolve gate
  // (#387), so nothing is written to disk before that.
  const finishImport = async (parsed: CampaignExportContents) => {
    const id = crypto.randomUUID();
    const materialized = await materializeCampaignImages(parsed.campaign, id);
    const withMedia = parsed.media
      ? dropUnavailableDialogueMedia(
          materialized,
          await restoreCampaignScenarioMedia(parsed.media),
        )
      : materialized;
    const now = new Date().toISOString();
    const campaign: Campaign = {
      ...withMedia,
      id,
      createdAt: parsed.campaign.createdAt || now,
      updatedAt: now,
    };
    await campaignSave({ id, json: JSON.stringify(campaign) });
    await refreshCampaigns();
    navigate(`/campaign-builder/${id}`);
  };

  const importCampaign = async () => {
    setActionError(null);
    try {
      const src = await open({
        title: "Import campaign",
        multiple: false,
        filters: [{ name: "Coilbox campaign", extensions: ["json"] }],
      });
      if (typeof src !== "string") return;
      setBusy(true);
      const { json } = await campaignImport({ src });
      const parsed = parseCampaignExport(json);
      if (!parsed) {
        setActionError("That file isn't a valid coilbox campaign.");
        return;
      }
      setPendingCampaign(parsed);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // Failure is reported by the confirmation drawer that asked for the delete,
  // which is what somebody is looking at when it fails, so nothing is caught
  // here.
  const remove = async (id: string) => {
    await campaignDelete({ id });
    await refreshCampaigns();
  };

  // Export a local campaign to a single-file .json (issue #499: moved here from
  // the editor's own header, so a campaign can be shared without opening it).
  const exportCampaign = async (campaign: Campaign) => {
    setActionError(null);
    try {
      // Inline every stored image (icon, background, each mission's panorama and
      // side graphic) as a data URI, and read every attached scenario's dialogue
      // clips out of the media store, so the export is one self-contained file
      // that still plays its radio messages elsewhere (#769).
      const [inlined, media] = await Promise.all([
        inlineCampaignImages(campaign),
        collectCampaignScenarioMedia(campaign),
      ]);
      const file = wrapCampaignForExport(
        inlined,
        media,
        scan.data?.games ?? [],
      );
      const dest = await save({
        title: "Export campaign",
        defaultPath: `${campaign.title || "campaign"}.json`,
        filters: [{ name: "Coilbox campaign", extensions: ["json"] }],
      });
      if (!dest) return;
      await campaignExport({ json: JSON.stringify(file, null, 2), dest });
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="flex flex-col gap-5 p-4">
      <PageHeader
        title="Campaign Builder"
        description={
          "Author a sequence of skirmish missions from your saved presets. " +
          "Local campaigns are editable; bundled campaigns are read-only."
        }
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
            <Button
              variant="outline"
              className="gap-1.5"
              onClick={importCampaign}
              disabled={busy}
            >
              <Download className="size-4" /> Import
            </Button>
            <Button className="gap-1.5" onClick={() => openNew()}>
              <Plus className="size-4" /> New campaign
            </Button>
          </>
        }
      />

      {actionError && <ErrorBanner message={actionError} />}
      {error && <ErrorBanner message={error} />}

      {loading ? (
        <SkeletonList />
      ) : campaigns.length === 0 ? (
        <EmptyState label="No campaigns yet. Start one with New campaign, or import a shared one." />
      ) : (
        <ul className="flex flex-col gap-2">
          {campaigns.map(({ campaign, source }) => {
            const bundled = source === "bundled";
            return (
              <li
                key={campaign.id}
                className="group flex items-center gap-3 rounded-lg border border-border/50 bg-card p-3 transition-colors hover:border-primary/40 hover:bg-accent/50"
              >
                {/* The whole row opens the campaign, which is what nearly every
                    click on one wants. A bundled campaign goes to the same
                    route and lands on the read-only view there, which says why
                    it cannot be edited, so no row is a dead click. */}
                <Link
                  to={`/campaign-builder/${campaign.id}`}
                  className="flex min-w-0 flex-1 items-center gap-3"
                >
                  <CampaignIconBox
                    campaignId={campaign.id}
                    icon={campaign.icon}
                  />
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">
                        {campaign.title}
                      </span>
                      {bundled && (
                        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                          Bundled
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {campaign.missions.length} mission
                      {campaign.missions.length === 1 ? "" : "s"}
                    </span>
                  </div>
                </Link>
                {/* A bundled campaign gets no menu because it may do none of
                    these three. Issue #2191 wants Export offered on one, which
                    is a decision about bundled content rather than about the
                    menu. */}
                {!bundled && (
                  <CampaignRowMenu
                    campaign={campaign}
                    onExport={() => void exportCampaign(campaign)}
                    onDelete={() => remove(campaign.id)}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}

      {pendingCampaign && (
        <ResolveContentGate
          title="Set up this campaign"
          requirements={requirementsForCampaign(pendingCampaign.campaign)}
          target={target ?? undefined}
          targetLoading={targetLoading}
          onContinue={() =>
            finishImport(pendingCampaign).then(() => setPendingCampaign(null))
          }
          onCancel={() => setPendingCampaign(null)}
        />
      )}
    </div>
  );
}

/**
 * The new-campaign form, shown in the drawer behind the New campaign button.
 * It saves the empty campaign itself, the same way the conquest hub's generate
 * form does, so the page only has to open the editor on the id it hands back.
 */
function NewCampaignForm({
  onCreated,
  initialTitle,
}: {
  onCreated: (id: string) => void;
  /** Seed from game detail's "New campaign" action (issue #372). */
  initialTitle?: string;
}) {
  const [title, setTitle] = useState(initialTitle ?? "");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    const trimmed = title.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const now = new Date().toISOString();
      const campaign: Campaign = {
        schemaVersion: 1,
        id: crypto.randomUUID(),
        type: "ta",
        title: trimmed,
        description: description.trim(),
        missions: [],
        createdAt: now,
        updatedAt: now,
      };
      await campaignSave({ id: campaign.id, json: JSON.stringify(campaign) });
      await refreshCampaigns();
      onCreated(campaign.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <Input
        value={title}
        placeholder="Title"
        onChange={(e) => setTitle(e.target.value)}
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
        disabled={!title.trim() || busy}
      >
        <Plus className="size-4" /> {busy ? "Creating…" : "Create"}
      </Button>
    </div>
  );
}
