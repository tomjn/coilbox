//! Folding Zero-K's battle stream into [`LobbyState::battles`].
//!
//! The Zero-K counterpart of [`crate::tachyon_lobbies`], and pure in the same
//! way: a message and a state go in, the state is updated and the [`Delta`]s that
//! moved come out. No socket, so it can be tested a message at a time.
//!
//! Zero-K sends the list as a running stream rather than a snapshot.
//! `BattleAdded` when a room opens, `BattleUpdate` when anything about it
//! changes, `BattleRemoved` when it closes. There is no "here is the whole list"
//! message, so a reconnect is what rebuilds it, and the connection task starts
//! from a fresh [`LobbyState`] every time.
//!
//! # An update is a patch
//!
//! Both messages carry a [`BattleHeader`], and upstream's serialiser leaves an
//! unset member out of the JSON entirely. So a `BattleUpdate` naming only the
//! player count is not saying the room has lost its title and its map: it is
//! saying those did not change. Every field is merged, never replaced.
//!
//! # A number that is already a number
//!
//! Unlike a Tachyon lobby, a Zero-K battle is identified by an integer, so it
//! goes straight into [`LobbyState::battles`] with no handle to derive and
//! [`Battle::tachyon_id`] stays empty.
//!
//! # What is parsed and not kept
//!
//! `IsMatchMaker`, `TimeQueueEnabled`, `MaxEvenPlayers` and `RunningSince` are
//! read off the wire by the generated types and go no further, which is what the
//! `lobby-protocol-gap` label tracks.

use coilbox_lobby_protocol::{Battle, Delta, LobbyState};
use coilbox_zerok_protocol::types::BattleHeader;
use coilbox_zerok_protocol::ZerokMessage;

/// Apply a Zero-K message to the lobby state, returning the deltas produced.
///
/// Messages that carry no battle produce nothing, so the connection can hand
/// every line it receives to this.
pub(crate) fn reduce(state: &mut LobbyState, msg: &ZerokMessage) -> Vec<Delta> {
    match msg {
        ZerokMessage::BattleAdded(added) => added
            .header
            .as_ref()
            .map(|header| put(state, header))
            .unwrap_or_default(),
        ZerokMessage::BattleUpdate(update) => update
            .header
            .as_ref()
            .map(|header| put(state, header))
            .unwrap_or_default(),
        ZerokMessage::BattleRemoved(removed) => close(state, removed.battle_id),
        _ => vec![],
    }
}

/// Fold one header into `battles`, creating the battle when it is new.
///
/// A `BattleUpdate` for a battle we do not hold creates one rather than being
/// dropped. `BattleAdded` is the message that carries a whole header, so a
/// battle we first hear of through an update is one whose opening we missed, and
/// leaving it out of the list until it closes would be worse than a row with a
/// field or two still empty.
fn put(state: &mut LobbyState, header: &BattleHeader) -> Vec<Delta> {
    let Some(id) = header.battle_id.and_then(|id| u32::try_from(id).ok()) else {
        // No id, or a negative one. Neither names a battle, and upstream's own
        // ids come from a counter that starts at 1.
        return vec![];
    };

    let held = state.battles.remove(&id);
    let known = held.is_some();
    let mut battle = held.unwrap_or_else(|| Battle {
        id,
        ..Default::default()
    });
    let before = battle.clone();

    if let Some(title) = &header.title {
        battle.title.clone_from(title);
    }
    if let Some(founder) = &header.founder {
        battle.host.clone_from(founder);
    }
    if let Some(map) = &header.map {
        battle.map.clone_from(map);
    }
    if let Some(game) = &header.game {
        battle.modname.clone_from(game);
    }
    if let Some(engine) = &header.engine {
        // The engine *version*, which is what `version` holds on a Tachyon
        // connection too. `engine` is the TASServer field naming which engine,
        // and Zero-K never says anything but Spring.
        battle.version.clone_from(engine);
    }
    if let Some(mode) = header.mode {
        battle.mode = crate::zerok_room::mode_name(mode).map(str::to_owned);
    }
    if let Some(max_players) = header.max_players {
        battle.max_players = count(max_players);
    }
    if let Some(player_count) = header.player_count {
        battle.player_count = Some(count(player_count));
    }
    if let Some(spectator_count) = header.spectator_count {
        battle.spectator_count = count(spectator_count);
    }
    if let Some(password) = &header.password {
        // The server does not hand another room's password out, so what arrives
        // here is a placeholder. Either way, something in the field means the
        // room asks for one and the join has to prompt.
        battle.passworded = !password.is_empty();
    }
    if let Some(is_running) = header.is_running {
        battle.in_progress = is_running;
    }

    let changed = battle != before;
    state.battles.insert(id, battle);

    match (known, changed) {
        (false, _) => vec![Delta::BattleOpened { id }],
        (true, true) => vec![Delta::BattleInfoChanged { id }],
        (true, false) => vec![],
    }
}

/// Take a battle out of the list.
fn close(state: &mut LobbyState, id: i32) -> Vec<Delta> {
    let Ok(id) = u32::try_from(id) else {
        return vec![];
    };
    let mut deltas = match state.battles.remove(&id) {
        Some(_) => vec![Delta::BattleClosed { id }],
        None => vec![],
    };
    // The room we were in has closed under us. Nothing else says so: there is no
    // "you have been removed" for a battle that simply ended.
    if state.current_battle == Some(id) {
        state.current_battle = None;
        state.last_battle = Some(id);
        deltas.push(Delta::MemberLeft {
            battle_id: id,
            name: state.my_username.clone().unwrap_or_default(),
        });
    }
    deltas
}

/// A count off the wire. The header types these as plain integers, so a negative
/// one is nonsense and reads as zero.
fn count(value: i32) -> u32 {
    u32::try_from(value).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use coilbox_zerok_protocol::line;

    /// Fold a wire line into the state the way the connection does.
    fn feed(state: &mut LobbyState, raw: &str) -> Vec<Delta> {
        let message = line::parse_line(raw).expect("the line parses");
        reduce(state, &message)
    }

    #[test]
    fn a_battle_added_lists_the_room() {
        let mut state = LobbyState::new();
        let deltas = feed(
            &mut state,
            r#"BattleAdded {"Header":{"BattleID":42,"Title":"Teams All Welcome","Founder":"[teh]host","Map":"Comet Catcher Remake 1.8","Game":"Zero-K v1.12.6.0","Engine":"105.1.1-2590","MaxPlayers":16,"PlayerCount":5,"SpectatorCount":2,"IsRunning":false}}"#,
        );

        let battle = &state.battles[&42];
        assert_eq!(battle.id, 42);
        assert_eq!(battle.title, "Teams All Welcome");
        assert_eq!(battle.host, "[teh]host");
        assert_eq!(battle.map, "Comet Catcher Remake 1.8");
        assert_eq!(battle.modname, "Zero-K v1.12.6.0");
        assert_eq!(battle.version, "105.1.1-2590");
        assert_eq!(battle.max_players, 16);
        assert_eq!(battle.player_count, Some(5));
        assert_eq!(battle.spectator_count, 2);
        assert!(!battle.passworded);
        assert!(!battle.in_progress);
        assert_eq!(deltas, vec![Delta::BattleOpened { id: 42 }]);
    }

    /// The mode decides what a room will accept, not just how it reads. Upstream
    /// takes bots in a Custom or a Cooperative room and refuses them in the
    /// rest, so a client that does not know the mode offers an Add AI button
    /// that answers with a message box.
    #[test]
    fn a_room_carries_the_mode_it_was_opened_in() {
        let mut state = LobbyState::new();
        feed(
            &mut state,
            r#"BattleAdded {"Header":{"BattleID":42,"Mode":6}}"#,
        );
        assert_eq!(state.battles[&42].mode.as_deref(), Some("teams"));

        feed(
            &mut state,
            r#"BattleUpdate {"Header":{"BattleID":42,"Mode":0}}"#,
        );
        assert_eq!(state.battles[&42].mode.as_deref(), Some("custom"));
    }

    /// A room whose header never named a mode has none, rather than reading as
    /// the mode whose number happens to be zero. Custom is 0 upstream, so a
    /// default would make every Tachyon and TASServer battle a Zero-K custom
    /// room.
    #[test]
    fn a_room_that_names_no_mode_has_none() {
        let mut state = LobbyState::new();
        feed(&mut state, r#"BattleAdded {"Header":{"BattleID":42}}"#);
        assert_eq!(state.battles[&42].mode, None);
    }

    /// The reason every field is merged. Upstream leaves an unset member out of
    /// the JSON, so an update naming the player count is not saying the room has
    /// lost its title.
    #[test]
    fn an_update_changes_what_it_names_and_leaves_the_rest() {
        let mut state = LobbyState::new();
        feed(
            &mut state,
            r#"BattleAdded {"Header":{"BattleID":42,"Title":"Teams All Welcome","Map":"Comet Catcher Remake 1.8","PlayerCount":5}}"#,
        );

        let deltas = feed(
            &mut state,
            r#"BattleUpdate {"Header":{"BattleID":42,"PlayerCount":9}}"#,
        );

        let battle = &state.battles[&42];
        assert_eq!(battle.player_count, Some(9));
        assert_eq!(battle.title, "Teams All Welcome");
        assert_eq!(battle.map, "Comet Catcher Remake 1.8");
        assert_eq!(deltas, vec![Delta::BattleInfoChanged { id: 42 }]);
    }

    #[test]
    fn a_repeat_of_what_we_already_hold_produces_no_delta() {
        let mut state = LobbyState::new();
        let added = r#"BattleAdded {"Header":{"BattleID":42,"Title":"Teams All Welcome"}}"#;
        feed(&mut state, added);

        assert_eq!(feed(&mut state, added), vec![]);
    }

    /// An update for a battle whose opening we missed. Better a row with an
    /// empty field or two than no row at all until the room closes.
    #[test]
    fn an_update_for_a_battle_we_never_saw_open_still_lists_it() {
        let mut state = LobbyState::new();
        let deltas = feed(
            &mut state,
            r#"BattleUpdate {"Header":{"BattleID":7,"PlayerCount":3}}"#,
        );

        assert_eq!(state.battles[&7].player_count, Some(3));
        assert_eq!(deltas, vec![Delta::BattleOpened { id: 7 }]);
    }

    #[test]
    fn a_password_makes_the_room_ask_for_one() {
        let mut state = LobbyState::new();
        feed(
            &mut state,
            r#"BattleAdded {"Header":{"BattleID":42,"Password":"?"}}"#,
        );
        assert!(state.battles[&42].passworded);

        // An empty string is not a password. Upstream's own host dialog omits
        // the field rather than sending one, for the same reason.
        feed(
            &mut state,
            r#"BattleUpdate {"Header":{"BattleID":42,"Password":""}}"#,
        );
        assert!(!state.battles[&42].passworded);
    }

    #[test]
    fn a_running_battle_says_so_on_the_row() {
        let mut state = LobbyState::new();
        feed(
            &mut state,
            r#"BattleAdded {"Header":{"BattleID":42,"IsRunning":true}}"#,
        );
        assert!(state.battles[&42].in_progress);
    }

    #[test]
    fn a_battle_removed_takes_the_room_out_of_the_list() {
        let mut state = LobbyState::new();
        feed(&mut state, r#"BattleAdded {"Header":{"BattleID":42}}"#);

        let deltas = feed(&mut state, r#"BattleRemoved {"BattleID":42}"#);
        assert!(state.battles.is_empty());
        assert_eq!(deltas, vec![Delta::BattleClosed { id: 42 }]);
    }

    #[test]
    fn a_removal_for_a_battle_we_never_had_changes_nothing() {
        let mut state = LobbyState::new();
        assert_eq!(feed(&mut state, r#"BattleRemoved {"BattleID":42}"#), vec![]);
    }

    /// Nothing else says the room we are in has ended, so the closure has to.
    #[test]
    fn the_room_we_are_in_closing_takes_us_out_of_it() {
        let mut state = LobbyState::new();
        state.my_username = Some("someone".into());
        feed(&mut state, r#"BattleAdded {"Header":{"BattleID":42}}"#);
        state.current_battle = Some(42);

        let deltas = feed(&mut state, r#"BattleRemoved {"BattleID":42}"#);

        assert_eq!(state.current_battle, None);
        assert_eq!(state.last_battle, Some(42));
        assert_eq!(
            deltas,
            vec![
                Delta::BattleClosed { id: 42 },
                Delta::MemberLeft {
                    battle_id: 42,
                    name: "someone".into()
                },
            ]
        );
    }

    #[test]
    fn a_header_with_no_id_names_no_battle() {
        let mut state = LobbyState::new();
        let deltas = feed(&mut state, r#"BattleAdded {"Header":{"Title":"Nowhere"}}"#);
        assert!(state.battles.is_empty());
        assert_eq!(deltas, vec![]);
    }

    #[test]
    fn a_message_that_carries_no_battle_leaves_the_state_alone() {
        let mut state = LobbyState::new();
        let deltas = feed(&mut state, r#"DefaultEngineChanged {"Engine":"105.1.1"}"#);
        assert_eq!(deltas, vec![]);
        assert!(state.battles.is_empty());
    }
}
