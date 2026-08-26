//! The debug console's send path: one command that puts a Tachyon request on a
//! live connection and reports what came back.
//!
//! This exists for the console drawer and nothing else. Every real feature sends
//! its own command from the connection task, where it can act on the answer. The
//! drawer cannot, so it needs a way to ask for anything and read the reply, and
//! that is what this is.
//!
//! Three things keep it from being a general back door.
//!
//! It reaches one connection, named by the same `serverKey` every other command
//! takes, and only when that connection has a Tachyon client. A TASServer
//! connection has an empty slot, so it is refused rather than reinterpreted.
//!
//! It builds nothing. The frame goes out through
//! [`TachyonClient::request`](crate::tachyon_rpc::TachyonClient::request), the
//! same call the connection task makes, so the envelope and its `messageId` come
//! from one place and the drawer cannot drift from it.
//!
//! It reports rather than swallows. A refusal, a timeout and a failed response are
//! different outcomes with different retries, so the caller is told which it was
//! in the words [`RequestError`](crate::tachyon_rpc::RequestError) already uses.

use picoframe_core::CliResult;
use serde_json::{json, Value};
use tauri::State;

use crate::conn::Registry;
use crate::lock_or_recover;
use crate::tachyon_rpc::TachyonClient;

/// `mp_tachyon_request`: send one Tachyon request over a live connection and wait
/// for its answer.
///
/// `data` is the command's payload, left out of the frame when it is null, which
/// is what the 17 requests in the schema with no payload need.
///
/// The success value is the whole response frame as a string, which is what the
/// correlator hands back. The drawer has already seen it go past on the console
/// tap, so this is mostly a way of knowing the request finished at all.
#[tauri::command]
pub(crate) async fn mp_tachyon_request(
    registry: State<'_, Registry>,
    server_key: String,
    command_id: String,
    data: Option<Value>,
) -> Result<CliResult, ()> {
    // Take a clone and let the registry lock go before awaiting. Holding it across
    // the request would block every other command for up to fifteen seconds, and
    // the lock is not held across an await anywhere else in this plugin.
    let client = client_for(&registry, &server_key);
    let Some(client) = client else {
        return Ok(CliResult::err(format!(
            "not a live Tachyon connection: {server_key}"
        )));
    };

    Ok(match client.request(&command_id, data).await {
        Ok(response) => CliResult::ok(json!({ "response": response })),
        Err(e) => CliResult::err(e.to_string()),
    })
}

/// The Tachyon client for one connection, or none when the key names no
/// connection or names a line-protocol one.
fn client_for(registry: &Registry, server_key: &str) -> Option<TachyonClient> {
    let map = lock_or_recover(registry);
    let conn = map.get(server_key)?;
    let client = lock_or_recover(&conn.tachyon).clone();
    client
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::conn::{EventSink, Outbound, ServerConn, StartedBattle, TachyonHandle};
    use coilbox_lobby_protocol::{LobbyState, LoginPhase};
    use std::sync::{Arc, Mutex};
    use tauri::ipc::Channel;
    use tokio::sync::{mpsc, watch};

    /// Register a connection with no Tachyon client, which is what every TASServer
    /// connection looks like. The receiver comes back so the caller can hold it,
    /// the way a running connection task does.
    fn line_connection(registry: &Registry, server_key: &str) -> mpsc::UnboundedReceiver<Outbound> {
        let (tx, rx) = mpsc::unbounded_channel::<Outbound>();
        let sink: EventSink = Arc::new(Mutex::new(Channel::new(|_| Ok(()))));
        lock_or_recover(registry).insert(
            server_key.to_owned(),
            ServerConn {
                protocol: crate::conn::ConnProtocol::TasServer,
                tx,
                state: Arc::new(Mutex::new(LobbyState::new())),
                sink,
                // No task behind this one, so the sending half goes nowhere: these
                // tests only ask what a connection can send, never what it is doing.
                phase: watch::channel(LoginPhase::Ready).1,
                agreement: Arc::new(Mutex::new(None)),
                tachyon: TachyonHandle::default(),
                started: StartedBattle::default(),
            },
        );
        rx
    }

    #[test]
    fn a_line_protocol_connection_has_no_client_to_send_over() {
        // The empty slot is the whole guard. Without it this command would be a
        // way to push text at a TASServer connection.
        let registry = Registry::default();
        let _rx = line_connection(&registry, "alice@bar:8200");
        assert!(client_for(&registry, "alice@bar:8200").is_none());
    }

    #[test]
    fn a_key_naming_no_connection_has_no_client() {
        let registry = Registry::default();
        let _rx = line_connection(&registry, "alice@bar:8200");
        assert!(client_for(&registry, "alice@elsewhere:443").is_none());
    }
}
