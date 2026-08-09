//! Folding the Tachyon lobby list into [`LobbyState::battles`].
//!
//! The Tachyon counterpart of the battle arms of `coilbox_lobby_protocol::reduce`,
//! and pure in the same way as [`crate::tachyon_users`]: a message and a state go
//! in, the state is updated and the [`Delta`]s that moved come out. No socket, so
//! it can be tested a frame at a time.
//!
//! Two messages carry the list. `lobby/listReset` carries the whole of it and
//! replaces what we hold. `lobby/listUpdated` carries a merge patch, so a field
//! the patch leaves out keeps its value and a lobby whose key is set to `null`
//! is gone.
//!
//! # A uuid filed under a number
//!
//! Tachyon names a lobby by a string uuid. [`LobbyState::battles`] is keyed by
//! `u32`, because that is what a TASServer battle id is, and so are the deltas,
//! the deep links and the frontend. Widening all of that to a string would touch
//! every TASServer consumer for the sake of one protocol, so a Tachyon lobby
//! gets a `u32` handle instead and keeps its uuid in [`Battle::tachyon_id`],
//! which is what a later `lobby/join` names.
//!
//! The handle is a hash of the uuid rather than a counter, so a lobby has the
//! same handle after a reset, after a reconnect, and in a second window looking
//! at the same server. A counter would give the same lobby a different number
//! every time the list was rebuilt, and a frontend holding the old one would
//! act on whichever lobby had inherited it.
//!
//! # The key is the lobby id
//!
//! Both messages carry the list as an object rather than an array, because a
//! merge patch cannot address an array element. A removal arrives as a key set
//! to `null` and carries nothing else, so the key has to be the lobby id. The
//! `id` each entry also carries repeats it and is not read.

use std::collections::{HashMap, HashSet};

use coilbox_lobby_protocol::{Battle, Delta, LobbyState};
use coilbox_tachyon_protocol::merge_patch::{LobbyOverviewPatch, Patched};
use coilbox_tachyon_protocol::types::LobbyOverview;
use coilbox_tachyon_protocol::TachyonMessage;

/// The part of a Tachyon lobby overview that has a home in [`Battle`].
///
/// Every field is optional, because `lobby/listUpdated` sends only what changed.
/// `None` means "not mentioned", so the stored value stays.
struct Fields<'a> {
    name: Option<&'a str>,
    map_name: Option<&'a str>,
    engine_version: Option<&'a str>,
    game_version: Option<&'a str>,
    player_count: Option<i64>,
    max_player_count: Option<i64>,
    in_progress: Option<bool>,
}

/// Apply a Tachyon message to the lobby state, returning the deltas produced.
///
/// Messages that carry no lobby list produce nothing, so the connection can hand
/// every frame it receives to this.
pub(crate) fn reduce(state: &mut LobbyState, msg: &TachyonMessage) -> Vec<Delta> {
    match msg {
        TachyonMessage::LobbyListResetEvent(event) => {
            let mut listed: Vec<(&str, Fields<'_>)> = event
                .data
                .lobbies
                .iter()
                .map(|(id, overview)| (id.as_str(), from_overview(overview)))
                .collect();
            // Sorted, so the deltas come out in the same order every time rather
            // than in whatever order the map happened to be walked in.
            listed.sort_by_key(|(id, _)| *id);

            let mut deltas = Vec::new();
            let mut kept = HashSet::new();
            for (id, fields) in listed {
                kept.insert(handle_for(id, &state.battles));
                deltas.extend(put(state, id, &fields));
            }
            deltas.extend(close_all_but(state, &kept));
            deltas
        }
        TachyonMessage::LobbyListUpdatedEvent(event) => {
            let mut patched: Vec<_> = event
                .data
                .lobbies
                .iter()
                .map(|(id, entry)| (id.as_str(), entry))
                .collect();
            patched.sort_by_key(|(id, _)| *id);

            patched
                .into_iter()
                .flat_map(|(id, entry)| match entry {
                    Some(entry) => put(state, id, &from_patch(entry)),
                    None => close(state, id),
                })
                .collect()
        }
        _ => vec![],
    }
}

/// Fold one lobby into `battles`.
fn put(state: &mut LobbyState, id: &str, fields: &Fields<'_>) -> Vec<Delta> {
    let handle = handle_for(id, &state.battles);
    let held = state.battles.remove(&handle);
    let known = held.is_some();
    let Some(mut battle) = held.or_else(|| whole(handle, id, fields)) else {
        // A patch for a lobby we do not hold that does not carry enough to list
        // one. Skipping it leaves the row out until the next reset brings the
        // whole thing, which is better than a row with no name and no map.
        return vec![];
    };

    let before = battle.clone();
    if let Some(name) = fields.name {
        battle.title = name.to_owned();
    }
    if let Some(map_name) = fields.map_name {
        battle.map = map_name.to_owned();
    }
    if let Some(engine_version) = fields.engine_version {
        battle.version = engine_version.to_owned();
    }
    if let Some(game_version) = fields.game_version {
        battle.modname = game_version.to_owned();
    }
    if let Some(player_count) = fields.player_count {
        battle.player_count = Some(count(player_count));
    }
    if let Some(max_player_count) = fields.max_player_count {
        battle.max_players = count(max_player_count);
    }
    if let Some(in_progress) = fields.in_progress {
        battle.in_progress = in_progress;
    }
    let changed = battle != before;
    state.battles.insert(handle, battle);

    match (known, changed) {
        (false, _) => vec![Delta::BattleOpened { id: handle }],
        (true, true) => vec![Delta::BattleInfoChanged { id: handle }],
        (true, false) => vec![],
    }
}

/// Take a lobby out of the list.
fn close(state: &mut LobbyState, id: &str) -> Vec<Delta> {
    let handle = handle_for(id, &state.battles);
    match state.battles.remove(&handle) {
        Some(_) => vec![Delta::BattleClosed { id: handle }],
        None => vec![],
    }
}

/// Take out every lobby the handles do not name, which is what a reset does to
/// the lobbies it no longer lists.
fn close_all_but(state: &mut LobbyState, kept: &HashSet<u32>) -> Vec<Delta> {
    let mut gone: Vec<u32> = state
        .battles
        .keys()
        .copied()
        .filter(|handle| !kept.contains(handle))
        .collect();
    gone.sort_unstable();

    for handle in &gone {
        state.battles.remove(handle);
    }
    gone.into_iter()
        .map(|handle| Delta::BattleClosed { id: handle })
        .collect()
}

/// A battle to fold a first patch into, or `None` when the patch carries too
/// little to list a lobby at all.
///
/// The bar is every field a row shows, so a partial patch for a lobby we have
/// never seen is skipped rather than half applied. Whether a battle is running
/// is not part of the bar, because a lobby starts out with none and a patch
/// that does not mention one leaves it that way.
fn whole(handle: u32, id: &str, fields: &Fields<'_>) -> Option<Battle> {
    let complete = fields.name.is_some()
        && fields.map_name.is_some()
        && fields.engine_version.is_some()
        && fields.game_version.is_some()
        && fields.player_count.is_some()
        && fields.max_player_count.is_some();

    complete.then(|| Battle {
        id: handle,
        tachyon_id: Some(id.to_owned()),
        ..Default::default()
    })
}

/// The handle a lobby is filed under.
///
/// A lobby already in the list keeps the handle it has, whatever it is, so a
/// lobby that survives a reset does not move. Otherwise it is the hash of the
/// uuid, stepped past any handle another lobby is already using.
pub(crate) fn handle_for(id: &str, battles: &HashMap<u32, Battle>) -> u32 {
    if let Some((handle, _)) = battles
        .iter()
        .find(|(_, battle)| battle.tachyon_id.as_deref() == Some(id))
    {
        return *handle;
    }

    let mut handle = hash(id);
    // Two uuids landing on the same number is roughly a one in a hundred
    // thousand event over a list of a thousand lobbies. The loser takes the next
    // free handle and holds it for as long as it is listed, so only the winner
    // is guaranteed the same handle after a reconnect.
    while battles.contains_key(&handle) {
        handle = handle.wrapping_add(1).max(1);
    }
    handle
}

/// FNV-1a over the lobby uuid.
///
/// Never zero, because the handle reaches the frontend as a number and zero is
/// the one `u32` that reads as absent there.
fn hash(id: &str) -> u32 {
    let mut hash: u32 = 0x811c_9dc5;
    for byte in id.as_bytes() {
        hash ^= u32::from(*byte);
        hash = hash.wrapping_mul(0x0100_0193);
    }
    hash.max(1)
}

/// A player count off the wire. The schema types it as a plain integer, so a
/// negative or oversized one is nonsense and reads as zero.
fn count(value: i64) -> u32 {
    u32::try_from(value).unwrap_or_default()
}

/// A whole lobby, as `lobby/listReset` carries it.
fn from_overview(overview: &LobbyOverview) -> Fields<'_> {
    Fields {
        name: Some(&overview.name),
        map_name: Some(&overview.map_name),
        engine_version: Some(&overview.engine_version),
        game_version: Some(&overview.game_version),
        player_count: Some(overview.player_count),
        max_player_count: Some(overview.max_player_count),
        in_progress: Some(overview.current_battle.is_some()),
    }
}

/// One entry of a `lobby/listUpdated`, where every field but the id is optional.
///
/// `currentBattle` is the one field where absent and null part company, which is
/// why the entry is read through the hand-written patch type. A battle set to
/// null has ended, and an entry that does not name it says nothing either way.
fn from_patch(entry: &LobbyOverviewPatch) -> Fields<'_> {
    Fields {
        name: entry.name.as_deref(),
        map_name: entry.map_name.as_deref(),
        engine_version: entry.engine_version.as_deref(),
        game_version: entry.game_version.as_deref(),
        player_count: entry.player_count,
        max_player_count: entry.max_player_count,
        in_progress: match entry.current_battle {
            Patched::Absent => None,
            Patched::Null => Some(false),
            Patched::Set(_) => Some(true),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use coilbox_tachyon_protocol::parse_frame;
    use serde_json::{json, Value};

    /// A `lobby/listReset` frame carrying the given lobbies verbatim.
    fn reset_frame(lobbies: Value) -> String {
        json!({
            "type": "event",
            "messageId": "1",
            "commandId": "lobby/listReset",
            "data": { "lobbies": lobbies },
        })
        .to_string()
    }

    /// A `lobby/listUpdated` frame carrying the given patch verbatim.
    fn updated_frame(lobbies: Value) -> String {
        json!({
            "type": "event",
            "messageId": "2",
            "commandId": "lobby/listUpdated",
            "data": { "lobbies": lobbies },
        })
        .to_string()
    }

    /// A whole lobby overview, with the fields the schema requires and nothing
    /// else, so a test only spells out what it cares about.
    fn overview(id: &str, patch: Value) -> Value {
        let mut base = json!({
            "id": id,
            "name": "Comet Catcher 8v8",
            "playerCount": 3,
            "maxPlayerCount": 16,
            "mapName": "Comet Catcher Remake 1.8",
            "engineVersion": "2025.01.4",
            "gameVersion": "Beyond All Reason test-1234",
            "currentBattle": null,
        });
        if let (Some(base), Some(patch)) = (base.as_object_mut(), patch.as_object()) {
            for (key, value) in patch {
                base.insert(key.clone(), value.clone());
            }
        }
        base
    }

    /// Fold a frame into the state the way the connection does.
    fn feed(state: &mut LobbyState, frame: &str) -> Vec<Delta> {
        reduce(state, &parse_frame(frame))
    }

    /// The battle filed under the Tachyon lobby `id`.
    fn battle_for<'a>(state: &'a LobbyState, id: &str) -> &'a Battle {
        state
            .battles
            .values()
            .find(|battle| battle.tachyon_id.as_deref() == Some(id))
            .unwrap_or_else(|| panic!("no battle for {id}: {:?}", state.battles))
    }

    #[test]
    fn a_reset_fills_the_battle_list() {
        let mut state = LobbyState::new();
        let deltas = feed(
            &mut state,
            &reset_frame(json!({
                "lobby-a": overview("lobby-a", json!({ "name": "First" })),
                "lobby-b": overview("lobby-b", json!({ "name": "Second", "playerCount": 9 })),
            })),
        );

        assert_eq!(state.battles.len(), 2);
        let first = battle_for(&state, "lobby-a");
        assert_eq!(first.title, "First");
        assert_eq!(first.map, "Comet Catcher Remake 1.8");
        assert_eq!(first.modname, "Beyond All Reason test-1234");
        assert_eq!(first.version, "2025.01.4");
        assert_eq!(first.player_count, Some(3));
        assert_eq!(first.max_players, 16);
        assert_eq!(battle_for(&state, "lobby-b").player_count, Some(9));
        assert_eq!(
            deltas,
            vec![
                Delta::BattleOpened {
                    id: battle_for(&state, "lobby-a").id
                },
                Delta::BattleOpened {
                    id: battle_for(&state, "lobby-b").id
                },
            ]
        );
    }

    /// The lobby id is what a later `lobby/join` names, so it has to survive the
    /// trip through a battle list keyed by number.
    #[test]
    fn a_listed_lobby_keeps_the_uuid_a_join_would_name() {
        let mut state = LobbyState::new();
        feed(
            &mut state,
            &reset_frame(json!({ "0198-uuid": overview("0198-uuid", json!({})) })),
        );

        let battle = battle_for(&state, "0198-uuid");
        assert_eq!(battle.tachyon_id.as_deref(), Some("0198-uuid"));
        assert_eq!(state.battles[&battle.id].id, battle.id);
    }

    #[test]
    fn a_patch_adds_a_lobby() {
        let mut state = LobbyState::new();
        let deltas = feed(
            &mut state,
            &updated_frame(json!({
                "lobby-a": overview("lobby-a", json!({ "name": "Fresh" })),
            })),
        );

        assert_eq!(battle_for(&state, "lobby-a").title, "Fresh");
        assert_eq!(
            deltas,
            vec![Delta::BattleOpened {
                id: battle_for(&state, "lobby-a").id
            }]
        );
    }

    #[test]
    fn a_patch_changes_one_field_and_leaves_the_rest() {
        let mut state = LobbyState::new();
        feed(
            &mut state,
            &reset_frame(json!({ "lobby-a": overview("lobby-a", json!({})) })),
        );

        let deltas = feed(
            &mut state,
            &updated_frame(json!({ "lobby-a": { "id": "lobby-a", "playerCount": 11 } })),
        );

        let battle = battle_for(&state, "lobby-a");
        assert_eq!(battle.player_count, Some(11));
        // The fields the patch did not mention are still there.
        assert_eq!(battle.title, "Comet Catcher 8v8");
        assert_eq!(battle.map, "Comet Catcher Remake 1.8");
        assert_eq!(battle.max_players, 16);
        assert_eq!(deltas, vec![Delta::BattleInfoChanged { id: battle.id }]);
    }

    /// A running battle is what makes a row offer Watch live rather than Join.
    #[test]
    fn a_reset_says_which_lobbies_have_a_battle_running() {
        let mut state = LobbyState::new();
        feed(
            &mut state,
            &reset_frame(json!({
                "lobby-a": overview(
                    "lobby-a",
                    json!({ "currentBattle": { "startedAt": 1705432698 } }),
                ),
                "lobby-b": overview("lobby-b", json!({})),
            })),
        );

        assert!(battle_for(&state, "lobby-a").in_progress);
        assert!(!battle_for(&state, "lobby-b").in_progress);
    }

    /// The pair the hand-written patch type exists for. A patch that leaves
    /// `currentBattle` out says nothing about it, and one that sets it to null
    /// says the battle has ended. Both are the same size on the wire.
    #[test]
    fn a_battle_ends_on_a_null_and_survives_a_patch_that_leaves_it_out() {
        let running = reset_frame(json!({
            "lobby-a": overview("lobby-a", json!({ "currentBattle": { "startedAt": 1705432698 } })),
        }));

        let mut left_out = LobbyState::new();
        feed(&mut left_out, &running);
        let deltas = feed(
            &mut left_out,
            &updated_frame(json!({ "lobby-a": { "id": "lobby-a", "playerCount": 11 } })),
        );
        let battle = battle_for(&left_out, "lobby-a");
        assert!(battle.in_progress, "the battle ended without being told to");
        assert_eq!(deltas, vec![Delta::BattleInfoChanged { id: battle.id }]);

        let mut nulled = LobbyState::new();
        feed(&mut nulled, &running);
        let deltas = feed(
            &mut nulled,
            &updated_frame(json!({ "lobby-a": { "id": "lobby-a", "currentBattle": null } })),
        );
        let battle = battle_for(&nulled, "lobby-a");
        assert!(!battle.in_progress, "the battle survived a null");
        assert_eq!(deltas, vec![Delta::BattleInfoChanged { id: battle.id }]);
    }

    #[test]
    fn a_patch_that_names_a_battle_starts_one() {
        let mut state = LobbyState::new();
        feed(
            &mut state,
            &reset_frame(json!({ "lobby-a": overview("lobby-a", json!({})) })),
        );

        let deltas = feed(
            &mut state,
            &updated_frame(json!({
                "lobby-a": { "id": "lobby-a", "currentBattle": { "startedAt": 1705432698 } },
            })),
        );

        let battle = battle_for(&state, "lobby-a");
        assert!(battle.in_progress);
        assert_eq!(deltas, vec![Delta::BattleInfoChanged { id: battle.id }]);
    }

    #[test]
    fn a_patch_with_a_null_takes_a_lobby_out_of_the_list() {
        let mut state = LobbyState::new();
        feed(
            &mut state,
            &reset_frame(json!({
                "lobby-a": overview("lobby-a", json!({})),
                "lobby-b": overview("lobby-b", json!({})),
            })),
        );
        let gone = battle_for(&state, "lobby-a").id;

        let deltas = feed(&mut state, &updated_frame(json!({ "lobby-a": null })));

        assert_eq!(state.battles.len(), 1);
        assert!(state
            .battles
            .contains_key(&battle_for(&state, "lobby-b").id));
        assert_eq!(deltas, vec![Delta::BattleClosed { id: gone }]);
    }

    #[test]
    fn a_null_for_a_lobby_we_never_had_changes_nothing() {
        let mut state = LobbyState::new();
        let deltas = feed(&mut state, &updated_frame(json!({ "lobby-a": null })));

        assert!(state.battles.is_empty());
        assert_eq!(deltas, vec![]);
    }

    #[test]
    fn a_lobby_keeps_its_handle_across_a_reset() {
        let mut state = LobbyState::new();
        feed(
            &mut state,
            &reset_frame(json!({ "lobby-a": overview("lobby-a", json!({})) })),
        );
        let before = battle_for(&state, "lobby-a").id;

        let deltas = feed(
            &mut state,
            &reset_frame(json!({
                "lobby-a": overview("lobby-a", json!({ "playerCount": 7 })),
                "lobby-b": overview("lobby-b", json!({})),
            })),
        );

        assert_eq!(battle_for(&state, "lobby-a").id, before);
        assert_eq!(battle_for(&state, "lobby-a").player_count, Some(7));
        assert_eq!(
            deltas,
            vec![
                Delta::BattleInfoChanged { id: before },
                Delta::BattleOpened {
                    id: battle_for(&state, "lobby-b").id
                },
            ]
        );
    }

    #[test]
    fn a_reset_drops_the_lobbies_it_no_longer_lists() {
        let mut state = LobbyState::new();
        feed(
            &mut state,
            &reset_frame(json!({
                "lobby-a": overview("lobby-a", json!({})),
                "lobby-b": overview("lobby-b", json!({})),
            })),
        );
        let gone = battle_for(&state, "lobby-b").id;

        let deltas = feed(
            &mut state,
            &reset_frame(json!({ "lobby-a": overview("lobby-a", json!({})) })),
        );

        assert_eq!(state.battles.len(), 1);
        assert_eq!(deltas, vec![Delta::BattleClosed { id: gone }]);
    }

    /// A reconnect builds a fresh state from a fresh socket. The handle is a
    /// hash of the uuid rather than a counter, so the same lobby comes back
    /// under the same number and a frontend holding the old one is still
    /// pointing at the lobby the user chose.
    #[test]
    fn a_lobby_keeps_its_handle_across_a_reconnect() {
        let first_frame = reset_frame(json!({
            "lobby-a": overview("lobby-a", json!({})),
            "lobby-b": overview("lobby-b", json!({})),
        }));
        // The same lobby, on its own, as the list happened to look later.
        let second_frame = reset_frame(json!({ "lobby-b": overview("lobby-b", json!({})) }));

        let mut first = LobbyState::new();
        feed(&mut first, &first_frame);
        let mut second = LobbyState::new();
        feed(&mut second, &second_frame);

        assert_eq!(
            battle_for(&first, "lobby-b").id,
            battle_for(&second, "lobby-b").id
        );
    }

    #[test]
    fn a_patch_for_a_lobby_we_do_not_hold_needs_the_whole_thing() {
        let mut state = LobbyState::new();
        let deltas = feed(
            &mut state,
            &updated_frame(json!({
                "lobby-a": { "id": "lobby-a", "playerCount": 4 },
                "lobby-b": overview("lobby-b", json!({})),
            })),
        );

        assert_eq!(state.battles.len(), 1);
        assert_eq!(
            deltas,
            vec![Delta::BattleOpened {
                id: battle_for(&state, "lobby-b").id
            }]
        );
    }

    #[test]
    fn a_repeat_of_what_we_already_hold_produces_no_delta() {
        let mut state = LobbyState::new();
        feed(
            &mut state,
            &reset_frame(json!({ "lobby-a": overview("lobby-a", json!({})) })),
        );

        let deltas = feed(
            &mut state,
            &reset_frame(json!({ "lobby-a": overview("lobby-a", json!({})) })),
        );
        assert_eq!(deltas, vec![]);
    }

    /// Two uuids can hash to the same number. The second one takes the next free
    /// handle rather than overwriting the lobby already there.
    #[test]
    fn a_handle_another_lobby_is_using_is_stepped_past() {
        let mut state = LobbyState::new();
        let taken = hash("lobby-a");
        state.battles.insert(
            taken,
            Battle {
                id: taken,
                tachyon_id: Some("a-different-lobby".into()),
                ..Default::default()
            },
        );

        feed(
            &mut state,
            &updated_frame(json!({ "lobby-a": overview("lobby-a", json!({})) })),
        );

        assert_eq!(state.battles.len(), 2);
        assert_eq!(battle_for(&state, "lobby-a").id, taken + 1);
        assert_eq!(
            state.battles[&taken].tachyon_id.as_deref(),
            Some("a-different-lobby")
        );
    }

    #[test]
    fn a_message_that_carries_no_lobby_list_leaves_the_state_alone() {
        let mut state = LobbyState::new();
        let deltas = feed(&mut state, r#"{"not":"a tachyon frame"}"#);
        assert_eq!(deltas, vec![]);
        assert!(state.battles.is_empty());
    }
}
