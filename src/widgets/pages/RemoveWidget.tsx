import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";
import { FolderOpen, Loader2, Trash2, Undo2 } from "lucide-react";
import { useState } from "react";
import { appFileIO } from "@/blueprint/fileIO";
import { CheckField } from "@/components/Field";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { contentOpenPath, contentWidgetRestore } from "@/content/bindings";
import { describeError } from "@/i18n/uiError";
import { errorText } from "@/lib/helpers";
import type { GameHandler, WidgetRow } from "../widgetList";
import {
  type EntryPlan,
  entryTargets,
  planEntryRemoval,
  type RemovalResult,
  removalFor,
  removeWidget,
} from "../widgetRemoval";
import { switchRestoredWidgets } from "../widgetSync";

function fileName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** What the page remembers of a removal, so the player can undo it. */
export interface RemovedWidget extends RemovalResult {
  name: string;
  /** The write folder it was removed from, which the engine picked on the
   *  page may no longer be. */
  writeDir: string;
}

/**
 * Remove one widget from the folders its games read (issue #1288). The first
 * click asks, naming the games that lose the widget and the files that go. The
 * files are copied to the widget backups first. The player can also have the
 * widget's entries taken out of the games' config files, which is offered only
 * when some hold any.
 */
export function RemoveWidgetButton({
  row,
  rows,
  games,
  writeDir,
  running,
  onRemoved,
}: {
  row: WidgetRow;
  rows: readonly WidgetRow[];
  games: readonly GameHandler[];
  writeDir: string;
  /** A game is running, which would write the widget back when it exits. */
  running: boolean;
  onRemoved: (removed: RemovedWidget) => void;
}) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState<EntryPlan | null>(null);
  const [entries, setEntries] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const removal = removalFor(rows, row);
  const name = row.info?.name || fileName(row.path);
  const files = [...removal.copies.map((c) => c.path), ...removal.folders];
  // A game whose handler is not recognised may load the files too.
  const unknown = games.filter((g) => g.handler === null).map((g) => g.game);

  const change = (next: boolean) => {
    setOpen(next);
    setPlan(null);
    setEntries(false);
    setError(null);
    if (!next) return;
    // Reads the games' config files to say whether any holds an entry, so the
    // option is offered only when it would do something.
    planEntryRemoval(
      appFileIO,
      writeDir,
      entryTargets(removal, rows, games),
    ).then(setPlan, (e) => setPlan({ files: [], failed: [errorText(e)] }));
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await removeWidget({
        writeDir,
        removal,
        rows,
        games,
        entries,
        gameRunning: running,
      });
      setOpen(false);
      onRemoved({ ...result, name, writeDir });
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  const holders = [...new Set(plan?.files.flatMap((f) => f.games))];
  return (
    <Popover open={open} onOpenChange={change}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={t`Remove ${name}`}
        >
          <Trash2 />
          <Trans>Remove</Trans>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="flex max-h-[80vh] w-96 flex-col gap-3 overflow-y-auto"
      >
        <div className="flex flex-col gap-2">
          <h3 className="break-words text-sm font-medium">
            {t`Remove ${name}?`}
          </h3>
          {removal.games.length > 0 && (
            <p className="max-h-32 overflow-y-auto break-words text-xs">
              {t`It is removed from every game that loads it: ${removal.games.join(", ")}`}
            </p>
          )}
          {unknown.length > 0 && (
            <p className="max-h-24 overflow-y-auto break-words text-xs text-muted-foreground">
              {t`Coilbox cannot tell whether these games load it too: ${unknown.join(", ")}`}
            </p>
          )}
          <ul className="flex flex-col gap-0.5">
            {files.map((f) => (
              <li
                key={f}
                className="break-all font-mono text-xs text-muted-foreground"
              >
                {f}
              </li>
            ))}
          </ul>
        </div>
        {plan && plan.files.length > 0 && (
          <CheckField
            label={t`Also delete its entries from the config files`}
            hint={holders.join(", ")}
            checked={entries}
            onChange={setEntries}
            disabled={busy}
          />
        )}
        {plan?.failed.map((line) => (
          <p key={line} className="break-words text-xs text-destructive">
            {t`Could not read the config file: ${line}`}
          </p>
        ))}
        {running && (
          <p role="status" className="text-xs text-muted-foreground">
            <Trans>A game is running. Close it to remove widgets.</Trans>
          </p>
        )}
        {error && (
          <p role="alert" className="break-words text-xs text-destructive">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => change(false)}
          >
            <Trans>Cancel</Trans>
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={busy || running || plan === null}
            onClick={() => void remove()}
          >
            {busy ? <Loader2 className="animate-spin" /> : <Trash2 />}
            <Trans>Remove</Trans>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * What a removal did, with the way back: the files can be copied back from the
 * widget backups while this is shown.
 */
export function RemovedNotice({
  removed,
  games,
  onRestored,
  onDismiss,
}: {
  removed: RemovedWidget;
  games: readonly GameHandler[];
  /** The files are back, so the page reads them. */
  onRestored: () => void;
  onDismiss: () => void;
}) {
  const { t } = useLingui();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The games whose config file could not be written, once restored. */
  const [restored, setRestored] = useState<string[] | null>(null);
  const { name, backup, entries, writeDir } = removed;

  const restore = async () => {
    setBusy(true);
    setError(null);
    try {
      await contentWidgetRestore({ writeDir, backup });
      onRestored();
      // Its state was forgotten when it went. Left alone, a game would read
      // what the config file still holds, or the widget's own default, and may
      // run it, so it comes back off.
      setRestored(
        await switchRestoredWidgets({
          writeDir,
          games,
          names: removed.forgotten,
        }),
      );
      onRestored();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-3 text-sm">
      <p role="status">
        {restored ? t`Restored ${name}, switched off.` : t`Removed ${name}.`}
      </p>
      {restored?.map((line) => (
        <p key={line} className="break-words text-xs text-destructive">
          {t`Could not save the setting for ${line}`}
        </p>
      ))}
      <p className="break-all font-mono text-xs text-muted-foreground">
        {backup}
      </p>
      {entries && entries.files.length > 0 && (
        <p className="break-all text-xs text-muted-foreground">
          {t`Config files as they were: ${entries.backups.join(", ")}`}
        </p>
      )}
      {entries?.failed.map((line) => (
        <p key={line} className="break-words text-xs text-destructive">
          {t`Could not remove its entries: ${line}`}
        </p>
      ))}
      {error && (
        <p role="alert" className="break-words text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        {!restored && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void restore()}
          >
            <Undo2 />
            <Trans>Restore</Trans>
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            contentOpenPath({ path: backup }).catch(() => {});
          }}
        >
          <FolderOpen />
          <Trans>Open backup</Trans>
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onDismiss}>
          <Trans>Dismiss</Trans>
        </Button>
      </div>
    </div>
  );
}
