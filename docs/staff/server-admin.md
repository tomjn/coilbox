# Server admin

The **Server admin** page (`#/admin`, issue #2772) is where a moderator or admin runs an uberserver lobby's moderation and admin commands from inside Coilbox, instead of typing them into chat.

## Who sees the page

The page only shows once a connected account is a moderator or admin on the server, and only for a server that's uberserver, never Teiserver or Zero-K. If you're not signed in as staff anywhere, opening the page just tells you so and offers a way to connect.

Some tools go further and are **admin only**: Maintenance, Staff and Announcements. A moderator who isn't also an admin doesn't see these in the tool list at all, rather than seeing them and being refused.

## Why it's uberserver only

The commands this page sends, `BAN`, `KICK`, `SETACCESS` and the rest, are uberserver's own admin protocol. Teiserver and Zero-K's servers don't answer them the same way, so Coilbox only offers the page on a connection it can tell is uberserver.

Both uberserver and Teiserver speak the same wire protocol (`tasserver`), so Coilbox tells them apart another way. At login, Teiserver advertises a `teiserver` flag among its capabilities, and uberserver never does. A connection reads as uberserver until something proves otherwise.

## The tools

The page lists tools down the left, one open at a time, acting on whichever connected server you pick if you're staff on more than one.

- **Players**: look up an account's details (email, last IP, hardware and system IDs), find other accounts seen on the same IP, and kick the account.
- **Bans**: the current ban list, with actions to ban an account, ban a specific username, IP or email, and lift a ban.
- **Email domains**: the blocked domain list, with actions to block a domain from registering and unblock one.
- **Channels**: register or unregister a channel, switch its stored history and antispam on or off, and list (and lift) its bans and mutes. These go through ChanServ rather than the server directly.
- **Bots**: create a bot-flagged account from an existing one's password. To flag or unflag an account that already exists, use Players instead. uberserver has no command to list bot accounts, so this tool is only for creating new ones.
- **Staff activity**: a read-only feed of ChanServ's announcements in `#moderator`. It only shows what arrives while Coilbox stays connected. `#moderator` keeps no history unless a moderator has already turned it on, which isn't the default, and even then the feed only reaches back as far as the 14 days of history uberserver keeps.
- **Server**: the address the server hands players for battles they host. Admins can also make the server look the address up again. Battles already open have to be rehosted for it to take effect.
- **Maintenance** (admin only): the four server-wide admin jobs. Set the minimum engine version bot-hosted battles may use, print stats to the server log, reload the server, and run its consistency cleanup.
- **Staff** (admin only): the list of every moderator and admin, and the action to move an account between `user`, `mod` and `admin`.
- **Announcements** (admin only): the three ways to message everyone at once. A broadcast, a broadcast that opens as a dialog for the recipient, and one that echoes back to you as confirmation.

## What uberserver cleans up by itself

uberserver runs its own maintenance on a schedule, independent of anything staff do in Coilbox or anywhere else. None of this can be changed from a client.

- An account still at the `agreement` level (registered but not yet confirmed) is deleted 3 days after registering.
- An account with no in-game time is deleted after 28 days without a login. Bots, moderators and admins are exempt.
- Every account is deleted after 1825 days (5 years) without a login, with no exemptions.
- The bot flag, and moderator or admin level, are removed from an account after 365 days without a login.
- Stored channel history older than 14 days is deleted.
- A session logged in for more than 14 days is logged out. Bots and static accounts are exempt.

## What no client can do

A few things aren't commands at all, whatever access level you hold.

- Create the first admin, or set an account to the `fresh` or `agreement` levels. Those need a direct change to the server's database. `SETACCESS` only accepts `user`, `mod` and `admin`.
- Change a ban's reason or length. The only way to change either is to lift the ban and ban again.
- Show staff actions from before you connected, unless a moderator has already turned on `#moderator` history. It isn't on by default, and even then the feed only covers the last 14 days uberserver keeps.
