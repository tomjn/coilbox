import { Button, Input } from "@picoframe/frame";
import { open, save } from "@tauri-apps/plugin-dialog";
import { Download, Link2, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  asContainer,
  decodeContainerText,
  encodeContainerCode,
  encodeContainerJson,
} from "../../../container/container";
import { importContainerFile } from "../../../deeplink/bindings";
import { buildImportCodeLink } from "../../../deeplink/build";
import { copyDeepLink } from "../../../deeplink/copyLink";
import {
  contentKeymapDelete,
  contentKeymapSave,
  contentKeymaps,
  contentWriteFile,
  type StoredKeymap,
} from "../../bindings";
import type { Keymap, SavedKeymap } from "../../keymap";
import { toSaved } from "../../keymap";

const KEYMAP_KIND_VERSION = 1;

/** A stored keymap's payload, or null when the file on disk is unreadable. */
function payloadOf(stored: StoredKeymap): SavedKeymap | null {
  try {
    const parsed = JSON.parse(stored.json) as SavedKeymap;
    return Array.isArray(parsed.bindings) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Decode a keymap container (a file's text or a pasted code, which
 * `decodeContainerText` tells apart) and hand it to `onApply`. Returns a message
 * to show when it is not a keymap, or `null` when it worked.
 */
export function applyContainerText(
  text: string,
  onApply: (saved: SavedKeymap) => void,
): string | null {
  const container = asContainer(decodeContainerText(text));
  if (container?.kind !== "keymap") {
    return "That is not a coilbox keymap.";
  }
  const payload = container.payload as SavedKeymap;
  if (!Array.isArray(payload.bindings)) {
    return "That keymap has no bindings in it.";
  }
  onApply(payload);
  return null;
}

/**
 * Named keymaps for a content root: save the one on screen, put a saved one
 * back, and share it.
 *
 * Applying a keymap loads it into the editor rather than writing the file, so
 * Save in the section footer stays the only thing that touches disk and a
 * player can look before they leap.
 *
 * Separate from Saved configs, which snapshots settings, widget config and
 * keybinds together. That is for moving a whole setup between machines, this is
 * for a keymap on its own, which is the thing people actually swap.
 */
export function KeymapsPanel({
  rootPath,
  keymap,
  gameName,
  onApply,
}: {
  rootPath: string;
  keymap: Keymap;
  gameName?: string;
  onApply: (saved: SavedKeymap) => void;
}) {
  const [saved, setSaved] = useState<StoredKeymap[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const { keymaps } = await contentKeymaps({ rootPath });
      setSaved(keymaps);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [rootPath]);

  useEffect(() => {
    setStatus(null);
    setError(null);
    void refresh();
  }, [refresh]);

  async function onSave() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      await contentKeymapSave({
        rootPath,
        name: trimmed,
        json: JSON.stringify(toSaved(keymap, gameName)),
      });
      setName("");
      setStatus(`Saved "${trimmed}".`);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onRemove(stored: StoredKeymap) {
    setBusy(true);
    setError(null);
    try {
      await contentKeymapDelete({ rootPath, slug: stored.slug });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onExport(stored: StoredKeymap) {
    const payload = payloadOf(stored);
    if (!payload) {
      setError(`"${stored.name}" could not be read.`);
      return;
    }
    setError(null);
    try {
      const dest = await save({
        title: "Export keymap",
        defaultPath: `${stored.slug}.json`,
        filters: [{ name: "Coilbox keymap", extensions: ["json"] }],
      });
      if (!dest) return;
      await contentWriteFile({
        dest,
        text: encodeContainerJson("keymap", KEYMAP_KIND_VERSION, payload),
      });
      setStatus(`Exported "${stored.name}".`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function onCopyLink(stored: StoredKeymap) {
    const payload = payloadOf(stored);
    if (!payload) {
      setError(`"${stored.name}" could not be read.`);
      return;
    }
    const code = encodeContainerCode("keymap", KEYMAP_KIND_VERSION, payload);
    void copyDeepLink(buildImportCodeLink(code));
    setStatus(`Copied a link to "${stored.name}".`);
  }

  async function onImport() {
    setError(null);
    try {
      const src = await open({
        title: "Import keymap",
        multiple: false,
        filters: [{ name: "Coilbox keymap", extensions: ["json"] }],
      });
      if (typeof src !== "string") return;
      const { text } = await importContainerFile({ src });
      const problem = applyContainerText(text, onApply);
      setStatus(problem ? null : "Imported. Save to write it to uikeys.txt.");
      setError(problem);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border/50 bg-card p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold text-sm">Saved keymaps</h2>
          <p className="mt-0.5 text-muted-foreground text-xs">
            Keep this keymap under a name, switch between them, and share one.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={onImport}>
          <Upload className="mr-1 size-3.5" />
          Import
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void onSave();
          }}
          placeholder="Name this keymap"
        />
        <Button size="sm" disabled={busy || !name.trim()} onClick={onSave}>
          Save
        </Button>
      </div>

      {error ? <p className="text-destructive text-xs">{error}</p> : null}
      {status ? (
        <p className="text-muted-foreground text-xs">{status}</p>
      ) : null}

      {saved.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No saved keymaps for this content folder yet.
        </p>
      ) : (
        <ul className="space-y-1">
          {saved.map((s) => {
            const payload = payloadOf(s);
            const otherGame =
              payload?.gameName && gameName && payload.gameName !== gameName;
            return (
              <li
                key={s.slug}
                className="rounded border border-border/40 px-2 py-1.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-sm">{s.name}</span>
                  <span className="flex shrink-0 items-center gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy || !payload}
                      onClick={() => payload && onApply(payload)}
                    >
                      Apply
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onExport(s)}
                      aria-label={`Export ${s.name}`}
                    >
                      <Download className="size-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onCopyLink(s)}
                      aria-label={`Copy a link to ${s.name}`}
                    >
                      <Link2 className="size-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => onRemove(s)}
                      aria-label={`Delete ${s.name}`}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </span>
                </div>
                {otherGame ? (
                  <p className="mt-0.5 text-muted-foreground text-xs">
                    Built for {payload?.gameName}. Applying it here keeps its
                    bindings, including any this game does not have.
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
