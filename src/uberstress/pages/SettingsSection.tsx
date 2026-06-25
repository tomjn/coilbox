import { Button, Input } from "@picoframe/frame";
import { Plus, Server, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { usScenarios } from "../bindings";
import { useUberstressConfig } from "../config";
import { CheckField, Field } from "./components/Field";
import { OptionSelect } from "./components/OptionSelect";

/**
 * The plugin's settings section, hosted in the frame settings page at
 * `/settings/uberstress`. Edits persist immediately via `useUberstressConfig`
 * (frame settings store, Tauri-backed) — no Save button. The frame renders the
 * section title + padding, so this is just the form body.
 */
export default function UberstressSettings() {
  const [cfg, setCfg] = useUberstressConfig();
  const [scenarios, setScenarios] = useState<string[]>([]);

  useEffect(() => {
    usScenarios(undefined)
      .then(({ scenarios }) => setScenarios(scenarios))
      .catch(() => {
        // best-effort; the scenario field falls back to free text
      });
  }, []);

  const patchDefaults = (p: Partial<typeof cfg.defaults>) =>
    setCfg({ ...cfg, defaults: { ...cfg.defaults, ...p } });
  const patchBench = (p: Partial<typeof cfg.bench>) =>
    setCfg({ ...cfg, bench: { ...cfg.bench, ...p } });
  const patchDb = (p: Partial<typeof cfg.bench.db>) =>
    setCfg({ ...cfg, bench: { ...cfg.bench, db: { ...cfg.bench.db, ...p } } });

  const addServer = () =>
    setCfg({
      ...cfg,
      servers: [
        ...cfg.servers,
        { id: crypto.randomUUID(), name: "", addr: "" },
      ],
    });
  const updateServer = (id: string, key: "name" | "addr", value: string) =>
    setCfg({
      ...cfg,
      servers: cfg.servers.map((s) =>
        s.id === id ? { ...s, [key]: value } : s,
      ),
    });
  const removeServer = (id: string) =>
    setCfg({ ...cfg, servers: cfg.servers.filter((s) => s.id !== id) });

  return (
    <div className="space-y-8">
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
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Run defaults
        </h2>
        <div className="grid grid-cols-2 gap-4">
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
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Bench &amp; database
        </h2>
        <p className="text-xs text-muted-foreground">
          Used only by bench mode, which launches an uberserver checkout locally
          and resets the database before each run. Requires a checkout, a Python
          venv, and a reachable MySQL on this machine.
        </p>
        <div className="grid grid-cols-2 gap-4">
          <Field
            label="Server dir"
            hint="uberserver checkout path"
            className="col-span-2"
          >
            <Input
              value={cfg.bench.serverDir}
              onChange={(e) => patchBench({ serverDir: e.target.value })}
              placeholder="/Users/me/dev/uberserver"
              className="font-mono text-xs"
            />
          </Field>
          <Field
            label="Python"
            hint="defaults to <server-dir>/venv/bin/python3"
            className="col-span-2"
          >
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
          <Field label="DB driver">
            <Input
              value={cfg.bench.db.driver}
              onChange={(e) => patchDb({ driver: e.target.value })}
            />
          </Field>
          <Field label="DB name">
            <Input
              value={cfg.bench.db.name}
              onChange={(e) => patchDb({ name: e.target.value })}
            />
          </Field>
          <Field label="DB host">
            <Input
              value={cfg.bench.db.host}
              onChange={(e) => patchDb({ host: e.target.value })}
            />
          </Field>
          <Field label="DB port">
            <Input
              type="number"
              value={cfg.bench.db.port}
              onChange={(e) => patchDb({ port: Number(e.target.value) })}
            />
          </Field>
          <Field label="DB user">
            <Input
              value={cfg.bench.db.user}
              onChange={(e) => patchDb({ user: e.target.value })}
            />
          </Field>
          <Field label="DB password">
            <Input
              type="password"
              value={cfg.bench.db.password}
              onChange={(e) => patchDb({ password: e.target.value })}
            />
          </Field>
          <Field label="mysql binary" className="col-span-2">
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
  );
}
