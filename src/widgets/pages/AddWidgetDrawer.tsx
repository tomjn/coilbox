import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";
import { open } from "@tauri-apps/plugin-dialog";
import { File, FolderOpen, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import {
  contentOpenPath,
  contentWidgetAdd,
  contentWidgetPlan,
  type WidgetAddOutcome,
  type WidgetConflict,
  type WidgetPlan,
} from "@/content/bindings";
import { describeError } from "@/i18n/uiError";
import { destinationsFor, namesToSwitch, nestedWarning } from "../addWidget";
import type { GameHandler } from "../widgetList";
import { switchAddedWidgets } from "../widgetSync";

type Added = Extract<WidgetAddOutcome, { kind: "added" }>;

/**
 * Add a widget from a `.lua` file, a folder or a zip (issue #1286).
 *
 * Picking reads what is in it. Adding copies it into the folder each game reads
 * and keeps its layout. A widget already there with the same name, or a file the
 * new ones would overwrite, is shown first and only replaced once the player
 * says so, with the old files copied aside.
 */
export function AddWidgetDrawer({
  writeDir,
  games,
  caseSensitive,
  game,
  setKey,
  onAdded,
}: {
  writeDir: string;
  games: readonly GameHandler[];
  caseSensitive: boolean;
  /** The game picked on the page, which the widget is added for alone. */
  game?: GameHandler;
  /** The set the page shows: a game's key, or `null` for the one every game
   *  uses. The widget is switched on there. */
  setKey: string | null;
  /** Called after files are copied, so the page reads them. */
  onAdded: () => void;
}) {
  const { t } = useLingui();
  const [source, setSource] = useState<string | null>(null);
  const [plan, setPlan] = useState<WidgetPlan | null>(null);
  const [conflicts, setConflicts] = useState<WidgetConflict[] | null>(null);
  const [added, setAdded] = useState<Added | null>(null);
  const [unwritten, setUnwritten] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const where = useMemo(
    () =>
      plan
        ? destinationsFor(games, {
            rml: plan.rml,
            caseSensitive,
            only: game?.game,
          })
        : null,
    [plan, games, caseSensitive, game],
  );
  const nested = useMemo(
    () =>
      plan && where ? nestedWarning(plan, games, where.destinations) : null,
    [plan, where, games],
  );

  const pick = async (directory: boolean) => {
    const picked = await open({
      directory,
      multiple: false,
      title: directory ? t`Choose a widget folder` : t`Choose a widget`,
      filters: directory
        ? undefined
        : [{ name: t`Widget`, extensions: ["lua", "zip"] }],
    });
    if (typeof picked !== "string") return;
    setSource(picked);
    setPlan(null);
    setConflicts(null);
    setAdded(null);
    setUnwritten([]);
    setError(null);
    setBusy(true);
    try {
      setPlan(await contentWidgetPlan({ source: picked }));
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  const add = async (replace: boolean) => {
    if (!source || !plan || !where) return;
    setBusy(true);
    setError(null);
    try {
      const outcome = await contentWidgetAdd({
        writeDir,
        source,
        folders: where.destinations.map((d) => d.folder),
        replace,
      });
      if (outcome.kind === "conflicts") {
        setConflicts(outcome.conflicts);
        return;
      }
      const replaced = (conflicts ?? []).flatMap((c) =>
        c.reason === "name" && c.name !== null ? [c.name] : [],
      );
      setConflicts(null);
      setAdded(outcome);
      onAdded();
      setUnwritten(
        await switchAddedWidgets({
          writeDir,
          games,
          key: setKey,
          names: namesToSwitch(outcome.widgets, replaced),
        }),
      );
      onAdded();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  const target = game ? game.game : t`All games`;
  const folderList = added?.folders.join(", ") ?? "";
  const backupPath = added?.backup ?? "";
  const canAdd =
    !!plan &&
    !!where &&
    where.destinations.length > 0 &&
    !added &&
    !conflicts &&
    !busy;

  return (
    <div className="flex flex-col gap-4 overflow-auto p-4 text-sm">
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => void pick(false)}
        >
          <File />
          <Trans>Choose a file or zip</Trans>
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => void pick(true)}
        >
          <FolderOpen />
          <Trans>Choose a folder</Trans>
        </Button>
      </div>

      {source && (
        <p className="break-all font-mono text-xs text-muted-foreground">
          {source}
        </p>
      )}
      {busy && !plan && <Loader2 className="size-4 animate-spin" />}
      {error && (
        <p role="alert" className="break-words text-xs text-destructive">
          {error}
        </p>
      )}

      {plan && where && !added && (
        <div className="flex flex-col gap-3">
          <ul className="flex flex-col gap-1">
            {plan.widgets.map((w) => (
              <li key={w.path} className="break-words">
                <span className="font-medium">{w.name ?? w.path}</span>
                {w.nested && (
                  <span className="text-muted-foreground">
                    {" "}
                    <Trans>in a subfolder</Trans>
                  </span>
                )}
                {w.error && (
                  <span className="block text-xs text-destructive">
                    {t`Could not read: ${w.error}`}
                  </span>
                )}
              </li>
            ))}
          </ul>

          {where.destinations.length > 0 ? (
            <ul className="flex flex-col gap-1">
              {where.destinations.map((d) => (
                <li key={d.folder} className="break-words">
                  <span className="font-mono text-xs">{d.folder}</span>
                  <span className="block text-xs text-muted-foreground">
                    {d.games.join(", ")}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p role="status" className="text-muted-foreground">
              <Trans>No installed game with a folder for this widget.</Trans>
            </p>
          )}

          {where.skipped.map((s) => (
            <p
              key={s.game}
              role="status"
              className="break-words text-xs text-muted-foreground"
            >
              {s.reason === "unknown-handler"
                ? t`${s.game}: coilbox does not recognise its widget handler, so nothing is added for it.`
                : t`${s.game}: has no folder for RmlUi widgets.`}
            </p>
          ))}

          {nested && (
            <p role="status" className="break-words text-xs text-destructive">
              <Plural
                value={nested.widgets.length}
                one="# widget sits in a subfolder, which these games do not load:"
                other="# widgets sit in a subfolder, which these games do not load:"
              />{" "}
              {nested.games.join(", ")}
            </p>
          )}

          {where.destinations.length > 0 && (
            <p className="text-muted-foreground">
              <Trans>Switched on for {target}, off everywhere else.</Trans>
            </p>
          )}

          {conflicts && (
            <div className="flex flex-col gap-2 rounded-md border border-border p-2">
              <p className="font-medium">
                <Trans>Replace what is already there?</Trans>
              </p>
              <ul className="flex flex-col gap-1">
                {conflicts.map((c) => (
                  <li key={c.path} className="break-all font-mono text-xs">
                    {c.path}
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">
                <Trans>
                  The old files are copied to the widget backups first.
                </Trans>
              </p>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => setConflicts(null)}
                >
                  <Trans>Cancel</Trans>
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={busy}
                  onClick={() => void add(true)}
                >
                  <Trans>Replace</Trans>
                </Button>
              </div>
            </div>
          )}

          {!conflicts && (
            <div className="flex justify-end">
              <Button
                type="button"
                size="sm"
                disabled={!canAdd}
                onClick={() => void add(false)}
              >
                {busy ? <Loader2 className="animate-spin" /> : null}
                <Trans>Add widget</Trans>
              </Button>
            </div>
          )}
        </div>
      )}

      {added && (
        <div className="flex flex-col gap-2">
          <p role="status">
            <Trans>Added to {folderList}.</Trans>
          </p>
          {added.backup && (
            <div className="flex items-center justify-between gap-2">
              <p className="break-all text-xs text-muted-foreground">
                <Trans>The old files are in {backupPath}</Trans>
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  if (added.backup)
                    contentOpenPath({ path: added.backup }).catch(() => {});
                }}
              >
                <FolderOpen />
                <Trans>Open</Trans>
              </Button>
            </div>
          )}
          {unwritten.map((line) => (
            <p key={line} className="break-words text-xs text-destructive">
              {t`Could not save the setting for ${line}`}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
