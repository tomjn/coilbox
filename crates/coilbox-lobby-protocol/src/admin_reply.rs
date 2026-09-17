//! uberserver's answers to moderator and admin commands, read line by line.
//!
//! Most of these commands are answered with `SERVERMSG` lines written for a
//! person, with no reply token and nothing to say where the answer ends. So a
//! line can only be read as an answer by somebody who knows which command is
//! waiting on one. [`AdminCollector`] is that reader: it is told the shape the
//! waiting command expects and is handed each `SERVERMSG` text in turn.
//!
//! It lives beside the reducer rather than inside it. [`crate::reduce`] reads
//! every line the same way whatever was asked, and `account_info_from` can
//! only do that because its three labels mean one thing. Here the same line
//! (`User <x> does not exist`) answers several commands, so the reading has to
//! start from the command.
//!
//! Refusals are not read here. `<COMMAND> failed. <reason>` is uberserver's
//! wording, and this crate leaves refusal wording to the plugin
//! (`tauri_plugin_coilbox_multiplayer::uberserver`).
//!
//! Every fixture in the tests is built from the format string in uberserver's
//! `protocol/Protocol.py`, named by the handler that writes it.

use serde::{Deserialize, Serialize};

/// The reply a command is waiting for.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AdminShape {
    /// `LISTBANS`: a bracketed list, or `Banlist is empty`.
    BanList,
    /// `LISTBLACKLIST`: a bracketed list, or `Blacklist is empty`.
    Blacklist,
    /// `GETUSERINFO <name>`: a fixed run of lines that depends on the account.
    UserInfo,
    /// `GETIP <name>`: one line, or nothing when no address is known.
    IpLookup,
    /// `FINDIP <address>`: one line per account, with no end marker, or
    /// nothing when no account matches. Only the wait running out ends it.
    IpSearch,
    /// `SETBOTMODE <name> <mode>`: one line, or nothing for a missing user.
    BotMode,
    /// `CREATEBOTACCOUNT <newname> <fromuser> [founder]`: one line on
    /// success. A refusal arrives as a tagged `FAILED` instead, read
    /// generically by the plugin, never by this collector.
    CreateBotAccount,
    /// `KICK <name> [reason]`: one line, `Kicked <name> from the server` or
    /// `User <name> was not online`.
    Kick,
    /// `BAN <username> <days> <reason>`: one line, `Successfully banned
    /// <name>, <ip>, <email> for <days> days.` or an error such as
    /// `Unable to ban <name>, user doesn't exist`.
    Ban,
    /// `BANSPECIFIC <target> <days> <reason>`: one line, `Successfully
    /// banned <target> for <days> days` (no full stop, unlike `BAN`) or an
    /// error such as `Unable to match '<target>' to username/ip/email`.
    BanSpecific,
    /// `UNBAN <target>`: one line, `Successfully removed <n> bans relating
    /// to <target>` or `No matching bans for <target>`.
    Unban,
    /// `BLACKLIST <domain> [reason]`: one line, `Successfully added <domain>
    /// to blacklist` or an error such as `Domain <domain> is already
    /// blacklisted`.
    BlacklistDomain,
    /// `UNBLACKLIST <domain>`: one line, `Sucessfully removed <domain> from
    /// blacklist` (uberserver's own spelling) or `Unable to remove <domain>,
    /// entry doesn't exist`.
    UnblacklistDomain,
    /// `RESETUSERPASSWORD <username> [email]`: one line, `An email was sent
    /// to '<email>' containing a new password for <username>` on success,
    /// or one of several refusals such as `User <username> does not exist`
    /// or `User <username> already has a valid email address (<email>),
    /// please try again without specifying an email address`.
    ResetUserPassword,
    /// `SETMINSPRINGVERSION <version>`: one line, `Set Spring engine version
    /// to <version>`. Also closes every open bot-hosted battle on an older
    /// engine, after posting a notice in each one's chat, but that is not
    /// answered here.
    SetMinSpringVersion,
    /// `STATS`: one line, `Stats were printed in the server logfile`. The
    /// figures themselves go to the server's own log, not to this reply.
    Stats,
    /// `RELOAD`: one line, `Reload successful` or `Reload failed`. Also
    /// announces `Reload initiated by <admin>` in `#moderator` immediately,
    /// and the same result there, but neither is a `SERVERMSG` so neither
    /// is read here.
    Reload,
    /// `CLEANUP`: one line, `Cleanup complete: <n> deletions, <n>
    /// mismatches`, only ever sent on success (an exception leaves the
    /// admin with no reply at all). Also announces `Cleanup initiated by
    /// <admin>` in `#moderator`, and the same result there, neither read
    /// here for the same reason as `RELOAD`.
    Cleanup,
    /// `LISTMODS`: two lines, `Admins: <names>` then `Mods: <names>`, each a
    /// list of usernames separated by single spaces (`SQLUsers.list_mods`
    /// writes each name followed by a space, so an empty level is an empty
    /// string after the label).
    ListMods,
    /// `SETACCESS <username> user|mod|admin`: success is a bare `OK
    /// cmd=SETACCESS`, which carries no data at all, so it is read by the
    /// admin queue (issue #2786) rather than this collector: see
    /// [`AdminCollector::hear_ok`]. Failure is one of two `SERVERMSG`
    /// sentences: `User not found.` or `Invalid access mode, only user, mod,
    /// admin is valid.`
    SetAccess,
    /// `BROADCAST`, `BROADCASTEX`, `ADMINBROADCAST`: never answered.
    NoReply,
    /// ChanServ's `:register <chan> [founder]`: `#<chan>: Successfully
    /// registered to <founder>`.
    RegisterChannel,
    /// ChanServ's `:unregister <chan>`: `#<chan>: Successfully
    /// unregistered.`
    UnregisterChannel,
    /// ChanServ's `:history <chan> on|off`.
    ChannelHistory,
    /// ChanServ's `:antispam <chan> on|off`.
    ChannelAntispam,
    /// ChanServ's `:listbans <chan>`: a marked list, or `The banlist is
    /// empty.`
    ChannelBanList,
    /// ChanServ's `:listmutes <chan>`: a marked list, or `The mutelist is
    /// empty.`
    ChannelMuteList,
    /// ChanServ's `:unban <chan> <nick>`: `#<chan>: <nick> unbanned`.
    ChannelUnban,
    /// ChanServ's `:unmute <chan> <nick>`: `#<chan>: unmuted <nick>`.
    ChannelUnmute,
    /// ChanServ's `:info <chan>`: one line naming the founder, the operator
    /// list, the user counts, antispam, history and when the channel was
    /// last used. Only antispam and history are read here.
    ChannelInfo,
    /// ChanServ's `:showip`: two lines, the online address then the local.
    ShowIp,
    /// ChanServ's `:refreship`: a line straight away, and a second when the
    /// server has looked its address up again.
    RefreshIp,
    /// `DELETEACCOUNT <username>`: up to three lines. `User <username> does
    /// not exist` on its own when there is no such account. Otherwise the
    /// email ban's `BANSPECIFIC`-shaped line (only when the account has an
    /// email on file), then the `KICK`-shaped line, then either `Account
    /// deletion of <username> scheduled by <admin>` or `User <username> no
    /// longer exists`, the last from a database callback that can land a
    /// moment after the first two.
    DeleteAccount,
}

impl AdminShape {
    /// ChanServ answers this command in private messages, rather than the
    /// server in `SERVERMSG` lines. The plugin sends it as `SAYPRIVATE
    /// ChanServ :<command> <args>`.
    pub fn is_chanserv(self) -> bool {
        matches!(
            self,
            Self::RegisterChannel
                | Self::UnregisterChannel
                | Self::ChannelHistory
                | Self::ChannelAntispam
                | Self::ChannelBanList
                | Self::ChannelMuteList
                | Self::ChannelUnban
                | Self::ChannelUnmute
                | Self::ChannelInfo
                | Self::ShowIp
                | Self::RefreshIp
        )
    }

    /// The command's first argument is the channel its answer names.
    pub fn names_channel(self) -> bool {
        self.is_chanserv() && !matches!(self, Self::ShowIp | Self::RefreshIp)
    }
}

/// One line of `LISTBANS`.
///
/// uberserver writes a missing value as Python's `None`, which is read as
/// `None` here: a ban can name an address and no account.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BanEntry {
    pub username: Option<String>,
    pub ip: Option<String>,
    pub email: Option<String>,
    pub reason: String,
    pub ends: String,
    pub issuer: String,
}

/// One line of `LISTBLACKLIST`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlacklistEntry {
    pub domain: String,
    pub reason: String,
    pub issuer: String,
}

/// One line of ChanServ's `:listbans <chan>`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelBanEntry {
    pub username: String,
    /// `None` for a bridged user, whose ban names no address.
    pub ip: Option<String>,
    pub reason: String,
    pub ends: String,
    /// The moderator who banned, or `unknown`.
    pub issuer: String,
}

/// One line of ChanServ's `:listmutes <chan>`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelMuteEntry {
    pub username: String,
    pub reason: String,
    pub ends: String,
    pub issuer: String,
}

/// An account and an address it was seen on, from `GETIP` or `FINDIP`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IpBinding {
    pub username: String,
    /// As uberserver wrote it. For a client behind a trusted proxy `GETIP`
    /// writes `<local> via proxy <proxy>`.
    pub address: String,
    /// Logged in now, rather than seen before.
    pub online: bool,
    /// When `FINDIP` last saw an offline account there, as written.
    pub last_seen: Option<String>,
}

/// A normal account's `GETUSERINFO` answer: eight lines.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountDetails {
    pub username: String,
    pub online: bool,
    pub user_id: String,
    /// Only an online account has a session.
    pub session_id: Option<String>,
    pub agent: Option<String>,
    pub registered: String,
    pub last_login: String,
    pub access: String,
    pub bot: bool,
    pub ingame_hours: String,
    pub email: Option<String>,
    pub last_ip: Option<String>,
    pub last_sys_id: Option<String>,
    pub last_mac_id: Option<String>,
}

/// A bridged account's `GETUSERINFO` answer: three lines.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgedDetails {
    pub username: String,
    /// Bridged in now.
    pub bridged: bool,
    pub bridged_id: String,
    /// Only a client bridged in now names its bridge.
    pub bridge_user_id: Option<String>,
    pub last_bridged: String,
    pub external_id: String,
    pub location: String,
    pub external_username: String,
}

/// What `GETUSERINFO <name>` said.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum UserInfo {
    Account(Box<AccountDetails>),
    Bridged(Box<BridgedDetails>),
    /// `User '<name>' does not exist`.
    Missing {
        username: String,
    },
    /// `Bridged user '<name>' does not exist`.
    BridgedMissing {
        username: String,
    },
    /// `User <name> is static`, which is all uberserver says about one.
    Static {
        username: String,
    },
}

/// A whole answer, parsed.
///
/// `rename_all` on an internally tagged enum (`tag = "shape"`) only renames
/// the tag value, never a struct variant's own field names: a serde nuance
/// that shipped `historyOn`/`antispamOn` as `history_on`/`antispam_on` on the
/// wire (issue #2923), then the same bug again on `ShowIp` and
/// `CreateBotAccount.from_username` (issue #2938). `rename_all_fields`
/// (serde 1.0.180+) reaches every struct variant's fields as well, so a new
/// multi-word field is covered without remembering a per-field
/// `#[serde(rename)]`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(
    tag = "shape",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum AdminReply {
    BanList {
        entries: Vec<BanEntry>,
    },
    Blacklist {
        entries: Vec<BlacklistEntry>,
    },
    UserInfo {
        info: UserInfo,
    },
    IpLookup {
        binding: IpBinding,
    },
    IpSearch {
        bindings: Vec<IpBinding>,
    },
    BotMode {
        username: String,
        bot: bool,
    },
    CreateBotAccount {
        username: String,
        from_username: String,
        founder: Option<String>,
    },
    Kick {
        username: String,
        kicked: bool,
    },
    Ban {
        success: bool,
        message: String,
    },
    BanSpecific {
        success: bool,
        message: String,
    },
    Unban {
        success: bool,
        message: String,
    },
    BlacklistDomain {
        success: bool,
        message: String,
    },
    UnblacklistDomain {
        success: bool,
        message: String,
    },
    ResetUserPassword {
        success: bool,
        message: String,
    },
    SetMinSpringVersion {
        version: String,
    },
    Stats,
    Reload {
        success: bool,
        message: String,
    },
    Cleanup {
        message: String,
    },
    ListMods {
        admins: Vec<String>,
        mods: Vec<String>,
    },
    SetAccess {
        success: bool,
        /// The failure sentence uberserver gave. Empty on success, since its
        /// `OK cmd=SETACCESS` carries no message of its own.
        message: String,
    },
    RegisterChannel {
        channel: String,
        founder: String,
    },
    UnregisterChannel {
        channel: String,
    },
    ChannelHistory {
        channel: String,
        on: bool,
    },
    ChannelAntispam {
        channel: String,
        on: bool,
    },
    ChannelBanList {
        entries: Vec<ChannelBanEntry>,
    },
    ChannelMuteList {
        entries: Vec<ChannelMuteEntry>,
    },
    ChannelUnban {
        channel: String,
        username: String,
    },
    ChannelUnmute {
        channel: String,
        username: String,
    },
    ChannelInfo {
        channel: String,
        history_on: bool,
        antispam_on: bool,
    },
    ShowIp {
        online_ip: String,
        /// `None` when the server looks the address up itself.
        online_override: Option<String>,
        local_ip: String,
        local_override: Option<String>,
    },
    RefreshIp {
        /// ChanServ's first line, which says whether the online address is
        /// pinned and so cannot change.
        started: String,
        /// ChanServ's second line, or `None` when it had not arrived by the
        /// time the wait ran out.
        result: Option<String>,
        /// The second line reports a failed lookup.
        failed: bool,
    },
    DeleteAccount {
        /// `User <username> does not exist` or `User <username> no longer
        /// exists`, uberserver's own wording for a refusal. `None` on
        /// success.
        refusal: Option<String>,
        /// The email ban's `BANSPECIFIC`-shaped line, only when the account
        /// had an email on file.
        ban_message: Option<String>,
        /// The `KICK`-shaped line: `true` when it was kicked, `false` when
        /// it was not online. `None` when refused before it ran.
        kicked: Option<bool>,
        /// `Account deletion of <username> scheduled by <admin>`, from a
        /// database callback that can land a moment after the ban and kick
        /// lines. `None` when refused, or when the wait ran out first.
        scheduled: Option<String>,
    },
}

/// What one `SERVERMSG` meant to the command waiting.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Heard {
    /// Not part of this answer, so it is somebody else's and shown as usual.
    NotOurs,
    /// Part of this answer, with more to come.
    Collected,
    /// The last line of this answer.
    Finished(AdminReply),
    /// ChanServ would not do it, in its own words. `SERVERMSG` refusals are
    /// read by the plugin instead, so only ChanServ's lines end this way.
    Refused(String),
}

/// Reads the `SERVERMSG` lines that answer one command, or ChanServ's private
/// replies for a ChanServ command.
#[derive(Clone, Debug)]
pub struct AdminCollector {
    shape: AdminShape,
    /// The channel a ChanServ channel command names, which its answer
    /// repeats. A line about another channel is somebody else's.
    channel: Option<String>,
    progress: Progress,
}

/// How far into an answer the collector is.
#[derive(Clone, Debug)]
enum Progress {
    /// Nothing of the answer has arrived.
    Waiting,
    BanList(Vec<BanEntry>),
    Blacklist(Vec<BlacklistEntry>),
    /// `next` is the index of the next line after the first.
    Account {
        details: AccountDetails,
        next: usize,
    },
    Bridged {
        details: BridgedDetails,
        next: usize,
    },
    Bindings(Vec<IpBinding>),
    ChannelBans(Vec<ChannelBanEntry>),
    ChannelMutes(Vec<ChannelMuteEntry>),
    /// `LISTMODS`'s `Admins: ...` line has arrived, waiting on `Mods: ...`.
    ListModsAdmins(Vec<String>),
    /// `:showip`'s online line has arrived: the address and its override.
    OnlineIp(String, Option<String>),
    /// `:refreship`'s first line has arrived.
    RefreshStarted(String),
    /// `DELETEACCOUNT`'s ban and/or kick line has arrived, waiting on the
    /// scheduling line or `no longer exists`. `kicked` is `None` until the
    /// kick line lands, which tells the next line whether it is still the
    /// kick line (an email present means the ban line comes first) or the
    /// late one.
    DeleteAccount {
        ban_message: Option<String>,
        kicked: Option<bool>,
    },
}

/// The lines after the first of a normal account's answer.
const ACCOUNT_LINES: usize = 7;
/// The lines after the first of a bridged account's answer.
const BRIDGED_LINES: usize = 2;

impl AdminCollector {
    pub fn new(shape: AdminShape) -> Self {
        Self {
            shape,
            channel: None,
            progress: Progress::Waiting,
        }
    }

    /// Wait on `channel`, the one a ChanServ channel command names.
    pub fn on_channel(mut self, channel: Option<String>) -> Self {
        self.channel = channel;
        self
    }

    /// Read one private message from ChanServ.
    ///
    /// ChanServ writes each line of a reply as its own message, so a list
    /// arrives the same way a `SERVERMSG` list does. `ChanServ.py` writes the
    /// list markers with a space either side, which is trimmed here.
    pub fn hear_chanserv(&mut self, text: &str) -> Heard {
        if !self.shape.is_chanserv() {
            return Heard::NotOurs;
        }
        let trimmed = text.trim();
        if let Some(reason) = self.chanserv_refusal(trimmed) {
            if matches!(self.progress, Progress::Waiting) {
                return Heard::Refused(reason);
            }
        }
        let chan = self.channel.as_deref().unwrap_or_default();
        // The line with this channel's `#<chan>: ` prefix taken off.
        let about = trimmed
            .strip_prefix('#')
            .and_then(|t| t.strip_prefix(chan))
            .and_then(|t| t.strip_prefix(": "));
        let channel = || chan.to_string();
        match (self.shape, &mut self.progress, about) {
            (AdminShape::RegisterChannel, _, Some(rest)) => {
                match rest
                    .strip_prefix("Successfully registered to <")
                    .and_then(|t| t.strip_suffix('>'))
                {
                    Some(founder) => Heard::Finished(AdminReply::RegisterChannel {
                        channel: channel(),
                        founder: founder.to_string(),
                    }),
                    None => Heard::NotOurs,
                }
            }
            (AdminShape::UnregisterChannel, _, Some("Successfully unregistered.")) => {
                Heard::Finished(AdminReply::UnregisterChannel { channel: channel() })
            }
            (AdminShape::ChannelHistory, _, Some(rest)) => match rest {
                "History enabled" => Heard::Finished(AdminReply::ChannelHistory {
                    channel: channel(),
                    on: true,
                }),
                "History disabled" => Heard::Finished(AdminReply::ChannelHistory {
                    channel: channel(),
                    on: false,
                }),
                _ => Heard::NotOurs,
            },
            (AdminShape::ChannelAntispam, _, Some(rest)) => match rest {
                "Anti-spam protection is on." => Heard::Finished(AdminReply::ChannelAntispam {
                    channel: channel(),
                    on: true,
                }),
                "Anti-spam protection is off." => Heard::Finished(AdminReply::ChannelAntispam {
                    channel: channel(),
                    on: false,
                }),
                _ => Heard::NotOurs,
            },
            (AdminShape::ChannelBanList, Progress::Waiting, _) => {
                if trimmed == "The banlist is empty." {
                    Heard::Finished(AdminReply::ChannelBanList {
                        entries: Vec::new(),
                    })
                } else if trimmed == format!("-- Banlist for {chan} --") {
                    self.progress = Progress::ChannelBans(Vec::new());
                    Heard::Collected
                } else {
                    Heard::NotOurs
                }
            }
            (AdminShape::ChannelBanList, Progress::ChannelBans(entries), _) => {
                if trimmed == "-- End Banlist --" {
                    return Heard::Finished(AdminReply::ChannelBanList {
                        entries: std::mem::take(entries),
                    });
                }
                collect(entries, channel_ban_entry_from(trimmed))
            }
            (AdminShape::ChannelMuteList, Progress::Waiting, _) => {
                if trimmed == "The mutelist is empty." {
                    Heard::Finished(AdminReply::ChannelMuteList {
                        entries: Vec::new(),
                    })
                } else if trimmed == format!("-- Mutelist for {chan} --") {
                    self.progress = Progress::ChannelMutes(Vec::new());
                    Heard::Collected
                } else {
                    Heard::NotOurs
                }
            }
            (AdminShape::ChannelMuteList, Progress::ChannelMutes(entries), _) => {
                if trimmed == "-- End Mutelist --" {
                    return Heard::Finished(AdminReply::ChannelMuteList {
                        entries: std::mem::take(entries),
                    });
                }
                collect(entries, channel_mute_entry_from(trimmed))
            }
            (AdminShape::ChannelUnban, _, Some(rest)) => {
                match rest
                    .strip_prefix('<')
                    .and_then(|t| t.strip_suffix("> unbanned"))
                {
                    Some(name) => Heard::Finished(AdminReply::ChannelUnban {
                        channel: channel(),
                        username: name.to_string(),
                    }),
                    None => Heard::NotOurs,
                }
            }
            (AdminShape::ChannelUnmute, _, Some(rest)) => {
                match rest
                    .strip_prefix("unmuted <")
                    .and_then(|t| t.strip_suffix('>'))
                {
                    Some(name) => Heard::Finished(AdminReply::ChannelUnmute {
                        channel: channel(),
                        username: name.to_string(),
                    }),
                    None => Heard::NotOurs,
                }
            }
            (AdminShape::ChannelInfo, _, _) => {
                let prefix = format!("#{chan} info: ");
                match trimmed
                    .strip_prefix(prefix.as_str())
                    .and_then(channel_info_from)
                {
                    Some((history_on, antispam_on)) => Heard::Finished(AdminReply::ChannelInfo {
                        channel: channel(),
                        history_on,
                        antispam_on,
                    }),
                    None => Heard::NotOurs,
                }
            }
            (AdminShape::ShowIp, Progress::Waiting, _) => {
                match address_line(trimmed, "Server online IP: ") {
                    Some((ip, pinned)) => {
                        self.progress = Progress::OnlineIp(ip, pinned);
                        Heard::Collected
                    }
                    None => Heard::NotOurs,
                }
            }
            (AdminShape::ShowIp, Progress::OnlineIp(online_ip, online_override), _) => {
                match address_line(trimmed, "Server local IP: ") {
                    Some((local_ip, local_override)) => Heard::Finished(AdminReply::ShowIp {
                        online_ip: std::mem::take(online_ip),
                        online_override: online_override.take(),
                        local_ip,
                        local_override,
                    }),
                    None => Heard::NotOurs,
                }
            }
            (AdminShape::RefreshIp, Progress::Waiting, _) => {
                if trimmed.starts_with("Refreshing server IP") {
                    self.progress = Progress::RefreshStarted(trimmed.to_string());
                    Heard::Collected
                } else {
                    Heard::NotOurs
                }
            }
            (AdminShape::RefreshIp, Progress::RefreshStarted(started), _) => {
                let failed = trimmed.starts_with("IP refresh failed: ");
                if failed || trimmed.starts_with("IP refresh complete. ") {
                    Heard::Finished(AdminReply::RefreshIp {
                        started: std::mem::take(started),
                        result: Some(trimmed.to_string()),
                        failed,
                    })
                } else {
                    Heard::NotOurs
                }
            }
            _ => Heard::NotOurs,
        }
    }

    /// ChanServ's refusal of the command waiting, as the reason to show.
    ///
    /// Only the sentences `ChanServ.py` can write for this command are read,
    /// so a refusal of something else sent meanwhile, such as a mute from the
    /// chat member menu, is not taken for this one.
    fn chanserv_refusal(&self, text: &str) -> Option<String> {
        let mine = |sentence: &str| (text == sentence).then(|| text.to_string());
        if let Some(command) = match self.shape {
            AdminShape::ShowIp => Some("showip"),
            AdminShape::RefreshIp => Some("refreship"),
            _ => None,
        } {
            // A ChanServ with no such command reads it as a channel command
            // missing its channel.
            if text == "Channel not specified" {
                return Some(format!("This server's ChanServ has no :{command} command."));
            }
            return match self.shape {
                AdminShape::ShowIp => {
                    mine("You must be a moderator or admin to view server IP configuration")
                }
                _ => mine("You must be an admin to refresh the server IP")
                    .or_else(|| mine("An IP refresh is already in progress, please wait.")),
            };
        }
        let chan = self.channel.as_deref().unwrap_or_default();
        let generic = mine("Channel not specified").or_else(|| {
            mine(
                "ChanServ commands do not permit the # character to prefix channel names, please retry",
            )
        });
        if generic.is_some() {
            return generic;
        }
        if self.shape == AdminShape::RegisterChannel {
            // `:register` is checked before ChanServ looks for the channel,
            // and names it without quotes.
            if text == format!("Channel {chan} does not exist") {
                return Some(text.to_string());
            }
        } else if text == format!("Channel '{chan}' does not exist")
            || text == format!("ChanServ is not present in channel '{chan}' (unregistered?)")
        {
            return Some(text.to_string());
        }
        let rest = text
            .strip_prefix('#')?
            .strip_prefix(chan)?
            .strip_prefix(": ")?;
        let refused = match self.shape {
            AdminShape::RegisterChannel => {
                rest == "You must contact one of the server moderators to register a channel"
                    || rest == "Already registered"
                    || (rest.starts_with("User <") && rest.ends_with("> not found"))
            }
            AdminShape::UnregisterChannel => {
                rest == "You must contact one of the server moderators or the owner of the channel to unregister a channel"
                    || rest == "Not registered"
            }
            AdminShape::ChannelHistory => {
                rest == "You do not have permission to change history settings in the channel"
                    || rest == "Unknown value for history setting (expected: on, off)."
            }
            AdminShape::ChannelAntispam => {
                rest == "You must contact one of the server moderators or the owner of the channel to change the antispam settings"
                    || rest == "Unknown value for anti-spam setting (expected: on, off)."
            }
            AdminShape::ChannelBanList | AdminShape::ChannelMuteList => {
                rest == "You do not have permission to execute this command"
            }
            AdminShape::ChannelUnban => {
                rest == "You do not have permission to unban users from this channel"
                    || rest == "You must specify a user to unban from the channel"
                    || (rest.starts_with("User <") && rest.ends_with("> not found on the bridge"))
                    || (rest.starts_with("User <")
                        && rest.ends_with("> not found in bridged banlist"))
                    || (rest.starts_with("User '") && rest.ends_with("' does not exist"))
                    || (rest.starts_with("User <") && rest.ends_with("> not found in banlist"))
            }
            AdminShape::ChannelUnmute => {
                rest == "You do not have permission to unmute users in this channel"
                    || rest == "You must specify a user to unmute"
                    || rest == "For bridged users, use !ban/!unban"
                    || (rest.starts_with("User <") && rest.ends_with("> not found in mutelist"))
            }
            _ => false,
        };
        refused.then(|| text.to_string())
    }

    /// Read one `SERVERMSG` text.
    pub fn hear(&mut self, text: &str) -> Heard {
        match (self.shape, &mut self.progress) {
            (AdminShape::BanList, Progress::Waiting) => match text {
                "-- Banlist --" => {
                    self.progress = Progress::BanList(Vec::new());
                    Heard::Collected
                }
                "Banlist is empty" => Heard::Finished(AdminReply::BanList {
                    entries: Vec::new(),
                }),
                _ => Heard::NotOurs,
            },
            (AdminShape::BanList, Progress::BanList(entries)) => {
                if text == "-- End Banlist --" {
                    return Heard::Finished(AdminReply::BanList {
                        entries: std::mem::take(entries),
                    });
                }
                collect(entries, ban_entry_from(text))
            }
            (AdminShape::Blacklist, Progress::Waiting) => match text {
                "-- Blacklist --" => {
                    self.progress = Progress::Blacklist(Vec::new());
                    Heard::Collected
                }
                "Blacklist is empty" => Heard::Finished(AdminReply::Blacklist {
                    entries: Vec::new(),
                }),
                _ => Heard::NotOurs,
            },
            (AdminShape::Blacklist, Progress::Blacklist(entries)) => {
                // uberserver writes no space before the closing dashes. The
                // spaced form is accepted too, so a server that fixes the typo
                // still ends the list.
                if text == "-- End Blacklist--" || text == "-- End Blacklist --" {
                    return Heard::Finished(AdminReply::Blacklist {
                        entries: std::mem::take(entries),
                    });
                }
                collect(entries, blacklist_entry_from(text))
            }
            (AdminShape::UserInfo, Progress::Waiting) => match user_info_start(text) {
                None => Heard::NotOurs,
                Some(Start::Done(info)) => Heard::Finished(AdminReply::UserInfo { info }),
                Some(Start::Account(details)) => {
                    self.progress = Progress::Account { details, next: 0 };
                    Heard::Collected
                }
                Some(Start::Bridged(details)) => {
                    self.progress = Progress::Bridged { details, next: 0 };
                    Heard::Collected
                }
            },
            (AdminShape::UserInfo, Progress::Account { details, next }) => {
                if !account_line(details, *next, text) {
                    return Heard::NotOurs;
                }
                *next += 1;
                if *next < ACCOUNT_LINES {
                    return Heard::Collected;
                }
                Heard::Finished(AdminReply::UserInfo {
                    info: UserInfo::Account(Box::new(std::mem::take(details))),
                })
            }
            (AdminShape::UserInfo, Progress::Bridged { details, next }) => {
                if !bridged_line(details, *next, text) {
                    return Heard::NotOurs;
                }
                *next += 1;
                if *next < BRIDGED_LINES {
                    return Heard::Collected;
                }
                Heard::Finished(AdminReply::UserInfo {
                    info: UserInfo::Bridged(Box::new(std::mem::take(details))),
                })
            }
            (AdminShape::IpLookup, _) => match ip_binding_from(text) {
                Some(binding) => Heard::Finished(AdminReply::IpLookup { binding }),
                None => Heard::NotOurs,
            },
            (AdminShape::IpSearch, progress) => {
                let Some(binding) = ip_binding_from(text) else {
                    return Heard::NotOurs;
                };
                match progress {
                    Progress::Bindings(found) => found.push(binding),
                    _ => *progress = Progress::Bindings(vec![binding]),
                }
                Heard::Collected
            }
            (AdminShape::BotMode, _) => match bot_mode_from(text) {
                Some((username, bot)) => Heard::Finished(AdminReply::BotMode { username, bot }),
                None => Heard::NotOurs,
            },
            (AdminShape::CreateBotAccount, _) => match create_bot_account_result_from(text) {
                Some((username, from_username, founder)) => {
                    Heard::Finished(AdminReply::CreateBotAccount {
                        username,
                        from_username,
                        founder,
                    })
                }
                None => Heard::NotOurs,
            },
            (AdminShape::Kick, _) => match kick_result_from(text) {
                Some((username, kicked)) => Heard::Finished(AdminReply::Kick { username, kicked }),
                None => Heard::NotOurs,
            },
            (AdminShape::Ban, _) => match ban_result_from(text) {
                Some((success, message)) => Heard::Finished(AdminReply::Ban { success, message }),
                None => Heard::NotOurs,
            },
            (AdminShape::BanSpecific, _) => match ban_specific_result_from(text) {
                Some((success, message)) => {
                    Heard::Finished(AdminReply::BanSpecific { success, message })
                }
                None => Heard::NotOurs,
            },
            (AdminShape::Unban, _) => match unban_result_from(text) {
                Some((success, message)) => Heard::Finished(AdminReply::Unban { success, message }),
                None => Heard::NotOurs,
            },
            (AdminShape::BlacklistDomain, _) => match blacklist_domain_result_from(text) {
                Some((success, message)) => {
                    Heard::Finished(AdminReply::BlacklistDomain { success, message })
                }
                None => Heard::NotOurs,
            },
            (AdminShape::UnblacklistDomain, _) => match unblacklist_domain_result_from(text) {
                Some((success, message)) => {
                    Heard::Finished(AdminReply::UnblacklistDomain { success, message })
                }
                None => Heard::NotOurs,
            },
            (AdminShape::ResetUserPassword, _) => match reset_user_password_result_from(text) {
                Some((success, message)) => {
                    Heard::Finished(AdminReply::ResetUserPassword { success, message })
                }
                None => Heard::NotOurs,
            },
            (AdminShape::SetMinSpringVersion, _) => {
                match set_min_spring_version_result_from(text) {
                    Some(version) => Heard::Finished(AdminReply::SetMinSpringVersion { version }),
                    None => Heard::NotOurs,
                }
            }
            (AdminShape::Stats, _) => {
                if text == "Stats were printed in the server logfile" {
                    Heard::Finished(AdminReply::Stats)
                } else {
                    Heard::NotOurs
                }
            }
            (AdminShape::Reload, _) => match reload_result_from(text) {
                Some((success, message)) => {
                    Heard::Finished(AdminReply::Reload { success, message })
                }
                None => Heard::NotOurs,
            },
            (AdminShape::Cleanup, _) => match cleanup_result_from(text) {
                Some(message) => Heard::Finished(AdminReply::Cleanup { message }),
                None => Heard::NotOurs,
            },
            (AdminShape::ListMods, Progress::Waiting) => match text.strip_prefix("Admins: ") {
                Some(rest) => {
                    self.progress = Progress::ListModsAdmins(
                        rest.split_whitespace().map(str::to_string).collect(),
                    );
                    Heard::Collected
                }
                None => Heard::NotOurs,
            },
            (AdminShape::ListMods, Progress::ListModsAdmins(admins)) => {
                match text.strip_prefix("Mods: ") {
                    Some(rest) => Heard::Finished(AdminReply::ListMods {
                        admins: std::mem::take(admins),
                        mods: rest.split_whitespace().map(str::to_string).collect(),
                    }),
                    None => Heard::NotOurs,
                }
            }
            (AdminShape::SetAccess, _) => match set_access_result_from(text) {
                Some(message) => Heard::Finished(AdminReply::SetAccess {
                    success: false,
                    message,
                }),
                None => Heard::NotOurs,
            },
            (AdminShape::DeleteAccount, Progress::Waiting) => {
                if delete_account_missing_from(text) {
                    return Heard::Finished(AdminReply::DeleteAccount {
                        refusal: Some(text.to_string()),
                        ban_message: None,
                        kicked: None,
                        scheduled: None,
                    });
                }
                // No email on file: `in_KICK` runs unconditionally, so this
                // is the kick line rather than the email ban's.
                if let Some((_, kicked)) = kick_result_from(text) {
                    self.progress = Progress::DeleteAccount {
                        ban_message: None,
                        kicked: Some(kicked),
                    };
                    return Heard::Collected;
                }
                // An email on file: the ban runs before the kick.
                if let Some((_, message)) = ban_specific_result_from(text) {
                    self.progress = Progress::DeleteAccount {
                        ban_message: Some(message),
                        kicked: None,
                    };
                    return Heard::Collected;
                }
                Heard::NotOurs
            }
            (AdminShape::DeleteAccount, Progress::DeleteAccount { kicked, .. })
                if kicked.is_none() =>
            {
                let Some((_, k)) = kick_result_from(text) else {
                    return Heard::NotOurs;
                };
                *kicked = Some(k);
                Heard::Collected
            }
            (
                AdminShape::DeleteAccount,
                Progress::DeleteAccount {
                    ban_message,
                    kicked,
                },
            ) => {
                if delete_account_scheduled_from(text) {
                    return Heard::Finished(AdminReply::DeleteAccount {
                        refusal: None,
                        ban_message: ban_message.take(),
                        kicked: *kicked,
                        scheduled: Some(text.to_string()),
                    });
                }
                if delete_account_gone_midway_from(text) {
                    return Heard::Finished(AdminReply::DeleteAccount {
                        refusal: Some(text.to_string()),
                        ban_message: ban_message.take(),
                        kicked: *kicked,
                        scheduled: None,
                    });
                }
                Heard::NotOurs
            }
            _ => Heard::NotOurs,
        }
    }

    /// Read the server's generic `OK cmd=..` acknowledgement, once the admin
    /// queue (`admin_command.rs`) has confirmed the tag names the command
    /// waiting. Only `SETACCESS` finishes this way (issue #2786): its `OK`
    /// carries no data at all, unlike every other command's `SERVERMSG`
    /// reply, so there is no line here to read.
    pub fn hear_ok(&mut self) -> Heard {
        match self.shape {
            AdminShape::SetAccess => Heard::Finished(AdminReply::SetAccess {
                success: true,
                message: String::new(),
            }),
            _ => Heard::NotOurs,
        }
    }

    /// The answer when the wait runs out, if what arrived is one.
    ///
    /// Only a `FINDIP` search is whole at that point, because nothing marks
    /// its end. Any other shape still collecting was cut short.
    pub fn give_up(self) -> Option<AdminReply> {
        match self.progress {
            Progress::Bindings(bindings) => Some(AdminReply::IpSearch { bindings }),
            // The refresh started, so the moderator is told that much even
            // though the result never came.
            Progress::RefreshStarted(started) => Some(AdminReply::RefreshIp {
                started,
                result: None,
                failed: false,
            }),
            // The ban and/or kick line arrived, so the admin is told that
            // much even though the scheduling line never came.
            Progress::DeleteAccount {
                ban_message,
                kicked,
            } => Some(AdminReply::DeleteAccount {
                refusal: None,
                ban_message,
                kicked,
                scheduled: None,
            }),
            _ => None,
        }
    }
}

/// `"%s :: %s :: %s :: ends %s (%s)"` (user, ip, reason, end, issuer) for an
/// account, or `"%s :: %s :: ends %s (%s)"` with no address for a bridged
/// user, from `ChanServ.py`'s `listbans`. A bridged name has a `:` in it,
/// which is what `ChanServ.py` itself checks, and the reason is free text.
fn channel_ban_entry_from(text: &str) -> Option<ChannelBanEntry> {
    let (head, ends, issuer) = ends_and_issuer(text)?;
    let (username, rest) = head.split_once(" :: ")?;
    let (ip, reason) = if username.contains(':') {
        (None, rest)
    } else {
        let (ip, reason) = rest.split_once(" :: ")?;
        (Some(ip.to_string()), reason)
    };
    Some(ChannelBanEntry {
        username: username.to_string(),
        ip,
        reason: reason.to_string(),
        ends,
        issuer,
    })
}

/// `"%s :: %s :: ends %s (%s)"` (user, reason, end, issuer) from
/// `ChanServ.py`'s `listmutes`.
fn channel_mute_entry_from(text: &str) -> Option<ChannelMuteEntry> {
    let (head, ends, issuer) = ends_and_issuer(text)?;
    let (username, reason) = head.split_once(" :: ")?;
    Some(ChannelMuteEntry {
        username: username.to_string(),
        reason: reason.to_string(),
        ends,
        issuer,
    })
}

/// ChanServ's `:info <chan>` reply, once its `#<chan> info: ` prefix is
/// stripped: `"%s. %s. %s. %s. %s. %s."` (founder, operator list, user
/// counts, antispam, history, last used), from `ChanServ.py`'s `info`
/// handler. Only the antispam and history sentences are read. The rest are
/// for a person to read, not parsed here.
fn channel_info_from(rest: &str) -> Option<(bool, bool)> {
    let antispam_on = rest.contains("Anti-spam protection is on");
    let antispam_off = rest.contains("Anti-spam protection is off");
    let history_on = rest.contains("Channel history is on");
    let history_off = rest.contains("Channel history is off");
    if antispam_on == antispam_off || history_on == history_off {
        return None;
    }
    Some((history_on, antispam_on))
}

/// A ChanServ list line's `<head> :: ends <when> (<issuer>)`, as its parts.
fn ends_and_issuer(text: &str) -> Option<(&str, String, String)> {
    let (head, tail) = text.rsplit_once(" :: ends ")?;
    let (ends, issuer) = tail.strip_suffix(')')?.rsplit_once(" (")?;
    Some((head, ends.to_string(), issuer.to_string()))
}

/// `:showip`'s `<label><ip> (override: <ip or none>)`.
fn address_line(text: &str, label: &str) -> Option<(String, Option<String>)> {
    let (ip, pinned) = text
        .strip_prefix(label)?
        .strip_suffix(')')?
        .split_once(" (override: ")?;
    Some((
        ip.to_string(),
        (pinned != "none").then(|| pinned.to_string()),
    ))
}

/// Keep `entry` if the line was one.
fn collect<T>(entries: &mut Vec<T>, entry: Option<T>) -> Heard {
    match entry {
        Some(entry) => {
            entries.push(entry);
            Heard::Collected
        }
        None => Heard::NotOurs,
    }
}

/// A value uberserver wrote with Python's `%s`, where a missing one reads
/// `None`.
fn python_none(value: &str) -> Option<String> {
    (value != "None").then(|| value.to_string())
}

/// `<name> rest`, as `(name, rest)`.
fn bracketed_name(text: &str) -> Option<(&str, &str)> {
    text.strip_prefix('<')?.split_once("> ")
}

/// `"%s, %s, %s :: '%s' :: ends %s (%s)"` in `_listbans_done`. The reason is
/// free text, so it is taken from the outermost quotes.
fn ban_entry_from(text: &str) -> Option<BanEntry> {
    let (who, rest) = text.split_once(" :: '")?;
    let (reason, tail) = rest.rsplit_once("' :: ends ")?;
    let (ends, issuer) = tail.strip_suffix(')')?.rsplit_once(" (")?;
    let mut who = who.splitn(3, ", ");
    let (username, ip, email) = (who.next()?, who.next()?, who.next()?);
    Some(BanEntry {
        username: python_none(username),
        ip: python_none(ip),
        email: python_none(email),
        reason: reason.to_string(),
        ends: ends.to_string(),
        issuer: issuer.to_string(),
    })
}

/// `"%s :: '%s' (%s)"` in `_listblacklist_done`.
fn blacklist_entry_from(text: &str) -> Option<BlacklistEntry> {
    let (domain, rest) = text.split_once(" :: '")?;
    let (reason, issuer) = rest.strip_suffix(')')?.rsplit_once("' (")?;
    Some(BlacklistEntry {
        domain: domain.to_string(),
        reason: reason.to_string(),
        issuer: issuer.to_string(),
    })
}

/// The first line of a `GETUSERINFO <name>` answer.
enum Start {
    Done(UserInfo),
    Account(AccountDetails),
    Bridged(BridgedDetails),
}

fn user_info_start(text: &str) -> Option<Start> {
    let quoted_missing = |prefix: &str| {
        text.strip_prefix(prefix)?
            .strip_suffix("' does not exist")
            .map(|name| name.to_string())
    };
    if let Some(username) = quoted_missing("User '") {
        return Some(Start::Done(UserInfo::Missing { username }));
    }
    if let Some(username) = quoted_missing("Bridged user '") {
        return Some(Start::Done(UserInfo::BridgedMissing { username }));
    }
    if let Some(name) = text
        .strip_prefix("User <")
        .and_then(|t| t.strip_suffix("> is static"))
    {
        return Some(Start::Done(UserInfo::Static {
            username: name.to_string(),
        }));
    }
    let (name, rest) = bracketed_name(text)?;
    let username = name.to_string();
    if let Some(ids) = rest.strip_prefix("is online,  user_id=") {
        let (user_id, session_id) = ids.split_once(", session_id=")?;
        return Some(Start::Account(AccountDetails {
            username,
            online: true,
            user_id: user_id.to_string(),
            session_id: Some(session_id.to_string()),
            ..Default::default()
        }));
    }
    if let Some(user_id) = rest.strip_prefix("is offline,  user_id=") {
        return Some(Start::Account(AccountDetails {
            username,
            user_id: user_id.to_string(),
            ..Default::default()
        }));
    }
    if let Some(ids) = rest.strip_prefix("is bridged,  bridged_id=") {
        let (bridged_id, bridge) = ids.split_once(",  bridge_user_id='")?;
        return Some(Start::Bridged(BridgedDetails {
            username,
            bridged: true,
            bridged_id: bridged_id.to_string(),
            bridge_user_id: Some(bridge.strip_suffix('\'')?.to_string()),
            ..Default::default()
        }));
    }
    // Written with a trailing `, `, which a relay may have trimmed.
    let bridged_id = rest
        .strip_prefix("is not bridged,  bridged_id=")?
        .trim_end()
        .strip_suffix(',')?;
    Some(Start::Bridged(BridgedDetails {
        username,
        bridged_id: bridged_id.to_string(),
        ..Default::default()
    }))
}

/// Line `index` after the first of a normal account's answer, recorded into
/// `details`. `false` when the line is not that one.
fn account_line(details: &mut AccountDetails, index: usize, text: &str) -> bool {
    let mut read = || -> Option<()> {
        match index {
            0 => details.agent = python_none(text.strip_prefix("Agent: ")?),
            1 => details.registered = text.strip_prefix("Registered ")?.to_string(),
            2 => details.last_login = text.strip_prefix("Last login ")?.to_string(),
            3 => {
                let (access, rest) = text.strip_prefix("access=")?.split_once(",  bot=")?;
                let (bot, hours) = rest.split_once(",  ingame_time=")?;
                details.access = access.to_string();
                details.bot = bot == "True";
                details.ingame_hours = hours.strip_suffix(" hours")?.to_string();
            }
            4 => details.email = python_none(text.strip_prefix("email=")?),
            5 => details.last_ip = python_none(text.strip_prefix("last_ip=")?),
            6 => {
                let (sys, mac) = text
                    .strip_prefix("last_sys_id=")?
                    .split_once(", last_mac_id=")?;
                details.last_sys_id = python_none(sys);
                details.last_mac_id = python_none(mac);
            }
            _ => return None,
        }
        Some(())
    };
    read().is_some()
}

/// Line `index` after the first of a bridged account's answer.
fn bridged_line(details: &mut BridgedDetails, index: usize, text: &str) -> bool {
    let mut read = || -> Option<()> {
        match index {
            0 => details.last_bridged = text.strip_prefix("Last bridged: ")?.to_string(),
            1 => {
                let (id, rest) = text
                    .strip_prefix("external_id=")?
                    .split_once(",  location=")?;
                let (location, name) = rest.split_once(",  external_username=")?;
                details.external_id = id.to_string();
                details.location = location.to_string();
                details.external_username = name.to_string();
            }
            _ => return None,
        }
        Some(())
    };
    read().is_some()
}

/// `'<%s> is currently bound to %s'` and `'<%s> was recently bound to %s'`
/// from `GETIP`, and `FINDIP`'s versions of the same, which end the first in
/// a full stop and add ` at <last login>` to the second.
fn ip_binding_from(text: &str) -> Option<IpBinding> {
    let (name, rest) = bracketed_name(text)?;
    let username = name.to_string();
    if let Some(address) = rest.strip_prefix("is currently bound to ") {
        return Some(IpBinding {
            username,
            address: address.strip_suffix('.').unwrap_or(address).to_string(),
            online: true,
            last_seen: None,
        });
    }
    let rest = rest.strip_prefix("was recently bound to ")?;
    let (address, last_seen) = match rest.split_once(" at ") {
        // `FINDIP` writes `Unknown` for an account that never logged in.
        Some((address, when)) => (address, (when != "Unknown").then(|| when.to_string())),
        None => (rest, None),
    };
    Some(IpBinding {
        username,
        address: address.to_string(),
        online: false,
        last_seen,
    })
}

/// `'Botmode for <%s> successfully changed to %s'` with Python's bool.
fn bot_mode_from(text: &str) -> Option<(String, bool)> {
    let (name, mode) = text
        .strip_prefix("Botmode for <")?
        .split_once("> successfully changed to ")?;
    let bot = match mode {
        "True" => true,
        "False" => false,
        _ => return None,
    };
    Some((name.to_string(), bot))
}

/// `in_CREATEBOTACCOUNT`'s success line: `"A new bot account <%s> has been
/// created, with the same password as <%s>"`, plus `", and battle founder
/// <%s>"` when a founder was given. A refusal never reaches here: it is a
/// tagged `FAILED`, read by the plugin before a line is offered to this
/// collector.
fn create_bot_account_result_from(text: &str) -> Option<(String, String, Option<String>)> {
    let rest = text.strip_prefix("A new bot account <")?;
    let (username, rest) = rest.split_once("> has been created, with the same password as <")?;
    if let Some((from_username, founder)) = rest.split_once(">, and battle founder <") {
        let founder = founder.strip_suffix('>')?;
        return Some((
            username.to_string(),
            from_username.to_string(),
            Some(founder.to_string()),
        ));
    }
    let from_username = rest.strip_suffix('>')?;
    Some((username.to_string(), from_username.to_string(), None))
}

/// `in_KICK`: `'Kicked <%s> from the server'` for an online target, or
/// `'User <%s> was not online'` when it was not connected.
fn kick_result_from(text: &str) -> Option<(String, bool)> {
    if let Some(name) = text
        .strip_prefix("Kicked <")
        .and_then(|t| t.strip_suffix("> from the server"))
    {
        return Some((name.to_string(), true));
    }
    let name = text
        .strip_prefix("User <")
        .and_then(|t| t.strip_suffix("> was not online"))?;
    Some((name.to_string(), false))
}

/// `SQLUsers.ban`: `'Successfully banned %s, %s, %s for %s days.' %
/// (username, ip, email, duration)` on success, ending in a full stop
/// (unlike `BANSPECIFIC`'s reply). Failure is one of
/// `"Unable to ban %s, user doesn't exist" % username` or
/// `'Duration must be a float, cannot convert %s' % duration`.
fn ban_result_from(text: &str) -> Option<(bool, String)> {
    if text.starts_with("Successfully banned ") && text.ends_with(" days.") {
        return Some((true, text.to_string()));
    }
    if text.starts_with("Unable to ban ") && text.ends_with(", user doesn't exist") {
        return Some((false, text.to_string()));
    }
    if text.starts_with("Duration must be a float, cannot convert ") {
        return Some((false, text.to_string()));
    }
    None
}

/// `SQLUsers.ban_specific`: `'Successfully banned %s for %s days' % (arg,
/// duration)` on success, with no full stop (unlike `BAN`'s reply). Failure
/// is one of `"Unable to match '%s' to username/ip/email" % arg` or
/// `'Duration must be a float, cannot convert %s' % duration`.
fn ban_specific_result_from(text: &str) -> Option<(bool, String)> {
    if text.starts_with("Successfully banned ") && text.ends_with(" days") {
        return Some((true, text.to_string()));
    }
    if text.starts_with("Unable to match '") && text.ends_with("' to username/ip/email") {
        return Some((false, text.to_string()));
    }
    if text.starts_with("Duration must be a float, cannot convert ") {
        return Some((false, text.to_string()));
    }
    None
}

/// `SQLUsers.unban`: `'Successfully removed %s bans relating to %s' %
/// (n_unban, arg)` on success. Failure is one of `'No matching bans for %s'
/// % arg` or `"Unable to match '%s' to username/ip/email" % arg`.
fn unban_result_from(text: &str) -> Option<(bool, String)> {
    if text.starts_with("Successfully removed ") && text.contains(" bans relating to ") {
        return Some((true, text.to_string()));
    }
    if text.starts_with("No matching bans for ") {
        return Some((false, text.to_string()));
    }
    if text.starts_with("Unable to match '") && text.ends_with("' to username/ip/email") {
        return Some((false, text.to_string()));
    }
    None
}

/// `SQLUsers.blacklist`: `'Successfully added %s to blacklist' % domain` on
/// success. Failure is one of `"invalid domain '%s', contains no '.'" %
/// domain`, `"invalid domain '%s', do not include www or http(s) part,
/// example: hawtmail.com" % domain`, or `'Domain %s is already blacklisted'
/// % domain`.
fn blacklist_domain_result_from(text: &str) -> Option<(bool, String)> {
    if text.starts_with("Successfully added ") && text.ends_with(" to blacklist") {
        return Some((true, text.to_string()));
    }
    if text.starts_with("invalid domain '") && text.ends_with("', contains no '.'") {
        return Some((false, text.to_string()));
    }
    if text.starts_with("invalid domain '")
        && text.ends_with("', do not include www or http(s) part, example: hawtmail.com")
    {
        return Some((false, text.to_string()));
    }
    if text.starts_with("Domain ") && text.ends_with(" is already blacklisted") {
        return Some((false, text.to_string()));
    }
    None
}

/// `SQLUsers.unblacklist`: `"Sucessfully removed %s from blacklist" % domain`
/// on success, uberserver's own spelling. Failure is `"Unable to remove %s,
/// entry doesn't exist" % domain`.
fn unblacklist_domain_result_from(text: &str) -> Option<(bool, String)> {
    if text.starts_with("Sucessfully removed ") && text.ends_with(" from blacklist") {
        return Some((true, text.to_string()));
    }
    if text.starts_with("Unable to remove ") && text.ends_with(", entry doesn't exist") {
        return Some((false, text.to_string()));
    }
    None
}

/// `in_RESETUSERPASSWORD`'s own six sentences. Success, written by
/// `_resetuserpassword_done`, is `"An email was sent to '%s' containing a
/// new password for <%s>" % (email, username)`. Four refusals are written
/// straight away by `in_RESETUSERPASSWORD` itself: `"User <%s> does not
/// exist" % username`, `"User <%s> already has a valid email address (%s),
/// please try again without specifying an email address" % (username,
/// email)`, `"User <%s> does not have a valid email address, please
/// specify an email address to add to their account" % username`, and
/// `"The email address '%s' is not valid: %s" % (newmail, reason)`. Two more
/// come back through `do_set_password`'s `'denied'` verdict, also written by
/// `_resetuserpassword_done`: the literal `"User no longer exists"` and
/// `"another user is already registered to the email address '%s'" %
/// new_email`.
///
/// `"Server error processing RESETUSERPASSWORD."` is not read here. It is
/// the generic database-error sentence every callback-answered command can
/// send, already read by `server_error_of` in the plugin. When the server
/// has no email account set up, `in_RESETUSERPASSWORD` throws before
/// sending anything at all (`out_SERVERMSG` called without its `client`
/// argument, ScarylePoo/uberserver#58), so coilbox sees a timeout rather
/// than a line to read.
fn reset_user_password_result_from(text: &str) -> Option<(bool, String)> {
    if text.starts_with("An email was sent to '")
        && text.contains("' containing a new password for <")
        && text.ends_with('>')
    {
        return Some((true, text.to_string()));
    }
    if text.starts_with("User <") && text.ends_with("> does not exist") {
        return Some((false, text.to_string()));
    }
    if text.starts_with("User <") && text.contains("> already has a valid email address (") {
        return Some((false, text.to_string()));
    }
    if text.starts_with("User <")
        && text.ends_with(
            "> does not have a valid email address, please specify an email address to add to their account",
        )
    {
        return Some((false, text.to_string()));
    }
    if text.starts_with("The email address '") && text.contains("' is not valid: ") {
        return Some((false, text.to_string()));
    }
    if text == "User no longer exists" {
        return Some((false, text.to_string()));
    }
    if text.starts_with("another user is already registered to the email address '")
        && text.ends_with('\'')
    {
        return Some((false, text.to_string()));
    }
    None
}

/// `in_SETMINSPRINGVERSION`: `'Set Spring engine version to %s' % version`,
/// always sent, uberserver never refuses this by itself once the caller is
/// an admin (checked before the handler runs, so a rejection is uberserver's
/// generic `<COMMAND> failed.` shape, not read here).
fn set_min_spring_version_result_from(text: &str) -> Option<String> {
    text.strip_prefix("Set Spring engine version to ")
        .map(str::to_string)
}

/// `DataHandler.reload`: `'Reload successful'` or `'Reload failed'`, the one
/// line `in_RELOAD` sends straight to the admin. It also announces the same
/// two words in `#moderator`, and `'Reload initiated by <admin>'` before
/// that, but both travel as a channel `SAID` rather than a `SERVERMSG`, so
/// neither is offered here.
fn reload_result_from(text: &str) -> Option<(bool, String)> {
    match text {
        "Reload successful" => Some((true, text.to_string())),
        "Reload failed" => Some((false, text.to_string())),
        _ => None,
    }
}

/// `DataHandler.cleanup`'s closing line: `'Cleanup complete: %s deletions,
/// %s mismatches' % (n_delete, n_mismatch)`. Only ever sent when cleanup
/// finished: an exception inside it returns before this line is built, so a
/// failed cleanup is silence rather than a refusal, read as `Unanswered` by
/// the caller.
fn cleanup_result_from(text: &str) -> Option<String> {
    text.starts_with("Cleanup complete: ")
        .then(|| text.to_string())
}

/// `in_SETACCESS`'s two refusal sentences, written straight away rather than
/// through a callback: `"User not found."` when `username` names nobody, and
/// `"Invalid access mode, only user, mod, admin is valid."` for anything but
/// `user`, `mod` or `admin`. Success is a bare `OK cmd=SETACCESS`, read by
/// [`AdminCollector::hear_ok`] instead.
fn set_access_result_from(text: &str) -> Option<String> {
    match text {
        "User not found." | "Invalid access mode, only user, mod, admin is valid." => {
            Some(text.to_string())
        }
        _ => None,
    }
}

/// `in_DELETEACCOUNT`: `"User <%s> does not exist" % username`, sent alone
/// when no account was found at all.
fn delete_account_missing_from(text: &str) -> bool {
    text.starts_with("User <") && text.ends_with("> does not exist")
}

/// `_deleteaccount_done`: `"User <%s> no longer exists" % username`, sent in
/// place of the scheduling line when the account vanished between the kick
/// and the scrub landing.
fn delete_account_gone_midway_from(text: &str) -> bool {
    text.starts_with("User <") && text.ends_with("> no longer exists")
}

/// `_deleteaccount_done`: `"Account deletion of <%s> scheduled by <%s>" %
/// (username, admin)`.
fn delete_account_scheduled_from(text: &str) -> bool {
    text.starts_with("Account deletion of <") && text.contains("> scheduled by <")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hear_all(shape: AdminShape, lines: &[&str]) -> (AdminCollector, Vec<Heard>) {
        let mut c = AdminCollector::new(shape);
        let heard = lines.iter().map(|l| c.hear(l)).collect();
        (c, heard)
    }

    /// `_listbans_done`: `-- Banlist --`, then
    /// `"%s, %s, %s :: '%s' :: ends %s (%s)" % (username, ip, email, reason,
    /// end_date, issuer)` per ban, then `-- End Banlist --`.
    #[test]
    fn a_ban_list_is_read_between_its_brackets() {
        let (_, heard) = hear_all(
            AdminShape::BanList,
            &[
                "-- Banlist --",
                "Spammer, 203.0.113.7, spam@example.com :: 'flooding #main' :: ends 2026-10-01 00:00:00 (Moderator)",
                "None, 198.51.100.4, None :: 'ban evasion :: again' :: ends 2027-01-01 12:30:00 (Admin)",
                "-- End Banlist --",
            ],
        );
        assert_eq!(
            heard,
            vec![
                Heard::Collected,
                Heard::Collected,
                Heard::Collected,
                Heard::Finished(AdminReply::BanList {
                    entries: vec![
                        BanEntry {
                            username: Some("Spammer".into()),
                            ip: Some("203.0.113.7".into()),
                            email: Some("spam@example.com".into()),
                            reason: "flooding #main".into(),
                            ends: "2026-10-01 00:00:00".into(),
                            issuer: "Moderator".into(),
                        },
                        BanEntry {
                            username: None,
                            ip: Some("198.51.100.4".into()),
                            email: None,
                            reason: "ban evasion :: again".into(),
                            ends: "2027-01-01 12:30:00".into(),
                            issuer: "Admin".into(),
                        },
                    ]
                }),
            ]
        );
    }

    /// `_listbans_done` with no bans: `Banlist is empty` and nothing else.
    #[test]
    fn an_empty_ban_list_is_one_line() {
        let (_, heard) = hear_all(AdminShape::BanList, &["Banlist is empty"]);
        assert_eq!(
            heard,
            vec![Heard::Finished(AdminReply::BanList { entries: vec![] })]
        );
    }

    /// `_listblacklist_done`: `-- Blacklist --`, then
    /// `"%s :: '%s' (%s)" % (domain, reason, issuer)`, then
    /// `-- End Blacklist--` with no space before the dashes.
    #[test]
    fn a_blacklist_is_read_between_its_brackets() {
        let (_, heard) = hear_all(
            AdminShape::Blacklist,
            &[
                "-- Blacklist --",
                "mailinator.com :: 'disposable (throwaway)' (Moderator)",
                "-- End Blacklist--",
            ],
        );
        assert_eq!(
            heard,
            vec![
                Heard::Collected,
                Heard::Collected,
                Heard::Finished(AdminReply::Blacklist {
                    entries: vec![BlacklistEntry {
                        domain: "mailinator.com".into(),
                        reason: "disposable (throwaway)".into(),
                        issuer: "Moderator".into(),
                    }]
                }),
            ]
        );
    }

    #[test]
    fn an_empty_blacklist_is_one_line() {
        let (_, heard) = hear_all(AdminShape::Blacklist, &["Blacklist is empty"]);
        assert_eq!(
            heard,
            vec![Heard::Finished(AdminReply::Blacklist { entries: vec![] })]
        );
    }

    /// A server announcement arriving before or inside a list is not part of
    /// it, and nor is the other list's empty line.
    #[test]
    fn an_announcement_is_not_part_of_a_list() {
        let (_, heard) = hear_all(
            AdminShape::BanList,
            &[
                "Server restarting in 5 minutes",
                "Blacklist is empty",
                "-- Banlist --",
                "Server restarting in 5 minutes",
                "-- End Banlist --",
            ],
        );
        assert_eq!(
            heard,
            vec![
                Heard::NotOurs,
                Heard::NotOurs,
                Heard::Collected,
                Heard::NotOurs,
                Heard::Finished(AdminReply::BanList { entries: vec![] }),
            ]
        );
    }

    /// `in_GETUSERINFO` for an online native account, eight lines.
    #[test]
    fn an_online_account_is_eight_lines() {
        let (_, heard) = hear_all(
            AdminShape::UserInfo,
            &[
                "<Alice> is online,  user_id=42, session_id=7",
                "Agent: Coilbox 0.9",
                "Registered Jan 02, 2020",
                "Last login Sep 16, 2026, 18:04:05",
                "access=user,  bot=False,  ingame_time=12 hours",
                "email=alice@example.com",
                "last_ip=203.0.113.7",
                "last_sys_id=1234, last_mac_id=abcd",
            ],
        );
        assert_eq!(heard[..7], vec![Heard::Collected; 7][..]);
        assert_eq!(
            heard[7],
            Heard::Finished(AdminReply::UserInfo {
                info: UserInfo::Account(Box::new(AccountDetails {
                    username: "Alice".into(),
                    online: true,
                    user_id: "42".into(),
                    session_id: Some("7".into()),
                    agent: Some("Coilbox 0.9".into()),
                    registered: "Jan 02, 2020".into(),
                    last_login: "Sep 16, 2026, 18:04:05".into(),
                    access: "user".into(),
                    bot: false,
                    ingame_hours: "12".into(),
                    email: Some("alice@example.com".into()),
                    last_ip: Some("203.0.113.7".into()),
                    last_sys_id: Some("1234".into()),
                    last_mac_id: Some("abcd".into()),
                }))
            })
        );
    }

    /// The offline account's first line has no session, and uberserver writes
    /// a value it never stored as `None`.
    #[test]
    fn an_offline_account_has_no_session() {
        let (_, heard) = hear_all(
            AdminShape::UserInfo,
            &[
                "<Bob> is offline,  user_id=43",
                "Agent: None",
                "Registered unknown",
                "Last login unknown",
                "access=mod,  bot=True,  ingame_time=0 hours",
                "email=None",
                "last_ip=None",
                "last_sys_id=None, last_mac_id=None",
            ],
        );
        assert_eq!(
            heard[7],
            Heard::Finished(AdminReply::UserInfo {
                info: UserInfo::Account(Box::new(AccountDetails {
                    username: "Bob".into(),
                    online: false,
                    user_id: "43".into(),
                    session_id: None,
                    agent: None,
                    registered: "unknown".into(),
                    last_login: "unknown".into(),
                    access: "mod".into(),
                    bot: true,
                    ingame_hours: "0".into(),
                    email: None,
                    last_ip: None,
                    last_sys_id: None,
                    last_mac_id: None,
                }))
            })
        );
    }

    /// An announcement between two of the eight lines is not one of them.
    #[test]
    fn an_announcement_inside_an_account_is_not_part_of_it() {
        let (_, heard) = hear_all(
            AdminShape::UserInfo,
            &[
                "<Alice> is online,  user_id=42, session_id=7",
                "Server restarting in 5 minutes",
                "Agent: Coilbox 0.9",
            ],
        );
        assert_eq!(
            heard,
            vec![Heard::Collected, Heard::NotOurs, Heard::Collected]
        );
    }

    /// The one-line answers: a missing account, a missing bridged one, and a
    /// static one.
    #[test]
    fn the_short_user_info_answers_are_one_line() {
        for (line, info) in [
            (
                "User 'Nobody' does not exist",
                UserInfo::Missing {
                    username: "Nobody".into(),
                },
            ),
            (
                "Bridged user 'Nobody:discord' does not exist",
                UserInfo::BridgedMissing {
                    username: "Nobody:discord".into(),
                },
            ),
            (
                "User <ChanServ> is static",
                UserInfo::Static {
                    username: "ChanServ".into(),
                },
            ),
        ] {
            let (_, heard) = hear_all(AdminShape::UserInfo, &[line]);
            assert_eq!(
                heard,
                vec![Heard::Finished(AdminReply::UserInfo { info })],
                "for {line}"
            );
        }
    }

    /// A bridged account, bridged in now and not, three lines each.
    #[test]
    fn a_bridged_account_is_three_lines() {
        let (_, heard) = hear_all(
            AdminShape::UserInfo,
            &[
                "<Carol:discord> is bridged,  bridged_id=5,  bridge_user_id='9'",
                "Last bridged: Sep 16, 2026",
                "external_id=123,  location=discord,  external_username=Carol",
            ],
        );
        assert_eq!(
            heard,
            vec![
                Heard::Collected,
                Heard::Collected,
                Heard::Finished(AdminReply::UserInfo {
                    info: UserInfo::Bridged(Box::new(BridgedDetails {
                        username: "Carol:discord".into(),
                        bridged: true,
                        bridged_id: "5".into(),
                        bridge_user_id: Some("9".into()),
                        last_bridged: "Sep 16, 2026".into(),
                        external_id: "123".into(),
                        location: "discord".into(),
                        external_username: "Carol".into(),
                    }))
                }),
            ]
        );

        let (_, heard) = hear_all(
            AdminShape::UserInfo,
            &[
                "<Dan:irc> is not bridged,  bridged_id=6, ",
                "Last bridged: Jan 01, 2026",
                "external_id=77,  location=irc,  external_username=Dan",
            ],
        );
        let Heard::Finished(AdminReply::UserInfo {
            info: UserInfo::Bridged(details),
        }) = &heard[2]
        else {
            panic!("expected a bridged answer, got {heard:?}");
        };
        assert!(!details.bridged);
        assert_eq!(details.bridge_user_id, None);
        assert_eq!(details.bridged_id, "6");
    }

    /// `in_GETIP`: `'<%s> is currently bound to %s'` for an online user and
    /// `'<%s> was recently bound to %s'` from the database.
    #[test]
    fn an_ip_lookup_is_one_line() {
        let (_, heard) = hear_all(
            AdminShape::IpLookup,
            &["<Alice> is currently bound to 10.0.0.2 via proxy 203.0.113.1"],
        );
        assert_eq!(
            heard,
            vec![Heard::Finished(AdminReply::IpLookup {
                binding: IpBinding {
                    username: "Alice".into(),
                    address: "10.0.0.2 via proxy 203.0.113.1".into(),
                    online: true,
                    last_seen: None,
                }
            })]
        );
        let (_, heard) = hear_all(
            AdminShape::IpLookup,
            &["<Bob> was recently bound to 198.51.100.4"],
        );
        assert_eq!(
            heard,
            vec![Heard::Finished(AdminReply::IpLookup {
                binding: IpBinding {
                    username: "Bob".into(),
                    address: "198.51.100.4".into(),
                    online: false,
                    last_seen: None,
                }
            })]
        );
    }

    /// `_findip_done`: `'<%s> is currently bound to %s.'` and
    /// `'<%s> was recently bound to %s at %s'`, with no end marker, so the
    /// lines are only an answer once the wait is over.
    #[test]
    fn an_ip_search_collects_until_the_wait_ends() {
        let (collector, heard) = hear_all(
            AdminShape::IpSearch,
            &[
                "<Alice> is currently bound to 203.0.113.7.",
                "Server restarting in 5 minutes",
                "<Bob> was recently bound to 203.0.113.7 at 2026-09-01 10:00:00",
                "<Eve> was recently bound to 203.0.113.7 at Unknown",
            ],
        );
        assert_eq!(
            heard,
            vec![
                Heard::Collected,
                Heard::NotOurs,
                Heard::Collected,
                Heard::Collected
            ]
        );
        assert_eq!(
            collector.give_up(),
            Some(AdminReply::IpSearch {
                bindings: vec![
                    IpBinding {
                        username: "Alice".into(),
                        address: "203.0.113.7".into(),
                        online: true,
                        last_seen: None,
                    },
                    IpBinding {
                        username: "Bob".into(),
                        address: "203.0.113.7".into(),
                        online: false,
                        last_seen: Some("2026-09-01 10:00:00".into()),
                    },
                    IpBinding {
                        username: "Eve".into(),
                        address: "203.0.113.7".into(),
                        online: false,
                        last_seen: None,
                    },
                ]
            })
        );
    }

    /// Silence is the whole answer for a search that matched nothing, and for
    /// every shape that has not finished.
    #[test]
    fn silence_is_no_answer() {
        for shape in [
            AdminShape::IpSearch,
            AdminShape::IpLookup,
            AdminShape::BotMode,
            AdminShape::CreateBotAccount,
            AdminShape::Kick,
            AdminShape::Ban,
            AdminShape::BanSpecific,
            AdminShape::Unban,
            AdminShape::ResetUserPassword,
            AdminShape::NoReply,
            AdminShape::UserInfo,
        ] {
            assert_eq!(AdminCollector::new(shape).give_up(), None, "for {shape:?}");
        }
        // Half a list is not a list.
        let (collector, _) = hear_all(AdminShape::BanList, &["-- Banlist --"]);
        assert_eq!(collector.give_up(), None);
    }

    /// `in_SETBOTMODE`: `'Botmode for <%s> successfully changed to %s'`, with
    /// Python's `True` or `False`.
    #[test]
    fn a_bot_mode_change_is_one_line() {
        for (line, bot) in [
            ("Botmode for <Autohost1> successfully changed to True", true),
            (
                "Botmode for <Autohost1> successfully changed to False",
                false,
            ),
        ] {
            let (_, heard) = hear_all(AdminShape::BotMode, &[line]);
            assert_eq!(
                heard,
                vec![Heard::Finished(AdminReply::BotMode {
                    username: "Autohost1".into(),
                    bot
                })]
            );
        }
    }

    /// `in_CREATEBOTACCOUNT`'s success line, with and without a founder.
    #[test]
    fn a_create_bot_account_reply_is_one_line() {
        let (_, heard) = hear_all(
            AdminShape::CreateBotAccount,
            &["A new bot account <Autohost1> has been created, with the same password as <Alice>"],
        );
        assert_eq!(
            heard,
            vec![Heard::Finished(AdminReply::CreateBotAccount {
                username: "Autohost1".into(),
                from_username: "Alice".into(),
                founder: None,
            })]
        );

        let (_, heard) = hear_all(
            AdminShape::CreateBotAccount,
            &["A new bot account <Autohost1> has been created, with the same password as <Alice>, and battle founder <Bob>"],
        );
        assert_eq!(
            heard,
            vec![Heard::Finished(AdminReply::CreateBotAccount {
                username: "Autohost1".into(),
                from_username: "Alice".into(),
                founder: Some("Bob".into()),
            })]
        );
    }

    /// `in_KICK`: an online target and one that was not connected.
    #[test]
    fn a_kick_reply_is_one_line() {
        let (_, heard) = hear_all(AdminShape::Kick, &["Kicked <Alice> from the server"]);
        assert_eq!(
            heard,
            vec![Heard::Finished(AdminReply::Kick {
                username: "Alice".into(),
                kicked: true,
            })]
        );
        let (_, heard) = hear_all(AdminShape::Kick, &["User <Bob> was not online"]);
        assert_eq!(
            heard,
            vec![Heard::Finished(AdminReply::Kick {
                username: "Bob".into(),
                kicked: false,
            })]
        );
    }

    /// `SQLUsers.ban`: success ends in a full stop, and the two failures.
    #[test]
    fn a_ban_reply_is_one_line() {
        for (line, success) in [
            (
                "Successfully banned Spammer, 203.0.113.7, spam@example.com for 7.0 days.",
                true,
            ),
            ("Unable to ban Nobody, user doesn't exist", false),
            ("Duration must be a float, cannot convert soon", false),
        ] {
            let (_, heard) = hear_all(AdminShape::Ban, &[line]);
            assert_eq!(
                heard,
                vec![Heard::Finished(AdminReply::Ban {
                    success,
                    message: line.to_string(),
                })],
                "for {line}"
            );
        }
    }

    /// `SQLUsers.ban_specific`: success has no full stop, unlike `BAN`'s.
    #[test]
    fn a_banspecific_reply_is_one_line() {
        for (line, success) in [
            ("Successfully banned 203.0.113.7 for 7.0 days", true),
            ("Unable to match 'not-a-target' to username/ip/email", false),
            ("Duration must be a float, cannot convert soon", false),
        ] {
            let (_, heard) = hear_all(AdminShape::BanSpecific, &[line]);
            assert_eq!(
                heard,
                vec![Heard::Finished(AdminReply::BanSpecific {
                    success,
                    message: line.to_string(),
                })],
                "for {line}"
            );
        }
    }

    /// A `BAN`-shaped success line is not read as `BANSPECIFIC`'s, because it
    /// still ends in a full stop.
    #[test]
    fn a_ban_success_does_not_answer_banspecific() {
        let (_, heard) = hear_all(
            AdminShape::BanSpecific,
            &["Successfully banned Spammer, 203.0.113.7, spam@example.com for 7.0 days."],
        );
        assert_eq!(heard, vec![Heard::NotOurs]);
    }

    /// `SQLUsers.unban`: success, no matching bans, and an unrecognised
    /// target.
    #[test]
    fn an_unban_reply_is_one_line() {
        for (line, success) in [
            ("Successfully removed 2 bans relating to 203.0.113.7", true),
            ("No matching bans for 203.0.113.7", false),
            ("Unable to match 'not-a-target' to username/ip/email", false),
        ] {
            let (_, heard) = hear_all(AdminShape::Unban, &[line]);
            assert_eq!(
                heard,
                vec![Heard::Finished(AdminReply::Unban {
                    success,
                    message: line.to_string(),
                })],
                "for {line}"
            );
        }
    }

    /// `SQLUsers.blacklist`: success and its three refusals.
    #[test]
    fn a_blacklist_domain_reply_is_one_line() {
        for (line, success) in [
            ("Successfully added test2784.invalid to blacklist", true),
            ("invalid domain 'nodot', contains no '.'", false),
            (
                "invalid domain 'http://evil.com', do not include www or http(s) part, example: hawtmail.com",
                false,
            ),
            ("Domain test2784.invalid is already blacklisted", false),
        ] {
            let (_, heard) = hear_all(AdminShape::BlacklistDomain, &[line]);
            assert_eq!(
                heard,
                vec![Heard::Finished(AdminReply::BlacklistDomain {
                    success,
                    message: line.to_string(),
                })],
                "for {line}"
            );
        }
    }

    /// `SQLUsers.unblacklist`: success, spelled `Sucessfully` by uberserver
    /// itself, and its one refusal.
    #[test]
    fn an_unblacklist_domain_reply_is_one_line() {
        for (line, success) in [
            ("Sucessfully removed test2784.invalid from blacklist", true),
            (
                "Unable to remove test2784.invalid, entry doesn't exist",
                false,
            ),
        ] {
            let (_, heard) = hear_all(AdminShape::UnblacklistDomain, &[line]);
            assert_eq!(
                heard,
                vec![Heard::Finished(AdminReply::UnblacklistDomain {
                    success,
                    message: line.to_string(),
                })],
                "for {line}"
            );
        }
    }

    /// `in_RESETUSERPASSWORD`'s success line and every refusal it can send,
    /// copied from `Protocol.py` and `SQLUsers.py`'s `do_set_password`.
    #[test]
    fn a_reset_user_password_reply_is_one_line() {
        for (line, success) in [
            (
                "An email was sent to 'alice@example.com' containing a new password for <Alice>",
                true,
            ),
            ("User <Nobody> does not exist", false),
            (
                "User <Alice> already has a valid email address (alice@example.com), please try again without specifying an email address",
                false,
            ),
            (
                "User <Alice> does not have a valid email address, please specify an email address to add to their account",
                false,
            ),
            (
                "The email address 'not-an-email' is not valid: Invalid email address format.",
                false,
            ),
            ("User no longer exists", false),
            (
                "another user is already registered to the email address 'taken@example.com'",
                false,
            ),
        ] {
            let (_, heard) = hear_all(AdminShape::ResetUserPassword, &[line]);
            assert_eq!(
                heard,
                vec![Heard::Finished(AdminReply::ResetUserPassword {
                    success,
                    message: line.to_string(),
                })],
                "for {line}"
            );
        }
    }

    /// `"Server error processing RESETUSERPASSWORD."` is the plugin's
    /// generic database-error sentence (`server_error_of`), not one of this
    /// collector's own lines, so it is not claimed here.
    #[test]
    fn a_reset_user_password_database_error_is_not_read_here() {
        let (_, heard) = hear_all(
            AdminShape::ResetUserPassword,
            &["Server error processing RESETUSERPASSWORD."],
        );
        assert_eq!(heard, vec![Heard::NotOurs]);
    }

    /// `in_SETMINSPRINGVERSION`'s one line, captured from a local uberserver
    /// on 17 September 2026 (issue #2785).
    #[test]
    fn a_set_min_spring_version_reply_is_one_line() {
        let (_, heard) = hear_all(
            AdminShape::SetMinSpringVersion,
            &["Set Spring engine version to 105.0"],
        );
        assert_eq!(
            heard,
            vec![Heard::Finished(AdminReply::SetMinSpringVersion {
                version: "105.0".to_string(),
            })]
        );
    }

    /// `in_STATS`'s one line. The figures themselves went to the server's
    /// own log, not to this line.
    #[test]
    fn a_stats_reply_is_one_line() {
        let (_, heard) = hear_all(
            AdminShape::Stats,
            &["Stats were printed in the server logfile"],
        );
        assert_eq!(heard, vec![Heard::Finished(AdminReply::Stats)]);
    }

    /// `DataHandler.reload`'s two possible results, the one line `in_RELOAD`
    /// sends straight to the admin. It also announces the attempt and the
    /// result in `#moderator`, but through `broadcast_Moderator`, a channel
    /// `SAID` rather than a `SERVERMSG`, so neither reaches this collector.
    #[test]
    fn a_reload_reply_is_one_line() {
        for (line, success) in [("Reload successful", true), ("Reload failed", false)] {
            let (_, heard) = hear_all(AdminShape::Reload, &[line]);
            assert_eq!(
                heard,
                vec![Heard::Finished(AdminReply::Reload {
                    success,
                    message: line.to_string(),
                })],
                "for {line}"
            );
        }
    }

    /// `DataHandler.cleanup`'s closing line, captured from a local uberserver
    /// on 17 September 2026. `in_CLEANUP` also announces the attempt in
    /// `#moderator` first, through `broadcast_Moderator`, so it never reaches
    /// this collector either.
    #[test]
    fn a_cleanup_reply_is_one_line() {
        let (_, heard) = hear_all(
            AdminShape::Cleanup,
            &["Cleanup complete: 0 deletions, 0 mismatches"],
        );
        assert_eq!(
            heard,
            vec![Heard::Finished(AdminReply::Cleanup {
                message: "Cleanup complete: 0 deletions, 0 mismatches".to_string(),
            })]
        );
    }

    /// `_listmods_done`: `"Admins: %s" % admins` then `"Mods: %s" % mods`,
    /// each built by `SQLUsers.list_mods` as every matching username
    /// followed by a space, so a populated level ends in a trailing space
    /// before the next line and an empty one is just the label.
    #[test]
    fn a_listmods_reply_is_read_from_its_two_lines() {
        let (_, heard) = hear_all(
            AdminShape::ListMods,
            &["Admins: cbadmin ", "Mods: cbmod cbmod2 "],
        );
        assert_eq!(
            heard,
            vec![
                Heard::Collected,
                Heard::Finished(AdminReply::ListMods {
                    admins: vec!["cbadmin".to_string()],
                    mods: vec!["cbmod".to_string(), "cbmod2".to_string()],
                }),
            ]
        );
    }

    /// An empty level is `"Admins: "` or `"Mods: "` with nothing after the
    /// label, rather than an omitted line.
    #[test]
    fn a_listmods_reply_with_an_empty_level_is_an_empty_list() {
        let (_, heard) = hear_all(AdminShape::ListMods, &["Admins: ", "Mods: cbmod "]);
        assert_eq!(
            heard,
            vec![
                Heard::Collected,
                Heard::Finished(AdminReply::ListMods {
                    admins: vec![],
                    mods: vec!["cbmod".to_string()],
                }),
            ]
        );
    }

    /// `in_SETACCESS`'s two refusal sentences. Success is a bare `OK
    /// cmd=SETACCESS`, which never reaches `hear`, so it is not a
    /// `SERVERMSG` this collector can read: see `hear_ok` and
    /// `admin_command.rs`, where the queue claims it.
    #[test]
    fn a_setaccess_failure_is_one_line() {
        for line in [
            "User not found.",
            "Invalid access mode, only user, mod, admin is valid.",
        ] {
            let (_, heard) = hear_all(AdminShape::SetAccess, &[line]);
            assert_eq!(
                heard,
                vec![Heard::Finished(AdminReply::SetAccess {
                    success: false,
                    message: line.to_string(),
                })],
                "for {line}"
            );
        }
    }

    /// `hear_ok` finishes only `SETACCESS`, since it is the only shape
    /// answered by a bare `OK` rather than a `SERVERMSG`.
    #[test]
    fn hear_ok_finishes_only_setaccess() {
        assert_eq!(
            AdminCollector::new(AdminShape::SetAccess).hear_ok(),
            Heard::Finished(AdminReply::SetAccess {
                success: true,
                message: String::new(),
            })
        );
        assert_eq!(
            AdminCollector::new(AdminShape::BanList).hear_ok(),
            Heard::NotOurs
        );
    }

    /// `in_DELETEACCOUNT` with an account that has an email on file: the
    /// `BANSPECIFIC`-shaped ban line, the `KICK`-shaped line, then the
    /// scheduling line, which lands from a database callback that can be a
    /// moment behind the first two (captured live against server B, issue
    /// #2787).
    #[test]
    fn a_delete_account_with_an_email_is_three_lines() {
        let (_, heard) = hear_all(
            AdminShape::DeleteAccount,
            &[
                "Successfully banned trash2787a@example.com for 28.0 days",
                "Kicked <trash2787a> from the server",
                "Account deletion of <trash2787a> scheduled by <cbadmin>",
            ],
        );
        assert_eq!(
            heard,
            vec![
                Heard::Collected,
                Heard::Collected,
                Heard::Finished(AdminReply::DeleteAccount {
                    refusal: None,
                    ban_message: Some(
                        "Successfully banned trash2787a@example.com for 28.0 days".into()
                    ),
                    kicked: Some(true),
                    scheduled: Some(
                        "Account deletion of <trash2787a> scheduled by <cbadmin>".into()
                    ),
                }),
            ]
        );
    }

    /// With no email on file, `in_KICK` alone runs before the scrub, so the
    /// answer is two lines rather than three.
    #[test]
    fn a_delete_account_with_no_email_is_two_lines() {
        let (_, heard) = hear_all(
            AdminShape::DeleteAccount,
            &[
                "User <trash2787b> was not online",
                "Account deletion of <trash2787b> scheduled by <cbadmin>",
            ],
        );
        assert_eq!(
            heard,
            vec![
                Heard::Collected,
                Heard::Finished(AdminReply::DeleteAccount {
                    refusal: None,
                    ban_message: None,
                    kicked: Some(false),
                    scheduled: Some(
                        "Account deletion of <trash2787b> scheduled by <cbadmin>".into()
                    ),
                }),
            ]
        );
    }

    /// A missing account is refused in one line, with no ban, kick or
    /// scheduling line to follow.
    #[test]
    fn a_delete_account_of_a_missing_user_is_one_line() {
        let (_, heard) = hear_all(AdminShape::DeleteAccount, &["User <Nobody> does not exist"]);
        assert_eq!(
            heard,
            vec![Heard::Finished(AdminReply::DeleteAccount {
                refusal: Some("User <Nobody> does not exist".into()),
                ban_message: None,
                kicked: None,
                scheduled: None,
            })]
        );
    }

    /// The account vanished between the kick and the scrub committing, so
    /// `_deleteaccount_done` sends `no longer exists` instead of scheduling
    /// it.
    #[test]
    fn a_delete_account_gone_midway_ends_on_the_late_line() {
        let (_, heard) = hear_all(
            AdminShape::DeleteAccount,
            &[
                "Kicked <trash2787c> from the server",
                "User <trash2787c> no longer exists",
            ],
        );
        assert_eq!(
            heard,
            vec![
                Heard::Collected,
                Heard::Finished(AdminReply::DeleteAccount {
                    refusal: Some("User <trash2787c> no longer exists".into()),
                    ban_message: None,
                    kicked: Some(true),
                    scheduled: None,
                }),
            ]
        );
    }

    /// The wait can run out before the late line lands. The admin is told
    /// what did happen rather than being left with a bare timeout.
    #[test]
    fn a_delete_account_with_no_late_line_is_answered_at_the_deadline() {
        let mut c = AdminCollector::new(AdminShape::DeleteAccount);
        assert_eq!(
            c.hear("Kicked <trash2787d> from the server"),
            Heard::Collected
        );
        assert_eq!(
            c.give_up(),
            Some(AdminReply::DeleteAccount {
                refusal: None,
                ban_message: None,
                kicked: Some(true),
                scheduled: None,
            })
        );
    }

    /// A command with no reply claims nothing, not even a line that answers
    /// another shape.
    #[test]
    fn a_command_with_no_reply_claims_nothing() {
        let (_, heard) = hear_all(
            AdminShape::NoReply,
            &[
                "Banlist is empty",
                "<Bob> was recently bound to 198.51.100.4",
            ],
        );
        assert_eq!(heard, vec![Heard::NotOurs, Heard::NotOurs]);
    }

    /// Feed ChanServ's private replies to a collector waiting on `channel`.
    fn hear_chanserv(shape: AdminShape, channel: Option<&str>, lines: &[&str]) -> Vec<Heard> {
        let mut c = AdminCollector::new(shape).on_channel(channel.map(str::to_string));
        lines.iter().map(|l| c.hear_chanserv(l)).collect()
    }

    fn refused(reason: &str) -> Heard {
        Heard::Refused(reason.to_string())
    }

    /// ChanServ's lines are private messages, so a `SERVERMSG` with the same
    /// words is not one of them, and a ChanServ line never answers a
    /// `SERVERMSG` command.
    #[test]
    fn chanserv_and_servermsg_answers_do_not_cross() {
        let mut c = AdminCollector::new(AdminShape::ChannelBanList).on_channel(Some("main".into()));
        assert_eq!(c.hear("The banlist is empty."), Heard::NotOurs);
        let mut c = AdminCollector::new(AdminShape::BanList);
        assert_eq!(c.hear_chanserv("Banlist is empty"), Heard::NotOurs);
    }

    /// `:register`. Every line here was captured from a local uberserver on
    /// 17 September 2026, except "Channel not specified", read from
    /// `ChanServ.py`.
    #[test]
    fn a_channel_registration_is_one_line() {
        assert_eq!(
            hear_chanserv(
                AdminShape::RegisterChannel,
                Some("cbtest2782"),
                &["#cbtest2782: Successfully registered to <cbmod>"],
            ),
            vec![Heard::Finished(AdminReply::RegisterChannel {
                channel: "cbtest2782".into(),
                founder: "cbmod".into(),
            })]
        );
        for line in [
            "#cbtest2782: You must contact one of the server moderators to register a channel",
            "#cbtest2782: User <nosuchuser2782> not found",
            "#cbtest2782: Already registered",
            "Channel cbtest2782 does not exist",
            "ChanServ commands do not permit the # character to prefix channel names, please retry",
            "Channel not specified",
        ] {
            assert_eq!(
                hear_chanserv(AdminShape::RegisterChannel, Some("cbtest2782"), &[line]),
                vec![refused(line)],
                "for {line}"
            );
        }
    }

    /// Another channel's answer, and an answer for this channel to a
    /// different command, are somebody else's.
    #[test]
    fn a_reply_about_another_channel_or_command_is_not_ours() {
        assert_eq!(
            hear_chanserv(
                AdminShape::RegisterChannel,
                Some("cbtest2782"),
                &[
                    "#main: Successfully registered to <cbmod>",
                    "#main: Already registered",
                    "Channel main does not exist",
                    "#cbtest2782: History enabled",
                    "#cbtest2782: muted <cbuser> for 1 hours",
                    "hello there",
                ],
            ),
            vec![Heard::NotOurs; 6]
        );
    }

    /// `:unregister`. The success line and the "not present" refusal were
    /// captured live. The other two are from `ChanServ.py`.
    #[test]
    fn a_channel_unregistration_is_one_line() {
        assert_eq!(
            hear_chanserv(
                AdminShape::UnregisterChannel,
                Some("cbtest2782"),
                &["#cbtest2782: Successfully unregistered."],
            ),
            vec![Heard::Finished(AdminReply::UnregisterChannel {
                channel: "cbtest2782".into(),
            })]
        );
        for line in [
            "ChanServ is not present in channel 'cbtest2782' (unregistered?)",
            "Channel 'cbtest2782' does not exist",
            "#cbtest2782: You must contact one of the server moderators or the owner of the channel to unregister a channel",
            "#cbtest2782: Not registered",
        ] {
            assert_eq!(
                hear_chanserv(AdminShape::UnregisterChannel, Some("cbtest2782"), &[line]),
                vec![refused(line)],
                "for {line}"
            );
        }
    }

    /// `:history`, all captured live.
    #[test]
    fn a_history_change_is_one_line() {
        for (line, on) in [
            ("#cbtest2782: History enabled", true),
            ("#cbtest2782: History disabled", false),
        ] {
            assert_eq!(
                hear_chanserv(AdminShape::ChannelHistory, Some("cbtest2782"), &[line]),
                vec![Heard::Finished(AdminReply::ChannelHistory {
                    channel: "cbtest2782".into(),
                    on,
                })]
            );
        }
        for line in [
            "#cbtest2782: You do not have permission to change history settings in the channel",
            "#cbtest2782: Unknown value for history setting (expected: on, off).",
        ] {
            assert_eq!(
                hear_chanserv(AdminShape::ChannelHistory, Some("cbtest2782"), &[line]),
                vec![refused(line)],
                "for {line}"
            );
        }
    }

    /// `:antispam`. The unknown-value refusal is from `ChanServ.py`, the rest
    /// were captured live.
    #[test]
    fn an_antispam_change_is_one_line() {
        for (line, on) in [
            ("#cbtest2782: Anti-spam protection is on.", true),
            ("#cbtest2782: Anti-spam protection is off.", false),
        ] {
            assert_eq!(
                hear_chanserv(AdminShape::ChannelAntispam, Some("cbtest2782"), &[line]),
                vec![Heard::Finished(AdminReply::ChannelAntispam {
                    channel: "cbtest2782".into(),
                    on,
                })]
            );
        }
        for line in [
            "#cbtest2782: You must contact one of the server moderators or the owner of the channel to change the antispam settings",
            "#cbtest2782: Unknown value for anti-spam setting (expected: on, off).",
        ] {
            assert_eq!(
                hear_chanserv(AdminShape::ChannelAntispam, Some("cbtest2782"), &[line]),
                vec![refused(line)],
                "for {line}"
            );
        }
    }

    /// `:listbans`, captured live. The header and footer keep ChanServ's
    /// leading and trailing spaces. The bridged entry, which has no address,
    /// is from `ChanServ.py`.
    #[test]
    fn a_channel_ban_list_is_read_between_its_markers() {
        assert_eq!(
            hear_chanserv(
                AdminShape::ChannelBanList,
                Some("cbtest2782"),
                &[
                    " -- Banlist for cbtest2782 -- ",
                    "cbplayer2 :: 127.0.0.1 :: probe ban :: ends 2026-09-19 11:19:16 (cbmod)",
                    "Relay:discord :: spam :: links (again) :: ends 9999-12-31 23:59:59 (unknown)",
                    " -- End Banlist -- ",
                ],
            ),
            vec![
                Heard::Collected,
                Heard::Collected,
                Heard::Collected,
                Heard::Finished(AdminReply::ChannelBanList {
                    entries: vec![
                        ChannelBanEntry {
                            username: "cbplayer2".into(),
                            ip: Some("127.0.0.1".into()),
                            reason: "probe ban".into(),
                            ends: "2026-09-19 11:19:16".into(),
                            issuer: "cbmod".into(),
                        },
                        ChannelBanEntry {
                            username: "Relay:discord".into(),
                            ip: None,
                            reason: "spam :: links (again)".into(),
                            ends: "9999-12-31 23:59:59".into(),
                            issuer: "unknown".into(),
                        },
                    ]
                }),
            ]
        );
        assert_eq!(
            hear_chanserv(
                AdminShape::ChannelBanList,
                Some("cbtest2782"),
                &["The banlist is empty."]
            ),
            vec![Heard::Finished(AdminReply::ChannelBanList {
                entries: vec![]
            })]
        );
        let line = "#cbtest2782: You do not have permission to execute this command";
        assert_eq!(
            hear_chanserv(AdminShape::ChannelBanList, Some("cbtest2782"), &[line]),
            vec![refused(line)]
        );
    }

    /// Another channel's list is not this one's.
    #[test]
    fn another_channels_ban_list_is_not_ours() {
        assert_eq!(
            hear_chanserv(
                AdminShape::ChannelBanList,
                Some("cbtest2782"),
                &[
                    " -- Banlist for main -- ",
                    " -- Mutelist for cbtest2782 -- "
                ],
            ),
            vec![Heard::NotOurs, Heard::NotOurs]
        );
    }

    /// `:listmutes`, captured live.
    #[test]
    fn a_channel_mute_list_is_read_between_its_markers() {
        assert_eq!(
            hear_chanserv(
                AdminShape::ChannelMuteList,
                Some("cbtest2782"),
                &[
                    " -- Mutelist for cbtest2782 -- ",
                    "cbuser :: probe mute :: ends 2026-09-17 12:19:15 (cbmod)",
                    "hello from someone else",
                    " -- End Mutelist -- ",
                ],
            ),
            vec![
                Heard::Collected,
                Heard::Collected,
                Heard::NotOurs,
                Heard::Finished(AdminReply::ChannelMuteList {
                    entries: vec![ChannelMuteEntry {
                        username: "cbuser".into(),
                        reason: "probe mute".into(),
                        ends: "2026-09-17 12:19:15".into(),
                        issuer: "cbmod".into(),
                    }]
                }),
            ]
        );
        assert_eq!(
            hear_chanserv(
                AdminShape::ChannelMuteList,
                Some("cbtest2782"),
                &["The mutelist is empty."]
            ),
            vec![Heard::Finished(AdminReply::ChannelMuteList {
                entries: vec![]
            })]
        );
    }

    /// `:unban <chan> <nick>`, captured live against a local uberserver
    /// (issue #2923). Success is `#<chan>: <nick> unbanned`, the same
    /// whether the target was a native or bridged account.
    #[test]
    fn a_channel_unban_is_one_line() {
        assert_eq!(
            hear_chanserv(
                AdminShape::ChannelUnban,
                Some("test2923"),
                &["#test2923: <cbplayer2> unbanned"],
            ),
            vec![Heard::Finished(AdminReply::ChannelUnban {
                channel: "test2923".into(),
                username: "cbplayer2".into(),
            })]
        );
    }

    /// The refusals `:unban` can give, captured live except for the
    /// permission one, which needs a non-mod account to trigger and is taken
    /// verbatim from `ChanServ.py` instead.
    #[test]
    fn a_channel_unban_refusal_is_read() {
        for line in [
            "#test2923: You do not have permission to unban users from this channel",
            "#test2923: You must specify a user to unban from the channel",
            "#test2923: User <cbplayer2> not found in banlist",
            "#test2923: User 'nosuchuser' does not exist",
        ] {
            assert_eq!(
                hear_chanserv(AdminShape::ChannelUnban, Some("test2923"), &[line]),
                vec![refused(line)],
                "for {line}"
            );
        }
    }

    /// `:unmute <chan> <nick>`, captured live. Success is `#<chan>: unmuted
    /// <nick>`, the word order swapped from `:unban`'s.
    #[test]
    fn a_channel_unmute_is_one_line() {
        assert_eq!(
            hear_chanserv(
                AdminShape::ChannelUnmute,
                Some("test2923"),
                &["#test2923: unmuted <cbplayer2>"],
            ),
            vec![Heard::Finished(AdminReply::ChannelUnmute {
                channel: "test2923".into(),
                username: "cbplayer2".into(),
            })]
        );
    }

    /// The refusals `:unmute` can give, captured live except for the
    /// permission one.
    #[test]
    fn a_channel_unmute_refusal_is_read() {
        for line in [
            "#test2923: You do not have permission to unmute users in this channel",
            "#test2923: You must specify a user to unmute",
            "#test2923: User <cbplayer2> not found in mutelist",
        ] {
            assert_eq!(
                hear_chanserv(AdminShape::ChannelUnmute, Some("test2923"), &[line]),
                vec![refused(line)],
                "for {line}"
            );
        }
    }

    /// `:info <chan>`, captured live. Only the antispam and history
    /// sentences are read. The founder, operator list, user counts and
    /// last-used date are shown for a person, but this collector has no use
    /// for them.
    #[test]
    fn a_channel_info_reads_antispam_and_history() {
        assert_eq!(
            hear_chanserv(
                AdminShape::ChannelInfo,
                Some("test2923"),
                &[
                    "#test2923 info: Founder is <cbmod>. Operator list is empty. \
                     Currently contains 2 users and 0 bridged users. Anti-spam \
                     protection is off. Channel history is off. Last used on \
                     Sep 17, 2026."
                ],
            ),
            vec![Heard::Finished(AdminReply::ChannelInfo {
                channel: "test2923".into(),
                history_on: false,
                antispam_on: false,
            })]
        );
        assert_eq!(
            hear_chanserv(
                AdminShape::ChannelInfo,
                Some("test2923"),
                &[
                    "#test2923 info: Founder is <cbmod>. Operator list is empty. \
                     Currently contains 2 users and 0 bridged users. Anti-spam \
                     protection is on. Channel history is on. Last used on \
                     Sep 17, 2026."
                ],
            ),
            vec![Heard::Finished(AdminReply::ChannelInfo {
                channel: "test2923".into(),
                history_on: true,
                antispam_on: true,
            })]
        );
    }

    /// `:info` on an unknown channel gives the same generic refusal every
    /// other channel command does, captured live.
    #[test]
    fn a_channel_info_refusal_is_the_generic_one() {
        let line = "Channel 'nosuchchannel2923' does not exist";
        assert_eq!(
            hear_chanserv(AdminShape::ChannelInfo, Some("nosuchchannel2923"), &[line]),
            vec![refused(line)]
        );
    }

    /// `:showip`, captured live with both overrides set. `none` is how
    /// `ChanServ.py` writes an unset override.
    #[test]
    fn show_ip_is_two_lines() {
        assert_eq!(
            hear_chanserv(
                AdminShape::ShowIp,
                None,
                &[
                    "Server online IP: 127.0.0.1 (override: 127.0.0.1)",
                    "Server local IP: 192.168.1.4 (override: none)",
                ],
            ),
            vec![
                Heard::Collected,
                Heard::Finished(AdminReply::ShowIp {
                    online_ip: "127.0.0.1".into(),
                    online_override: Some("127.0.0.1".into()),
                    local_ip: "192.168.1.4".into(),
                    local_override: None,
                }),
            ]
        );
        let line = "You must be a moderator or admin to view server IP configuration";
        assert_eq!(
            hear_chanserv(AdminShape::ShowIp, None, &[line]),
            vec![refused(line)]
        );
        // The local line alone is not an answer.
        assert_eq!(
            hear_chanserv(
                AdminShape::ShowIp,
                None,
                &["Server local IP: 192.168.1.4 (override: none)"]
            ),
            vec![Heard::NotOurs]
        );
    }

    /// A ChanServ from before `:showip` and `:refreship` reads the command as
    /// a channel command with no channel.
    #[test]
    fn an_older_chanserv_says_it_has_no_server_address_commands() {
        for (shape, command) in [
            (AdminShape::ShowIp, "showip"),
            (AdminShape::RefreshIp, "refreship"),
        ] {
            assert_eq!(
                hear_chanserv(shape, None, &["Channel not specified"]),
                vec![refused(&format!(
                    "This server's ChanServ has no :{command} command."
                ))]
            );
        }
    }

    /// `:refreship` answers straight away and again when the lookup ends.
    /// The pinned start line and the unchanged result were captured live. The
    /// others are from `ChanServ.py`.
    #[test]
    fn refresh_ip_is_two_lines() {
        let pinned = "Refreshing server IP. Note ONLINE_IP/--onlineip is pinned to 127.0.0.1, so the online IP will not change.";
        let unchanged = "IP refresh complete. Unchanged: online 127.0.0.1, local 127.0.0.1";
        assert_eq!(
            hear_chanserv(AdminShape::RefreshIp, None, &[pinned, unchanged]),
            vec![
                Heard::Collected,
                Heard::Finished(AdminReply::RefreshIp {
                    started: pinned.into(),
                    result: Some(unchanged.into()),
                    failed: false,
                }),
            ]
        );

        let started = "Refreshing server IP (current: 203.0.113.7). This may take a few seconds...";
        let changed = "IP refresh complete. Online IP 203.0.113.7 -> 198.51.100.4 (local 10.0.0.2). New battles will advertise the updated address; battles already open must be rehosted.";
        assert_eq!(
            hear_chanserv(AdminShape::RefreshIp, None, &[started, "hello", changed]),
            vec![
                Heard::Collected,
                Heard::NotOurs,
                Heard::Finished(AdminReply::RefreshIp {
                    started: started.into(),
                    result: Some(changed.into()),
                    failed: false,
                }),
            ]
        );

        let failed = "IP refresh failed: timed out";
        assert_eq!(
            hear_chanserv(AdminShape::RefreshIp, None, &[started, failed]),
            vec![
                Heard::Collected,
                Heard::Finished(AdminReply::RefreshIp {
                    started: started.into(),
                    result: Some(failed.into()),
                    failed: true,
                }),
            ]
        );
    }

    /// A result with no start line before it belongs to an earlier refresh.
    #[test]
    fn a_refresh_result_before_the_start_is_not_ours() {
        assert_eq!(
            hear_chanserv(
                AdminShape::RefreshIp,
                None,
                &["IP refresh complete. Unchanged: online 127.0.0.1, local 127.0.0.1"]
            ),
            vec![Heard::NotOurs]
        );
    }

    #[test]
    fn refresh_ip_refusals() {
        // The first was captured live from a moderator.
        for line in [
            "You must be an admin to refresh the server IP",
            "An IP refresh is already in progress, please wait.",
        ] {
            assert_eq!(
                hear_chanserv(AdminShape::RefreshIp, None, &[line]),
                vec![refused(line)]
            );
        }
    }

    /// A refresh that started but never reported is still an answer when the
    /// wait runs out, with no result. One that never started is not.
    #[test]
    fn a_refresh_with_no_result_is_answered_at_the_deadline() {
        let started = "Refreshing server IP (current: 203.0.113.7). This may take a few seconds...";
        let mut c = AdminCollector::new(AdminShape::RefreshIp);
        assert_eq!(c.hear_chanserv(started), Heard::Collected);
        assert_eq!(
            c.give_up(),
            Some(AdminReply::RefreshIp {
                started: started.into(),
                result: None,
                failed: false,
            })
        );
        assert_eq!(AdminCollector::new(AdminShape::RefreshIp).give_up(), None);
        let (collector, _) = (
            {
                let mut c = AdminCollector::new(AdminShape::ShowIp);
                c.hear_chanserv("Server online IP: 127.0.0.1 (override: none)");
                c
            },
            (),
        );
        assert_eq!(
            collector.give_up(),
            None,
            "half of :showip is not an answer"
        );
    }

    #[test]
    fn which_shapes_chanserv_answers() {
        for shape in [
            AdminShape::RegisterChannel,
            AdminShape::UnregisterChannel,
            AdminShape::ChannelHistory,
            AdminShape::ChannelAntispam,
            AdminShape::ChannelBanList,
            AdminShape::ChannelMuteList,
            AdminShape::ChannelUnban,
            AdminShape::ChannelUnmute,
            AdminShape::ChannelInfo,
        ] {
            assert!(shape.is_chanserv(), "{shape:?}");
            assert!(shape.names_channel(), "{shape:?}");
        }
        for shape in [AdminShape::ShowIp, AdminShape::RefreshIp] {
            assert!(shape.is_chanserv(), "{shape:?}");
            assert!(!shape.names_channel(), "{shape:?}");
        }
        assert!(!AdminShape::BanList.is_chanserv());
        assert!(!AdminShape::BanList.names_channel());
    }

    /// The frontend reads these by field name, so the names are part of the
    /// contract with `adminCommand.ts`.
    #[test]
    fn a_reply_serialises_with_camel_case_fields() {
        let json = serde_json::to_value(AdminReply::UserInfo {
            info: UserInfo::Account(Box::new(AccountDetails {
                user_id: "1".into(),
                last_login: "x".into(),
                ..Default::default()
            })),
        })
        .unwrap();
        assert_eq!(json["shape"], "userInfo");
        assert_eq!(json["info"]["kind"], "account");
        assert_eq!(json["info"]["userId"], "1");
        assert_eq!(json["info"]["lastLogin"], "x");
        assert_eq!(
            serde_json::from_str::<AdminShape>("\"ipSearch\"").unwrap(),
            AdminShape::IpSearch
        );
    }

    /// Caught live (issue #2923): the wire genuinely sent
    /// `history_on`/`antispam_on`, not `historyOn`/`antispamOn`, because the
    /// enum's `rename_all` only renamed the `shape` tag value, never a
    /// struct variant's own field names. The frontend read `undefined` and
    /// rendered both switches as off no matter the channel's real setting.
    /// Now covered by `rename_all_fields` on the enum, kept as its own test
    /// since it is what was caught live.
    #[test]
    fn channel_info_fields_serialise_as_camel_case() {
        let json = serde_json::to_value(AdminReply::ChannelInfo {
            channel: "main".into(),
            history_on: true,
            antispam_on: false,
        })
        .unwrap();
        assert_eq!(json["historyOn"], true);
        assert_eq!(json["antispamOn"], false);
        assert!(json.get("history_on").is_none());
        assert!(json.get("antispam_on").is_none());
    }

    /// A regression net for the whole enum, so a future variant or field with
    /// the same `rename_all`-does-not-reach-variant-fields mistake fails a
    /// test instead of shipping quietly, the way `ShowIp` and
    /// `CreateBotAccount.from_username` did (issue #2938).
    #[test]
    fn every_admin_reply_variant_serialises_with_no_snake_case_key() {
        fn assert_no_snake_case_keys(value: &serde_json::Value, path: &str) {
            match value {
                serde_json::Value::Object(map) => {
                    for (key, v) in map {
                        assert!(
                            !key.contains('_'),
                            "snake_case key {key:?} at {path} in {value}"
                        );
                        assert_no_snake_case_keys(v, &format!("{path}.{key}"));
                    }
                }
                serde_json::Value::Array(items) => {
                    for (i, v) in items.iter().enumerate() {
                        assert_no_snake_case_keys(v, &format!("{path}[{i}]"));
                    }
                }
                _ => {}
            }
        }

        let samples = vec![
            AdminReply::BanList {
                entries: vec![BanEntry {
                    username: Some("Spammer".into()),
                    ip: Some("203.0.113.7".into()),
                    email: Some("spam@example.com".into()),
                    reason: "flooding".into(),
                    ends: "2026-10-01".into(),
                    issuer: "Moderator".into(),
                }],
            },
            AdminReply::Blacklist {
                entries: vec![BlacklistEntry {
                    domain: "mailinator.com".into(),
                    reason: "disposable".into(),
                    issuer: "Moderator".into(),
                }],
            },
            AdminReply::UserInfo {
                info: UserInfo::Account(Box::default()),
            },
            AdminReply::UserInfo {
                info: UserInfo::Bridged(Box::default()),
            },
            AdminReply::UserInfo {
                info: UserInfo::Missing {
                    username: "Nobody".into(),
                },
            },
            AdminReply::UserInfo {
                info: UserInfo::BridgedMissing {
                    username: "Nobody:discord".into(),
                },
            },
            AdminReply::UserInfo {
                info: UserInfo::Static {
                    username: "ChanServ".into(),
                },
            },
            AdminReply::IpLookup {
                binding: IpBinding {
                    username: "Alice".into(),
                    address: "203.0.113.7".into(),
                    online: true,
                    last_seen: Some("Sep 16, 2026".into()),
                },
            },
            AdminReply::IpSearch {
                bindings: vec![IpBinding {
                    username: "Alice".into(),
                    address: "203.0.113.7".into(),
                    online: false,
                    last_seen: None,
                }],
            },
            AdminReply::BotMode {
                username: "Autohost1".into(),
                bot: true,
            },
            AdminReply::CreateBotAccount {
                username: "Autohost1".into(),
                from_username: "Alice".into(),
                founder: Some("Alice".into()),
            },
            AdminReply::Kick {
                username: "Spammer".into(),
                kicked: true,
            },
            AdminReply::Ban {
                success: true,
                message: "Successfully banned Spammer for 7 days.".into(),
            },
            AdminReply::BanSpecific {
                success: true,
                message: "Successfully banned Spammer for 7 days".into(),
            },
            AdminReply::Unban {
                success: true,
                message: "Successfully removed 1 bans relating to Spammer".into(),
            },
            AdminReply::BlacklistDomain {
                success: true,
                message: "Successfully added test2784.invalid to blacklist".into(),
            },
            AdminReply::UnblacklistDomain {
                success: true,
                message: "Sucessfully removed test2784.invalid from blacklist".into(),
            },
            AdminReply::ResetUserPassword {
                success: true,
                message: "An email was sent to 'a@b.c' containing a new password for <Alice>"
                    .into(),
            },
            AdminReply::SetMinSpringVersion {
                version: "105.0".into(),
            },
            AdminReply::Stats,
            AdminReply::Reload {
                success: true,
                message: "Reload successful".into(),
            },
            AdminReply::Cleanup {
                message: "Cleanup complete: 0 deletions, 0 mismatches".into(),
            },
            AdminReply::ListMods {
                admins: vec!["cbadmin".into()],
                mods: vec!["cbmod".into()],
            },
            AdminReply::SetAccess {
                success: true,
                message: String::new(),
            },
            AdminReply::RegisterChannel {
                channel: "main".into(),
                founder: "cbmod".into(),
            },
            AdminReply::UnregisterChannel {
                channel: "main".into(),
            },
            AdminReply::ChannelHistory {
                channel: "main".into(),
                on: true,
            },
            AdminReply::ChannelAntispam {
                channel: "main".into(),
                on: true,
            },
            AdminReply::ChannelBanList {
                entries: vec![ChannelBanEntry {
                    username: "Spammer".into(),
                    ip: Some("203.0.113.7".into()),
                    reason: "flooding".into(),
                    ends: "2026-10-01".into(),
                    issuer: "Moderator".into(),
                }],
            },
            AdminReply::ChannelMuteList {
                entries: vec![ChannelMuteEntry {
                    username: "Spammer".into(),
                    reason: "flooding".into(),
                    ends: "2026-10-01".into(),
                    issuer: "Moderator".into(),
                }],
            },
            AdminReply::ChannelUnban {
                channel: "main".into(),
                username: "Spammer".into(),
            },
            AdminReply::ChannelUnmute {
                channel: "main".into(),
                username: "Spammer".into(),
            },
            AdminReply::ChannelInfo {
                channel: "main".into(),
                history_on: true,
                antispam_on: false,
            },
            AdminReply::ShowIp {
                online_ip: "203.0.113.7".into(),
                online_override: Some("198.51.100.4".into()),
                local_ip: "10.0.0.2".into(),
                local_override: None,
            },
            AdminReply::RefreshIp {
                started: "Refreshing server IP".into(),
                result: Some("IP refresh complete.".into()),
                failed: false,
            },
            AdminReply::DeleteAccount {
                refusal: None,
                ban_message: Some(
                    "Successfully banned trash2787a@example.com for 28.0 days".into(),
                ),
                kicked: Some(true),
                scheduled: Some("Account deletion of <trash2787a> scheduled by <cbadmin>".into()),
            },
        ];

        for sample in samples {
            let json = serde_json::to_value(&sample).unwrap();
            assert_no_snake_case_keys(&json, "$");
        }
    }
}
