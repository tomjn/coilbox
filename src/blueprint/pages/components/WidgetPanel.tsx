/**
 * The in game widget: installed or not, install, update, remove (issue #1419).
 *
 * Coilbox ships a widget that places a blueprint in game and saves one back.
 * It never installs it on its own, because a launcher that writes widgets into
 * a player's config unasked is one people stop trusting, and it never updates
 * it on its own for the same reason. This is the one place it goes in, and the
 * same button updates it when what is installed no longer matches what this
 * coilbox ships.
 *
 * It goes into the content root the preferred engine reads, once, rather than
 * into each engine. Whether it starts enabled is the game's widget handler's
 * business, so the panel says to look in F11 rather than reaching into a
 * config file whose format is not coilbox's.
 */

import { Button } from "@picoframe/frame";
import { useCallback, useEffect, useState } from "react";

import {
  contentWidgetInstall,
  contentWidgetRemove,
  contentWidgetStatus,
  type WidgetStatus,
} from "@/content/bindings";
import { ErrorBanner } from "@/content/pages/components/states";
import { usePreferredTarget } from "@/play/config";
import { usePlay } from "@/play/PlayProvider";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function WidgetPanel({
  onChanged,
}: {
  onChanged?: (said: string) => void;
}) {
  const { target } = usePreferredTarget();
  const { running } = usePlay();
  const rootPath = target?.dataDir;
  const [status, setStatus] = useState<WidgetStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const read = useCallback(async () => {
    if (!rootPath) return;
    try {
      setStatus(await contentWidgetStatus({ rootPath }));
      setError(null);
    } catch (e) {
      setError(message(e));
    }
  }, [rootPath]);

  useEffect(() => {
    void read();
  }, [read]);

  const act = async (
    run: () => Promise<unknown>,
    said: string,
  ): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await run();
      await read();
      onChanged?.(said);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  if (!rootPath) {
    return (
      <div className="flex flex-col gap-3 p-4">
        <p className="text-sm text-muted-foreground">
          Coilbox does not have an engine and content root to play with yet, so
          there is nowhere to put the widget. Install an engine first.
        </p>
      </div>
    );
  }

  const verb = !status?.installed
    ? "Install"
    : status.current
      ? "Reinstall"
      : "Update";

  return (
    <div className="flex flex-col gap-4 p-4 text-sm">
      <p className="text-muted-foreground">
        A widget that lists the blueprints in this library while you play,
        places one at the cursor as ghosts and build orders, and saves the
        buildings you have selected back here. It reads BAR's own
        blueprints.json too, and never writes it. It opens no network
        connection.
      </p>

      {error && <ErrorBanner message={error} />}

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        <dt className="text-muted-foreground">Goes into</dt>
        <dd className="break-all font-mono text-xs">{rootPath}/LuaUI</dd>
        <dt className="text-muted-foreground">State</dt>
        <dd>
          {status === null
            ? "Checking…"
            : !status.installed
              ? "Not installed"
              : status.current
                ? "Installed and up to date"
                : `Installed, and ${status.stale.length} of ${status.files.length} files differ from what this coilbox ships`}
        </dd>
      </dl>

      {running && (
        <p className="text-xs text-muted-foreground">
          A game is running. The engine reads the widget when a match starts, so
          a change now lands in the next one.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          disabled={busy || status === null}
          onClick={() =>
            void act(
              () => contentWidgetInstall({ rootPath }),
              `${verb === "Update" ? "Updated" : "Installed"} the blueprint widget. Press F11 in game to check it is enabled.`,
            )
          }
        >
          {busy ? "Working…" : `${verb} widget`}
        </Button>
        {status?.installed && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              void act(
                () => contentWidgetRemove({ rootPath }),
                "Removed the blueprint widget. Your library file and anything saved in game stay where they are.",
              )
            }
          >
            Remove widget
          </Button>
        )}
      </div>

      <div className="flex flex-col gap-2 text-xs text-muted-foreground">
        <p>
          After installing, press F11 in game and check "Coilbox blueprints" is
          enabled. Which widgets start enabled is the game's choice, kept in a
          file of its own that coilbox does not edit.
        </p>
        <p>
          Open the panel with the <code>coilbox_blueprints</code> action: bind a
          key to it, or type <code>/coilbox_blueprints</code> in the console.
          Turn a layout with [ and ], place it with a click, and put it down
          with right click or escape.
        </p>
        <p>
          Coilbox writes this library to the content root whenever it changes,
          and collects what you saved in game when you come back here with no
          game running.
        </p>
      </div>
    </div>
  );
}
