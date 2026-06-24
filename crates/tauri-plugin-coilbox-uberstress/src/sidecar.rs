//! Locate the bundled `uberstress` sidecar and translate a frontend run request
//! into its CLI argument vector. `build_args` is pure so it can be unit-tested
//! without spawning anything; the actual spawn/stream lives in `lib.rs` where it
//! has the Tauri Channel and managed state.
//!
//! The binary is bundled via Tauri `externalBin`, which places it next to the app
//! executable at runtime. We resolve it there rather than via the shell plugin so
//! the ACL grant stays uniform (`coilbox-uberstress:default`, no shell scope).

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Database connection settings for bench mode. Sent from the frontend inside
/// `RunOpts`; serialized camelCase to match the frame settings the UI persists.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DbConfig {
    pub driver: String,
    pub host: String,
    pub port: i64,
    pub user: String,
    pub password: String,
    pub name: String,
    pub mysql_bin: String,
}

impl Default for DbConfig {
    fn default() -> Self {
        DbConfig {
            driver: "mysql+pymysql".into(),
            host: "127.0.0.1".into(),
            port: 3306,
            user: "root".into(),
            password: "root".into(),
            name: "uberstress_ab".into(),
            mysql_bin: "mysql".into(),
        }
    }
}

/// Resolve the sidecar path. `UBERSTRESS_SIDECAR` overrides everything (handy for
/// `tauri dev` and tests); otherwise look next to the current executable for
/// `uberstress` (`.exe` on Windows), as Tauri's `externalBin` bundling arranges.
pub fn resolve_sidecar() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("UBERSTRESS_SIDECAR") {
        if !p.is_empty() {
            return Some(PathBuf::from(p));
        }
    }
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?;
    let candidate = dir.join(format!("uberstress{}", std::env::consts::EXE_SUFFIX));
    candidate.exists().then_some(candidate)
}

/// One streamed output line from a run.
#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LogLine {
    pub stream: String, // "out" | "err"
    pub line: String,
}

/// A run request from the frontend. `mode` selects the uberstress subcommand.
#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RunOpts {
    pub mode: String, // "load" | "bench"
    #[serde(default)]
    pub addr: String,
    pub scenario: String,
    pub conns: i64,
    pub duration: String,
    pub ramp: String,
    #[serde(default = "default_true")]
    pub register: bool,
    pub user_prefix: Option<String>,
    pub password: Option<String>,
    pub channel: Option<String>,
    pub channels: Option<i64>,
    pub say_interval: Option<String>,
    pub battle_hosts: Option<i64>,
    pub pingers: Option<i64>,
    pub ping_interval: Option<String>,
    pub ref_label: Option<String>,
    // bench-only
    pub launch: Option<bool>,
    pub server_dir: Option<String>,
    pub server_python: Option<String>,
    pub port: Option<i64>,
    pub natport: Option<i64>,
    pub ready_timeout: Option<String>,
    pub compare_to: Option<String>,
    pub db: Option<DbConfig>,
    pub db_reset: Option<bool>,
}

fn default_true() -> bool {
    true
}

/// The scenario/load flags shared by `load` and `bench`. `results_dir` is forced
/// to the caller-provided path so reports always land where we read history from.
fn push_load_flags(args: &mut Vec<String>, o: &RunOpts, results_dir: &str) {
    args.push("--scenario".into());
    args.push(o.scenario.clone());
    args.push("--conns".into());
    args.push(o.conns.to_string());
    args.push("--duration".into());
    args.push(o.duration.clone());
    args.push("--ramp".into());
    args.push(o.ramp.clone());
    args.push(format!("--register={}", o.register));
    if let Some(v) = &o.user_prefix {
        args.push("--user-prefix".into());
        args.push(v.clone());
    }
    if let Some(v) = &o.password {
        args.push("--password".into());
        args.push(v.clone());
    }
    if let Some(v) = &o.channel {
        args.push("--channel".into());
        args.push(v.clone());
    }
    if let Some(v) = o.channels {
        args.push("--channels".into());
        args.push(v.to_string());
    }
    if let Some(v) = &o.say_interval {
        args.push("--say-interval".into());
        args.push(v.clone());
    }
    if let Some(v) = o.battle_hosts {
        args.push("--battle-hosts".into());
        args.push(v.to_string());
    }
    if let Some(v) = o.pingers {
        args.push("--pingers".into());
        args.push(v.to_string());
    }
    if let Some(v) = &o.ping_interval {
        args.push("--ping-interval".into());
        args.push(v.clone());
    }
    args.push("--results".into());
    args.push(results_dir.to_string());
}

/// Build the full uberstress argument vector (subcommand + flags) for a run.
pub fn build_args(o: &RunOpts, results_dir: &str) -> Vec<String> {
    let mut args = Vec::new();
    if o.mode == "bench" {
        args.push("bench".into());
        let launch = o.launch.unwrap_or(true);
        args.push(format!("--launch={launch}"));
        if launch {
            if let Some(v) = &o.server_dir {
                args.push("--server-dir".into());
                args.push(v.clone());
            }
            if let Some(v) = &o.server_python {
                if !v.is_empty() {
                    args.push("--server-python".into());
                    args.push(v.clone());
                }
            }
            if let Some(v) = o.port {
                args.push("--port".into());
                args.push(v.to_string());
            }
            if let Some(v) = o.natport {
                args.push("--natport".into());
                args.push(v.to_string());
            }
        } else if !o.addr.is_empty() {
            args.push("--addr".into());
            args.push(o.addr.clone());
        }
        if let Some(v) = &o.ready_timeout {
            args.push("--ready-timeout".into());
            args.push(v.clone());
        }
        if let Some(db) = &o.db {
            args.push("--db-driver".into());
            args.push(db.driver.clone());
            args.push("--db-host".into());
            args.push(db.host.clone());
            args.push("--db-port".into());
            args.push(db.port.to_string());
            args.push("--db-user".into());
            args.push(db.user.clone());
            args.push("--db-password".into());
            args.push(db.password.clone());
            args.push("--db-name".into());
            args.push(db.name.clone());
            args.push("--mysql-bin".into());
            args.push(db.mysql_bin.clone());
        }
        args.push(format!("--db-reset={}", o.db_reset.unwrap_or(true)));
        if let Some(v) = &o.compare_to {
            if !v.is_empty() {
                args.push("--compare-to".into());
                args.push(v.clone());
            }
        }
    } else {
        args.push("load".into());
        args.push("--addr".into());
        args.push(o.addr.clone());
    }
    push_load_flags(&mut args, o, results_dir);
    if let Some(v) = &o.ref_label {
        if !v.is_empty() {
            args.push("--ref".into());
            args.push(v.clone());
        }
    }
    args
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base_load() -> RunOpts {
        RunOpts {
            mode: "load".into(),
            addr: "10.0.0.1:8200".into(),
            scenario: "login-storm".into(),
            conns: 500,
            duration: "30s".into(),
            ramp: "10s".into(),
            register: true,
            user_prefix: None,
            password: None,
            channel: None,
            channels: None,
            say_interval: None,
            battle_hosts: None,
            pingers: None,
            ping_interval: None,
            ref_label: Some("my-run".into()),
            launch: None,
            server_dir: None,
            server_python: None,
            port: None,
            natport: None,
            ready_timeout: None,
            compare_to: None,
            db: None,
            db_reset: None,
        }
    }

    #[test]
    fn load_args_have_subcommand_addr_and_results() {
        let a = build_args(&base_load(), "/data/results");
        assert_eq!(a[0], "load");
        assert_eq!(a[1], "--addr");
        assert_eq!(a[2], "10.0.0.1:8200");
        assert!(a.windows(2).any(|w| w[0] == "--scenario" && w[1] == "login-storm"));
        assert!(a.windows(2).any(|w| w[0] == "--results" && w[1] == "/data/results"));
        assert!(a.contains(&"--register=true".to_string()));
        assert!(a.windows(2).any(|w| w[0] == "--ref" && w[1] == "my-run"));
    }

    #[test]
    fn register_false_is_emitted_as_flag_value() {
        let mut o = base_load();
        o.register = false;
        let a = build_args(&o, "/r");
        assert!(a.contains(&"--register=false".to_string()));
    }

    #[test]
    fn bench_args_include_server_db_and_reset() {
        let mut o = base_load();
        o.mode = "bench".into();
        o.launch = Some(true);
        o.server_dir = Some("/srv/uberserver".into());
        o.port = Some(8300);
        o.db = Some(DbConfig::default());
        o.db_reset = Some(true);
        let a = build_args(&o, "/r");
        assert_eq!(a[0], "bench");
        assert!(a.contains(&"--launch=true".to_string()));
        assert!(a.windows(2).any(|w| w[0] == "--server-dir" && w[1] == "/srv/uberserver"));
        assert!(a.windows(2).any(|w| w[0] == "--db-name" && w[1] == "uberstress_ab"));
        assert!(a.contains(&"--db-reset=true".to_string()));
        // No --addr when launching locally.
        assert!(!a.contains(&"--addr".to_string()));
    }

    #[test]
    fn bench_external_server_uses_addr_not_server_dir() {
        let mut o = base_load();
        o.mode = "bench".into();
        o.launch = Some(false);
        o.addr = "1.2.3.4:8300".into();
        let a = build_args(&o, "/r");
        assert!(a.contains(&"--launch=false".to_string()));
        assert!(a.windows(2).any(|w| w[0] == "--addr" && w[1] == "1.2.3.4:8300"));
        assert!(!a.contains(&"--server-dir".to_string()));
    }
}
