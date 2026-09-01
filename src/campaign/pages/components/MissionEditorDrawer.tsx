import { Button, Input, useDrawer } from "@picoframe/frame";
import { open } from "@tauri-apps/plugin-dialog";
import { Image, Plus, Trash2, X } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useGameUnits } from "@/content/useGameUnits";
import {
  UnitGameProvider,
  UnitPickerButton,
} from "../../../content/pages/components/UnitPicker";
import { mediaKind, refIsVideo } from "../../../lib/assetUrl";
import {
  campaignImageImport,
  campaignMediaDelete,
  campaignMediaImport,
} from "../../bindings";
import { missionMedia } from "../../media";
import type {
  CampaignMission,
  ImageRef,
  MapPreviewConfig,
  UnitPreviewConfig,
} from "../../model";
import {
  SLOT_SOURCE_OPTIONS,
  type SlotConfigs,
  slotSourceValue,
  sourceToSlot,
} from "../../slots";
import { ArchiveMediaImportButton } from "./ArchiveMediaImportButton";
import { CampaignImage, CampaignImageField } from "./CampaignImage";
import {
  CUE_DEFAULTS,
  DECORATIVE_DEFAULTS,
  PlaybackTuning,
} from "./MediaPlayer";
import {
  MissionMapBackground,
  MissionMapSideGraphic,
} from "./MissionMapPreview";
import { MissionAvField } from "./MissionMediaFields";
import { MissionScenarioField } from "./MissionScenarioField";
import {
  MissionUnitBackground,
  MissionUnitSideGraphic,
} from "./MissionUnitPreview";
import { PanoramaScroller } from "./PanoramaScroller";
import { UnitRestrictions } from "./UnitRestrictions";
import { useMissionUnit } from "./useMissionUnit";

/** A one-line source picker for a panorama or side-graphic slot. */
function SlotSourceSelect({
  value,
  onValueChange,
}: {
  value: string;
  onValueChange: (value: string) => void;
}) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger size="sm" className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {SLOT_SOURCE_OPTIONS.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Speed and direction for a spinning slot, which the map and the unit share. */
function SpinControls({
  spinSpeed,
  onChange,
}: {
  spinSpeed: number | undefined;
  onChange: (spinSpeed: number) => void;
}) {
  const spin = spinSpeed ?? 1;
  const magnitude = Math.abs(spin);
  const reversed = spin < 0;
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className="font-medium">Spin speed</span>
          <span className="font-mono text-muted-foreground">
            {magnitude.toFixed(2)}×
          </span>
        </div>
        <Slider
          min={0.25}
          max={4}
          step={0.25}
          value={[magnitude]}
          onValueChange={([v]) => onChange(reversed ? -v : v)}
          aria-label="Spin speed"
        />
      </div>
      {/* biome-ignore lint/a11y/noLabelWithoutControl: wraps the <Switch> control (implicit label association) */}
      <label className="flex items-center justify-between gap-2 text-xs">
        <span className="font-medium">Reverse spin</span>
        <Switch
          checked={reversed}
          onCheckedChange={(v) => onChange((v ? -1 : 1) * magnitude)}
        />
      </label>
    </>
  );
}

/** Spin-speed + water tuning shown when a slot renders the map preview. */
function MapPreviewTuning({
  config,
  onChange,
}: {
  config: MapPreviewConfig;
  onChange: (config: MapPreviewConfig) => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-md border border-border/50 bg-muted/20 p-3">
      <SpinControls
        spinSpeed={config.spinSpeed}
        onChange={(spinSpeed) => onChange({ ...config, spinSpeed })}
      />
      {/* biome-ignore lint/a11y/noLabelWithoutControl: wraps the <Switch> control (implicit label association) */}
      <label className="flex items-center justify-between gap-2 text-xs">
        <span className="font-medium">Water</span>
        <Switch
          checked={config.water ?? true}
          onCheckedChange={(v) => onChange({ ...config, water: v })}
        />
      </label>
    </div>
  );
}

/**
 * Everything the unit source needs in one block: which of the mission's game's
 * units to show, how fast it turns, and a live preview of the slot it will fill.
 *
 * The picker is the scenario editor's, against the mission's own
 * `snapshot.gameName`, so a mission can only ever name a unit from the game it
 * launches. An install that cannot draw the chosen unit says so here, because
 * the briefing will quietly fall back to the slot's image and the author is the
 * only one who can act on it.
 */
function UnitSlotEditor({
  gameName,
  variant,
  config,
  onChange,
}: {
  gameName: string;
  variant: "background" | "side";
  config: UnitPreviewConfig;
  onChange: (config: UnitPreviewConfig) => void;
}) {
  const { units, loading, gameMissing } = useGameUnits(gameName);
  const unit = useMissionUnit(gameName, config);

  return (
    <UnitGameProvider gameName={gameName}>
      <div className="flex flex-col gap-3 rounded-md border border-border/50 bg-muted/20 p-3">
        <UnitPickerButton
          units={units}
          value={config.unitDef}
          onValueChange={(unitDef) => onChange({ ...config, unitDef })}
          loading={loading}
          placeholder="Pick a unit"
          size="sm"
        />
        <SpinControls
          spinSpeed={config.spinSpeed}
          onChange={(spinSpeed) => onChange({ ...config, spinSpeed })}
        />
      </div>
      {gameMissing ? (
        <p className="text-xs text-muted-foreground">
          {gameName} is not installed here, so its units can't be listed.
        </p>
      ) : unit.unavailable ? (
        <p className="text-xs text-muted-foreground">
          {gameName} has no model for "{config.unitDef}". The briefing will show
          this slot's image instead.
        </p>
      ) : (
        config.unitDef !== "" && (
          <PreviewBox>
            {variant === "background" ? (
              <MissionUnitBackground model={unit.model} config={config} />
            ) : (
              <MissionUnitSideGraphic model={unit.model} config={config} />
            )}
          </PreviewBox>
        )
      )}
    </UnitGameProvider>
  );
}

/** A framed, fixed-height box for an in-editor live 3D preview. */
function PreviewBox({ children }: { children: ReactNode }) {
  return (
    <div className="h-48 overflow-hidden rounded-md border border-border/50 bg-gradient-to-br from-slate-900 to-slate-950">
      {children}
    </div>
  );
}

/**
 * Drawer body for editing one campaign mission. Holds the edit in local state and
 * commits it via `onApply` (which persists the whole campaign) — so a cancelled
 * drawer leaves the stored campaign untouched.
 *
 * Media is the exception that touches disk before Apply: picking a file imports it
 * immediately, because the plugin needs a real file before anything can play it. So
 * a file imported *this session* and then replaced or emptied out is deleted at
 * once, in any of the four slots (it was never saved, and the page behind cannot
 * clean it up: its diff works from the stored document, which never named it). The
 * mission's *already-saved* files are left for the parent to delete on Apply, so
 * cancelling never dangles a saved reference.
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
  // Files imported during this drawer session (safe to delete on replace).
  const sessionFiles = useRef<Set<string>>(new Set());

  const patch = (p: Partial<CampaignMission>) =>
    setMission((m) => ({ ...m, ...p }));

  // Each slot's two 3D configs, as `slots.ts` reasons about them. Writing the
  // pair back together is what keeps a slot from holding two sources at once.
  const panoramaSlot: SlotConfigs = {
    map: mission.panoramaMap,
    unit: mission.panoramaUnit,
  };
  const sideGraphicSlot: SlotConfigs = {
    map: mission.sideGraphicMap,
    unit: mission.sideGraphicUnit,
  };
  const patchSlot = (
    slot: "panorama" | "sideGraphic",
    source: string,
    prev: SlotConfigs,
  ) => {
    const next = sourceToSlot(source, prev);
    patch(
      slot === "panorama"
        ? { panoramaMap: next.map, panoramaUnit: next.unit }
        : { sideGraphicMap: next.map, sideGraphicUnit: next.unit },
    );
  };

  /** Remember an import this session made, so replacing it can take it off disk. */
  const trackImport = (ref?: ImageRef) => {
    if (ref?.kind === "file") sessionFiles.current.add(ref.file);
  };

  // An import this session made and then replaced or emptied out was never
  // saved, so nothing will ever name it again and it goes now. Reads the same
  // slot list `media.ts` deletes through, because the slot this forgot is what
  // left every voiceover and cutscene on disk (issue #2210). A video was copied
  // verbatim into `media/`, so this has to be the delete that reaches both
  // folders.
  useEffect(() => {
    const named = new Set(missionMedia(mission).map((m) => m.file));
    for (const file of sessionFiles.current) {
      if (named.has(file)) continue;
      sessionFiles.current.delete(file);
      campaignMediaDelete({ campaignId, file }).catch((e) => {
        console.error("could not delete campaign media", file, e);
      });
    }
  }, [mission, campaignId]);

  const pickImage = async () => {
    setError(null);
    try {
      const src = await open({
        title: "Choose panorama image or video",
        multiple: false,
        filters: [
          {
            name: "Image or video",
            extensions: [
              "png",
              "jpg",
              "jpeg",
              "webp",
              "bmp",
              "mp4",
              "webm",
              "mov",
              "ogv",
            ],
          },
        ],
      });
      if (typeof src !== "string") return;
      // A video backdrop is copied verbatim; an image is re-encoded/downscaled.
      const { file } =
        mediaKind(src) === "video"
          ? await campaignMediaImport({ campaignId, srcPath: src })
          : await campaignImageImport({ campaignId, srcPath: src });
      sessionFiles.current.add(file);
      patch({ panorama: { kind: "file", file } });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const removeImage = () => patch({ panorama: undefined });

  // Same session-import bookkeeping as `pickImage`'s success path, just sourced
  // from the archive picker instead of the OS file dialog.
  const importPanoramaFromArchive = (file: string) => {
    sessionFiles.current.add(file);
    patch({ panorama: { kind: "file", file } });
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
        <Alert variant="destructive" className="p-2">
          <AlertDescription className="text-destructive">
            {error}
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-col gap-2">
        <Label htmlFor="mission-title" className="text-sm font-medium">
          Title
        </Label>
        <Input
          id="mission-title"
          value={mission.title}
          onChange={(e) => patch({ title: e.target.value })}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="mission-subtitle" className="text-sm font-medium">
          Subtitle
        </Label>
        <Input
          id="mission-subtitle"
          value={mission.subtitle ?? ""}
          placeholder="Location line shown under the title"
          onChange={(e) => patch({ subtitle: e.target.value || undefined })}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="mission-briefing" className="text-sm font-medium">
          Briefing
        </Label>
        <p className="text-xs text-muted-foreground">
          Markdown supported. Embed bundled media with{" "}
          <code className="font-mono">![](images/art.jpg)</code> — image, audio
          or video by file extension.
        </p>
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

      <MissionScenarioField mission={mission} onChange={setMission} />

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Panorama</span>
        <p className="text-xs text-muted-foreground">
          The briefing backdrop: a horizontally-tiling image, a looping muted
          video, the mission's map as a full-screen spinning 3D preview, or one
          of the game's units turning on the spot.
        </p>
        <SlotSourceSelect
          value={slotSourceValue(panoramaSlot)}
          onValueChange={(v) => patchSlot("panorama", v, panoramaSlot)}
        />
        {mission.panoramaMap ? (
          <>
            <MapPreviewTuning
              config={mission.panoramaMap}
              onChange={(panoramaMap) => patch({ panoramaMap })}
            />
            <PreviewBox>
              <MissionMapBackground
                mapName={mission.snapshot.mapName}
                config={mission.panoramaMap}
              />
            </PreviewBox>
          </>
        ) : mission.panoramaUnit ? (
          <UnitSlotEditor
            gameName={mission.snapshot.gameName}
            variant="background"
            config={mission.panoramaUnit}
            onChange={(panoramaUnit) => patch({ panoramaUnit })}
          />
        ) : (
          <>
            {mission.panorama && (
              <PanoramaScroller
                campaignId={campaignId}
                panorama={mission.panorama}
                playback={mission.panoramaPlayback}
              />
            )}
            {mission.panorama &&
              (refIsVideo(mission.panorama) ? (
                <PlaybackTuning
                  playback={mission.panoramaPlayback}
                  defaults={DECORATIVE_DEFAULTS}
                  decorative
                  showAutoplay
                  showLoop
                  showMuted
                  onChange={(panoramaPlayback) => patch({ panoramaPlayback })}
                />
              ) : (
                <PlaybackTuning
                  playback={mission.panoramaPlayback}
                  defaults={DECORATIVE_DEFAULTS}
                  showScroll
                  onChange={(panoramaPlayback) => patch({ panoramaPlayback })}
                />
              ))}
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={pickImage}
              >
                <Image className="size-4" />{" "}
                {mission.panorama ? "Replace media" : "Choose image or video"}
              </Button>
              <ArchiveMediaImportButton
                campaignId={campaignId}
                gameName={mission.snapshot.gameName}
                mediaType="image"
                onImported={importPanoramaFromArchive}
              />
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
          </>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Side graphic</span>
        <p className="text-xs text-muted-foreground">
          Shown beside the briefing card: a still image, a looping muted video,
          or the mission's map or one of the game's units as a drag-to-rotate
          spinning preview layered over the backdrop.
        </p>
        <SlotSourceSelect
          value={slotSourceValue(sideGraphicSlot)}
          onValueChange={(v) => patchSlot("sideGraphic", v, sideGraphicSlot)}
        />
        {mission.sideGraphicMap ? (
          <>
            <MapPreviewTuning
              config={mission.sideGraphicMap}
              onChange={(sideGraphicMap) => patch({ sideGraphicMap })}
            />
            <PreviewBox>
              <MissionMapSideGraphic
                mapName={mission.snapshot.mapName}
                config={mission.sideGraphicMap}
              />
            </PreviewBox>
          </>
        ) : mission.sideGraphicUnit ? (
          <UnitSlotEditor
            gameName={mission.snapshot.gameName}
            variant="side"
            config={mission.sideGraphicUnit}
            onChange={(sideGraphicUnit) => patch({ sideGraphicUnit })}
          />
        ) : (
          <>
            <CampaignImageField
              campaignId={campaignId}
              kind="sideGraphic"
              value={mission.sideGraphic}
              onChange={(sideGraphic) => {
                trackImport(sideGraphic);
                patch({ sideGraphic });
              }}
              label="Image or video"
              help="A unit render or emblem, for example. Image transparency is kept; a video loops muted."
              gameName={mission.snapshot.gameName}
              allowVideo
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
            {refIsVideo(mission.sideGraphic) && (
              <PlaybackTuning
                playback={mission.sideGraphicPlayback}
                defaults={DECORATIVE_DEFAULTS}
                decorative
                showAutoplay
                showLoop
                showMuted
                onChange={(sideGraphicPlayback) =>
                  patch({ sideGraphicPlayback })
                }
              />
            )}
          </>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <MissionAvField
          campaignId={campaignId}
          kind="audio"
          value={mission.voiceover}
          onChange={(voiceover) => {
            trackImport(voiceover);
            patch({ voiceover });
          }}
          label="Briefing voiceover"
          help="Optional audio played on the briefing screen."
          gameName={mission.snapshot.gameName}
        />
        {mission.voiceover && (
          <PlaybackTuning
            playback={mission.voiceoverPlayback}
            defaults={CUE_DEFAULTS}
            showLoop
            showMuted
            onChange={(voiceoverPlayback) => patch({ voiceoverPlayback })}
          />
        )}
      </div>

      <div className="flex flex-col gap-2">
        <MissionAvField
          campaignId={campaignId}
          kind="video"
          value={mission.cutscene}
          onChange={(cutscene) => {
            trackImport(cutscene);
            patch({ cutscene });
          }}
          label="Intro cutscene"
          help="Optional video offered on the briefing screen."
          gameName={mission.snapshot.gameName}
        />
        {mission.cutscene && (
          <PlaybackTuning
            playback={mission.cutscenePlayback}
            defaults={CUE_DEFAULTS}
            showAutoplay
            showLoop
            showMuted
            onChange={(cutscenePlayback) => patch({ cutscenePlayback })}
          />
        )}
      </div>

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
