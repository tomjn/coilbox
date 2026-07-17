# Lobby moderation controls

Coilbox exposes ChanServ channel-operator actions and server-moderator actions directly from the chat UI, gated so the controls only appear to users who actually hold the privilege. This is the coilbox side of issue #203; the wire commands target an uberserver/TASServer-style lobby (the reference is `~/dev/uberserver`).

## Where the controls appear

- **Per-member `⋮` menu** in a channel's member panel (open the members panel from the chat header). One menu per other member, with the actions the current user is allowed to run.
- **Channel topic control** (pencil icon) in the channel header, for channel operators.

Nothing is shown on your own row, in DMs, or in battle-room chat.

## Who sees what

Two independent privilege sources decide which sections render:

- **Server moderator** — the account's `access` status bit (uberserver `mod`/ `admin`). A server moderator sees both the moderator actions and the ChanServ channel actions in every channel.
- **Channel operator** — the channel's registered founder or an operator. This is learned by querying ChanServ `:info <channel>` automatically when a channel is opened; the reply is parsed into the channel's `founder`/`operators` (and the reply itself is suppressed from chat, so there's no visible noise). A founder/ operator who is not a server moderator sees only the ChanServ channel actions.

If you are neither, no menu or topic control renders for that channel.

> Note: the `access` bit does not distinguish `mod` from `admin`, so a strictly
> admin-only verb (e.g. `BROADCAST`, `SETACCESS`) can't be gated precisely from
> client state alone. Those are intentionally not surfaced here yet.

## Actions and the commands they send

Every action is sent as a raw wire line via `mp_send` (which, unlike `mp_say_private`, records nothing locally — so your commands don't clutter the ChanServ DM; ChanServ's replies still arrive as feedback).

ChanServ channel actions (private message to `ChanServ`, colon-prefixed, channel as the first argument):

| Action | Wire |
| --- | --- |
| Make / remove operator | `SAYPRIVATE ChanServ :op <chan> <nick>` / `:deop …` |
| Kick from channel | `SAYPRIVATE ChanServ :kick <chan> <nick>` |
| Mute / unmute | `:mute <chan> <nick> <duration> <reason>` / `:unmute …` |
| Ban / unban | `:ban <chan> <nick> <duration> <reason>` / `:unban …` |
| Set topic | `:topic <chan> <text>` |
| (background) learn ops | `:info <chan>` |

Server-moderator actions (first-class protocol verbs, gated by server access):

| Action | Wire |
| --- | --- |
| Get IP | `GETIP <nick>` |
| Get user ID | `GETUSERID <nick>` |
| Kick from server | `KICK <nick> <reason>` |
| Ban from server | `BAN <nick> <duration> <reason>` |

`<duration>` uses ChanServ/uberserver spans like `10m`, `2h`, `3d`.

## Implementation notes

- The `:info` reply is parsed in the protocol crate (`crates/coilbox-lobby-protocol/src/reduce.rs`, `parse_chanserv_info`) and folds into `ChannelState.founder`/`operators`. The reference server's operator-list formatting is buggy for multiple operators (it can emit `[bob] carol]`); the parser is robust to both that and the clean form.
- Command builders and the `canChannelModerate` gate live in `src/multiplayer/moderation.ts` (pure, unit-tested). The UI is `src/multiplayer/chat/MemberActionsMenu.tsx` and `ChannelTopicMenu.tsx`, wired in `src/multiplayer/pages/ChatPage.tsx`.
- No new Tauri commands or ACL entries: outgoing actions reuse the existing `mp_send`, and the new channel state rides the standard snapshot refresh.
