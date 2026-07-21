import { Button, Input } from "@picoframe/frame";
import { Loader2, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type { EngineConfigSetting, EngineConfigWriteResult } from "../bindings";
import { useScanTargetSelection, useUnitsyncEngineConfig } from "../config";
import { BrowserToolbar } from "./components/BrowserToolbar";
import { ConfigProfilesPanel } from "./components/ConfigProfilesPanel";
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
 * Editable engine settings: a curated set of `springsettings.cfg` values read
 * (and written) through unitsync for the selected engine + content root. unitsync
 * can't enumerate config keys, so the worker reads a hand-picked catalog; unset
 * keys show the engine default. Each edit is written back immediately via
 * `SetSpringConfig*`. The frame renders the section title, so this is the body
 * only.
 */
export default function EngineSettingsSection() {
  const { targets, selected, selectedKey, setSelectedKey } =
    useScanTargetSelection();
  const { data, loading, error, run, write } = useUnitsyncEngineConfig(
    selected?.enginePath,
    selected?.rootPath,
  );

  const settings = data?.settings ?? [];
  const groups = groupByCategory(settings);
  const busy = loading || (!!selected && !data && !error);
  // A build that lacks SetSpringConfig* can be read but not written; fall back
  // to disabled controls in that case.
  const writable = data?.writable !== false;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Engine configuration read from your{" "}
        <span className="font-mono">springsettings.cfg</span> via unitsync.
        Changes are written back as you make them; settings you haven't changed
        show the engine default.
      </p>

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
              No engines found in your content folders — add a folder in{" "}
              <Link
                to="/settings/content-folders"
                className="underline underline-offset-4"
              >
                Content Folders
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
              <div className="grid grid-cols-[minmax(10rem,auto)_1fr] items-center gap-x-4 gap-y-2.5 rounded-lg border border-border/50 bg-card p-3 text-sm">
                {items.map((s) => (
                  <EngineSettingField
                    key={s.key}
                    setting={s}
                    writable={writable}
                    onWrite={write}
                  />
                ))}
              </div>
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

      {selected?.rootPath && (
        <ConfigProfilesPanel rootPath={selected.rootPath} />
      )}
    </div>
  );
}

/**
 * One editable engine setting rendered as the control its type calls for — a
 * checkbox for `bool`, a number/text field otherwise — mirroring the
 * singleplayer mod-options panel. Checkboxes commit on toggle; text/number
 * fields commit on blur or Enter (never per keystroke, so we don't spawn a
 * worker per character). The committed value is owned by the parent (updated on
 * a successful write); the field keeps only a transient `draft` while editing
 * and reverts it if the write fails. Label and control share the parent grid via
 * `contents`.
 */
function EngineSettingField({
  setting: s,
  writable,
  onWrite,
}: {
  setting: EngineConfigSetting;
  writable: boolean;
  onWrite: (key: string, value: string) => Promise<EngineConfigWriteResult>;
}) {
  const id = `engineopt-${s.key}`;
  const [draft, setDraft] = useState(s.value);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Re-sync the draft when the committed value changes (reset, rescan, etc.).
  useEffect(() => setDraft(s.value), [s.value]);

  const changed = s.value !== s.default;

  async function commit(value: string) {
    if (value === s.value) return;
    setSaving(true);
    setErr(null);
    const res = await onWrite(s.key, value);
    setSaving(false);
    if (!res.ok) {
      setErr(res.errors[0] ?? "write failed");
      setDraft(s.value); // revert to the last committed value
    }
  }

  const reset = writable && changed && (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-7 gap-1 px-2 text-xs text-muted-foreground"
      title={`Reset to engine default (${s.default || "empty"})`}
      disabled={saving}
      onClick={() => commit(s.default)}
    >
      <RotateCcw className="size-3" />
      Reset
    </Button>
  );

  const status = saving ? (
    <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
  ) : err ? (
    <span className="truncate text-xs text-destructive" title={err}>
      {err}
    </span>
  ) : null;

  if (s.type === "bool") {
    return (
      <div className="contents">
        <Label
          htmlFor={id}
          className="font-normal text-muted-foreground"
          title={s.key}
        >
          {s.label}
        </Label>
        <div className="flex min-w-0 items-center gap-2">
          <Checkbox
            id={id}
            checked={s.value === "1"}
            disabled={!writable || saving}
            onCheckedChange={(v) => commit(v === true ? "1" : "0")}
          />
          {status}
          {reset}
        </div>
      </div>
    );
  }

  return (
    <div className="contents">
      <Label
        htmlFor={id}
        className="font-normal text-muted-foreground"
        title={s.key}
      >
        {s.label}
      </Label>
      <div className="flex min-w-0 items-center gap-2">
        <Input
          id={id}
          type={s.type === "number" ? "number" : "text"}
          value={draft}
          placeholder={s.default}
          disabled={!writable || saving}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => commit(draft)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit(draft);
          }}
        />
        {status}
        {reset}
      </div>
    </div>
  );
}
