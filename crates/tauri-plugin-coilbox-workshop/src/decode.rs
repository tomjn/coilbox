//! Decoding a base64 tweak payload back to Lua, and as far into the project
//! model as its own shape allows (issue #1280).
//!
//! This is the inverse of `bar_pack.rs` (issue #1277): that module packs
//! compiled chunks into `!bset` lines, this one reads a line, or a whole set
//! of a battle's mod options, back out. What it hands back is honest about
//! what it found rather than forcing everything into one shape:
//!
//!  - A slot that decodes to a plain Lua table (`{ ... }`, no calls, no
//!    control flow) is **data**. It is safe to actually evaluate for its
//!    structure, and the frontend can offer it as new units in a project.
//!  - A slot that decodes to a sequence of Lua statements is a **program**.
//!    A `tweakdefs` block full of loops and conditionals is not read back
//!    into any editable store: it is shown as Lua and nothing here ever runs
//!    its body.
//!  - Anything else, valid Lua that is neither shape, or text that does not
//!    parse at all, is **unrecognised**: still shown, never executed, never
//!    offered as structured data.
//!
//! Two safety decisions worth stating up front, because `coilbox-springlua`
//! documents two sandbox holes of its own (no canonicalisation, no
//! allocation cap) and this is the first place in the app that runs a
//! stranger's payload through it rather than a project the local user typed:
//!
//!  1. **Size is checked before anything touches the VM.** A payload longer
//!     than `bar_pack::PAYLOAD_CAP` (the same ceiling the packer enforces on
//!     the way out) is refused outright: not decoded, not parsed, not run.
//!  2. **A block is compiled, never executed.** [`parses_as_block`] reuses
//!     `preflight.rs`'s own trick of defining the body inside a closure that
//!     is never called (`local check = function() ... end`), so a syntax
//!     check can never run a loop or a side effect. **A table is only
//!     actually evaluated once it has passed [`looks_like_a_plain_table`]**,
//!     which refuses anything containing a `(` outside a string literal.
//!     Lua never needs one to write a data literal, arrays, strings, numbers
//!     and nested tables all read without one, so a `(` anywhere else means
//!     a function is being called or an expression is being grouped, which
//!     is exactly the "program disguised as an expression" case the
//!     instruction cap alone does not rule out overallocating.

use crate::bar_pack::PAYLOAD_CAP;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use coilbox_springlua::SpringLua;
use serde::Serialize;
use std::collections::BTreeMap;

/// Which BAR mod option a slot's key names, read the same way
/// `deliveryRoutes.ts`'s `TWEAK_KEY` does: `tweak(defs|units)(\d+)?`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SlotKind {
    Tweakdefs,
    Tweakunits,
    /// Neither: a bare pasted payload with no recognisable key, or one that
    /// could not be matched to either kind.
    Unknown,
}

/// What decoding one payload found. Every field that can be answered is,
/// even when an earlier one carries an error, so the caller always has
/// something to show rather than nothing.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DecodedSlot {
    /// The key this came from: a mod option name (`tweakdefs3`), or
    /// `"pasted"` for a single ad hoc paste with no key of its own.
    pub key: String,
    pub kind: SlotKind,
    /// The numbered slot, when the key or an embedded `!bset` prefix named
    /// one. `Some(0)` for the bare slot, matching `bar_pack::bset_prefix`.
    pub slot: Option<usize>,
    /// The decoded Lua, verbatim, once decoding got that far. `None` only
    /// when the payload could not even be turned into text: see `error`.
    pub lua: Option<String>,
    /// A leading `--[[ ... ]]` or run of `--` lines, if the payload opens
    /// with one. NuttyB's packer leaves one naming its source files, and
    /// this is the fingerprint issue #1280 asks to surface.
    pub manifest: Option<String>,
    /// `"table"`, `"block"` or `"unrecognised"`. See this module's own doc
    /// comment for what each means. Only set once `lua` is.
    pub form: Option<String>,
    /// The decoded structure, only when `form` is `"table"` and it was
    /// actually safe to evaluate. Absent for a block, never guessed at.
    pub table: Option<serde_json::Value>,
    /// Why decoding stopped short, in the user's own terms. Absent on a
    /// clean decode, even one classified `"unrecognised"`: that form is not
    /// itself an error, only a shape nothing here can act on.
    pub error: Option<String>,
}

/// Every slot decode found, bucketed the way `bar_pack::BarSlotPack` buckets
/// the other direction, and ordered by slot number within each bucket so
/// the frontend can show `tweakdefs`, `tweakdefs1`, `tweakdefs2`... in the
/// order they were meant to run.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DecodedTweakSet {
    pub tweakdefs: Vec<DecodedSlot>,
    pub tweakunits: Vec<DecodedSlot>,
    /// A key that named neither kind, or a payload that could not be
    /// classified once decoded.
    pub unrecognised: Vec<DecodedSlot>,
}

/// Decode every recognised key in a mod-options-shaped map: `tweakdefs`,
/// `tweakdefs1`..`tweakdefs29`, `tweakunits`, `tweakunits1`..`tweakunits29`,
/// and `pasted` for a single ad hoc paste. Anything else in the map (a
/// battle's other mod options) is ignored rather than reported on, since a
/// caller handing over a whole options set should not get back a complaint
/// about every key that was never a tweak slot.
pub fn decode_many(entries: &BTreeMap<String, String>) -> Result<DecodedTweakSet, String> {
    let lua = SpringLua::new(std::env::temp_dir())
        .map_err(|e| format!("Could not start the Lua syntax check: {e}"))?;

    let mut out = DecodedTweakSet::default();
    for (key, raw) in entries {
        if key != "pasted" && slot_kind_and_index(key).0 == SlotKind::Unknown {
            continue; // Not a tweak slot at all, and not this function's to report on.
        }
        let slot = decode_one(&lua, key, raw);
        match slot.kind {
            SlotKind::Tweakdefs => out.tweakdefs.push(slot),
            SlotKind::Tweakunits => out.tweakunits.push(slot),
            SlotKind::Unknown => out.unrecognised.push(slot),
        }
    }
    out.tweakdefs.sort_by_key(|s| s.slot.unwrap_or(usize::MAX));
    out.tweakunits.sort_by_key(|s| s.slot.unwrap_or(usize::MAX));
    Ok(out)
}

/// Decode one payload. `key_hint` is the map key it was read under. An
/// embedded `!bset <key> ` prefix on `raw` itself, if present, overrides it,
/// since that is the more specific fact when a whole line was pasted intact.
pub fn decode_one(lua: &SpringLua, key_hint: &str, raw: &str) -> DecodedSlot {
    let (prefixed_key, remainder) = strip_bset_prefix(raw);
    let key = prefixed_key.unwrap_or_else(|| key_hint.to_string());
    let (kind, slot) = slot_kind_and_index(&key);

    let normalized = normalize_base64(remainder);
    if normalized.is_empty() {
        return DecodedSlot {
            key,
            kind,
            slot,
            lua: None,
            manifest: None,
            form: None,
            table: None,
            error: Some("There is nothing to decode.".to_string()),
        };
    }
    if normalized.len() > PAYLOAD_CAP {
        return DecodedSlot {
            key,
            kind,
            slot,
            lua: None,
            manifest: None,
            form: None,
            table: None,
            error: Some(format!(
                "This payload is {} characters, over the {PAYLOAD_CAP} coilbox will decode. Left as text rather than run through anything.",
                normalized.len(),
            )),
        };
    }

    let bytes = match URL_SAFE_NO_PAD.decode(&normalized) {
        Ok(bytes) => bytes,
        Err(e) => {
            return DecodedSlot {
                key,
                kind,
                slot,
                lua: None,
                manifest: None,
                form: None,
                table: None,
                error: Some(format!("Not valid base64: {e}")),
            }
        }
    };
    let text = match String::from_utf8(bytes) {
        Ok(text) => text,
        Err(e) => {
            return DecodedSlot {
                key,
                kind,
                slot,
                lua: None,
                manifest: None,
                form: None,
                table: None,
                error: Some(format!("The decoded bytes are not valid UTF-8 text: {e}")),
            }
        }
    };

    let manifest = leading_comment(&text);
    let trimmed = text.trim();
    let is_block = parses_as_block(lua, trimmed);
    let (form, table) = if !is_block && looks_like_a_plain_table(trimmed) {
        match lua.eval_value_raw(&format!("return {trimmed}\n"), &key) {
            Ok(value) if value.is_object() => ("table", Some(value)),
            _ => ("unrecognised", None),
        }
    } else if is_block {
        ("block", None)
    } else {
        ("unrecognised", None)
    };

    DecodedSlot {
        key,
        kind,
        slot,
        lua: Some(text),
        manifest,
        form: Some(form.to_string()),
        table,
        error: None,
    }
}

/// Strip a `!bset tweak<defs|units><n> ` prefix if the pasted text still has
/// it (a real-world paste, issue #1280's own requirement), and read off the
/// key it names. `bar_pack::bset_prefix` writes exactly this shape.
fn strip_bset_prefix(text: &str) -> (Option<String>, &str) {
    let trimmed = text.trim();
    let Some(after) = trimmed.strip_prefix("!bset") else {
        return (None, trimmed);
    };
    let after = after.trim_start();
    let mut parts = after.splitn(2, char::is_whitespace);
    let key = parts.next().unwrap_or("").trim();
    let rest = parts.next().unwrap_or("").trim_start();
    if key.is_empty() {
        return (None, trimmed);
    }
    (Some(key.to_string()), rest)
}

/// Base64 text as a real paste actually arrives: padding a paste tool added
/// back, whitespace from wrapped chat text, and either alphabet, normalised
/// to the URL-safe one every route in this project encodes with. Converting
/// rather than trying both alphabets keeps this to one decode attempt.
fn normalize_base64(text: &str) -> String {
    text.chars()
        .filter(|c| !c.is_whitespace() && *c != '=')
        .map(|c| match c {
            '+' => '-',
            '/' => '_',
            other => other,
        })
        .collect()
}

/// A key's kind and numbered slot, matching `deliveryRoutes.ts`'s own
/// `TWEAK_KEY` pattern: `tweak(defs|units)(\d+)?`. The bare key is slot 0,
/// numbered ones from 1, the same convention `bar_pack::bset_prefix` writes.
fn slot_kind_and_index(key: &str) -> (SlotKind, Option<usize>) {
    for (prefix, kind) in [
        ("tweakdefs", SlotKind::Tweakdefs),
        ("tweakunits", SlotKind::Tweakunits),
    ] {
        let Some(rest) = key.strip_prefix(prefix) else {
            continue;
        };
        if rest.is_empty() {
            return (kind, Some(0));
        }
        if rest.bytes().all(|b| b.is_ascii_digit()) {
            if let Ok(n) = rest.parse::<usize>() {
                return (kind, Some(n));
            }
        }
    }
    (SlotKind::Unknown, None)
}

/// A leading `--[[ ... ]]` block comment, or a leading run of `--` line
/// comments, whichever the text opens with. This is where NuttyB's packer
/// leaves the manifest naming its source files, and it is read off the raw
/// text before classification so it is captured whether the payload turns
/// out to be data or a program.
fn leading_comment(lua: &str) -> Option<String> {
    let trimmed = lua.trim_start();
    if let Some(rest) = trimmed.strip_prefix("--[[") {
        let end = rest.find("]]")?;
        let body = rest[..end].trim();
        return (!body.is_empty()).then(|| body.to_string());
    }
    let mut lines = Vec::new();
    for line in trimmed.lines() {
        let text = line.trim();
        if text.is_empty() {
            continue;
        }
        match text.strip_prefix("--") {
            Some(comment) => lines.push(comment.trim().to_string()),
            None => break,
        }
    }
    (!lines.is_empty()).then(|| lines.join("\n"))
}

/// Whether `src` compiles as a sequence of Lua statements, without ever
/// running one of them: the source is written as an uncalled closure's body
/// (`local check = function() <src> end`), the same trick `preflight.rs`'s
/// `check_files_parse` already uses. Lua's parser has to read the whole
/// function body to compile the chunk at all, so a syntax error inside it
/// still surfaces, but nothing inside ever executes because `check` is never
/// invoked.
fn parses_as_block(lua: &SpringLua, src: &str) -> bool {
    let wrapped = format!("local check = function()\n{src}\nend\nreturn {{ ok = check ~= nil }}\n");
    lua.eval_value_raw(&wrapped, "decoded-block-check").is_ok()
}

/// Whether `src` is a plain Lua table literal safe to actually evaluate for
/// its data, rather than merely a syntax check. See this module's own doc
/// comment for why the `(` scan is the load-bearing part: a real data
/// literal never needs one, so its presence outside a string means a
/// function is being called or an expression is being grouped, and the
/// sandbox's own instruction cap does not rule out that call overallocating
/// (`coilbox-springlua`'s documented "no allocation cap" hole).
fn looks_like_a_plain_table(src: &str) -> bool {
    let trimmed = src.trim();
    if !trimmed.starts_with('{') || !trimmed.ends_with('}') {
        return false;
    }
    !blank_out_strings(trimmed).contains('(')
}

/// Replace the contents of every double-quoted string with spaces, so a
/// modder's own text (which may legally contain any character, `(` included)
/// is never mistaken for Lua syntax. Lua single-quoted and long-bracket
/// strings are not tracked, matching `bar_pack::minify_lua`'s own scope: this
/// crate never writes either, and neither is expected from a well-formed
/// data table produced the way this project's own compiler writes one.
fn blank_out_strings(src: &str) -> String {
    let mut out = String::with_capacity(src.len());
    let mut chars = src.chars().peekable();
    let mut in_string = false;
    while let Some(c) = chars.next() {
        if in_string {
            if c == '\\' {
                out.push(' ');
                if chars.next().is_some() {
                    out.push(' ');
                }
                continue;
            }
            if c == '"' {
                in_string = false;
                out.push('"');
                continue;
            }
            out.push(' ');
            continue;
        }
        if c == '"' {
            in_string = true;
        }
        out.push(c);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bar_pack;
    use crate::compile::{Chunk, LuaForm};

    fn lua() -> SpringLua {
        SpringLua::new(std::env::temp_dir()).expect("lua")
    }

    fn entries(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }

    // -- strip_bset_prefix / normalize_base64 -----------------------------

    #[test]
    fn a_bset_line_is_split_into_its_key_and_payload() {
        let (key, rest) = strip_bset_prefix("!bset tweakdefs3 abc123");
        assert_eq!(key.as_deref(), Some("tweakdefs3"));
        assert_eq!(rest, "abc123");
    }

    #[test]
    fn bare_base64_has_no_prefix_to_find() {
        let (key, rest) = strip_bset_prefix("abc123");
        assert_eq!(key, None);
        assert_eq!(rest, "abc123");
    }

    /// A real paste: padding a clipboard tool added back, and the line
    /// wrapped across two with a newline in the middle.
    #[test]
    fn padding_and_whitespace_survive_a_real_paste() {
        let clean = normalize_base64("abc123");
        let messy = normalize_base64("  abc\n123==  ");
        assert_eq!(clean, messy);
    }

    #[test]
    fn either_base64_alphabet_normalises_to_the_url_safe_one() {
        assert_eq!(normalize_base64("a+b/c"), "a-b_c");
        assert_eq!(normalize_base64("a-b_c"), "a-b_c");
    }

    // -- slot_kind_and_index ------------------------------------------------

    #[test]
    fn the_bare_key_is_slot_zero_and_a_numbered_one_counts_from_one() {
        assert_eq!(
            slot_kind_and_index("tweakdefs"),
            (SlotKind::Tweakdefs, Some(0))
        );
        assert_eq!(
            slot_kind_and_index("tweakdefs3"),
            (SlotKind::Tweakdefs, Some(3))
        );
        assert_eq!(
            slot_kind_and_index("tweakunits12"),
            (SlotKind::Tweakunits, Some(12))
        );
        assert_eq!(
            slot_kind_and_index("startpostype"),
            (SlotKind::Unknown, None)
        );
        assert_eq!(slot_kind_and_index("pasted"), (SlotKind::Unknown, None));
    }

    // -- leading_comment ------------------------------------------------

    #[test]
    fn a_block_comment_manifest_is_read_off_the_head() {
        let text = "--[[ Source: alpha.lua, beta.lua ]]\ndo x = 1 end";
        assert_eq!(
            leading_comment(text).as_deref(),
            Some("Source: alpha.lua, beta.lua")
        );
    }

    #[test]
    fn a_run_of_line_comments_is_joined() {
        let text = "-- Source: alpha.lua\n-- Source: beta.lua\ndo x = 1 end";
        assert_eq!(
            leading_comment(text).as_deref(),
            Some("Source: alpha.lua\nSource: beta.lua")
        );
    }

    #[test]
    fn no_leading_comment_is_none() {
        assert_eq!(leading_comment("do x = 1 end"), None);
    }

    // -- looks_like_a_plain_table ------------------------------------------

    #[test]
    fn a_plain_table_literal_is_recognised() {
        assert!(looks_like_a_plain_table(
            "{ [\"armcom\"] = { maxDamage = 9000 } }"
        ));
    }

    /// The load-bearing case: a table whose value is a function call, hidden
    /// behind a parenthesis, must never be evaluated for real.
    #[test]
    fn a_table_hiding_a_call_behind_a_paren_is_refused() {
        assert!(!looks_like_a_plain_table("{ x = (function() end)() }"));
        assert!(!looks_like_a_plain_table("{ x = string.rep(\"a\", 9) }"));
    }

    /// A parenthesis inside a modder's own string must not trip the guard: it
    /// is data, not syntax.
    #[test]
    fn a_paren_inside_a_string_is_not_mistaken_for_a_call() {
        assert!(looks_like_a_plain_table("{ x = \"(not a call)\" }"));
    }

    #[test]
    fn something_that_is_not_a_table_at_all_is_refused() {
        assert!(!looks_like_a_plain_table("do x = 1 end"));
        assert!(!looks_like_a_plain_table("SomeGlobal()"));
    }

    // -- decode_one: classification -----------------------------------------

    #[test]
    fn a_data_table_decodes_and_evaluates() {
        let payload = URL_SAFE_NO_PAD.encode("{ [\"armcom\"] = { maxDamage = 9000 } }");
        let slot = decode_one(&lua(), "tweakunits", &payload);
        assert_eq!(slot.form.as_deref(), Some("table"));
        assert!(slot.error.is_none());
        let table = slot.table.expect("table");
        assert_eq!(table["armcom"]["maxDamage"], serde_json::json!(9000));
    }

    #[test]
    fn a_block_decodes_but_is_never_evaluated() {
        let payload = URL_SAFE_NO_PAD
            .encode("-- Units switched off.\ndo\n  local off = { [\"armflash\"] = true }\nend");
        let slot = decode_one(&lua(), "tweakdefs", &payload);
        assert_eq!(slot.form.as_deref(), Some("block"));
        assert!(slot.table.is_none());
        assert!(slot.lua.is_some());
    }

    #[test]
    fn text_that_is_not_lua_at_all_is_unrecognised_not_an_error() {
        let payload = URL_SAFE_NO_PAD.encode("not lua at all {{{");
        let slot = decode_one(&lua(), "pasted", &payload);
        assert_eq!(slot.form.as_deref(), Some("unrecognised"));
        assert!(slot.error.is_none());
        assert!(slot.table.is_none());
    }

    #[test]
    fn a_bset_prefix_still_attached_is_stripped_and_the_key_recovered() {
        let payload = URL_SAFE_NO_PAD.encode("{ x = 1 }");
        let slot = decode_one(&lua(), "pasted", &format!("!bset tweakunits3 {payload}"));
        assert_eq!(slot.key, "tweakunits3");
        assert_eq!(slot.kind, SlotKind::Tweakunits);
        assert_eq!(slot.slot, Some(3));
        assert_eq!(slot.form.as_deref(), Some("table"));
    }

    #[test]
    fn an_oversized_payload_is_refused_before_touching_the_lua_vm() {
        let huge = "a".repeat(PAYLOAD_CAP + 1);
        let slot = decode_one(&lua(), "tweakdefs", &huge);
        assert!(slot.error.is_some());
        assert!(slot.lua.is_none());
    }

    #[test]
    fn invalid_base64_is_reported_rather_than_panicking() {
        let slot = decode_one(&lua(), "tweakdefs", "not-valid-base64-!!!");
        assert!(slot.error.is_some());
    }

    #[test]
    fn bytes_that_are_not_utf8_are_reported() {
        let payload = URL_SAFE_NO_PAD.encode([0xff, 0xfe, 0xfd]);
        let slot = decode_one(&lua(), "tweakdefs", &payload);
        assert!(slot.error.is_some());
    }

    // -- decode_many ----------------------------------------------------

    #[test]
    fn decode_many_buckets_by_kind_and_orders_by_slot() {
        let unit_payload = URL_SAFE_NO_PAD.encode("{ x = 1 }");
        let defs_payload = URL_SAFE_NO_PAD.encode("do x = 1 end");
        let set = decode_many(&entries(&[
            ("tweakunits", &unit_payload),
            ("tweakdefs2", &defs_payload),
            ("tweakdefs", &defs_payload),
            ("startpostype", "2"), // Not a tweak key: ignored.
        ]))
        .expect("decode");
        assert_eq!(set.tweakunits.len(), 1);
        assert_eq!(set.tweakdefs.len(), 2);
        assert_eq!(set.tweakdefs[0].key, "tweakdefs");
        assert_eq!(set.tweakdefs[1].key, "tweakdefs2");
        assert!(set.unrecognised.is_empty());
    }

    #[test]
    fn a_pasted_key_with_no_prefix_lands_in_unrecognised() {
        let payload = URL_SAFE_NO_PAD.encode("{ x = 1 }");
        let set = decode_many(&entries(&[("pasted", &payload)])).expect("decode");
        assert_eq!(set.unrecognised.len(), 1);
        assert_eq!(set.unrecognised[0].form.as_deref(), Some("table"));
    }

    /// The strongest test available: what `bar_pack::pack` produces for a
    /// real compiled project decodes back to the same Lua, with the same
    /// form the compiler wrote it in.
    #[test]
    fn a_bar_pack_line_decodes_back_to_the_same_lua_and_form() {
        let chunks = vec![
            Chunk {
                form: LuaForm::Table,
                title: "1 unit added".to_string(),
                reason: "test".to_string(),
                lua: "{\n  [\"supercom\"] = { maxDamage = 9000 },\n}".to_string(),
            },
            Chunk {
                form: LuaForm::Block,
                title: "1 unit switched off".to_string(),
                reason: "test".to_string(),
                lua: "-- Units switched off.\ndo\n  local off = { [\"armflash\"] = true }\nend"
                    .to_string(),
            },
        ];
        let pack = bar_pack::pack(&chunks);
        assert_eq!(pack.tweakunits.len(), 1);
        assert_eq!(pack.tweakdefs.len(), 1);

        let unit_slot = decode_one(&lua(), "pasted", &pack.tweakunits[0]);
        assert_eq!(unit_slot.kind, SlotKind::Tweakunits);
        assert_eq!(unit_slot.slot, Some(0));
        assert_eq!(unit_slot.form.as_deref(), Some("table"));
        assert_eq!(
            unit_slot.table.expect("table")["supercom"]["maxDamage"],
            serde_json::json!(9000)
        );

        let defs_slot = decode_one(&lua(), "pasted", &pack.tweakdefs[0]);
        assert_eq!(defs_slot.kind, SlotKind::Tweakdefs);
        assert_eq!(defs_slot.form.as_deref(), Some("block"));
        assert!(defs_slot.table.is_none());
        assert!(defs_slot
            .lua
            .expect("lua")
            .contains("local off = { [\"armflash\"] = true }"));
    }
}
