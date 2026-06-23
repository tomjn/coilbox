//! Serde models for uberstress's saved JSON reports plus pure parsers for its
//! text output. The field layout mirrors `internal/metrics/report.go` exactly so
//! we deserialize the files uberstress already writes (we never write them).
//! Parsing logic lives here as pure functions, kept apart from the IPC layer so
//! it stays unit-testable (the same split prdownloader uses in `rapid.rs`).

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

/// Latency summary for one command type. Field names match the on-disk JSON
/// (`p50_ms`, ...), so they are renamed individually rather than via rename_all.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct CmdStat {
    pub command: String,
    pub count: i64,
    #[serde(rename = "p50_ms")]
    pub p50_ms: f64,
    #[serde(rename = "p95_ms")]
    pub p95_ms: f64,
    #[serde(rename = "p99_ms")]
    pub p99_ms: f64,
    #[serde(rename = "max_ms")]
    pub max_ms: f64,
    pub per_second: f64,
}

/// A persisted snapshot of one load run, as written by uberstress.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Report {
    pub scenario: String,
    pub addr: String,
    #[serde(rename = "ref", default, skip_serializing_if = "Option::is_none")]
    pub git_ref: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub commit_sha: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub server_version: Option<String>,
    #[serde(default)]
    pub params: BTreeMap<String, String>,
    #[serde(default)]
    pub started_at: String,
    pub duration_sec: f64,
    #[serde(default)]
    pub commands: Vec<CmdStat>,
    #[serde(default)]
    pub counters: BTreeMap<String, i64>,
}

/// Condensed row for the history list: enough to scan runs without loading every
/// command's full latency breakdown. Serialized as camelCase for the frontend.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ReportSummary {
    pub file: String,
    pub scenario: String,
    pub git_ref: Option<String>,
    pub commit_sha: Option<String>,
    pub server_version: Option<String>,
    pub started_at: String,
    pub duration_sec: f64,
    pub login_p99_ms: Option<f64>,
    pub ping_p99_ms: Option<f64>,
    pub error_count: i64,
}

impl ReportSummary {
    /// Build a summary from a parsed report and its source filename.
    pub fn from_report(file: &str, rep: &Report) -> Self {
        let p99_of = |cmd: &str| rep.commands.iter().find(|c| c.command == cmd).map(|c| c.p99_ms);
        ReportSummary {
            file: file.to_string(),
            scenario: rep.scenario.clone(),
            git_ref: rep.git_ref.clone(),
            commit_sha: rep.commit_sha.clone(),
            server_version: rep.server_version.clone(),
            started_at: rep.started_at.clone(),
            duration_sec: rep.duration_sec,
            login_p99_ms: p99_of("LOGIN"),
            ping_p99_ms: p99_of("PING"),
            error_count: error_count(&rep.counters),
        }
    }
}

/// Sum of counters that signal failure: any key containing "error", "timeout",
/// or "kick" (e.g. dial_error, login_error, timeout, flood_kick).
pub fn error_count(counters: &BTreeMap<String, i64>) -> i64 {
    counters
        .iter()
        .filter(|(k, _)| {
            let k = k.to_lowercase();
            k.contains("error") || k.contains("timeout") || k.contains("kick")
        })
        .map(|(_, v)| *v)
        .sum()
}

/// Parse `uberstress list-scenarios` output into scenario names. The command
/// prints a header line then indented `  <name>  <description>` rows; we take the
/// first whitespace token of each indented row.
pub fn parse_scenarios(output: &str) -> Vec<String> {
    output
        .lines()
        .filter(|l| l.starts_with(char::is_whitespace) && !l.trim().is_empty())
        .filter_map(|l| l.split_whitespace().next())
        .map(str::to_string)
        .collect()
}

/// List `*.json` report paths in `dir`, newest first by modified time. Returns an
/// empty vec if the directory is missing or unreadable.
pub fn list_report_files(dir: &Path) -> Vec<PathBuf> {
    let mut entries: Vec<(std::time::SystemTime, PathBuf)> = match std::fs::read_dir(dir) {
        Ok(rd) => rd
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| p.extension().map(|x| x == "json").unwrap_or(false))
            .filter_map(|p| {
                let mtime = std::fs::metadata(&p).and_then(|m| m.modified()).ok()?;
                Some((mtime, p))
            })
            .collect(),
        Err(_) => return Vec::new(),
    };
    entries.sort_by(|a, b| b.0.cmp(&a.0));
    entries.into_iter().map(|(_, p)| p).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_scenario_names_skipping_header() {
        let out = "available scenarios:\n  login-storm       seeds accounts, ramps fresh logins\n  chat              users join channels\n";
        assert_eq!(parse_scenarios(out), vec!["login-storm", "chat"]);
    }

    #[test]
    fn parse_scenarios_ignores_blank_and_unindented() {
        let out = "available scenarios:\n\n  battle   x\nnot-indented\n";
        assert_eq!(parse_scenarios(out), vec!["battle"]);
    }

    #[test]
    fn deserializes_a_report_and_summarizes() {
        let json = r#"{
            "scenario": "login-storm",
            "addr": "127.0.0.1:8300",
            "ref": "local-test",
            "commit_sha": "df52682cf5803b11",
            "server_version": "TASSERVER unknown * 8301 0",
            "started_at": "2026-06-23T10:37:38Z",
            "duration_sec": 12.55,
            "commands": [
                {"command":"LOGIN","count":30,"p50_ms":13.8,"p95_ms":25.3,"p99_ms":36.0,"max_ms":36.0,"per_second":2.39},
                {"command":"PING","count":124,"p50_ms":0.56,"p95_ms":1.26,"p99_ms":5.87,"max_ms":5.95,"per_second":9.87}
            ],
            "counters": {"login_ok":30,"seed_ok":30,"dial_error":2,"timeout":1}
        }"#;
        let rep: Report = serde_json::from_str(json).unwrap();
        assert_eq!(rep.scenario, "login-storm");
        assert_eq!(rep.git_ref.as_deref(), Some("local-test"));
        assert_eq!(rep.commands.len(), 2);

        let s = ReportSummary::from_report("login-storm__df52682cf580__x.json", &rep);
        assert_eq!(s.login_p99_ms, Some(36.0));
        assert_eq!(s.ping_p99_ms, Some(5.87));
        assert_eq!(s.error_count, 3); // dial_error(2) + timeout(1)
    }

    #[test]
    fn report_without_optionals_deserializes() {
        let json = r#"{"scenario":"chat","addr":"x","duration_sec":1.0,"commands":[],"counters":{}}"#;
        let rep: Report = serde_json::from_str(json).unwrap();
        assert_eq!(rep.git_ref, None);
        assert_eq!(rep.params.len(), 0);
        let s = ReportSummary::from_report("f.json", &rep);
        assert_eq!(s.login_p99_ms, None);
        assert_eq!(s.error_count, 0);
    }
}
