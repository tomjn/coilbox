import { Button, Input } from "@picoframe/frame";
import { open } from "@tauri-apps/plugin-dialog";
import { Download, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
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
import { usePreferredTarget } from "../../play/config";
import { campaignDelete, campaignImport, campaignSave } from "../bindings";
import { refreshCampaigns, useCampaigns } from "../campaigns";
import { materializeCampaignImages } from "../images";
import type { Campaign } from "../model";
import { parseCampaignExport } from "../transfer";
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
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const create = async () => {
    const trimmed = title.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setActionError(null);
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
      setTitle("");
      setDescription("");
      navigate(`/campaign-builder/${campaign.id}`);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const [pendingCampaign, setPendingCampaign] = useState<Campaign | null>(null);
  const { target } = usePreferredTarget();

  // Mint a fresh id so importing never collides with an existing campaign,
  // materialize every inlined (data-URI) image — icon, background and each
  // mission's panorama + side graphic — to disk as files under the new id,
  // then save. Only runs once every mission's game+map clears the resolve
  // gate (#387) — nothing is written to disk before that.
  const finishImport = async (parsed: Campaign) => {
    const id = crypto.randomUUID();
    const materialized = await materializeCampaignImages(parsed, id);
    const now = new Date().toISOString();
    const campaign: Campaign = {
      ...materialized,
      id,
      createdAt: parsed.createdAt || now,
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

  return (
    <div className="flex flex-col gap-5 p-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">Campaign Builder</h1>
        <p className="text-sm text-muted-foreground">
          Author a sequence of skirmish missions from your saved presets. Local
          campaigns are editable; bundled campaigns are read-only.
        </p>
      </header>

      {actionError && <ErrorBanner message={actionError} />}
      {error && <ErrorBanner message={error} />}

      <section className="flex flex-col gap-3 rounded-lg border border-border/50 bg-card p-4">
        <h2 className="text-sm font-medium">New campaign</h2>
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
        <div className="flex gap-2">
          <Button
            className="gap-1.5"
            onClick={create}
            disabled={!title.trim() || busy}
          >
            <Plus className="size-4" /> Create
          </Button>
          <Button
            variant="outline"
            className="gap-1.5"
            onClick={importCampaign}
            disabled={busy}
          >
            <Download className="size-4" /> Import
          </Button>
        </div>
      </section>

      {loading ? (
        <SkeletonList />
      ) : campaigns.length === 0 ? (
        <EmptyState label="No campaigns yet. Create or import one above." />
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
                  <span className="text-xs text-muted-foreground/80">
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

      {!loading && (
        <button
          type="button"
          onClick={refresh}
          className="self-start text-xs text-muted-foreground hover:underline"
        >
          Refresh
        </button>
      )}

      {pendingCampaign && (
        <ResolveContentGate
          title="Set up this campaign"
          requirements={requirementsForCampaign(pendingCampaign)}
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
