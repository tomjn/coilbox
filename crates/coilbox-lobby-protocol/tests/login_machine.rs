//! Golden test: the LoginMachine emits the right lines, in order, across the
//! handshake.

use coilbox_lobby_protocol::{parse_line, LoginConfig, LoginMachine, LoginMode, LoginPhase};

fn config(use_stls: bool) -> LoginConfig {
    LoginConfig {
        username: "alice".into(),
        password_hash: "X03MO1qnZdYdgyfeuILPmQ==".into(),
        local_ip: "192.168.0.5".into(),
        agent: "Coilbox 0.1".into(),
        client_id: "0".into(),
        compat_flags: vec!["u".into(), "sp".into()],
        use_stls,
        mode: LoginMode::Login,
    }
}

#[test]
fn full_plain_handshake_line_order() {
    let mut m = LoginMachine::new(config(false));
    let mut emitted: Vec<String> = Vec::new();

    for line in [
        "TASSERVER 0.38 * 8201 0",
        "COMPFLAGS u sp b token",
        "ACCEPTED alice",
        "ADDUSER alice GB 1 agent",
        "LOGININFOEND",
    ] {
        emitted.extend(m.on_message(&parse_line(line)));
    }

    assert_eq!(
        emitted,
        vec![
            "LISTCOMPFLAGS".to_string(),
            "LOGIN alice X03MO1qnZdYdgyfeuILPmQ== 0 192.168.0.5 Coilbox 0.1\t0\tu sp".to_string(),
        ]
    );
    assert_eq!(m.phase(), LoginPhase::Ready);
}

#[test]
fn stls_handshake_emits_stls_before_listcompflags() {
    let mut m = LoginMachine::new(config(true));

    let out = m.on_message(&parse_line("TASSERVER 0.38 * 8201 0"));
    assert_eq!(out, vec!["STLS".to_string()]);
    assert_eq!(m.phase(), LoginPhase::TlsUpgrade);

    // Plugin upgrades TLS and re-feeds the greeting.
    let out = m.on_message(&parse_line("TASSERVER 0.38 * 8201 0"));
    assert_eq!(out, vec!["LISTCOMPFLAGS".to_string()]);
    assert_eq!(m.phase(), LoginPhase::AwaitCompFlags);
}
