import { Button, Input } from "@picoframe/frame";
import { TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { BanEntry } from "../bindings";
import { DaysField } from "../DaysField";
import { AdminRequestStatus } from "./AdminRequestStatus";
import { useAdminRequest } from "./adminRequest";

/** A field uberserver can write as Python's `None`. */
function dash(value: string | null): string {
  return value ?? "-";
}

function BansTable({ entries }: { entries: BanEntry[] }) {
  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">No one is banned.</p>;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Username</TableHead>
          <TableHead>IP</TableHead>
          <TableHead>Email</TableHead>
          <TableHead>Reason</TableHead>
          <TableHead>Ends</TableHead>
          <TableHead>Issuer</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map((entry) => (
          <TableRow
            key={`${entry.username}-${entry.ip}-${entry.email}-${entry.ends}-${entry.issuer}`}
          >
            <TableCell>{dash(entry.username)}</TableCell>
            <TableCell>{dash(entry.ip)}</TableCell>
            <TableCell>{dash(entry.email)}</TableCell>
            <TableCell className="whitespace-normal">{entry.reason}</TableCell>
            <TableCell className="whitespace-normal">{entry.ends}</TableCell>
            <TableCell>{entry.issuer}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/**
 * `BAN <username> <days> <reason>`: bans the account together with its last
 * IP and email, and kicks it if online.
 *
 * `username` is pre-filled from the player lookup section's Ban action
 * (issue #2778's `?ban=` handoff, read by `BansSection`), but stays a normal
 * text field so a moderator can also type a name directly here.
 */
function BanForm({
  serverKey,
  username,
  onChanged,
}: {
  serverKey: string;
  username: string;
  onChanged: () => void;
}) {
  const [name, setName] = useState(username);
  const [days, setDays] = useState("1");
  const [reason, setReason] = useState("");
  const ban = useAdminRequest(serverKey);

  useEffect(() => {
    if (username) setName(username);
  }, [username]);

  const canSubmit =
    name.trim() !== "" && days.trim() !== "" && reason.trim() !== "";

  return (
    <fieldset className="flex flex-col gap-2 rounded border border-border p-3">
      <legend className="px-1 text-sm font-medium">Ban an account</legend>
      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!canSubmit) return;
          void ban
            .send("BAN", [name.trim(), days.trim(), reason.trim()], "ban")
            .then((state) => {
              if (state.status === "answered") onChanged();
            });
        }}
      >
        <span className="flex flex-col gap-1 text-xs text-muted-foreground">
          Username
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            aria-label="Username"
            className="h-8"
          />
        </span>
        <DaysField value={days} onChange={setDays} />
        <span className="flex flex-col gap-1 text-xs text-muted-foreground">
          Reason
          <Input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            aria-label="Reason"
            className="h-8"
          />
        </span>
        <Button
          type="submit"
          variant="destructive"
          size="sm"
          className="h-8 self-start"
          disabled={!canSubmit}
        >
          Ban account
        </Button>
      </form>
      <AdminRequestStatus
        state={ban.state}
        unanswered="The server did not answer."
      >
        {(reply) => (reply.shape === "ban" ? reply.message : null)}
      </AdminRequestStatus>
    </fieldset>
  );
}

/**
 * `BANSPECIFIC <target> <days> <reason>`: bans only the one thing given,
 * which is a username, an IP or an email.
 */
function BanSpecificForm({
  serverKey,
  onChanged,
}: {
  serverKey: string;
  onChanged: () => void;
}) {
  const [target, setTarget] = useState("");
  const [days, setDays] = useState("1");
  const [reason, setReason] = useState("");
  const banSpecific = useAdminRequest(serverKey);

  const canSubmit =
    target.trim() !== "" && days.trim() !== "" && reason.trim() !== "";

  return (
    <fieldset className="flex flex-col gap-2 rounded border border-border p-3">
      <legend className="px-1 text-sm font-medium">
        Ban a specific username, IP or email
      </legend>
      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!canSubmit) return;
          void banSpecific
            .send(
              "BANSPECIFIC",
              [target.trim(), days.trim(), reason.trim()],
              "banSpecific",
            )
            .then((state) => {
              if (state.status === "answered") onChanged();
            });
        }}
      >
        <span className="flex flex-col gap-1 text-xs text-muted-foreground">
          Username, IP or email
          <Input
            value={target}
            onChange={(event) => setTarget(event.target.value)}
            aria-label="Username, IP or email to ban"
            className="h-8"
          />
        </span>
        <DaysField value={days} onChange={setDays} />
        <span className="flex flex-col gap-1 text-xs text-muted-foreground">
          Reason
          <Input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            aria-label="Reason"
            className="h-8"
          />
        </span>
        <Button
          type="submit"
          variant="destructive"
          size="sm"
          className="h-8 self-start"
          disabled={!canSubmit}
        >
          Ban target
        </Button>
      </form>
      <AdminRequestStatus
        state={banSpecific.state}
        unanswered="The server did not answer."
      >
        {(reply) => (reply.shape === "banSpecific" ? reply.message : null)}
      </AdminRequestStatus>
    </fieldset>
  );
}

/**
 * `UNBAN <target>`: removes every ban matching a username, IP or email, not
 * only the one a moderator had in mind.
 */
function UnbanForm({
  serverKey,
  onChanged,
}: {
  serverKey: string;
  onChanged: () => void;
}) {
  const [target, setTarget] = useState("");
  const unban = useAdminRequest(serverKey);

  return (
    <fieldset className="flex flex-col gap-2 rounded border border-border p-3">
      <legend className="px-1 text-sm font-medium">Lift a ban</legend>
      <Alert>
        <TriangleAlert />
        <AlertTitle>Lifting by IP or email lifts every ban on it</AlertTitle>
        <AlertDescription>
          Not only the row you had in mind. uberserver removes every ban
          matching the username, IP or email you give it.
        </AlertDescription>
      </Alert>
      <form
        className="flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (target.trim() === "") return;
          void unban.send("UNBAN", [target.trim()], "unban").then((state) => {
            if (state.status === "answered") onChanged();
          });
        }}
      >
        <span className="flex flex-1 flex-col gap-1 text-xs text-muted-foreground">
          Username, IP or email
          <Input
            value={target}
            onChange={(event) => setTarget(event.target.value)}
            aria-label="Username, IP or email to unban"
            className="h-8"
          />
        </span>
        <Button
          type="submit"
          size="sm"
          className="h-8"
          disabled={target.trim() === ""}
        >
          Lift ban
        </Button>
      </form>
      <AdminRequestStatus
        state={unban.state}
        unanswered="The server did not answer."
      >
        {(reply) => (reply.shape === "unban" ? reply.message : null)}
      </AdminRequestStatus>
    </fieldset>
  );
}

/**
 * The bans section of the Server admin page (issue #2778): `LISTBANS` as a
 * table, `BAN` and `BANSPECIFIC` forms to add one, and `UNBAN` to lift one,
 * refreshing the table after every change.
 *
 * The player lookup section's Ban action hands off the account's name
 * through `?ban=`, the same URL-as-shared-state pattern `useServerAdminKey`
 * uses for `?server=` and `PlayerLookupSection` for `?player=`. The param is
 * consumed once (copied into the form, then removed) rather than kept,
 * since unlike `?player=` there is nothing useful to reload it into.
 */
export function BansSection({ serverKey }: { serverKey: string }) {
  const [params, setParams] = useSearchParams();
  const banParam = params.get("ban");
  const [banTarget, setBanTarget] = useState(banParam ?? "");
  const list = useAdminRequest(serverKey);

  useEffect(() => {
    if (!banParam) return;
    setBanTarget(banParam);
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("ban");
        return next;
      },
      { replace: true },
    );
  }, [banParam, setParams]);

  // Only the connection changing should trigger a fresh load here, not
  // `list.send` itself. `refresh` below re-sends explicitly after every
  // ban or unban.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reload only when the connection changes, not on every list.send identity change
  useEffect(() => {
    void list.send("LISTBANS", [], "banList");
  }, [serverKey]);

  const refresh = () => {
    void list.send("LISTBANS", [], "banList");
  };

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-base font-semibold">Bans</h2>
      <p className="text-sm text-muted-foreground">
        There is no command to change a ban's reason or length. Lift it and ban
        again instead.
      </p>
      <AdminRequestStatus
        state={list.state}
        unanswered="The server did not answer."
      >
        {(reply) =>
          reply.shape === "banList" ? (
            <BansTable entries={reply.entries} />
          ) : null
        }
      </AdminRequestStatus>
      <BanForm serverKey={serverKey} username={banTarget} onChanged={refresh} />
      <BanSpecificForm serverKey={serverKey} onChanged={refresh} />
      <UnbanForm serverKey={serverKey} onChanged={refresh} />
    </section>
  );
}
