//! Runs the scan over a folder of real game Lua and prints what it finds, for
//! the compatibility mode work (issue #4553).
//!
//! `COILBOX_LUACOMPAT_SWEEP=<folder> cargo test -p coilbox-luacompat --test
//! sweep -- --ignored --nocapture`, where the folder holds a game's extracted
//! files.

use coilbox_luacompat::{scan, Catalogue};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

fn lua_files(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(read) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in read.flatten() {
        let path = entry.path();
        if path.is_dir() {
            lua_files(&path, out);
        } else if path
            .extension()
            .is_some_and(|e| e.eq_ignore_ascii_case("lua"))
        {
            out.push(path);
        }
    }
}

#[test]
#[ignore = "needs COILBOX_LUACOMPAT_SWEEP set to a folder of extracted game Lua"]
fn sweep() {
    let dir = std::env::var("COILBOX_LUACOMPAT_SWEEP").expect("COILBOX_LUACOMPAT_SWEEP");
    let mut files = Vec::new();
    lua_files(Path::new(&dir), &mut files);
    files.sort();

    let mut total = 0;
    let mut by_entry: BTreeMap<String, usize> = BTreeMap::new();
    for file in &files {
        let source = String::from_utf8_lossy(&std::fs::read(file).unwrap()).into_owned();
        for hit in scan(&source, Catalogue::embedded()) {
            total += 1;
            *by_entry.entry(hit.entry_id.clone()).or_default() += 1;
            println!(
                "{}:{}:{} {} {}",
                file.strip_prefix(&dir).unwrap_or(file).display(),
                hit.line,
                hit.column,
                hit.entry_id,
                hit.text
            );
        }
    }
    println!("files scanned: {}", files.len());
    println!("hits: {total}");
    for (id, n) in &by_entry {
        println!("{n:5} {id}");
    }
    assert!(total >= 1, "expected at least one hit");
}
