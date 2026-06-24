import { Button, Input } from "@picoframe/frame";
import { AlertCircle, CheckCircle2, Loader2, Plus, Save, Server, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { type Config, usConfigGet, usConfigSet, usScenarios } from "../bindings";
import { CheckField, Field } from "./components/Field";
import { OptionSelect } from "./components/OptionSelect";

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Edits the persisted plugin config: the lobby-server list (targets for `load`),
 * run defaults, and the bench launch + database settings. The whole config is
 * loaded into local state, edited, and written back atomically via us_config_set.
 */
export default function ServersPage() {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [scenarios, setScenarios] = useState<string[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const { config } = await usConfigGet(undefined);
      setCfg(config);
    } catch (e) {
      setLoadError(errMessage(e));
    }
    try {
      const { scenarios } = await usScenarios(undefined);
      setScenarios(scenarios);
    } catch {
      // Scenario list is best-effort; the defaults field falls back to free text.
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Edit helpers: each returns a new Config so React sees a fresh reference.
  function patch(p: Partial<Config>) {
    setCfg((c) => (c ? { ...c, ...p } : c));
    setSaved(false);
  }
  function patchBench(p: Partial<Config["bench"]>) {
    setCfg((c) => (c ? { ...c, bench: { ...c.bench, ...p } } : c));
    setSaved(false);
  }
  function patchDb(p: Partial<Config["bench"]["db"]>) {
    setCfg((c) => (c ? { ...c, bench: { ...c.bench, db: { ...c.bench.db, ...p } } } : c));
    setSaved(false);
  }
  function patchDefaults(p: Partial<Config["defaults"]>) {
    setCfg((c) => (c ? { ...c, defaults: { ...c.defaults, ...p } } : c));
    setSaved(false);
  }

  function addServer() {
    if (!cfg) return;
    patch({ servers: [...cfg.servers, { id: crypto.randomUUID(), name: "", addr: "" }] });
  }
  function updateServer(id: string, key: "name" | "addr", value: string) {
    if (!cfg) return;
    patch({ servers: cfg.servers.map((s) => (s.id === id ? { ...s, [key]: value } : s)) });
  }
  function removeServer(id: string) {
    if (!cfg) return;
    patch({ servers: cfg.servers.filter((s) => s.id !== id) });
  }

  async function save() {
    if (!cfg) return;
    setSaving(true);
    setSaveError(null);
    try {
      await usConfigSet({ config: cfg });
      setSaved(true);
    } catch (e) {
      setSaveError(errMessage(e));
    } finally {
      setSaving(false);
    }
  }

  if (loadError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center text-sm">
        <AlertCircle className="text-destructive" />
        <p className="text-destructive">{loadError}</p>
        <Button variant="outline" size="sm" onClick={load}>
          Retry
        </Button>
      </div>
    );
  }

  if (!cfg) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="animate-spin" /> loading config…
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-border px-6 py-4">
        <div className="space-y-1">
          <h1 className="text-lg font-semibold leading-none">Servers &amp; configuration</h1>
          <p className="max-w-prose text-sm text-muted-foreground">
            Lobby servers to target, run defaults, and the bench launch + database settings.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {saved && (
            <span className="flex items-center gap-1.5 text-sm text-emerald-500">
              <CheckCircle2 size={15} /> Saved
            </span>
          )}
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="animate-spin" /> : <Save />}
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 space-y-8 overflow-auto px-6 py-6">
        {saveError && (
          <p className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircle size={15} className="mt-px shrink-0" />
            {saveError}
          </p>
        )}

        {/* Lobby servers */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              <Server size={15} /> Lobby servers
            </h2>
            <Button variant="outline" size="sm" onClick={addServer}>
              <Plus /> Add server
            </Button>
          </div>
          {cfg.servers.length === 0 ? (
            <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
              No servers yet. Add one to target it from the Run page.
            </p>
          ) : (
            <ul className="space-y-2">
              {cfg.servers.map((s) => (
                <li key={s.id} className="flex items-end gap-2">
                  <Field label="Name" className="flex-1">
                    <Input
                      value={s.name}
                      onChange={(e) => updateServer(s.id, "name", e.target.value)}
                      placeholder="Local dev"
                    />
                  </Field>
                  <Field label="Address" className="flex-1">
                    <Input
                      value={s.addr}
                      onChange={(e) => updateServer(s.id, "addr", e.target.value)}
                      placeholder="127.0.0.1:8200"
                      className="font-mono text-xs"
                    />
                  </Field>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => removeServer(s.id)}
                    aria-label={`Remove ${s.name || s.addr || "server"}`}
                  >
                    <Trash2 />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Run defaults */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Run defaults</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Field label="Scenario">
              {scenarios.length > 0 ? (
                <OptionSelect
                  value={cfg.defaults.scenario}
                  onValueChange={(v) => patchDefaults({ scenario: v })}
                  options={scenarios.map((s) => ({ value: s, label: s }))}
                />
              ) : (
                <Input
                  value={cfg.defaults.scenario}
                  onChange={(e) => patchDefaults({ scenario: e.target.value })}
                />
              )}
            </Field>
            <Field label="Connections">
              <Input
                type="number"
                min={1}
                value={cfg.defaults.conns}
                onChange={(e) => patchDefaults({ conns: Number(e.target.value) })}
              />
            </Field>
            <Field label="Duration" hint="Go duration, e.g. 30s">
              <Input
                value={cfg.defaults.duration}
                onChange={(e) => patchDefaults({ duration: e.target.value })}
                className="font-mono text-xs"
              />
            </Field>
            <Field label="Ramp" hint="e.g. 10s">
              <Input
                value={cfg.defaults.ramp}
                onChange={(e) => patchDefaults({ ramp: e.target.value })}
                className="font-mono text-xs"
              />
            </Field>
          </div>
        </section>

        {/* Bench + database */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Bench &amp; database</h2>
          <p className="max-w-prose text-xs text-muted-foreground">
            Used only by bench mode, which launches an uberserver checkout locally and resets the database before each
            run. Requires a checkout, a Python venv, and a reachable MySQL on this machine.
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Server dir" hint="uberserver checkout path">
              <Input
                value={cfg.bench.serverDir}
                onChange={(e) => patchBench({ serverDir: e.target.value })}
                placeholder="/Users/me/dev/uberserver"
                className="font-mono text-xs"
              />
            </Field>
            <Field label="Python" hint="defaults to <server-dir>/venv/bin/python3">
              <Input
                value={cfg.bench.serverPython}
                onChange={(e) => patchBench({ serverPython: e.target.value })}
                placeholder="(auto)"
                className="font-mono text-xs"
              />
            </Field>
            <Field label="Lobby port">
              <Input
                type="number"
                value={cfg.bench.port}
                onChange={(e) => patchBench({ port: Number(e.target.value) })}
              />
            </Field>
            <Field label="NAT port">
              <Input
                type="number"
                value={cfg.bench.natport}
                onChange={(e) => patchBench({ natport: Number(e.target.value) })}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Field label="DB driver">
              <Input value={cfg.bench.db.driver} onChange={(e) => patchDb({ driver: e.target.value })} />
            </Field>
            <Field label="DB host">
              <Input value={cfg.bench.db.host} onChange={(e) => patchDb({ host: e.target.value })} />
            </Field>
            <Field label="DB port">
              <Input
                type="number"
                value={cfg.bench.db.port}
                onChange={(e) => patchDb({ port: Number(e.target.value) })}
              />
            </Field>
            <Field label="DB name">
              <Input value={cfg.bench.db.name} onChange={(e) => patchDb({ name: e.target.value })} />
            </Field>
            <Field label="DB user">
              <Input value={cfg.bench.db.user} onChange={(e) => patchDb({ user: e.target.value })} />
            </Field>
            <Field label="DB password">
              <Input
                type="password"
                value={cfg.bench.db.password}
                onChange={(e) => patchDb({ password: e.target.value })}
              />
            </Field>
            <Field label="mysql binary">
              <Input
                value={cfg.bench.db.mysqlBin}
                onChange={(e) => patchDb({ mysqlBin: e.target.value })}
                className="font-mono text-xs"
              />
            </Field>
          </div>
          <CheckField
            label="Reset database before each bench run"
            hint="Drops and recreates the database. Required for register-storm; leave on for clean A/B runs."
            checked={cfg.bench.dbReset}
            onChange={(v) => patchBench({ dbReset: v })}
          />
        </section>
      </div>
    </div>
  );
}
