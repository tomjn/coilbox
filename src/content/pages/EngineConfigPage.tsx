import { Link } from "react-router";
import { useScanTargetSelection, useUnitsyncEngineConfig } from "../config";
import { BrowserToolbar } from "./components/BrowserToolbar";
import { EngineSettingField } from "./components/EngineSettingField";
import {
  Diagnostics,
  EmptyState,
  ErrorBanner,
  SkeletonList,
} from "./components/states";

/**
 * One page of engine settings: the `springsettings.cfg` values in a single
 * catalog category, read and written through unitsync for the selected engine
 * and content root.
 *
 * This was one long page with headings. The categories the worker already puts
 * every setting in make better pages than headings, so each is its own section
 * under Game settings and this component is what they all render. A category
 * added to the worker's catalog appears here with no change on this side.
 *
 * Splitting the page costs one worker call, not five. `useUnitsyncEngineConfig`
 * reads through a session cache keyed by engine and root, and which engine is
 * selected is a persisted setting, so both follow the reader between pages.
 *
 * unitsync can't enumerate config keys, so the worker reads a hand-picked
 * catalog. Unset keys show the engine default. Each edit is written back
 * immediately. The frame renders the section title, so this is the body only.
 */
export function EngineConfigPage({ category }: { category: string }) {
  const { targets, selected, selectedKey, setSelectedKey } =
    useScanTargetSelection();
  const { data, loading, error, run, write } = useUnitsyncEngineConfig(
    selected?.enginePath,
    selected?.rootPath,
  );

  const settings = (data?.settings ?? []).filter(
    (s) => s.category === category,
  );
  const busy = loading || (!!selected && !data && !error);
  // A build that lacks SetSpringConfig* can be read but not written. Fall back
  // to disabled controls in that case.
  const writable = data?.writable !== false;

  return (
    <div className="space-y-4">
      {data && !data.writable ? (
        <p className="rounded-md border border-border/50 bg-muted/30 p-2 text-xs text-muted-foreground">
          This engine's unitsync build can't write settings, so they're shown
          read-only. Update the engine to edit them here.
        </p>
      ) : null}

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
        <EmptyState
          label={
            <>
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
            </>
          }
        />
      ) : settings.length === 0 ? (
        <EmptyState
          label={
            data
              ? "No settings could be read for this engine. See the details above."
              : "No settings to display yet."
          }
        />
      ) : (
        <div className="grid grid-cols-[minmax(10rem,auto)_1fr] items-center gap-x-4 gap-y-2.5 rounded-lg border border-border/50 bg-card p-3 text-sm">
          {settings.map((s) => (
            <EngineSettingField
              key={s.key}
              setting={s}
              writable={writable}
              onWrite={write}
            />
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

/**
 * A settings section's Component for one category.
 *
 * The frame renders sections directly, with no props and no Suspense boundary,
 * so each category needs a component of its own rather than a prop.
 */
export function engineConfigPage(category: string) {
  return function CategoryPage() {
    return <EngineConfigPage category={category} />;
  };
}
