//! Packing compiled chunks across a game's numbered tweak slots, for a
//! player who does not control the host's own lobby (issue #1277).
//!
//! `tweakdefs`/`tweakunits` mod options predate Beyond All Reason: any game
//! whose `modoptions.lua` declares the same bare-plus-numbered keys can take
//! a project this way. BAR is the game this module's own research was done
//! against, so the BAR-specific facts below (its decoder's quirks, the tools
//! its players use) are named as BAR's rather than generalised past what is
//! actually known about other games.
//!
//! A mutator archive cannot be loaded into somebody else's lobby. The only
//! route open to a player who is not hosting is asking the server to set a
//! `tweakdefs`/`tweakunits` mod option through the `!bset` chat command a
//! SPADS-based autohost answers to, which is why every line this module
//! produces carries the `!bset <slot> ` prefix rather than the bare base64:
//! the length that matters is the whole chat line the lobby server reads,
//! not only the payload inside it.
//!
//! The cap, and why it is not the more obvious 16,384 or 16,385: this is a
//! lobby-server limit, not a game one. teiserver's `spring_in.ex` slices a
//! `!bset tweakdefs`/`!bset tweakunits` `SAYBATTLE` line to 16,385 characters
//! (`String.slice(0..16_384)`, an inclusive Elixir range) before silently
//! truncating whatever is left, with no error sent back, and uberserver
//! enforces its own ceiling on the same kind of line by refusing it outright
//! rather than truncating it (10,000 characters). Coilbox caps the base64
//! *payload* at 16,000 rather than pushing to teiserver's ceiling: Tom's
//! decision on issue #1277, matching NuttyB's own configurator
//! (`MAX_ENCODED_SIZE`, uncited but already familiar to the tooling BAR
//! players use) over the 10,000 that issue's own research recommended,
//! because he is getting uberserver's smaller refusal raised separately.
//! 16,000 leaves 385 characters of headroom under teiserver's real limit
//! once the longest prefix (`!bset tweakunits29 `, 19 characters) is added.
//! Every fit check below still measures the whole line rather than trusting
//! that headroom, because BAR's own EditP tool shows what happens when a cap
//! is checked against the payload alone. It compares only the base64 against
//! its threshold, so it can hand the lobby server a line it then truncates
//! without telling anyone (see issue #1277's own research comments).
//! Surfacing uberserver's refusal is issue #1279's, not this module's to
//! avoid by shrinking the cap.
//!
//! The two chunk forms `compile.rs` produces go to different slot kinds. A
//! table (`tweakunits`) cannot be joined onto another the way two `do ... end`
//! blocks can be concatenated into one Lua chunk, so every table-form chunk
//! gets a slot of its own. A block (`tweakdefs`) is a self-contained
//! statement, so as many as fit are joined into one slot before the next slot
//! is started, in the order `compile.rs` already produced them. That order is
//! already the order they have to run in (see `CompiledMod`'s own doc
//! comment: a copy standing in for a game unit before a menu is replayed over
//! it, a unit switched off last), which is what the issue's "sort by priority
//! order" step is doing for a NuttyB project assembled from many
//! independently selectable sections with their own dependency graph.
//! Coilbox's compiler never offers that choice. It always produces one
//! linear, already dependency-correct chunk list, so there is nothing left to
//! sort here.
//!
//! Minifying happens here, not in `compile.rs`: the mutator archive and the
//! local tweak-slot route (`localTweakSlot.ts`) both want to show or ship Lua
//! a person can read, and only the numbered-slot export is squeezed for
//! size. Comments are dropped and whitespace is collapsed to single spaces,
//! tracking whether a `"` has opened a string so a modder's own text (which
//! can legally contain `--`) is never mistaken for a comment. Nothing here
//! generates a single-quoted or long-bracket Lua string (`lua.rs`'s
//! `lua_string` always double-quotes), so neither is tracked.
//!
//! Encoding is unpadded base64 both ways, and the alphabet differs by slot
//! kind because BAR reads the two kinds differently (issue #2963).
//! `tweakdefs` goes straight to BAR's decoder and carries the URL-safe
//! alphabet `localTweakSlot.ts` already uses for the local single-slot
//! route.
//! `tweakunits` goes through one step more, `CustomKeyToUsefulTable`, which
//! rewrites every `_` to `=` before decoding and so destroys the URL-safe
//! spelling of 63. That slot carries the standard alphabet instead, which
//! passes through untouched and which BAR's decoder reads just as happily:
//! its table holds `['+'] = 62, ['/'] = 63` beside the URL-safe pair.
//! Neither is padded, because that decoder walks its input four characters
//! at a time and a short final group simply yields fewer bytes.

use crate::compile::{Chunk, LuaForm};
use base64::{
    engine::general_purpose::{STANDARD_NO_PAD, URL_SAFE_NO_PAD},
    Engine as _,
};
use serde::Serialize;

/// The base64 payload cap, per slot. Tom's decision on issue #1277.
pub const PAYLOAD_CAP: usize = 16_000;

/// The whole `!bset tweak<defs|units><n> <payload>` line, past which
/// teiserver's own slice starts silently dropping characters. `PAYLOAD_CAP`
/// already leaves headroom under this on its own. This is the check that
/// keeps proving it rather than assuming it, per this module's doc comment.
pub const LINE_CAP: usize = 16_385;

/// One slot key past the last one a game's `modoptions.lua` declares: the bare
/// option plus numbered `1` through `29` (`deliveryRoutes.ts`'s own doc
/// comment, read off BAR's mod option generator), so 30 valid indices in
/// total. 0 for the bare slot and 1..=29 for the numbered ones.
const MAX_SLOTS: usize = 30;

/// What packing a project's chunks across the game's slots produced.
#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TweakSlotPack {
    /// One `!bset tweakdefs...` line per filled slot, in the order they have
    /// to run.
    pub tweakdefs: Vec<String>,
    /// One `!bset tweakunits...` line per filled slot. Always one chunk each,
    /// since a plain table cannot be joined onto another (see this module's
    /// doc comment).
    pub tweakunits: Vec<String>,
    /// A chunk whose own line would exceed the cap even alone in an empty
    /// slot. No packing decision could have placed it, and splitting it
    /// would break the Lua it carries.
    pub oversized: Vec<String>,
    /// A chunk that would have fit a slot on its own, but every slot the
    /// game exposes was already spoken for by chunks compiled ahead of it.
    pub unplaced: Vec<String>,
}

impl TweakSlotPack {
    /// Whether every chunk handed to [`pack`] reached a slot. `false` is
    /// exactly the case issue #1277 asks to be said before the export rather
    /// than after.
    pub fn complete(&self) -> bool {
        self.oversized.is_empty() && self.unplaced.is_empty()
    }
}

/// Strip comments and collapse whitespace to single spaces, without touching
/// a string literal's own bytes. A run of removed whitespace or comment
/// becomes exactly one space rather than nothing: two tokens that were
/// separated in the source must stay separated, or `end` and `if` written on
/// their own lines could merge into one identifier.
///
/// All three of Lua's string forms are tracked, not just `"`. Coilbox's own
/// `lua.rs` only ever writes double-quoted strings, but a project can now
/// carry Lua somebody else wrote (`ReadOnlyLuaBlock`), and the tools BAR
/// players use quote with `'` throughout. Missing that would let a `--`
/// inside a single-quoted string read as the start of a comment and swallow
/// the rest of the line, turning working Lua into a syntax error in the
/// exported slot, where nothing would notice until a game failed to start.
pub fn minify_lua(source: &str) -> String {
    /// Which string literal the scanner is inside, if any.
    enum Quote {
        /// `"` or `'`, ended by the same character, honouring `\` escapes.
        Short(char),
        /// `[[ ... ]]`, or `[=[ ... ]=]`, ended by a closing bracket with
        /// the same number of `=` signs. No escapes inside one.
        Long(usize),
    }

    let chars: Vec<char> = source.chars().collect();
    let mut out = String::with_capacity(source.len());
    let mut in_string: Option<Quote> = None;
    let mut pending_space = false;
    let mut i = 0;

    macro_rules! mark_space {
        () => {
            if !out.is_empty() {
                pending_space = true;
            }
        };
    }
    macro_rules! flush_space {
        () => {
            if pending_space {
                out.push(' ');
                pending_space = false;
            }
        };
    }

    while i < chars.len() {
        let c = chars[i];
        match in_string {
            Some(Quote::Short(quote)) => {
                out.push(c);
                i += 1;
                if c == '\\' {
                    if let Some(escaped) = chars.get(i) {
                        out.push(*escaped);
                        i += 1;
                    }
                } else if c == quote {
                    in_string = None;
                }
                continue;
            }
            Some(Quote::Long(level)) => {
                if let Some(end) = long_bracket_close(&chars, i, level) {
                    out.extend(&chars[i..end]);
                    i = end;
                    in_string = None;
                } else {
                    out.push(c);
                    i += 1;
                }
                continue;
            }
            None => {}
        }
        if c == '"' || c == '\'' {
            flush_space!();
            in_string = Some(Quote::Short(c));
            out.push(c);
            i += 1;
            continue;
        }
        if c == '-' && chars.get(i + 1) == Some(&'-') {
            // A long comment runs to its matching bracket, across as many
            // lines as it likes. A plain one ends at the first newline.
            if let Some(level) = long_bracket_level(&chars, i + 2) {
                let body = i + 2 + level + 2;
                i = long_bracket_close(&chars, body, level).unwrap_or(chars.len());
            } else {
                i += 2;
                while i < chars.len() && chars[i] != '\n' {
                    i += 1;
                }
            }
            mark_space!();
            continue;
        }
        if let Some(level) = long_bracket_level(&chars, i) {
            flush_space!();
            let body = i + level + 2;
            out.extend(&chars[i..body.min(chars.len())]);
            i = body;
            in_string = Some(Quote::Long(level));
            continue;
        }
        if c.is_whitespace() {
            mark_space!();
            i += 1;
            continue;
        }
        flush_space!();
        out.push(c);
        i += 1;
    }
    out
}

/// The level of a long bracket opening at `start`, counting the `=` signs
/// between its two `[`. `Some(0)` for `[[`, `Some(2)` for `[==[`, and `None`
/// when this is an ordinary `[`, which is how an index is told from a string.
fn long_bracket_level(chars: &[char], start: usize) -> Option<usize> {
    if chars.get(start) != Some(&'[') {
        return None;
    }
    let mut level = 0;
    while chars.get(start + 1 + level) == Some(&'=') {
        level += 1;
    }
    (chars.get(start + 1 + level) == Some(&'[')).then_some(level)
}

/// Where the long bracket opened at `level` closes, as the index one past its
/// final `]`. `None` when it never does, which is a source that would not
/// compile either.
fn long_bracket_close(chars: &[char], from: usize, level: usize) -> Option<usize> {
    let mut i = from;
    while i < chars.len() {
        if chars[i] == ']'
            && (0..level).all(|n| chars.get(i + 1 + n) == Some(&'='))
            && chars.get(i + 1 + level) == Some(&']')
        {
            return Some(i + level + 2);
        }
        i += 1;
    }
    None
}

/// The URL-safe, unpadded base64 a `tweakdefs` slot carries. BAR hands that
/// slot straight to its own decoder, which reads this alphabet.
pub(crate) fn encode(text: &str) -> String {
    URL_SAFE_NO_PAD.encode(text.as_bytes())
}

/// The same bytes for a `tweakunits` slot, which BAR reads through one step
/// more and that step destroys the URL-safe alphabet (issue #2963).
///
/// `CustomKeyToUsefulTable` runs `string.gsub(dataRaw, "_", "=")` before it
/// decodes, so every `_` becomes padding, which its table maps to nil, and
/// the byte is dropped. The line still packs, still encodes and still
/// decodes here. It fails only when a game loads it, and the only trace is a
/// line in the infolog.
///
/// The standard alphabet goes through that `gsub` untouched, because it
/// spells 62 and 63 as `+` and `/`. BAR's decoder reads both alphabets, with
/// `['+'] = 62, ['/'] = 63` beside the URL-safe pair, so the bytes arrive as
/// written. Padding stays off: the decoder walks the input four characters
/// at a time and a short final group simply yields fewer bytes, which is why
/// the unpadded form this project already sends has always worked.
///
/// `_` only encodes to 63 on the third byte of a group, so plain English
/// rarely produces one and this went unnoticed. Any text outside ASCII makes
/// it likely, since UTF-8 sets the high bits of every byte it uses.
fn encode_tweakunits(text: &str) -> String {
    STANDARD_NO_PAD.encode(text.as_bytes())
}

/// The payload for a chunk, in whichever alphabet its own slot kind needs.
/// Shared with `preflight.rs` so the round trip it checks is the encoding
/// that actually ships, rather than a second opinion about it.
pub(crate) fn encode_for(form: LuaForm, text: &str) -> String {
    match form {
        LuaForm::Table => encode_tweakunits(text),
        LuaForm::Block => encode(text),
    }
}

/// The other half of [`encode_for`], for a caller checking the round trip.
pub(crate) fn decode_for(form: LuaForm, payload: &str) -> Result<Vec<u8>, base64::DecodeError> {
    match form {
        LuaForm::Table => STANDARD_NO_PAD.decode(payload),
        LuaForm::Block => URL_SAFE_NO_PAD.decode(payload),
    }
}

/// The `!bset` prefix for one slot: bare for index 0, numbered from 1.
fn bset_prefix(kind: &str, slot_index: usize) -> String {
    if slot_index == 0 {
        format!("!bset {kind} ")
    } else {
        format!("!bset {kind}{slot_index} ")
    }
}

/// Whether a payload alone stays under the cap this project ships with. Its
/// own function so the boundary can be tested against a plain integer rather
/// than a base64 string engineered to land on it exactly.
fn fits_payload(payload_len: usize) -> bool {
    payload_len <= PAYLOAD_CAP
}

/// Whether a whole `!bset` line, prefix and payload together, stays under
/// teiserver's silent-truncation point. This is the check EditP's own bug
/// skips (see this module's doc comment). Kept as its own function so it can
/// be proven at the boundary independently of `PAYLOAD_CAP`'s current value.
fn fits_line(prefix_len: usize, payload_len: usize) -> bool {
    prefix_len + payload_len <= LINE_CAP
}

/// The mod options a lobby ends up holding once every line in `pack` has
/// been said, slot key to payload (issue #3092).
pub(crate) fn mod_options(pack: &TweakSlotPack) -> std::collections::BTreeMap<String, String> {
    pack.tweakdefs
        .iter()
        .chain(&pack.tweakunits)
        .filter_map(|line| line.strip_prefix("!bset ")?.split_once(' '))
        .map(|(key, payload)| (key.to_string(), payload.to_string()))
        .collect()
}

/// Pack every chunk `compile::compile` produced across the game's numbered slots.
pub fn pack(chunks: &[Chunk]) -> TweakSlotPack {
    let mut result = TweakSlotPack::default();
    pack_tables(chunks, &mut result);
    pack_blocks(chunks, &mut result);
    result
}

/// A table-form chunk gets a slot of its own. A `tweakunits` slot carries a
/// plain table, and two of those cannot be joined into one without a rule
/// for merging their keys that nothing here has been asked to invent.
fn pack_tables(chunks: &[Chunk], result: &mut TweakSlotPack) {
    let mut slot_index = 0usize;
    for chunk in chunks.iter().filter(|c| c.form == LuaForm::Table) {
        if slot_index >= MAX_SLOTS {
            result.unplaced.push(chunk.title.clone());
            continue;
        }
        let minified = minify_lua(&chunk.lua);
        let payload = encode_tweakunits(&minified);
        let prefix = bset_prefix("tweakunits", slot_index);
        if !fits_payload(payload.len()) || !fits_line(prefix.len(), payload.len()) {
            result.oversized.push(chunk.title.clone());
            continue;
        }
        result.tweakunits.push(format!("{prefix}{payload}"));
        slot_index += 1;
    }
}

/// Block-form chunks are concatenated into a slot until the next one would
/// not fit, in the compiled order, which is the order they have to run in
/// (see this module's doc comment).
fn pack_blocks(chunks: &[Chunk], result: &mut TweakSlotPack) {
    let mut current = String::new();
    let mut slot_index = 0usize;

    for chunk in chunks.iter().filter(|c| c.form == LuaForm::Block) {
        if current.is_empty() && slot_index >= MAX_SLOTS {
            result.unplaced.push(chunk.title.clone());
            continue;
        }

        let minified = minify_lua(&chunk.lua);
        let candidate = if current.is_empty() {
            minified.clone()
        } else {
            format!("{current} {minified}")
        };
        let payload = encode(&candidate);
        let prefix = bset_prefix("tweakdefs", slot_index);
        if fits_payload(payload.len()) && fits_line(prefix.len(), payload.len()) {
            current = candidate;
            continue;
        }

        // Did not fit alongside what this slot already holds. Seal it, if it
        // holds anything, and try this chunk alone in the next one.
        if !current.is_empty() {
            let sealed = encode(&current);
            result
                .tweakdefs
                .push(format!("{}{sealed}", bset_prefix("tweakdefs", slot_index)));
            slot_index += 1;
            current = String::new();
        }

        if slot_index >= MAX_SLOTS {
            result.unplaced.push(chunk.title.clone());
            continue;
        }
        let solo_payload = encode(&minified);
        let solo_prefix = bset_prefix("tweakdefs", slot_index);
        if !fits_payload(solo_payload.len()) || !fits_line(solo_prefix.len(), solo_payload.len()) {
            result.oversized.push(chunk.title.clone());
            continue;
        }
        current = minified;
    }

    if !current.is_empty() {
        let payload = encode(&current);
        result
            .tweakdefs
            .push(format!("{}{payload}", bset_prefix("tweakdefs", slot_index)));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn table_chunk(title: &str, lua: &str) -> Chunk {
        Chunk {
            form: LuaForm::Table,
            title: title.to_string(),
            reason: "test".to_string(),
            lua: lua.to_string(),
        }
    }

    fn block_chunk(title: &str, lua: &str) -> Chunk {
        Chunk {
            form: LuaForm::Block,
            title: title.to_string(),
            reason: "test".to_string(),
            lua: lua.to_string(),
        }
    }

    /// Beyond All Reason reading a `tweakunits` payload, in its own two
    /// steps: `CustomKeyToUsefulTable`'s `string.gsub(dataRaw, "_", "=")`,
    /// then `base64Decode` from `common/luaUtilities/base64.lua`. That
    /// decoder's table maps both alphabets (`-` and `+` to 62, `_` and `/`
    /// to 63) and drops `=`, and it reads four characters at a time so a
    /// short final group just yields fewer bytes.
    ///
    /// Written out rather than reached for from the `base64` crate on
    /// purpose: no engine here does the `gsub`, and that step is the bug.
    fn as_bar_reads_tweakunits(payload: &str) -> Vec<u8> {
        let mut bits = Vec::new();
        for c in payload.replace('_', "=").chars() {
            let value = match c {
                'A'..='Z' => c as u8 - b'A',
                'a'..='z' => c as u8 - b'a' + 26,
                '0'..='9' => c as u8 - b'0' + 52,
                '-' | '+' => 62,
                '/' => 63,
                _ => continue, // `=`, which the table maps to nil.
            };
            bits.push(value);
        }
        let mut out = Vec::new();
        for group in bits.chunks(4) {
            out.push((group[0] << 2) | (group.get(1).copied().unwrap_or(0) >> 4));
            if group.len() > 2 {
                out.push((group[1] << 4) | (group[2] >> 2));
            }
            if group.len() > 3 {
                out.push((group[2] << 6) | group[3]);
            }
        }
        out
    }

    /// The bug (issue #2963). A unit renamed in Russian inside a copied
    /// definition is ordinary data, and its URL-safe payload holds a `_`
    /// that BAR turns into padding before decoding, so the table arrives
    /// truncated and the whole slot fails to load.
    #[test]
    fn a_tweakunits_payload_survives_bars_own_underscore_rewrite() {
        let lua = "{ [\"armcom\"] = { name = \"привет\" } }";
        let pack = pack(&[table_chunk("Field changes", lua)]);
        let payload = pack.tweakunits[0]
            .rsplit_once(' ')
            .expect("a payload")
            .1
            .to_string();

        assert!(!payload.contains('_'), "payload: {payload}");
        assert_eq!(
            String::from_utf8(as_bar_reads_tweakunits(&payload)).expect("utf8"),
            minify_lua(lua),
        );
    }

    /// The same bytes under the alphabet this project used before, to show
    /// the test above is testing something. BAR would read this one short.
    #[test]
    fn the_url_safe_spelling_of_the_same_payload_is_what_bar_damages() {
        let lua = "{ [\"armcom\"] = { name = \"привет\" } }";
        let url_safe = encode(&minify_lua(lua));
        assert!(url_safe.contains('_'));
        assert_ne!(
            String::from_utf8_lossy(&as_bar_reads_tweakunits(&url_safe)),
            minify_lua(lua),
        );
    }

    /// `tweakdefs` reaches BAR's decoder with no rewrite in the way, so it
    /// keeps the alphabet every other route in this project speaks.
    #[test]
    fn a_tweakdefs_payload_keeps_the_url_safe_alphabet() {
        // Chosen because the two alphabets spell this one differently: it
        // encodes a 63, so the standard form holds a `/` where the URL-safe
        // form holds a `_`.
        let lua = "do x = \"?\" end";
        assert_ne!(encode(lua), STANDARD_NO_PAD.encode(lua.as_bytes()));

        let pack = pack(&[block_chunk("Block", lua)]);
        let payload = pack.tweakdefs[0].rsplit_once(' ').expect("a payload").1;
        assert_eq!(payload, encode(&minify_lua(lua)));
        assert_eq!(
            URL_SAFE_NO_PAD.decode(payload).expect("decodes"),
            minify_lua(lua).as_bytes(),
        );
    }

    #[test]
    fn a_pack_becomes_the_mod_options_a_lobby_holds() {
        let pack = pack(&[
            table_chunk("t", "{ [\"a\"] = { x = 1 } }"),
            block_chunk("b", "do x = 1 end"),
        ]);
        let options = mod_options(&pack);
        assert_eq!(
            options.keys().collect::<Vec<_>>(),
            vec!["tweakdefs", "tweakunits"]
        );
        assert_eq!(options["tweakdefs"], encode("do x = 1 end"));
    }

    // -- minify_lua -----------------------------------------------------

    #[test]
    fn minify_strips_a_comment_line_and_collapses_whitespace() {
        let source = "-- Replaces the game's own armcom.\ndo\n  UnitDefs[\"armcom\"] = {\n    maxDamage = 9000,\n  }\nend";
        let minified = minify_lua(source);
        assert!(!minified.contains("--"));
        assert!(!minified.contains('\n'));
        assert!(minified.contains("do UnitDefs[\"armcom\"] = { maxDamage = 9000, } end"));
    }

    /// A modder's own text can legally contain `--`, and it must survive
    /// inside its string rather than being read as a comment start.
    #[test]
    fn minify_never_touches_the_inside_of_a_string() {
        let source = "do\n  -- a real comment\n  x = \"contains -- not a comment\"\nend";
        let minified = minify_lua(source);
        assert!(minified.contains("\"contains -- not a comment\""));
        assert_eq!(minified.matches("--").count(), 1);
    }

    #[test]
    fn minify_has_no_leading_or_trailing_space() {
        let minified = minify_lua("  \n-- comment\n  do end  \n-- trailing\n");
        assert_eq!(minified, "do end");
    }

    #[test]
    fn minify_keeps_an_escaped_quote_inside_the_string() {
        let source = "x = \"she said \\\"hi\\\"\"";
        assert_eq!(minify_lua(source), source);
    }

    /// The case carried Lua brings in. Coilbox's own generator never writes a
    /// single-quoted string, but the tools BAR players use quote with `'`
    /// throughout, and a `--` inside one of those is text, not a comment.
    #[test]
    fn minify_tracks_a_single_quoted_string() {
        let source = "do x = 'contains -- not a comment' y = 1 end";
        assert_eq!(minify_lua(source), source);
    }

    #[test]
    fn minify_keeps_a_quote_inside_a_single_quoted_string() {
        let source = "x = 'she said \"hi\"' y = 2";
        assert_eq!(minify_lua(source), source);
    }

    #[test]
    fn minify_leaves_a_long_bracket_string_alone() {
        let source = "x = [[ two  spaces and -- a fake comment ]] y = 3";
        assert_eq!(minify_lua(source), source);
        let levelled = "x = [==[ ]] still inside ]==] y = 4";
        assert_eq!(minify_lua(levelled), levelled);
    }

    #[test]
    fn minify_drops_a_long_comment_whole() {
        let minified = minify_lua("do --[[ a comment\nacross lines ]] x = 1 end");
        assert_eq!(minified, "do x = 1 end");
    }

    /// An index is not a string. `a[b[1]]` must survive as itself, while
    /// `a[[b]]` is Lua's own long-string call syntax and is left intact.
    #[test]
    fn minify_tells_an_index_from_a_long_string() {
        assert_eq!(minify_lua("x = a[b[1]]"), "x = a[b[1]]");
    }

    // -- boundary arithmetic ---------------------------------------------

    #[test]
    fn fits_payload_at_the_cap_one_under_and_one_over() {
        assert!(fits_payload(PAYLOAD_CAP));
        assert!(fits_payload(PAYLOAD_CAP - 1));
        assert!(!fits_payload(PAYLOAD_CAP + 1));
    }

    #[test]
    fn fits_line_at_the_cap_one_under_and_one_over() {
        assert!(fits_line(0, LINE_CAP));
        assert!(fits_line(0, LINE_CAP - 1));
        assert!(!fits_line(0, LINE_CAP + 1));
        // The worst real prefix, `!bset tweakunits29 `, is 19 characters.
        assert_eq!(bset_prefix("tweakunits", 29).len(), 19);
        assert!(fits_line(19, LINE_CAP - 19));
        assert!(!fits_line(19, LINE_CAP - 18));
    }

    /// The headroom the packing decision banks on: a payload sitting exactly
    /// at `PAYLOAD_CAP`, in the worst-prefixed slot the convention has, still clears
    /// `LINE_CAP` with room to spare. Matches "16,019 characters against a
    /// 16,385 slice" from issue #1277's own research.
    #[test]
    fn a_full_payload_in_the_worst_prefixed_slot_still_fits_the_line() {
        let prefix_len = bset_prefix("tweakunits", 29).len();
        assert_eq!(prefix_len + PAYLOAD_CAP, 16_019);
        assert!(fits_line(prefix_len, PAYLOAD_CAP));
    }

    // -- pack: table chunks ------------------------------------------------

    #[test]
    fn a_single_table_chunk_becomes_one_bare_tweakunits_line() {
        let pack = pack(&[table_chunk("added", "{ [\"a\"] = { x = 1 } }")]);
        assert_eq!(pack.tweakunits.len(), 1);
        assert!(pack.tweakunits[0].starts_with("!bset tweakunits "));
        assert!(pack.tweakdefs.is_empty());
        assert!(pack.complete());
    }

    #[test]
    fn two_table_chunks_take_two_slots_numbered_from_the_second() {
        let pack = pack(&[
            table_chunk("first", "{ [\"a\"] = { x = 1 } }"),
            table_chunk("second", "{ [\"b\"] = { x = 2 } }"),
        ]);
        assert_eq!(pack.tweakunits.len(), 2);
        assert!(pack.tweakunits[0].starts_with("!bset tweakunits "));
        assert!(pack.tweakunits[1].starts_with("!bset tweakunits1 "));
    }

    /// A table chunk whose own payload already exceeds the cap cannot be
    /// split, so it is reported rather than truncated.
    #[test]
    fn an_oversized_table_chunk_is_reported_and_consumes_no_slot() {
        // 12,100 raw bytes of unique content (base64 does not compress
        // repeats away like a real compressor would) encodes comfortably
        // past 16,000.
        let big = format!("{{ x = \"{}\" }}", "a".repeat(12_100));
        let pack = pack(&[table_chunk("huge", &big)]);
        assert!(pack.tweakunits.is_empty());
        assert_eq!(pack.oversized, vec!["huge".to_string()]);
        assert!(!pack.complete());
    }

    /// Ran out of the 30 slots the game exposes: real for a large enough project,
    /// and exactly the failure issue #1277 asks to be said before the export.
    #[test]
    fn the_31st_table_chunk_is_unplaced_rather_than_silently_dropped() {
        let chunks: Vec<Chunk> = (0..31)
            .map(|i| table_chunk(&format!("c{i}"), "{ [\"a\"] = 1 }"))
            .collect();
        let pack = pack(&chunks);
        assert_eq!(pack.tweakunits.len(), 30);
        assert_eq!(pack.unplaced, vec!["c30".to_string()]);
        assert!(pack.oversized.is_empty());
        assert!(!pack.complete());
    }

    // -- pack: block chunks -------------------------------------------------

    #[test]
    fn small_block_chunks_are_concatenated_into_one_slot() {
        let pack = pack(&[
            block_chunk("first", "do\n  x = 1\nend"),
            block_chunk("second", "do\n  y = 2\nend"),
        ]);
        assert_eq!(pack.tweakdefs.len(), 1);
        let line = &pack.tweakdefs[0];
        assert!(line.starts_with("!bset tweakdefs "));
        assert!(line.contains(&encode(&minify_lua("do x = 1 end do y = 2 end"))));
    }

    /// Order is preserved rather than re-sorted by size: a block that must
    /// run after another cannot be placed ahead of it just because it is
    /// smaller (see this module's doc comment on why no extra sort runs).
    #[test]
    fn blocks_are_concatenated_in_compiled_order() {
        let a = minify_lua("do x = 1 end");
        let b = minify_lua("do y = 2 end");
        let pack = pack(&[
            block_chunk("a", "do\n  x = 1\nend"),
            block_chunk("b", "do\n  y = 2\nend"),
        ]);
        let decoded = String::from_utf8(
            URL_SAFE_NO_PAD
                .decode(pack.tweakdefs[0].strip_prefix("!bset tweakdefs ").unwrap())
                .unwrap(),
        )
        .unwrap();
        assert_eq!(decoded, format!("{a} {b}"));
    }

    /// A block too large for one slot on its own spills into the next slot
    /// rather than being force-fit or truncated.
    #[test]
    fn a_block_that_does_not_fit_alongside_another_starts_a_new_slot() {
        // Chosen so the filler alone encodes to 15,996 (fits, under the cap)
        // but filler + "more" encodes to 16,014 (exceeds it), forcing "more"
        // into a second slot rather than truncating either block.
        let filler = format!("do x = \"{}\" end", "a".repeat(11_984));
        let pack = pack(&[
            block_chunk("filler", &filler),
            block_chunk("more", "do y = 1 end"),
        ]);
        assert_eq!(pack.tweakdefs.len(), 2);
        assert!(pack.tweakdefs[0].starts_with("!bset tweakdefs "));
        assert!(pack.tweakdefs[1].starts_with("!bset tweakdefs1 "));
        assert!(pack.complete());
    }

    #[test]
    fn a_single_oversized_block_is_reported_and_consumes_no_slot() {
        let huge = format!("do x = \"{}\" end", "a".repeat(12_100));
        let pack = pack(&[
            block_chunk("huge", &huge),
            block_chunk("small", "do y = 1 end"),
        ]);
        assert_eq!(pack.oversized, vec!["huge".to_string()]);
        // The chunk after the oversized one still lands in the first slot,
        // since the oversized chunk never opened one.
        assert_eq!(pack.tweakdefs.len(), 1);
        assert!(pack.tweakdefs[0].starts_with("!bset tweakdefs "));
    }

    #[test]
    fn a_project_with_nothing_of_one_form_packs_only_the_other() {
        let pack = pack(&[block_chunk("only", "do x = 1 end")]);
        assert!(pack.tweakunits.is_empty());
        assert_eq!(pack.tweakdefs.len(), 1);
    }

    #[test]
    fn an_empty_project_packs_to_nothing_and_is_complete() {
        let pack = pack(&[]);
        assert!(pack.tweakdefs.is_empty());
        assert!(pack.tweakunits.is_empty());
        assert!(pack.complete());
    }
}
