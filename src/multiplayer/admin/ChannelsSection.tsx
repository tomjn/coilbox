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
    case "registerChannel":
      return `#${reply.channel} is registered to ${reply.founder}.`;
    case "unregisterChannel":
      return `#${reply.channel} is no longer registered.`;
    case "channelHistory":
      return `History is ${reply.on ? "on" : "off"} for #${reply.channel}.`;
    case "channelAntispam":
      return `Antispam is ${reply.on ? "on" : "off"} for #${reply.channel}.`;
    default:
      return null;
  }
}

function BansTable({ entries }: { entries: ChannelBanEntry[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Username</TableHead>
          <TableHead>IP</TableHead>
          <TableHead>Reason</TableHead>
          <TableHead>Ends</TableHead>
          <TableHead>Issuer</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map((entry) => (
          <TableRow key={`${entry.username}-${entry.ends}`}>
            <TableCell>{entry.username}</TableCell>
            <TableCell>{entry.ip ?? "-"}</TableCell>
            <TableCell className="whitespace-normal">{entry.reason}</TableCell>
            <TableCell className="whitespace-normal">{entry.ends}</TableCell>
            <TableCell>{entry.issuer}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function MutesTable({ entries }: { entries: ChannelMuteEntry[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Username</TableHead>
          <TableHead>Reason</TableHead>
          <TableHead>Ends</TableHead>
          <TableHead>Issuer</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map((entry) => (
          <TableRow key={`${entry.username}-${entry.ends}`}>
            <TableCell>{entry.username}</TableCell>
            <TableCell className="whitespace-normal">{entry.reason}</TableCell>
            <TableCell className="whitespace-normal">{entry.ends}</TableCell>
            <TableCell>{entry.issuer}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function listView(reply: AdminReply, channel: string) {
  if (reply.shape === "channelBanList") {
    return reply.entries.length === 0 ? (
      <span>No one is banned from #{channel}.</span>
    ) : (
      <BansTable entries={reply.entries} />
    );
  }
  if (reply.shape === "channelMuteList") {
    return reply.entries.length === 0 ? (
      <span>No one is muted in #{channel}.</span>
    ) : (
      <MutesTable entries={reply.entries} />
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
 */
export function ChannelsSection({ serverKey }: { serverKey: string }) {
  const [typed, setTyped] = useState("");
  const [founder, setFounder] = useState("");
  const [listed, setListed] = useState("");
  const [autojoin] = useJoinedChannels();
  const connection = useConnection(serverKey);
  const setting = useAdminRequest(serverKey);
  const list = useAdminRequest(serverKey);

  const channel = chanServChannel(typed);
  const suggestions = knownChannels(
    autojoin[serverKey],
    Object.keys(connection?.mirror.state?.channels ?? {}),
  );
  const none = channel === "";

  const change = (command: string, args: string[], shape: AdminShape) => {
    void setting.send(command, [channel, ...args], shape);
  };
  const show = (command: string, shape: AdminShape) => {
    setListed(channel);
    void list.send(command, [channel], shape);
  };

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-base font-semibold">Channels</h2>
      <div className="flex flex-col gap-2 rounded border border-border p-3">
        <span className="flex flex-col gap-1 text-xs text-muted-foreground">
          Channel
          <Input
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            placeholder="main"
            aria-label="Channel"
            className="h-8"
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
                onClick={() => setTyped(name)}
              >
                #{name}
              </Button>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2 rounded border border-border p-3">
        <h3 className="text-sm font-medium">Registration</h3>
        <p className="text-xs text-muted-foreground">
          A registered channel has a founder, and ChanServ keeps its operators,
          bans, mutes and settings. Someone has to be in the channel to register
          it.
        </p>
        <span className="flex flex-col gap-1 text-xs text-muted-foreground">
          Founder (optional, defaults to you)
          <Input
            value={founder}
            onChange={(event) => setFounder(event.target.value)}
            aria-label="Founder"
            className="h-8"
            {...identifierFieldProps}
          />
        </span>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            className="h-8"
            disabled={none}
            onClick={() => {
              const name = founder.trim();
              change("register", name ? [name] : [], "registerChannel");
            }}
          >
            Register
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8"
            disabled={none}
            onClick={() => change("unregister", [], "unregisterChannel")}
          >
            Unregister
          </Button>
        </div>

        <h3 className="mt-2 text-sm font-medium">Settings</h3>
        <p className="text-xs text-muted-foreground">
          With history on, the server stores the channel's messages and deletes
          them after 14 days.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-8"
            disabled={none}
            onClick={() => change("history", ["on"], "channelHistory")}
          >
            History on
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8"
            disabled={none}
            onClick={() => change("history", ["off"], "channelHistory")}
          >
            History off
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8"
            disabled={none}
            onClick={() => change("antispam", ["on"], "channelAntispam")}
          >
            Antispam on
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8"
            disabled={none}
            onClick={() => change("antispam", ["off"], "channelAntispam")}
          >
            Antispam off
          </Button>
        </div>
        <AdminRequestStatus state={setting.state}>
          {(reply) => settingText(reply)}
        </AdminRequestStatus>
      </div>

      <div className="flex flex-col gap-2 rounded border border-border p-3">
        <h3 className="text-sm font-medium">Bans and mutes</h3>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-8"
            disabled={none}
            onClick={() => show("listbans", "channelBanList")}
          >
            Show bans
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8"
            disabled={none}
            onClick={() => show("listmutes", "channelMuteList")}
          >
            Show mutes
          </Button>
        </div>
        <AdminRequestStatus state={list.state}>
          {(reply) => listView(reply, listed)}
        </AdminRequestStatus>
      </div>
    </section>
  );
}
