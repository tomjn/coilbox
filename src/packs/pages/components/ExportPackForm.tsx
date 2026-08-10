import { Button, Input } from "@picoframe/frame";
import { Package } from "lucide-react";
import { useMemo, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { withoutGeneratedGames } from "@/lib/generatedGames";
import { ChallengeCodeView } from "../../../challenge/ChallengeCodeView";
import { useUnitsyncScan } from "../../../content/config";
import { ErrorBanner } from "../../../content/pages/components/states";
import { usePreferredTarget } from "../../../play/config";
import { useSkirmishPresets } from "../../../play/presets";
import { buildPackManifest } from "../../build";
import { encodeSetupPack } from "../../manifest";

/** A scrollable multi-select list of checkboxes, for maps and presets. Kept as
 * one small local component rather than a picoframe primitive, since the
 * shadcn registry has no multi-select list widget. */
function CheckList({
  items,
  selected,
  onToggle,
  emptyMessage,
}: {
  items: { id: string; label: string; hint?: string }[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  emptyMessage: string;
}) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyMessage}</p>;
  }
  return (
    <div className="flex max-h-48 flex-col gap-1 overflow-y-auto rounded-lg border border-border/60 p-2">
      {items.map((item) => (
        // biome-ignore lint/a11y/noLabelWithoutControl: wraps the <Checkbox> control
        <label
          key={item.id}
          className="flex items-center gap-2.5 rounded-md px-1.5 py-1 text-sm hover:bg-accent/40"
        >
          <Checkbox
            checked={selected.has(item.id)}
            onCheckedChange={() => onToggle(item.id)}
          />
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
          {item.hint && (
            <span className="shrink-0 text-xs text-muted-foreground">
              {item.hint}
            </span>
          )}
        </label>
      ))}
    </div>
  );
}

/**
 * "Export a setup pack" (issue #415): pick any mix of installed games and
 * maps, plus optional presets, and produce a pasteable pack code. A pack now
 * offers its games and maps as downloads and no longer carries an engine
 * version. The user chooses what goes in rather than the pack dumping every
 * installed game, map and preset.
 */
export function ExportPackForm() {
  // Read the target here rather than taking it as a prop. A drawer's content
  // is built once, when the button is pressed, so a target read at open time
  // would stay stale for as long as the drawer is open (issue #1377), the
  // same reasoning `ImportPackForm` already follows.
  const { target } = usePreferredTarget();
  const scan = useUnitsyncScan(target?.enginePath, target?.dataDir);
  const { presets } = useSkirmishPresets();

  // Coilbox's own generated games are never a pack's game: the machine that
  // imports the pack rewrites its own on the next test, and has no way to get
  // this one.
  const games = withoutGeneratedGames(scan.data?.games ?? []);
  // A scan can list the same map name from more than one archive. Mirrors
  // `MapsPage`'s dedup, since the pack only needs the name once.
  const maps = useMemo(
    () =>
      Array.from(
        new Map((scan.data?.maps ?? []).map((m) => [m.name, m])).values(),
      ),
    [scan.data],
  );

  const [title, setTitle] = useState("");
  const [selectedGames, setSelectedGames] = useState<Set<string>>(new Set());
  const [selectedMaps, setSelectedMaps] = useState<Set<string>>(new Set());
  const [selectedPresetIds, setSelectedPresetIds] = useState<Set<string>>(
    new Set(),
  );
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggleGame = (name: string) =>
    setSelectedGames((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  const toggleMap = (name: string) =>
    setSelectedMaps((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  const togglePreset = (id: string) =>
    setSelectedPresetIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const presetItems = useMemo(
    () => presets.map((p) => ({ id: p.id, label: p.name, hint: p.mapName })),
    [presets],
  );

  const onExport = () => {
    setError(null);
    const built = buildPackManifest({
      title,
      gameNames: [...selectedGames],
      mapNames: [...selectedMaps],
      presets: presets.filter((p) => selectedPresetIds.has(p.id)),
      installedGames: games.map((g) => ({
        name: g.name,
        shortname: g.info.shortname,
      })),
    });
    if (!built) {
      setError("Pick at least one game or map first.");
      return;
    }
    setCode(encodeSetupPack(built));
  };

  if (code) {
    return (
      <ChallengeCodeView
        code={code}
        helpText="Anyone who pastes this into Import setup pack gets its games and maps offered as downloads (or confirmed already installed), plus any presets you included."
      />
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="pack-title">Name</Label>
        <Input
          id="pack-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Popular water maps"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Games</Label>
        <CheckList
          items={games.map((g) => ({ id: g.name, label: g.name }))}
          selected={selectedGames}
          onToggle={toggleGame}
          emptyMessage="No games installed for this engine."
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Maps</Label>
        <CheckList
          items={maps.map((m) => ({ id: m.name, label: m.name }))}
          selected={selectedMaps}
          onToggle={toggleMap}
          emptyMessage="No maps installed for this engine."
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Presets (optional)</Label>
        <CheckList
          items={presetItems}
          selected={selectedPresetIds}
          onToggle={togglePreset}
          emptyMessage="No saved presets to include."
        />
      </div>

      {error && <ErrorBanner message={error} />}

      <Button onClick={onExport}>
        <Package className="mr-1.5 size-4" aria-hidden /> Create pack code
      </Button>
    </div>
  );
}
