//! Packing compiled chunks across a game's numbered tweak slots, for a
//! player who does not control the host's own lobby (issue #1277).
//!
//! `tweakdefs`/`tweakunits` mod options predate Beyond All Reason: any game
//! whose `modoptions.lua` declares the same bare-plus-numbered keys can take
//! a project this way. Two games declaring them have had their own decoding
//! code read and their definitions loaded with slots set (issue #3126):
//! Beyond All Reason and Zero-K. BAR's code is Zero-K's with changes: the
//! same `modoptions.lua` loop, the same `CustomKeyToUsefulTable`, and the
//! same 2006 base64 library by Alex Kloss. What each does, from its own
//! `gamedata/unitdefs_post.lua`:
//!
//! | | `tweakdefs` | `tweakunits` | order |
//! |-|-|-|-|
//! | Zero-K v1.14.8.0 | URL-safe base64 only, then `loadstring` | `_` rewritten to `=`, then URL-safe only, then merged into units the game has | every `tweakdefs` slot, then every `tweakunits` slot, each stopping at the first empty one |
//! | BAR `test-30922-8064a43` (August 2026) | URL-safe only | as Zero-K | every `tweakdefs` slot, then every `tweakunits` slot, by number, gaps skipped |
//! | BAR `master`, September 2026 | both alphabets since upstream `7089c3c` (8 September) | as Zero-K, but reads both alphabets | every `tweakunits` slot first since upstream #6597 (4 September) |
//!
//! A `tweakunits` payload therefore has no spelling every game reads: the
//! value 63 is `_`, which the rewrite destroys everywhere, or `/`, which only
//! BAR `master` reads, and 62 as `+` fails the same way. A character a
//! decoder cannot read either drops a byte or stops the whole slot loading,
//! depending on where in its group of four it falls. And whether
//! it runs before or after the `tweakdefs` slots depends on the BAR build.
//! So this module packs everything into `tweakdefs` slots, in URL-safe
//! base64, which every decoder above reads unchanged, in the one order all
//! three agree on. A table-form chunk goes in as a block that merges it with
//! the same code the mutator route runs (`compile::table_as_block`). No
//! game past these two has been checked, which the delivery route says on
//! screen (`src/workshop/deliveryRoutes.ts`).
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
//! Every chunk, once a table has become a block, is a self-contained
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
//! Encoding is unpadded URL-safe base64, the alphabet `localTweakSlot.ts`
//! already uses for the local single-slot route. It is not padded, because
//! every decoder above walks its input four characters at a time and a short
//! final group simply yields fewer bytes.

use crate::compile::{table_as_block, Chunk, LuaForm};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use serde::Serialize;
use std::borrow::Cow;

/// The base64 payload cap, per slot. Tom's decision on issue #1277.
pub const PAYLOAD_CAP: usize = 16_000;

/// The whole `!bset tweak<defs|units><n> <payload>` line, past which
/// teiserver's own slice starts silently dropping characters. `PAYLOAD_CAP`
/// already leaves headroom under this on its own. This is the check that
/// keeps proving it rather than assuming it, per this module's doc comment.
pub const LINE_CAP: usize = 16_385;

/// The most slots any checked game declares: the bare option plus numbered
/// `1` through `29`, which is BAR `master` since upstream #6597. Zero-K and
/// BAR `test-30922-8064a43` declare `1` through `9`, so the frontend compares
/// what a pack used against the game's own count (`tweakSlotFit` in
/// `tweakPack.ts`) rather than trusting this ceiling.
const MAX_SLOTS: usize = 30;

/// What packing a project's chunks across the game's slots produced.
#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TweakSlotPack {
    /// One `!bset tweakdefs...` line per filled slot, in the order they have
    /// to run. The only kind a pack fills (see this module's doc comment).
    pub tweakdefs: Vec<String>,
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

/// The URL-safe, unpadded base64 a `tweakdefs` slot carries. Every decoder
/// in this module's doc comment reads this alphabet with no rewrite first.
pub(crate) fn encode(text: &str) -> String {
    URL_SAFE_NO_PAD.encode(text.as_bytes())
}

/// The other half of [`encode`], for a caller checking the round trip.
pub(crate) fn decode(payload: &str) -> Result<Vec<u8>, base64::DecodeError> {
    URL_SAFE_NO_PAD.decode(payload)
}

/// The Lua a chunk puts in a `tweakdefs` slot: a block as it stands, and a
/// table as a block that merges it onto `UnitDefs` (see this module's doc
/// comment for why no chunk goes to a `tweakunits` slot). Shared with
/// `preflight.rs` and `ledger.rs`, so the round trip one checks and the slot
/// the other finds are the Lua that actually ships.
pub(crate) fn slot_lua(chunk: &Chunk) -> Cow<'_, str> {
    match chunk.form {
        LuaForm::Table => Cow::Owned(table_as_block(&chunk.lua)),
        LuaForm::Block => Cow::Borrowed(&chunk.lua),
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
        .filter_map(|line| line.strip_prefix("!bset ")?.split_once(' '))
        .map(|(key, payload)| (key.to_string(), payload.to_string()))
        .collect()
}

/// Pack every chunk `compile::compile` produced across the game's numbered
/// `tweakdefs` slots. Chunks are concatenated into a slot until the next one
/// would not fit, in the compiled order, which is the order they have to run
/// in (see this module's doc comment).
pub fn pack(chunks: &[Chunk]) -> TweakSlotPack {
    let mut result = TweakSlotPack::default();
    let mut current = String::new();
    let mut slot_index = 0usize;

    for chunk in chunks {
        if current.is_empty() && slot_index >= MAX_SLOTS {
            result.unplaced.push(chunk.title.clone());
            continue;
        }

        let minified = minify_lua(&slot_lua(chunk));
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
    result
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

    /// How the decoders checked in this module's doc comment read a payload:
    /// the 2006 Kloss library as Zero-K v1.14.8.0 and BAR
    /// `test-30922-8064a43` ship it, with only the URL-safe pair in its table.
    /// `underscore_rewrite` adds `CustomKeyToUsefulTable`'s
    /// `string.gsub(dataRaw, "_", "=")`, the extra step a `tweakunits` slot
    /// takes and a `tweakdefs` slot does not.
    ///
    /// A character outside the table reads as nil, and the Lua then does one
    /// of two things depending on where in its group of four the nil falls.
    /// In the first two places, or the third with a fourth after it, the
    /// arithmetic on nil raises an error and the slot is lost, which is
    /// `None` here. In the last place the byte is dropped and decoding goes
    /// on, so the Lua arrives short.
    ///
    /// Written out rather than reached for from the `base64` crate on
    /// purpose: no library here reads the way that Lua does.
    fn as_the_checked_games_decode(payload: &str, underscore_rewrite: bool) -> Option<Vec<u8>> {
        let text = if underscore_rewrite {
            payload.replace('_', "=")
        } else {
            payload.to_string()
        };
        let value = |c: char| -> Option<u8> {
            match c {
                'A'..='Z' => Some(c as u8 - b'A'),
                'a'..='z' => Some(c as u8 - b'a' + 26),
                '0'..='9' => Some(c as u8 - b'0' + 52),
                '-' => Some(62),
                '_' => Some(63),
                _ => None,
            }
        };
        let chars: Vec<char> = text.chars().collect();
        let mut out = Vec::new();
        for group in chars.chunks(4) {
            let v: Vec<Option<u8>> = (0..4)
                .map(|i| group.get(i).and_then(|c| value(*c)))
                .collect();
            let (a, b) = (v[0]?, v[1]?);
            out.push((a << 2) | (b >> 4));
            match (v[2], v[3]) {
                (Some(c), Some(d)) => {
                    out.push((b << 4) | (c >> 2));
                    out.push((c << 6) | d);
                }
                (Some(c), None) => out.push((b << 4) | (c >> 2)),
                (None, Some(_)) => return None,
                (None, None) => {}
            }
        }
        Some(out)
    }

    /// A field change naming a unit in Russian ("heavy tank"), chosen
    /// because its table encodes a 63, which is where the checked games'
    /// `tweakunits` decoding goes wrong.
    const RUSSIAN_FIELD_CHANGE: &str = "{ [\"armcom\"] = { name = \"Тяжёлый танк\" } }";

    /// The bug (issue #3126). Put in a `tweakunits` slot, that table has no
    /// spelling the checked decoders read back: the URL-safe `_` becomes
    /// padding in the rewrite (issue #2963), and the standard `+` and `/`
    /// are not in their table at all, so the #2963 fix only moved the break.
    #[test]
    fn no_alphabet_carries_this_table_through_a_tweakunits_slot() {
        let minified = minify_lua(RUSSIAN_FIELD_CHANGE);
        let url_safe = encode(&minified);
        let standard = base64::engine::general_purpose::STANDARD_NO_PAD.encode(minified.as_bytes());
        assert!(url_safe.contains('_'));
        assert!(standard.contains('+') || standard.contains('/'));
        for payload in [url_safe, standard] {
            assert_ne!(
                as_the_checked_games_decode(&payload, true).as_deref(),
                Some(minified.as_bytes()),
                "{payload}"
            );
        }
    }

    /// The fix. The same table packs into a `tweakdefs` slot as a block that
    /// merges it, and that slot is decoded with no rewrite first, so the
    /// URL-safe `_` reads back as 63 and the Lua arrives whole.
    #[test]
    fn a_table_chunk_packs_into_a_tweakdefs_slot_the_checked_games_read_whole() {
        let pack = pack(&[table_chunk("Field changes", RUSSIAN_FIELD_CHANGE)]);
        assert_eq!(pack.tweakdefs.len(), 1);
        assert!(pack.tweakdefs[0].starts_with("!bset tweakdefs "));
        let payload = pack.tweakdefs[0].rsplit_once(' ').expect("a payload").1;
        let expected = minify_lua(&table_as_block(RUSSIAN_FIELD_CHANGE));
        assert_eq!(
            as_the_checked_games_decode(payload, false).as_deref(),
            Some(expected.as_bytes()),
        );
        assert!(expected.starts_with("do "));
        assert!(expected.contains("local changes = { [\"armcom\"]"));
        assert!(expected.contains("merge(def, patch)"));
        assert!(expected.ends_with(" end"));
    }

    /// `tweakdefs` reaches every checked decoder with no rewrite in the way,
    /// so it keeps the alphabet every other route in this project speaks.
    #[test]
    fn a_tweakdefs_payload_keeps_the_url_safe_alphabet() {
        // Chosen because it encodes a 63, which the URL-safe alphabet spells
        // as `_`.
        let lua = "do x = \"?\" end";
        assert!(encode(lua).contains('_'));

        let pack = pack(&[block_chunk("Block", lua)]);
        let payload = pack.tweakdefs[0].rsplit_once(' ').expect("a payload").1;
        assert_eq!(payload, encode(&minify_lua(lua)));
        assert_eq!(
            decode(payload).expect("decodes"),
            minify_lua(lua).as_bytes()
        );
    }

    #[test]
    fn a_pack_becomes_the_mod_options_a_lobby_holds() {
        let pack = pack(&[
            table_chunk("t", "{ [\"a\"] = { x = 1 } }"),
            block_chunk("b", "do x = 1 end"),
        ]);
        let options = mod_options(&pack);
        assert_eq!(options.keys().collect::<Vec<_>>(), vec!["tweakdefs"]);
        let table = minify_lua(&table_as_block("{ [\"a\"] = { x = 1 } }"));
        assert_eq!(
            options["tweakdefs"],
            encode(&format!("{table} do x = 1 end"))
        );
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
    fn a_single_table_chunk_becomes_one_bare_tweakdefs_line() {
        let pack = pack(&[table_chunk("changes", "{ [\"a\"] = { x = 1 } }")]);
        assert_eq!(pack.tweakdefs.len(), 1);
        assert!(pack.tweakdefs[0].starts_with("!bset tweakdefs "));
        assert!(pack.complete());
    }

    /// A table is a block once packed, so it shares a slot with the blocks
    /// around it, in compiled order, rather than taking one of its own.
    #[test]
    fn a_table_chunk_shares_a_slot_with_the_blocks_around_it_in_order() {
        let pack = pack(&[
            block_chunk("before", "do x = 1 end"),
            table_chunk("changes", "{ [\"a\"] = { x = 2 } }"),
            block_chunk("after", "do y = 3 end"),
        ]);
        assert_eq!(pack.tweakdefs.len(), 1);
        let decoded = String::from_utf8(
            decode(pack.tweakdefs[0].strip_prefix("!bset tweakdefs ").unwrap()).unwrap(),
        )
        .unwrap();
        let table = minify_lua(&table_as_block("{ [\"a\"] = { x = 2 } }"));
        assert_eq!(decoded, format!("do x = 1 end {table} do y = 3 end"));
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
        assert!(pack.tweakdefs.is_empty());
        assert_eq!(pack.oversized, vec!["huge".to_string()]);
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

    /// Ran out of the 30 slots the convention allows: real for a large
    /// enough project, and exactly the failure issue #1277 asks to be said
    /// before the export. Each block here is too big to share a slot.
    #[test]
    fn the_31st_slot_worth_of_chunks_is_unplaced_rather_than_silently_dropped() {
        let chunks: Vec<Chunk> = (0..31)
            .map(|i| {
                block_chunk(
                    &format!("c{i}"),
                    &format!("do x = \"{}\" end", "a".repeat(7_000)),
                )
            })
            .collect();
        let pack = pack(&chunks);
        assert_eq!(pack.tweakdefs.len(), 30);
        assert_eq!(pack.unplaced, vec!["c30".to_string()]);
        assert!(pack.oversized.is_empty());
        assert!(!pack.complete());
    }

    #[test]
    fn an_empty_project_packs_to_nothing_and_is_complete() {
        let pack = pack(&[]);
        assert!(pack.tweakdefs.is_empty());
        assert!(pack.complete());
    }
}
