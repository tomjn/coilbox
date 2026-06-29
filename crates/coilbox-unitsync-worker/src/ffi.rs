//! Thin, runtime-loaded binding to the engine's `libunitsync` C ABI.
//!
//! unitsync is a global C singleton compiled into every engine install. We never
//! link it: we `dlopen` the user's copy at runtime (`Unitsync::load`) and resolve
//! the handful of symbols we need. A few symbols have drifted across engine
//! versions, so the truly load-bearing ones are *required* (a missing one fails
//! the load) and the rest are *optional* — resolved softly, their data simply
//! omitted when absent.
//!
//! All `*const c_char` the library returns are library-owned: we copy into
//! `String` via [`cstr`] and never free them. Stateful accessor sequences
//! (count-then-iterate) are encapsulated as single methods so callers can't get
//! the order wrong.

use libloading::{Library, Symbol};
use std::collections::BTreeMap;
use std::ffi::{CStr, CString};
use std::os::raw::{c_char, c_int, c_uint};
use std::path::Path;

// --- C ABI signatures (reused across same-shaped symbols) -------------------

type InitFn = unsafe extern "C" fn(bool, c_int) -> c_int;
type VoidFn = unsafe extern "C" fn();
type StrFn = unsafe extern "C" fn() -> *const c_char; // GetNextError, GetSpringVersion
type CountFn = unsafe extern "C" fn() -> c_int; // GetMapCount, GetPrimaryModCount
type StrByIntFn = unsafe extern "C" fn(c_int) -> *const c_char; // names, archive lists, info accessors
type UintByIntFn = unsafe extern "C" fn(c_int) -> c_uint; // checksums by index
type IntByIntFn = unsafe extern "C" fn(c_int) -> c_int; // archive/info counts by index
type IntByStrFn = unsafe extern "C" fn(*const c_char) -> c_int; // GetMapArchiveCount(name)
type StrByStrFn = unsafe extern "C" fn(*const c_char) -> *const c_char; // GetArchivePath(name)
type UintByStrFn = unsafe extern "C" fn(*const c_char) -> c_uint; // GetArchiveChecksum(name)
type MinimapFn = unsafe extern "C" fn(*const c_char, c_int) -> *const u16; // GetMinimap(name, mip)
                                                                           // GetInfoMapSize(mapName, infoType, *width, *height) -> nonzero on success.
type InfoMapSizeFn =
    unsafe extern "C" fn(*const c_char, *const c_char, *mut c_int, *mut c_int) -> c_int;
type StrArgVoidFn = unsafe extern "C" fn(*const c_char); // AddAllArchives(name)

/// Copy a library-owned C string into an owned `String`. Null -> `None`.
pub(crate) unsafe fn cstr(p: *const c_char) -> Option<String> {
    if p.is_null() {
        None
    } else {
        Some(CStr::from_ptr(p).to_string_lossy().into_owned())
    }
}

/// A loaded unitsync library plus its resolved entry points. The `Library` is
/// kept alive in `_lib` so the copied function pointers stay valid.
pub struct Unitsync {
    _lib: Library,
    init_fn: InitFn,
    uninit_fn: VoidFn,
    get_next_error_fn: StrFn,
    get_spring_version_fn: Option<StrFn>,
    // maps
    map_count_fn: CountFn,
    map_name_fn: StrByIntFn,
    map_file_name_fn: Option<StrByIntFn>,
    map_checksum_fn: Option<UintByIntFn>,
    map_archive_count_fn: IntByStrFn,
    map_archive_name_fn: StrByIntFn,
    map_info_count_fn: Option<IntByIntFn>,
    minimap_fn: Option<MinimapFn>,
    info_map_size_fn: Option<InfoMapSizeFn>,
    // games (primary mods)
    mod_count_fn: CountFn,
    mod_archive_fn: StrByIntFn,
    mod_checksum_fn: Option<UintByIntFn>,
    mod_archive_count_fn: IntByIntFn,
    mod_archive_list_fn: StrByIntFn,
    mod_info_count_fn: IntByIntFn,
    // info accessors (shared by maps/mods)
    info_key_fn: StrByIntFn,
    info_type_fn: Option<StrByIntFn>,
    info_value_string_fn: StrByIntFn,
    // optional archive metadata
    archive_path_fn: Option<StrByStrFn>,
    archive_checksum_fn: Option<UintByStrFn>,
    // sides / units (require a game's archives to be added first)
    add_all_archives_fn: Option<StrArgVoidFn>,
    remove_all_archives_fn: Option<VoidFn>,
    side_count_fn: Option<CountFn>,
    side_name_fn: Option<StrByIntFn>,
    side_start_unit_fn: Option<StrByIntFn>,
    process_units_fn: Option<CountFn>,
    unit_count_fn: Option<CountFn>,
    unit_name_fn: Option<StrByIntFn>,
    full_unit_name_fn: Option<StrByIntFn>,
}

unsafe fn req<T: Copy>(lib: &Library, name: &[u8]) -> Result<T, String> {
    let sym: Symbol<T> = lib.get(name).map_err(|e| {
        let n = String::from_utf8_lossy(&name[..name.len().saturating_sub(1)]);
        format!("missing required unitsync symbol {n}: {e}")
    })?;
    Ok(*sym)
}

unsafe fn opt<T: Copy>(lib: &Library, name: &[u8]) -> Option<T> {
    lib.get::<T>(name).ok().map(|s| *s)
}

impl Unitsync {
    /// `dlopen` the library at `libpath` and resolve every entry point. Loading
    /// by absolute path lets the dynamic loader resolve the library's own
    /// `@loader_path`/`@rpath`-relative dependencies from the engine dir.
    pub unsafe fn load(libpath: &Path) -> Result<Self, String> {
        let lib = Library::new(libpath)
            .map_err(|e| format!("failed to load {}: {e}", libpath.display()))?;
        let us = Unitsync {
            init_fn: req(&lib, b"Init\0")?,
            uninit_fn: req(&lib, b"UnInit\0")?,
            get_next_error_fn: req(&lib, b"GetNextError\0")?,
            get_spring_version_fn: opt(&lib, b"GetSpringVersion\0"),
            map_count_fn: req(&lib, b"GetMapCount\0")?,
            map_name_fn: req(&lib, b"GetMapName\0")?,
            map_file_name_fn: opt(&lib, b"GetMapFileName\0"),
            map_checksum_fn: opt(&lib, b"GetMapChecksum\0"),
            map_archive_count_fn: req(&lib, b"GetMapArchiveCount\0")?,
            map_archive_name_fn: req(&lib, b"GetMapArchiveName\0")?,
            map_info_count_fn: opt(&lib, b"GetMapInfoCount\0"),
            minimap_fn: opt(&lib, b"GetMinimap\0"),
            info_map_size_fn: opt(&lib, b"GetInfoMapSize\0"),
            mod_count_fn: req(&lib, b"GetPrimaryModCount\0")?,
            mod_archive_fn: req(&lib, b"GetPrimaryModArchive\0")?,
            mod_checksum_fn: opt(&lib, b"GetPrimaryModChecksum\0"),
            mod_archive_count_fn: req(&lib, b"GetPrimaryModArchiveCount\0")?,
            mod_archive_list_fn: req(&lib, b"GetPrimaryModArchiveList\0")?,
            mod_info_count_fn: req(&lib, b"GetPrimaryModInfoCount\0")?,
            info_key_fn: req(&lib, b"GetInfoKey\0")?,
            info_type_fn: opt(&lib, b"GetInfoType\0"),
            info_value_string_fn: req(&lib, b"GetInfoValueString\0")?,
            archive_path_fn: opt(&lib, b"GetArchivePath\0"),
            archive_checksum_fn: opt(&lib, b"GetArchiveChecksum\0"),
            add_all_archives_fn: opt(&lib, b"AddAllArchives\0"),
            remove_all_archives_fn: opt(&lib, b"RemoveAllArchives\0"),
            side_count_fn: opt(&lib, b"GetSideCount\0"),
            side_name_fn: opt(&lib, b"GetSideName\0"),
            side_start_unit_fn: opt(&lib, b"GetSideStartUnit\0"),
            process_units_fn: opt(&lib, b"ProcessUnits\0"),
            unit_count_fn: opt(&lib, b"GetUnitCount\0"),
            unit_name_fn: opt(&lib, b"GetUnitName\0"),
            full_unit_name_fn: opt(&lib, b"GetFullUnitName\0"),
            _lib: lib,
        };
        Ok(us)
    }

    /// `Init(isServer, id)` — returns nonzero on success. Must be called before
    /// any enumeration.
    pub fn init(&self, is_server: bool, id: i32) -> i32 {
        unsafe { (self.init_fn)(is_server, id) }
    }

    pub fn uninit(&self) {
        unsafe { (self.uninit_fn)() }
    }

    /// Drain the asynchronous error queue (call `GetNextError` until it returns
    /// null/empty).
    pub fn drain_errors(&self) -> Vec<String> {
        let mut errs = Vec::new();
        loop {
            match unsafe { cstr((self.get_next_error_fn)()) } {
                Some(s) if !s.is_empty() => errs.push(s),
                _ => break,
            }
        }
        errs
    }

    pub fn spring_version(&self) -> Option<String> {
        let f = self.get_spring_version_fn?;
        unsafe { cstr(f()) }.filter(|s| !s.is_empty())
    }

    // ---- maps --------------------------------------------------------------

    pub fn map_count(&self) -> i32 {
        unsafe { (self.map_count_fn)() }
    }

    pub fn map_name(&self, i: i32) -> Option<String> {
        unsafe { cstr((self.map_name_fn)(i)) }
    }

    pub fn map_file_name(&self, i: i32) -> Option<String> {
        let f = self.map_file_name_fn?;
        unsafe { cstr(f(i)) }.filter(|s| !s.is_empty())
    }

    pub fn map_checksum(&self, i: i32) -> Option<u32> {
        self.map_checksum_fn.map(|f| unsafe { f(i) })
    }

    /// Archives backing a map. `GetMapArchiveCount(name)` populates the internal
    /// list that `GetMapArchiveName(i)` then reads, so this does both in order.
    pub fn map_archives(&self, map_name: &str) -> Vec<String> {
        let Ok(cname) = CString::new(map_name) else {
            return Vec::new();
        };
        let count = unsafe { (self.map_archive_count_fn)(cname.as_ptr()) };
        (0..count)
            .filter_map(|i| unsafe { cstr((self.map_archive_name_fn)(i)) })
            .collect()
    }

    // ---- games (primary mods) ---------------------------------------------

    pub fn mod_count(&self) -> i32 {
        unsafe { (self.mod_count_fn)() }
    }

    /// The game's own archive filename (the *primary* archive).
    pub fn mod_archive(&self, i: i32) -> Option<String> {
        unsafe { cstr((self.mod_archive_fn)(i)) }
    }

    pub fn mod_checksum(&self, i: i32) -> Option<u32> {
        self.mod_checksum_fn.map(|f| unsafe { f(i) })
    }

    /// The full archive list for a game (its primary archive plus every
    /// dependency). `GetPrimaryModArchiveCount(i)` loads the list, then
    /// `GetPrimaryModArchiveList(j)` reads each entry.
    pub fn mod_archives(&self, i: i32) -> Vec<String> {
        let count = unsafe { (self.mod_archive_count_fn)(i) };
        (0..count)
            .filter_map(|j| unsafe { cstr((self.mod_archive_list_fn)(j)) })
            .collect()
    }

    /// Read `count` already-loaded info entries via the shared `GetInfo*`
    /// accessors. Only string-typed entries are read — that covers every field we
    /// display and avoids asserting on typed getters that some builds handle
    /// differently. The caller must have loaded the block first (e.g. via
    /// `GetPrimaryModInfoCount` / `GetMapInfoCount`).
    fn read_info(&self, count: i32) -> BTreeMap<String, String> {
        let mut info = BTreeMap::new();
        for k in 0..count {
            let Some(key) = (unsafe { cstr((self.info_key_fn)(k)) }) else {
                continue;
            };
            let is_string = match self.info_type_fn {
                Some(f) => unsafe { cstr(f(k)) }.map(|t| t == "string").unwrap_or(true),
                None => true,
            };
            if !is_string {
                continue;
            }
            if let Some(v) = unsafe { cstr((self.info_value_string_fn)(k)) } {
                info.insert(key, v);
            }
        }
        info
    }

    /// Key/value metadata for a game (name, shortname, version, description, ...).
    pub fn mod_info(&self, i: i32) -> BTreeMap<String, String> {
        let count = unsafe { (self.mod_info_count_fn)(i) };
        self.read_info(count)
    }

    /// Key/value metadata for a map (description, author, dimensions, ...), when
    /// the engine build exposes `GetMapInfoCount`.
    pub fn map_info(&self, i: i32) -> BTreeMap<String, String> {
        match self.map_info_count_fn {
            Some(f) => self.read_info(unsafe { f(i) }),
            None => BTreeMap::new(),
        }
    }

    /// The map's proportions as `(width, height)`. unitsync's minimap is always a
    /// square texture (the map sampled into 1024x1024), so the real aspect ratio
    /// is needed to display it undistorted. The metal infomap's dimensions are
    /// proportional to the map, so their ratio is the map's aspect ratio.
    pub fn map_dimensions(&self, map_name: &str) -> Option<(u32, u32)> {
        let f = self.info_map_size_fn?;
        let name = CString::new(map_name).ok()?;
        let which = CString::new("metal").ok()?;
        let mut w: c_int = 0;
        let mut h: c_int = 0;
        let ok = unsafe { f(name.as_ptr(), which.as_ptr(), &mut w, &mut h) };
        (ok != 0 && w > 0 && h > 0).then_some((w as u32, h as u32))
    }

    /// The map's minimap as a raw RGB565 buffer (`side x side`, where
    /// `side = 1024 >> mip`). `None` if the build lacks `GetMinimap` or the map
    /// has none. The returned buffer is library-owned and copied out immediately.
    pub fn minimap(&self, map_name: &str, mip: i32) -> Option<Vec<u16>> {
        let f = self.minimap_fn?;
        let c = CString::new(map_name).ok()?;
        let ptr = unsafe { f(c.as_ptr(), mip) };
        if ptr.is_null() {
            return None;
        }
        let side = 1024usize >> mip.clamp(0, 10);
        let len = side * side;
        Some(unsafe { std::slice::from_raw_parts(ptr, len) }.to_vec())
    }

    // ---- optional archive metadata ----------------------------------------

    pub fn archive_path(&self, name: &str) -> Option<String> {
        let f = self.archive_path_fn?;
        let c = CString::new(name).ok()?;
        unsafe { cstr(f(c.as_ptr())) }.filter(|s| !s.is_empty())
    }

    pub fn archive_checksum(&self, name: &str) -> Option<u32> {
        let f = self.archive_checksum_fn?;
        let c = CString::new(name).ok()?;
        Some(unsafe { f(c.as_ptr()) })
    }

    // ---- sides / units (after a game's archives are added) ----------------

    /// Load a game's archive set (its primary archive plus dependencies) into the
    /// VFS so its sides/units become queryable. Returns false if unsupported.
    pub fn add_all_archives(&self, archive: &str) -> bool {
        let (Some(f), Ok(c)) = (self.add_all_archives_fn, CString::new(archive)) else {
            return false;
        };
        unsafe { f(c.as_ptr()) };
        true
    }

    /// Reset the VFS to just the base archives (undo `add_all_archives`).
    pub fn remove_all_archives(&self) {
        if let Some(f) = self.remove_all_archives_fn {
            unsafe { f() }
        }
    }

    pub fn side_count(&self) -> i32 {
        self.side_count_fn.map(|f| unsafe { f() }).unwrap_or(0)
    }

    pub fn side_name(&self, i: i32) -> Option<String> {
        self.side_name_fn
            .and_then(|f| unsafe { cstr(f(i)) })
            .filter(|s| !s.is_empty())
    }

    pub fn side_start_unit(&self, i: i32) -> Option<String> {
        self.side_start_unit_fn
            .and_then(|f| unsafe { cstr(f(i)) })
            .filter(|s| !s.is_empty())
    }

    /// Process unit defs (call until it returns 0) before unit queries.
    pub fn process_units(&self) -> i32 {
        self.process_units_fn.map(|f| unsafe { f() }).unwrap_or(0)
    }

    pub fn unit_count(&self) -> i32 {
        self.unit_count_fn.map(|f| unsafe { f() }).unwrap_or(0)
    }

    pub fn unit_name(&self, i: i32) -> Option<String> {
        self.unit_name_fn.and_then(|f| unsafe { cstr(f(i)) })
    }

    pub fn full_unit_name(&self, i: i32) -> Option<String> {
        self.full_unit_name_fn
            .and_then(|f| unsafe { cstr(f(i)) })
            .filter(|s| !s.is_empty())
    }
}
