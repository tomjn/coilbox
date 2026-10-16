//! Getting into a Zero-K match: reading the server's `ConnectSpring` into a
//! join config, and asking for one with `RequestConnectSpring` (issue #1973).
//!
//! Zero-K's server hosts every game itself, so where to connect is not in the
//! battle at all. The server sends each player a `ConnectSpring` when the match
//! starts (`ServerBattle.StartGame` in Zero-K-Infrastructure), and sends one to
//! anybody who asks with `RequestConnectSpring` while it runs. One also arrives
//! unasked when the matchmaker puts a player in a game. So every `ConnectSpring`
//! is read as "the match is here", never as the answer to something we sent.
//!
//! The config goes in the connection's [`crate::conn::StartedBattle`] slot, the
//! one a Tachyon `battle/start` fills, so the battle room launches it the same
//! way: `mp_build_battle_config` hands it over and the play plugin writes the
//! script. That is also where each value is checked, and where a value that
//! would rewrite the script is refused (`tauri_plugin_coilbox_play::script`).
//!
//! # Content
//!
//! `ConnectSpring` names the engine, the game and the map. The server builds it
//! from the same three fields it puts on the battle header
//! (`ServerBattle.GetConnectSpringStructure` and `Battle.GetHeader`), so
//! the room's own checks against the battle are checks against this match. The
//! two are compared anyway, and a mismatch is said in the console, because it
//! means the room checked content for a different game from the one launching.

use coilbox_lobby_protocol::{Delta, LobbyState};
use coilbox_zerok_protocol::types;
use coilbox_zerok_protocol::ZerokMessage;
use serde_json::Value;
use tauri_plugin_coilbox_play::script::BattleConfig;

/// What a `ConnectSpring` produced: the config to launch, the deltas that say
/// what moved, and any line worth putting in the console.
pub(crate) struct Launch {
    pub config: Value,
    pub deltas: Vec<Delta>,
    pub notes: Vec<String>,
}

/// Read a `ConnectSpring` into a client config, and record that we were sent to
/// the match in the room we are in.
///
/// Every other message gives `None`, so the connection can hand each line it
/// receives to this.
///
/// Nothing is checked or refused here. A value the script cannot hold is
/// refused where the script is written, which is the one place every protocol's
/// join goes through, and the room shows the refusal where it shows any other
/// launch failure.
pub(crate) fn reduce(state: &mut LobbyState, msg: &ZerokMessage) -> Option<Launch> {
    let ZerokMessage::ConnectSpring(connect) = msg else {
        return None;
    };

    let config = BattleConfig {
        map_name: connect.map.clone().unwrap_or_default(),
        game_type: connect.game.clone().unwrap_or_default(),
        // The name we are logged in as, which is what Chobby writes too
        // (`GenerateScriptTxt` in `libs/liblobby/lobby/lobby.lua`). The server
        // let us in under it, so it is the name the game expects.
        my_player_name: state.my_username.clone().unwrap_or_default(),
        is_host: false,
        host_ip: connect.ip.clone(),
        // Zero means unset on the wire, because upstream's `int` has no null.
        host_port: u16::try_from(connect.port).ok().filter(|port| *port != 0),
        my_passwd: connect.script_password.clone(),
        ..Default::default()
    };

    let mut deltas = Vec::new();
    let mut notes = Vec::new();
    if let Some(id) = state.current_battle {
        // We were sent to this match, so the room offers the way back in if the
        // engine exits, rather than offering to watch.
        if state.witnessed_start != Some(id) {
            state.witnessed_start = Some(id);
            deltas.push(Delta::BattleInfoChanged { id });
        }
        if let Some(battle) = state.battles.get(&id) {
            notes.extend(mismatch(
                "engine",
                &battle.version,
                connect.engine.as_deref(),
            ));
            notes.extend(mismatch("game", &battle.modname, connect.game.as_deref()));
            notes.extend(mismatch("map", &battle.map, connect.map.as_deref()));
        }
    }

    Some(Launch {
        // `BattleConfig` holds only strings, numbers and string-keyed maps, all
        // of which serde_json can represent.
        config: serde_json::to_value(config).expect("BattleConfig always serializes"),
        deltas,
        notes,
    })
}

/// A console line when the match runs different content from the room's header.
fn mismatch(what: &str, room: &str, sent: Option<&str>) -> Option<String> {
    let sent = sent.map(str::trim).filter(|sent| !sent.is_empty())?;
    (sent != room).then(|| {
        format!(
            "the match runs {what} {sent}, but the room said {room}. Coilbox checked the room's."
        )
    })
}

/// Ask the server where a running match is.
///
/// The answer is a `ConnectSpring`, which [`reduce`] reads like any other. The
/// server refuses a battle that is not running, and one with a password we are
/// not already in, by saying so rather than answering
/// (`ConnectedUser.Process(RequestConnectSpring)`).
///
/// No password goes out. The server only reads one from somebody who is not in
/// the room, and coilbox only asks from inside it.
pub(crate) fn request(battle_id: i32) -> types::RequestConnectSpring {
    types::RequestConnectSpring {
        battle_id,
        password: None,
    }
}

#[cfg(test)]
mod tests;
