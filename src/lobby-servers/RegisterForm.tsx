import { Trans, useLingui } from "@lingui/react/macro";
import { Button, Input } from "@picoframe/frame";
import { type FormEvent, useEffect, useState } from "react";
import { Field } from "@/components/Field";
import { OptionSelect } from "@/components/OptionSelect";
import { describeError } from "@/i18n/uiError";
import { identifierFieldProps } from "@/lib/identifierField";
import { serverKeyFor, useMultiplayer } from "../multiplayer/store";
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
  continueGuard,
}: {
  servers: LobbyServer[];
  defaultServerId?: string;
  onSuccess: () => void;
  onCancel: () => void;
  /**
   * Set by the form for a Continue button outside it. It returns `true` with
   * nothing typed. Otherwise it asks for Register and returns `false`, because
   * creating an account is something the player presses for.
   */
  continueGuard?: { current: (() => boolean | undefined) | null };
}) {
  const { t } = useLingui();
  const { register, busyKeys } = useMultiplayer();
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
  // Scoped to the account this form would register, not the store-wide
  // `busy`, so registering on one server does not grey out another's
  // controls (issue #2846).
  const isBusy =
    selected != null && busyKeys.has(serverKeyFor(selected, trimmedUser));
  const canSubmit =
    serverId !== "" &&
    trimmedUser !== "" &&
    password !== "" &&
    !submitting &&
    !isBusy;

  useEffect(() => {
    if (!continueGuard) return;
    continueGuard.current = () => {
      if (username.trim() === "" && password === "" && email.trim() === "")
        return true;
      setError(t`Press Register to create the account.`);
      return false;
    };
    return () => {
      continueGuard.current = null;
    };
  });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const server = selected;
    if (!server) {
      setError(t`Select a server.`);
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
      setError(describeError(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <Field label={t`Server`}>
        <OptionSelect
          value={serverId}
          onValueChange={setServerId}
          options={registrable.map((s) => {
            const name = s.name || s.host;
            return {
              value: s.id,
              label: s.builtin ? s.name : t`${name} (custom)`,
            };
          })}
          placeholder={t`Select a server`}
        />
      </Field>
      <Field label={t`Username`}>
        <Input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="off"
          {...identifierFieldProps}
        />
      </Field>
      <Field label={t`Password`}>
        <Input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          {...identifierFieldProps}
        />
      </Field>
      <Field
        label={t`Email`}
        hint={
          selected && serverProtocol(selected) === "zerok"
            ? t`Optional. Zero-K keeps it against your account and does not send a code.`
            : t`Some servers email a verification code to confirm your account.`
        }
      >
        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="off"
          {...identifierFieldProps}
        />
      </Field>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onCancel}
          disabled={submitting}
        >
          <Trans>Cancel</Trans>
        </Button>
        <Button type="submit" size="sm" disabled={!canSubmit}>
          {submitting ? t`Registering…` : t`Register`}
        </Button>
      </div>
    </form>
  );
}
