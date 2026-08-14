//! Direct and LAN hosting (Rust half): a TASServer subset the host runs in
//! process, so two people on one network can play with no lobby server at all.
//!
//! The principle is that joiners use the existing client path, unchanged, and the
//! host's own client connects to this over loopback. Everything above the socket
//! is then one code path: the same battle room, the same host powers, the same
//! start script, the same launch. Coilbox never hosts the *game*, which the
//! engine has always done. This replaces the lobby layer only.
//!
//! Registered as `"coilbox-direct"`, so the frontend invokes
//! `plugin:coilbox-direct|<cmd>`.
//!
//! # What lives where
//!
//! - `coilbox-lobby-protocol::server` decides what every peer is told.
//! - [`room`] owns the listener, the sockets and the disconnects.
//! - [`beacon`] is what a room says about itself on the local network, and how
//!   what comes back from both announcements is merged into one list.
//! - [`mdns`] says the same thing again as a DNS-SD service, beside the beacon
//!   rather than instead of it.
//! - [`discovery`] carries both, and hears everybody else's.
//! - [`portmap`] asks the router to open ports, and [`stun`] asks the internet
//!   whether it worked. [`reachability`] is the two of them together.
//! - This file is the IPC surface over one running room.

use std::sync::Arc;
use std::time::Duration;

use picoframe_core::CliResult;
use serde_json::json;
use tauri::{
    plugin::{Builder, TauriPlugin},
    AppHandle, Manager, RunEvent, Runtime, State,
};
use tokio::sync::Mutex;

pub mod beacon;
pub mod discovery;
pub mod mdns;
pub mod portmap;
pub mod reachability;
pub mod room;
pub mod stun;

pub use beacon::{Beacon, LanRoom, Source};
pub use discovery::Discovery;
pub use portmap::{PortRequest, Transport};
pub use reachability::{Ports, Reachability};
pub use room::{Room, RoomOptions, RoomStatus, DEFAULT_LOBBY_PORT};

/// The reason a stopped room gives its joiners when the host did not name one.
const DEFAULT_STOP_REASON: &str = "the host stopped hosting this room";

/// How long quitting waits for the router to be told the ports are free.
///
/// Giving a mapping back is one datagram over NAT-PMP, or one HTTP request over
/// UPnP, to a box on the same network. Anything that is going to answer answers
/// in far less than this.
///
/// It is a budget and not a deadline the router has to meet. When it runs out
/// the app quits anyway and the mapping is left to its lease, because an app
/// that hangs on quit is a worse bug than a port left open for an hour.
const EXIT_RELEASE_BUDGET: Duration = Duration::from_millis(500);

/// The one room this client hosts, if it is hosting.
///
/// One rather than many: a second room would be a second battle nobody could
/// reach from the first, and the host has one engine to launch either way. An
/// async mutex because stopping a room waits for its sockets to close.
#[derive(Default)]
pub struct ActiveRoom(Arc<Mutex<Option<Room>>>);

/// The listener for other people's rooms, once anybody has asked for one.
///
/// Separate from [`ActiveRoom`] because the two are independent: a host listens
/// while hosting, and somebody looking for a room to join is not hosting at all.
#[derive(Default)]
pub struct ActiveDiscovery(Arc<Mutex<Option<Discovery>>>);

/// The ports this client has open on somebody's router, if it has any.
///
/// One set at a time, like the room: a second set would be a second host on one
/// machine, and there is one room and one engine either way. Separate from
/// [`ActiveRoom`] because the two lifetimes are not the same. A host ticks the
/// box before pressing Start, and the self-hosted battle path opens a port with
/// no room behind it at all.
#[derive(Default)]
pub struct ActivePorts(Arc<Mutex<Option<Ports>>>);

/// `direct_start_room`: bind the lobby port and start hosting.
///
/// Answers with the port the host's own client should then connect to over
/// loopback. Nothing else happens here: the battle itself is opened by that
/// client sending `OPENBATTLE`, exactly as it would to a real server.
#[tauri::command]
async fn direct_start_room(
    active: State<'_, ActiveRoom>,
    host: String,
    ip: Option<String>,
    port: Option<u16>,
    approve_joins: Option<bool>,
    advertise: Option<bool>,
) -> Result<CliResult, ()> {
    let mut slot = active.0.lock().await;
    if let Some(running) = slot.as_ref() {
        return Ok(CliResult::err(format!(
            "already hosting a room on port {}",
            running.port()
        )));
    }
    let options = RoomOptions {
        host,
        // This machine's address on the network it is actually on. Loopback was
        // the honest default while nothing here could work out anything better,
        // and it is still the fallback, but a room announcing 127.0.0.1 is a
        // room only its own host can reach. The public address behind a router
        // is port mapping's job and is still somebody else's work.
        ip: ip
            .or_else(discovery::lan_address)
            .unwrap_or_else(|| "127.0.0.1".to_string()),
        port: port.unwrap_or(DEFAULT_LOBBY_PORT),
        approve_joins: approve_joins.unwrap_or(false),
        // On by default: the point of hosting on a LAN is that the people on it
        // can find the room without being read an address down the sofa.
        advertise: advertise.unwrap_or(true),
    };
    Ok(match Room::start(options).await {
        Ok(room) => {
            let port = room.port();
            *slot = Some(room);
            CliResult::ok(json!({ "port": port }))
        }
        Err(e) => CliResult::err(e),
    })
}

/// `direct_stop_room`: stop hosting, telling everybody why.
///
/// Stopping a room a joiner is sitting in has to reach them in words. A socket
/// that simply goes quiet leaves them looking at a battle that no longer exists.
#[tauri::command]
async fn direct_stop_room(
    active: State<'_, ActiveRoom>,
    reason: Option<String>,
) -> Result<CliResult, ()> {
    let room = active.0.lock().await.take();
    Ok(match room {
        Some(room) => {
            room.stop(reason.as_deref().unwrap_or(DEFAULT_STOP_REASON))
                .await;
            CliResult::ok(json!({ "stopped": true }))
        }
        None => CliResult::ok(json!({ "stopped": false })),
    })
}

/// `direct_room_status`: what the room holds, or `null` when not hosting.
#[tauri::command]
async fn direct_room_status(active: State<'_, ActiveRoom>) -> Result<CliResult, ()> {
    let slot = active.0.lock().await;
    let status = match slot.as_ref() {
        Some(room) => room.status().await,
        None => None,
    };
    Ok(CliResult::ok(json!({ "room": status })))
}

/// `direct_answer_join`: let a waiting joiner in, or turn them away with a
/// reason they read verbatim.
///
/// The host's own client could send `JOINBATTLEACCEPT` over its loopback socket
/// and the room would act on it, but there is no `mp_join_battle_accept` to send
/// it with, and the half that exists (`mp_join_battle_deny`) is keyed by server
/// connection. Answering here keeps one action in one plugin, against the same
/// room the pending names were read from.
///
/// An answer to a join the room is not holding is ignored, so the host pressing
/// a button on a name that has already given up is harmless.
#[tauri::command]
async fn direct_answer_join(
    active: State<'_, ActiveRoom>,
    username: String,
    allow: bool,
    reason: Option<String>,
) -> Result<CliResult, ()> {
    let slot = active.0.lock().await;
    Ok(match slot.as_ref() {
        Some(room) => {
            room.answer_join(&username, allow, reason);
            CliResult::ok(json!({ "answered": true }))
        }
        None => CliResult::err("not hosting a room"),
    })
}

/// `direct_lan_rooms`: the rooms being announced on this network right now.
///
/// Starts listening the first time it is asked, so a client that never looks for
/// a room never binds the beacon port. The first answer is usually empty and the
/// next one, two seconds later, is not: beacons arrive when their hosts send
/// them, and there is nothing to ask for.
///
/// Answers with everything heard, this client's own room included and marked. A
/// host who cannot see their own room in the list has no way to tell whether
/// anybody else can.
#[tauri::command]
async fn direct_lan_rooms(
    active: State<'_, ActiveRoom>,
    discovery: State<'_, ActiveDiscovery>,
) -> Result<CliResult, ()> {
    let mut slot = discovery.0.lock().await;
    if slot.is_none() {
        match Discovery::start() {
            Ok(started) => *slot = Some(started),
            Err(e) => {
                return Ok(CliResult::err(format!(
                    "cannot listen for rooms on this network: {e}"
                )))
            }
        }
    }
    let own = active
        .0
        .lock()
        .await
        .as_ref()
        .map(|room| room.beacon_id().to_string());
    let rooms = match slot.as_ref() {
        Some(listening) => listening.rooms(own.as_deref()),
        None => Vec::new(),
    };
    Ok(CliResult::ok(json!({ "rooms": rooms })))
}

/// `direct_stop_discovery`: stop listening and free the beacon port.
///
/// Nothing breaks if this is never called, but a client that has wandered off
/// the page holding the beacon port open is one more thing standing between the
/// next coilbox on this machine and a working listener.
#[tauri::command]
async fn direct_stop_discovery(discovery: State<'_, ActiveDiscovery>) -> Result<CliResult, ()> {
    let listening = discovery.0.lock().await.take();
    let stopped = listening.is_some();
    if let Some(listening) = listening {
        listening.stop();
    }
    Ok(CliResult::ok(json!({ "stopped": stopped })))
}

/// `direct_local_addresses`: every address this machine can be dialled at, best
/// first and loopback last, each named by the interface it is on.
///
/// This is what a host reads out to somebody who wants to join by typing an
/// address (issue #1611). The room already knows one such address, because it
/// announces one, but a machine with a VPN or Docker on it has several and only
/// the person hosting can tell which one their friend can reach. So all of them
/// are answered, named, and none is chosen here.
#[tauri::command]
async fn direct_local_addresses() -> Result<CliResult, ()> {
    Ok(CliResult::ok(
        json!({ "addresses": discovery::local_addresses() }),
    ))
}

/// `direct_open_ports`: ask the router to open every port given, then look from
/// outside to see whether it made any difference.
///
/// Replaces whatever was open before, so a host who changes the port they are
/// hosting on does not leave the old one behind. Never fails: a router that
/// refuses is an outcome the host reads and acts on, and the report carries the
/// port numbers the manual forwarding instructions need.
#[tauri::command]
async fn direct_open_ports(
    active: State<'_, ActivePorts>,
    ports: Vec<PortRequest>,
) -> Result<CliResult, ()> {
    let mut slot = active.0.lock().await;
    if let Some(previous) = slot.take() {
        previous.release().await;
    }
    let (report, held) = reachability::open(ports).await;
    *slot = held;
    Ok(CliResult::ok(json!({ "reachability": report })))
}

/// `direct_close_ports`: hand the ports back to the router.
///
/// Called when a host unticks the box and when a room stops. Quitting the app
/// does the same thing without the round trip through the frontend, in
/// [`release_ports_on_exit`]. A mapping left on somebody's router after the
/// thing that wanted it has gone is rude, and the lease that limits the damage
/// when none of those run is an hour long.
#[tauri::command]
async fn direct_close_ports(active: State<'_, ActivePorts>) -> Result<CliResult, ()> {
    let held = active.0.lock().await.take();
    let closed = held.is_some();
    if let Some(held) = held {
        held.release().await;
    }
    Ok(CliResult::ok(json!({ "closed": closed })))
}

/// `direct_port_status`: what is open right now, or `null`.
///
/// So a host who has walked away from the page that opened the ports and come
/// back still has their address to read out.
#[tauri::command]
async fn direct_port_status(active: State<'_, ActivePorts>) -> Result<CliResult, ()> {
    let slot = active.0.lock().await;
    let report = slot.as_ref().map(|held| held.report.clone());
    Ok(CliResult::ok(json!({ "reachability": report })))
}

/// Hand the ports back on the way out, without holding the quit up for long.
///
/// What this buys, exactly: an ordinary quit gives the mapping back, and a quit
/// with nothing open costs nothing. What it cannot cover is a kill, a crash or a
/// power cut, where no code of ours runs at all and the mapping stands until its
/// lease runs out an hour later. On the routers that refuse a finite lease there
/// is no expiry to fall back on, which is why the release is worth waiting half
/// a second for rather than firing and forgetting.
fn release_ports_on_exit<R: Runtime>(app: &AppHandle<R>) {
    let Some(state) = app.try_state::<ActivePorts>() else {
        return;
    };
    let slot = Arc::clone(&state.0);
    // Nothing open, which is nearly every quit, waits for nothing at all.
    if let Ok(held) = slot.try_lock() {
        if held.is_none() {
            return;
        }
    }
    let (done, finished) = std::sync::mpsc::channel();
    tauri::async_runtime::spawn(async move {
        if let Some(held) = slot.lock().await.take() {
            let _ = tokio::time::timeout(EXIT_RELEASE_BUDGET, held.release()).await;
        }
        let _ = done.send(());
    });
    // The runtime is still running while this thread waits, so the release makes
    // progress. When the budget is gone the app quits regardless.
    let _ = finished.recv_timeout(EXIT_RELEASE_BUDGET);
}

/// Build the plugin. Registered as `"coilbox-direct"`.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("coilbox-direct")
        .on_event(|app, event| {
            if matches!(event, RunEvent::Exit) {
                release_ports_on_exit(app);
            }
        })
        .setup(|app, _api| {
            tauri::Manager::manage(app, ActiveRoom::default());
            tauri::Manager::manage(app, ActiveDiscovery::default());
            tauri::Manager::manage(app, ActivePorts::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            direct_start_room,
            direct_stop_room,
            direct_room_status,
            direct_answer_join,
            direct_lan_rooms,
            direct_stop_discovery,
            direct_local_addresses,
            direct_open_ports,
            direct_close_ports,
            direct_port_status
        ])
        .build()
}
