import { Button, Input, useDrawer } from "@picoframe/frame";
import { open } from "@tauri-apps/plugin-dialog";
import { Image, Plus, Trash2, Undo2, X } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { type SaveState, SaveStatus } from "@/components/SaveStatus";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
import { campaignImageImport, campaignMediaImport } from "../../bindings";
import type {
  CampaignMission,
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

/**
 * The mission as it is stored: a title that is never blank, and none of the
 * objective rows the author added and never filled in.
 *
 * Only the stored copy is shaped this way. The drawer keeps showing what was
 * typed, so a row waiting to be filled in stays on screen while it is empty.
 */
function stored(mission: CampaignMission): CampaignMission {
  return {
    ...mission,
    title: mission.title.trim() || "Untitled mission",
    objectives: mission.objectives.map((o) => o.trim()).filter(Boolean),
  };
}

/**
 * Whether writing `a` would leave anything on disk that writing `b` did not.
 *
 * The stored shapes rather than the raw ones, so an objective row added and
 * still empty is not a change waiting to be saved, and neither is a title
 * somebody put a space on the end of.
 */
function changed(a: CampaignMission, b: CampaignMission): boolean {
  return a !== b && JSON.stringify(stored(a)) !== JSON.stringify(stored(b));
}

/**
 * Put the mission back the way it was when the drawer opened.
 *
 * Everything else in here saves as it is typed, so this is the one action that
 * takes work away, and it asks first, through the same popover the mission
 * row's own Remove uses. It says how far back it goes, because "revert" on a
 * drawer that has been open for ten minutes could mean almost anything.
 */
function RevertButton({
  disabled,
  onRevert,
}: {
  disabled: boolean;
  onRevert: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="gap-1.5"
          disabled={disabled}
        >
          <Undo2 className="size-4" /> Revert
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="flex w-72 flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-medium">Undo every change?</h3>
          <p className="text-xs text-muted-foreground">
            This puts the mission back the way it was when you opened it, and
            saves that. Anything imported since goes off disk with it.
          </p>
        </div>
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setOpen(false)}
          >
            Keep editing
          </Button>
          <Button
            type="button"
            size="sm"
            variant="destructive"
            onClick={() => {
              setOpen(false);
              onRevert();
            }}
          >
            Revert
          </Button>
        </div>
      </PopoverContent>
    </Popover>
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
 * Drawer body for editing one campaign mission. Saves as you go, the way the
 * page it sits on does (issue #2260).
 *
 * It used to hold the edit in local state and commit it on Apply, which meant
 * Cancel, Escape and a click on the backdrop each threw away everything typed
 * without saying so. The page behind autosaves, so nothing about the drawer
 * told an author that clicking outside it deletes a briefing they spent ten
 * minutes on.
 *
 * Now every change goes to disk through `onSave`, which persists the whole
 * campaign. A control writes as it is changed. A text box writes on blur, the
 * same as the campaign title and description behind it. Closing is just
 * closing, and the one way back is Revert, which is a button that asks first
 * rather than a click landing anywhere outside the panel.
 *
 * That takes the media bookkeeping with it. Picking a file imports it there and
 * then, because the plugin needs a real file before anything can play it, and
 * the drawer used to have to delete those itself: the page's diff works from
 * the stored document, which had never named an import Apply had not committed
 * yet (issues #2210 and #2231). Saving on change closes that gap. The stored
 * document names an import the moment it is made, so replacing one, emptying
 * the slot, or reverting the lot all go through the page's own `persistMedia`,
 * which deletes what the document stops naming once the write has landed.
 * Deleting only after the write is the part the drawer could never do, and it
 * is what keeps a refused save from leaving the stored mission pointing at a
 * file that has already gone (issue #2232).
 */
export function MissionEditorDrawer({
  campaignId,
  mission: initial,
  onSave,
}: {
  campaignId: string;
  mission: CampaignMission;
  /** Store this mission, as part of the whole campaign. Called on every change. */
  onSave: (mission: CampaignMission) => Promise<void>;
}) {
  const drawer = useDrawer();
  const [mission, setMission] = useState<CampaignMission>(initial);
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  const [error, setError] = useState<string | null>(null);
  // The mission this was last seeded from, the mission as it stands, and the
  // last one handed to `onSave`. Refs because the closing write below must run
  // on unmount alone: as dependencies they would re-run it mid-edit.
  const opened = useRef<CampaignMission>(initial);
  const latest = useRef<CampaignMission>(initial);
  const handed = useRef<CampaignMission>(initial);
  const write = useRef(onSave);
  write.current = onSave;
  const panel = useRef<HTMLDivElement>(null);

  // The panel outlives its own close: it goes when the slide-out animation
  // ends, so opening a second mission before that lands hands a new mission to
  // this same component, which is still holding the last one in state. The
  // drawer then shows the wrong mission, and now that it saves as it goes it
  // would write that one's fields over the one on screen. So state is seeded
  // again whenever the mission handed in is a different object.
  const reseeded = opened.current !== initial;
  if (reseeded) {
    opened.current = initial;
    handed.current = initial;
    setMission(initial);
    setSave({ kind: "idle" });
    setError(null);
  }
  // This render still holds the mission being replaced, and React throws it
  // away and renders again. Nothing written on the way out may read it.
  latest.current = reseeded ? initial : mission;

  /** Write the mission, and say where that write got to. */
  const persist = async (next: CampaignMission) => {
    handed.current = next;
    setSave({ kind: "saving" });
    try {
      await write.current(stored(next));
      setError(null);
      setSave({ kind: "saved", at: new Date() });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSave({ kind: "failed" });
    }
  };

  /** Change the mission and write it. Every control that is not a text box
   *  comes through here: a switch, a slider or a picked file is finished the
   *  moment it changes, so there is nothing to wait for. */
  const patch = (p: Partial<CampaignMission>) => {
    const next = { ...mission, ...p };
    setMission(next);
    void persist(next);
  };

  /** Change the mission without writing it, for a text box mid-sentence. What
   *  is on screen is then ahead of what is on disk, and the indicator says so
   *  until the box loses focus. */
  const edit = (p: Partial<CampaignMission>) => {
    setMission((m) => ({ ...m, ...p }));
    setSave({ kind: "unsaved" });
  };

  /** Write what a text box holds, unless the last write already carried it. */
  const persistTyped = () => {
    if (!changed(latest.current, handed.current)) return;
    void persist(latest.current);
  };
  const typed = useRef(persistTyped);
  typed.current = persistTyped;

  // Escape and a press outside the panel both close the drawer over a text box
  // that still has focus, so the blur that would have written it never comes.
  // Both are caught before Radix acts on them: Escape on the way down through
  // the panel, which is ahead of the document listener Radix closes from, and
  // an outside press in the capture phase, which is ahead of everything.
  //
  // Waiting for the unmount instead does not work. The panel is still on
  // screen while it slides out, and a reload or a second drawer opened in that
  // window takes the write with it.
  useEffect(() => {
    const root = panel.current;
    const outside = (e: PointerEvent) => {
      if (e.target instanceof Node && root?.contains(e.target)) return;
      typed.current();
    };
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  }, []);

  // The last resort, for a close that never went through either of those: the
  // page navigated away, or the drawer was closed from code. Empty deps and
  // read through refs, because a cleanup that re-ran on a dependency change
  // would write on every keystroke. StrictMode runs it once on mount too,
  // which the "already written" check makes a no-op.
  useEffect(
    () => () => {
      if (!changed(latest.current, handed.current)) return;
      handed.current = latest.current;
      void write.current(stored(latest.current));
    },
    [],
  );

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
      // A video backdrop is copied verbatim, an image is re-encoded and
      // downscaled.
      const { file } =
        mediaKind(src) === "video"
          ? await campaignMediaImport({ campaignId, srcPath: src })
          : await campaignImageImport({ campaignId, srcPath: src });
      patch({ panorama: { kind: "file", file } });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const removeImage = () => patch({ panorama: undefined });

  const importPanoramaFromArchive = (file: string) =>
    patch({ panorama: { kind: "file", file } });

  const setObjective = (i: number, value: string) =>
    edit({
      objectives: mission.objectives.map((o, j) => (j === i ? value : o)),
    });
  const addObjective = () => patch({ objectives: [...mission.objectives, ""] });
  const removeObjective = (i: number) =>
    patch({ objectives: mission.objectives.filter((_, j) => j !== i) });

  const revert = () => {
    setMission(initial);
    void persist(initial);
  };

  return (
    <div
      ref={panel}
      className="flex flex-col gap-5"
      onKeyDownCapture={(e) => {
        if (e.key === "Escape") persistTyped();
      }}
    >
      {/* The contract, said once at the top, because the drawer used to have an
          Apply button and an author who learnt that one is owed the news. The
          indicator beside it is the page's own. */}
      {/* Stuck a hair above the scrollport rather than at it, because that box
          carries a padding of its own and content would otherwise show through
          the gap above this bar. */}
      <div className="sticky -top-1 z-10 -mx-1 -mt-1 flex flex-wrap items-center justify-between gap-2 bg-background px-1 pb-2 pt-1">
        <p className="text-xs text-muted-foreground">
          Changes save as you make them.
        </p>
        <SaveStatus state={save} onRetry={() => void persist(mission)} />
      </div>

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
          onChange={(e) => edit({ title: e.target.value })}
          onBlur={persistTyped}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
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
          onChange={(e) => edit({ subtitle: e.target.value || undefined })}
          onBlur={persistTyped}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
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
          onChange={(e) => edit({ briefing: e.target.value })}
          onBlur={persistTyped}
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
                onBlur={persistTyped}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
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

      <MissionScenarioField
        mission={mission}
        onChange={(next) => {
          setMission(next);
          void persist(next);
        }}
      />

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
              onChange={(sideGraphic) => patch({ sideGraphic })}
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
          onChange={(voiceover) => patch({ voiceover })}
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
          onChange={(cutscene) => patch({ cutscene })}
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

      <div className="sticky bottom-0 flex items-center justify-between gap-2 border-t border-border/50 bg-background py-3">
        <RevertButton disabled={!changed(mission, initial)} onRevert={revert} />
        {/* A real click blurs the box it came from, which writes it. This is
            for the ones that do not: a keyboard activation, or a click a
            handler somewhere swallowed the focus change from. */}
        <Button
          onClick={() => {
            persistTyped();
            drawer.close();
          }}
        >
          Close
        </Button>
      </div>
    </div>
  );
}
