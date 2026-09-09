import { Button, Input } from "@picoframe/frame";
import { X } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Field } from "@/components/Field";
import { lsStoreCredential } from "../../lobby-servers/bindings";
import { useLastLogin } from "../../lobby-servers/config";
import { useMultiplayer } from "../../multiplayer/store";

const H2_CLASS =
  "flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground";

/**
 * Account management for the one lobby account currently signed in
 * (`/settings/account`). Separate from `/settings/lobby-servers`, which owns the
 * local list of servers and logins and whose edits are instant and offline:
 * everything here goes to the server and can fail there, which is why the page
 * has three states rather than one form.
 */
export default function AccountSettings() {
  const { connected, protocol, mirror, accountInfo, getUserInfo } =
    useMultiplayer();

  // Requested once per session, not on every render: `connected`/`protocol`
  // only change on connect/disconnect, and `getUserInfo` is a stable callback.
  useEffect(() => {
    if (connected && protocol === "tasserver") getUserInfo();
  }, [connected, protocol, getUserInfo]);

  if (!connected) return <DisconnectedPanel />;
  if (protocol !== "tasserver") return <OtherProtocolPanel />;

  return (
    <div className="space-y-6 pb-8">
      <AccountDetails
        username={mirror.state?.myUsername ?? null}
        registrationDate={accountInfo?.registrationDate ?? null}
        email={accountInfo?.email ?? null}
        ingameHours={accountInfo?.ingameHours ?? null}
      />
      <AccountActions email={accountInfo?.email ?? null} />
    </div>
  );
}

/** Not signed in: name the account that would be managed, if any, and offer to connect. */
function DisconnectedPanel() {
  const { openLoginPopover } = useMultiplayer();
  const [lastLogin] = useLastLogin();

  return (
    <div className="space-y-3 rounded-md border border-dashed border-border p-4 text-sm">
      <p className="text-muted-foreground">
        {lastLogin
          ? `Not signed in. Connect as ${lastLogin.username} to manage that account.`
          : "Not signed in. Connect to a lobby account to manage it here."}
      </p>
      <Button onClick={openLoginPopover}>Connect</Button>
    </div>
  );
}

/** Connected to Zero-K or Tachyon: neither protocol has any of these commands. */
function OtherProtocolPanel() {
  return (
    <p className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
      Account management for this server happens on the server's own site.
    </p>
  );
}

function AccountDetails({
  username,
  registrationDate,
  email,
  ingameHours,
}: {
  username: string | null;
  registrationDate: string | null;
  email: string | null;
  ingameHours: string | null;
}) {
  const NOT_KNOWN = "Not known yet";
  return (
    <section className="space-y-3">
      <h2 className={H2_CLASS}>Account</h2>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-md border border-border p-3 text-sm">
        <dt className="text-muted-foreground">Username</dt>
        <dd className="font-medium">{username ?? NOT_KNOWN}</dd>
        <dt className="text-muted-foreground">Member since</dt>
        <dd>{registrationDate ?? NOT_KNOWN}</dd>
        <dt className="text-muted-foreground">Email address</dt>
        <dd>{email ?? NOT_KNOWN}</dd>
        <dt className="text-muted-foreground">Playtime</dt>
        <dd>{ingameHours ?? NOT_KNOWN}</dd>
      </dl>
    </section>
  );
}

function AccountActions({ email }: { email: string | null }) {
  const { resendVerification } = useMultiplayer();
  const [drawer, setDrawer] = useState<"password" | "email" | null>(null);
  const [resendStatus, setResendStatus] = useState<string | null>(null);
  const [resending, setResending] = useState(false);

  const doResend = async () => {
    if (!email) return;
    setResending(true);
    setResendStatus(null);
    try {
      await resendVerification(email);
      setResendStatus("Verification email sent.");
    } catch (err) {
      setResendStatus(String(err));
    } finally {
      setResending(false);
    }
  };

  return (
    <section className="space-y-3">
      <h2 className={H2_CLASS}>Change your account</h2>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setDrawer("password")}
        >
          Change password
        </Button>
        <Button variant="outline" size="sm" onClick={() => setDrawer("email")}>
          Change email
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={email == null || resending}
          onClick={() => void doResend()}
        >
          Resend verification email
        </Button>
      </div>
      {resendStatus && (
        <p className="text-xs text-muted-foreground">{resendStatus}</p>
      )}
      <ChangePasswordDrawer
        open={drawer === "password"}
        onClose={() => setDrawer(null)}
      />
      <ChangeEmailDrawer
        open={drawer === "email"}
        email={email}
        onClose={() => setDrawer(null)}
      />
    </section>
  );
}

/**
 * Current + new password, submitted to `changePassword`. `CHANGEPASSWORD` has no
 * accept/deny reply of its own, only a bare `SERVERMSG`, so whatever the server
 * says is shown verbatim rather than interpreted. The saved keychain entry is
 * only touched when `succeeded` is true and the drawer can tell which saved
 * login this session came from (`lastLogin`, written on every successful
 * connect) — a stale saved password is fixed by retyping it, but one
 * overwritten on a change that did not happen locks the user out of their own
 * saved login.
 */
function ChangePasswordDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  return (
    <SlideDrawer open={open} title="Change password" onClose={onClose}>
      <ChangePasswordForm onClose={onClose} />
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
function ChangePasswordForm({ onClose }: { onClose: () => void }) {
  const { changePassword, mirror } = useMultiplayer();
  const [lastLogin] = useLastLogin();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [succeeded, setSucceeded] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const result = await changePassword(current, next);
      setMessage(result.message);
      setSucceeded(result.succeeded);
      if (
        result.succeeded &&
        lastLogin &&
        lastLogin.username === mirror.state?.myUsername
      ) {
        lsStoreCredential({
          serverId: lastLogin.serverId,
          username: lastLogin.username,
          secret: next,
        }).catch(() => {});
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      className="flex flex-1 flex-col gap-3 overflow-y-auto p-4"
    >
      <Field label="Current password">
        <Input
          type="password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          autoComplete="current-password"
        />
      </Field>
      <Field label="New password">
        <Input
          type="password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          autoComplete="new-password"
        />
      </Field>
      {message && (
        <p className="text-xs text-muted-foreground">
          {message}
          {succeeded === false &&
            " Your saved password has been left as it was."}
        </p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="mt-auto flex justify-end gap-2 border-t border-border pt-3">
        <Button type="button" variant="outline" size="sm" onClick={onClose}>
          Close
        </Button>
        <Button
          type="submit"
          size="sm"
          disabled={submitting || current === "" || next === ""}
        >
          {submitting ? "Saving…" : "Save"}
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
  onClose,
}: {
  open: boolean;
  email: string | null;
  onClose: () => void;
}) {
  return (
    <SlideDrawer open={open} title="Change email" onClose={onClose}>
      <ChangeEmailForm email={email} onClose={onClose} />
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
  onClose,
}: {
  email: string | null;
  onClose: () => void;
}) {
  const { changeEmailRequest, changeEmail } = useMultiplayer();
  const [stage, setStage] = useState<"address" | "code" | "done">("address");
  const [address, setAddress] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submitAddress = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await changeEmailRequest(address.trim());
      setStage("code");
    } catch (err) {
      setError(String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const submitCode = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await changeEmail(address.trim(), code.trim());
      setStage("done");
    } catch (err) {
      setError(String(err));
    } finally {
      setSubmitting(false);
    }
  };

  if (stage === "done") {
    return (
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
        <p className="text-sm">Email address changed.</p>
        <div className="mt-auto flex justify-end border-t border-border pt-3">
          <Button size="sm" onClick={onClose}>
            Close
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
          Check {address} for the verification code.
        </p>
        <Field label="Verification code">
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoComplete="one-time-code"
          />
        </Field>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="mt-auto flex justify-end gap-2 border-t border-border pt-3">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
          <Button
            type="submit"
            size="sm"
            disabled={submitting || code.trim() === ""}
          >
            {submitting ? "Saving…" : "Save"}
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
        Currently: {email ?? "Not known yet"}
      </p>
      <Field label="New email address">
        <Input
          type="email"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          autoComplete="off"
        />
      </Field>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="mt-auto flex justify-end gap-2 border-t border-border pt-3">
        <Button type="button" variant="outline" size="sm" onClick={onClose}>
          Close
        </Button>
        <Button
          type="submit"
          size="sm"
          disabled={submitting || address.trim() === ""}
        >
          {submitting ? "Sending…" : "Send code"}
        </Button>
      </div>
    </form>
  );
}

/**
 * This page's slide-in drawer shell: the same viewport-anchored right drawer as
 * `lobby-servers/pages/SettingsSection.tsx`'s `SlideDrawer`, duplicated rather
 * than shared because it is not exported and each settings section here builds
 * its own. Children mount only while open, so each visit starts fresh.
 * Portalled to `<body>` so `fixed inset-y-0` means the viewport rather than a
 * transformed/filtered ancestor.
 */
function SlideDrawer({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return createPortal(
    <>
      {open && (
        <button
          type="button"
          aria-label={`Close ${title}`}
          className="fixed inset-0 z-40 bg-black/20"
          onClick={onClose}
        />
      )}
      <aside
        className={`fixed inset-y-0 right-0 z-50 flex w-96 max-w-full flex-col border-l border-border bg-background shadow-lg transition-transform motion-reduce:transition-none ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
        inert={!open}
      >
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          <Button className="h-7 px-2" onClick={onClose} aria-label="Close">
            <X className="size-4" />
          </Button>
        </header>
        {open && children}
      </aside>
    </>,
    document.body,
  );
}
