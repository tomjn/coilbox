//! Taking the secrets out of a wire line before anybody gets to read it.
//!
//! A lobby line is shown to the person using coilbox in the protocol console,
//! and that console is the first thing anybody copies into a bug report when a
//! battle will not open. Most of what crosses the wire is fine there. A relay
//! credential is not: it is a username and a password the relay accepts from
//! whoever holds them, so anybody who is handed the console output is handed the
//! lobby's bandwidth for as long as the credential lives.
//!
//! [`redact_line`] is the one seam. Anything that records, shows or ships a wire
//! line puts it through here first, and gets back a line with the same shape and
//! none of the secrets.
//!
//! # Why this works on the command, not on the value
//!
//! The obvious implementation searches the line for the password it is trying to
//! hide. That only works where the password is already known, which is a test
//! and nowhere else: the thing doing the recording has the line and not the
//! credential. It also hides text that merely happens to match. So this reads
//! the command instead, and knows which of its fields are secret, which is
//! something the wire format fixes and nothing on the wire can change.

use std::borrow::Cow;

use crate::message::{fields, split_command, strip_framing};

/// What stands in for a secret. Wide enough to notice, and not something that
/// could be mistaken for a value the server sent.
const REDACTED: &str = "<redacted>";

/// One wire line with anything secret in it replaced.
///
/// Borrows when there was nothing to take out, which is every line but one.
///
/// The framing is preserved, so a line the server tagged with a message id is
/// still shown with its id. It is also parsed the same way [`crate::parse_line`]
/// parses it, because a redactor that disagreed with the parser about where the
/// command ends would be reading a different line from the one being shown.
pub fn redact_line(line: &str) -> Cow<'_, str> {
    // `strip_framing` takes the `\r` off first and then the `#<id> ` prefix, and
    // both of what it returns are slices of `line`, so what it removed is the
    // head and tail of the original either side of the body.
    let cr = usize::from(line.ends_with('\r'));
    let body = strip_framing(line);
    let prefix = &line[..line.len() - body.len() - cr];
    let suffix = &line[line.len() - cr..];

    let (cmd, rest) = split_command(body);
    match secrets_removed(&cmd, rest) {
        Some(safe) => Cow::Owned(format!("{prefix}{safe}{suffix}")),
        None => Cow::Borrowed(line),
    }
}

/// The body of a line whose command carries a secret, rewritten without it, or
/// `None` for a command that carries none.
///
/// `cmd` is already upper-cased by [`split_command`], and it is matched whole:
/// `TURNCREDENTIALSFAILED` is a different command carrying a refusal written for
/// a person to read, and it keeps every word of it.
fn secrets_removed(cmd: &str, rest: &str) -> Option<String> {
    match cmd {
        "TURNCREDENTIALS" => turn_credentials(rest),
        "LOGIN" | "REGISTER" => password_field(cmd, rest),
        "JOINBATTLE" => join_battle(rest),
        "OPENBATTLE" => open_battle(rest),
        "JOIN" => join_channel(rest),
        _ => None,
    }
}

/// `TURNCREDENTIALS <uri> <username> <password> <ttl_seconds>` without the
/// username and the password.
///
/// The relay's address and the lifetime stay. Somebody working out why their
/// battle will not open needs to know which relay was named and how long the
/// lobby said the credential was good for, and neither of those lets anybody use
/// the relay.
///
/// A line that is not that shape still has to be handled, because the leak is in
/// the text and not in whether it parsed. A username with a space in it moves
/// every field after it along one, which is a line the parser refuses
/// ([`crate::parse_line`] hands it back as `Unknown`) but which still has the
/// password sitting in the middle of it. So the shape is only trusted when it is
/// exactly four fields ending in a number, and anything else gives up
/// everything past the address rather than guessing which part of it is the
/// secret.
fn turn_credentials(rest: &str) -> Option<String> {
    // The client's own ask is the bare command with nothing after it, and there
    // is nothing in that to hide.
    let (uri, _) = rest.split_once(' ')?;
    let well_formed = fields::<4>(rest).filter(|[_, username, password, ttl]| {
        !username.is_empty() && !password.is_empty() && ttl.trim().parse::<u64>().is_ok()
    });
    Some(match well_formed {
        Some([_, _, _, ttl]) => format!("TURNCREDENTIALS {uri} {REDACTED} {REDACTED} {ttl}"),
        None => format!("TURNCREDENTIALS {uri} {REDACTED}"),
    })
}

/// `LOGIN <user> <pass> <cpu> <local_ip> <agent>\t<client_id>\t<flags>` or
/// `REGISTER <user> <pass> [email]`, without the password. Both send
/// `BASE64(MD5(password))` (issue #2044) as their second field, and the
/// server takes that hash as the login itself, so it is the one thing here
/// worth hiding: the account name, the CPU marker, the local IP, the client
/// agent and the compatibility flags on a `LOGIN`, and the email on a
/// `REGISTER`, are all useful to somebody working out why a login or a
/// signup was refused, and none of them lets anybody log in.
///
/// Unlike `TURNCREDENTIALS`, which arrives from the server and so has to be
/// treated as untrusted, both of these are lines coilbox itself builds
/// (`command::login`, `command::register`), so there is no shifted field to
/// defend against. The password is always the second field, bounded by the
/// space either side of it, whatever does or does not follow it. That also
/// means this never has to know the shape of what comes after. It finds the
/// end of the password and keeps everything past it exactly as it was.
fn password_field(cmd: &str, rest: &str) -> Option<String> {
    let (user, remainder) = rest.split_once(' ')?;
    if remainder.is_empty() {
        // No second field made it into the line, e.g. `LOGIN alice`, cut
        // short before the password arrived, so there is nothing to redact.
        return None;
    }
    Some(match remainder.split_once(' ') {
        Some((_password, after)) => format!("{cmd} {user} {REDACTED} {after}"),
        None => format!("{cmd} {user} {REDACTED}"),
    })
}

/// `JOINBATTLE <id> [key] [scriptPassword]`, as `command::join_battle` builds
/// it, without the key or the script password (issue #2046). Anyone holding
/// the key can join a locked room, and the script password is what lets the
/// engine itself treat this client as authenticated, so both are worth
/// hiding. The battle id is not a credential and stays.
///
/// `join_battle` places `*` in the key's slot as a placeholder when there is
/// a script password but no key (its own doc comment says so, and
/// `join_battle_variants` in `command.rs` asserts it). That `*` is the one
/// value the slot can hold without being a secret, so it survives rather
/// than being hidden behind a redaction that would tell a reader a password
/// was there when the wire itself says there was not.
///
/// Nothing in the real protocol ever follows the script password, and
/// nothing here guards against a key with a space in it the way
/// `OPENBATTLE` below does, because there is no field of a known type after
/// it to check the split against. So whatever remains once the key is split
/// off, one field or several, shifted or not, is collapsed into a single
/// redaction rather than reassembled and mislabelled.
fn join_battle(rest: &str) -> Option<String> {
    let (id, after_id) = rest.split_once(' ')?;
    match after_id.split_once(' ') {
        Some((key, _rest)) => {
            let key_shown = if key == "*" { "*" } else { REDACTED };
            Some(format!("JOINBATTLE {id} {key_shown} {REDACTED}"))
        }
        // A lone key with nothing after it. `*` there is the same
        // placeholder as above and never itself a secret.
        None if after_id == "*" => None,
        None => Some(format!("JOINBATTLE {id} {REDACTED}")),
    }
}

/// `OPENBATTLE <type> <natType> <key> <port> <maxplayers> <modhash> <rank>
/// <maphash> <engine>\t<version>\t<map>\t<title>\t<modname>`, as
/// `command::open_battle` builds it, without the key (issue #2046). This is
/// the host's side of the same room password `JOINBATTLE` carries on the
/// joiner's side. The type, the NAT mode, the port, the content hashes, the
/// engine, the map and the title are all things somebody working out why a
/// battle would not open needs to see, and none of them lets anybody into
/// the room, so all of them stay.
///
/// `open_battle`'s own test proves a key with a space in it shifts every
/// field after it along by one
/// (`a_room_password_with_a_space_moves_every_field_after_it`), which is
/// exactly the `TURNCREDENTIALS` problem. A plain split would echo half the
/// password back out mislabelled as the port. So the five fields after the
/// key are checked against the types `open_battle` always sends before they
/// are trusted, and a line that fails the check gives up everything from
/// the key onward rather than mislabel a fragment of it.
fn open_battle(rest: &str) -> Option<String> {
    let (battle_type, after_type) = rest.split_once(' ')?;
    let (nat_type, after_nat) = after_type.split_once(' ')?;
    let well_formed =
        fields::<7>(after_nat).filter(|[_key, port, max_players, modhash, rank, maphash, _tail]| {
            port.parse::<u16>().is_ok()
                && max_players.parse::<u32>().is_ok()
                && modhash.parse::<i32>().is_ok()
                && rank.parse::<u8>().is_ok()
                && maphash.parse::<i32>().is_ok()
        });
    Some(match well_formed {
        Some([key, port, max_players, modhash, rank, maphash, tail]) => {
            let key_shown = if key == "*" { "*" } else { REDACTED };
            format!(
                "OPENBATTLE {battle_type} {nat_type} {key_shown} {port} {max_players} {modhash} {rank} {maphash} {tail}"
            )
        }
        None => format!("OPENBATTLE {battle_type} {nat_type} {REDACTED}"),
    })
}

/// `JOIN <chan> [key]`, as `command::join_channel` builds it, without the
/// key (issue #2048). Whoever holds the key can join a locked channel they
/// were not invited to, the same as the room key `JOINBATTLE` carries on
/// the battle side. The channel name is not a credential and stays.
///
/// Unlike `JOINBATTLE`, `join_channel` never puts a placeholder in the
/// key's slot: a channel with no key is a bare `JOIN <chan>`, so that is
/// the only shape with nothing after the channel name, and the only one
/// with nothing to redact. Anything past the channel name is the key, in
/// however many words, and is collapsed into a single redaction rather
/// than reassembled, because there is no field of a known type after it
/// to check a split against the way `OPENBATTLE` checks its key against.
fn join_channel(rest: &str) -> Option<String> {
    let (chan, key) = rest.split_once(' ')?;
    if key.is_empty() {
        // A trailing space with nothing after it is not a key either.
        return None;
    }
    Some(format!("JOIN {chan} {REDACTED}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{parse_line, ServerMessage};

    /// The line ScarylePoo/uberserver#27 will send. The address and the lifetime
    /// survive, because they are what somebody debugging a battle that will not
    /// open actually needs, and the two credential fields do not.
    #[test]
    fn a_minted_credential_keeps_its_relay_and_its_lifetime_and_loses_the_rest() {
        assert_eq!(
            redact_line("TURNCREDENTIALS turn:relay.example.org:3478 1786086400:alice bWFj= 86400"),
            "TURNCREDENTIALS turn:relay.example.org:3478 <redacted> <redacted> 86400"
        );
    }

    /// A line the parser refuses is still a line with a password in it. These
    /// are the shapes `a_credential_field_with_a_space_is_not_read_as_a_credential`
    /// in `message.rs` proves are refused, asserted here for the other half:
    /// being refused does not stop them being shown.
    #[test]
    fn a_credential_line_that_does_not_parse_still_loses_its_secret() {
        for line in [
            // A username with a space in it, which moves the password along one
            // and leaves half of it where the lifetime belongs.
            "TURNCREDENTIALS turn:relay.example.org:3478 alice smith hunter2 86400",
            // A password with a space in it, same shift one field later.
            "TURNCREDENTIALS turn:relay.example.org:3478 alice hunter 2 86400",
            // A lifetime that is not a number at all.
            "TURNCREDENTIALS turn:relay.example.org:3478 alice hunter2 a-while",
            // Short of a lifetime entirely.
            "TURNCREDENTIALS turn:relay.example.org:3478 alice hunter2",
            // An empty slot where the address should be.
            "TURNCREDENTIALS  alice hunter2 86400",
        ] {
            assert!(
                matches!(parse_line(line), ServerMessage::Unknown { .. }),
                "{line} was supposed to be a line the parser refuses"
            );
            let shown = redact_line(line);
            assert!(
                !shown.contains("hunter") && !shown.contains("alice"),
                "{line} was shown as {shown}"
            );
        }
    }

    /// The ask coilbox itself sends. There is nothing after the command, so
    /// there is nothing to take out and it is shown whole.
    #[test]
    fn the_ask_is_left_alone() {
        assert_eq!(redact_line("TURNCREDENTIALS"), "TURNCREDENTIALS");
    }

    /// A refusal is written for the person who was trying to host, so every word
    /// of it has to survive. It is also the command most likely to be caught by
    /// a redactor matching on a prefix rather than on the whole command.
    #[test]
    fn a_refusal_keeps_the_lobbys_words() {
        assert_eq!(
            redact_line("TURNCREDENTIALSFAILED you have asked too often"),
            "TURNCREDENTIALSFAILED you have asked too often"
        );
    }

    /// The framing the parser strips has to be put back, or the console stops
    /// showing what actually arrived.
    #[test]
    fn the_framing_survives_the_redaction() {
        assert_eq!(
            redact_line("#42 TURNCREDENTIALS turn:relay.example.org:3478 alice bWFj= 600\r"),
            "#42 TURNCREDENTIALS turn:relay.example.org:3478 <redacted> <redacted> 600\r"
        );
    }

    /// Commands are upper-cased before they are matched, so a server shouting or
    /// whispering the same command gets the same treatment.
    #[test]
    fn the_command_is_matched_the_way_the_parser_matches_it() {
        assert_eq!(
            redact_line("turncredentials turn:relay.example.org:3478 alice bWFj= 600"),
            "TURNCREDENTIALS turn:relay.example.org:3478 <redacted> <redacted> 600"
        );
    }

    /// Everything else on the wire is shown exactly as it arrived, and shown
    /// without being rebuilt, so nothing can be lost in the rebuilding.
    #[test]
    fn every_other_line_is_untouched() {
        for line in [
            "TASSERVER 0.38 * 8452 0",
            "SAIDPRIVATE bob TURNCREDENTIALS is a funny word",
            "MOTD  ",
            "",
            // Neither is `LOGIN` or `REGISTER`, but each shares a prefix with
            // one of them, so a redactor matching on anything looser than the
            // whole command would wrongly cut into a line that carries no
            // password at all.
            "LOGININFOEND",
            "REGISTRATIONACCEPTED",
            // The relay lines carry an address and a port and nothing else, so
            // the console shows them whole. Somebody working out why a battle
            // moved and then could not be joined needs to read both.
            "RELAYEDHOST 198.51.100.9 30001",
            "MOVERELAYEDHOST 198.51.100.9 30002",
            "BATTLEHOSTMOVED 9 198.51.100.9 30002",
        ] {
            assert!(
                matches!(redact_line(line), Cow::Borrowed(kept) if kept == line),
                "{line} was rewritten"
            );
        }
    }

    /// The line `command::login` (issue #2044) actually builds, with the
    /// exact values from its own `login_line` test in `command.rs`. The
    /// username, the CPU marker, the local IP, the client agent, the client
    /// id and the compatibility flags all survive, because every one of them
    /// is what somebody working out a refused login needs to see, and the
    /// password hash lets anyone holding the console log in as `alice`.
    #[test]
    fn a_login_line_loses_its_hash_and_keeps_everything_else() {
        assert_eq!(
            redact_line("LOGIN alice aGFzaA== 0 192.168.0.5 Coilbox 0.1\t7654321\tu sp b"),
            "LOGIN alice <redacted> 0 192.168.0.5 Coilbox 0.1\t7654321\tu sp b"
        );
    }

    /// The two lines `command::register` builds, with and without an email,
    /// from its own `register_with_and_without_email` test in `command.rs`.
    /// `REGISTER` sends the same hash `LOGIN` does, and the email is worth
    /// keeping for the same reason the rest of a `LOGIN` line is.
    #[test]
    fn a_registration_line_loses_its_hash_and_keeps_the_username_and_email() {
        assert_eq!(redact_line("REGISTER bob hash"), "REGISTER bob <redacted>");
        assert_eq!(
            redact_line("REGISTER bob hash bob@example.com"),
            "REGISTER bob <redacted> bob@example.com"
        );
    }

    /// A line that never reaches the shape `LOGIN`/`REGISTER` are built in
    /// still has to lose its password, because the leak is in the text and
    /// not in whether the line parses. `parse_line` only ever sees these two
    /// commands as coilbox's own outbound lines, so there is no `Unknown`
    /// case to assert against here the way `TURNCREDENTIALS` has one. This
    /// asserts directly that the hash is gone regardless of what surrounds
    /// it.
    #[test]
    fn a_login_or_register_line_that_is_short_or_reshaped_still_loses_its_hash() {
        for (line, redacted) in [
            // Cut short before the fields a real `LOGIN` always has.
            ("LOGIN alice hash", "LOGIN alice <redacted>"),
            // Cut short before the fields a real `REGISTER` always has.
            ("REGISTER bob hash", "REGISTER bob <redacted>"),
            // Extra trailing content past where the client ever puts any.
            (
                "REGISTER bob hash bob@example.com extra",
                "REGISTER bob <redacted> bob@example.com extra",
            ),
        ] {
            assert_eq!(redact_line(line), redacted, "for {line}");
        }
    }

    /// Nothing after the username at all is nothing to redact: there is no
    /// password field in the line to begin with.
    #[test]
    fn a_login_with_no_password_field_is_left_alone() {
        assert_eq!(redact_line("LOGIN alice"), "LOGIN alice");
    }

    /// Commands are upper-cased before they are matched here too, so a
    /// server shouting or whispering `LOGIN`/`REGISTER` back at us in a log
    /// still loses the hash.
    #[test]
    fn login_and_register_are_matched_the_way_the_parser_matches_them() {
        assert_eq!(
            redact_line("login alice hash 0 192.168.0.5 agent\t1\tu"),
            "LOGIN alice <redacted> 0 192.168.0.5 agent\t1\tu"
        );
        assert_eq!(redact_line("register bob hash"), "REGISTER bob <redacted>");
    }

    /// The four shapes `join_battle_variants` in `command.rs` proves
    /// `command::join_battle` actually builds. A bare id has nothing to
    /// redact. A key with no script password loses the key. `*` in the
    /// key's slot is the placeholder for "no key", not a key, so it
    /// survives. Both a key and a script password lose both.
    #[test]
    fn a_join_battle_line_loses_its_key_and_its_script_password() {
        for (line, redacted) in [
            ("JOINBATTLE 3", "JOINBATTLE 3"),
            ("JOINBATTLE 3 pw", "JOINBATTLE 3 <redacted>"),
            ("JOINBATTLE 3 * sp", "JOINBATTLE 3 * <redacted>"),
            ("JOINBATTLE 3 pw sp", "JOINBATTLE 3 <redacted> <redacted>"),
        ] {
            assert_eq!(redact_line(line), redacted, "for {line}");
        }
    }

    /// A key with a space in it is not a bad key, it is the script password
    /// moved into the key's own slot (`open_battle`'s
    /// `a_room_password_with_a_space_moves_every_field_after_it` proves the
    /// same shift for `OPENBATTLE`). There is no field after the script
    /// password to check the split against, so the fix here is simpler than
    /// `OPENBATTLE`'s: whatever follows the id, in however many pieces, is
    /// one secret and is shown as one redaction.
    #[test]
    fn a_joinbattle_key_with_a_space_still_loses_every_word_of_it() {
        let shown = redact_line("JOINBATTLE 3 let me in");
        assert_eq!(shown, "JOINBATTLE 3 <redacted> <redacted>");
        assert!(!shown.contains("let") && !shown.contains("me") && !shown.contains(" in"));
    }

    /// Commands are upper-cased before they are matched here too.
    #[test]
    fn joinbattle_is_matched_the_way_the_parser_matches_it() {
        assert_eq!(
            redact_line("joinbattle 3 pw sp"),
            "JOINBATTLE 3 <redacted> <redacted>"
        );
    }

    /// The line `open_battle_tab_block` in `command.rs` proves
    /// `command::open_battle` builds for a room with no password: `*` in
    /// the key's slot, and every other field, including the tab-separated
    /// block and the space inside "Title Here", surviving untouched.
    #[test]
    fn an_open_battle_line_with_no_password_keeps_everything_including_the_star() {
        assert_eq!(
            redact_line("OPENBATTLE 0 0 * 8452 16 -1 0 -1 spring\t105\tMap\tTitle Here\tBAR"),
            "OPENBATTLE 0 0 * 8452 16 -1 0 -1 spring\t105\tMap\tTitle Here\tBAR"
        );
    }

    /// The same line with a real key, which is the room password
    /// `command::open_battle` is documented to carry. Everything past the
    /// key, including the space inside the title, survives.
    #[test]
    fn an_open_battle_line_loses_its_key_and_keeps_everything_else() {
        assert_eq!(
            redact_line("OPENBATTLE 0 0 s3cret 8452 16 -1 0 -1 spring\t105\tMap\tTitle Here\tBAR"),
            "OPENBATTLE 0 0 <redacted> 8452 16 -1 0 -1 spring\t105\tMap\tTitle Here\tBAR"
        );
    }

    /// The line `a_room_password_with_a_space_moves_every_field_after_it` in
    /// `command.rs` builds: a key of `"let me in"` puts the second half of
    /// the password where the port belongs and the port where the player
    /// limit belongs. Trusting the shift would echo "me" and "in" back out
    /// mislabelled as the port and the player limit, so this gives up
    /// everything from the key onward instead.
    #[test]
    fn an_open_battle_key_with_a_space_loses_everything_past_the_nat_type() {
        let shown = redact_line(
            "OPENBATTLE 0 0 let me in 8452 16 -1 0 -1 spring\t105\tMap\tTitle Here\tBAR",
        );
        assert_eq!(shown, "OPENBATTLE 0 0 <redacted>");
        assert!(!shown.contains("let") && !shown.contains("me") && !shown.contains("8452"));
    }

    /// Commands are upper-cased before they are matched here too.
    #[test]
    fn openbattle_is_matched_the_way_the_parser_matches_it() {
        assert_eq!(
            redact_line("openbattle 0 0 s3cret 8452 16 -1 0 -1 spring\t105\tMap\tTitle\tBAR"),
            "OPENBATTLE 0 0 <redacted> 8452 16 -1 0 -1 spring\t105\tMap\tTitle\tBAR"
        );
    }

    /// The two shapes `command::join_channel` actually builds (issue
    /// #2048): a bare channel with no key has nothing to redact, and a
    /// channel with a key loses the key while the channel name stays.
    #[test]
    fn a_join_line_loses_its_key_and_keeps_the_channel_when_there_is_one() {
        for (line, redacted) in [
            ("JOIN main", "JOIN main"),
            ("JOIN main k3y", "JOIN main <redacted>"),
        ] {
            assert_eq!(redact_line(line), redacted, "for {line}");
        }
    }

    /// A key with a space in it is not a bad key, it is still the one
    /// secret `JOIN` can carry, so every word of it is collapsed into a
    /// single redaction rather than the second word leaking back out
    /// mislabelled as something else.
    #[test]
    fn a_join_key_with_a_space_still_loses_every_word_of_it() {
        let shown = redact_line("JOIN main let me in");
        assert_eq!(shown, "JOIN main <redacted>");
        assert!(!shown.contains("let") && !shown.contains("me") && !shown.contains(" in"));
    }

    /// Commands are upper-cased before they are matched here too.
    #[test]
    fn join_is_matched_the_way_the_parser_matches_it() {
        assert_eq!(redact_line("join main k3y"), "JOIN main <redacted>");
    }
}
