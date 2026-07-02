import { Button, Input } from "@picoframe/frame";
import { Plus, Server, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import {
  lsDeleteCredential,
  lsGetCredential,
  lsStoreCredential,
} from "../bindings";
import { type LobbyServer, useLobbyServers } from "../config";
import { CheckField, Field } from "./components/Field";

/**
 * The lobby-servers settings section, hosted at `/settings/lobby-servers`. Owns the
 * shared lobby server directory (name/host/port/tls/allowSelfSigned/username), which
 * persists immediately via `useLobbyServers` (frame settings store, no Save button).
 *
 * Passwords are never written to settings: each row keeps its secret in local React
 * state and pushes it to the OS keychain (`ls_*_credential`) on blur, reading back a
 * "saved"/"not set" hint on mount. Removing a server also deletes its secret.
 */
export default function LobbyServersSettings() {
  const [cfg, setCfg] = useLobbyServers();

  const addServer = () =>
    setCfg({
      ...cfg,
      servers: [
        ...cfg.servers,
        {
          id: crypto.randomUUID(),
          name: "",
          host: "",
          port: 8200,
          tls: false,
          allowSelfSigned: false,
        },
      ],
    });

  const updateServer = (id: string, patch: Partial<LobbyServer>) =>
    setCfg({
      ...cfg,
      servers: cfg.servers.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    });

  const removeServer = (s: LobbyServer) => {
    setCfg({ ...cfg, servers: cfg.servers.filter((x) => x.id !== s.id) });
    lsDeleteCredential({ serverId: s.id, username: s.username ?? "" }).catch(
      () => {
        // best-effort cleanup; a leftover keychain entry is harmless
      },
    );
  };

  return (
    <div className="space-y-8">
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
            No servers yet. Add one to connect to a lobby.
          </p>
        ) : (
          <ul className="space-y-4">
            {cfg.servers.map((s) => (
              <ServerRow
                key={s.id}
                server={s}
                onChange={(patch) => updateServer(s.id, patch)}
                onRemove={() => removeServer(s)}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/**
 * One editable server row. Directory fields persist through the parent's `onChange`;
 * the password lives only in local state and is synced to the keychain on blur.
 */
function ServerRow({
  server: s,
  onChange,
  onRemove,
}: {
  server: LobbyServer;
  onChange: (patch: Partial<LobbyServer>) => void;
  onRemove: () => void;
}) {
  const [password, setPassword] = useState("");
  const [saved, setSaved] = useState<boolean | null>(null);

  // On mount, reflect whether a secret already exists (never show the plaintext).
  useEffect(() => {
    lsGetCredential({ serverId: s.id, username: s.username ?? "" })
      .then(({ secret }) => setSaved(secret != null))
      .catch(() => setSaved(null));
  }, [s.id, s.username]);

  const savePassword = () => {
    if (password === "") return;
    lsStoreCredential({
      serverId: s.id,
      username: s.username ?? "",
      secret: password,
    })
      .then(() => setSaved(true))
      .catch(() => setSaved(false));
  };

  return (
    <li className="space-y-3 rounded-md border border-border p-3">
      <div className="flex items-end gap-2">
        <Field label="Name" className="flex-1">
          <Input
            value={s.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder="Official server"
          />
        </Field>
        <Button
          variant="outline"
          size="sm"
          onClick={onRemove}
          aria-label={`Remove ${s.name || s.host || "server"}`}
        >
          <Trash2 />
        </Button>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Field label="Host" className="col-span-2">
          <Input
            value={s.host}
            onChange={(e) => onChange({ host: e.target.value })}
            placeholder="lobby.example.org"
            className="font-mono text-xs"
          />
        </Field>
        <Field label="Port">
          <Input
            type="number"
            value={s.port}
            onChange={(e) => onChange({ port: Number(e.target.value) })}
          />
        </Field>
        <Field label="Username">
          <Input
            value={s.username ?? ""}
            onChange={(e) => onChange({ username: e.target.value })}
          />
        </Field>
        <Field
          label="Password"
          hint={
            saved === null ? undefined : saved ? "Saved in keychain" : "Not set"
          }
          className="col-span-2"
        >
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onBlur={savePassword}
            placeholder={saved ? "•••••••• (saved)" : ""}
          />
        </Field>
      </div>
      <div className="flex flex-col gap-2">
        <CheckField
          label="Use TLS"
          checked={s.tls}
          onChange={(v) => onChange({ tls: v })}
        />
        <CheckField
          label="Allow self-signed certificate"
          hint="uberserver ships one; teiserver does not."
          checked={s.allowSelfSigned}
          onChange={(v) => onChange({ allowSelfSigned: v })}
        />
      </div>
    </li>
  );
}
