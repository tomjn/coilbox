import { AlertCircle } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { EngineInstaller } from "../../downloads/pages/components/EngineInstaller";
import {
  type ContentState,
  contentOpenPath,
  contentVerifyEngine,
  type Engine,
} from "../bindings";
import { useContentState, usePreferredEngine } from "../config";
import { EngineRow } from "./components/EngineRow";

const msg = (e: unknown): string =>
  e instanceof Error ? e.message : String(e);

/**
 * Engines settings section: lists engine installs grouped by content root, with
 * a Verify action that executes the binary to read its real sync-version. The
 * frame renders the section title, so this is the body only.
 */
export default function EnginesSection() {
  const { state, setState, loading } = useContentState();
  const allEngines = (state?.roots ?? []).flatMap((r) => r.engines);
  const { resolvedId, setPrefId } = usePreferredEngine(allEngines);
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
    <div className="space-y-4">
      {/* What this page is for is the section's description, under the title.
          This says only the part that description cannot: what Verify does. */}
      <p className="text-sm text-muted-foreground">
        Verify reads the real version from the binary.
      </p>

      {actionError && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription className="break-words">
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
            No engines found in your content folders.
          </p>
          <p className="text-sm text-muted-foreground">
            Add a folder in{" "}
            <Link
              to="/settings/content-folders"
              className="underline underline-offset-4"
            >
              Content folders
            </Link>{" "}
            or download an engine.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {groups.map((root) => (
            <section key={root.id} className="flex flex-col gap-2">
              <h2
                className="break-all font-mono text-xs text-muted-foreground"
                title={root.path}
              >
                {root.label ?? root.path}
              </h2>
              <ul className="flex flex-col gap-2">
                {root.engines.map((engine) => (
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
            </section>
          ))}
        </div>
      )}

      <EngineInstaller />
    </div>
  );
}
