//! Matchmaking on a Tachyon connection: what the server offers, what we are
//! searching for, and the match it has found.
//!
//! Pure, in the same way as [`crate::tachyon_parties`]: a message and a state go
//! in, the state is updated and the [`Delta`]s that moved come out. The outbound
//! half is pure too, so the request a click comes to can be read off a test
//! rather than off a live server.
//!
//! # Matchmaking is Tachyon only
//!
//! TASServer has nothing like it, so [`LobbyState::matchmaking`] stays at its
//! default there, the way [`LobbyState::party`] stays empty. It is on
//! `LobbyState` rather than beside it because that is the one contract the
//! frontend reads.
//!
//! # Our own requests carry the effect they had
//!
//! `matchmaking/list` answers with the queues, so that response is folded here
//! like any other frame. The other three answer with a bare success, so each
//! request carries the [`Effect`] it has once the server has taken it and the
//! connection applies that when the response arrives.
//!
//! # A party searches as one
//!
//! One member asking to search puts the whole party in the queue, and the server
//! tells every member with `matchmaking/queuesJoined`. So the queue we are
//! searching in is set from that event as readily as from our own request, and a
//! member who clicked nothing still sees the search running. The party itself is
//! [`LobbyState::party`], read by the screen rather than copied here.
//!
//! # Two parts of the specification are not on the server
//!
//! `matchmaking/queueUpdate` would say how many people are searching, and it is
//! the only thing that would. Teiserver has not built it, so nothing here folds
//! it and the screen shows how long the search has been running rather than a
//! progress bar with no data behind it.
//!
//! `matchmaking/checkAssets` is the server asking a player whether they have the
//! map and the game before it makes a match. Teiserver has not built that either,
//! so it never arrives, and there is no handler for it: answering has to be
//! immediate and synchronous on the connection task, and whether the content is
//! on disk is a unitsync scan the frontend owns and this crate cannot reach. It
//! is also party-aware, so the server asks every member and not only whoever
//! clicked, which rules out answering from a value the searching member supplied.
//! With no handler the correlator answers `command_unimplemented`, which is a
//! real protocol answer and a true one: coilbox has not built the check.

use coilbox_lobby_protocol::{Delta, LobbyState, MatchFound, MatchQueue};
use coilbox_tachyon_protocol::types::{
    self, MatchmakingListOkResponseDataPlaylistsItem as Playlist, MatchmakingListResponse,
    PrivateUserMatchmaking,
};
use coilbox_tachyon_protocol::TachyonMessage;
use picoframe_core::CliResult;
use serde_json::{json, Value};
use tauri::State;

use crate::conn::{Registry, TachyonAction};

/// The queues this server offers and where we are in them, as the connection
/// holds it before projecting it onto the state.
///
/// The playlists are kept whole because a search request needs each queue's
/// opaque version string, which is not worth showing anybody.
#[derive(Debug)]
pub(crate) struct Queues {
    playlists: Vec<Playlist>,
    searching: Vec<String>,
    found: Option<Found>,
    supported: bool,
}

/// A connection that has not asked yet, which takes the server to have
/// matchmaking until it says otherwise.
impl Default for Queues {
    fn default() -> Self {
        Self {
            playlists: Vec::new(),
            searching: Vec::new(),
            found: None,
            supported: true,
        }
    }
}

/// A match the server is waiting on, before the queue is named.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
struct Found {
    queue_id: String,
    ready_by: u64,
    ready_count: u32,
    readied: bool,
}

/// What the matchmaking screen asks of the server.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum MatchmakingAction {
    /// Fetch the queues on offer.
    List,
    /// Start searching in the queue the id names.
    Search(String),
    /// Accept the match the server has found.
    Accept,
    /// Stop searching, or turn down the match that was found.
    Cancel,
}

/// One Tachyon request the matchmaking screen asks for.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Request {
    pub command: &'static str,
    pub data: Option<Value>,
    /// What it changes once the server has taken it, for the three requests
    /// answered with a bare success. `None` for `matchmaking/list`, whose answer
    /// carries the queues and is folded by [`reduce`].
    pub effect: Option<Effect>,
}

/// What one of our own requests changes, applied when the server answers it.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum Effect {
    /// The queues we are now searching in.
    Searching(Vec<String>),
    /// We are searching in nothing, and any match found has gone with it.
    Stopped,
    /// We have accepted the match.
    Readied,
    /// This server has not built matchmaking, so the screen says so rather than
    /// showing an empty list of queues.
    Unsupported,
}

/// Apply a Tachyon message to the matchmaking state, returning the deltas
/// produced. `now` is unix millis, which is what turns the countdown a found
/// match carries into a deadline.
pub(crate) fn reduce(
    queues: &mut Queues,
    state: &mut LobbyState,
    msg: &TachyonMessage,
    now: u64,
) -> Vec<Delta> {
    let mut news = Vec::new();
    match msg {
        // Our own record carries where we are in matchmaking, so a reconnect
        // picks a search or a found match back up.
        TachyonMessage::UserSelfEvent(event) => match &event.data.user.matchmaking {
            PrivateUserMatchmaking::NoMatchmaking => {
                queues.searching.clear();
                queues.found = None;
            }
            PrivateUserMatchmaking::Queuing { queues: searching } => {
                queues.searching = searching.iter().map(|queue| queue.id.clone()).collect();
                queues.found = None;
            }
            PrivateUserMatchmaking::Found {
                queue,
                other_queues,
            } => {
                queues.searching = std::iter::once(queue.id.clone())
                    .chain(other_queues.iter().map(|other| other.id.clone()))
                    .collect();
                queues.found = Some(Found {
                    queue_id: queue.id.clone(),
                    ready_by: millis(&queue.timeout_at),
                    // Nothing says how many others have accepted, and
                    // `matchmaking/foundUpdate` is what would. Zero is the count
                    // we have been told rather than a guess.
                    ready_count: 0,
                    readied: queue.has_already_readied,
                });
            }
        },
        TachyonMessage::MatchmakingListResponse(MatchmakingListResponse::Success {
            data, ..
        }) => {
            queues.playlists = data.playlists.clone();
        }
        // A party member's search puts us in the queue too, so this is as much a
        // source of the search as our own request is.
        TachyonMessage::MatchmakingQueuesJoinedEvent(event) => {
            queues.searching = event.data.queues.clone();
        }
        TachyonMessage::MatchmakingFoundEvent(event) => {
            queues.found = Some(Found {
                queue_id: event.data.queue_id.clone(),
                ready_by: now.saturating_add(millis_from(event.data.timeout_ms)),
                ready_count: 0,
                readied: false,
            });
        }
        TachyonMessage::MatchmakingFoundUpdateEvent(event) => {
            if let Some(found) = queues.found.as_mut() {
                found.ready_count = count(event.data.ready_count);
            }
        }
        // Somebody did not accept in time. Everyone who did goes back to
        // searching, so only the match goes.
        TachyonMessage::MatchmakingLostEvent(_) => {
            queues.found = None;
            news.push(Delta::ServerMessage {
                text: "The match fell through because somebody did not accept it. \
                       You are still searching."
                    .to_owned(),
                boxed: false,
            });
        }
        TachyonMessage::MatchmakingCancelledEvent(event) => {
            queues.searching.clear();
            queues.found = None;
            news.push(Delta::ServerMessage {
                text: format!("You have stopped searching: {}.", why(event.data.reason)),
                boxed: false,
            });
        }
        _ => {}
    }

    let mut deltas = project(queues, state);
    deltas.append(&mut news);
    deltas
}

/// Apply what one of our own requests did, now that the server has taken it.
pub(crate) fn applied(queues: &mut Queues, state: &mut LobbyState, effect: &Effect) -> Vec<Delta> {
    match effect {
        Effect::Searching(ids) => queues.searching = ids.clone(),
        Effect::Stopped => {
            queues.searching.clear();
            queues.found = None;
        }
        Effect::Readied => {
            if let Some(found) = queues.found.as_mut() {
                found.readied = true;
            }
        }
        Effect::Unsupported => queues.supported = false,
    }
    project(queues, state)
}

/// The Tachyon request one matchmaking control comes to, or the sentence to put
/// in front of the user when it cannot be sent.
pub(crate) fn request_for(queues: &Queues, action: &MatchmakingAction) -> Result<Request, String> {
    match action {
        // The answer carries the queues, so there is nothing to apply on top of
        // it.
        MatchmakingAction::List => Ok(Request {
            command: "matchmaking/list",
            data: None,
            effect: None,
        }),
        // The version is the server's own opaque string for everything the queue
        // requires, so it can only come from the list. A queue we have not been
        // told about is one we cannot name in a request.
        MatchmakingAction::Search(id) => {
            let playlist = queues
                .playlists
                .iter()
                .find(|playlist| playlist.id == *id)
                .ok_or_else(|| {
                    format!("Coilbox has not been told about a {id} queue on this server.")
                })?;
            Ok(Request {
                command: "matchmaking/queue",
                data: Some(json!({
                    "queues": [{ "id": playlist.id, "version": playlist.version }],
                })),
                effect: Some(Effect::Searching(vec![playlist.id.clone()])),
            })
        }
        MatchmakingAction::Accept => Ok(Request {
            command: "matchmaking/ready",
            data: None,
            effect: Some(Effect::Readied),
        }),
        MatchmakingAction::Cancel => Ok(Request {
            command: "matchmaking/cancel",
            data: None,
            effect: Some(Effect::Stopped),
        }),
    }
}

/// Why the server stopped our search, in words the user can act on.
fn why(reason: types::MatchmakingCancelledEventDataReason) -> &'static str {
    match reason {
        types::MatchmakingCancelledEventDataReason::Intentional => "you asked to stop",
        types::MatchmakingCancelledEventDataReason::ServerError => "the server hit a problem",
        types::MatchmakingCancelledEventDataReason::PartyUserLeft => {
            "somebody left your party while it was searching"
        }
        types::MatchmakingCancelledEventDataReason::ReadyTimeout => {
            "the match was found and you did not accept it in time"
        }
        types::MatchmakingCancelledEventDataReason::VersionChanged => {
            "the queue changed while you were searching"
        }
    }
}

/// Write the queues, the search and the found match onto the state, reporting
/// whether any of them moved.
///
/// One delta covers all three, because they are one screen and the frontend
/// refreshes the whole state from it either way.
fn project(queues: &Queues, state: &mut LobbyState) -> Vec<Delta> {
    let listed: Vec<MatchQueue> = queues
        .playlists
        .iter()
        .map(|playlist| MatchQueue {
            id: playlist.id.clone(),
            name: playlist.name.clone(),
            teams: count(playlist.num_of_teams),
            team_size: count(playlist.team_size),
            ranked: playlist.ranked,
            maps: playlist
                .maps
                .iter()
                .map(|map| map.spring_name.clone())
                .collect(),
            games: playlist
                .games
                .iter()
                .map(|game| game.spring_name.clone())
                .collect(),
            engines: playlist
                .engines
                .iter()
                .map(|engine| engine.version.clone())
                .collect(),
        })
        .collect();
    let found = queues.found.as_ref().map(|found| MatchFound {
        queue_id: found.queue_id.clone(),
        ready_by: found.ready_by,
        ready_count: found.ready_count,
        readied: found.readied,
    });

    let held = &state.matchmaking;
    if held.supported == queues.supported
        && held.queues == listed
        && held.searching == queues.searching
        && held.found == found
    {
        return vec![];
    }
    state.matchmaking.supported = queues.supported;
    state.matchmaking.queues = listed;
    state.matchmaking.searching = queues.searching.clone();
    state.matchmaking.found = found;
    vec![Delta::MatchmakingChanged]
}

/// A Tachyon timestamp, which is microseconds, as the milliseconds the state
/// holds. A time before the epoch is not a deadline, and 0 is what the screen
/// reads as having none.
fn millis(at: &types::UnixTime) -> u64 {
    u64::try_from(at.0 / 1000).unwrap_or(0)
}

/// A countdown off the wire. A negative one is not a countdown, and one longer
/// than a `u64` holds is not one either.
fn millis_from(timeout_ms: i64) -> u64 {
    u64::try_from(timeout_ms).unwrap_or(0)
}

/// A count off the wire. A negative one is not a count of anything.
fn count(value: i64) -> u32 {
    u32::try_from(value).unwrap_or(0)
}

/// Queue one matchmaking action, refusing on a connection with no matchmaking.
///
/// The four commands differ only in the action they name, so the refusal and the
/// Tachyon test are written once. TASServer has no matchmaking at all, which is
/// why there is no line to fall back to.
fn matchmaking_action(
    registry: &Registry,
    server_key: &str,
    action: MatchmakingAction,
) -> CliResult {
    crate::tachyon_action(registry, server_key, TachyonAction::Matchmaking(action))
        .unwrap_or_else(|| CliResult::err("this server does not have matchmaking"))
}

/// `mp_matchmaking_list`, Tachyon only: fetch the queues on offer. The
/// connection asks once as it comes up, so this is the screen asking again.
#[tauri::command]
pub(crate) fn mp_matchmaking_list(registry: State<'_, Registry>, server_key: String) -> CliResult {
    matchmaking_action(registry.inner(), &server_key, MatchmakingAction::List)
}

/// `mp_matchmaking_queue`, Tachyon only: start searching in one queue. A party
/// searches as one, so this puts every member of yours in it.
#[tauri::command]
pub(crate) fn mp_matchmaking_queue(
    registry: State<'_, Registry>,
    server_key: String,
    queue_id: String,
) -> CliResult {
    matchmaking_action(
        registry.inner(),
        &server_key,
        MatchmakingAction::Search(queue_id),
    )
}

/// `mp_matchmaking_ready`, Tachyon only: accept the match the server has found.
#[tauri::command]
pub(crate) fn mp_matchmaking_ready(registry: State<'_, Registry>, server_key: String) -> CliResult {
    matchmaking_action(registry.inner(), &server_key, MatchmakingAction::Accept)
}

/// `mp_matchmaking_cancel`, Tachyon only: stop searching, or turn down a match
/// that has been found.
#[tauri::command]
pub(crate) fn mp_matchmaking_cancel(registry: State<'_, Registry>, server_key: String) -> CliResult {
    matchmaking_action(registry.inner(), &server_key, MatchmakingAction::Cancel)
}

#[cfg(test)]
mod tests;
