//! The host's answer to `!ring` typed in battle chat.
//!
//! A SPADS autohost answers `!ring` by sending the lobby's `RING` to the
//! players holding the battle up (`hRing` in SPADS `src/spads.pl`). A battle
//! this client founded has no SPADS in it, so the founder's client answers
//! instead. The rules and the wording are SPADS's, so a player reads the same
//! thing whichever kind of host they are in.

use std::collections::HashMap;

use crate::{command, LobbyState};

/// How long a player is left alone after being rung. SPADS's default
/// `minRingDelay` (`etc/spads.conf`).
const MIN_RING_DELAY_MS: u64 = 20_000;

/// SPADS names the players it rings until the list is longer than this many
/// characters, and counts them after that.
const NAMED_LIST_LIMIT: usize = 50;

/// What the founder's client does about one line of battle chat.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct RingAnswer {
    /// Lines to send, in order: a `RING` per player, then what is said about it.
    pub send: Vec<String>,
    /// Who rang the founder, when the founder is one of the players rung. A
    /// client does not send itself a `RING`, so this is played locally.
    pub ring_me: Option<String>,
}

/// Answers `!ring` for the battle this client founded, remembering who was
/// rung and when so nobody is rung twice inside [`MIN_RING_DELAY_MS`].
#[derive(Debug, Default)]
pub struct RingHost {
    last_rung: HashMap<String, u64>,
}

impl RingHost {
    /// Read one `SAIDBATTLE` line. Anything that is not `!ring`, or that arrives
    /// in a battle somebody else founded, gets an empty answer.
    pub fn hear(&mut self, state: &LobbyState, from: &str, text: &str, now_ms: u64) -> RingAnswer {
        let mut words = text.split_whitespace();
        if !words
            .next()
            .is_some_and(|w| w.eq_ignore_ascii_case("!ring"))
        {
            return RingAnswer::default();
        }
        let battle = state.current_battle.and_then(|id| state.battles.get(&id));
        let (Some(me), Some(battle)) = (state.my_username.as_deref(), battle) else {
            return RingAnswer::default();
        };
        if battle.host != me {
            return RingAnswer::default();
        }
        let named = words.next();
        if words.next().is_some() {
            return say("Invalid syntax, use !ring or !ring <player>".into());
        }

        self.last_rung
            .retain(|_, at| now_ms.saturating_sub(*at) < MIN_RING_DELAY_MS);
        let mut names: Vec<&str> = battle.members.keys().map(String::as_str).collect();
        names.sort_unstable();

        if let Some(wanted) = named {
            let Some(target) = clever_search(wanted, &names) else {
                return say(format!(
                    "Unable to find matching player for \"{wanted}\" in battle lobby"
                ));
            };
            if let Some(at) = self.last_rung.get(target) {
                let wait_ms = MIN_RING_DELAY_MS - now_ms.saturating_sub(*at);
                return say(format!(
                    "Unable to ring {target} (ring spam protection, please wait {}s)",
                    wait_ms.div_ceil(1000)
                ));
            }
            return self.ring(
                &[target],
                me,
                from,
                now_ms,
                format!("Ringing {target} (by {from})"),
            );
        }

        // The caller is left out: they are at the keyboard, they just typed.
        let (resting, ringing): (Vec<&str>, Vec<&str>) = names
            .into_iter()
            .filter(|name| *name != from)
            .filter(|name| {
                let status = battle.members[*name].battle_status;
                status.mode && (!status.ready || status.sync != 1)
            })
            .partition(|name| self.last_rung.contains_key(*name));
        if ringing.is_empty() {
            return say(if resting.is_empty() {
                "There is no one to ring".into()
            } else {
                format!(
                    "There is no one to ring (ring spam protection for {})",
                    listed(&resting, "users")
                )
            });
        }
        let list = ringing.join(",");
        let words = if list.len() > NAMED_LIST_LIMIT {
            format!("Ringing {} unready/unsynced players", ringing.len())
        } else {
            format!("Ringing unready/unsynced player(s): {list}")
        };
        self.ring(&ringing, me, from, now_ms, format!("{words} (by {from})"))
    }

    fn ring(
        &mut self,
        targets: &[&str],
        me: &str,
        from: &str,
        now_ms: u64,
        words: String,
    ) -> RingAnswer {
        let mut answer = RingAnswer::default();
        for target in targets {
            self.last_rung.insert(target.to_string(), now_ms);
            if *target == me {
                answer.ring_me = Some(from.to_string());
            } else {
                answer.send.push(command::ring(target));
            }
        }
        answer.send.push(command::say_battle_ex(&words));
        answer
    }
}

fn say(words: String) -> RingAnswer {
    RingAnswer {
        send: vec![command::say_battle_ex(&words)],
        ring_me: None,
    }
}

/// The names joined with commas, or a count of them once that runs long.
fn listed(names: &[&str], noun: &str) -> String {
    let list = names.join(",");
    if list.len() > NAMED_LIST_LIMIT {
        format!("{} {noun}", names.len())
    } else {
        list
    }
}

/// SPADS's `cleverSearch`: the exact name, else the first name starting with
/// what was typed, else the first containing it, each tried as typed before
/// being tried without regard to case.
fn clever_search<'a>(wanted: &str, names: &[&'a str]) -> Option<&'a str> {
    let lower = wanted.to_lowercase();
    let find = |test: &dyn Fn(&str) -> bool| names.iter().copied().find(|name| test(name));
    find(&|name| name == wanted)
        .or_else(|| find(&|name| name.starts_with(wanted)))
        .or_else(|| find(&|name| name.to_lowercase().starts_with(&lower)))
        .or_else(|| find(&|name| name.contains(wanted)))
        .or_else(|| find(&|name| name.to_lowercase().contains(&lower)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{default_battle_status, Battle, MemberStatus};

    const UNREADY: (bool, u8) = (false, 1);
    const READY: (bool, u8) = (true, 1);
    const UNSYNCED: (bool, u8) = (true, 2);

    fn player((ready, sync): (bool, u8)) -> MemberStatus {
        let mut status = default_battle_status();
        status.mode = true;
        status.ready = ready;
        status.sync = sync;
        MemberStatus {
            battle_status: status,
            ..Default::default()
        }
    }

    fn spectator() -> MemberStatus {
        let mut member = player(UNREADY);
        member.battle_status.mode = false;
        member
    }

    /// A battle `host` founded, as `me` sees it.
    fn battle(me: &str, host: &str, members: &[(&str, MemberStatus)]) -> LobbyState {
        let mut state = LobbyState::new();
        state.my_username = Some(me.into());
        state.current_battle = Some(1);
        state.battles.insert(
            1,
            Battle {
                id: 1,
                host: host.into(),
                members: members
                    .iter()
                    .map(|(name, member)| (name.to_string(), member.clone()))
                    .collect(),
                ..Default::default()
            },
        );
        state
    }

    #[test]
    fn rings_the_unready_and_the_unsynced_and_says_who() {
        let state = battle(
            "alice",
            "alice",
            &[
                ("alice", player(READY)),
                ("bob", player(UNREADY)),
                ("carol", player(UNSYNCED)),
                ("dave", player(READY)),
                ("erin", spectator()),
            ],
        );
        let answer = RingHost::default().hear(&state, "dave", "!ring", 0);
        assert_eq!(
            answer.send,
            [
                "RING bob",
                "RING carol",
                "SAYBATTLEEX Ringing unready/unsynced player(s): bob,carol (by dave)",
            ]
        );
        assert_eq!(answer.ring_me, None);
    }

    #[test]
    fn says_nothing_in_a_battle_somebody_else_founded() {
        let state = battle("bob", "alice", &[("bob", player(UNREADY))]);
        let answer = RingHost::default().hear(&state, "alice", "!ring", 0);
        assert_eq!(answer, RingAnswer::default());
    }

    #[test]
    fn leaves_ordinary_chat_alone() {
        let state = battle("alice", "alice", &[("bob", player(UNREADY))]);
        let mut host = RingHost::default();
        for text in ["ring him", "!ringall", "!balance", ""] {
            assert_eq!(host.hear(&state, "bob", text, 0), RingAnswer::default());
        }
    }

    #[test]
    fn the_caller_is_not_rung() {
        let state = battle(
            "alice",
            "alice",
            &[("alice", player(READY)), ("bob", player(UNREADY))],
        );
        let answer = RingHost::default().hear(&state, "bob", "!ring", 0);
        assert_eq!(answer.send, ["SAYBATTLEEX There is no one to ring"]);
    }

    #[test]
    fn an_unready_founder_is_rung_locally_and_sent_nothing() {
        let state = battle(
            "alice",
            "alice",
            &[("alice", player(UNREADY)), ("bob", player(READY))],
        );
        let answer = RingHost::default().hear(&state, "bob", "!RING", 0);
        assert_eq!(
            answer.send,
            ["SAYBATTLEEX Ringing unready/unsynced player(s): alice (by bob)"]
        );
        assert_eq!(answer.ring_me.as_deref(), Some("bob"));
    }

    #[test]
    fn nobody_is_rung_twice_inside_the_delay() {
        let state = battle(
            "alice",
            "alice",
            &[("alice", player(READY)), ("bob", player(UNREADY))],
        );
        let mut host = RingHost::default();
        host.hear(&state, "alice", "!ring", 1_000);

        let again = host.hear(&state, "alice", "!ring", 1_000 + MIN_RING_DELAY_MS - 1);
        assert_eq!(
            again.send,
            ["SAYBATTLEEX There is no one to ring (ring spam protection for bob)"]
        );
        let named = host.hear(&state, "alice", "!ring bob", 16_500);
        assert_eq!(
            named.send,
            ["SAYBATTLEEX Unable to ring bob (ring spam protection, please wait 5s)"]
        );

        let later = host.hear(&state, "alice", "!ring", 1_000 + MIN_RING_DELAY_MS);
        assert_eq!(later.send[0], "RING bob");
    }

    #[test]
    fn a_named_player_is_rung_whatever_their_status() {
        let state = battle(
            "alice",
            "alice",
            &[
                ("alice", player(READY)),
                ("Bobby", player(READY)),
                ("erin", spectator()),
            ],
        );
        let mut host = RingHost::default();
        assert_eq!(
            host.hear(&state, "alice", "!ring bob", 0).send,
            ["RING Bobby", "SAYBATTLEEX Ringing Bobby (by alice)"]
        );
        assert_eq!(
            host.hear(&state, "alice", "!ring rin", 0).send,
            ["RING erin", "SAYBATTLEEX Ringing erin (by alice)"]
        );
    }

    #[test]
    fn a_name_nobody_has_and_a_line_with_too_much_on_it_are_answered() {
        let state = battle("alice", "alice", &[("alice", player(READY))]);
        let mut host = RingHost::default();
        assert_eq!(
            host.hear(&state, "alice", "!ring zed", 0).send,
            ["SAYBATTLEEX Unable to find matching player for \"zed\" in battle lobby"]
        );
        assert_eq!(
            host.hear(&state, "alice", "!ring bob now", 0).send,
            ["SAYBATTLEEX Invalid syntax, use !ring or !ring <player>"]
        );
    }

    #[test]
    fn a_long_list_is_counted_rather_than_named() {
        let names: Vec<String> = (0..6).map(|n| format!("player_number_{n}")).collect();
        let members: Vec<(&str, MemberStatus)> = names
            .iter()
            .map(|name| (name.as_str(), player(UNREADY)))
            .collect();
        let state = battle("alice", "alice", &members);
        let answer = RingHost::default().hear(&state, "alice", "!ring", 0);
        assert_eq!(answer.send.len(), 7);
        assert_eq!(
            answer.send[6],
            "SAYBATTLEEX Ringing 6 unready/unsynced players (by alice)"
        );
    }
}
