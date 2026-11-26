import { Trans, useLingui } from "@lingui/react/macro";
import { Button, Input } from "@picoframe/frame";
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { HelpPopover } from "@/components/HelpPopover";
import { OptionSelect } from "@/components/OptionSelect";
import { SettingList, SettingRow } from "@/components/SettingRow";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { usScenarios } from "../bindings";
import { useUberstressConfig } from "../config";

/**
 * The plugin's settings section, hosted in the frame settings page at
 * `/settings/uberstress`. Edits persist immediately via `useUberstressConfig`
 * (frame settings store, Tauri-backed), so there is no Save button. The frame
 * renders the section title and padding, so this is just the body.
 */
export default function UberstressSettings() {
  const { t } = useLingui();
  const [cfg, setCfg] = useUberstressConfig();
  const [scenarios, setScenarios] = useState<string[]>([]);

  useEffect(() => {
    let live = true;
    usScenarios(undefined)
      .then(({ scenarios }) => live && setScenarios(scenarios))
      .catch(() => {
        // Best effort. Without the list the scenario is typed as free text.
      });
    return () => {
      live = false;
    };
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
  const removeLabel = (s: { name: string; addr: string }) => {
    const name = s.name || s.addr || t`server`;
    return t`Remove ${name}`;
  };
  const removeServer = (id: string) =>
    setCfg({ ...cfg, servers: cfg.servers.filter((s) => s.id !== id) });

  // A saved scenario the binary no longer lists stays pickable, so the select
  // never shows blank.
  const scenarioOptions = (
    scenarios.includes(cfg.defaults.scenario) || !cfg.defaults.scenario
      ? scenarios
      : [cfg.defaults.scenario, ...scenarios]
  ).map((s) => ({ value: s, label: s }));

  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-1">
            <h2 className="text-sm font-semibold">
              <Trans>Lobby servers</Trans>
            </h2>
            <HelpPopover label={t`About lobby servers`}>
              <p>
                <Trans>
                  The Run page offers these as targets. A server needs an
                  address, such as 127.0.0.1:8200.
                </Trans>
              </p>
            </HelpPopover>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={addServer}>
            <Plus /> <Trans>Add server</Trans>
          </Button>
        </div>
        {cfg.servers.length === 0 ? (
          <p className="rounded-md border border-border px-4 py-3 text-sm text-muted-foreground">
            <Trans>No servers.</Trans>
          </p>
        ) : (
          <TooltipProvider>
            <ul className="divide-y divide-border rounded-md border border-border">
              {cfg.servers.map((s) => (
                <li key={s.id} className="flex items-center gap-2 px-4 py-2">
                  <Input
                    value={s.name}
                    onChange={(e) => updateServer(s.id, "name", e.target.value)}
                    placeholder={t`Name`}
                    aria-label={t`Name`}
                    className="min-w-0 flex-1"
                  />
                  <Input
                    value={s.addr}
                    onChange={(e) => updateServer(s.id, "addr", e.target.value)}
                    placeholder="127.0.0.1:8200"
                    aria-label={t`Address`}
                    className="min-w-0 flex-1 font-mono text-xs"
                  />
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeServer(s.id)}
                        aria-label={removeLabel(s)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <Trans>Remove</Trans>
                    </TooltipContent>
                  </Tooltip>
                </li>
              ))}
            </ul>
          </TooltipProvider>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-1">
          <h2 className="text-sm font-semibold">
            <Trans>Run defaults</Trans>
          </h2>
          <HelpPopover label={t`About run defaults`}>
            <p>
              <Trans>
                The Run page starts with these. You can still change them there
                for each run.
              </Trans>
            </p>
          </HelpPopover>
        </div>
        <SettingList>
          <SettingRow id="uberstress-scenario" label={t`Scenario`}>
            {scenarioOptions.length > 0 ? (
              <OptionSelect
                id="uberstress-scenario"
                value={cfg.defaults.scenario}
                onValueChange={(v) => patchDefaults({ scenario: v })}
                size="sm"
                className="w-56"
                options={scenarioOptions}
              />
            ) : (
              <Input
                id="uberstress-scenario"
                value={cfg.defaults.scenario}
                onChange={(e) => patchDefaults({ scenario: e.target.value })}
                className="w-56"
              />
            )}
          </SettingRow>
          <SettingRow id="uberstress-conns" label={t`Connections`}>
            <NumberInput
              id="uberstress-conns"
              value={cfg.defaults.conns}
              min={1}
              onCommit={(conns) => patchDefaults({ conns })}
            />
          </SettingRow>
          <SettingRow
            id="uberstress-duration"
            label={t`Duration`}
            helpLabel={t`About the duration`}
            help={
              <p>
                <Trans>
                  How long the run lasts. A number and a unit, such as 30s, 2m
                  or 1m30s.
                </Trans>
              </p>
            }
          >
            <Input
              id="uberstress-duration"
              value={cfg.defaults.duration}
              onChange={(e) => patchDefaults({ duration: e.target.value })}
              className="w-24 font-mono text-xs"
            />
          </SettingRow>
          <SettingRow
            id="uberstress-ramp"
            label={t`Ramp`}
            helpLabel={t`About the ramp`}
            help={
              <p>
                <Trans>
                  How long it takes to open every connection, such as 10s.
                </Trans>
              </p>
            }
          >
            <Input
              id="uberstress-ramp"
              value={cfg.defaults.ramp}
              onChange={(e) => patchDefaults({ ramp: e.target.value })}
              className="w-24 font-mono text-xs"
            />
          </SettingRow>
        </SettingList>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-1">
          <h2 className="text-sm font-semibold">
            <Trans>Bench</Trans>
          </h2>
          <HelpPopover label={t`About bench mode`}>
            <p>
              <Trans>
                Only bench mode uses these. It starts an uberserver checkout on
                this machine and can reset its database before each run. It
                needs the checkout, a Python virtual environment and a MySQL
                server you can reach.
              </Trans>
            </p>
          </HelpPopover>
        </div>
        <SettingList>
          <SettingRow id="uberstress-server-dir" label={t`uberserver folder`}>
            <Input
              id="uberstress-server-dir"
              value={cfg.bench.serverDir}
              onChange={(e) => patchBench({ serverDir: e.target.value })}
              placeholder="/Users/me/dev/uberserver"
              className="w-80 font-mono text-xs"
            />
          </SettingRow>
          <SettingRow
            id="uberstress-python"
            label={t`Python`}
            helpLabel={t`About the Python path`}
            help={
              <p>
                <Trans>
                  Leave this empty to use venv/bin/python3 in the uberserver
                  folder.
                </Trans>
              </p>
            }
          >
            <Input
              id="uberstress-python"
              value={cfg.bench.serverPython}
              onChange={(e) => patchBench({ serverPython: e.target.value })}
              placeholder={t`Automatic`}
              className="w-80 font-mono text-xs"
            />
          </SettingRow>
          <SettingRow id="uberstress-port" label={t`Lobby port`}>
            <NumberInput
              id="uberstress-port"
              value={cfg.bench.port}
              min={1}
              max={65535}
              onCommit={(port) => patchBench({ port })}
            />
          </SettingRow>
          <SettingRow id="uberstress-natport" label={t`NAT port`}>
            <NumberInput
              id="uberstress-natport"
              value={cfg.bench.natport}
              min={1}
              max={65535}
              onCommit={(natport) => patchBench({ natport })}
            />
          </SettingRow>
        </SettingList>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">
          <Trans>Database</Trans>
        </h2>
        <SettingList>
          <SettingRow id="uberstress-db-driver" label={t`Driver`}>
            <Input
              id="uberstress-db-driver"
              value={cfg.bench.db.driver}
              onChange={(e) => patchDb({ driver: e.target.value })}
              className="w-56 font-mono text-xs"
            />
          </SettingRow>
          <SettingRow id="uberstress-db-host" label={t`Host`}>
            <Input
              id="uberstress-db-host"
              value={cfg.bench.db.host}
              onChange={(e) => patchDb({ host: e.target.value })}
              className="w-56 font-mono text-xs"
            />
          </SettingRow>
          <SettingRow id="uberstress-db-port" label={t`Port`}>
            <NumberInput
              id="uberstress-db-port"
              value={cfg.bench.db.port}
              min={1}
              max={65535}
              onCommit={(port) => patchDb({ port })}
            />
          </SettingRow>
          <SettingRow id="uberstress-db-name" label={t`Database name`}>
            <Input
              id="uberstress-db-name"
              value={cfg.bench.db.name}
              onChange={(e) => patchDb({ name: e.target.value })}
              className="w-56 font-mono text-xs"
            />
          </SettingRow>
          <SettingRow id="uberstress-db-user" label={t`User`}>
            <Input
              id="uberstress-db-user"
              value={cfg.bench.db.user}
              onChange={(e) => patchDb({ user: e.target.value })}
              className="w-56 font-mono text-xs"
            />
          </SettingRow>
          <SettingRow id="uberstress-db-password" label={t`Password`}>
            <Input
              id="uberstress-db-password"
              type="password"
              value={cfg.bench.db.password}
              onChange={(e) => patchDb({ password: e.target.value })}
              className="w-56"
            />
          </SettingRow>
          <SettingRow id="uberstress-mysql" label={t`mysql program`}>
            <Input
              id="uberstress-mysql"
              value={cfg.bench.db.mysqlBin}
              onChange={(e) => patchDb({ mysqlBin: e.target.value })}
              className="w-56 font-mono text-xs"
            />
          </SettingRow>
          <SettingRow
            id="uberstress-db-reset"
            label={t`Reset the database before each run`}
            helpLabel={t`About resetting the database`}
            help={
              <p>
                <Trans>
                  Drops and recreates the database. The register-storm scenario
                  needs this, and it keeps A/B runs comparable.
                </Trans>
              </p>
            }
          >
            <Switch
              id="uberstress-db-reset"
              checked={cfg.bench.dbReset}
              onCheckedChange={(v) => patchBench({ dbReset: v === true })}
            />
          </SettingRow>
        </SettingList>
      </section>
    </div>
  );
}

/**
 * A whole-number input that saves only on blur or Enter, and only a number in
 * range. Clearing the field to retype it keeps the saved value instead of
 * saving 0.
 */
function NumberInput({
  id,
  value,
  min,
  max,
  onCommit,
}: {
  id: string;
  value: number;
  min: number;
  max?: number;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  const commit = () => {
    if (draft === null) return;
    setDraft(null);
    const typed = draft.trim() === "" ? Number.NaN : Number(draft);
    if (!Number.isInteger(typed)) return;
    const clamped = Math.min(Math.max(typed, min), max ?? typed);
    if (clamped !== value) onCommit(clamped);
  };

  return (
    <Input
      id={id}
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      step={1}
      value={draft ?? String(value)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
      }}
      className="w-24"
    />
  );
}
