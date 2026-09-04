import { Button, Input } from "@picoframe/frame";
import { type FormEvent, useState } from "react";
import { Field } from "@/components/Field";
import { OptionSelect } from "@/components/OptionSelect";
import { useMultiplayer } from "../multiplayer/store";
import { lsStoreCredential } from "./bindings";
import { type LobbyServer, serverProtocol, useLobbyAccounts } from "./config";

/**
 * Create a new account on a lobby server. Drives the backend `register` handshake,
 * then on success stores the password in the keychain and adds a `LobbyAccount`
 * (so the new login appears in the connect list). Shared by the topbar login panel
 * and the lobby-servers settings, so the persist-on-success logic lives once.
 *
 * Note: registering does not log in. Servers with email verification issue the
 * code on the subsequent login, which pops the verification-code dialog.
 */
export function RegisterForm({
  servers,
  defaultServerId,
  onSuccess,
  onCancel,
}: {
  servers: LobbyServer[];
  defaultServerId?: string;
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const { register, busy } = useMultiplayer();
  const [accountsCfg, setAccountsCfg] = useLobbyAccounts();
  // A Tachyon server has no account for Coilbox to create, because signing in
  // there happens on the server's own page in the browser, so those servers are
  // not offered here. TASServer and Zero-K both take a name, a password and an
  // email, which is why one form covers them.
  const registrable = servers.filter((s) => serverProtocol(s) !== "tachyon");
  const [serverId, setServerId] = useState(
    defaultServerId ?? registrable[0]?.id ?? "",
  );
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const selected = registrable.find((s) => s.id === serverId);
  const trimmedUser = username.trim();
  const canSubmit =
    serverId !== "" &&
    trimmedUser !== "" &&
    password !== "" &&
    !submitting &&
    !busy;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const server = selected;
    if (!server) {
      setError("Select a server.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await register(server, trimmedUser, password, email.trim() || undefined);
      await lsStoreCredential({
        serverId: server.id,
        username: trimmedUser,
        secret: password,
      });
      const exists = accountsCfg.accounts.some(
        (a) => a.serverId === server.id && a.username === trimmedUser,
      );
      if (!exists) {
        setAccountsCfg({
          accounts: [
            ...accountsCfg.accounts,
            {
              id: crypto.randomUUID(),
              serverId: server.id,
              username: trimmedUser,
              // The registration flow just stored the password above.
              hasSecret: true,
            },
          ],
        });
      }
      onSuccess();
    } catch (err) {
      setError(String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <Field label="Server">
        <OptionSelect
          value={serverId}
          onValueChange={setServerId}
          options={registrable.map((s) => ({
            value: s.id,
            label: s.builtin ? s.name : `${s.name || s.host} (custom)`,
          }))}
          placeholder="Select a server"
        />
      </Field>
      <Field label="Username">
        <Input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="off"
        />
      </Field>
      <Field label="Password">
        <Input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
        />
      </Field>
      <Field
        label="Email"
        hint={
          selected && serverProtocol(selected) === "zerok"
            ? "Optional. Zero-K keeps it against your account and does not send a code."
            : "Some servers email a verification code to confirm your account."
        }
      >
        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="off"
        />
      </Field>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onCancel}
          disabled={submitting}
        >
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={!canSubmit}>
          {submitting ? "Registering…" : "Register"}
        </Button>
      </div>
    </form>
  );
}
