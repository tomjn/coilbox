import { plural } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import {
  type CoilboxWidget,
  contentWidgetInstall,
  contentWidgetRemove,
  contentWidgetStatus,
  type WidgetStatus,
} from "@/content/bindings";
import { ErrorBanner } from "@/content/pages/components/states";
import { describeError } from "@/i18n/uiError";

/** What a widget's row hands to its own extra actions. */
export interface CoilboxWidgetState {
  rootPath: string;
  /** Null until the first read of the content root finishes. */
  status: WidgetStatus | null;
  /** An install, update or removal is running. */
  busy: boolean;
  /** Read the content root again, for an action that changes what is there. */
  reread: () => Promise<void>;
}

/** A widget coilbox ships, as the page lists it. */
interface CoilboxWidgetEntry {
  widget: CoilboxWidget;
  name: string;
  description: string;
  /** Buttons only this widget has, shown beside Install and Remove. */
  actions?: (state: CoilboxWidgetState) => ReactNode;
}

/** Every widget coilbox ships. A new one is one more entry, with `actions` for
 *  anything beyond install, update and remove. */
function useEntries(): CoilboxWidgetEntry[] {
  const { t } = useLingui();
  return [
    {
      widget: "blueprints",
      name: t`Blueprints`,
      description: t`Places a blueprint from your library in game and saves one back.`,
    },
    {
      widget: "skeleton",
      name: t`Skeleton`,
      description: t`Draws the bones of the selected units in game.`,
    },
  ];
}

/** One widget under one content root: its status, and the three actions. */
function useCoilboxWidget(
  widget: CoilboxWidget,
  rootPath: string,
  onChanged: () => void,
) {
  const [status, setStatus] = useState<WidgetStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const read = useCallback(async () => {
    try {
      setStatus(await contentWidgetStatus({ rootPath, widget }));
      setError(null);
    } catch (e) {
      setError(describeError(e));
    }
  }, [rootPath, widget]);

  useEffect(() => {
    setStatus(null);
    void read();
  }, [read]);

  const act = async (run: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await run();
      await read();
      onChanged();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  return {
    status,
    busy,
    error,
    read,
    install: () => act(() => contentWidgetInstall({ rootPath, widget })),
    remove: () => act(() => contentWidgetRemove({ rootPath, widget })),
  };
}

function CoilboxWidgetRow({
  entry,
  rootPath,
  onChanged,
}: {
  entry: CoilboxWidgetEntry;
  rootPath: string;
  onChanged: () => void;
}) {
  const { t } = useLingui();
  const { status, busy, error, read, install, remove } = useCoilboxWidget(
    entry.widget,
    rootPath,
    onChanged,
  );
  const staleCount = status?.stale.length ?? 0;
  const fileCount = status?.files.length ?? 0;
  const actionLabel = !status?.installed
    ? t`Install widget`
    : status.current
      ? t`Reinstall widget`
      : t`Update widget`;

  return (
    <li
      className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2"
      aria-label={entry.name}
    >
      <div className="min-w-48 flex-1">
        <p className="font-medium">{entry.name}</p>
        <p className="text-sm text-muted-foreground">{entry.description}</p>
        <p className="text-xs text-muted-foreground">
          {status === null
            ? t`Checking…`
            : !status.installed
              ? t`Not installed`
              : status.current
                ? t`Installed and up to date`
                : t`Installed, and ${staleCount} of ${plural(fileCount, { one: "# file differs", other: "# files differ" })} from what this coilbox ships`}
        </p>
        {error && <ErrorBanner message={error} />}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={busy || status === null}
          onClick={() => void install()}
        >
          {busy ? t`Working…` : actionLabel}
        </Button>
        {status?.installed && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void remove()}
          >
            {t`Remove widget`}
          </Button>
        )}
        {entry.actions?.({ rootPath, status, busy, reread: read })}
      </div>
    </li>
  );
}

/**
 * The widgets coilbox ships, each with its state in one content root and the
 * buttons that install, update and remove it (issue #5180). Nothing installs on
 * its own: a launcher that writes widgets into a player's folders unasked is
 * one people stop trusting.
 */
export function CoilboxWidgets({
  rootPath,
  onChanged,
}: {
  rootPath: string;
  /** Called after an install, update or removal, so the page can list the
   *  files that changed. */
  onChanged: () => void;
}) {
  const { t } = useLingui();
  const entries = useEntries();
  return (
    <section aria-label={t`Coilbox widgets`} className="flex flex-col gap-2">
      <h2 className="text-sm font-medium">{t`Coilbox widgets`}</h2>
      <ul className="divide-y rounded-md border">
        {entries.map((entry) => (
          <CoilboxWidgetRow
            key={entry.widget}
            entry={entry}
            rootPath={rootPath}
            onChanged={onChanged}
          />
        ))}
      </ul>
    </section>
  );
}
