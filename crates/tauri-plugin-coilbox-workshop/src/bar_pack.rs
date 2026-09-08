//! Packing compiled chunks across Beyond All Reason's numbered tweak slots,
//! for a player who does not control the host's own lobby (issue #1277).
//!
//! A mutator archive cannot be loaded into a BAR lobby. The only route open
//! to a player who is not hosting is asking the server to set a
//! `tweakdefs`/`tweakunits` mod option through the `!bset` chat command a
//! SPADS-based autohost answers to, which is why every line this module
//! produces carries the `!bset <slot> ` prefix rather than the bare base64:
//! the length that matters is the whole chat line teiserver reads, not only
//! the payload inside it.
//!
//! The cap, and why it is not the more obvious 16,384 or 16,385: teiserver's
//! `spring_in.ex` slices a `!bset tweakdefs`/`!bset tweakunits` `SAYBATTLE`
//! line to 16,385 characters (`String.slice(0..16_384)`, an inclusive Elixir
//! range) before silently truncating whatever is left, with no error sent
//! back. Coilbox caps the base64 *payload* at 16,000 rather than pushing to
//! that ceiling: Tom's decision on issue #1277, matching NuttyB's own
//! configurator (`MAX_ENCODED_SIZE`, uncited but already familiar to the
//! tooling BAR players use) over the 10,000 that issue's own research
//! recommended, because he is getting uberserver's smaller 10,000-character
//! refusal raised separately. 16,000 leaves 385 characters of headroom under
//! teiserver's real limit once the longest prefix (`!bset tweakunits29 `, 19
//! characters) is added. Every fit check below still measures the whole line
//! rather than trusting that headroom, because BAR's own EditP tool shows
//! what happens when a cap is checked against the payload alone. It compares
//! only the base64 against its threshold, so it can hand teiserver a line the
//! server then truncates without telling anyone (see issue #1277's own
//! research comments). Uberserver refuses a line over 10,000 characters
//! outright rather than truncating it. Surfacing that refusal is issue
//! #1279's, not this module's to avoid by shrinking the cap.
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
//! local BAR route (`localBar.ts`) both want to show or ship Lua a person can
//! read, and only the numbered-slot export is squeezed for size. Comments are
//! dropped and whitespace is collapsed to single spaces, tracking whether a
//! `"` has opened a string so a modder's own text (which can legally contain
//! `--`) is never mistaken for a comment. Nothing here generates a
//! single-quoted or long-bracket Lua string (`lua.rs`'s `lua_string` always
//! double-quotes), so neither is tracked.
//!
//! Encoding reuses the exact alphabet `preflight.rs`'s round-trip check
//! already proves every chunk survives, and `localBar.ts` already uses for
//! the local single-slot route: URL-safe base64, padding stripped. That is
//! one encoding implemented in the language each caller already runs in, not
//! a second one invented for this module. This crate's own `Cargo.toml`
//! already names its `base64` dependency as "the codec issue #1277's BAR
//! export will encode a slot's payload with".

use crate::compile::{Chunk, LuaForm};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use serde::Serialize;

/// The base64 payload cap, per slot. Tom's decision on issue #1277.
pub const PAYLOAD_CAP: usize = 16_000;

/// The whole `!bset tweak<defs|units><n> <payload>` line, past which
/// teiserver's own slice starts silently dropping characters. `PAYLOAD_CAP`
/// already leaves headroom under this on its own. This is the check that
/// keeps proving it rather than assuming it, per this module's doc comment.
pub const LINE_CAP: usize = 16_385;

/// One slot key past the last one BAR's `modoptions.lua` declares: the bare
/// option plus numbered `1` through `29` (`deliveryRoutes.ts`'s own doc
/// comment, read off BAR's mod option generator), so 30 valid indices in
/// total. 0 for the bare slot and 1..=29 for the numbered ones.
const MAX_SLOTS: usize = 30;

/// What packing a project's chunks across BAR's slots produced.
#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BarSlotPack {
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
    /// A chunk that would have fit a slot on its own, but every slot BAR
    /// exposes was already spoken for by chunks compiled ahead of it.
    pub unplaced: Vec<String>,
}

impl BarSlotPack {
    /// Whether every chunk handed to [`pack`] reached a slot. `false` is
    /// exactly the case issue #1277 asks to be said before the export rather
    /// than after.
    pub fn complete(&self) -> bool {
        self.oversized.is_empty() && self.unplaced.is_empty()
    }
}

/// Strip comments and collapse whitespace to single spaces, without touching
/// a string literal's own bytes. See this module's doc comment for why only
/// `"` is tracked, and why a run of removed whitespace or comment becomes
/// exactly one space rather than nothing: two tokens that were separated in
/// the source must stay separated, or `end` and `if` written on their own
/// lines could merge into one identifier.
pub fn minify_lua(source: &str) -> String {
    let mut out = String::with_capacity(source.len());
    let mut chars = source.chars().peekable();
    let mut in_string = false;
    let mut pending_space = false;

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

    while let Some(c) = chars.next() {
        if in_string {
            out.push(c);
            if c == '\\' {
                if let Some(escaped) = chars.next() {
                    out.push(escaped);
                }
            } else if c == '"' {
                in_string = false;
            }
            continue;
        }
        if c == '"' {
            flush_space!();
            in_string = true;
            out.push(c);
            continue;
        }
        if c == '-' && chars.peek() == Some(&'-') {
            chars.next();
            for next in chars.by_ref() {
                if next == '\n' {
                    break;
                }
            }
            mark_space!();
            continue;
        }
        if c.is_whitespace() {
            mark_space!();
            continue;
        }
        flush_space!();
        out.push(c);
    }
    out
}

/// The URL-safe, unpadded base64 every route in this project uses.
fn encode(text: &str) -> String {
    URL_SAFE_NO_PAD.encode(text.as_bytes())
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

/// Pack every chunk `compile::compile` produced across BAR's numbered slots.
pub fn pack(chunks: &[Chunk]) -> BarSlotPack {
    let mut result = BarSlotPack::default();
    pack_tables(chunks, &mut result);
    pack_blocks(chunks, &mut result);
    result
}

/// A table-form chunk gets a slot of its own. BAR's `tweakunits` carries a
/// plain table, and two of those cannot be joined into one without a rule
/// for merging their keys that nothing here has been asked to invent.
fn pack_tables(chunks: &[Chunk], result: &mut BarSlotPack) {
    let mut slot_index = 0usize;
    for chunk in chunks.iter().filter(|c| c.form == LuaForm::Table) {
        if slot_index >= MAX_SLOTS {
            result.unplaced.push(chunk.title.clone());
            continue;
        }
        let minified = minify_lua(&chunk.lua);
        let payload = encode(&minified);
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
fn pack_blocks(chunks: &[Chunk], result: &mut BarSlotPack) {
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
    /// at `PAYLOAD_CAP`, in the worst-prefixed slot BAR has, still clears
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

    /// Ran out of the 30 slots BAR exposes: real for a large enough project,
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
