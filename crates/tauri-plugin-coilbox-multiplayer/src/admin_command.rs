//! Moderator and admin commands on an uberserver connection, one at a time,
//! and the lines that answer each.
//!
//! Every tool on the Server admin page sends an ordinary lobby command and
//! waits for uberserver's answer, which is mostly `SERVERMSG` lines written for
//! a person. Three things about those lines decide how this works.
//!
//! - Nothing ties a line to the command it answers. uberserver's `#id` is kept
//!   on the client and stamped on every line until our next command, broadcasts
//!   included (ScarylePoo/uberserver#60), so it cannot be used.
//! - Several handlers answer from a database callback, so a slow answer can land
//!   after the answer to a command sent later. A trailing `PING` is no end
//!   marker for the same reason. So only one command is on the wire at a time,
//!   and the next is written when the one before has answered or timed out.
//! - Other `SERVERMSG` lines still arrive meanwhile. Each line is offered to
//!   the collector for the shape the command expects, and a line it does not
//!   take goes to the frontend as usual, as a toast.
//!
//! The queue lives in the connection task rather than the frontend store. The
//! task is the one place that sees every line in order, so a line that answers a
//! command can be kept from the frontend entirely, rather than filtered out of
//! the toast path and the `CHANGEPASSWORD` waiter separately. It is also per
//! connection by construction: each connection has its own task, so one
//! server's lines never reach another server's queue.

use std::collections::VecDeque;
use std::time::Duration;

use coilbox_lobby_protocol::{command, AdminCollector, AdminReply, AdminShape, Delta, Heard};
use serde::Serialize;
use tokio::sync::oneshot;
use tokio::time::Instant;

use crate::conn::{ConnProtocol, Outbound, Registry};
use crate::lock_or_recover;
use crate::uberserver::{rejection_of, server_error_of};

/// How long a command waits for its answer before the silence is the answer.
///
/// The same wait as [`crate::conn::READY_TIMEOUT`] and the store's
/// `SERVER_REPLY_TIMEOUT_MS`, for the same reason: generous for a real server
/// behind a slow link, and bounded. `FINDIP` has no end marker, so every
/// `FINDIP` takes this long.
pub const ADMIN_REPLY_TIMEOUT: Duration = crate::conn::READY_TIMEOUT;

/// How a command ended.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "outcome", rename_all = "camelCase")]
pub enum AdminOutcome {
    Answered {
        reply: AdminReply,
    },
    /// The server would not run it, in its own words.
    Refused {
        reason: String,
    },
    /// Nothing arrived in time. For a command that is only answered when it
    /// finds something, or never answered at all, this is the answer.
    Unanswered,
}

/// A command waiting its turn.
pub struct AdminRequest {
    /// The command word as uberserver names it in a refusal.
    pub command: String,
    pub line: String,
    pub shape: AdminShape,
    pub patience: Duration,
    pub answer: oneshot::Sender<AdminOutcome>,
}

/// Build the wire line for `command` and `args`, returning the upper-cased
/// command word with it.
///
/// uberserver gathers every word after the last required argument into the
/// last one, so only the last argument may hold spaces (a ban reason, a
/// broadcast). Any other with a space in it would move the rest along.
pub fn admin_line(command: &str, args: &[String]) -> Result<(String, String), String> {
    if command.is_empty() || !command.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err(format!("not a command name: {command:?}"));
    }
    let word = command.to_ascii_uppercase();
    if let Some((_, leading)) = args.split_last() {
        if leading
            .iter()
            .any(|a| a.is_empty() || !command::fits_one_field(a))
        {
            return Err("only the last argument can be empty or contain spaces".to_string());
        }
    }
    let line = std::iter::once(word.as_str())
        .chain(args.iter().map(String::as_str))
        .collect::<Vec<_>>()
        .join(" ");
    if !command::is_wire_safe(&line) {
        return Err("refusing to send a line containing a line break".to_string());
    }
    Ok((word, line))
}

/// Queue `command` on the connection under `server_key` and wait for its
/// outcome.
pub async fn send(
    registry: &Registry,
    server_key: &str,
    command: &str,
    args: &[String],
    shape: AdminShape,
    patience: Duration,
) -> Result<AdminOutcome, String> {
    let (word, line) = admin_line(command, args)?;
    let (answer, answered) = oneshot::channel();
    {
        let map = lock_or_recover(registry);
        let conn = map
            .get(server_key)
            .ok_or_else(|| format!("not connected: {server_key}"))?;
        if conn.protocol != ConnProtocol::TasServer {
            return Err("this server does not speak the TASServer line protocol".to_string());
        }
        conn.tx
            .send(Outbound::Admin(AdminRequest {
                command: word,
                line,
                shape,
                patience,
                answer,
            }))
            .map_err(|_| "connection is closed".to_string())?;
    }
    answered
        .await
        .map_err(|_| "the connection ended before the server answered".to_string())
}

/// What the queue made of one delta.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Hearing {
    /// The delta answers the command, so the frontend is not sent it.
    pub claimed: bool,
    /// The next command's line, now that it is its turn.
    pub send: Option<String>,
}

/// The command on the wire.
struct InFlight {
    command: String,
    collector: AdminCollector,
    answer: oneshot::Sender<AdminOutcome>,
    deadline: Instant,
}

/// One connection's admin commands.
#[derive(Default)]
pub struct AdminQueue {
    waiting: VecDeque<AdminRequest>,
    current: Option<InFlight>,
    /// A command just refused by a `<COMMAND> failed.` sentence. uberserver
    /// follows that sentence with a tagged `FAILED` for the same refusal, which
    /// is the very next line and belongs to the same answer.
    echo: Option<String>,
}

impl AdminQueue {
    /// Queue a request, returning its line if nothing is ahead of it.
    pub fn push(&mut self, request: AdminRequest, now: Instant) -> Option<String> {
        self.waiting.push_back(request);
        self.start_next(now)
    }

    /// When the command on the wire gives up.
    pub fn deadline(&self) -> Option<Instant> {
        self.current.as_ref().map(|c| c.deadline)
    }

    /// Offer one delta to the command on the wire.
    pub fn hear(&mut self, delta: &Delta, now: Instant) -> Hearing {
        if let Some(echoed) = self.echo.take() {
            if matches!(delta, Delta::CommandFailed { command, .. } if command.eq_ignore_ascii_case(&echoed))
            {
                return Hearing {
                    claimed: true,
                    send: None,
                };
            }
        }
        let Some(current) = self.current.as_mut() else {
            return Hearing::default();
        };
        let outcome = match delta {
            Delta::ServerMessage { text, .. } => {
                if let Some(reason) = rejection_of(delta, &current.command) {
                    self.echo = Some(current.command.clone());
                    AdminOutcome::Refused {
                        reason: reason.to_string(),
                    }
                } else if let Some(reason) = server_error_of(delta, &current.command) {
                    AdminOutcome::Refused {
                        reason: reason.to_string(),
                    }
                } else {
                    match current.collector.hear(text) {
                        Heard::NotOurs => return Hearing::default(),
                        Heard::Collected => {
                            return Hearing {
                                claimed: true,
                                send: None,
                            }
                        }
                        Heard::Finished(reply) => AdminOutcome::Answered { reply },
                    }
                }
            }
            Delta::CommandFailed { command, reason }
                if command.eq_ignore_ascii_case(&current.command) =>
            {
                AdminOutcome::Refused {
                    reason: reason.clone(),
                }
            }
            _ => return Hearing::default(),
        };
        Hearing {
            claimed: true,
            send: self.finish(outcome, now),
        }
    }

    /// End the command on the wire if its wait is over.
    pub fn expire(&mut self, now: Instant) -> Option<String> {
        let current = self.current.take_if(|c| now >= c.deadline)?;
        let outcome = match current.collector.give_up() {
            Some(reply) => AdminOutcome::Answered { reply },
            None => AdminOutcome::Unanswered,
        };
        let _ = current.answer.send(outcome);
        self.start_next(now)
    }

    /// Hand `outcome` to the command on the wire and start the next.
    fn finish(&mut self, outcome: AdminOutcome, now: Instant) -> Option<String> {
        if let Some(current) = self.current.take() {
            // A caller that stopped waiting has nothing to be told.
            let _ = current.answer.send(outcome);
        }
        self.start_next(now)
    }

    fn start_next(&mut self, now: Instant) -> Option<String> {
        if self.current.is_some() {
            return None;
        }
        let request = self.waiting.pop_front()?;
        self.current = Some(InFlight {
            command: request.command,
            collector: AdminCollector::new(request.shape),
            answer: request.answer,
            deadline: now + request.patience,
        });
        Some(request.line)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const PATIENCE: Duration = Duration::from_secs(20);

    fn said(text: &str) -> Delta {
        Delta::ServerMessage {
            text: text.to_string(),
            boxed: false,
        }
    }

    fn request(
        command: &str,
        shape: AdminShape,
    ) -> (AdminRequest, oneshot::Receiver<AdminOutcome>) {
        let (answer, answered) = oneshot::channel();
        (
            AdminRequest {
                command: command.to_string(),
                line: command.to_string(),
                shape,
                patience: PATIENCE,
                answer,
            },
            answered,
        )
    }

    fn claimed() -> Hearing {
        Hearing {
            claimed: true,
            send: None,
        }
    }

    #[test]
    fn the_first_command_is_written_straight_away() {
        let mut queue = AdminQueue::default();
        let now = Instant::now();
        let (listbans, _answered) = request("LISTBANS", AdminShape::BanList);
        assert_eq!(queue.push(listbans, now), Some("LISTBANS".to_string()));
        assert_eq!(queue.deadline(), Some(now + PATIENCE));
    }

    #[test]
    fn a_line_with_no_command_waiting_is_not_claimed() {
        let mut queue = AdminQueue::default();
        assert_eq!(
            queue.hear(&said("Banlist is empty"), Instant::now()),
            Hearing::default()
        );
    }

    /// uberserver refuses with the sentence and then the tagged line. Both are
    /// the refusal, so neither becomes a toast.
    #[test]
    fn a_refusal_is_the_servers_reason_and_neither_line_is_shown() {
        let mut queue = AdminQueue::default();
        let now = Instant::now();
        let (listbans, mut answered) = request("LISTBANS", AdminShape::BanList);
        queue.push(listbans, now);

        assert_eq!(
            queue.hear(&said("LISTBANS failed. Insufficient rights."), now),
            claimed()
        );
        assert_eq!(
            queue.hear(
                &Delta::CommandFailed {
                    command: "LISTBANS".to_string(),
                    reason: "Insufficient rights.".to_string(),
                },
                now
            ),
            claimed()
        );
        assert_eq!(
            answered.try_recv(),
            Ok(AdminOutcome::Refused {
                reason: "Insufficient rights.".to_string()
            })
        );
        assert_eq!(queue.deadline(), None);
    }

    /// `CREATEBOTACCOUNT` refuses with the tagged line alone, with no
    /// preceding `<COMMAND> failed.` sentence.
    #[test]
    fn a_tagged_refusal_on_its_own_is_a_refusal() {
        let mut queue = AdminQueue::default();
        let now = Instant::now();
        let (create, mut answered) = request("CREATEBOTACCOUNT", AdminShape::CreateBotAccount);
        queue.push(create, now);
        assert_eq!(
            queue.hear(
                &Delta::CommandFailed {
                    command: "CREATEBOTACCOUNT".to_string(),
                    reason: "Invalid username 'x y'".to_string(),
                },
                now
            ),
            claimed()
        );
        assert_eq!(
            answered.try_recv(),
            Ok(AdminOutcome::Refused {
                reason: "Invalid username 'x y'".to_string()
            })
        );
    }

    /// `CREATEBOTACCOUNT`'s success line is claimed and answered like any
    /// other `SERVERMSG` reply.
    #[test]
    fn a_create_bot_account_success_is_claimed() {
        let mut queue = AdminQueue::default();
        let now = Instant::now();
        let (create, mut answered) = request("CREATEBOTACCOUNT", AdminShape::CreateBotAccount);
        queue.push(create, now);
        assert_eq!(
            queue.hear(
                &said(
                    "A new bot account <Autohost1> has been created, with the same password as <Alice>"
                ),
                now
            ),
            claimed()
        );
        assert_eq!(
            answered.try_recv(),
            Ok(AdminOutcome::Answered {
                reply: AdminReply::CreateBotAccount {
                    username: "Autohost1".to_string(),
                    from_username: "Alice".to_string(),
                    founder: None,
                }
            })
        );
    }

    /// Somebody else's refusal is not this command's, and still shows.
    #[test]
    fn another_commands_refusal_is_not_claimed() {
        let mut queue = AdminQueue::default();
        let now = Instant::now();
        let (listbans, mut answered) = request("LISTBANS", AdminShape::BanList);
        queue.push(listbans, now);
        assert_eq!(
            queue.hear(&said("JOIN failed. Incorrect arguments."), now),
            Hearing::default()
        );
        assert_eq!(
            queue.hear(
                &Delta::CommandFailed {
                    command: "JOIN".to_string(),
                    reason: "Incorrect arguments.".to_string(),
                },
                now
            ),
            Hearing::default()
        );
        assert!(answered.try_recv().is_err(), "still waiting");
    }

    #[test]
    fn a_database_error_is_a_refusal() {
        let mut queue = AdminQueue::default();
        let now = Instant::now();
        let (findip, mut answered) = request("FINDIP", AdminShape::IpSearch);
        queue.push(findip, now);
        assert_eq!(
            queue.hear(&said("Server error processing FINDIP."), now),
            claimed()
        );
        assert_eq!(
            answered.try_recv(),
            Ok(AdminOutcome::Refused {
                reason: "Server error processing FINDIP.".to_string()
            })
        );
    }

    /// `RESETUSERPASSWORD`'s success line is claimed and answered like any
    /// other `SERVERMSG` reply (issue #2781).
    #[test]
    fn a_reset_user_password_success_is_claimed() {
        let mut queue = AdminQueue::default();
        let now = Instant::now();
        let (reset, mut answered) = request("RESETUSERPASSWORD", AdminShape::ResetUserPassword);
        queue.push(reset, now);
        let line = "An email was sent to 'alice@example.com' containing a new password for <Alice>";
        assert_eq!(queue.hear(&said(line), now), claimed());
        assert_eq!(
            answered.try_recv(),
            Ok(AdminOutcome::Answered {
                reply: AdminReply::ResetUserPassword {
                    success: true,
                    message: line.to_string(),
                }
            })
        );
    }

    /// `_resetuserpassword_failed` writes the same generic database-error
    /// sentence every callback-answered command can send, read by
    /// `server_error_of` rather than by `AdminCollector`.
    #[test]
    fn a_reset_user_password_database_error_is_a_refusal() {
        let mut queue = AdminQueue::default();
        let now = Instant::now();
        let (reset, mut answered) = request("RESETUSERPASSWORD", AdminShape::ResetUserPassword);
        queue.push(reset, now);
        assert_eq!(
            queue.hear(&said("Server error processing RESETUSERPASSWORD."), now),
            claimed()
        );
        assert_eq!(
            answered.try_recv(),
            Ok(AdminOutcome::Refused {
                reason: "Server error processing RESETUSERPASSWORD.".to_string()
            })
        );
    }

    /// When the server has no email account set up, `in_RESETUSERPASSWORD`
    /// throws before sending anything (ScarylePoo/uberserver#58), so
    /// coilbox sees silence and the deadline is the only way this ends.
    #[test]
    fn a_reset_user_password_with_email_off_times_out() {
        let mut queue = AdminQueue::default();
        let now = Instant::now();
        let (reset, mut answered) = request("RESETUSERPASSWORD", AdminShape::ResetUserPassword);
        queue.push(reset, now);
        assert_eq!(queue.expire(now + PATIENCE), None);
        assert_eq!(answered.try_recv(), Ok(AdminOutcome::Unanswered));
    }

    /// A server announcement mid-answer is not part of it, so it goes to the
    /// frontend and becomes a toast as it always did.
    #[test]
    fn an_unrelated_server_message_mid_request_is_not_claimed() {
        let mut queue = AdminQueue::default();
        let now = Instant::now();
        let (listbans, mut answered) = request("LISTBANS", AdminShape::BanList);
        queue.push(listbans, now);

        assert_eq!(queue.hear(&said("-- Banlist --"), now), claimed());
        assert_eq!(
            queue.hear(&said("Server restarting in 5 minutes"), now),
            Hearing::default()
        );
        assert_eq!(
            queue.hear(&Delta::UserAdded { name: "x".into() }, now),
            Hearing::default()
        );
        assert_eq!(queue.hear(&said("-- End Banlist --"), now), claimed());
        assert_eq!(
            answered.try_recv(),
            Ok(AdminOutcome::Answered {
                reply: AdminReply::BanList { entries: vec![] }
            })
        );
    }

    #[test]
    fn silence_until_the_deadline_is_unanswered() {
        let mut queue = AdminQueue::default();
        let now = Instant::now();
        let (getip, mut answered) = request("GETIP", AdminShape::IpLookup);
        queue.push(getip, now);

        assert_eq!(queue.expire(now + PATIENCE / 2), None);
        assert!(answered.try_recv().is_err(), "not yet");
        assert_eq!(queue.expire(now + PATIENCE), None);
        assert_eq!(answered.try_recv(), Ok(AdminOutcome::Unanswered));
        assert_eq!(queue.deadline(), None);
    }

    /// `FINDIP` is only whole when the wait ends.
    #[test]
    fn a_search_that_found_accounts_is_answered_at_the_deadline() {
        let mut queue = AdminQueue::default();
        let now = Instant::now();
        let (findip, mut answered) = request("FINDIP", AdminShape::IpSearch);
        queue.push(findip, now);
        assert_eq!(
            queue.hear(&said("<Alice> is currently bound to 203.0.113.7."), now),
            claimed()
        );
        queue.expire(now + PATIENCE);
        let Ok(AdminOutcome::Answered {
            reply: AdminReply::IpSearch { bindings },
        }) = answered.try_recv()
        else {
            panic!("expected an answered search");
        };
        assert_eq!(bindings.len(), 1);
    }

    /// The second command waits for the first, and is written the moment the
    /// first is answered, so a slow first answer cannot be read as the second's.
    #[test]
    fn two_queued_commands_answer_in_order() {
        let mut queue = AdminQueue::default();
        let now = Instant::now();
        let (listbans, mut bans) = request("LISTBANS", AdminShape::BanList);
        let (getip, mut ip) = request("GETIP", AdminShape::IpLookup);
        assert_eq!(queue.push(listbans, now), Some("LISTBANS".to_string()));
        assert_eq!(queue.push(getip, now), None, "waits its turn");

        // GETIP's answer, arriving while LISTBANS is on the wire, is not
        // LISTBANS's and is not GETIP's either, because GETIP was never sent.
        assert_eq!(
            queue.hear(&said("<Bob> was recently bound to 198.51.100.4"), now),
            Hearing::default()
        );
        assert!(ip.try_recv().is_err());

        let later = now + Duration::from_secs(1);
        assert_eq!(
            queue.hear(&said("Banlist is empty"), later),
            Hearing {
                claimed: true,
                send: Some("GETIP".to_string())
            }
        );
        assert!(matches!(bans.try_recv(), Ok(AdminOutcome::Answered { .. })));
        assert_eq!(queue.deadline(), Some(later + PATIENCE));

        assert_eq!(
            queue.hear(&said("<Bob> was recently bound to 198.51.100.4"), later),
            claimed()
        );
        assert!(matches!(ip.try_recv(), Ok(AdminOutcome::Answered { .. })));
    }

    /// A command that timed out hands the wire to the next.
    #[test]
    fn a_timeout_moves_the_queue_on() {
        let mut queue = AdminQueue::default();
        let now = Instant::now();
        let (broadcast, _b) = request("BROADCAST", AdminShape::NoReply);
        let (listbans, _l) = request("LISTBANS", AdminShape::BanList);
        queue.push(broadcast, now);
        queue.push(listbans, now);
        assert_eq!(queue.expire(now + PATIENCE), Some("LISTBANS".to_string()));
    }

    /// The tagged echo of one refusal is not a refusal of the next command,
    /// even when the next command is the same word.
    #[test]
    fn a_refusal_echo_does_not_refuse_the_next_command() {
        let mut queue = AdminQueue::default();
        let now = Instant::now();
        let (first, _f) = request("LISTBANS", AdminShape::BanList);
        let (second, mut answered) = request("LISTBANS", AdminShape::BanList);
        queue.push(first, now);
        queue.push(second, now);
        assert_eq!(
            queue
                .hear(&said("LISTBANS failed. Insufficient rights."), now)
                .send,
            Some("LISTBANS".to_string())
        );
        assert_eq!(
            queue.hear(
                &Delta::CommandFailed {
                    command: "LISTBANS".to_string(),
                    reason: "Insufficient rights.".to_string(),
                },
                now
            ),
            claimed()
        );
        assert!(answered.try_recv().is_err(), "the second is still waiting");
    }

    #[test]
    fn a_line_is_built_with_only_the_last_argument_free() {
        assert_eq!(
            admin_line(
                "ban",
                &["Spammer".into(), "7".into(), "flooding the channel".into()]
            ),
            Ok((
                "BAN".to_string(),
                "BAN Spammer 7 flooding the channel".to_string()
            ))
        );
        assert_eq!(
            admin_line("LISTBANS", &[]),
            Ok(("LISTBANS".to_string(), "LISTBANS".to_string()))
        );
        assert!(admin_line("BAN", &["two words".into(), "7".into()]).is_err());
        assert!(admin_line("BAN", &["".into(), "7".into()]).is_err());
        assert!(admin_line("BAN X", &[]).is_err());
        assert!(admin_line("", &[]).is_err());
        assert!(admin_line("BROADCAST", &["hi\nEXIT".into()]).is_err());
    }
}
