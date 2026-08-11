import { Button } from "@picoframe/frame";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { useSkirmishDraft } from "../../play/drafts";
import { OptionSelect } from "../../uberstress/pages/components/OptionSelect";
import {
  useKeybinds,
  useScanTargetSelection,
  useUnitsyncArchiveFile,
  useUnitsyncEngineConfig,
  useUnitsyncScan,
} from "../config";
import { MODIFIER_LAYERS, type ModifierLayer } from "../keyboardLayout";
import {
  addBinding,
  bindingsFor,
  type Keymap,
  keymapText,
  removeBinding,
  resetKeys,
  resolveKeymap,
} from "../keymap";
import { BindingList } from "./components/BindingList";
import { BrowserToolbar } from "./components/BrowserToolbar";
import { KeyBindingEditor } from "./components/KeyBindingEditor";
import { KeyboardMap } from "./components/KeyboardMap";
import { EmptyState, ErrorBanner } from "./components/states";

/** The directory holding the engine's config, from the path unitsync reports. */
function dirOf(path: string | undefined): string | undefined {
  if (!path) return undefined;
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return cut > 0 ? path.slice(0, cut) : undefined;
}

/**
 * The keymap editor: `uikeys.txt` on a keyboard.
 *
 * The file is the engine's, one per config directory, so the engine and root
 * picker is the same one the other engine settings pages use. The game picker
 * is separate and does something different: it decides which bundled bindings
 * the editor treats as the baseline, because a game's keymap lives in its
 * archive while the file lives beside the engine.
 *
 * The engine reads this file raw-first, so writing it hides whatever the game
 * shipped. That is why the baseline is loaded and written back rather than
 * merely diffed against, and why Save writes every binding rather than the
 * player's changes alone.
 */
export default function KeybindsSection() {
  const { targets, selected, selectedKey, setSelectedKey, loading, refresh } =
    useScanTargetSelection();
  const enginePath = selected?.enginePath;
  const rootPath = selected?.rootPath;

  const { data: engineConfig } = useUnitsyncEngineConfig(enginePath, rootPath);
  const configDir = dirOf(engineConfig?.configPath) ?? rootPath;

  const scan = useUnitsyncScan(enginePath, rootPath);
  const games = useMemo(() => scan.data?.games ?? [], [scan.data]);
  const [draft] = useSkirmishDraft();
  const [gameName, setGameName] = useState("");
  useEffect(() => {
    if (games.length === 0) return;
    // The game the player last set up is the one whose keymap they care about.
    const known = games.find((g) => g.name === draft.gameName);
    setGameName((prev) =>
      games.some((g) => g.name === prev)
        ? prev
        : ((known ?? games[0])?.name ?? ""),
    );
  }, [games, draft.gameName]);
  const game = games.find((g) => g.name === gameName);

  const gameFile = useUnitsyncArchiveFile(
    enginePath,
    rootPath,
    game?.primaryArchive.name,
    "uikeys.txt",
  );
  const gameText = gameFile.data?.kind === "text" ? gameFile.data.text : "";

  const file = useKeybinds(configDir);
  const userText = file.data?.text;

  const resolved = useMemo(
    () => resolveKeymap({ gameText, userText }),
    [gameText, userText],
  );
  const [keymap, setKeymap] = useState<Keymap>(resolved);
  // Edits are dropped when the target, game or file underneath them changes,
  // because they were edits to a different keymap.
  useEffect(() => setKeymap(resolved), [resolved]);

  const [layer, setLayer] = useState<ModifierLayer>("");
  const [selectedKeys, setSelectedKeys] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // What is dirty is what would be written, so compare the files rather than
  // the objects: a keymap rebuilt by an edit that changed nothing is not dirty.
  const text = keymapText(keymap);
  const dirty = text !== keymapText(resolved);

  async function onSave() {
    setSaving(true);
    setSaveError(await file.write(text));
    setSaving(false);
  }

  if (targets.length === 0 && !loading) {
    return (
      <EmptyState
        label={
          <>
            No engines found in your content folders. Add a folder in{" "}
            <Link
              to="/settings/content-folders"
              className="underline underline-offset-4"
            >
              Content folders
            </Link>{" "}
            or install one from{" "}
            <Link
              to="/settings/engines"
              className="underline underline-offset-4"
            >
              Engines
            </Link>
            .
          </>
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      <BrowserToolbar
        targets={targets}
        selectedKey={selectedKey}
        onSelect={setSelectedKey}
        onRescan={refresh}
        scanning={loading}
      />

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">
          Bindings a game brings with it:
        </span>
        <OptionSelect
          value={gameName}
          onValueChange={setGameName}
          options={games.map((g) => ({ value: g.name, label: g.name }))}
          placeholder={scan.loading ? "Reading games..." : "No game selected"}
          disabled={games.length === 0}
          className="w-72"
        />
      </div>

      {file.error ? <ErrorBanner message={file.error} /> : null}
      {saveError ? <ErrorBanner message={saveError} /> : null}

      {keymap.includes.length > 0 ? (
        <p className="rounded-md border border-border/50 bg-muted/30 p-2 text-xs text-muted-foreground">
          This file loads {keymap.includes.join(", ")} with keyload, which
          coilbox does not follow, so bindings from there are not shown. Saving
          keeps the keyload line.
        </p>
      ) : null}

      {file.data?.exists && !file.data.ours ? (
        <p className="rounded-md border border-border/50 bg-muted/30 p-2 text-xs text-muted-foreground">
          This uikeys.txt was written by hand or by another tool. The first save
          keeps a copy of it as uikeys.txt.bak.
        </p>
      ) : null}

      <div className="flex gap-1">
        {MODIFIER_LAYERS.map((m) => (
          <Button
            key={m.id || "plain"}
            size="sm"
            variant={m.id === layer ? "default" : "outline"}
            onClick={() => {
              setLayer(m.id);
              setSelectedKeys(null);
            }}
          >
            {m.label}
          </Button>
        ))}
      </div>

      <KeyboardMap
        keymap={keymap}
        layer={layer}
        selected={selectedKeys}
        onSelect={setSelectedKeys}
      />

      {selectedKeys ? (
        <KeyBindingEditor
          keymap={keymap}
          keys={selectedKeys}
          onAdd={(action) =>
            setKeymap((km) => addBinding(km, selectedKeys, action))
          }
          onRemove={(action) =>
            setKeymap((km) => removeBinding(km, selectedKeys, action))
          }
          onReset={() => setKeymap((km) => resetKeys(km, selectedKeys))}
          onRebind={(nextKeys) => {
            setKeymap((km) => {
              const moving = bindingsFor(km, selectedKeys);
              let next = km;
              for (const b of moving) {
                next = removeBinding(next, selectedKeys, b.action);
                next = addBinding(next, nextKeys, b.action);
              }
              return next;
            });
            setSelectedKeys(nextKeys);
          }}
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          Pick a key above to see what it does, or find it in the list below.
        </p>
      )}

      <BindingList
        keymap={keymap}
        onSelect={setSelectedKeys}
        onRemove={(keys, action) =>
          setKeymap((km) => removeBinding(km, keys, action))
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-2 border-border/50 border-t pt-3">
        <p
          className="break-all font-mono text-xs text-muted-foreground"
          title={file.data?.path}
        >
          {file.data?.path ?? "No config file yet"}
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!dirty || saving}
            onClick={() => setKeymap(resolved)}
          >
            Revert
          </Button>
          <Button size="sm" disabled={!dirty || saving} onClick={onSave}>
            {saving ? "Saving..." : "Save to uikeys.txt"}
          </Button>
        </div>
      </div>
    </div>
  );
}
