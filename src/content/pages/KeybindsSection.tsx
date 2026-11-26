import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { SettingList, SettingRow } from "@/components/SettingRow";
import { withoutGeneratedGames } from "@/lib/generatedGames";
import { useImportParam } from "../../deeplink/useImportParam";
import { useSkirmishDraft } from "../../play/drafts";
import { GamePickerField } from "../../play/pages/components/GamePickerButton";
import {
  useKeybinds,
  useScanTargetSelection,
  useUnitsyncArchiveFile,
  useUnitsyncEngineConfig,
  useUnitsyncGameHeaders,
  useUnitsyncScan,
} from "../config";
import { engineConfigDir } from "../enginePaths";
import { MODIFIER_LAYERS, type ModifierLayer } from "../keyboardLayout";
import {
  addBinding,
  bindingsFor,
  fromSaved,
  type Keymap,
  keymapText,
  removeBinding,
  resetKeys,
  resolveKeymap,
  type SavedKeymap,
} from "../keymap";
import { BindingList } from "./components/BindingList";
import { BrowserToolbar } from "./components/BrowserToolbar";
import { KeyBindingEditor } from "./components/KeyBindingEditor";
import { KeyboardMap } from "./components/KeyboardMap";
import { applyContainerText, KeymapsPanel } from "./components/KeymapsPanel";
import { EmptyState, ErrorBanner, ScanFailed } from "./components/states";

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
  const { t } = useLingui();
  const { targets, selected, selectedKey, loading, refresh } =
    useScanTargetSelection();
  const enginePath = selected?.enginePath;
  const rootPath = selected?.rootPath;

  const { data: engineConfig } = useUnitsyncEngineConfig(enginePath, rootPath);
  const configDir = engineConfigDir(engineConfig?.configPath) ?? rootPath;

  const scan = useUnitsyncScan(enginePath, rootPath);
  const games = useMemo(
    () => withoutGeneratedGames(scan.data?.games ?? []),
    [scan.data],
  );
  const { headers: gameHeaders } = useUnitsyncGameHeaders(enginePath, rootPath);
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
  // A keymap from a shared link, kept until it is saved or reverted. The link
  // usually lands before the file and the game's bindings have loaded, so it
  // is laid over each keymap they resolve to rather than applied once and
  // then dropped by the reset below.
  const [linked, setLinked] = useState<SavedKeymap | null>(null);
  const [keymap, setKeymap] = useState<Keymap>(resolved);
  // Edits are dropped when the target, game or file underneath them changes,
  // because they were edits to a different keymap.
  useEffect(
    () => setKeymap(linked ? fromSaved(linked, resolved) : resolved),
    [resolved, linked],
  );

  const [layer, setLayer] = useState<ModifierLayer>("");
  const [selectedKeys, setSelectedKeys] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // A shared keymap link lands here with its code in the query string. It loads
  // into the editor and stops there, so following a link never rewrites a
  // stranger's keybinds behind their back.
  const { code } = useImportParam();
  useEffect(() => {
    if (!code) return;
    setSaveError(applyContainerText(code, setLinked));
  }, [code]);

  // What is dirty is what would be written, so compare the files rather than
  // the objects: a keymap rebuilt by an edit that changed nothing is not dirty.
  const text = keymapText(keymap);
  const includedFiles = keymap.includes.join(", ");
  const dirty = text !== keymapText(resolved);

  async function onSave() {
    setSaving(true);
    const error = await file.write(text);
    setSaveError(error);
    if (!error) setLinked(null);
    setSaving(false);
  }

  function onRevert() {
    setLinked(null);
    setKeymap(resolved);
  }

  if (targets.length === 0 && !loading) {
    return (
      <EmptyState
        label={
          <Trans>
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
          </Trans>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col gap-3">
        <BrowserToolbar
          targets={targets}
          selectedKey={selectedKey}
          onRescan={refresh}
          scanning={loading}
        />

        <SettingList>
          <SettingRow
            label={t`Game`}
            help={
              <Trans>
                The game's own bindings are the starting point. The engine reads
                uikeys.txt instead of them, so saving writes the game's bindings
                into the file along with your changes.
              </Trans>
            }
            helpLabel={t`About the game's bindings`}
          >
            <div className="w-72">
              <GamePickerField
                value={gameName}
                onValueChange={setGameName}
                games={games}
                headers={gameHeaders}
                placeholder={
                  scan.loading ? t`Reading games...` : t`No game selected`
                }
                ariaLabel={t`Game whose bindings to show`}
                disabled={games.length === 0}
                gamesLoading={scan.loading}
              />
            </div>
          </SettingRow>
        </SettingList>

        {scan.error ? <ScanFailed noun={t`games`} reason={scan.error} /> : null}
        {file.error ? <ErrorBanner message={file.error} /> : null}
        {saveError ? <ErrorBanner message={saveError} /> : null}

        {keymap.includes.length > 0 ? (
          <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            <Trans>
              This file loads {includedFiles} with keyload, which coilbox does
              not follow, so bindings from there are not shown. Saving keeps the
              keyload line.
            </Trans>
          </p>
        ) : null}

        {file.data?.exists && !file.data.ours ? (
          <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            <Trans>
              This uikeys.txt was written by hand or by another tool. The first
              save keeps a copy of it as uikeys.txt.bak.
            </Trans>
          </p>
        ) : null}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">
            <Trans>Keyboard</Trans>
          </h2>
          <div className="flex gap-1">
            {MODIFIER_LAYERS.map((m) => (
              <Button
                key={m.id || "plain"}
                size="sm"
                variant={m.id === layer ? "default" : "outline"}
                aria-pressed={m.id === layer}
                onClick={() => {
                  setLayer(m.id);
                  setSelectedKeys(null);
                }}
              >
                {m.label}
              </Button>
            ))}
          </div>
        </div>

        <KeyboardMap
          keymap={keymap}
          layer={layer}
          selected={selectedKeys}
          onSelect={setSelectedKeys}
        />

        {selectedKeys ? (
          <KeyBindingEditor
            key={selectedKeys}
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
            <Trans>Pick a key to see what it does.</Trans>
          </p>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">
          <Trans>All bindings</Trans>
        </h2>
        <BindingList
          keymap={keymap}
          onSelect={setSelectedKeys}
          onRemove={(keys, action) =>
            setKeymap((km) => removeBinding(km, keys, action))
          }
        />
      </section>

      {rootPath ? (
        <KeymapsPanel
          rootPath={rootPath}
          keymap={keymap}
          gameName={gameName || undefined}
          onApply={(s) => setKeymap((km) => fromSaved(s, km))}
        />
      ) : null}

      {/* Stays on screen, so Save is in reach from a key at the top. It
          reaches down over the scroll box's bottom padding, so nothing shows
          through below it. */}
      <div className="sticky -bottom-8 z-10 -mb-8 flex flex-wrap items-center justify-between gap-2 border-border border-t bg-background pt-3 pb-8">
        <p
          className="min-w-0 flex-1 break-all font-mono text-xs text-muted-foreground"
          title={file.data?.path}
        >
          {file.data?.path ?? t`No config file yet`}
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!dirty || saving}
            onClick={onRevert}
          >
            <Trans>Revert</Trans>
          </Button>
          <Button size="sm" disabled={!dirty || saving} onClick={onSave}>
            {saving ? t`Saving...` : t`Save to uikeys.txt`}
          </Button>
        </div>
      </div>
    </div>
  );
}
