//! Pure helper for building the engine's launch argument vector. The spawn +
//! lifecycle tracking live in `lib.rs`; this stays IO-free so it can be tested.

/// Build the engine's argument vector: an optional `--write-dir <dir>` followed by
/// the start-script path (the engine takes the script as a positional argument).
pub fn build_engine_args(script_path: &str, write_dir: Option<&str>) -> Vec<String> {
    let mut args = Vec::new();
    if let Some(dir) = write_dir.filter(|d| !d.is_empty()) {
        args.push("--write-dir".into());
        args.push(dir.into());
    }
    args.push(script_path.into());
    args
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn script_path_is_positional_last() {
        let a = build_engine_args("/data/play/script.txt", None);
        assert_eq!(a, vec!["/data/play/script.txt".to_string()]);
    }

    #[test]
    fn write_dir_prepended_when_present() {
        let a = build_engine_args("/data/play/script.txt", Some("/write"));
        assert_eq!(
            a,
            vec![
                "--write-dir".to_string(),
                "/write".to_string(),
                "/data/play/script.txt".to_string(),
            ]
        );
        // Empty write-dir is ignored.
        let b = build_engine_args("/s.txt", Some(""));
        assert_eq!(b, vec!["/s.txt".to_string()]);
    }
}
