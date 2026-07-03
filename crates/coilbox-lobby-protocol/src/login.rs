//! The reply-driven login handshake state machine.
//!
//! The machine is deliberately built as a reply-driven state machine so a
//! teiserver token-auth branch can slot in later. It emits wire lines (without
//! trailing newlines) in reaction to inbound [`ServerMessage`]s; the driving
//! plugin does the actual IO and the TLS upgrade.
//!
//! Flow:
//! greeting -> (if `use_stls`, emit `STLS`, enter [`LoginPhase::TlsUpgrade`];
//! the plugin performs the upgrade then re-feeds the fresh greeting) -> emit
//! `LISTCOMPFLAGS`, enter [`LoginPhase::AwaitCompFlags`] -> on `COMPFLAGS` emit
//! `LOGIN`, enter [`LoginPhase::AwaitAccepted`] -> on `ACCEPTED` enter
//! [`LoginPhase::StreamingState`] -> on `LOGININFOEND` become
//! [`LoginPhase::Ready`]. `DENIED` -> [`LoginPhase::Denied`].

use serde::Serialize;

use crate::command;
use crate::message::ServerMessage;

/// Configuration for a login attempt.
#[derive(Clone, Debug)]
pub struct LoginConfig {
    pub username: String,
    /// Already `BASE64(MD5(password))`.
    pub password_hash: String,
    pub local_ip: String,
    pub agent: String,
    pub client_id: String,
    pub compat_flags: Vec<String>,
    pub use_stls: bool,
}

/// The phases of the login handshake.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum LoginPhase {
    AwaitGreeting,
    TlsUpgrade,
    AwaitCompFlags,
    AwaitAccepted,
    StreamingState,
    Ready,
    Denied,
}

/// The login handshake driver.
#[derive(Clone, Debug)]
pub struct LoginMachine {
    config: LoginConfig,
    phase: LoginPhase,
}

impl LoginMachine {
    /// Create a machine in [`LoginPhase::AwaitGreeting`].
    pub fn new(config: LoginConfig) -> Self {
        LoginMachine {
            config,
            phase: LoginPhase::AwaitGreeting,
        }
    }

    /// The current phase.
    pub fn phase(&self) -> LoginPhase {
        self.phase
    }

    /// Feed an inbound server message, returning wire lines to send (each with
    /// no trailing newline).
    pub fn on_message(&mut self, msg: &ServerMessage) -> Vec<String> {
        match (self.phase, msg) {
            // Greeting (also re-fed after a TLS upgrade).
            (
                LoginPhase::AwaitGreeting | LoginPhase::TlsUpgrade,
                ServerMessage::TasServer { .. },
            ) => {
                if self.config.use_stls && self.phase == LoginPhase::AwaitGreeting {
                    self.phase = LoginPhase::TlsUpgrade;
                    vec![command::stls()]
                } else {
                    self.phase = LoginPhase::AwaitCompFlags;
                    vec![command::list_comp_flags()]
                }
            }
            (LoginPhase::AwaitCompFlags, ServerMessage::CompFlags { flags }) => {
                // TODO(teiserver): token auth branch here — if `flags` advertises
                // a token-auth flag, negotiate a token instead of sending the
                // MD5 password LOGIN below.
                let _ = flags;
                self.phase = LoginPhase::AwaitAccepted;
                let flag_refs: Vec<&str> = self
                    .config
                    .compat_flags
                    .iter()
                    .map(String::as_str)
                    .collect();
                vec![command::login(
                    &self.config.username,
                    &self.config.password_hash,
                    &self.config.local_ip,
                    &self.config.agent,
                    &self.config.client_id,
                    &flag_refs,
                )]
            }
            (LoginPhase::AwaitAccepted, ServerMessage::Accepted { .. }) => {
                self.phase = LoginPhase::StreamingState;
                vec![]
            }
            (LoginPhase::StreamingState, ServerMessage::LoginInfoEnd) => {
                self.phase = LoginPhase::Ready;
                vec![]
            }
            // Agreement path: confirm so the server proceeds to the compflags/login.
            (_, ServerMessage::Agreement { .. }) => vec![],
            (_, ServerMessage::AgreementEnd) => {
                vec![command::confirm_agreement(None)]
            }
            (_, ServerMessage::Denied { reason }) => {
                self.phase = LoginPhase::Denied;
                let _ = reason;
                vec![]
            }
            _ => vec![],
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::message::parse_line;

    fn cfg(use_stls: bool) -> LoginConfig {
        LoginConfig {
            username: "alice".into(),
            password_hash: "aGFzaA==".into(),
            local_ip: "192.168.0.5".into(),
            agent: "Coilbox 0.1".into(),
            client_id: "0".into(),
            compat_flags: vec!["u".into(), "sp".into()],
            use_stls,
        }
    }

    #[test]
    fn plain_flow_emits_expected_lines() {
        let mut m = LoginMachine::new(cfg(false));
        assert_eq!(m.phase(), LoginPhase::AwaitGreeting);

        let out = m.on_message(&parse_line("TASSERVER 0.38 * 8201 0"));
        assert_eq!(out, vec!["LISTCOMPFLAGS"]);
        assert_eq!(m.phase(), LoginPhase::AwaitCompFlags);

        let out = m.on_message(&parse_line("COMPFLAGS u sp b"));
        assert_eq!(
            out,
            vec!["LOGIN alice aGFzaA== 0 192.168.0.5 Coilbox 0.1\t0\tu sp"]
        );
        assert_eq!(m.phase(), LoginPhase::AwaitAccepted);

        let out = m.on_message(&parse_line("ACCEPTED alice"));
        assert!(out.is_empty());
        assert_eq!(m.phase(), LoginPhase::StreamingState);

        let out = m.on_message(&parse_line("LOGININFOEND"));
        assert!(out.is_empty());
        assert_eq!(m.phase(), LoginPhase::Ready);
    }

    #[test]
    fn stls_flow_emits_stls_first() {
        let mut m = LoginMachine::new(cfg(true));
        let out = m.on_message(&parse_line("TASSERVER 0.38 * 8201 0"));
        assert_eq!(out, vec!["STLS"]);
        assert_eq!(m.phase(), LoginPhase::TlsUpgrade);

        // Plugin re-feeds the fresh greeting after upgrading.
        let out = m.on_message(&parse_line("TASSERVER 0.38 * 8201 0"));
        assert_eq!(out, vec!["LISTCOMPFLAGS"]);
        assert_eq!(m.phase(), LoginPhase::AwaitCompFlags);
    }

    #[test]
    fn denied_transitions_to_denied() {
        let mut m = LoginMachine::new(cfg(false));
        m.on_message(&parse_line("TASSERVER 0.38 * 8201 0"));
        m.on_message(&parse_line("COMPFLAGS u sp"));
        let out = m.on_message(&parse_line("DENIED bad password"));
        assert!(out.is_empty());
        assert_eq!(m.phase(), LoginPhase::Denied);
    }

    #[test]
    fn agreement_end_confirms() {
        let mut m = LoginMachine::new(cfg(false));
        m.on_message(&parse_line("TASSERVER 0.38 * 8201 0"));
        let out = m.on_message(&parse_line("AGREEMENTEND"));
        assert_eq!(out, vec!["CONFIRMAGREEMENT"]);
    }
}
