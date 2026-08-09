import { Button, Input, useDrawer } from "@picoframe/frame";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  Download,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
 * every stored campaign. Local campaigns are editable and deletable; bundled ones
 * are read-only (a badge, no actions). Advanced-gated by its route.
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
  const { target } = usePreferredTarget();
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

  const remove = async (id: string) => {
    setActionError(null);
    try {
      await campaignDelete({ id });
      await refreshCampaigns();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    }
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
      const file = wrapCampaignForExport(inlined, media, scan.data?.games ?? []);
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
      <header className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-lg font-semibold">Campaign Builder</h1>
          <p className="text-sm text-muted-foreground">
            Author a sequence of skirmish missions from your saved presets.
            Local campaigns are editable; bundled campaigns are read-only.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
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
        </div>
      </header>

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
                className="flex items-center gap-3 rounded-lg border border-border/50 bg-card p-3"
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
                {!bundled && (
                  <div className="ml-auto flex shrink-0 items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5"
                      onClick={() =>
                        navigate(`/campaign-builder/${campaign.id}`)
                      }
                    >
                      <Pencil className="size-4" /> Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5"
                      onClick={() => void exportCampaign(campaign)}
                    >
                      <Upload className="size-4" /> Export
                    </Button>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`Delete ${campaign.title}`}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="flex w-56 flex-col gap-2">
                        <p className="text-sm">
                          Delete{" "}
                          <span className="font-medium">{campaign.title}</span>{" "}
                          and its images? This can't be undone.
                        </p>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => remove(campaign.id)}
                        >
                          Delete
                        </Button>
                      </PopoverContent>
                    </Popover>
                  </div>
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
