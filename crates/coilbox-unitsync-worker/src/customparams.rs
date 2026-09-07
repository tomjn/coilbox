//! `--custom-params` mode: which of a game's own Lua files name each custom
//! parameter (issue #2661).
//!
//! A custom parameter is a key a game puts in a unit or weapon definition that
//! the engine never looks at. Only the game's own Lua gives it meaning, so
//! `customParams.techlevel` means whatever the gadget reading it decides. The
//! meaning therefore lives in the game archive, and the only way to find it is
//! to go and look: mount the game and read its Lua.
//!
//! This is a text search, not an evaluation. The parser sandbox exposes
//! `Spring.Log` and `VFS.DirList` but no `UnitDefs`, so there is nothing to ask
//! at runtime about who reads a key. [`scan_source`] holds what counts as a
//! read and what this knowingly misses.
//!
//! The mount is the same one [`crate::unitdefs`] and the archive Lua console
//! take, and the result is disk-cached on the game's sync checksum for the same
//! reason: rescanning a thousand Lua files on every page load would be as
//! wasteful as re-reading the defs was.

use crate::ffi::Unitsync;
use crate::infocache;
use crate::model::{CustomParamConsumers, CustomParamSite, CustomParamsOutput};
use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::path::Path;

/// VFS modes for the listing: mod archives only. That is exactly the game's own
/// Lua, its primary archive plus any game archive it depends on, and it leaves
/// out `springcontent.sdz` and friends, whose Lua is the engine's base content
/// rather than anything a game wrote.
const MOD_MODE: &str = "M";

/// Biggest Lua file this reads. Generous next to the largest file any of the
/// games on this machine ships, and still a bound on a game that puts something
/// enormous under a `.lua` name.
const MAX_FILE_BYTES: usize = 4 * 1024 * 1024;

/// How many Lua files one scan will read. Beyond All Reason, the largest game
/// here, is well under this. A game past it is reported truncated rather than
/// scanned forever.
const MAX_FILES: usize = 20_000;

/// How deep the directory walk goes. Nothing a game ships is anywhere near, and
/// a tree that were would be a symlink loop the visited set below missed.
const MAX_DEPTH: usize = 12;

/// How many parameters one game's index holds. A cap on the payload rather than
/// a real limit: the games here index tens of keys, not thousands.
const MAX_PARAMS: usize = 5_000;

/// How many files are listed per parameter. A parameter named in one file has
/// an answer. One named in forty does not, and the count says so without
/// carrying forty paths through the IPC.
const MAX_SITES: usize = 25;

/// Load `game_archive` and index which of its Lua files name each custom
/// parameter.
///
/// Disk-cached under `cache_dir` on the game's sync checksum, so a game update
/// invalidates it and a cache hit returns before the archive set is mounted.
pub fn render(lib: &str, game_archive: &str, cache_dir: Option<&Path>) -> CustomParamsOutput {
    let us = match unsafe { Unitsync::load(Path::new(lib)) } {
        Ok(u) => u,
        Err(e) => {
            return CustomParamsOutput {
                errors: vec![e],
                ..Default::default()
            }
        }
    };
    us.init(false, 0);
    let out = resolve(&us, game_archive, cache_dir);
    us.uninit();
    out
}

/// Index a game's custom parameter consumers in a session the caller has
/// already initialised, mounting the game's archive set and unmounting before
/// it returns.
pub(crate) fn resolve(
    us: &Unitsync,
    game_archive: &str,
    cache_dir: Option<&Path>,
) -> CustomParamsOutput {
    let mut errors = us.drain_errors();

    // The checksum is the cache key and comes out of the archive scanner's own
    // cache, which `Init` has already populated, so a hit returns before the
    // mount that dominates this call. Same identity `unitdefs` uses, and for
    // the same reason: a changed dependency changes the answer while the
    // primary archive's size and mtime sit still.
    let checksum = crate::dataset::primary_mod_checksum(us, game_archive);
    let key = checksum
        .as_deref()
        .map(|c| infocache::custom_params_key(game_archive, c));
    let cache = cache_dir.zip(key.as_deref());
    if let Some((dir, key)) = cache {
        if let Some(hit) = infocache::read::<CustomParamsOutput>(dir, key) {
            return hit;
        }
    }

    if !us.add_all_archives(game_archive) {
        errors.push("this engine's libunitsync can't load game archives".into());
        return CustomParamsOutput {
            checksum,
            errors,
            ..Default::default()
        };
    }
    errors.extend(us.drain_errors());

    let (files, truncated) = lua_files(us);
    let mut index = Index::default();
    let mut read = 0u32;
    for path in &files {
        let Some(bytes) = us.read_vfs_file(path, MAX_FILE_BYTES) else {
            continue;
        };
        read += 1;
        index.add(path, &scan_source(&String::from_utf8_lossy(&bytes)));
    }
    errors.extend(us.drain_errors());
    us.remove_all_archives();

    let out = index.finish(read, truncated, checksum, errors);
    if let Some((dir, key)) = cache {
        if worth_caching(&out) {
            infocache::write(dir, key, &out);
        }
    }
    out
}

/// Whether a scan is an answer, and so worth remembering.
///
/// The same test `unitdefs::worth_caching` applies. The key survives every
/// retry and restart, so a scan that read nothing while complaining must stay
/// out of the cache or the failure becomes permanent. A game whose Lua
/// genuinely names no custom parameter complains about nothing while doing it.
fn worth_caching(out: &CustomParamsOutput) -> bool {
    out.checksum.is_some() && !(out.files_scanned == 0 && !out.errors.is_empty())
}

/// Print a custom-params error envelope to stdout (used on the panic path in
/// main).
pub fn emit_error(msg: String) {
    let out = CustomParamsOutput {
        errors: vec![msg],
        ..Default::default()
    };
    println!("{}", serde_json::to_string(&out).unwrap_or_default());
}

/// Every `.lua` file in the game's own archives, and whether the walk stopped
/// early.
///
/// unitsync's `InitDirListVFS` is hardcoded non-recursive (it calls
/// `CFileHandler::DirList` with `recursive = false`), so the tree is walked a
/// directory at a time through `InitSubDirsVFS`. Both are restricted to
/// [`MOD_MODE`], so a game's dependency archives are included and the engine's
/// base content is not.
fn lua_files(us: &Unitsync) -> (Vec<String>, bool) {
    let mut out = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    let mut queue: Vec<(String, usize)> = vec![(String::new(), 0)];
    let mut truncated = false;
    while let Some((dir, depth)) = queue.pop() {
        if !seen.insert(dir.clone()) {
            continue;
        }
        for file in us.list_vfs_dir(&dir, "*.lua", MOD_MODE) {
            if out.len() >= MAX_FILES {
                return (out, true);
            }
            out.push(file);
        }
        if depth < MAX_DEPTH {
            for sub in us.list_vfs_subdirs(&dir, "*", MOD_MODE) {
                queue.push((sub, depth + 1));
            }
        } else {
            truncated = true;
        }
    }
    (out, truncated)
}

/// What one file says about custom parameters.
#[derive(Debug, Default, PartialEq)]
pub(crate) struct FileHits {
    /// Parameter name (lowercased) to how many times the file reads it and how
    /// many times it assigns to it.
    pub named: BTreeMap<String, (u32, u32)>,
    /// Whether the file names `customParams` without naming a key: passing the
    /// whole table somewhere, or building it. A file that only does this reads
    /// parameters this cannot attribute.
    pub whole_table: bool,
}

/// What counts as a read of a custom parameter, and what this knowingly misses.
///
/// Found:
///
///  - `ud.customParams.techlevel`, in any casing, on anything at all. The
///    engine lowercases both the def key and the `customParams` keys it hands
///    Lua, so the index is keyed lowercase and a game that writes
///    `customParams.techLevel` in its gadget still joins to the `techlevel` the
///    def carries.
///  - `ud.customParams["techlevel"]` and the single-quoted form.
///  - `cp.techlevel` after `local cp = ud.customParams` in the same file, the
///    single most common shape in a real gadget. The alias has to be a `local`
///    whose right-hand side names `customParams` without a key, which covers
///    the usual `local cp = UnitDefs[id].customParams or {}`.
///  - assignments as well as reads, counted separately. A game's own def
///    post-processing writes parameters onto units, and the file that sets a
///    parameter answers "what is this?" as well as one that acts on it.
///
/// Missed, deliberately:
///
///  - a parameter reached through a function argument, `function f(cp)
///    ... cp.techlevel`. Following it needs a Lua parser and a call graph.
///  - a key built at runtime, `customParams[prefix .. name]`.
///  - an alias assigned to a global, or reassigned partway down a file. The
///    first is rare and the second would need scoping.
///  - the whole table passed somewhere, `SomeFunc(ud.customParams)`. Nothing
///    names a key there, so it is counted as [`FileHits::whole_table`] instead.
///    The honest answer for a parameter with no named consumer is "no file
///    names this, and N files read the table whole", not "nothing reads this".
///
/// The trade is towards missing a file rather than naming a wrong one, with the
/// alias pass as the one deliberate exception. Comments are stripped first, so
/// commented-out code does not count. String bodies are not stripped, so a key
/// that only ever appears inside a message is a false positive this accepts.
pub(crate) fn scan_source(src: &str) -> FileHits {
    let code = strip_comments(src);
    let mut hits = FileHits::default();
    accesses(&code, "customparams", true, &mut hits);
    for alias in aliases(&code) {
        accesses(&code, &alias, false, &mut hits);
    }
    hits
}

/// The `local` names a file binds to a whole `customParams` table, lowercased.
///
/// One line at a time, because that is the shape every real one takes and a
/// statement-aware version would need a parser. `customparams` itself is left
/// out: [`accesses`] has already counted everything reached through a variable
/// of that name.
fn aliases(code: &str) -> Vec<String> {
    let mut out = BTreeSet::new();
    for line in code.lines() {
        let Some(rest) = line.trim_start().strip_prefix("local") else {
            continue;
        };
        if !rest.starts_with(|c: char| c.is_whitespace()) {
            continue;
        }
        let rest = rest.trim_start();
        let end = rest
            .find(|c: char| !(c.is_ascii_alphanumeric() || c == '_'))
            .unwrap_or(rest.len());
        let (name, rest) = rest.split_at(end);
        if name.is_empty() || name.starts_with(|c: char| c.is_ascii_digit()) {
            continue;
        }
        let Some(rhs) = rest.trim_start().strip_prefix('=') else {
            continue;
        };
        // The alias only counts if the right-hand side names the whole table.
        // `local x = ud.customParams.foo` binds one parameter, not the table.
        let mut probe = FileHits::default();
        accesses(rhs, "customparams", true, &mut probe);
        let lower = name.to_ascii_lowercase();
        if probe.whole_table && lower != "customparams" {
            out.insert(lower);
        }
    }
    out.into_iter().collect()
}

/// Record every access to `ident` (already lowercased) in `code`.
///
/// `bare_counts` says whether an occurrence that names no key is worth
/// recording as [`FileHits::whole_table`]. It is for `customParams` itself and
/// is not for an alias, where the binding line is such an occurrence and would
/// mark every file that has an alias.
fn accesses(code: &str, ident: &str, bare_counts: bool, hits: &mut FileHits) {
    let bytes = code.as_bytes();
    let mut i = 0usize;
    while i + ident.len() <= bytes.len() {
        let Some(found) = find_ident(bytes, ident, i) else {
            break;
        };
        i = found + ident.len();
        // An alias is a variable, so `something.cp` is a field of something
        // else, not the alias. `customParams` is itself always a field, so it
        // is exempt.
        if !bare_counts && found > 0 && matches!(bytes[found - 1], b'.' | b':') {
            continue;
        }
        let mut j = skip_space(bytes, i);
        let key = if bytes.get(j) == Some(&b'.') {
            let start = skip_space(bytes, j + 1);
            let end = ident_end(bytes, start);
            (end > start).then(|| {
                j = end;
                code[start..end].to_ascii_lowercase()
            })
        } else if bytes.get(j) == Some(&b'[') {
            bracket_key(code, j).map(|(k, end)| {
                j = end;
                k
            })
        } else {
            None
        };
        match key {
            Some(k) if !k.is_empty() => {
                let entry = hits.named.entry(k).or_insert((0, 0));
                if is_assignment(bytes, j) {
                    entry.1 += 1;
                } else {
                    entry.0 += 1;
                }
            }
            // No key named. That is a read of the whole table, unless the table
            // is what is being assigned to: `customParams = { techlevel = 1 }`
            // in a unit file is the game declaring its parameters, not reading
            // them, and counting those made the count of files that read the
            // table whole nearly half of Beyond All Reason's Lua.
            _ => {
                if bare_counts && !is_assignment(bytes, j) {
                    hits.whole_table = true;
                }
            }
        }
    }
}

/// The next occurrence of `ident` at or after `from` that is a whole
/// identifier, compared without case. `None` once there are none left.
fn find_ident(bytes: &[u8], ident: &str, from: usize) -> Option<usize> {
    let n = ident.len();
    let mut i = from;
    while i + n <= bytes.len() {
        if bytes[i..i + n].eq_ignore_ascii_case(ident.as_bytes())
            && !(i > 0 && is_ident_byte(bytes[i - 1]))
            && !bytes.get(i + n).is_some_and(|&b| is_ident_byte(b))
        {
            return Some(i);
        }
        i += 1;
    }
    None
}

/// The key in a `["name"]` index at `open`, plus the offset just past the
/// closing bracket. `None` for anything else, including a key built at runtime.
fn bracket_key(code: &str, open: usize) -> Option<(String, usize)> {
    let bytes = code.as_bytes();
    let start = skip_space(bytes, open + 1);
    let quote = *bytes.get(start)?;
    if quote != b'"' && quote != b'\'' {
        return None;
    }
    let mut i = start + 1;
    while i < bytes.len() {
        match bytes[i] {
            b'\\' => i += 2,
            b'\n' => return None,
            b if b == quote => break,
            _ => i += 1,
        }
    }
    if bytes.get(i) != Some(&quote) {
        return None;
    }
    let key = code.get(start + 1..i)?.to_ascii_lowercase();
    let close = skip_space(bytes, i + 1);
    (bytes.get(close) == Some(&b']')).then_some((key, close + 1))
}

/// Whether the access ending at `from` is being assigned to. A single `=`, so
/// `==` and the comparison operators that end in `=` stay reads.
fn is_assignment(bytes: &[u8], from: usize) -> bool {
    let at = skip_space(bytes, from);
    bytes.get(at) == Some(&b'=') && bytes.get(at + 1) != Some(&b'=')
}

fn is_ident_byte(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_'
}

fn ident_end(bytes: &[u8], from: usize) -> usize {
    let mut i = from;
    while i < bytes.len() && is_ident_byte(bytes[i]) {
        i += 1;
    }
    i
}

fn skip_space(bytes: &[u8], from: usize) -> usize {
    let mut i = from;
    while i < bytes.len() && (bytes[i] == b' ' || bytes[i] == b'\t') {
        i += 1;
    }
    i
}

/// Blank every comment in `src`, leaving its bytes as spaces so offsets and
/// line breaks are unchanged.
///
/// Strings are tracked so a `--` inside one does not blank the rest of the
/// line, which is otherwise the common way a naive strip loses real code. Their
/// contents are left alone: a key that appears in a message is a false positive
/// this accepts, and blanking string bodies would throw away
/// `customParams["techlevel"]`, which is the point.
fn strip_comments(src: &str) -> String {
    let mut out = src.as_bytes().to_vec();
    let bytes = src.as_bytes();
    let mut i = 0usize;
    while i < bytes.len() {
        match bytes[i] {
            b'-' if bytes.get(i + 1) == Some(&b'-') => {
                let end = match long_bracket(bytes, i + 2) {
                    Some(level) => long_string_end(bytes, i + 2, level),
                    None => bytes[i..]
                        .iter()
                        .position(|&b| b == b'\n')
                        .map(|p| i + p)
                        .unwrap_or(bytes.len()),
                };
                for b in &mut out[i..end] {
                    if *b != b'\n' {
                        *b = b' ';
                    }
                }
                i = end;
            }
            b'"' | b'\'' => i = quoted_end(bytes, i),
            b'[' => match long_bracket(bytes, i) {
                Some(level) => i = long_string_end(bytes, i, level),
                None => i += 1,
            },
            _ => i += 1,
        }
    }
    // Only ASCII bytes were replaced, and only with a space, so whatever was
    // valid UTF-8 still is.
    String::from_utf8(out).unwrap_or_else(|_| src.to_string())
}

/// The `=` count of a long bracket opening at `at` (`[[` is 0, `[==[` is 2), or
/// `None` if that is not a long bracket.
fn long_bracket(bytes: &[u8], at: usize) -> Option<usize> {
    if bytes.get(at) != Some(&b'[') {
        return None;
    }
    let mut i = at + 1;
    while bytes.get(i) == Some(&b'=') {
        i += 1;
    }
    (bytes.get(i) == Some(&b'[')).then_some(i - at - 1)
}

/// The offset just past the long string or long comment opening at `at`.
fn long_string_end(bytes: &[u8], at: usize, level: usize) -> usize {
    let mut close = Vec::with_capacity(level + 2);
    close.push(b']');
    close.extend(std::iter::repeat_n(b'=', level));
    close.push(b']');
    let mut i = at + level + 2;
    while i + close.len() <= bytes.len() {
        if bytes[i..i + close.len()] == close[..] {
            return i + close.len();
        }
        i += 1;
    }
    bytes.len()
}

/// The offset just past the quoted string starting at `at`, honouring backslash
/// escapes. An unterminated string ends at the newline, which is what Lua does
/// with one too.
fn quoted_end(bytes: &[u8], at: usize) -> usize {
    let quote = bytes[at];
    let mut i = at + 1;
    while i < bytes.len() {
        match bytes[i] {
            b'\\' => i += 2,
            b'\n' => return i,
            b if b == quote => return i + 1,
            _ => i += 1,
        }
    }
    bytes.len()
}

/// The index being built, before it is capped and sorted for the payload.
#[derive(Default)]
struct Index {
    params: BTreeMap<String, Vec<CustomParamSite>>,
    whole_table_files: u32,
}

impl Index {
    fn add(&mut self, path: &str, hits: &FileHits) {
        if hits.whole_table {
            self.whole_table_files += 1;
        }
        for (key, &(reads, writes)) in &hits.named {
            if self.params.len() >= MAX_PARAMS && !self.params.contains_key(key) {
                continue;
            }
            self.params
                .entry(key.clone())
                .or_default()
                .push(CustomParamSite {
                    file: path.replace('\\', "/"),
                    reads,
                    writes,
                });
        }
    }

    fn finish(
        self,
        files_scanned: u32,
        truncated: bool,
        checksum: Option<String>,
        errors: Vec<String>,
    ) -> CustomParamsOutput {
        let params = self
            .params
            .into_iter()
            .map(|(key, mut sites)| {
                // Most-used first, so a capped list keeps the files most likely
                // to be the answer. Ties break on path so the order is stable
                // between runs and the cached blob does not churn.
                sites.sort_by(|a, b| {
                    (b.reads + b.writes)
                        .cmp(&(a.reads + a.writes))
                        .then_with(|| a.file.cmp(&b.file))
                });
                let files = sites.len() as u32;
                sites.truncate(MAX_SITES);
                (key, CustomParamConsumers { sites, files })
            })
            .collect();
        CustomParamsOutput {
            params,
            whole_table_files: self.whole_table_files,
            files_scanned,
            truncated,
            checksum,
            errors,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn named(src: &str) -> Vec<(String, (u32, u32))> {
        scan_source(src).named.into_iter().collect::<Vec<_>>()
    }

    #[test]
    fn a_dotted_read_names_the_parameter() {
        assert_eq!(
            named("if ud.customParams.techlevel then end"),
            vec![("techlevel".to_string(), (1, 0))]
        );
    }

    #[test]
    fn a_bracket_read_names_the_parameter() {
        assert_eq!(
            named("local x = ud.customParams[\"techlevel\"]"),
            vec![("techlevel".to_string(), (1, 0))]
        );
        assert_eq!(
            named("local x = ud.customParams['techlevel']"),
            vec![("techlevel".to_string(), (1, 0))]
        );
    }

    /// The engine lowercases both the def key and the `customParams` keys it
    /// hands Lua, so a gadget written in camel case still has to join to the
    /// lowercase key the def carries.
    #[test]
    fn casing_never_splits_one_parameter_in_two() {
        assert_eq!(
            named("ud.CustomParams.TechLevel = 2\nud.customparams.techlevel"),
            vec![("techlevel".to_string(), (1, 1))]
        );
    }

    #[test]
    fn an_assignment_is_counted_apart_from_a_read() {
        assert_eq!(
            named("ud.customParams.techlevel = 2"),
            vec![("techlevel".to_string(), (0, 1))]
        );
    }

    /// `==` is a read. Getting this wrong would report every comparison in a
    /// gadget as the file that sets the value.
    #[test]
    fn a_comparison_stays_a_read() {
        assert_eq!(
            named("if ud.customParams.iscommander == '1' then end"),
            vec![("iscommander".to_string(), (1, 0))]
        );
    }

    /// The single most common shape in a real gadget, and the one a scan that
    /// only handled direct access would silently miss.
    #[test]
    fn a_local_alias_carries_the_reads_after_it() {
        let src = "local cp = UnitDefs[id].customParams or {}\nif cp.techlevel then end\n";
        assert_eq!(named(src), vec![("techlevel".to_string(), (1, 0))]);
    }

    /// `local x = ud.customParams.foo` binds one parameter, not the table, so
    /// `x` must not become an alias and drag every `x.anything` in with it.
    #[test]
    fn a_local_bound_to_one_parameter_is_not_an_alias() {
        let src = "local tl = ud.customParams.techlevel\nif tl.other then end\n";
        assert_eq!(named(src), vec![("techlevel".to_string(), (1, 0))]);
    }

    /// An alias is a variable, so a field of the same name on something else is
    /// a different thing.
    #[test]
    fn a_field_that_shares_an_alias_name_is_not_the_alias() {
        let src = "local cp = ud.customParams\nlocal a = other.cp.techlevel\n";
        assert!(scan_source(src).named.is_empty());
    }

    #[test]
    fn a_commented_out_read_does_not_count() {
        let src = "-- paralyzeMultipliers[id] = ud.customParams.paralyzemultiplier or 1\n\
                   x = ud.customParams.paralyzemultiplier\n";
        assert_eq!(named(src), vec![("paralyzemultiplier".to_string(), (1, 0))]);
    }

    #[test]
    fn a_block_comment_does_not_count() {
        let src = "--[==[ ud.customParams.old ]==] y = ud.customParams.new\n";
        assert_eq!(named(src), vec![("new".to_string(), (1, 0))]);
    }

    /// A `--` inside a string is not a comment. Blanking from it would throw
    /// away the rest of the line, including a real read.
    #[test]
    fn a_dash_inside_a_string_does_not_start_a_comment() {
        let src = "Spring.Echo('a -- b') if ud.customParams.techlevel then end\n";
        assert_eq!(named(src), vec![("techlevel".to_string(), (1, 0))]);
    }

    #[test]
    fn a_long_string_hides_a_comment_marker() {
        let src = "local s = [[ -- ]] local v = ud.customParams.techlevel\n";
        assert_eq!(named(src), vec![("techlevel".to_string(), (1, 0))]);
    }

    /// A parameter declared in a unit file is not a consumer of itself, and
    /// nor is the file reading the table whole. The table literal names no key
    /// off `customParams`, so nothing lands in the index, which is what keeps
    /// 379 unit files out of Balanced Annihilation's answer.
    #[test]
    fn a_unit_file_declaring_the_table_is_not_a_consumer_at_all() {
        let src = "return { armcom = { customParams = { techlevel = 1 } } }";
        let hits = scan_source(src);
        assert!(hits.named.is_empty());
        assert!(!hits.whole_table);
    }

    /// The right-hand side is a read of the table even though the left-hand
    /// side is not, which is the shape a game's own def post-processing uses
    /// before it writes a parameter on.
    #[test]
    fn defaulting_the_table_reads_it_once() {
        let hits = scan_source("ud.customParams = ud.customParams or {}");
        assert!(hits.whole_table);
    }

    /// The honest answer for a parameter nothing names: the table went
    /// somewhere this cannot follow.
    #[test]
    fn the_whole_table_passed_on_is_recorded_without_a_key() {
        let hits = scan_source("Apply(ud.customParams)");
        assert!(hits.named.is_empty());
        assert!(hits.whole_table);
    }

    /// A key built at runtime cannot be attributed, and guessing at one would
    /// be worse than saying nothing.
    #[test]
    fn a_computed_key_is_not_guessed_at() {
        let hits = scan_source("local v = ud.customParams[prefix .. name]");
        assert!(hits.named.is_empty());
        assert!(hits.whole_table);
    }

    #[test]
    fn a_weapon_def_read_lands_in_the_same_index() {
        assert_eq!(
            named("local v = WeaponDefs[i].customParams.lups_explodespeed"),
            vec![("lups_explodespeed".to_string(), (1, 0))]
        );
    }

    #[test]
    fn the_most_used_file_is_listed_first_and_the_rest_are_counted() {
        let mut index = Index::default();
        for (path, reads) in [("a.lua", 1u32), ("b.lua", 9), ("c.lua", 4)] {
            let mut hits = FileHits::default();
            hits.named.insert("techlevel".into(), (reads, 0));
            index.add(path, &hits);
        }
        let out = index.finish(3, false, Some("deadbeef".into()), Vec::new());
        let consumers = &out.params["techlevel"];
        assert_eq!(consumers.files, 3);
        assert_eq!(
            consumers
                .sites
                .iter()
                .map(|s| s.file.as_str())
                .collect::<Vec<_>>(),
            vec!["b.lua", "c.lua", "a.lua"]
        );
    }

    #[test]
    fn a_scan_that_read_nothing_while_complaining_is_not_cached() {
        let failed = CustomParamsOutput {
            checksum: Some("deadbeef".into()),
            errors: vec!["this engine's libunitsync can't load game archives".into()],
            ..Default::default()
        };
        assert!(!worth_caching(&failed));
    }

    #[test]
    fn a_game_whose_lua_names_nothing_is_still_cached() {
        let quiet = CustomParamsOutput {
            checksum: Some("deadbeef".into()),
            files_scanned: 12,
            ..Default::default()
        };
        assert!(worth_caching(&quiet));
    }

    #[test]
    fn a_scan_with_no_checksum_is_not_cached() {
        let unsyncable = CustomParamsOutput {
            files_scanned: 12,
            ..Default::default()
        };
        assert!(!worth_caching(&unsyncable));
    }
}
