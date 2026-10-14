//! What a helper asks for first when somebody reports a problem: the operating
//! system, its version and the CPU architecture. Read from the standard library
//! and the OS's own version file or tool, so it needs no dependency.

use serde::Serialize;
use std::process::Command;

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SystemInfo {
    /// `macos`, `windows` or `linux`, as `std::env::consts::OS` names them.
    pub os: String,
    /// The OS's own name for its release, such as `14.5` or `Ubuntu 24.04.1 LTS`.
    /// `None` when the OS would not say.
    pub os_version: Option<String>,
    /// `aarch64`, `x86_64` and so on.
    pub arch: String,
}

/// The `PRETTY_NAME` in the text of an `/etc/os-release` file.
pub fn pretty_name(os_release: &str) -> Option<String> {
    os_release
        .lines()
        .find_map(|l| l.strip_prefix("PRETTY_NAME="))
        .map(|v| v.trim().trim_matches('"').to_string())
        .filter(|v| !v.is_empty())
}

/// The version in the output of Windows' `ver`, such as `10.0.22631.4037` from
/// `Microsoft Windows [Version 10.0.22631.4037]`.
pub fn windows_version(ver_output: &str) -> Option<String> {
    let (_, rest) = ver_output.split_once("Version ")?;
    let v = rest.split(']').next()?.trim();
    (!v.is_empty()).then(|| v.to_string())
}

fn run(program: &str, args: &[&str]) -> Option<String> {
    let mut cmd = Command::new(program);
    cmd.args(args);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW, so no console flashes up.
        cmd.creation_flags(0x0800_0000);
    }
    let out = cmd.output().ok()?;
    out.status
        .success()
        .then(|| String::from_utf8_lossy(&out.stdout).trim().to_string())
}

fn os_version() -> Option<String> {
    match std::env::consts::OS {
        "macos" => run("sw_vers", &["-productVersion"]),
        "windows" => run("cmd", &["/C", "ver"]).and_then(|o| windows_version(&o)),
        _ => std::fs::read_to_string("/etc/os-release")
            .ok()
            .and_then(|t| pretty_name(&t)),
    }
    .filter(|v| !v.is_empty())
}

/// The machine this is running on.
pub fn read() -> SystemInfo {
    SystemInfo {
        os: std::env::consts::OS.to_string(),
        os_version: os_version(),
        arch: std::env::consts::ARCH.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pretty_name_is_unquoted() {
        let text = "NAME=\"Ubuntu\"\nPRETTY_NAME=\"Ubuntu 24.04.1 LTS\"\nID=ubuntu\n";
        assert_eq!(pretty_name(text), Some("Ubuntu 24.04.1 LTS".to_string()));
    }

    #[test]
    fn no_pretty_name_is_none() {
        assert_eq!(pretty_name("NAME=Arch\nID=arch\n"), None);
        assert_eq!(pretty_name("PRETTY_NAME=\n"), None);
    }

    #[test]
    fn windows_version_comes_out_of_ver() {
        let out = "\r\nMicrosoft Windows [Version 10.0.22631.4037]\r\n";
        assert_eq!(windows_version(out), Some("10.0.22631.4037".to_string()));
        assert_eq!(windows_version("nothing useful"), None);
    }

    #[test]
    fn this_machine_reports_its_os_and_arch() {
        let info = read();
        assert_eq!(info.os, std::env::consts::OS);
        assert_eq!(info.arch, std::env::consts::ARCH);
    }
}
