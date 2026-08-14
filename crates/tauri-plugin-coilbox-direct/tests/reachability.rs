//! The two checks that need something this process does not control: a router,
//! and the internet.
//!
//! Both are ignored by default, so CI never runs them. CI has neither a router
//! that will answer NAT-PMP nor a reason to send traffic to a public STUN
//! server, and a test that depends on somebody's home network is a test that
//! fails for reasons nobody can fix.
//!
//! Run them by hand on a machine with a real router:
//!
//! ```text
//! cargo test -p tauri-plugin-coilbox-direct --test reachability -- --ignored --nocapture
//! ```
//!
//! Neither asserts a mapping succeeded. Failure is the normal outcome on a
//! router with UPnP switched off and on carrier grade NAT, and a test that
//! demanded success would be a test that says the code is broken when the
//! network is. What they assert is that the answer is a coherent one, and they
//! print it so a human can read what the router actually said.

use tauri_plugin_coilbox_direct::portmap::Transport;
use tauri_plugin_coilbox_direct::{reachability, stun, PortRequest};

/// The two ports a room needs: the lobby the joiners' clients dial, and the
/// engine's game port they will dial afterwards.
fn a_rooms_ports() -> Vec<PortRequest> {
    vec![
        PortRequest {
            port: 8200,
            transport: Transport::Tcp,
            description: "Coilbox lobby".to_string(),
        },
        PortRequest {
            port: 8452,
            transport: Transport::Udp,
            description: "Coilbox game".to_string(),
        },
    ]
}

#[tokio::test]
#[ignore = "needs a real router"]
async fn open_two_ports_on_whatever_router_is_here() {
    let (report, held) = reachability::open(a_rooms_ports()).await;
    println!("{}", serde_json::to_string_pretty(&report).unwrap());

    match report.method {
        // A router that opened them opened both of them, because the whole
        // point is that half a room's ports is worse than none.
        Some(_) => assert_eq!(report.ports.len(), 2, "a kept mapping covers every port"),
        // A router that refused says why, and names both ports so the host can
        // forward them by hand.
        None => {
            assert!(report.problem.is_some(), "a refusal is explained");
            assert_eq!(report.wanted.len(), 2, "both ports reach the instructions");
            assert!(report.ports.is_empty(), "nothing is claimed to be open");
        }
    }

    if let Some(held) = held {
        held.release().await;
    }
}

#[tokio::test]
#[ignore = "needs the internet"]
async fn stun_says_what_the_internet_sees() {
    let found = stun::public_address(None).await;
    println!("reflexive address: {found:?}");
    let Some(found) = found else {
        panic!("no STUN server answered, which is a machine with no route out");
    };
    assert!(
        !found.ip.is_private() && !found.ip.is_loopback(),
        "a reflexive address is the outside of the NAT, not the inside"
    );
}
