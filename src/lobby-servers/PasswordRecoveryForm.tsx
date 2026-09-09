import { Button, Input } from "@picoframe/frame";
import { openUrl } from "@tauri-apps/plugin-opener";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Field } from "@/components/Field";
import { OptionSelect } from "@/components/OptionSelect";
import { useMultiplayer } from "../multiplayer/store";
import { type LobbyServer, serverProtocol } from "./config";

/**
 * Recover a forgotten password on a lobby server. Drives the backend
 * `recoverPassword` / `submitRecoveryCode` handshake, which ends one of two
 * ways depending on which server family answers.
 *
 * uberserver emails an 8 digit code, takes it back, generates a new password,
 * emails that too, and tells us the account's username - the one moment the
 * protocol answers a question a locked-out user usually cannot answer either.
 * teiserver has no in-lobby recovery at all and hands back the address of its
 * own web page instead. Only TASServer-protocol servers are offered here:
 * Zero-K and Tachyon have no recovery command in their protocols at all.
 */
export function PasswordRecoveryForm({
  servers,
  onSignIn,
  onCancel,
}: {
  servers: LobbyServer[];
  onSignIn: (serverId: string, username: string) => void;
  onCancel: () => void;
}) {
  const { recoverPassword, submitRecoveryCode, cancelRecovery, busy } =
    useMultiplayer();
  const recoverable = servers.filter((s) => serverProtocol(s) === "tasserver");
  const [serverId, setServerId] = useState(recoverable[0]?.id ?? "");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"email" | "code" | "redirected" | "done">(
    "email",
  );
  const [serverKey, setServerKey] = useState<string | null>(null);
  const [redirectUrl, setRedirectUrl] = useState<string | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const selected = recoverable.find((s) => s.id === serverId);

  // Close an abandoned recovery connection on unmount. Only the "code" stage
  // ever leaves one open (`recoverPassword`'s `codeSent` outcome), so a ref
  // tracks the latest stage/serverKey for the cleanup below to read - the
  // effect itself only runs once, on mount, and its own closure would
  // otherwise see the stage "email" was in when it first ran.
  const stageRef = useRef(stage);
  const serverKeyRef = useRef(serverKey);
  stageRef.current = stage;
  serverKeyRef.current = serverKey;
  useEffect(() => {
    return () => {
      if (stageRef.current === "code" && serverKeyRef.current) {
        void cancelRecovery(serverKeyRef.current);
      }
    };
  }, [cancelRecovery]);

  const submitEmail = async (e: FormEvent) => {
    e.preventDefault();
    const server = selected;
    if (!server) {
      setError("Select a server.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const start = await recoverPassword(server, email.trim());
      if (start.kind === "codeSent") {
        setServerKey(start.serverKey);
        setStage("code");
      } else {
        setRedirectUrl(start.url);
        setStage("redirected");
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const submitCode = async (e: FormEvent) => {
    e.preventDefault();
    if (!serverKey) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await submitRecoveryCode(serverKey, code.trim());
      setUsername(result.username);
      setStage("done");
    } catch (err) {
      // A wrong code leaves the connection open for uberserver's remaining
      // attempts, so the stage stays "code" and the field stays open for a
      // retry rather than resetting to the email step.
      setError(String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const cancelCode = () => {
    if (serverKey) void cancelRecovery(serverKey);
    onCancel();
  };

  if (stage === "done" && username) {
    return (
      <div className="flex flex-col gap-3">
        <div>
          <p className="text-xs font-medium text-muted-foreground">Username</p>
          <p className="text-lg font-semibold">{username}</p>
        </div>
        <p className="text-sm text-muted-foreground">
          A new password has been emailed to you.
        </p>
        <p className="text-xs text-muted-foreground">
          Save it in Coilbox, then replace it with one of your own in Settings,
          Account.
        </p>
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            size="sm"
            onClick={() => onSignIn(serverId, username)}
          >
            Save your new password
          </Button>
        </div>
      </div>
    );
  }

  if (stage === "redirected" && redirectUrl) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          {selected?.name ?? "This server"} does not offer password recovery in
          Coilbox. Reset it on the server's own page instead:
        </p>
        <p className="break-all text-sm font-medium">{redirectUrl}</p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onCancel}>
            Close
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => void openUrl(redirectUrl)}
          >
            Open
          </Button>
        </div>
      </div>
    );
  }

  if (stage === "code") {
    return (
      <form onSubmit={submitCode} className="flex flex-col gap-3">
        {/* The hint sits outside `Field` rather than in its `hint` slot: that
            slot renders inside the same <label> as the input, and a getByLabelText
            lookup for "Code" would then have to match the hint text too. */}
        <p className="text-xs text-muted-foreground">
          Check your email for the 8 digit code. Three wrong tries locks this
          request.
        </p>
        <Field label="Code">
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoComplete="one-time-code"
          />
        </Field>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={cancelCode}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            size="sm"
            disabled={submitting || busy || code.trim() === ""}
          >
            {submitting ? "Resetting…" : "Reset password"}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={submitEmail} className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        Enter the email address on your account and we will send you a recovery
        code.
      </p>
      <Field label="Server">
        <OptionSelect
          value={serverId}
          onValueChange={setServerId}
          options={recoverable.map((s) => ({
            value: s.id,
            label: s.builtin ? s.name : `${s.name || s.host} (custom)`,
          }))}
          placeholder="Select a server"
        />
      </Field>
      <Field label="Email">
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
        <Button
          type="submit"
          size="sm"
          disabled={
            serverId === "" || email.trim() === "" || submitting || busy
          }
        >
          {submitting ? "Sending…" : "Send code"}
        </Button>
      </div>
    </form>
  );
}
