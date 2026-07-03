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
import { useMultiplayer } from "./store";

/**
 * App-level modal shown whenever a connection parks on the agreement /
 * verification-code handshake (`pendingAgreement`). Rendered inside
 * `MultiplayerProvider` so it appears on any route. It is deliberately sticky —
 * there's no close affordance and escape/outside clicks are ignored; the user
 * either confirms with the emailed code or explicitly disconnects.
 */
export function VerificationCodeDialog() {
  const { pendingAgreement, submitAgreementCode, cancelAgreement } =
    useMultiplayer();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = pendingAgreement != null;

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
        className="sm:max-w-sm"
      >
        <DialogHeader>
          <DialogTitle>Enter verification code</DialogTitle>
          <DialogDescription>
            The server sent a verification code to finish signing in. Enter it
            below to continue.
          </DialogDescription>
        </DialogHeader>
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
            placeholder="Verification code"
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
            <Button type="submit" disabled={busy || code.trim() === ""}>
              Confirm
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
