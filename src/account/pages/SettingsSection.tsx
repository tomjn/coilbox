import { Trans, useLingui } from "@lingui/react/macro";
import { Button, Input } from "@picoframe/frame";
import { Loader2, MailCheck } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { Field } from "@/components/Field";
import { SettingList, SettingRow } from "@/components/SettingRow";
import { SlideDrawer } from "@/components/SlideDrawer";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { describeError } from "@/i18n/uiError";
import { identifierFieldProps } from "@/lib/identifierField";
import { lsStoreCredential } from "../../lobby-servers/bindings";
import {
  type LobbyAccount,
  type LobbyServer,
  useLastLogin,
  useLobbyAccounts,
} from "../../lobby-servers/config";
import { serverForKey } from "../../lobby-servers/sameServer";
import { AccountPicker } from "../../multiplayer/AccountPicker";
import { protocolForKey } from "../../multiplayer/protocol";
import {
  liveConnectionKeys,
  useConnection,
  useMultiplayer,
  useProtocolServers,
  usernameFromKey,
} from "../../multiplayer/store";

/**
 * Account management for the signed-in lobby account (`/settings/account`).
 * Separate from `/settings/lobby-servers`, which owns the local list of
 * servers and logins and whose edits are instant and offline: everything here
 * goes to the server and can fail there, which is why the page has three
 * states rather than one form.
 *
 * With more than one connection live, a picker chooses which account every
 * action below runs against (issue #2846). With one, the page acts on it
 * without asking, exactly as it did before a second connection was possible.
 */
export default function AccountSettings() {
  const { connections, activeKey, getUserInfo } = useMultiplayer();
  const servers = useProtocolServers();

  const liveKeys = liveConnectionKeys(connections, activeKey);
  const [manualPick, setManualPick] = useState<string | null>(null);
  const pickedKey =
    manualPick && liveKeys.includes(manualPick)
      ? manualPick
      : (liveKeys[0] ?? null);

  const picked = useConnection(pickedKey);
  const protocol = protocolForKey(pickedKey, servers);

  // Requested once per session, not on every render: `pickedKey`/`protocol`
  // only change on connect/disconnect or a picker change, and `getUserInfo`
  // is a stable callback.
  useEffect(() => {
    if (pickedKey && protocol === "tasserver") getUserInfo(pickedKey);
  }, [pickedKey, protocol, getUserInfo]);

  if (!pickedKey) return <DisconnectedPanel />;
  if (protocol !== "tasserver") return <OtherProtocolPanel />;

  return (
    <div className="space-y-6 pb-8">
      {liveKeys.length > 1 && (
        <AccountPicker
          keys={liveKeys}
          value={pickedKey}
          onChange={setManualPick}
        />
      )}
      {/* Keyed so a resend result or an open drawer does not carry over
          to another account picked above. */}
      <AccountDetails
        key={pickedKey}
        serverKey={pickedKey}
        username={picked?.mirror.state?.myUsername ?? null}
        registrationDate={picked?.accountInfo?.registrationDate ?? null}
        email={picked?.accountInfo?.email ?? null}
        ingameHours={picked?.accountInfo?.ingameHours ?? null}
      />
    </div>
  );
}

/** Not signed in: name the account that would be managed, if any, and offer to connect. */
function DisconnectedPanel() {
  const { openLoginPopover } = useMultiplayer();
  const [lastLogin] = useLastLogin();
  const lastUsername = lastLogin?.username ?? "";

  return (
    <div className="space-y-3 rounded-md border border-dashed border-border p-4 text-sm">
      <p className="text-muted-foreground">
        {lastLogin ? (
          <Trans>
            Not signed in. Connect as {lastUsername} to manage that account.
          </Trans>
        ) : (
          <Trans>
            Not signed in. Connect to a lobby account to manage it here.
          </Trans>
        )}
      </p>
      <Button onClick={openLoginPopover}>
        <Trans>Connect</Trans>
      </Button>
    </div>
  );
}

/** Connected to Zero-K or Tachyon: neither protocol has any of these commands. */
function OtherProtocolPanel() {
  return (
    <p className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
      <Trans>
        Account management for this server happens on the server's own site.
      </Trans>
    </p>
  );
}

/**
 * The account's details and the changes the server accepts, as one list. The
 * email and password rows carry their own Change buttons, so each action sits
 * beside the thing it changes.
 */
function AccountDetails({
  serverKey,
  username,
  registrationDate,
  email,
  ingameHours,
}: {
  serverKey: string;
  username: string | null;
  registrationDate: string | null;
  email: string | null;
  ingameHours: string | null;
}) {
  const { t } = useLingui();
  const { resendVerification } = useMultiplayer();
  const [drawer, setDrawer] = useState<"password" | "email" | null>(null);
  const [resendSent, setResendSent] = useState(false);
  const [resendError, setResendError] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  const NOT_KNOWN = t`Not known yet`;

  const doResend = async () => {
    if (!email) return;
    setResending(true);
    setResendSent(false);
    setResendError(null);
    try {
      await resendVerification(email, serverKey);
      setResendSent(true);
    } catch (err) {
      setResendError(describeError(err));
    } finally {
      setResending(false);
    }
  };

  const value = (text: string | null) => (
    <span className="select-text text-sm">{text ?? NOT_KNOWN}</span>
  );

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold">
        <Trans>Account</Trans>
      </h2>
      <SettingList>
        <SettingRow label={t`Username`}>{value(username)}</SettingRow>
        <SettingRow label={t`Member since`}>
          {value(registrationDate)}
        </SettingRow>
        <SettingRow label={t`Playtime`}>{value(ingameHours)}</SettingRow>
        <SettingRow
          label={t`Email address`}
          description={email ?? NOT_KNOWN}
          error={resendError}
        >
          <div className="flex items-center gap-1">
            {resendSent && (
              <span
                role="status"
                className="mr-1 text-xs text-muted-foreground"
              >
                <Trans>Verification email sent.</Trans>
              </span>
            )}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={email == null || resending}
                    onClick={() => void doResend()}
                    aria-label={t`Resend verification email`}
                  >
                    {resending ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <MailCheck className="size-4" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <Trans>Resend verification email</Trans>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDrawer("email")}
              aria-label={t`Change email`}
            >
              <Trans>Change</Trans>
            </Button>
          </div>
        </SettingRow>
        <SettingRow label={t`Password`}>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setDrawer("password")}
            aria-label={t`Change password`}
          >
            <Trans>Change</Trans>
          </Button>
        </SettingRow>
      </SettingList>
      <ChangePasswordDrawer
        open={drawer === "password"}
        serverKey={serverKey}
        onClose={() => setDrawer(null)}
      />
      <ChangeEmailDrawer
        open={drawer === "email"}
        email={email}
        serverKey={serverKey}
        onClose={() => setDrawer(null)}
      />
    </section>
  );
}

/**
 * The saved login the given connection's own key names, or undefined when it
 * doesn't match one (e.g. a login typed and connected but never saved). Used
 * to find which keychain entry a successful password change should update -
 * derived from the connection being edited rather than from `lastLogin`
 * (issue #2846: with two connections open, `lastLogin` names whichever
 * connected most recently, not necessarily the one this form is for).
 */
function accountForKey(
  serverKey: string,
  servers: LobbyServer[],
  accounts: LobbyAccount[],
): LobbyAccount | undefined {
  const server = serverForKey(serverKey, servers);
  if (!server) return undefined;
  const username = usernameFromKey(serverKey);
  return accounts.find(
    (a) => a.serverId === server.id && a.username === username,
  );
}

/**
 * Current + new password, submitted to `changePassword`. `CHANGEPASSWORD` has no
 * accept/deny reply of its own, only a bare `SERVERMSG`, so whatever the server
 * says is shown verbatim rather than interpreted. The saved keychain entry is
 * only touched when `succeeded` is true and the drawer can tell which saved
 * login this connection is (`accountForKey`, matched against `serverKey`). A
 * stale saved password is fixed by retyping it, but one overwritten on a
 * change that did not happen locks the user out of their own saved login. A
 * change that succeeded but whose keychain write then fails is a third case:
 * the server-side password is now correct and the saved one is wrong, so
 * that failure is surfaced rather than swallowed (see `submit`).
 */
function ChangePasswordDrawer({
  open,
  serverKey,
  onClose,
}: {
  open: boolean;
  serverKey: string;
  onClose: () => void;
}) {
  const { t } = useLingui();
  return (
    <SlideDrawer open={open} title={t`Change password`} onClose={onClose}>
      <ChangePasswordForm serverKey={serverKey} onClose={onClose} />
    </SlideDrawer>
  );
}

/**
 * Split from {@link ChangePasswordDrawer} so the form only mounts while the
 * drawer is open: `SlideDrawer` renders `children` only when `open`, so this
 * component (and its state) unmounts on close and remounts fresh on every
 * reopen, rather than a typed-in password or an old result outliving the
 * close that should have cleared it.
 */
function ChangePasswordForm({
  serverKey,
  onClose,
}: {
  serverKey: string;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const { changePassword } = useMultiplayer();
  const servers = useProtocolServers();
  const [accountsCfg] = useLobbyAccounts();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [succeeded, setSucceeded] = useState<boolean | null>(null);
  const [keychainWarning, setKeychainWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setKeychainWarning(null);
    try {
      const result = await changePassword(current, next, serverKey);
      setMessage(result.message);
      setSucceeded(result.succeeded);
      const account = result.succeeded
        ? accountForKey(serverKey, servers, accountsCfg.accounts)
        : undefined;
      if (account) {
        try {
          await lsStoreCredential({
            serverId: account.serverId,
            username: account.username,
            secret: next,
          });
        } catch {
          // The password really did change on the server, so this must not
          // read as a failed change (it would send the user to retry a
          // change that already happened). It does need surfacing though:
          // the saved copy is now wrong rather than merely stale, and the
          // next reconnect will fail with it until the user retypes it.
          setKeychainWarning(
            t`Your password changed on the server, but coilbox could not save it. Enter the new one under Settings, Lobby servers.`,
          );
        }
      }
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      className="flex flex-1 flex-col gap-3 overflow-y-auto p-4"
    >
      <Field label={t`Current password`}>
        <Input
          type="password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          autoComplete="current-password"
          {...identifierFieldProps}
        />
      </Field>
      <Field label={t`New password`}>
        <Input
          type="password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          autoComplete="new-password"
          {...identifierFieldProps}
        />
      </Field>
      {message && (
        <p className="text-xs text-muted-foreground">
          {message}
          {succeeded === false && (
            <>
              {" "}
              <Trans>Your saved password has been left as it was.</Trans>
            </>
          )}
        </p>
      )}
      {keychainWarning && (
        <p className="text-xs text-destructive">{keychainWarning}</p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="mt-auto flex justify-end gap-2 border-t border-border pt-3">
        <Button type="button" variant="outline" size="sm" onClick={onClose}>
          <Trans>Close</Trans>
        </Button>
        <Button
          type="submit"
          size="sm"
          disabled={submitting || current === "" || next === ""}
        >
          {submitting ? t`Saving…` : t`Save`}
        </Button>
      </div>
    </form>
  );
}

/**
 * Email address, submitted to `changeEmailRequest`, then a code from that email
 * submitted to `changeEmail`. Same two-stage shape as `PasswordRecoveryForm`.
 */
function ChangeEmailDrawer({
  open,
  email,
  serverKey,
  onClose,
}: {
  open: boolean;
  email: string | null;
  serverKey: string;
  onClose: () => void;
}) {
  const { t } = useLingui();
  return (
    <SlideDrawer open={open} title={t`Change email`} onClose={onClose}>
      <ChangeEmailForm email={email} serverKey={serverKey} onClose={onClose} />
    </SlideDrawer>
  );
}

/**
 * Split from {@link ChangeEmailDrawer} for the same reason as
 * {@link ChangePasswordForm}: `SlideDrawer` renders `children` only while
 * open, so this component's state unmounts on close, and every reopen starts
 * back on the address stage rather than wherever the last attempt left off.
 */
function ChangeEmailForm({
  email,
  serverKey,
  onClose,
}: {
  email: string | null;
  serverKey: string;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const { changeEmailRequest, changeEmail } = useMultiplayer();
  const [stage, setStage] = useState<"address" | "code" | "done">("address");
  const [address, setAddress] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const currentEmail = email ?? t`Not known yet`;

  const submitAddress = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await changeEmailRequest(address.trim(), serverKey);
      setStage("code");
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSubmitting(false);
    }
  };

  const submitCode = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await changeEmail(address.trim(), code.trim(), serverKey);
      setStage("done");
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSubmitting(false);
    }
  };

  if (stage === "done") {
    return (
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
        <p className="text-sm">
          <Trans>Email address changed.</Trans>
        </p>
        <div className="mt-auto flex justify-end border-t border-border pt-3">
          <Button size="sm" onClick={onClose}>
            <Trans>Close</Trans>
          </Button>
        </div>
      </div>
    );
  }

  if (stage === "code") {
    return (
      <form
        onSubmit={submitCode}
        className="flex flex-1 flex-col gap-3 overflow-y-auto p-4"
      >
        <p className="text-xs text-muted-foreground">
          <Trans>Check {address} for the verification code.</Trans>
        </p>
        <Field label={t`Verification code`}>
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoComplete="one-time-code"
            {...identifierFieldProps}
          />
        </Field>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="mt-auto flex justify-end gap-2 border-t border-border pt-3">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            <Trans>Close</Trans>
          </Button>
          <Button
            type="submit"
            size="sm"
            disabled={submitting || code.trim() === ""}
          >
            {submitting ? t`Saving…` : t`Save`}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <form
      onSubmit={submitAddress}
      className="flex flex-1 flex-col gap-3 overflow-y-auto p-4"
    >
      <p className="text-xs text-muted-foreground">
        <Trans>Currently: {currentEmail}</Trans>
      </p>
      <Field label={t`New email address`}>
        <Input
          type="email"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          autoComplete="off"
          {...identifierFieldProps}
        />
      </Field>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="mt-auto flex justify-end gap-2 border-t border-border pt-3">
        <Button type="button" variant="outline" size="sm" onClick={onClose}>
          <Trans>Close</Trans>
        </Button>
        <Button
          type="submit"
          size="sm"
          disabled={submitting || address.trim() === ""}
        >
          {submitting ? t`Sending…` : t`Send code`}
        </Button>
      </div>
    </form>
  );
}
