import { t } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button, Input } from "@picoframe/frame";
import { TriangleAlert } from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "react-router";
import { Field } from "@/components/Field";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { identifierFieldProps } from "@/lib/identifierField";
import { AdminOnly } from "../AdminOnly";
import type { AdminUserInfo } from "../bindings";
import { AdminRequestStatus } from "./AdminRequestStatus";
import { type AdminRequestState, useAdminRequest } from "./adminRequest";
import { SetAccessAction } from "./StaffSection";
import { ToolGroup, ToolHeader } from "./ToolHeader";
import { TOOL_PARAM } from "./toolNav";

/** `FINDIP` has no end marker, so every search waits out the full timeout
 * (`ADMIN_REPLY_TIMEOUT` in `admin_command.rs`, 20s). Told to the moderator
 * so a long wait doesn't read as stuck. */
const findIpSending = () =>
  t`Looking for other accounts on this IP. This can take up to 20 seconds…`;

function botFlagText(username: string, bot: boolean): string {
  return bot
    ? t`Bot flag for ${username} is now on.`
    : t`Bot flag for ${username} is now off.`;
}

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
  const { t } = useLingui();
  return (
    <AdminRequestStatus
      state={state}
      sending={findIpSending()}
      unanswered={t`No accounts have been seen on this IP.`}
    >
      {(reply) =>
        reply.shape === "ipSearch" ? (
          <ul className="flex flex-col gap-1">
            {reply.bindings.map((binding) => {
              const lastSeen = binding.lastSeen;
              return (
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
                      ? t`online now`
                      : binding.lastSeen
                        ? t`last seen ${lastSeen}`
                        : t`seen before`}
                  </span>
                </li>
              );
            })}
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
  const { t } = useLingui();
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
    <div className="flex flex-col gap-2">
      <span className="flex items-center gap-2">
        <Switch
          id={id}
          checked={bot}
          disabled={botMode.state.status === "sending"}
          onCheckedChange={setBotMode}
        />
        <Label htmlFor={id} className="text-xs font-medium">
          <Trans>Bot account</Trans>
        </Label>
      </span>
      <AdminRequestStatus
        state={botMode.state}
        unanswered={t`${username} may no longer exist, so nothing changed.`}
      >
        {(reply) =>
          reply.shape === "botMode"
            ? botFlagText(reply.username, reply.bot)
            : null
        }
      </AdminRequestStatus>
    </div>
  );
}

/**
 * Whether uberserver's own `valid_email_addr` (`SQLUsers.py`) would treat
 * `email` as good enough to already be on file. Its checks, in order: not
 * empty, no whitespace anywhere in it, and a match (not necessarily a full
 * one, `re.match` only anchors the start) against
 * `[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,6}`.
 *
 * `RESETUSERPASSWORD` decides from this whether an email is needed: pass
 * one only when the account does not already have a valid one.
 */
function hasValidEmail(email: string | null): boolean {
  if (!email || email.includes(" ")) return false;
  return /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,6}/.test(email);
}

/**
 * `RESETUSERPASSWORD <username> [email]` (issue #2781): uberserver
 * generates a fresh password and emails it to the account, replacing the
 * one it had. `email` is only sent when the account has no valid one on
 * file already, per {@link hasValidEmail}. The confirm step asks for one
 * there instead.
 *
 * A popover holds the confirmation rather than a modal dialog, matching the
 * other lookup actions and the project's drawer/popover preference. It
 * stays open after "Send reset email" so the reply is visible in the same
 * place: `success` renders as plain text (it already names the address),
 * and a refusal renders as an alert, the same wording uberserver used but
 * shown as a refusal rather than as a fact, matching how `AdminRequestStatus`
 * shows a protocol-level refusal (issue #2773). An unanswered request
 * explains the most likely cause: a server with no email account set up
 * throws before sending anything (ScarylePoo/uberserver#58), so coilbox sees
 * silence rather than a refusal.
 */
function ResetPasswordAction({
  username,
  email,
  serverKey,
}: {
  username: string;
  email: string | null;
  serverKey: string;
}) {
  const { t } = useLingui();
  const [newEmail, setNewEmail] = useState("");
  const reset = useAdminRequest(serverKey);
  const known = hasValidEmail(email);
  const canSubmit = known || newEmail.trim() !== "";

  const confirm = () => {
    if (!canSubmit) return;
    void reset.send(
      "RESETUSERPASSWORD",
      known ? [username] : [username, newEmail.trim()],
      "resetUserPassword",
    );
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="h-8">
          <Trans>Reset password…</Trans>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-80 flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-medium">
            <Trans>Email {username} a new password?</Trans>
          </h3>
          <p className="text-xs text-muted-foreground">
            {known
              ? t`uberserver generates a fresh password and replaces ${username}'s current one, then emails the new one to ${email}.`
              : t`uberserver generates a fresh password and replaces ${username}'s current one, then emails the new one to the address below.`}
          </p>
        </div>
        {!known && (
          <span className="flex flex-col gap-1 text-xs text-muted-foreground">
            <Trans>Email address to add</Trans>
            <Input
              value={newEmail}
              onChange={(event) => setNewEmail(event.target.value)}
              placeholder="name@example.com"
              aria-label={t`Email address to add`}
              className="h-8"
              {...identifierFieldProps}
            />
          </span>
        )}
        <div className="flex justify-end">
          <Button
            type="button"
            size="sm"
            className="h-8"
            onClick={confirm}
            disabled={!canSubmit || reset.state.status === "sending"}
          >
            <Trans>Send reset email</Trans>
          </Button>
        </div>
        <AdminRequestStatus
          state={reset.state}
          unanswered={t`The server did not answer. A server with email switched off is the usual cause (a known uberserver bug, ScarylePoo/uberserver#58).`}
        >
          {(reply) =>
            reply.shape === "resetUserPassword" ? (
              reply.success ? (
                <span>{reply.message}</span>
              ) : (
                <Alert variant="destructive">
                  <TriangleAlert />
                  <AlertTitle>
                    <Trans>The server refused</Trans>
                  </AlertTitle>
                  <AlertDescription>{reply.message}</AlertDescription>
                </Alert>
              )
            ) : null
          }
        </AdminRequestStatus>
      </PopoverContent>
    </Popover>
  );
}

function kickedText(username: string, kicked: boolean): string {
  return kicked
    ? t`Kicked ${username} from the server.`
    : t`${username} was not online.`;
}

/** The kick form and its result, for the account currently in view, in a
 * popover beside the other account actions (issue #2918) rather than open on
 * the page. It stays open after Kick so the reply shows in the same place. */
function KickAction({
  username,
  serverKey,
}: {
  username: string;
  serverKey: string;
}) {
  const { t } = useLingui();
  const [reason, setReason] = useState("");
  const kick = useAdminRequest(serverKey);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="h-8">
          <Trans>Kick…</Trans>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-80 flex-col gap-3">
        <h3 className="text-sm font-medium">
          <Trans>Kick {username} from the server?</Trans>
        </h3>
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
            <Trans>Reason (optional)</Trans>
            <Input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={t`reason`}
              aria-label={t`Kick reason`}
              className="h-8"
            />
          </span>
          <Button type="submit" variant="destructive" size="sm" className="h-8">
            <Trans>Kick</Trans>
          </Button>
        </form>
        <AdminRequestStatus state={kick.state}>
          {(reply) =>
            reply.shape === "kick"
              ? kickedText(reply.username, reply.kicked)
              : null
          }
        </AdminRequestStatus>
      </PopoverContent>
    </Popover>
  );
}

/**
 * `DELETEACCOUNT <username>` (issue #2787): admin-only, in uberserver's
 * `restricted['admin']` set like `SETACCESS`, so it sits behind
 * `<AdminOnly>` the same way. It cannot be undone, so the confirm step
 * lists what `in_DELETEACCOUNT` does, in order, and stays disabled until
 * the admin types the account's name: banning its email for 28 days (only
 * when it has one), kicking it, scrubbing it (a fresh password, cleared
 * email, access reset to `user`, bot flag and in-game time cleared), and
 * the scrubbed account's own inactivity rule deleting it 28 days after
 * that with no login.
 *
 * The reply is up to three lines: the email ban, the kick, and the
 * scheduling line, the last from a database callback that can land a
 * moment after the first two. `User <username> does not exist` and `User
 * <username> no longer exists` are shown as a refusal rather than as
 * whichever of the other lines happened to arrive.
 */
function DeleteAccountAction({
  username,
  email,
  serverKey,
}: {
  username: string;
  email: string | null;
  serverKey: string;
}) {
  const { t } = useLingui();
  const [typed, setTyped] = useState("");
  const request = useAdminRequest(serverKey);
  const canSubmit = typed.trim() === username;

  const confirm = () => {
    if (!canSubmit) return;
    void request.send("DELETEACCOUNT", [username], "deleteAccount");
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="destructive" size="sm" className="h-8">
          <Trans>Delete account…</Trans>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-80 flex-col gap-3">
        <h3 className="text-sm font-medium">
          <Trans>Delete {username}?</Trans>
        </h3>
        <p className="text-xs text-muted-foreground">
          <Trans>This cannot be undone:</Trans>
        </p>
        <ul className="list-disc pl-4 text-xs text-muted-foreground">
          {email && (
            <li>
              <Trans>Bans {email} for 28 days.</Trans>
            </li>
          )}
          <li>
            <Trans>Kicks {username} from the server.</Trans>
          </li>
          <li>
            <Trans>
              Sets a new password, clears its email, resets its access to user,
              and clears its bot flag and in-game time.
            </Trans>
          </li>
          <li>
            <Trans>
              With no in-game time left, the server deletes the account 28 days
              after its last login.
            </Trans>
          </li>
        </ul>
        <span className="flex flex-col gap-1 text-xs text-muted-foreground">
          <Trans>Type {username} to confirm</Trans>
          <Input
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            aria-label={t`Type ${username} to confirm`}
            className="h-8"
            {...identifierFieldProps}
          />
        </span>
        <div className="flex justify-end">
          <Button
            type="button"
            variant="destructive"
            size="sm"
            className="h-8"
            onClick={confirm}
            disabled={!canSubmit || request.state.status === "sending"}
          >
            <Trans>Delete account</Trans>
          </Button>
        </div>
        <AdminRequestStatus state={request.state}>
          {(reply) =>
            reply.shape === "deleteAccount" ? (
              reply.refusal ? (
                <Alert variant="destructive">
                  <TriangleAlert />
                  <AlertTitle>
                    <Trans>The server refused</Trans>
                  </AlertTitle>
                  <AlertDescription>{reply.refusal}</AlertDescription>
                </Alert>
              ) : (
                <ul className="flex flex-col gap-1">
                  {reply.banMessage && <li>{reply.banMessage}</li>}
                  {reply.kicked !== null && (
                    <li>
                      {reply.kicked
                        ? t`Kicked ${username} from the server.`
                        : t`${username} was not online.`}
                    </li>
                  )}
                  {reply.scheduled && <li>{reply.scheduled}</li>}
                </ul>
              )
            ) : null
          }
        </AdminRequestStatus>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Opens the Bans tool on the Server admin page with this account's name
 * filled into the `BAN` form (issues #2778 and #2918). Handed off through
 * `?ban=` and `?tool=` rather than a prop, so `PlayerLookupSection` and `BansSection` stay
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
            next.set(TOOL_PARAM, "bans");
            return next;
          },
          { replace: true },
        )
      }
    >
      <Trans>Ban…</Trans>
    </Button>
  );
}

/** A dash placeholder for a field uberserver can write as Python's `None`. */
function dash(value: string | null): string {
  return value ?? t`not known`;
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
  const { t } = useLingui();
  const username = info.username;
  switch (info.kind) {
    case "missing":
      return (
        <p className="text-sm">
          <Trans>No account named "{username}".</Trans>
        </p>
      );
    case "bridgedMissing":
      return (
        <p className="text-sm">
          <Trans>No bridged account named "{username}".</Trans>
        </p>
      );
    case "static":
      return (
        <p className="text-sm">
          <Trans>
            <strong>{username}</strong> is a static account. uberserver keeps no
            further details about it.
          </Trans>
        </p>
      );
    case "bridged": {
      const bridgeUser = dash(info.bridgeUserId);
      return (
        <div className="flex flex-col gap-3">
          <DetailField label={t`Username`} value={info.username} />
          <DetailField
            label={t`Bridge`}
            value={
              info.bridged
                ? t`Bridged in now via ${bridgeUser}`
                : t`Not bridged in now`
            }
          />
          <DetailField label={t`Bridge account ID`} value={info.bridgedId} />
          <DetailField label={t`Last bridged`} value={info.lastBridged} />
          <DetailField label={t`External ID`} value={info.externalId} />
          <DetailField label={t`Location`} value={info.location} />
          <DetailField
            label={t`External username`}
            value={info.externalUsername}
          />
        </div>
      );
    }
    case "account": {
      const sessionId = dash(info.sessionId);
      const hours = info.ingameHours;
      return (
        <article className="flex flex-col gap-6 text-foreground">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
            <div className="flex flex-col">
              <h3 className="text-base font-semibold">{info.username}</h3>
              <p className="text-sm text-muted-foreground">
                {info.online ? t`Online (session ${sessionId})` : t`Offline`}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <ResetPasswordAction
                username={info.username}
                email={info.email}
                serverKey={serverKey}
              />
              <KickAction username={info.username} serverKey={serverKey} />
              <BanAction username={info.username} />
              <AdminOnly>
                <SetAccessAction
                  username={info.username}
                  serverKey={serverKey}
                  onChanged={() => onPickName(info.username)}
                />
              </AdminOnly>
              <AdminOnly>
                <DeleteAccountAction
                  username={info.username}
                  email={info.email}
                  serverKey={serverKey}
                />
              </AdminOnly>
            </div>
          </header>

          <ToolGroup title={t`Account`}>
            <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              <DetailField label={t`User ID`} value={info.userId} />
              <DetailField label={t`Access level`} value={info.access} />
              <DetailField label={t`Registered`} value={info.registered} />
              <DetailField label={t`Last login`} value={info.lastLogin} />
              <DetailField label={t`In-game time`} value={t`${hours} hours`} />
              <DetailField label={t`Client agent`} value={dash(info.agent)} />
            </div>
            <BotFlagAction
              username={info.username}
              bot={info.bot}
              serverKey={serverKey}
              onChanged={() => onPickName(info.username)}
            />
          </ToolGroup>

          <ToolGroup title={t`Contact and network`}>
            <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              <DetailField label={t`Email`} value={dash(info.email)} />
              <DetailField label={t`Last IP`} value={dash(info.lastIp)} />
              <DetailField
                label={t`Last hardware ID`}
                value={dash(info.lastMacId)}
              />
              <DetailField
                label={t`Last system ID`}
                value={dash(info.lastSysId)}
              />
            </div>
            {info.lastIp && (
              <div className="flex flex-col gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 self-start"
                  onClick={() => info.lastIp && onFindIp(info.lastIp)}
                >
                  <Trans>Find other accounts on this IP</Trans>
                </Button>
                {ipSearch.state.status !== "idle" && (
                  <IpSearchResults state={ipSearch.state} onPick={onPickName} />
                )}
              </div>
            )}
          </ToolGroup>
        </article>
      );
    }
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
 *
 * On the Server admin page it is the Players tool (issue #2918), with Look up
 * as its one primary action and the account actions beside the account.
 */
export function PlayerLookupSection({ serverKey }: { serverKey: string }) {
  const { t } = useLingui();
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
    <section className="flex flex-col gap-6">
      <ToolHeader
        title={t`Player lookup`}
        description={t`An account's details, the IP it last used, and the other accounts seen on that IP.`}
      />
      <form
        className="flex max-w-md items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          runLookup(name);
        }}
      >
        <span className="flex flex-1 flex-col gap-1 text-sm">
          <label htmlFor="player-lookup-name" className="font-medium">
            <Trans>Player name</Trans>
          </label>
          <Input
            id="player-lookup-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t`Username`}
            {...identifierFieldProps}
          />
        </span>
        <Button type="submit" disabled={!name.trim()}>
          <Trans>Look up</Trans>
        </Button>
      </form>

      <AdminRequestStatus state={lookup.state}>
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
