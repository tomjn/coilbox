import { Button, Input } from "@picoframe/frame";
import { TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { SlideDrawer } from "@/components/SlideDrawer";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { identifierFieldProps } from "@/lib/identifierField";
import type { BanEntry } from "../bindings";
import { DaysField } from "../DaysField";
import { AdminRequestStatus } from "./AdminRequestStatus";
import { useAdminRequest } from "./adminRequest";
import { DrawerBody, ToolHeader } from "./ToolHeader";
import { TOOL_PARAM } from "./toolNav";

/** A field uberserver can write as Python's `None`. */
function dash(value: string | null): string {
  return value ?? "-";
}

/** What `UNBAN` should be given to lift a row: its username, or failing that
 * its IP or email. */
function unbanTarget(entry: BanEntry): string {
  return entry.username ?? entry.ip ?? entry.email ?? "";
}

function BansTable({
  entries,
  onLift,
}: {
  entries: BanEntry[];
  onLift: (target: string) => void;
}) {
  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">No one is banned.</p>;
  }
  return (
    <Table className="text-foreground">
      <TableHeader>
        <TableRow>
          <TableHead>Username</TableHead>
          <TableHead>IP</TableHead>
          <TableHead>Email</TableHead>
          <TableHead>Reason</TableHead>
          <TableHead>Ends</TableHead>
          <TableHead>Issuer</TableHead>
          <TableHead>
            <span className="sr-only">Actions</span>
          </TableHead>
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
            <TableCell className="text-right">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7"
                aria-label={`Lift ban on ${unbanTarget(entry)}…`}
                onClick={() => onLift(unbanTarget(entry))}
              >
                Lift…
              </Button>
            </TableCell>
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
    <fieldset className="flex flex-col gap-3">
      <legend className="sr-only">Ban an account</legend>
      <form
        className="flex flex-col gap-3"
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
            {...identifierFieldProps}
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
    <fieldset className="flex flex-col gap-3">
      <legend className="sr-only">Ban a specific username, IP or email</legend>
      <form
        className="flex flex-col gap-3"
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
            {...identifierFieldProps}
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
  initialTarget,
  onChanged,
}: {
  serverKey: string;
  /** Filled from the row whose Lift action opened the form. */
  initialTarget: string;
  onChanged: () => void;
}) {
  const [target, setTarget] = useState(initialTarget);
  const unban = useAdminRequest(serverKey);

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="sr-only">Lift a ban</legend>
      <Alert>
        <TriangleAlert />
        <AlertTitle className="line-clamp-none">
          Lifting by IP or email lifts every ban on it
        </AlertTitle>
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
            {...identifierFieldProps}
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

/** Which form the drawer holds, if any. */
type BansDrawer =
  | { kind: "ban" }
  | { kind: "banSpecific" }
  | { kind: "unban"; target: string };

const DRAWER_TITLES: Record<BansDrawer["kind"], string> = {
  ban: "Ban an account",
  banSpecific: "Ban a specific username, IP or email",
  unban: "Lift a ban",
};

/**
 * The Bans tool of the Server admin page (issues #2778 and #2918): `LISTBANS`
 * as the tool's main content, with `BAN` as its primary action, and
 * `BANSPECIFIC` and `UNBAN` as secondary ones. Each form opens on demand in a
 * drawer, and the table refreshes after every change. Each row has its own
 * Lift action, which opens `UNBAN` filled with that row's name.
 *
 * The player lookup's Ban action hands off the account's name through
 * `?ban=`, the same URL-as-shared-state pattern `useServerAdminKey` uses for
 * `?server=` and `PlayerLookupSection` for `?player=`. The param is consumed
 * once: copied into the ban form, which opens, then removed, with `?tool=`
 * pinned to this tool so the page stays here once `?ban=` is gone.
 */
export function BansSection({ serverKey }: { serverKey: string }) {
  const [params, setParams] = useSearchParams();
  const banParam = params.get("ban");
  const [banTarget, setBanTarget] = useState(banParam ?? "");
  const [drawer, setDrawer] = useState<BansDrawer | null>(
    banParam ? { kind: "ban" } : null,
  );
  const list = useAdminRequest(serverKey);

  useEffect(() => {
    if (!banParam) return;
    setBanTarget(banParam);
    setDrawer({ kind: "ban" });
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("ban");
        next.set(TOOL_PARAM, "bans");
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
      <ToolHeader
        title="Bans"
        description="There is no command to change a ban's reason or length. Lift it and ban again instead."
        actions={
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8"
              onClick={() => setDrawer({ kind: "banSpecific" })}
            >
              Ban IP or email…
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8"
              onClick={() => setDrawer({ kind: "unban", target: "" })}
            >
              Lift a ban…
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-8"
              onClick={() => {
                setBanTarget("");
                setDrawer({ kind: "ban" });
              }}
            >
              Ban an account…
            </Button>
          </>
        }
      />
      <AdminRequestStatus
        state={list.state}
        unanswered="The server did not answer."
      >
        {(reply) =>
          reply.shape === "banList" ? (
            <BansTable
              entries={reply.entries}
              onLift={(target) => setDrawer({ kind: "unban", target })}
            />
          ) : null
        }
      </AdminRequestStatus>
      <SlideDrawer
        open={drawer !== null}
        title={drawer ? DRAWER_TITLES[drawer.kind] : ""}
        onClose={() => setDrawer(null)}
      >
        <DrawerBody>
          {drawer?.kind === "ban" && (
            <BanForm
              serverKey={serverKey}
              username={banTarget}
              onChanged={refresh}
            />
          )}
          {drawer?.kind === "banSpecific" && (
            <BanSpecificForm serverKey={serverKey} onChanged={refresh} />
          )}
          {drawer?.kind === "unban" && (
            <UnbanForm
              serverKey={serverKey}
              initialTarget={drawer.target}
              onChanged={refresh}
            />
          )}
        </DrawerBody>
      </SlideDrawer>
    </section>
  );
}
