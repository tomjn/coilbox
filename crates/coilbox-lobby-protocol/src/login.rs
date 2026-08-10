//! The reply-driven login handshake state machine.
//!
//! The machine is deliberately built as a reply-driven state machine so a
//! teiserver token-auth branch can slot in later. It emits wire lines (without
//! trailing newlines) in reaction to inbound [`ServerMessage`]s; the driving
//! plugin does the actual IO and the TLS upgrade.
//!
//! Flow (login):
//! greeting -> (if `use_stls`, emit `STLS`, enter [`LoginPhase::TlsUpgrade`];
//! the plugin performs the upgrade then re-feeds the fresh greeting) -> emit
//! `LISTCOMPFLAGS`, enter [`LoginPhase::AwaitCompFlags`] -> on `COMPFLAGS` emit
//! `LOGIN`, enter [`LoginPhase::AwaitAccepted`] -> on `ACCEPTED` enter
//! [`LoginPhase::StreamingState`] -> on `LOGININFOEND` become
//! [`LoginPhase::Ready`]. `DENIED` -> [`LoginPhase::Denied`].
//!
//! Registration ([`LoginMode::Register`]) shares the greeting/compflags prelude,
//! then on `COMPFLAGS` emits `REGISTER` (instead of `LOGIN`) and terminates on
//! `REGISTRATIONACCEPTED` -> [`LoginPhase::Registered`] / `REGISTRATIONDENIED`
//! -> [`LoginPhase::Denied`].
//!
//! Verification codes: a new account's first `LOGIN` can trigger the agreement
//! handshake (`AGREEMENT...` / `AGREEMENTEND`). Rather than auto-confirm, the
//! machine parks in [`LoginPhase::AwaitAgreement`] so the UI can collect the
//! emailed code; [`LoginMachine::submit_agreement_code`] then emits
//! `CONFIRMAGREEMENT [code]` and re-sends `LOGIN` (the server does not log us in
//! on `CONFIRMAGREEMENT` alone).

use serde::Serialize;

use crate::command;
use crate::message::ServerMessage;

/// Whether the handshake is a login or a new-account registration. They share the
/// greeting/compflags prelude and differ only in the command sent on `COMPFLAGS`.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub enum LoginMode {
    #[default]
    Login,
    Register {
        email: Option<String>,
    },
}

/// Configuration for a login (or registration) attempt.
#[derive(Clone, Debug)]
pub struct LoginConfig {
    pub username: String,
    /// Already `BASE64(MD5(password))`. Sent for both `LOGIN` and `REGISTER`.
    pub password_hash: String,
    pub local_ip: String,
    pub agent: String,
    /// The per-install id sent as the `LOGIN` userID field. teiserver stores it as
    /// the account's lobby hash and refuses a login that leaves it empty or `0`, so
    /// this has to be a real value that stays the same between connections.
    pub client_id: String,
    pub compat_flags: Vec<String>,
    pub use_stls: bool,
    /// Login vs. register. Defaults to [`LoginMode::Login`] via [`Default`].
    pub mode: LoginMode,
}

/// The phases of the login handshake.
///
/// The first ten are the TASServer exchange this module drives. The two Tachyon
/// ones are set by the multiplayer plugin instead, because Tachyon presents its
/// token on the HTTP upgrade and so has no login exchange to drive: by the time
/// its socket opens we are already authenticated. Both protocols end on
/// [`LoginPhase::Ready`], which is what the whole frontend gates on.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum LoginPhase {
    AwaitGreeting,
    TlsUpgrade,
    AwaitCompFlags,
    AwaitAccepted,
    /// Register mode: `REGISTER` sent, awaiting `REGISTRATIONACCEPTED`/`...DENIED`.
    AwaitRegistration,
    /// Agreement handshake ended; parked until the UI supplies the verification
    /// code (see [`LoginMachine::submit_agreement_code`]).
    AwaitAgreement,
    StreamingState,
    Ready,
    /// Register mode: `REGISTRATIONACCEPTED` received (terminal success).
    Registered,
    Denied,
    /// Tachyon: getting a bearer token for the upgrade, refreshed from the stored
    /// sign-in when the one held in memory is spent.
    TachyonAuthorizing,
    /// Tachyon: the WebSocket upgrade is in flight.
    TachyonOpening,
}

/// The login handshake driver.
#[derive(Clone, Debug)]
pub struct LoginMachine {
    config: LoginConfig,
    phase: LoginPhase,
    /// `AGREEMENT` lines collected between the first one and `AGREEMENTEND`.
    agreement: Vec<String>,
}

impl LoginMachine {
    /// Create a machine in [`LoginPhase::AwaitGreeting`].
    pub fn new(config: LoginConfig) -> Self {
        LoginMachine {
            config,
            phase: LoginPhase::AwaitGreeting,
            agreement: Vec::new(),
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
                match &self.config.mode {
                    LoginMode::Login => {
                        self.phase = LoginPhase::AwaitAccepted;
                        vec![self.login_line()]
                    }
                    LoginMode::Register { email } => {
                        self.phase = LoginPhase::AwaitRegistration;
                        vec![command::register(
                            &self.config.username,
                            &self.config.password_hash,
                            email.as_deref(),
                        )]
                    }
                }
            }
            (LoginPhase::AwaitAccepted, ServerMessage::Accepted { .. }) => {
                self.phase = LoginPhase::StreamingState;
                vec![]
            }
            (LoginPhase::StreamingState, ServerMessage::LoginInfoEnd) => {
                self.phase = LoginPhase::Ready;
                vec![]
            }
            (LoginPhase::AwaitRegistration, ServerMessage::RegistrationAccepted) => {
                self.phase = LoginPhase::Registered;
                vec![]
            }
            (LoginPhase::AwaitRegistration, ServerMessage::RegistrationDenied { .. }) => {
                self.phase = LoginPhase::Denied;
                vec![]
            }
            // Agreement / verification: park until the UI supplies the code rather
            // than auto-confirming — servers with email verification reject an
            // empty `CONFIRMAGREEMENT`. Accumulate the text for the UI to show.
            (_, ServerMessage::Agreement { line }) => {
                self.agreement.push(line.clone());
                vec![]
            }
            (_, ServerMessage::AgreementEnd) => {
                self.phase = LoginPhase::AwaitAgreement;
                vec![]
            }
            (_, ServerMessage::Denied { reason }) => {
                self.phase = LoginPhase::Denied;
                let _ = reason;
                vec![]
            }
            _ => vec![],
        }
    }

    /// The `LOGIN` wire line for this config.
    fn login_line(&self) -> String {
        let flag_refs: Vec<&str> = self
            .config
            .compat_flags
            .iter()
            .map(String::as_str)
            .collect();
        command::login(
            &self.config.username,
            &self.config.password_hash,
            &self.config.local_ip,
            &self.config.agent,
            &self.config.client_id,
            &flag_refs,
        )
    }

    /// The agreement text accumulated from `AGREEMENT` lines, joined by newlines.
    pub fn agreement_text(&self) -> String {
        self.agreement.join("\n")
    }

    /// Supply the verification/agreement code from the UI and resume the login.
    /// Emits `CONFIRMAGREEMENT [code]` then re-sends `LOGIN` (the server does not
    /// log us in on the confirmation alone). A no-op unless parked in
    /// [`LoginPhase::AwaitAgreement`].
    pub fn submit_agreement_code(&mut self, code: Option<&str>) -> Vec<String> {
        if self.phase != LoginPhase::AwaitAgreement {
            return vec![];
        }
        self.phase = LoginPhase::AwaitAccepted;
        vec![command::confirm_agreement(code), self.login_line()]
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
            client_id: "7654321".into(),
            compat_flags: vec!["u".into(), "sp".into()],
            use_stls,
            mode: LoginMode::Login,
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
            vec!["LOGIN alice aGFzaA== 0 192.168.0.5 Coilbox 0.1\t7654321\tu sp"]
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
    fn agreement_parks_for_code_then_confirms_and_relogins() {
        let mut m = LoginMachine::new(cfg(false));
        m.on_message(&parse_line("TASSERVER 0.38 * 8201 0"));
        m.on_message(&parse_line("COMPFLAGS u sp"));

        // The server streams the agreement then ends it — the machine parks
        // instead of auto-confirming, so a verification code can be collected.
        assert!(m
            .on_message(&parse_line("AGREEMENT Please accept the terms."))
            .is_empty());
        assert!(m
            .on_message(&parse_line("AGREEMENT Then enter the code"))
            .is_empty());
        let out = m.on_message(&parse_line("AGREEMENTEND"));
        assert!(out.is_empty());
        assert_eq!(m.phase(), LoginPhase::AwaitAgreement);
        // The lines join into one block, newline-separated, for display.
        assert_eq!(
            m.agreement_text(),
            "Please accept the terms.\nThen enter the code"
        );

        // Supplying the code confirms and re-sends LOGIN.
        let out = m.submit_agreement_code(Some("1234"));
        assert_eq!(
            out,
            vec![
                "CONFIRMAGREEMENT 1234".to_string(),
                "LOGIN alice aGFzaA== 0 192.168.0.5 Coilbox 0.1\t7654321\tu sp".to_string(),
            ]
        );
        assert_eq!(m.phase(), LoginPhase::AwaitAccepted);
    }

    #[test]
    fn submit_agreement_code_is_noop_when_not_parked() {
        let mut m = LoginMachine::new(cfg(false));
        assert!(m.submit_agreement_code(Some("1234")).is_empty());
    }

    fn register_cfg(email: Option<&str>) -> LoginConfig {
        LoginConfig {
            mode: LoginMode::Register {
                email: email.map(str::to_string),
            },
            ..cfg(false)
        }
    }

    #[test]
    fn register_flow_sends_register_then_accepts() {
        let mut m = LoginMachine::new(register_cfg(Some("bob@example.com")));

        let out = m.on_message(&parse_line("TASSERVER 0.38 * 8201 0"));
        assert_eq!(out, vec!["LISTCOMPFLAGS"]);

        let out = m.on_message(&parse_line("COMPFLAGS u sp"));
        assert_eq!(out, vec!["REGISTER alice aGFzaA== bob@example.com"]);
        assert_eq!(m.phase(), LoginPhase::AwaitRegistration);

        let out = m.on_message(&parse_line("REGISTRATIONACCEPTED"));
        assert!(out.is_empty());
        assert_eq!(m.phase(), LoginPhase::Registered);
    }

    #[test]
    fn register_denied_transitions_to_denied() {
        let mut m = LoginMachine::new(register_cfg(None));
        m.on_message(&parse_line("TASSERVER 0.38 * 8201 0"));
        let out = m.on_message(&parse_line("COMPFLAGS u sp"));
        assert_eq!(out, vec!["REGISTER alice aGFzaA=="]);

        let out = m.on_message(&parse_line("REGISTRATIONDENIED username taken"));
        assert!(out.is_empty());
        assert_eq!(m.phase(), LoginPhase::Denied);
    }
}
