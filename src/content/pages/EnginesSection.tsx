import { Trans } from "@lingui/react/macro";
import { AlertCircle } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { describeError } from "@/i18n/uiError";
import { EngineInstaller } from "../../downloads/pages/components/EngineInstaller";
import { HubEngineList } from "../../downloads/pages/components/HubEngineList";
import {
  type ContentState,
  contentOpenPath,
  contentVerifyEngine,
  type Engine,
} from "../bindings";
import { useContentState, usePreferredEngine } from "../config";
import { compareEngineVersions } from "../engineVersion";
import { useEngineUpdate } from "../useUpdates";
import { EngineRow } from "./components/EngineRow";

const msg = (e: unknown): string => describeError(e);

const newestFirst = (engines: Engine[]): Engine[] =>
  [...engines].sort((a, b) => compareEngineVersions(b.version, a.version));

/**
 * Engines settings section: the engines installed, grouped by content root and
 * newest first, then the two ways of getting more. Verify runs the binary to
 * read its real sync-version. The
 * frame renders the section title, so this is the body only.
 */
export default function EnginesSection() {
  const { state, setState, loading } = useContentState();
  const allEngines = (state?.roots ?? []).flatMap((r) => r.engines);
  const { resolvedId, setPrefId } = usePreferredEngine(allEngines);
  const newerEngine = useEngineUpdate();
  const [verifying, setVerifying] = useState<Set<string>>(new Set());
  const [actionError, setActionError] = useState<string | null>(null);

  const verify = async (engine: Engine) => {
    setVerifying((s) => new Set(s).add(engine.id));
    setActionError(null);
    try {
      const { engine: updated } = await contentVerifyEngine({
        path: engine.executable,
      });
      setState((s: ContentState | null) =>
        s
          ? {
              ...s,
              roots: s.roots.map((r) => ({
                ...r,
                engines: r.engines.map((e) =>
                  e.id === updated.id ? updated : e,
                ),
              })),
            }
          : s,
      );
    } catch (e) {
      setActionError(msg(e));
    } finally {
      setVerifying((s) => {
        const n = new Set(s);
        n.delete(engine.id);
        return n;
      });
    }
  };

  const openEngine = (path: string) => {
    contentOpenPath({ path }).catch((e) => setActionError(msg(e)));
  };

  const groups = (state?.roots ?? []).filter((r) => r.engines.length > 0);
  const total = groups.reduce((n, r) => n + r.engines.length, 0);

  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">
          <Trans>Installed</Trans>
        </h2>
        {actionError && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertDescription className="select-text whitespace-pre-wrap break-words">
              {actionError}
            </AlertDescription>
          </Alert>
        )}

        {loading && !state ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-16 rounded-lg border border-border/50 bg-card" />
            <Skeleton className="h-16 rounded-lg border border-border/50 bg-card" />
          </div>
        ) : total === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-10 text-center">
            <p className="text-sm text-muted-foreground">
              <Trans>No engines found in your content folders.</Trans>
            </p>
            <p className="text-sm text-muted-foreground">
              <Trans>
                Add a folder in{" "}
                <Link
                  to="/settings/content-folders"
                  className="underline underline-offset-4"
                >
                  Content folders
                </Link>{" "}
                or download an engine.
              </Trans>
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            {groups.map((root) => (
              <div key={root.id} className="flex flex-col gap-1.5">
                <h3
                  className="truncate font-mono text-xs text-muted-foreground"
                  title={root.path}
                >
                  {root.label ?? root.path}
                </h3>
                <ul className="divide-y divide-border rounded-md border border-border">
                  {newestFirst(root.engines).map((engine) => (
                    <EngineRow
                      key={engine.id}
                      engine={engine}
                      verifying={verifying.has(engine.id)}
                      isPreferred={engine.id === resolvedId}
                      onVerify={verify}
                      onSetPreferred={(e) => setPrefId(e.id)}
                      onOpen={openEngine}
                    />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}

        {newerEngine && (
          <p className="text-sm font-medium">
            <Trans>Newer engine available: {newerEngine}</Trans>
          </p>
        )}
      </section>

      <EngineInstaller />
      <HubEngineList />
    </div>
  );
}
