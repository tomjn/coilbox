import { Button } from "@picoframe/frame";
import { useState } from "react";
import type { MapItem, StartPos } from "@/content/bindings";
import { mapSizeLabel } from "@/content/pages/components/MapThumb";
import { MapPickerDrawer } from "./MapPickerDrawer";
import { MinimapPreview } from "./MinimapPreview";

/** Info keys already shown as the headline/size, so excluded from the tag row. */
const HEADLINE_KEYS = new Set(["name", "description"]);

/**
 * The map picker: the selected map's minimap (with team-coloured start markers),
 * its name and a few info tags, and a "Choose map" button that opens a thumbnail
 * drawer. The minimap is the picker's centrepiece — deliberately not a dropdown.
 */
export function MapCard({
  map,
  maps,
  thumbs,
  minimapDataUrl,
  startPositions,
  minimapLoading,
  markerColors,
  env,
  onSelectMap,
  disabled,
}: {
  map: MapItem | null;
  maps: MapItem[];
  thumbs: Map<string, string>;
  minimapDataUrl?: string | null;
  startPositions: StartPos[];
  minimapLoading?: boolean;
  markerColors: string[];
  /** Wind/tidal from the minimap parse of mapinfo.lua. */
  env?: { minWind?: number; maxWind?: number; tidalStrength?: number };
  onSelectMap: (name: string) => void;
  disabled?: boolean;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const size = map ? mapSizeLabel(map.width, map.height) : null;
  const description = map?.info.description;
  const tags = map
    ? Object.entries(map.info).filter(([k]) => !HEADLINE_KEYS.has(k))
    : [];
  const wind =
    env?.minWind !== undefined && env?.maxWind !== undefined
      ? `Wind ${Math.round(env.minWind)}–${Math.round(env.maxWind)}`
      : null;
  const tidal =
    env?.tidalStrength !== undefined
      ? `Tidal ${Math.round(env.tidalStrength)}`
      : null;

  return (
    <div className="rounded-lg border border-border/50 bg-card p-3">
      <MinimapPreview
        dataUrl={minimapDataUrl}
        width={map?.width}
        height={map?.height}
        startPositions={startPositions}
        markerColors={markerColors}
        loading={minimapLoading}
        alt={map ? `Minimap of ${map.name}` : "No map selected"}
        onClick={disabled ? undefined : () => setPickerOpen(true)}
      />

      <div className="mt-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">
            {map?.name ?? "No map selected"}
          </h2>
          <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            {size && <span>{size}</span>}
            {startPositions.length > 0 && (
              <span>· {startPositions.length} start positions</span>
            )}
            {wind && <span>· {wind}</span>}
            {tidal && <span>· {tidal}</span>}
          </div>
          {description && (
            <p className="mt-2 line-clamp-3 text-xs text-muted-foreground">
              {description}
            </p>
          )}
          {tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {tags.slice(0, 3).map(([k, v]) => (
                <span
                  key={k}
                  className="rounded border border-border/60 bg-muted/40 px-1.5 py-0.5 text-[11px] text-muted-foreground"
                >
                  {v}
                </span>
              ))}
            </div>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => setPickerOpen(true)}
        >
          Choose map
        </Button>
      </div>

      <MapPickerDrawer
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        maps={maps}
        thumbs={thumbs}
        selectedName={map?.name ?? ""}
        onSelect={onSelectMap}
      />
    </div>
  );
}
