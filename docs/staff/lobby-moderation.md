# Lobby moderation

This page is for channel operators and server moderators. It covers the moderation controls on coilbox's Chat page. For the Chat page itself, the member list and the menu on each member's row, see [Sign in and chat](../players/lobby-and-chat.md#chat).

You find the controls in two places:

- The menu at the end of a member's row, in a channel's member list. Select Toggle members at the top of the channel to show the list.
- Set channel topic, the pencil button at the top of the channel, beside Toggle members.

The commands are those of uberserver lobby servers. Other servers may refuse some of them.

## Who sees the controls

Everybody gets Add private note and Ignore in a member's menu. The moderation actions sit under those, in two groups.

- Channel. You see these in a channel where you are the founder or an operator. A server moderator sees them in every channel.
- Moderator. Only a server moderator sees these.

Coilbox asks ChanServ who runs a channel when you open it, so the Channel group can take a moment to appear.

The controls never show on your own row, in direct messages or in battle chat. If you hold neither role, you see no moderation actions and no Set channel topic.

## Channel actions

These act on one channel only. ChanServ carries them out and answers in a direct message from ChanServ, listed under Direct messages.

- Make operator gives the player operator rights in this channel. Only the channel's founder or a server moderator can do this. ChanServ refuses an operator who tries.
- Remove operator takes those rights away. It shows instead of Make operator when the player is already an operator. Nobody can remove the founder.
- Mute stops the player talking in this channel for the time you set. Type a Duration and a Reason, then select Confirm. Confirm stays greyed out until you type a reason.
- Unmute lets a muted player talk again.
- Kick from channel removes the player from this channel straight away. They can join again.
- Ban from channel removes the player and stops them joining again for the time you set. It also bans the address they last connected from. Type a Duration and a Reason, then select Confirm. Confirm stays greyed out until you type a reason.
- Unban from channel lifts a channel ban.

ChanServ will not mute, kick or ban another operator. Remove their operator rights first.

### Set the topic

1. Select Set channel topic, the pencil at the top of the channel.
2. Change the text under Channel topic. It starts with the current topic.
3. Select Set topic.

## Moderator actions

These act on the player's whole account, across the server.

- Look up in Server admin opens the Server admin page at the player's details, with their name filled in. See [Server admin](server-admin.md#the-tools) for what it shows. It only shows on uberserver servers, because the Server admin page only opens there.
- Get IP asks the server for the address the player is connected from, or last connected from.
- Get user ID asks the server for the player's hardware and system IDs. Use them to spot one person on two accounts.
- Kick from server disconnects the player, and takes them out of any battle they are in. They see your reason in a message box and can log in again. Type a Reason, then select Confirm.
- Ban from server stops the player logging in for the number of days you set. It also bans their last address and their email, and disconnects them if they are online. Other moderators see the ban announced. Type the Days and a Reason, then select Confirm. Confirm stays greyed out until you type a reason.

The server's answer to Get IP, Get user ID and the kick and ban actions shows as a notice titled Server message.

The menu has no way to lift a server ban. Use Bans on the [Server admin](server-admin.md#the-tools) page.

## How long a mute or ban lasts

A channel mute and a channel ban take a length of time:

- `10m` is 10 minutes.
- `2h` is 2 hours.
- `3d` is 3 days.
- `1w` is 1 week.
- A number on its own, such as `30`, is that many minutes.
- `0` means it never ends.

A mute starts at `10m` and a channel ban at `1d` unless you change it.

A server ban takes a number of days, not a length of time. Type `7` for a week, or `0.5` for 12 hours. Do not add a letter. The server refuses `7d`. The Days field starts at `1`.

## The commands behind each action

If you also moderate by typing commands, these are the lines coilbox sends. `chan` is the channel name without the `#`, and `name` is the player.

| Action | Command |
| --- | --- |
| Make operator | `SAYPRIVATE ChanServ :op chan name` |
| Remove operator | `SAYPRIVATE ChanServ :deop chan name` |
| Mute | `SAYPRIVATE ChanServ :mute chan name 10m reason` |
| Unmute | `SAYPRIVATE ChanServ :unmute chan name` |
| Kick from channel | `SAYPRIVATE ChanServ :kick chan name` |
| Ban from channel | `SAYPRIVATE ChanServ :ban chan name 1d reason` |
| Unban from channel | `SAYPRIVATE ChanServ :unban chan name` |
| Set topic | `SAYPRIVATE ChanServ :topic chan text` |
| Get IP | `GETIP name` |
| Get user ID | `GETUSERID name` |
| Kick from server | `KICK name reason` |
| Ban from server | `BAN name 1 reason` |
