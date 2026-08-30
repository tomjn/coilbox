//! Uberserver's own words for a command it did not run.
//!
//! The lobby protocol gives every command an answer, and a server that has no
//! answer for one is supposed to say nothing. Uberserver does not stay silent.
//! It writes a sentence back naming the command, and that sentence arrives in
//! milliseconds where a wait for the answer that is never coming takes twenty
//! seconds to reach the same conclusion.
//!
//! Three of coilbox's commands are waited on that way, so this is the one place
//! that knows what the sentence looks like.
//!
//! ## The shape
//!
//! Uberserver rejects every command it will not run with `<COMMAND> failed.
//! <reason>`, written from three places in `_handle` in `protocol/Protocol.py`:
//! an unknown command, a command the client's access level does not reach, and
//! one with the wrong number of arguments. The command is upper-cased before it
//! is written in, so it is the word coilbox sent, character for character. All
//! three mean the same thing to a caller waiting on an answer, which is that
//! the command did not run.
//!
//! So this matches the shape, not a sentence. Everything after `failed.` is the
//! reason, and the reason is handed back rather than read, because it is
//! written for a person and this is not the place to decide what it means.
//!
//! Observed on 30 August 2026 on all three uberservers coilbox ships with,
//! sending the line unauthenticated:
//!
//! ```text
//! SERVERMSG MOVERELAYEDHOST failed. Unknown command. (args='198.51.100.9 30002')
//! ```
//!
//! `lobby.springrts.com:8200` (0.38-84-gc8386e9), `lobby.techa-rts.com:8200`
//! (0.38-95-gf595963) and `lobby.recoilengine.org:8200` (version `unknown`) all
//! answered with that line and nothing else.
//!
//! ## Why this is not in `coilbox-lobby-protocol`
//!
//! That crate is the protocol, and it deliberately never reads a refusal's
//! words. This is one implementation's wording for something the protocol gives
//! no line to, and reading it is a judgement each caller makes for itself.
//!
//! ## What it deliberately does not cover
//!
//! Teiserver, which words the same thing as `No incomming match for <COMMAND>
//! with data ...` in `_no_match` in `spring_in.ex`, so the command is not first
//! and nothing here can fire on it. Coilbox never sends it any of these lines:
//! [`crate::turn::credentials`] refuses a credential on a server whose
//! compatibility flags lack `r`, and Teiserver's are `sp teiserver matchmaking
//! token-auth`, confirmed against `server4.beyondallreason.info:8201` on
//! 30 August 2026. A server that words its rejection differently is a server
//! nothing here matches, which leaves the wait to run its full length: today's
//! behaviour, and the reason this is safe to be wrong about.

use coilbox_lobby_protocol::Delta;

/// Uberserver's reason for not running `command`, if that is what this delta
/// is.
///
/// `command` is the word coilbox sends, taken from the constant the line is
/// built from rather than typed out, so a renamed command cannot leave this
/// looking for one nobody sends.
///
/// ## What makes it safe to act on
///
/// Not that the sentence is fixed, but when it is read. Every caller only acts
/// on this while it has that command outstanding, which is the seconds between
/// the line being queued and the lobby answering it. Inside that window a
/// `SERVERMSG` opening `<COMMAND> failed.` can only have come from our line,
/// because `out_SERVERMSG` writes to one client and no other client's command
/// reaches us.
///
/// The two ways it can be wrong are not the same size. A reworded rejection
/// stops matching and the caller waits as long as it does today. A wrong fire
/// would act on an answer nobody sent. The window is what rules the second one
/// out, and it belongs to the caller rather than to this function.
pub(crate) fn rejection_of<'a>(delta: &'a Delta, command: &str) -> Option<&'a str> {
    // `boxed` is whether the server asked for a dialog rather than a line in
    // the log, which is about how it is shown and not about what it means.
    let Delta::ServerMessage { text, .. } = delta else {
        return None;
    };
    // The space is what stops `TURNCREDENTIALS` matching a rejection of some
    // longer command that starts with the same letters.
    let reason = text.strip_prefix(command)?.strip_prefix(" failed.")?;
    Some(reason.trim())
}

#[cfg(test)]
mod tests {
    use super::*;
    use coilbox_lobby_protocol::command;

    /// A `SERVERMSG` in uberserver's rejection shape.
    fn said(text: &str) -> Delta {
        Delta::ServerMessage {
            text: text.to_string(),
            boxed: false,
        }
    }

    /// The three reasons uberserver has, on each of the three commands coilbox
    /// waits for an answer to. Every one of them means the command did not run,
    /// which is why the reason is carried out rather than read here.
    #[test]
    fn every_reason_uberserver_has_is_a_command_that_did_not_run() {
        for command in [
            command::TURN_CREDENTIALS,
            command::RELAYED_HOST,
            command::MOVE_RELAYED_HOST,
        ] {
            for reason in [
                "Unknown command. (args='198.51.100.9 30002')",
                "Insufficient rights.",
                "Incorrect arguments.",
            ] {
                assert_eq!(
                    rejection_of(&said(&format!("{command} failed. {reason}")), command),
                    Some(reason),
                    "for {command}"
                );
            }
        }
    }

    /// A rejection of somebody else's command is not ours, and the pair that
    /// could be confused for one another are the two relay host commands: one
    /// name ends with the other. Reading a move's rejection as an advertise's
    /// would tell a host their battle never opened while it is being played.
    #[test]
    fn a_rejection_of_another_command_is_not_this_one() {
        assert_eq!(
            rejection_of(
                &said("MOVERELAYEDHOST failed. Unknown command."),
                command::RELAYED_HOST
            ),
            None
        );
        assert_eq!(
            rejection_of(
                &said("RELAYEDHOST failed. Unknown command."),
                command::MOVE_RELAYED_HOST
            ),
            None
        );
        assert_eq!(
            rejection_of(
                &said("TURNCREDENTIALSFAILED failed. Unknown command."),
                command::TURN_CREDENTIALS
            ),
            None,
            "the space after the command is what keeps a longer name from matching"
        );
    }

    /// A `SERVERMSG` is a general-purpose announcement written for a person, and
    /// almost none of them are a rejection of anything. Only a line that opens
    /// with the command and the word failed is the server refusing ours.
    #[test]
    fn an_ordinary_server_message_is_not_a_rejection() {
        for text in [
            "Maintenance in 5 minutes",
            "RELAYEDHOST is now supported on this server",
            "Your RELAYEDHOST failed. Unknown command.",
            "RELAYEDHOST worked. ",
        ] {
            assert_eq!(
                rejection_of(&said(text), command::RELAYED_HOST),
                None,
                "for {text}"
            );
        }
    }

    /// Everything else the lobby sends is somebody else's line entirely. A
    /// delta that is not a server message cannot carry one of these, whatever
    /// text it happens to hold.
    #[test]
    fn a_delta_that_is_not_a_server_message_carries_no_rejection() {
        assert_eq!(
            rejection_of(
                &Delta::OpenBattleFailed {
                    reason: "RELAYEDHOST failed. Unknown command.".to_string()
                },
                command::RELAYED_HOST
            ),
            None
        );
    }
}
