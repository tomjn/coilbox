//! A stand-in `libunitsync` the real worker binary can load, for
//! `tests/serve.rs` (issue #3722).
//!
//! `src/ffi/stub.rs` stands in for the library inside the worker's own unit
//! tests, by filling function pointers. That cannot follow the worker into
//! another process, and a worker that stays running is only itself as a
//! process: its `Init` is shared between requests, and it exits on its input
//! closing. So this is the same idea built as a real shared library, an example
//! target because `cargo test` builds those and nothing ships them.
//!
//! It behaves like the engine in the one way that matters here: it looks at the
//! disk during `Init` and at no other time. The maps it reports are the files
//! that were in `<data dir>/maps` when `Init` last ran, so a test can tell an
//! `Init` that was reused from one that was run again.
//!
//! Told what to do through the environment:
//!
//! - `FAKE_UNITSYNC_DATADIR`: the one data directory it reports.
//! - `FAKE_UNITSYNC_LOG`: a file it appends a line to for each call that a test
//!   counts or waits on.
//! - `FAKE_UNITSYNC_INIT_MS`: how long `Init` takes.
//! - `FAKE_UNITSYNC_READ_MS`: how long `GetMapCount` takes, which is a read.

// The exports carry unitsync's own names, which are not snake case.
#![allow(non_snake_case)]

use std::ffi::{c_char, c_int, CString};
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

/// What `Init` found, and the strings handed out since, kept alive because the
/// caller copies them after the call returns.
struct Library {
    maps: Vec<CString>,
    datadir: Option<CString>,
}

static LIBRARY: Mutex<Library> = Mutex::new(Library {
    maps: Vec::new(),
    datadir: None,
});

fn datadir() -> Option<PathBuf> {
    std::env::var_os("FAKE_UNITSYNC_DATADIR").map(PathBuf::from)
}

fn log(line: &str) {
    let Some(path) = std::env::var_os("FAKE_UNITSYNC_LOG") else {
        return;
    };
    if let Ok(mut file) = std::fs::File::options()
        .create(true)
        .append(true)
        .open(path)
    {
        let _ = writeln!(file, "{line}");
    }
}

fn pause(var: &str) {
    let ms = std::env::var(var).ok().and_then(|ms| ms.parse().ok());
    if let Some(ms) = ms {
        std::thread::sleep(Duration::from_millis(ms));
    }
}

#[no_mangle]
pub extern "C" fn Init(_is_server: bool, _id: c_int) -> c_int {
    log("Init begin");
    pause("FAKE_UNITSYNC_INIT_MS");
    let mut names: Vec<String> = datadir()
        .and_then(|dir| std::fs::read_dir(dir.join("maps")).ok())
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|entry| Some(entry.path().file_stem()?.to_string_lossy().into_owned()))
        .collect();
    names.sort();
    let mut library = LIBRARY.lock().unwrap();
    library.maps = names
        .into_iter()
        .filter_map(|name| CString::new(name).ok())
        .collect();
    library.datadir = datadir().and_then(|dir| CString::new(dir.to_string_lossy().as_ref()).ok());
    log("Init end");
    1
}

#[no_mangle]
pub extern "C" fn UnInit() {
    log("UnInit");
}

#[no_mangle]
pub extern "C" fn GetNextError() -> *const c_char {
    std::ptr::null()
}

#[no_mangle]
pub extern "C" fn GetMapCount() -> c_int {
    log("GetMapCount");
    pause("FAKE_UNITSYNC_READ_MS");
    LIBRARY.lock().unwrap().maps.len() as c_int
}

#[no_mangle]
pub extern "C" fn GetMapName(index: c_int) -> *const c_char {
    let library = LIBRARY.lock().unwrap();
    match library.maps.get(index as usize) {
        Some(name) => name.as_ptr(),
        None => std::ptr::null(),
    }
}

#[no_mangle]
pub extern "C" fn GetMapArchiveCount(_map: *const c_char) -> c_int {
    0
}

#[no_mangle]
pub extern "C" fn GetMapArchiveName(_index: c_int) -> *const c_char {
    std::ptr::null()
}

#[no_mangle]
pub extern "C" fn GetPrimaryModCount() -> c_int {
    0
}

#[no_mangle]
pub extern "C" fn GetPrimaryModArchive(_index: c_int) -> *const c_char {
    std::ptr::null()
}

#[no_mangle]
pub extern "C" fn GetPrimaryModArchiveCount(_index: c_int) -> c_int {
    0
}

#[no_mangle]
pub extern "C" fn GetPrimaryModArchiveList(_index: c_int) -> *const c_char {
    std::ptr::null()
}

#[no_mangle]
pub extern "C" fn GetPrimaryModInfoCount(_index: c_int) -> c_int {
    0
}

#[no_mangle]
pub extern "C" fn GetInfoKey(_index: c_int) -> *const c_char {
    std::ptr::null()
}

#[no_mangle]
pub extern "C" fn GetInfoValueString(_index: c_int) -> *const c_char {
    std::ptr::null()
}

#[no_mangle]
pub extern "C" fn RemoveAllArchives() {
    log("RemoveAllArchives");
}

#[no_mangle]
pub extern "C" fn GetDataDirectoryCount() -> c_int {
    c_int::from(LIBRARY.lock().unwrap().datadir.is_some())
}

#[no_mangle]
pub extern "C" fn GetDataDirectory(_index: c_int) -> *const c_char {
    match &LIBRARY.lock().unwrap().datadir {
        Some(dir) => dir.as_ptr(),
        None => std::ptr::null(),
    }
}
