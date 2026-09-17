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
    /// `BROADCAST`, `BROADCASTEX`, `ADMINBROADCAST`: never answered.
    NoReply,
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
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "shape", rename_all = "camelCase")]
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
}

/// Reads the `SERVERMSG` lines that answer one command.
#[derive(Clone, Debug)]
pub struct AdminCollector {
    shape: AdminShape,
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
}

/// The lines after the first of a normal account's answer.
const ACCOUNT_LINES: usize = 7;
/// The lines after the first of a bridged account's answer.
const BRIDGED_LINES: usize = 2;

impl AdminCollector {
    pub fn new(shape: AdminShape) -> Self {
        Self {
            shape,
            progress: Progress::Waiting,
        }
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
            _ => None,
        }
    }
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
}
