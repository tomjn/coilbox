import type { EngineConfigSetting } from "../bindings";
import { useScanTargetSelection, useUnitsyncEngineConfig } from "../config";
import { BrowserToolbar } from "./components/BrowserToolbar";
import {
  Diagnostics,
  EmptyState,
  ErrorBanner,
  SkeletonList,
} from "./components/states";

/** Group settings by category, preserving the worker's (catalog) order. */
function groupByCategory(
  settings: EngineConfigSetting[],
): [string, EngineConfigSetting[]][] {
  const groups = new Map<string, EngineConfigSetting[]>();
  for (const s of settings) {
    const arr = groups.get(s.category);
    if (arr) arr.push(s);
    else groups.set(s.category, [s]);
  }
  return Array.from(groups.entries());
}

/**
 * Read-only engine settings: a curated set of `springsettings.cfg` values read
 * through unitsync for the selected engine + content root. unitsync can't
 * enumerate config keys, so the worker reads a hand-picked catalog; unset keys
 * show the engine default. The frame renders the section title, so this is the
 * body only.
 */
export default function EngineSettingsSection() {
  const { targets, selected, selectedKey, setSelectedKey } =
    useScanTargetSelection();
  const { data, loading, error, run } = useUnitsyncEngineConfig(
    selected?.enginePath,
    selected?.rootPath,
  );

  const settings = data?.settings ?? [];
  const groups = groupByCategory(settings);
  const busy = loading || (!!selected && !data && !error);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Engine configuration read from your{" "}
        <span className="font-mono">springsettings.cfg</span> via unitsync.
        Values are read-only; settings you haven't changed show the engine
        default.
      </p>

      <BrowserToolbar
        targets={targets}
        selectedKey={selectedKey}
        onSelect={setSelectedKey}
        onRescan={() => run(true)}
        scanning={loading}
      />

      {error && <ErrorBanner message={error} />}
      {data?.errors?.length ? <Diagnostics errors={data.errors} /> : null}

      {busy ? (
        <SkeletonList />
      ) : targets.length === 0 ? (
        <EmptyState label="No engines found in your content folders — add a content folder or install an engine to read its settings." />
      ) : settings.length === 0 ? (
        <EmptyState
          label={
            data
              ? "No engine settings could be read for this engine. See the details above."
              : "No engine settings to display yet."
          }
        />
      ) : (
        <div className="flex flex-col gap-6">
          {groups.map(([category, items]) => (
            <section key={category} className="flex flex-col gap-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {category}
              </h2>
              <dl className="grid grid-cols-[minmax(10rem,auto)_1fr] gap-x-4 gap-y-1 rounded-lg border border-border/50 bg-card p-3 text-sm">
                {items.map((s) => (
                  <div key={s.key} className="contents">
                    <dt className="text-muted-foreground" title={s.key}>
                      {s.label}
                    </dt>
                    <dd className="break-words font-mono">{s.value || "—"}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      )}

      {data?.configPath ? (
        <p
          className="break-all font-mono text-xs text-muted-foreground"
          title={data.configPath}
        >
          Config file: {data.configPath}
        </p>
      ) : null}
    </div>
  );
}
