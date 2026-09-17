import { Button, Input } from "@picoframe/frame";
import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { agreementWantsCode } from "./agreement";
import { serverNameFor, useMultiplayer, useProtocolServers } from "./store";

/**
 * App-level modal shown whenever a connection parks on the agreement /
 * verification-code handshake (`pendingAgreement`). Rendered inside
 * `MultiplayerProvider` so it appears on any route. It is deliberately sticky —
 * there's no close affordance and escape/outside clicks are ignored; the user
 * either confirms, with a code when the server emailed one, or explicitly
 * disconnects.
 *
 * `pendingAgreement` already queues by server key (issue #2847): two
 * connections parking on it at once show one at a time, the one not shown
 * staying parked until this one clears. The server is named under the title
 * once there is more than one connection to tell apart, so a queued second
 * prompt does not read as the same one still open.
 */
export function VerificationCodeDialog() {
  const {
    pendingAgreement,
    submitAgreementCode,
    cancelAgreement,
    connections,
  } = useMultiplayer();
  const servers = useProtocolServers();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = pendingAgreement != null;
  // The field stays either way, so a server whose agreement is worded
  // differently can still be given a code. It is only required when asked for.
  const wantsCode = agreementWantsCode(pendingAgreement?.text ?? "");
  const serverName =
    pendingAgreement && Object.keys(connections).length > 1
      ? serverNameFor(pendingAgreement.serverKey, servers)
      : null;

  // Fresh field/error each time a new prompt appears.
  useEffect(() => {
    if (open) {
      setCode("");
      setError(null);
    }
  }, [open]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await submitAgreementCode(code.trim());
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      await cancelAgreement();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open}>
      <DialogContent
        showCloseButton={false}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        className="sm:max-w-lg"
      >
        <DialogHeader>
          <DialogTitle>
            {wantsCode
              ? "Enter verification code"
              : "Accept the server's terms"}
          </DialogTitle>
          {serverName ? (
            <p className="text-xs text-muted-foreground">{serverName}</p>
          ) : null}
          <DialogDescription>
            {wantsCode
              ? "The server sent a verification code to finish signing in. Enter it below to continue."
              : "The server asks you to accept its terms before you sign in for the first time."}
          </DialogDescription>
        </DialogHeader>
        {pendingAgreement?.text ? (
          <div className="max-h-64 overflow-y-auto rounded-md border border-border bg-muted/40 p-3">
            <pre className="whitespace-pre-wrap break-words text-xs">
              {pendingAgreement.text}
            </pre>
          </div>
        ) : null}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className="flex flex-col gap-3"
        >
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder={
              wantsCode
                ? "Verification code"
                : "Verification code, if you were sent one"
            }
            autoFocus
            disabled={busy}
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={disconnect}
              disabled={busy}
            >
              Disconnect
            </Button>
            <Button
              type="submit"
              disabled={busy || (wantsCode && code.trim() === "")}
            >
              {wantsCode ? "Confirm" : "Accept"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
