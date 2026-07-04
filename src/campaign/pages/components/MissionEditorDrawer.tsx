import { Button, Input, useDrawer } from "@picoframe/frame";
import { open } from "@tauri-apps/plugin-dialog";
import { Image, Plus, Trash2, X } from "lucide-react";
import { useRef, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { campaignImageDelete, campaignImageImport } from "../../bindings";
import type { CampaignMission } from "../../model";
import { CampaignImage, CampaignImageField } from "./CampaignImage";
import { PanoramaScroller } from "./PanoramaScroller";
import { UnitRestrictions } from "./UnitRestrictions";

/**
 * Drawer body for editing one campaign mission. Holds the edit in local state and
 * commits it via `onApply` (which persists the whole campaign) — so a cancelled
 * drawer leaves the stored campaign untouched.
 *
 * Panorama handling is the one exception that touches disk before Apply: picking an
 * image imports it immediately (the plugin needs a real file). To avoid orphaning
 * files, an image imported *this session* that is then replaced/removed is deleted
 * at once (it was never saved); the mission's *original* panorama file is left for
 * the parent to delete on Apply, so cancelling never dangles a saved reference.
 */
export function MissionEditorDrawer({
  campaignId,
  mission: initial,
  onApply,
}: {
  campaignId: string;
  mission: CampaignMission;
  onApply: (mission: CampaignMission) => Promise<void>;
}) {
  const drawer = useDrawer();
  const [mission, setMission] = useState<CampaignMission>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Panorama files imported during this drawer session (safe to delete on replace).
  const sessionFiles = useRef<Set<string>>(new Set());

  const patch = (p: Partial<CampaignMission>) =>
    setMission((m) => ({ ...m, ...p }));

  // Drop an unsaved session import if the panorama currently points at one.
  const discardSessionPanorama = () => {
    const cur = mission.panorama;
    if (cur?.kind === "file" && sessionFiles.current.has(cur.file)) {
      sessionFiles.current.delete(cur.file);
      void campaignImageDelete({ campaignId, file: cur.file }).catch(() => {});
    }
  };

  const pickImage = async () => {
    setError(null);
    try {
      const src = await open({
        title: "Choose panorama image",
        multiple: false,
        filters: [
          { name: "Image", extensions: ["png", "jpg", "jpeg", "webp", "bmp"] },
        ],
      });
      if (typeof src !== "string") return;
      const { file } = await campaignImageImport({ campaignId, srcPath: src });
      discardSessionPanorama();
      sessionFiles.current.add(file);
      patch({ panorama: { kind: "file", file } });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const removeImage = () => {
    discardSessionPanorama();
    patch({ panorama: undefined });
  };

  const setObjective = (i: number, value: string) =>
    patch({
      objectives: mission.objectives.map((o, j) => (j === i ? value : o)),
    });
  const addObjective = () => patch({ objectives: [...mission.objectives, ""] });
  const removeObjective = (i: number) =>
    patch({ objectives: mission.objectives.filter((_, j) => j !== i) });

  const apply = async () => {
    setSaving(true);
    setError(null);
    try {
      // Drop blank objective lines the user added but never filled in.
      const cleaned: CampaignMission = {
        ...mission,
        title: mission.title.trim() || "Untitled mission",
        objectives: mission.objectives.map((o) => o.trim()).filter(Boolean),
      };
      await onApply(cleaned);
      drawer.close();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex flex-col gap-2">
        <label htmlFor="mission-title" className="text-sm font-medium">
          Title
        </label>
        <Input
          id="mission-title"
          value={mission.title}
          onChange={(e) => patch({ title: e.target.value })}
        />
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="mission-subtitle" className="text-sm font-medium">
          Subtitle
        </label>
        <Input
          id="mission-subtitle"
          value={mission.subtitle ?? ""}
          placeholder="Location line shown under the title"
          onChange={(e) => patch({ subtitle: e.target.value || undefined })}
        />
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="mission-briefing" className="text-sm font-medium">
          Briefing
        </label>
        <Textarea
          id="mission-briefing"
          value={mission.briefing}
          className="min-h-28"
          onChange={(e) => patch({ briefing: e.target.value })}
        />
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Objectives</span>
        <ul className="flex flex-col gap-1.5">
          {mission.objectives.map((o, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: objectives are a plain ordered string list with no stable id
            <li key={i} className="flex items-center gap-1.5">
              <Input
                value={o}
                placeholder={`Objective ${i + 1}`}
                onChange={(e) => setObjective(i, e.target.value)}
              />
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Remove objective ${i + 1}`}
                onClick={() => removeObjective(i)}
              >
                <X className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
        <Button
          size="sm"
          variant="outline"
          className="self-start gap-1.5"
          onClick={addObjective}
        >
          <Plus className="size-4" /> Add objective
        </Button>
      </div>

      {/* biome-ignore lint/a11y/noLabelWithoutControl: wraps the <Switch> control (implicit label association) */}
      <label className="flex items-center justify-between gap-2 text-sm">
        <span className="flex flex-col">
          <span className="font-medium">Skippable</span>
          <span className="text-xs text-muted-foreground">
            Playable even if the previous mission is incomplete.
          </span>
        </span>
        <Switch
          checked={mission.skippable}
          onCheckedChange={(v) => patch({ skippable: v })}
        />
      </label>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Panorama</span>
        <p className="text-xs text-muted-foreground">
          The briefing backdrop. Use art that tiles horizontally for a seamless
          looping scroll.
        </p>
        {mission.panorama && (
          <PanoramaScroller
            campaignId={campaignId}
            panorama={mission.panorama}
          />
        )}
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={pickImage}
          >
            <Image className="size-4" />{" "}
            {mission.panorama ? "Replace image" : "Choose image"}
          </Button>
          {mission.panorama && (
            <Button
              size="sm"
              variant="ghost"
              className="gap-1.5"
              onClick={removeImage}
            >
              <Trash2 className="size-4" /> Remove
            </Button>
          )}
        </div>
      </div>

      <CampaignImageField
        campaignId={campaignId}
        kind="sideGraphic"
        value={mission.sideGraphic}
        onChange={(sideGraphic) => patch({ sideGraphic })}
        label="Side graphic"
        help="Optional still image shown beside the briefing (e.g. a unit render or emblem). Transparency is kept."
        preview={
          <div className="rounded-md border border-border/50 bg-muted p-2">
            <CampaignImage
              campaignId={campaignId}
              image={mission.sideGraphic}
              alt=""
              className="mx-auto max-h-40 object-contain"
            />
          </div>
        }
      />

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Unit restrictions</span>
        <UnitRestrictions
          gameName={mission.snapshot.gameName}
          disabledUnits={mission.disabledUnits}
          onChange={(disabledUnits) => patch({ disabledUnits })}
        />
      </div>

      <div className="sticky bottom-0 flex justify-end gap-2 border-t border-border/50 bg-background py-3">
        <Button variant="outline" onClick={() => drawer.close()}>
          Cancel
        </Button>
        <Button onClick={apply} disabled={saving}>
          {saving ? "Saving…" : "Apply"}
        </Button>
      </div>
    </div>
  );
}
