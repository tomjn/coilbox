import { Button, Input } from "@picoframe/frame";
import { Package } from "lucide-react";
import { useMemo, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { withoutGeneratedGames } from "@/lib/generatedGames";
import { ChallengeCodeView } from "../../../challenge/ChallengeCodeView";
import { useUnitsyncScan } from "../../../content/config";
import { isRealEngineVersion } from "../../../content/engineVersion";
import { ErrorBanner } from "../../../content/pages/components/states";
import type { PlayTarget } from "../../../play/config";
import { useSkirmishDraft } from "../../../play/drafts";
import { useSkirmishPresets } from "../../../play/presets";
import { OptionSelect } from "../../../uberstress/pages/components/OptionSelect";
import { encodeSetupPack, type SetupPackManifest } from "../../manifest";

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
 * "Export a setup pack" (issue #415): pick a game, the maps and presets to
 * bundle, and produce a pasteable pack code. The current install's engine
 * version is used automatically, no picker, mirroring the singleplayer
 * launcher's own "always the preferred engine" convention. The user chooses
 * what goes in rather than the pack dumping every installed map and preset.
 */
export function ExportPackForm({ target }: { target: PlayTarget }) {
  const scan = useUnitsyncScan(target.enginePath, target.dataDir);
  const { presets } = useSkirmishPresets();
  const [draft] = useSkirmishDraft();

  // Coilbox's own generated games are never a pack's game: the machine that
  // imports the pack rewrites its own on the next test, and has no way to get
  // this one. One the draft already names stays, so the picker below is not
  // left showing a value it has no option for.
  const games = withoutGeneratedGames(scan.data?.games ?? [], draft.gameName);
  // A scan can list the same map name from more than one archive. Mirrors
  // `MapsPage`'s dedup, since the pack only needs the name once.
  const maps = useMemo(
    () =>
      Array.from(
        new Map((scan.data?.maps ?? []).map((m) => [m.name, m])).values(),
      ),
    [scan.data],
  );

  const [gameName, setGameName] = useState(
    () => draft.gameName || games[0]?.name || "",
  );
  const [rapidTag, setRapidTag] = useState("");
  const [selectedMaps, setSelectedMaps] = useState<Set<string>>(
    () => new Set(draft.mapName ? [draft.mapName] : []),
  );
  const [selectedPresetIds, setSelectedPresetIds] = useState<Set<string>>(
    new Set(),
  );
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const buildManifest = (): SetupPackManifest | null => {
    if (!gameName || selectedMaps.size === 0) return null;
    const chosenPresets = presets
      .filter((p) => selectedPresetIds.has(p.id))
      .map(
        ({
          id: _id,
          createdAt: _createdAt,
          lastUsedAt: _lastUsedAt,
          ...rest
        }) => rest,
      );
    return {
      ...(isRealEngineVersion(target.engineVersion)
        ? { engineVersion: target.engineVersion }
        : {}),
      game: {
        name: gameName,
        ...(rapidTag.trim() ? { rapidTag: rapidTag.trim() } : {}),
      },
      maps: [...selectedMaps],
      ...(chosenPresets.length ? { presets: chosenPresets } : {}),
    };
  };

  const onExport = () => {
    setError(null);
    const manifest = buildManifest();
    if (!manifest) {
      setError("Pick a game and at least one map first.");
      return;
    }
    setCode(encodeSetupPack(manifest));
  };

  if (code) {
    return (
      <ChallengeCodeView
        code={code}
        helpText="Anyone who pastes this into Import setup pack gets the same engine version, game and maps offered as downloads (or confirmed already installed), plus any presets you included."
      />
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-col gap-1.5">
        <Label>Game</Label>
        <OptionSelect
          value={gameName}
          onValueChange={setGameName}
          options={games.map((g) => ({ value: g.name, label: g.name }))}
          placeholder="Choose a game…"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="pack-rapid-tag">Rapid tag (optional)</Label>
        <Input
          id="pack-rapid-tag"
          value={rapidTag}
          onChange={(e) => setRapidTag(e.target.value)}
          placeholder="e.g. byar:test"
        />
        <p className="text-xs text-muted-foreground">
          Lets the recipient download the exact build. Without one, coilbox
          tries the archive name as a best-effort download.
        </p>
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
