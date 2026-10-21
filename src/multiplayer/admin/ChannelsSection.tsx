import { t } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button, Input } from "@picoframe/frame";
import { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { identifierFieldProps } from "@/lib/identifierField";
import type {
  AdminReply,
  AdminShape,
  ChannelBanEntry,
  ChannelMuteEntry,
} from "../bindings";
import {
  normalizeChannelList,
  type StoredChannel,
  useJoinedChannels,
} from "../channels";
import { chanServChannel } from "../moderation";
import { useConnection } from "../store";
import { AdminRequestStatus } from "./AdminRequestStatus";
import { useAdminRequest } from "./adminRequest";
import { ToolGroup, ToolHeader } from "./ToolHeader";

/** Battle rooms are channels too, but ChanServ is not for them. */
const BATTLE_ROOM = "__battle__";

/**
 * The channels worth offering on one server: its autojoin list from
 * `channels.ts` and the channels the connection is in now, without battle
 * rooms, sorted. Pure.
 */
export function knownChannels(
  autojoin: StoredChannel[] | undefined,
  joined: string[],
): string[] {
  const names = new Set<string>();
  for (const { name } of normalizeChannelList(autojoin)) names.add(name);
  for (const name of joined) names.add(name);
  return [...names]
    .filter((name) => !name.startsWith(BATTLE_ROOM))
    .sort((a, b) => a.localeCompare(b));
}

function settingText(reply: AdminReply) {
  switch (reply.shape) {
    case "registerChannel": {
      const { channel, founder } = reply;
      return t`#${channel} is registered to ${founder}.`;
    }
    case "unregisterChannel": {
      const { channel } = reply;
      return t`#${channel} is no longer registered.`;
    }
    case "channelHistory": {
      const { channel } = reply;
      return reply.on
        ? t`History is on for #${channel}.`
        : t`History is off for #${channel}.`;
    }
    case "channelAntispam": {
      const { channel } = reply;
      return reply.on
        ? t`Antispam is on for #${channel}.`
        : t`Antispam is off for #${channel}.`;
    }
    default:
      return null;
  }
}

/** The channel's real history and antispam state, from ChanServ's `:info`. */
function infoText(reply: AdminReply) {
  if (reply.shape !== "channelInfo") return null;
  const { channel } = reply;
  if (reply.historyOn) {
    return reply.antispamOn
      ? t`Currently, history is on and antispam is on for #${channel}.`
      : t`Currently, history is on and antispam is off for #${channel}.`;
  }
  return reply.antispamOn
    ? t`Currently, history is off and antispam is on for #${channel}.`
    : t`Currently, history is off and antispam is off for #${channel}.`;
}

function BansTable({
  entries,
  onLift,
  disabled,
}: {
  entries: ChannelBanEntry[];
  onLift: (username: string) => void;
  disabled: boolean;
}) {
  const { t } = useLingui();
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>
            <Trans>Username</Trans>
          </TableHead>
          <TableHead>
            <Trans>IP</Trans>
          </TableHead>
          <TableHead>
            <Trans>Reason</Trans>
          </TableHead>
          <TableHead>
            <Trans>Ends</Trans>
          </TableHead>
          <TableHead>
            <Trans>Issuer</Trans>
          </TableHead>
          <TableHead>
            <span className="sr-only">
              <Trans>Actions</Trans>
            </span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map((entry) => {
          const username = entry.username;
          return (
            <TableRow key={`${entry.username}-${entry.ends}`}>
              <TableCell>{entry.username}</TableCell>
              <TableCell>{entry.ip ?? "-"}</TableCell>
              <TableCell className="whitespace-normal">
                {entry.reason}
              </TableCell>
              <TableCell className="whitespace-normal">{entry.ends}</TableCell>
              <TableCell>{entry.issuer}</TableCell>
              <TableCell className="text-right">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7"
                  disabled={disabled}
                  aria-label={t`Unban ${username}`}
                  onClick={() => onLift(entry.username)}
                >
                  <Trans>Unban</Trans>
                </Button>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function MutesTable({
  entries,
  onLift,
  disabled,
}: {
  entries: ChannelMuteEntry[];
  onLift: (username: string) => void;
  disabled: boolean;
}) {
  const { t } = useLingui();
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>
            <Trans>Username</Trans>
          </TableHead>
          <TableHead>
            <Trans>Reason</Trans>
          </TableHead>
          <TableHead>
            <Trans>Ends</Trans>
          </TableHead>
          <TableHead>
            <Trans>Issuer</Trans>
          </TableHead>
          <TableHead>
            <span className="sr-only">
              <Trans>Actions</Trans>
            </span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map((entry) => {
          const username = entry.username;
          return (
            <TableRow key={`${entry.username}-${entry.ends}`}>
              <TableCell>{entry.username}</TableCell>
              <TableCell className="whitespace-normal">
                {entry.reason}
              </TableCell>
              <TableCell className="whitespace-normal">{entry.ends}</TableCell>
              <TableCell>{entry.issuer}</TableCell>
              <TableCell className="text-right">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7"
                  disabled={disabled}
                  aria-label={t`Unmute ${username}`}
                  onClick={() => onLift(entry.username)}
                >
                  <Trans>Unmute</Trans>
                </Button>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function listView(
  reply: AdminReply,
  channel: string,
  onLiftBan: (username: string) => void,
  onLiftMute: (username: string) => void,
  disabled: boolean,
) {
  if (reply.shape === "channelBanList") {
    return reply.entries.length === 0 ? (
      <span>
        <Trans>No one is banned from #{channel}.</Trans>
      </span>
    ) : (
      <BansTable
        entries={reply.entries}
        onLift={onLiftBan}
        disabled={disabled}
      />
    );
  }
  if (reply.shape === "channelMuteList") {
    return reply.entries.length === 0 ? (
      <span>
        <Trans>No one is muted in #{channel}.</Trans>
      </span>
    ) : (
      <MutesTable
        entries={reply.entries}
        onLift={onLiftMute}
        disabled={disabled}
      />
    );
  }
  return null;
}

/**
 * Channel tools that go through ChanServ (issue #2782): register and
 * unregister a channel, switch its stored history and antispam, and list its
 * bans and mutes. ChanServ answers in private messages, which the admin queue
 * in `admin_command.rs` claims so they never show in the ChanServ chat.
 *
 * None of these takes a duration. Timed channel mutes and bans stay in the
 * chat member menu, with their ChanServ span field (`10m`, `2h`), which is a
 * separate input from the server-wide `DaysField` (issue #2774).
 *
 * Issue #2923 added a row action to lift a ban or mute straight from its
 * list entry, and reads the channel's real history and antispam state from
 * `:info <chan>` whenever the channel changes, rather than leaving the
 * on/off buttons to be set blind. `:info` is asked again after a history or
 * antispam change answers, so the reading always reflects what the server
 * just did.
 */
export function ChannelsSection({ serverKey }: { serverKey: string }) {
  const { t } = useLingui();
  const [typed, setTyped] = useState("");
  const [founder, setFounder] = useState("");
  const [listed, setListed] = useState("");
  const [autojoin] = useJoinedChannels();
  const connection = useConnection(serverKey);
  const setting = useAdminRequest(serverKey);
  const list = useAdminRequest(serverKey);
  const info = useAdminRequest(serverKey);
  const unban = useAdminRequest(serverKey);
  const unmute = useAdminRequest(serverKey);

  const channel = chanServChannel(typed);
  const suggestions = knownChannels(
    autojoin[serverKey],
    Object.keys(connection?.mirror.state?.channels ?? {}),
  );
  const none = channel === "";

  // ChanServ's `:info` names the channel's real history and antispam state
  // (issue #2923). Asked for once the channel field settles, either a pick
  // from the suggestions or leaving the typed field, rather than once per
  // keystroke while a name is still being typed.
  const loadInfo = (name: string) => {
    if (name === "") return;
    void info.send("info", [name], "channelInfo");
  };

  const change = (command: string, args: string[], shape: AdminShape) => {
    void setting.send(command, [channel, ...args], shape).then((state) => {
      if (
        state.status === "answered" &&
        (shape === "channelHistory" || shape === "channelAntispam")
      ) {
        loadInfo(channel);
      }
    });
  };
  const show = (command: string, shape: AdminShape) => {
    setListed(channel);
    void list.send(command, [channel], shape);
  };
  const refreshList = (command: string, shape: AdminShape) => {
    void list.send(command, [listed], shape);
  };
  const liftBan = (username: string) => {
    void unban
      .send("unban", [listed, username], "channelUnban")
      .then((state) => {
        if (state.status === "answered")
          refreshList("listbans", "channelBanList");
      });
  };
  const liftMute = (username: string) => {
    void unmute
      .send("unmute", [listed, username], "channelUnmute")
      .then((state) => {
        if (state.status === "answered")
          refreshList("listmutes", "channelMuteList");
      });
  };
  const lifting =
    unban.state.status === "sending" || unmute.state.status === "sending";

  const onOff = (
    label: string,
    onLabel: string,
    offLabel: string,
    command: string,
    shape: AdminShape,
  ) => (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-20 text-sm">{label}</span>
      <Button
        size="sm"
        variant="outline"
        className="h-8"
        disabled={none}
        onClick={() => change(command, ["on"], shape)}
      >
        {onLabel}
      </Button>
      <Button
        size="sm"
        variant="outline"
        className="h-8"
        disabled={none}
        onClick={() => change(command, ["off"], shape)}
      >
        {offLabel}
      </Button>
    </div>
  );

  return (
    <section className="flex flex-col gap-6">
      <ToolHeader
        title={t`Channels`}
        description={t`ChanServ's tools for one channel. Timed channel bans and mutes are in the chat member menu.`}
      />

      <div className="flex max-w-md flex-col gap-2">
        <span className="flex flex-col gap-1 text-sm font-medium">
          <Trans>Channel</Trans>
          <Input
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            onBlur={() => loadInfo(channel)}
            placeholder="main"
            aria-label={t`Channel`}
            {...identifierFieldProps}
          />
        </span>
        {suggestions.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {suggestions.map((name) => (
              <Button
                key={name}
                size="sm"
                variant="ghost"
                className="h-7"
                onClick={() => {
                  setTyped(name);
                  loadInfo(name);
                }}
              >
                #{name}
              </Button>
            ))}
          </div>
        )}
      </div>

      <ToolGroup title={t`Bans and mutes`}>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            className="h-8"
            disabled={none}
            onClick={() => show("listbans", "channelBanList")}
          >
            <Trans>Show bans</Trans>
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8"
            disabled={none}
            onClick={() => show("listmutes", "channelMuteList")}
          >
            <Trans>Show mutes</Trans>
          </Button>
        </div>
        <AdminRequestStatus state={list.state}>
          {(reply) => listView(reply, listed, liftBan, liftMute, lifting)}
        </AdminRequestStatus>
        <AdminRequestStatus state={unban.state}>
          {(reply) => {
            if (reply.shape !== "channelUnban") return null;
            const { username, channel } = reply;
            return t`${username} was unbanned from #${channel}.`;
          }}
        </AdminRequestStatus>
        <AdminRequestStatus state={unmute.state}>
          {(reply) => {
            if (reply.shape !== "channelUnmute") return null;
            const { username, channel } = reply;
            return t`${username} was unmuted in #${channel}.`;
          }}
        </AdminRequestStatus>
      </ToolGroup>

      <ToolGroup
        title={t`Registration and settings`}
        description={t`A registered channel has a founder, and ChanServ keeps its operators, bans, mutes and settings. Someone has to be in the channel to register it. With history on, the server stores the channel's messages and deletes them after 14 days.`}
      >
        <div className="flex max-w-md flex-wrap items-end gap-2">
          <span className="flex min-w-40 flex-1 flex-col gap-1 text-xs text-muted-foreground">
            <Trans>Founder (optional, defaults to you)</Trans>
            <Input
              value={founder}
              onChange={(event) => setFounder(event.target.value)}
              aria-label={t`Founder`}
              className="h-8"
              {...identifierFieldProps}
            />
          </span>
          <Button
            size="sm"
            variant="outline"
            className="h-8"
            disabled={none}
            onClick={() => {
              const name = founder.trim();
              change("register", name ? [name] : [], "registerChannel");
            }}
          >
            <Trans>Register</Trans>
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8"
            disabled={none}
            onClick={() => change("unregister", [], "unregisterChannel")}
          >
            <Trans>Unregister</Trans>
          </Button>
        </div>
        <AdminRequestStatus state={info.state}>
          {(reply) => infoText(reply)}
        </AdminRequestStatus>
        {onOff(
          t`History`,
          t`History on`,
          t`History off`,
          "history",
          "channelHistory",
        )}
        {onOff(
          t`Antispam`,
          t`Antispam on`,
          t`Antispam off`,
          "antispam",
          "channelAntispam",
        )}
        <AdminRequestStatus state={setting.state}>
          {(reply) => settingText(reply)}
        </AdminRequestStatus>
      </ToolGroup>
    </section>
  );
}
