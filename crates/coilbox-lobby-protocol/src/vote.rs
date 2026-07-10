//! Parsing of SPADS autohost vote announcements out of battle chat.
//!
//! SPADS runs `!`-command votes by posting plain battle-chat lines from the bot
//! (`sayBattleAndGame` in SPADS `src/spads.pl`): a start line, periodic progress
//! updates, and a terminal pass/fail/cancel line. We recognise those three shapes
//! so the battle room can surface a one-click vote panel. The wording is
//! version-dependent, so anything we don't recognise yields `None` and never
//! disturbs chat.

/// One recognised line of a SPADS vote exchange.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum VoteLine {
    /// `<caller> called a vote for command "<subject>" [!vote y, !vote n, !vote b]`
    Start {
        caller: String,
        subject: String,
        /// Whether the bot advertised `!vote b` (abstain) on the start line.
        allow_abstain: bool,
    },
    /// `Vote in progress: "<subject>" [y:<yes>/<needed>(<max>), n:<no>/<needed>(<max>)] (<n>s remaining)`
    Progress {
        subject: String,
        yes: u32,
        yes_needed: u32,
        no: u32,
        no_needed: u32,
        remaining_secs: u64,
    },
    /// A terminal line: `Vote for command "<subject>" passed./failed.` (optionally
    /// `(delay expired…)`) or `Cancelling "<subject>" vote (command executed …)`.
    End { subject: String },
}

/// Recognise one SPADS vote line, or `None` if the text isn't a vote announcement.
pub fn parse_vote_line(text: &str) -> Option<VoteLine> {
    parse_start(text)
        .or_else(|| parse_progress(text))
        .or_else(|| parse_end(text))
        .or_else(|| parse_cancel(text))
}

const START_MARK: &str = " called a vote for command \"";

fn parse_start(text: &str) -> Option<VoteLine> {
    let idx = text.find(START_MARK)?;
    let caller = text[..idx].to_string();
    // `<subject>" [!vote y, !vote n(, !vote b)]`
    let rest = &text[idx + START_MARK.len()..];
    let close = rest.find("\" [")?;
    let subject = rest[..close].to_string();
    let bracket = &rest[close..];
    if !bracket.contains("!vote y") {
        return None;
    }
    let allow_abstain = bracket.contains("!vote b");
    Some(VoteLine::Start {
        caller,
        subject,
        allow_abstain,
    })
}

fn parse_progress(text: &str) -> Option<VoteLine> {
    let rest = text.strip_prefix("Vote in progress: \"")?;
    // `<subject>" [y:<yes>/<needed>.., n:<no>/<needed>..] (<n>s remaining)`
    let close = rest.find("\" [y:")?;
    let subject = rest[..close].to_string();
    let after = &rest[close + "\" [y:".len()..];
    let (yes_seg, tail) = after.split_once(", n:")?;
    let (no_seg, tail) = tail.split_once(']')?;
    let (yes, yes_needed) = parse_count_needed(yes_seg)?;
    let (no, no_needed) = parse_count_needed(no_seg)?;
    // `tail` is ` (<n>s remaining)`; treat a missing/odd tail as 0 remaining.
    let remaining_secs = tail
        .trim()
        .strip_prefix('(')
        .and_then(|s| s.strip_suffix("s remaining)"))
        .and_then(|s| s.trim().parse::<u64>().ok())
        .unwrap_or(0);
    Some(VoteLine::Progress {
        subject,
        yes,
        yes_needed,
        no,
        no_needed,
        remaining_secs,
    })
}

/// Parse a `count/needed` fragment, ignoring an optional `(max)` upper-bound
/// suffix SPADS appends when away-mode voters could still raise the bar.
fn parse_count_needed(seg: &str) -> Option<(u32, u32)> {
    let (count, needed) = seg.trim().split_once('/')?;
    let count = count.trim().parse().ok()?;
    let needed = needed
        .split('(')
        .next()
        .unwrap_or(needed)
        .trim()
        .parse()
        .ok()?;
    Some((count, needed))
}

fn parse_end(text: &str) -> Option<VoteLine> {
    let rest = text.strip_prefix("Vote for command \"")?;
    let close = rest.find("\" ")?;
    let verdict = &rest[close + 2..];
    if verdict.starts_with("passed") || verdict.starts_with("failed") {
        Some(VoteLine::End {
            subject: rest[..close].to_string(),
        })
    } else {
        None
    }
}

fn parse_cancel(text: &str) -> Option<VoteLine> {
    let rest = text.strip_prefix("Cancelling \"")?;
    let close = rest.find("\" vote (command executed directly by ")?;
    Some(VoteLine::End {
        subject: rest[..close].to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_start_with_abstain() {
        assert_eq!(
            parse_vote_line(
                "Bob called a vote for command \"set map Red Comet\" [!vote y, !vote n, !vote b]"
            ),
            Some(VoteLine::Start {
                caller: "Bob".into(),
                subject: "set map Red Comet".into(),
                allow_abstain: true,
            })
        );
    }

    #[test]
    fn parses_start_without_abstain() {
        assert_eq!(
            parse_vote_line("Bob called a vote for command \"boss Bob\" [!vote y, !vote n]"),
            Some(VoteLine::Start {
                caller: "Bob".into(),
                subject: "boss Bob".into(),
                allow_abstain: false,
            })
        );
    }

    #[test]
    fn parses_progress() {
        assert_eq!(
            parse_vote_line(
                "Vote in progress: \"set map Red Comet\" [y:1/2, n:0/2] (45s remaining)"
            ),
            Some(VoteLine::Progress {
                subject: "set map Red Comet".into(),
                yes: 1,
                yes_needed: 2,
                no: 0,
                no_needed: 2,
                remaining_secs: 45,
            })
        );
    }

    #[test]
    fn parses_progress_with_max_caps() {
        assert_eq!(
            parse_vote_line(
                "Vote in progress: \"set map Red Comet\" [y:1/2(3), n:0/3(4)] (30s remaining)"
            ),
            Some(VoteLine::Progress {
                subject: "set map Red Comet".into(),
                yes: 1,
                yes_needed: 2,
                no: 0,
                no_needed: 3,
                remaining_secs: 30,
            })
        );
    }

    #[test]
    fn parses_passed_plain_and_delayed() {
        for line in [
            "Vote for command \"set map Red Comet\" passed.",
            "Vote for command \"set map Red Comet\" passed (delay expired).",
            "Vote for command \"boss Bob\" passed (delay expired, away vote mode activated for carol).",
        ] {
            let subject = if line.contains("boss") {
                "boss Bob"
            } else {
                "set map Red Comet"
            };
            assert_eq!(
                parse_vote_line(line),
                Some(VoteLine::End {
                    subject: subject.into()
                }),
                "line: {line}"
            );
        }
    }

    #[test]
    fn parses_failed_plain_and_delayed() {
        for line in [
            "Vote for command \"set map Red Comet\" failed.",
            "Vote for command \"set map Red Comet\" failed (delay expired).",
        ] {
            assert_eq!(
                parse_vote_line(line),
                Some(VoteLine::End {
                    subject: "set map Red Comet".into()
                }),
                "line: {line}"
            );
        }
    }

    #[test]
    fn parses_cancel() {
        assert_eq!(
            parse_vote_line(
                "Cancelling \"set map Red Comet\" vote (command executed directly by Bob)"
            ),
            Some(VoteLine::End {
                subject: "set map Red Comet".into()
            })
        );
    }

    #[test]
    fn ignores_non_vote_lines() {
        for line in [
            "hello everyone",
            "User(s) allowed to vote: Bob,Carol",
            "Your vote is awaited for following poll: \"set map Foo\" [!vote y, !vote n, !vote b]",
            "!vote y",
        ] {
            assert_eq!(parse_vote_line(line), None, "line: {line}");
        }
    }
}
