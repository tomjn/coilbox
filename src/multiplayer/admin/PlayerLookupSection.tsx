import { Button, Input } from "@picoframe/frame";
import { useState } from "react";
import { useSearchParams } from "react-router";
import { Field } from "@/components/Field";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { AdminUserInfo } from "../bindings";
import { AdminRequestStatus } from "./AdminRequestStatus";
import { type AdminRequestState, useAdminRequest } from "./adminRequest";

/** `FINDIP` has no end marker, so every search waits out the full timeout
 * (`ADMIN_REPLY_TIMEOUT` in `admin_command.rs`, 20s). Told to the moderator
 * so a long wait doesn't read as stuck. */
const FINDIP_SENDING =
  "Looking for other accounts on this IP. This can take up to 20 seconds…";

/** A read-only labelled row for an account detail. Callers pass a dash
 * placeholder for the fields uberserver can write as Python's `None`. */
function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <Field label={label}>
      <p className="text-sm text-muted-foreground">{value}</p>
    </Field>
  );
}

/** The `FINDIP` results: one row per account seen on the address, each
 * reopening the lookup for that account (issue #2777: "open the lookup for
 * any account in that result"). */
function IpSearchResults({
  state,
  onPick,
}: {
  state: AdminRequestState;
  onPick: (username: string) => void;
}) {
  return (
    <AdminRequestStatus
      state={state}
      sending={FINDIP_SENDING}
      unanswered="No accounts have been seen on this IP."
    >
      {(reply) =>
        reply.shape === "ipSearch" ? (
          <ul className="flex flex-col gap-1">
            {reply.bindings.map((binding) => (
              <li key={`${binding.username}-${binding.address}`}>
                <button
                  type="button"
                  className="text-left text-sm underline decoration-dotted underline-offset-2 hover:text-foreground"
                  onClick={() => onPick(binding.username)}
                >
                  {binding.username}
                </button>{" "}
                <span className="text-xs text-muted-foreground">
                  {binding.online
                    ? "online now"
                    : binding.lastSeen
                      ? `last seen ${binding.lastSeen}`
                      : "seen before"}
                </span>
              </li>
            ))}
          </ul>
        ) : null
      }
    </AdminRequestStatus>
  );
}

/**
 * The bot flag toggle for the account in view (issue #2780): `SETBOTMODE
 * <username> true|false`. uberserver answers nothing when the account no
 * longer exists by the time the change reaches it, which is covered by the
 * `unanswered` wording below rather than shown as an error, the same as
 * `botMode`'s silence is read for `useAdminRequest` generally.
 *
 * `onChanged` re-runs the lookup after a successful change, so the switch
 * always reflects the server's own record rather than an optimistic guess.
 */
function BotFlagAction({
  username,
  bot,
  serverKey,
  onChanged,
}: {
  username: string;
  bot: boolean;
  serverKey: string;
  onChanged: () => void;
}) {
  const botMode = useAdminRequest(serverKey);
  const id = `bot-flag-${username}`;

  const setBotMode = (next: boolean) => {
    void botMode
      .send("SETBOTMODE", [username, next ? "true" : "false"], "botMode")
      .then((state) => {
        if (state.status === "answered") onChanged();
      });
  };

  return (
    <div className="flex flex-col gap-2 rounded border border-border p-3">
      <span className="flex items-center gap-2">
        <Switch
          id={id}
          checked={bot}
          disabled={botMode.state.status === "sending"}
          onCheckedChange={setBotMode}
        />
        <Label htmlFor={id} className="text-xs font-medium">
          Bot account
        </Label>
      </span>
      <AdminRequestStatus
        state={botMode.state}
        unanswered={`${username} may no longer exist, so nothing changed.`}
      >
        {(reply) =>
          reply.shape === "botMode"
            ? `Bot flag for ${reply.username} is now ${reply.bot ? "on" : "off"}.`
            : null
        }
      </AdminRequestStatus>
    </div>
  );
}

/** The kick form and its result, for the account currently in view. Later
 * issues add more actions beside this one (ban #2778, password reset #2781,
 * access level #2786, delete #2787). */
function KickAction({
  username,
  serverKey,
}: {
  username: string;
  serverKey: string;
}) {
  const [reason, setReason] = useState("");
  const kick = useAdminRequest(serverKey);

  return (
    <div className="flex flex-col gap-2 rounded border border-border p-3">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Actions
      </span>
      <form
        className="flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const trimmed = reason.trim();
          void kick.send(
            "KICK",
            trimmed ? [username, trimmed] : [username],
            "kick",
          );
        }}
      >
        <span className="flex flex-1 flex-col gap-1 text-xs text-muted-foreground">
          Reason (optional)
          <Input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="reason"
            aria-label="Kick reason"
            className="h-8"
          />
        </span>
        <Button type="submit" variant="destructive" size="sm" className="h-8">
          Kick
        </Button>
      </form>
      <AdminRequestStatus
        state={kick.state}
        unanswered="The server did not answer."
      >
        {(reply) =>
          reply.shape === "kick"
            ? reply.kicked
              ? `Kicked ${reply.username} from the server.`
              : `${reply.username} was not online.`
            : null
        }
      </AdminRequestStatus>
    </div>
  );
}

/**
 * Opens the bans section below on the Server admin page with this account's
 * name filled into the `BAN` form (issue #2778). Handed off through `?ban=`
 * rather than a prop, so `PlayerLookupSection` and `BansSection` stay
 * independent siblings on `ServerAdminPage`, the same URL-as-shared-state
 * pattern `useServerAdminKey` uses for `?server=`.
 */
function BanAction({ username }: { username: string }) {
  const [, setParams] = useSearchParams();

  return (
    <Button
      type="button"
      variant="destructive"
      size="sm"
      className="h-8"
      onClick={() =>
        setParams(
          (prev) => {
            const next = new URLSearchParams(prev);
            next.set("ban", username);
            return next;
          },
          { replace: true },
        )
      }
    >
      Ban…
    </Button>
  );
}

/** A dash placeholder for a field uberserver can write as Python's `None`. */
function dash(value: string | null): string {
  return value ?? "not known";
}

/** The `GETUSERINFO` fields for whichever kind of answer came back. */
function AccountInfoView({
  info,
  serverKey,
  onFindIp,
  onPickName,
  ipSearch,
}: {
  info: AdminUserInfo;
  serverKey: string;
  /** Run `FINDIP` on an address. */
  onFindIp: (address: string) => void;
  /** Look up another account by name, e.g. from a `FINDIP` result. */
  onPickName: (name: string) => void;
  ipSearch: ReturnType<typeof useAdminRequest>;
}) {
  switch (info.kind) {
    case "missing":
      return <p className="text-sm">No account named "{info.username}".</p>;
    case "bridgedMissing":
      return (
        <p className="text-sm">No bridged account named "{info.username}".</p>
      );
    case "static":
      return (
        <p className="text-sm">
          <strong>{info.username}</strong> is a static account. uberserver keeps
          no further details about it.
        </p>
      );
    case "bridged":
      return (
        <div className="flex flex-col gap-3">
          <DetailField label="Username" value={info.username} />
          <DetailField
            label="Bridge"
            value={
              info.bridged
                ? `Bridged in now via ${dash(info.bridgeUserId)}`
                : "Not bridged in now"
            }
          />
          <DetailField label="Bridge account ID" value={info.bridgedId} />
          <DetailField label="Last bridged" value={info.lastBridged} />
          <DetailField label="External ID" value={info.externalId} />
          <DetailField label="Location" value={info.location} />
          <DetailField
            label="External username"
            value={info.externalUsername}
          />
        </div>
      );
    case "account":
      return (
        <div className="flex flex-col gap-3">
          <DetailField label="Username" value={info.username} />
          <DetailField
            label="Status"
            value={
              info.online
                ? `Online (session ${dash(info.sessionId)})`
                : "Offline"
            }
          />
          <DetailField label="User ID" value={info.userId} />
          <DetailField label="Client agent" value={dash(info.agent)} />
          <DetailField label="Registered" value={info.registered} />
          <DetailField label="Last login" value={info.lastLogin} />
          <DetailField label="Access level" value={info.access} />
          <BotFlagAction
            username={info.username}
            bot={info.bot}
            serverKey={serverKey}
            onChanged={() => onPickName(info.username)}
          />
          <DetailField
            label="In-game time"
            value={`${info.ingameHours} hours`}
          />
          <DetailField label="Email" value={dash(info.email)} />
          <DetailField label="Last IP" value={dash(info.lastIp)} />
          {info.lastIp && (
            <div className="flex flex-col gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 self-start"
                onClick={() => info.lastIp && onFindIp(info.lastIp)}
              >
                Find other accounts on this IP
              </Button>
              {ipSearch.state.status !== "idle" && (
                <IpSearchResults state={ipSearch.state} onPick={onPickName} />
              )}
            </div>
          )}
          <DetailField label="Last hardware ID" value={dash(info.lastMacId)} />
          <DetailField label="Last system ID" value={dash(info.lastSysId)} />
          <div className="flex items-center justify-end">
            <BanAction username={info.username} />
          </div>
          <KickAction username={info.username} serverKey={serverKey} />
        </div>
      );
  }
}

/**
 * The player lookup section of the Server admin page (issue #2777): show a
 * looked-up account's `GETUSERINFO` fields as labelled rows, follow its last
 * IP to other accounts with `FINDIP`, and kick it.
 *
 * The name being looked up is carried in `?player=`, the same pattern
 * `useServerAdminKey` uses for `?server=`, so `MemberActionsMenu`'s "Look up
 * in Server admin" entry can open here with the name filled in.
 *
 * `useAdminRequest` tracks the account lookup and the IP search separately,
 * so a `FINDIP` in flight does not clobber the account details already
 * shown, and picking a name from a `FINDIP` result clears any earlier
 * search rather than leaving it beside the new account.
 */
export function PlayerLookupSection({ serverKey }: { serverKey: string }) {
  const [params, setParams] = useSearchParams();
  const [name, setName] = useState(params.get("player") ?? "");
  const lookup = useAdminRequest(serverKey);
  const ipSearch = useAdminRequest(serverKey);

  const runLookup = (target: string) => {
    const trimmed = target.trim();
    if (!trimmed) return;
    setName(trimmed);
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("player", trimmed);
        return next;
      },
      { replace: true },
    );
    ipSearch.reset();
    void lookup.send("GETUSERINFO", [trimmed], "userInfo");
  };

  const findIp = (address: string) => {
    void ipSearch.send("FINDIP", [address], "ipSearch");
  };

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-base font-semibold">Player lookup</h2>
      <form
        className="flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          runLookup(name);
        }}
      >
        <span className="flex flex-1 flex-col gap-1 text-sm">
          <label htmlFor="player-lookup-name" className="font-medium">
            Player name
          </label>
          <Input
            id="player-lookup-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Username"
          />
        </span>
        <Button type="submit" disabled={!name.trim()}>
          Look up
        </Button>
      </form>

      <AdminRequestStatus
        state={lookup.state}
        unanswered="The server did not answer."
      >
        {(reply) =>
          reply.shape === "userInfo" ? (
            <AccountInfoView
              info={reply.info}
              serverKey={serverKey}
              ipSearch={ipSearch}
              onFindIp={findIp}
              onPickName={runLookup}
            />
          ) : null
        }
      </AdminRequestStatus>
    </section>
  );
}
