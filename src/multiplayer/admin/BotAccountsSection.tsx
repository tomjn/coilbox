import { Button, Input } from "@picoframe/frame";
import { Info } from "lucide-react";
import { useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AdminRequestStatus } from "./AdminRequestStatus";
import { useAdminRequest } from "./adminRequest";

/**
 * `CREATEBOTACCOUNT <newname> <fromuser> [founder]` (issue #2780): creates a
 * bot-flagged account with a blank email, using an existing account's
 * password. Given a founder, uberserver also registers a battle channel for
 * the bot with that player as founder.
 *
 * Its own section rather than folded into player lookup: it acts on a name
 * that does not exist yet, so there is nothing to look up first, unlike the
 * bot flag toggle (#2780's other half) which changes an account already in
 * view.
 *
 * Success and refusal both come back as one line: success as an ordinary
 * `SERVERMSG`, a refusal as a tagged `FAILED` naming `CREATEBOTACCOUNT`
 * (an invalid name, a missing `fromuser` or `founder`, or a name uberserver
 * will not register). `AdminQueue` in `admin_command.rs` already reads a
 * tagged `FAILED` as a refusal for any shape, so `<AdminRequestStatus>`
 * shows it as an alert with no extra wiring here.
 */
export function BotAccountsSection({ serverKey }: { serverKey: string }) {
  const [newName, setNewName] = useState("");
  const [fromUser, setFromUser] = useState("");
  const [founder, setFounder] = useState("");
  const create = useAdminRequest(serverKey);

  const canSubmit = newName.trim() !== "" && fromUser.trim() !== "";

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-base font-semibold">Create a bot account</h2>
      <Alert>
        <Info />
        <AlertTitle>The new account's password is copied, not set</AlertTitle>
        <AlertDescription>
          uberserver gives the new account the same password as the account
          named below. Coilbox never sees that password, and there is nothing to
          type for it here.
        </AlertDescription>
      </Alert>
      <form
        className="flex flex-col gap-2 rounded border border-border p-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (!canSubmit) return;
          const trimmedFounder = founder.trim();
          const args = trimmedFounder
            ? [newName.trim(), fromUser.trim(), trimmedFounder]
            : [newName.trim(), fromUser.trim()];
          void create.send("CREATEBOTACCOUNT", args, "createBotAccount");
        }}
      >
        <span className="flex flex-col gap-1 text-xs text-muted-foreground">
          New bot account name
          <Input
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            aria-label="New bot account name"
            className="h-8"
          />
        </span>
        <span className="flex flex-col gap-1 text-xs text-muted-foreground">
          Copy the password from
          <Input
            value={fromUser}
            onChange={(event) => setFromUser(event.target.value)}
            aria-label="Copy the password from"
            className="h-8"
          />
        </span>
        <span className="flex flex-col gap-1 text-xs text-muted-foreground">
          Battle founder (optional)
          <Input
            value={founder}
            onChange={(event) => setFounder(event.target.value)}
            aria-label="Battle founder"
            className="h-8"
          />
        </span>
        <Button
          type="submit"
          size="sm"
          className="h-8 self-start"
          disabled={!canSubmit}
        >
          Create bot account
        </Button>
      </form>
      <AdminRequestStatus
        state={create.state}
        unanswered="The server did not answer."
      >
        {(reply) =>
          reply.shape === "createBotAccount"
            ? `Created bot account ${reply.username}, with the same password as ${reply.fromUsername}${
                reply.founder ? `, and battle founder ${reply.founder}` : ""
              }.`
            : null
        }
      </AdminRequestStatus>
    </section>
  );
}
