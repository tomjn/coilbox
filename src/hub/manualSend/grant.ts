import { defineCommand } from "@picoframe/plugin-sdk";

/**
 * The one game or map a manual send is for, as `consent::SendSubject` reads it.
 * A game is named by its modinfo shortname and a map by its full name.
 */
export type SendSubject =
  | { kind: "game"; shortname: string }
  | { kind: "map"; map_name: string };

const hubManualSendBegin = defineCommand<
  { subject: SendSubject },
  { grant: string }
>("coilbox-hub", "hub_manual_send_begin");

const hubManualSendEnd = defineCommand<
  { grant: string },
  Record<string, never>
>("coilbox-hub", "hub_manual_send_end");

/**
 * Open a grant for one send somebody pressed "Send to hub" for. Pressing it is
 * the agreement, so the uploads switch is not consulted. Rejects when the
 * distribution profile has turned sending off.
 */
export async function beginManualSend(subject: SendSubject): Promise<string> {
  const { grant } = await hubManualSendBegin({ subject });
  return grant;
}

const hubEngineSendBegin = defineCommand<
  { subject: { kind: "engine"; filename: string } },
  { grant: string }
>("coilbox-hub", "hub_manual_send_begin");

/**
 * Open a grant for one engine build somebody pressed upload for, named by its
 * archive's file name. The uploads switch never admits an engine, so this grant
 * is the only way one is sent.
 */
export async function beginEngineSend(filename: string): Promise<string> {
  const { grant } = await hubEngineSendBegin({
    subject: { kind: "engine", filename },
  });
  return grant;
}

const hubReplaySendBegin = defineCommand<
  { subject: { kind: "replay"; game_id: string } },
  { grant: string }
>("coilbox-hub", "hub_manual_send_begin");

/**
 * Open a grant for one replay somebody pressed send for, named by its game id.
 * The uploads switch never admits a replay, so this grant is the only way one
 * is sent.
 */
export async function beginReplaySend(gameId: string): Promise<string> {
  const { grant } = await hubReplaySendBegin({
    subject: { kind: "replay", game_id: gameId },
  });
  return grant;
}

/** Close a grant, however its send ended. */
export async function endManualSend(grant: string): Promise<void> {
  await hubManualSendEnd({ grant });
}
