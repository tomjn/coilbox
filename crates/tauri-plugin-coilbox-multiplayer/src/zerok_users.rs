//! Folding Zero-K's player directory into [`LobbyState::users`], and who is in
//! which battle.
//!
//! The Zero-K counterpart of [`crate::tachyon_users`], and pure in the same way:
//! a message and a state go in, the state is updated and the [`Delta`]s that
//! moved come out.
//!
//! Two messages maintain it. `User` carries a whole record and arrives both when
//! somebody signs in and every time anything about them changes.
//! `UserDisconnected` takes them out again.
//!
//! # A record, not a patch
//!
//! `BattleUpdate` is a patch and `User` is not: upstream rebuilds the whole
//! record and broadcasts it on every change. That matters in one direction.
//! `NullValueHandling.Ignore` drops an unset member, so `BattleID` missing does
//! not mean "still in the same battle", it means they are in none. Merging it
//! the way a battle header is merged leaves everybody who has ever joined a room
//! listed in it forever.
//!
//! # Leaving a battle has no message of its own
//!
//! `LeaveBattle` carries a battle id and nothing else, so it cannot name who
//! left, and it is only ever about us. Upstream's `ConnectedUser.LeaveBattle`
//! drops the player and then re-broadcasts their `User` with `BattleID` cleared.
//! That echo is the notification, which is why membership is maintained here
//! rather than beside the room.

use coilbox_lobby_protocol::{ClientStatus, Delta, LobbyState, MemberStatus, Rating, User};
use coilbox_zerok_protocol::types;
use coilbox_zerok_protocol::ZerokMessage;

/// Apply a Zero-K message to the lobby state, returning the deltas produced.
///
/// Messages that carry no user record produce nothing, so the connection can
/// hand every line it receives to this.
pub(crate) fn reduce(state: &mut LobbyState, msg: &ZerokMessage) -> Vec<Delta> {
    match msg {
        ZerokMessage::User(user) => put(state, user),
        ZerokMessage::UserDisconnected(gone) => match gone.name.as_deref() {
            Some(name) => remove(state, name),
            None => vec![],
        },
        _ => vec![],
    }
}

/// Fold one record into `users`, and into whichever battle it names.
fn put(state: &mut LobbyState, record: &types::User) -> Vec<Delta> {
    let Some(name) = record.name.as_deref().filter(|name| !name.is_empty()) else {
        // A record with no name cannot be filed. `LobbyState::users` is keyed by
        // it, and so is every roster that reads back from it.
        return vec![];
    };

    let status = status_of(record);
    let user = User {
        name: name.to_owned(),
        country: record.country.clone().unwrap_or_default(),
        user_id: record.account_id.to_string(),
        // What the person is playing on, which is what `agent` means on a
        // TASServer connection too.
        agent: record.lobby_version.clone().unwrap_or_default(),
        status,
        rating: rating_of(record),
    };

    let mut deltas = Vec::new();
    match state.users.insert(name.to_owned(), user.clone()) {
        None => deltas.push(Delta::UserAdded {
            name: name.to_owned(),
        }),
        Some(held) => {
            if held != user {
                deltas.push(Delta::UserStatusChanged {
                    name: name.to_owned(),
                });
            }
            if status.ingame && !held.status.ingame {
                deltas.push(Delta::PlayerWentIngame {
                    name: name.to_owned(),
                });
            }
        }
    }

    let battle = record.battle_id.and_then(|id| u32::try_from(id).ok());
    deltas.extend(seat(state, name, battle));
    deltas
}

/// Put somebody in the battle they name and out of every other one.
///
/// `battle` is `None` when the record named no battle, which is how leaving one
/// arrives.
fn seat(state: &mut LobbyState, name: &str, battle: Option<u32>) -> Vec<Delta> {
    let mut deltas = Vec::new();

    let left: Vec<u32> = state
        .battles
        .iter()
        .filter(|(id, held)| Some(**id) != battle && held.members.contains_key(name))
        .map(|(id, _)| *id)
        .collect();
    for id in left {
        if let Some(held) = state.battles.get_mut(&id) {
            held.members.remove(name);
        }
        deltas.push(Delta::MemberLeft {
            battle_id: id,
            name: name.to_owned(),
        });
    }

    if let Some(id) = battle {
        // A battle we do not hold is one whose `BattleAdded` has not arrived
        // yet. Nothing is stored for it, because the row it would belong to does
        // not exist, and the record is re-broadcast on every change.
        if let Some(held) = state.battles.get_mut(&id) {
            if !held.members.contains_key(name) {
                // Zero-K says nothing about where somebody sits until we are in
                // the room with them: only `JoinBattleSuccess` and
                // `UpdateUserBattleStatus` carry a seat, and both are scoped to
                // the battle we joined. So a member of another room is listed
                // with the protocol default until we are in a position to know
                // better.
                held.members
                    .insert(name.to_owned(), MemberStatus::default());
                deltas.push(Delta::MemberJoined {
                    battle_id: id,
                    name: name.to_owned(),
                });
            }
        }
    }

    deltas
}

/// Take somebody out of the directory and out of any battle they were in.
fn remove(state: &mut LobbyState, name: &str) -> Vec<Delta> {
    let mut deltas = seat(state, name, None);
    if state.users.remove(name).is_some() {
        deltas.push(Delta::UserRemoved {
            name: name.to_owned(),
        });
    }
    deltas
}

/// A Zero-K record as the status bits the rest of the app reads.
///
/// Zero-K carries these as timestamps rather than flags: `InGameSince` and
/// `AwaySince` are set to when it started and cleared when it stops, so their
/// presence is the flag.
/// Both of the ratings a Zero-K record carries (issue #2002).
///
/// The two are live at once and mean different things: `EffectiveElo` is what a
/// custom battle counts toward, `EffectiveMmElo` is what the matchmaker queues
/// on, and upstream keeps them apart because they are far enough apart to matter.
///
/// `Level` is deliberately not here. It is experience rather than skill, and a
/// number that goes up for playing at all does not belong beside two that go up
/// for winning.
///
/// Zero is not a rating. Both members are plain ints upstream, so they arrive as
/// 0 for an account nobody has rated yet rather than being left out.
fn rating_of(record: &types::User) -> Rating {
    Rating {
        casual: rated(record.effective_elo),
        matchmaking: rated(record.effective_mm_elo),
        overall: None,
    }
}

/// A rating, or nothing where the number stands for the absence of one.
fn rated(value: i32) -> Option<i32> {
    (value > 0).then_some(value)
}

fn status_of(record: &types::User) -> ClientStatus {
    ClientStatus {
        ingame: record.in_game_since.is_some(),
        away: record.away_since.is_some(),
        // `rank` is three bits wide, which is the range Zero-K's own ranks
        // occupy. A number outside it would otherwise wrap and show the wrong
        // icon.
        rank: u8::try_from(record.rank.clamp(0, 7)).unwrap_or_default(),
        access: record.is_admin,
        bot: record.is_bot,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use coilbox_lobby_protocol::Battle;
    use coilbox_zerok_protocol::line;

    /// Fold a wire line into the state the way the connection does.
    fn feed(state: &mut LobbyState, raw: &str) -> Vec<Delta> {
        let message = line::parse_line(raw).expect("the line parses");
        reduce(state, &message)
    }

    /// A state holding one open battle, so membership has somewhere to land.
    fn with_battle(id: u32) -> LobbyState {
        let mut state = LobbyState::new();
        state.battles.insert(
            id,
            Battle {
                id,
                ..Default::default()
            },
        );
        state
    }

    #[test]
    fn a_user_record_lists_the_person() {
        let mut state = LobbyState::new();
        let deltas = feed(
            &mut state,
            r#"User {"Name":"someone","AccountID":4271,"Country":"GB","LobbyVersion":"ZKL 1.6.0.0","Rank":4}"#,
        );

        let user = &state.users["someone"];
        assert_eq!(user.name, "someone");
        assert_eq!(user.country, "GB");
        assert_eq!(user.user_id, "4271");
        assert_eq!(user.agent, "ZKL 1.6.0.0");
        assert_eq!(user.status.rank, 4);
        assert!(!user.status.ingame);
        assert!(!user.status.away);
        assert_eq!(
            deltas,
            vec![Delta::UserAdded {
                name: "someone".into()
            }]
        );
    }

    /// The one protocol of the three that rates everybody, on every record, all
    /// the time (issue #2002).
    #[test]
    fn a_record_carries_both_of_the_ratings_zero_k_keeps() {
        let mut state = LobbyState::new();
        feed(
            &mut state,
            r#"User {"Name":"someone","EffectiveElo":1650,"EffectiveMmElo":1720}"#,
        );

        let rating = state.users["someone"].rating;
        assert_eq!(rating.casual, Some(1650));
        assert_eq!(rating.matchmaking, Some(1720));
        // The category Zero-K keeps and this does not, because a Zero-K record
        // never arrives without one.
        assert_eq!(rating.overall, None);
    }

    /// `EffectiveElo` is a plain int upstream, so an account nobody has rated
    /// arrives as 0. Showing that as a rating would put every new player at the
    /// bottom of a table they are not on.
    #[test]
    fn a_zero_is_nobody_s_rating() {
        let mut state = LobbyState::new();
        feed(&mut state, r#"User {"Name":"someone","EffectiveElo":0}"#);

        assert!(state.users["someone"].rating.is_empty());
    }

    /// A rating moves after every rated game, and the roster showing it has to
    /// hear about that the same way it hears about anything else on the record.
    #[test]
    fn a_rating_that_moves_is_worth_a_delta() {
        let mut state = LobbyState::new();
        feed(&mut state, r#"User {"Name":"someone","EffectiveElo":1650}"#);

        let deltas = feed(&mut state, r#"User {"Name":"someone","EffectiveElo":1672}"#);

        assert_eq!(state.users["someone"].rating.casual, Some(1672));
        assert_eq!(
            deltas,
            vec![Delta::UserStatusChanged {
                name: "someone".into()
            }]
        );
    }

    /// Zero-K says when somebody went away rather than that they are, so the
    /// flag the rest of the app reads is whether the timestamp is there at all.
    #[test]
    fn away_and_ingame_are_timestamps_rather_than_flags() {
        let mut state = LobbyState::new();
        feed(
            &mut state,
            r#"User {"Name":"someone","AwaySince":"2026-08-27T09:15:00Z","InGameSince":"2026-08-27T09:20:00Z"}"#,
        );

        let status = state.users["someone"].status;
        assert!(status.away);
        assert!(status.ingame);
    }

    #[test]
    fn going_ingame_is_worth_saying_once() {
        let mut state = LobbyState::new();
        feed(&mut state, r#"User {"Name":"someone"}"#);

        let deltas = feed(
            &mut state,
            r#"User {"Name":"someone","InGameSince":"2026-08-27T09:20:00Z"}"#,
        );
        assert_eq!(
            deltas,
            vec![
                Delta::UserStatusChanged {
                    name: "someone".into()
                },
                Delta::PlayerWentIngame {
                    name: "someone".into()
                },
            ]
        );

        // Still in the same game. The record is re-broadcast on every change,
        // and a second announcement of the same one would ring twice.
        let deltas = feed(
            &mut state,
            r#"User {"Name":"someone","InGameSince":"2026-08-27T09:20:00Z","Country":"GB"}"#,
        );
        assert_eq!(
            deltas,
            vec![Delta::UserStatusChanged {
                name: "someone".into()
            }]
        );
    }

    #[test]
    fn a_record_that_says_nothing_new_produces_no_delta() {
        let mut state = LobbyState::new();
        let record = r#"User {"Name":"someone","Country":"GB"}"#;
        feed(&mut state, record);
        assert_eq!(feed(&mut state, record), vec![]);
    }

    #[test]
    fn a_disconnect_takes_the_person_out_of_the_directory() {
        let mut state = LobbyState::new();
        feed(&mut state, r#"User {"Name":"someone"}"#);

        let deltas = feed(
            &mut state,
            r#"UserDisconnected {"Name":"someone","Reason":"quit"}"#,
        );
        assert!(state.users.is_empty());
        assert_eq!(
            deltas,
            vec![Delta::UserRemoved {
                name: "someone".into()
            }]
        );
    }

    #[test]
    fn a_battle_id_puts_the_person_in_that_room() {
        let mut state = with_battle(42);
        let deltas = feed(&mut state, r#"User {"Name":"someone","BattleID":42}"#);

        assert!(state.battles[&42].members.contains_key("someone"));
        assert_eq!(
            deltas,
            vec![
                Delta::UserAdded {
                    name: "someone".into()
                },
                Delta::MemberJoined {
                    battle_id: 42,
                    name: "someone".into()
                },
            ]
        );
    }

    /// The reason `User` is not merged like a battle header. Leaving a room
    /// arrives as the same record with `BattleID` simply absent.
    #[test]
    fn a_record_with_no_battle_takes_the_person_out_of_the_one_they_were_in() {
        let mut state = with_battle(42);
        feed(&mut state, r#"User {"Name":"someone","BattleID":42}"#);

        let deltas = feed(&mut state, r#"User {"Name":"someone"}"#);

        assert!(state.battles[&42].members.is_empty());
        assert!(
            state.users.contains_key("someone"),
            "leaving a room is not leaving the server"
        );
        // Which battle somebody is in is held on the battle rather than on the
        // person, so the directory record itself did not move.
        assert_eq!(
            deltas,
            vec![Delta::MemberLeft {
                battle_id: 42,
                name: "someone".into()
            }]
        );
    }

    #[test]
    fn moving_between_rooms_leaves_one_and_joins_the_other() {
        let mut state = with_battle(42);
        state.battles.insert(
            7,
            Battle {
                id: 7,
                ..Default::default()
            },
        );
        feed(&mut state, r#"User {"Name":"someone","BattleID":42}"#);

        feed(&mut state, r#"User {"Name":"someone","BattleID":7}"#);

        assert!(state.battles[&42].members.is_empty());
        assert!(state.battles[&7].members.contains_key("someone"));
    }

    #[test]
    fn a_disconnect_takes_the_person_out_of_their_room_too() {
        let mut state = with_battle(42);
        feed(&mut state, r#"User {"Name":"someone","BattleID":42}"#);

        let deltas = feed(&mut state, r#"UserDisconnected {"Name":"someone"}"#);

        assert!(state.battles[&42].members.is_empty());
        assert_eq!(
            deltas,
            vec![
                Delta::MemberLeft {
                    battle_id: 42,
                    name: "someone".into()
                },
                Delta::UserRemoved {
                    name: "someone".into()
                },
            ]
        );
    }

    /// A seat we already hold is left alone. Only `JoinBattleSuccess` and
    /// `UpdateUserBattleStatus` know where somebody sits, and a re-broadcast
    /// record would otherwise put every member of our own room back on the
    /// default team.
    #[test]
    fn a_repeat_record_does_not_reseat_somebody_we_already_hold() {
        let mut state = with_battle(42);
        feed(&mut state, r#"User {"Name":"someone","BattleID":42}"#);
        let seated = MemberStatus {
            team_color: 0x00_33_66,
            ..Default::default()
        };
        state
            .battles
            .get_mut(&42)
            .expect("the battle is there")
            .members
            .insert("someone".into(), seated.clone());

        feed(
            &mut state,
            r#"User {"Name":"someone","BattleID":42,"Country":"GB"}"#,
        );

        assert_eq!(state.battles[&42].members["someone"], seated);
    }

    /// The record arrives before the room does during the flood after login.
    #[test]
    fn a_battle_we_do_not_hold_yet_seats_nobody() {
        let mut state = LobbyState::new();
        let deltas = feed(&mut state, r#"User {"Name":"someone","BattleID":42}"#);

        assert_eq!(
            deltas,
            vec![Delta::UserAdded {
                name: "someone".into()
            }]
        );
    }

    #[test]
    fn a_record_with_no_name_cannot_be_filed() {
        let mut state = LobbyState::new();
        let deltas = feed(&mut state, r#"User {"AccountID":4271}"#);
        assert!(state.users.is_empty());
        assert_eq!(deltas, vec![]);
    }

    #[test]
    fn a_message_that_carries_no_user_leaves_the_state_alone() {
        let mut state = LobbyState::new();
        let deltas = feed(&mut state, r#"BattleRemoved {"BattleID":42}"#);
        assert_eq!(deltas, vec![]);
        assert!(state.users.is_empty());
    }
}
