//! Persisted plugin config: the user's lobby-server list, bench/DB settings, and
//! run defaults. Stored as a single JSON file under the app-data dir. Serialized
//! camelCase so the frontend consumes it without a translation layer. Defaults
//! mirror uberstress's own flag defaults.

use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Server {
    pub id: String,
    pub name: String,
    pub addr: String,
}

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

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BenchConfig {
    pub server_dir: String,
    pub server_python: String,
    pub port: i64,
    pub natport: i64,
    pub db: DbConfig,
    pub db_reset: bool,
}

impl Default for BenchConfig {
    fn default() -> Self {
        BenchConfig {
            server_dir: String::new(),
            server_python: String::new(),
            port: 8300,
            natport: 8301,
            db: DbConfig::default(),
            db_reset: true,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Defaults {
    pub scenario: String,
    pub conns: i64,
    pub duration: String,
    pub ramp: String,
}

impl Default for Defaults {
    fn default() -> Self {
        Defaults {
            scenario: "login-storm".into(),
            conns: 100,
            duration: "30s".into(),
            ramp: "10s".into(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    #[serde(default)]
    pub servers: Vec<Server>,
    #[serde(default)]
    pub bench: BenchConfig,
    #[serde(default)]
    pub defaults: Defaults,
}

/// Read the config from `path`, returning defaults if the file does not exist.
pub fn load_config(path: &Path) -> Result<Config, String> {
    match std::fs::read_to_string(path) {
        Ok(s) => serde_json::from_str(&s).map_err(|e| format!("invalid config json: {e}")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Config::default()),
        Err(e) => Err(format!("could not read config: {e}")),
    }
}

/// Write the config to `path`, creating the parent directory if needed.
pub fn save_config(path: &Path, cfg: &Config) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("could not create config dir: {e}"))?;
    }
    let json = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    std::fs::write(path, json).map_err(|e| format!("could not write config: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_json_object_yields_defaults() {
        let cfg: Config = serde_json::from_str("{}").unwrap();
        assert_eq!(cfg.servers.len(), 0);
        assert_eq!(cfg.defaults.scenario, "login-storm");
        assert_eq!(cfg.bench.port, 8300);
        assert!(cfg.bench.db_reset);
        assert_eq!(cfg.bench.db.driver, "mysql+pymysql");
    }

    #[test]
    fn roundtrips_camelcase_keys() {
        let mut cfg = Config::default();
        cfg.servers.push(Server {
            id: "1".into(),
            name: "local".into(),
            addr: "127.0.0.1:8200".into(),
        });
        let json = serde_json::to_string(&cfg).unwrap();
        assert!(json.contains("\"dbReset\""));
        assert!(json.contains("\"mysqlBin\""));
        let back: Config = serde_json::from_str(&json).unwrap();
        assert_eq!(back.servers[0].addr, "127.0.0.1:8200");
    }
}
