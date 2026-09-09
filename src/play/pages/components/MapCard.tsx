import { Button } from "@picoframe/frame";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  type LucideIcon,
  Map as MapIcon,
  UserRoundPen,
  WavesHorizontal,
  Wind,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { MapItem, StartPos } from "@/content/bindings";
import type { MapThumbData } from "@/content/config";
import { mapSizeLabel } from "@/content/pages/components/MapThumb";
import { hubAuthorMapsUrl, useHubUrl } from "@/hub/config";
import { isHubEnabled } from "@/profile/profile";
import { MapPickerDrawer } from "./MapPickerDrawer";
import { MinimapPreview } from "./MinimapPreview";

/** Info keys already shown as the headline/size, so excluded from the tag row. */
const HEADLINE_KEYS = new Set(["name", "description"]);

/** The tag row's chip, shared so the author's version only adds to it. */
const PILL =
  "inline-flex items-center gap-1 rounded border border-border/60 bg-muted/40 px-1.5 py-0.5 text-[11px] text-muted-foreground";

/**
 * The map's author, linked to the rest of their maps on the hub website. A
 * button rather than a plain chip because it goes somewhere, and it opens in the
 * OS browser rather than in the app: coilbox only knows the maps this machine
 * has, and the question this answers is about the ones it does not.
 *
 * A profile with the hub switched off has no hub to send anyone to, so the name
 * stays a plain chip there rather than becoming a dead button.
 */
function AuthorPill({ author }: { author: string }) {
  const hubUrl = useHubUrl();
  const reachable = isHubEnabled();
  const icon = <UserRoundPen className="size-3 shrink-0" aria-hidden />;

  if (!reachable) {
    return (
      <span className={PILL}>
        {icon}
        {author}
      </span>
    );
  }
  return (
    <button
      type="button"
      className={`${PILL} hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
      title={`Maps by ${author} on the Coilbox hub`}
      onClick={() => {
        openUrl(hubAuthorMapsUrl(hubUrl, author)).catch(() => {});
      }}
    >
      {icon}
      {author}
    </button>
  );
}

/**
 * One fact about the map as an icon and its value. The icon carries no meaning
 * on its own, so the tooltip names what the number is and doubles as the
 * accessible name: without it a screen reader would read a bare "12".
 */
function MapFact({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  /** What the number is, in words. Shown on hover and read out. */
  label: string;
  value: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger className="inline-flex items-center gap-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <Icon className="size-3.5 shrink-0" aria-hidden />
        <span className="sr-only">{label}:</span>
        <span>{value}</span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * The map picker: the selected map's minimap (with team-coloured start markers),
 * its name and a few info tags, and a "Choose map" button that opens a thumbnail
 * drawer. The minimap is the picker's centrepiece — deliberately not a dropdown.
 */
export function MapCard({
  map,
  maps,
  thumbs,
  minimapUrl,
  startPositions,
  minimapLoading,
  markerColors,
  env,
  mapsLoading,
  onSelectMap,
  disabled,
  selectLabel = "Choose map",
  overlay,
  overlayInteractive,
  placeholder,
  dimBase,
}: {
  map: MapItem | null;
  maps: MapItem[];
  thumbs: Map<string, MapThumbData>;
  minimapUrl?: string | null;
  startPositions: StartPos[];
  minimapLoading?: boolean;
  markerColors: string[];
  /** Wind/tidal from the minimap parse of mapinfo.lua. */
  env?: { minWind?: number; maxWind?: number; tidalStrength?: number };
  /** The map list is still being scanned, so no maps are available yet. */
  mapsLoading?: boolean;
  onSelectMap: (name: string) => void;
  disabled?: boolean;
  /** Label for the picker button (e.g. "Suggest map" in a joined battle). */
  selectLabel?: string;
  /** Extra overlay in the minimap box (e.g. ally start boxes). */
  overlay?: ReactNode;
  /** The overlay handles pointer interaction itself (e.g. the start-box editor), so
   * the minimap must not be a click-to-open-picker button. Picker stays on its button. */
  overlayInteractive?: boolean;
  /** Replaces the empty-state inside the minimap box (e.g. a download panel). */
  placeholder?: ReactNode;
  /** Dim the base minimap image (e.g. while a terrain overlay is shown on top). */
  dimBase?: boolean;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const size = map ? mapSizeLabel(map.width, map.height) : null;
  const description = map?.info.description;
  const tags = map
    ? Object.entries(map.info).filter(([k]) => !HEADLINE_KEYS.has(k))
    : [];
  const wind =
    env?.minWind !== undefined && env?.maxWind !== undefined
      ? `${Math.round(env.minWind)}–${Math.round(env.maxWind)}`
      : null;
  // A map declaring no tidal power reports 0 rather than nothing, so the chip
  // would otherwise read a tidal strength of 0 on most maps.
  const tidal =
    env?.tidalStrength !== undefined && env.tidalStrength > 0
      ? String(Math.round(env.tidalStrength))
      : null;

  return (
    <div className="rounded-lg border border-border/50 bg-card p-3">
      <MinimapPreview
        url={minimapUrl}
        width={map?.width}
        height={map?.height}
        startPositions={startPositions}
        markerColors={markerColors}
        loading={mapsLoading || minimapLoading}
        alt={
          mapsLoading
            ? "Loading maps…"
            : map
              ? `Minimap of ${map.name}`
              : "No map selected"
        }
        onClick={
          disabled || mapsLoading ? undefined : () => setPickerOpen(true)
        }
        overlayInteractive={overlayInteractive}
        placeholder={placeholder}
        dim={dimBase}
      >
        {overlay}
      </MinimapPreview>

      <div className="mt-3">
        <div className="flex items-start justify-between gap-3">
          <h2 className="min-w-0 truncate text-sm font-semibold">
            {map?.name ?? (mapsLoading ? "Loading maps…" : "No map selected")}
          </h2>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            disabled={disabled || mapsLoading}
            onClick={() => setPickerOpen(true)}
          >
            {selectLabel}
          </Button>
        </div>
        {/* Each fact is an icon and a number rather than a word and a number,
            so the row stays readable in a 22rem sidebar. The words move into
            the tooltips, which is also what names each icon for a reader. */}
        <TooltipProvider>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {size && <MapFact icon={MapIcon} label="Map size" value={size} />}
            {startPositions.length > 0 && (
              <span>{startPositions.length} start positions</span>
            )}
            {wind && <MapFact icon={Wind} label="Wind" value={wind} />}
            {tidal && (
              <MapFact
                icon={WavesHorizontal}
                label="Tidal strength"
                value={tidal}
              />
            )}
          </div>
        </TooltipProvider>
        {description && (
          <p className="mt-2 line-clamp-3 text-xs text-muted-foreground">
            {description}
          </p>
        )}
        {tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {tags.slice(0, 3).map(([k, v]) =>
              // Who made the map is the one tag worth marking as a person
              // rather than leaving as a bare string beside the map's own
              // words, where a name reads as another piece of metadata. It is
              // also the only one that leads somewhere: the rest of their maps.
              k.toLowerCase() === "author" ? (
                <AuthorPill key={k} author={v} />
              ) : (
                <span key={k} className={PILL}>
                  {v}
                </span>
              ),
            )}
          </div>
        )}
      </div>

      <MapPickerDrawer
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        maps={maps}
        thumbs={thumbs}
        selectedName={map?.name ?? ""}
        onSelect={onSelectMap}
        mapsLoading={mapsLoading}
      />
    </div>
  );
}
