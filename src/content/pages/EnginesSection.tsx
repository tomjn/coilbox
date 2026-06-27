import { openPath } from "@tauri-apps/plugin-opener";
import { AlertCircle } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { EngineInstaller } from "../../downloads/pages/components/EngineInstaller";
import {
  type ContentState,
  contentVerifyEngine,
  type Engine,
} from "../bindings";
import { useContentState } from "../config";
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
    openPath(path).catch((e) => setActionError(msg(e)));
  };

  const groups = (state?.roots ?? []).filter((r) => r.engines.length > 0);
  const total = groups.reduce((n, r) => n + r.engines.length, 0);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Engine installs found across your content folders. Verify reads the real
        version from the binary.
      </p>

      {actionError && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <span className="break-words">{actionError}</span>
        </div>
      )}

      {loading && !state ? (
        <div className="flex flex-col gap-3">
          <div className="h-16 animate-pulse rounded-lg border border-border/50 bg-card" />
          <div className="h-16 animate-pulse rounded-lg border border-border/50 bg-card" />
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
              Content Folders
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
                    onVerify={verify}
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
