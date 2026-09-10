//! `cargo run -p coilbox-bos2lua --example convert -- <script.bos> <scripts dir>`
//!
//! Converts one script and prints the Lua, then any warnings. Every file under
//! the scripts folder is available to `#include`.

use coilbox_bos2lua::{convert, Options};
use std::collections::HashMap;
use std::path::Path;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let (Some(script), Some(dir)) = (args.get(1), args.get(2)) else {
        eprintln!("usage: convert <script.bos> <scripts dir>");
        std::process::exit(2);
    };
    let dir = Path::new(dir);
    let base = dir.parent().unwrap_or(dir);
    let mut includes = HashMap::new();
    let mut stack = vec![dir.to_path_buf()];
    while let Some(d) = stack.pop() {
        for entry in std::fs::read_dir(&d).expect("readable folder").flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else if let Ok(rel) = path.strip_prefix(base) {
                let text = String::from_utf8_lossy(&std::fs::read(&path).unwrap()).into_owned();
                includes.insert(rel.to_string_lossy().replace('\\', "/"), text);
            }
        }
    }
    let path = Path::new(script);
    let name = path
        .strip_prefix(base)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/");
    let source =
        String::from_utf8_lossy(&std::fs::read(path).expect("readable script")).into_owned();
    let linear_scale = std::fs::read(path.with_extension("cob"))
        .ok()
        .and_then(|cob| coilbox_bos2lua::linear_scale(&source, &cob))
        .unwrap_or(coilbox_bos2lua::MODERN_LINEAR);
    match convert(
        &source,
        &Options {
            name: &name,
            includes: &includes,
            pieces: None,
            linear_scale,
        },
    ) {
        Ok(c) => {
            println!("{}", c.lua);
            for w in c.warnings {
                eprintln!("warning: {w}");
            }
        }
        Err(e) => {
            eprintln!("error: {e}");
            std::process::exit(1);
        }
    }
}
