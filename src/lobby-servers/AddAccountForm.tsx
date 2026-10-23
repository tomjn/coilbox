import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { Button, Input } from "@picoframe/frame";
import { Plus } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Field } from "@/components/Field";
import { OptionSelect } from "@/components/OptionSelect";
import { describeError } from "@/i18n/uiError";
import { identifierFieldProps } from "@/lib/identifierField";
import { lsDeleteCredential, lsStoreCredential } from "./bindings";
import { type LobbyAccount, type LobbyServer, serverProtocol } from "./config";

/** The two halves of a keychain key. */
export type LoginIdentity = Pick<LobbyAccount, "serverId" | "username">;

/** Whether another saved login already uses this server and username. */
export function loginTaken(
  accounts: LobbyAccount[],
  identity: LoginIdentity,
  exceptId?: string,
) {
  return accounts.some(
    (a) =>
      a.id !== exceptId &&
      a.serverId === identity.serverId &&
      a.username === identity.username,
  );
}

/** The labels a server picker shows, built-ins by name and the player's own marked. */
export function serverOptions(servers: LobbyServer[]) {
  return servers.map((s) => {
    const name = s.name || s.host;
    const base = s.builtin ? s.name : t`${name} (custom)`;
    return { value: s.id, label: s.alpha ? t`${base} (alpha)` : base };
  });
}

/** The foot of an add drawer: Cancel, and the button that saves the draft. */
export function AddFooter({
  label,
  disabled,
  onCancel,
}: {
  label: string;
  disabled: boolean;
  onCancel: () => void;
}) {
  return (
    <footer className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
      <Button type="button" variant="outline" size="sm" onClick={onCancel}>
        <Trans>Cancel</Trans>
      </Button>
      <Button type="submit" size="sm" disabled={disabled}>
        <Plus /> {label}
      </Button>
    </footer>
  );
}

/** Whether the component that called this is still mounted. */
function useMounted() {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return mounted;
}

/**
 * The add-login drawer's body. Everything here is a draft. The login is written
 * to settings, and its password to the keychain, only when the player presses
 * Add, after which the drawer switches to editing the saved login. Auto-join
 * channels are keyed by the saved login, so they are offered from that point.
 */
export function AddAccountForm({
  draft,
  accounts,
  servers,
  onAdd,
  onCancel,
  continueGuard,
}: {
  draft: LobbyAccount;
  accounts: LobbyAccount[];
  servers: LobbyServer[];
  onAdd: (a: LobbyAccount) => void;
  onCancel: () => void;
  /**
   * Set by the form for a Continue button outside it. With nothing typed it
   * returns `true`. Otherwise it starts the same save as Add, or shows why it
   * cannot, and returns `false`, so only `onAdd` moves things on.
   */
  continueGuard?: { current: (() => boolean | undefined) | null };
}) {
  const [serverId, setServerId] = useState(draft.serverId);
  const [username, setUsername] = useState(draft.username);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useMounted();

  const server = servers.find((s) => s.id === serverId);
  const tachyon = serverProtocol(server ?? {}) === "tachyon";
  const identity = { serverId, username: username.trim() };
  const taken = identity.username !== "" && loginTaken(accounts, identity);
  const ready = server != null && identity.username !== "" && !taken;

  const save = async () => {
    if (!ready || busy) return;
    const secret = tachyon ? "" : password;
    setBusy(true);
    setError(null);
    if (secret !== "") {
      try {
        await lsStoreCredential({ ...identity, secret });
      } catch (err) {
        if (mounted.current) {
          setBusy(false);
          setError(
            `Coilbox could not save the password to your keychain, so the login was not added. ${describeError(err)}`,
          );
        }
        return;
      }
      // Closed while the keychain was busy, which is a cancel.
      if (!mounted.current) {
        lsDeleteCredential(identity).catch(() => {});
        return;
      }
    }
    onAdd({ ...draft, ...identity, hasSecret: secret !== "" });
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void save();
  };

  // Rebuilt every render so it reads the current draft.
  useEffect(() => {
    if (!continueGuard) return;
    continueGuard.current = () => {
      const typed = identity.username !== "" || (!tachyon && password !== "");
      if (!typed) return true;
      if (server == null) setError(t`Select a server.`);
      else if (identity.username === "") setError(t`Enter a username.`);
      else void save();
      return false;
    };
    return () => {
      continueGuard.current = null;
    };
  });

  return (
    <form className="flex min-h-0 flex-1 flex-col" onSubmit={submit}>
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        <p className="text-xs leading-snug text-muted-foreground">
          Nothing is saved until you add the login.
          {!tachyon &&
            " You can choose channels to join automatically once it is added."}
        </p>
        <Field label="Server">
          <OptionSelect
            value={serverId}
            onValueChange={setServerId}
            options={serverOptions(servers)}
            placeholder="Select a server"
          />
        </Field>
        <Field
          label="Username"
          hint={taken ? "You already have this login." : undefined}
        >
          <Input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            {...identifierFieldProps}
          />
        </Field>
        {tachyon ? (
          <p className="text-xs leading-snug text-muted-foreground">
            This server has no password. Add the login, then sign in with your
            browser.
          </p>
        ) : (
          <Field
            label="Password"
            hint="Saved in your keychain when you add the login."
          >
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              {...identifierFieldProps}
            />
          </Field>
        )}
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
      <AddFooter
        label="Add login"
        disabled={!ready || busy}
        onCancel={onCancel}
      />
    </form>
  );
}
