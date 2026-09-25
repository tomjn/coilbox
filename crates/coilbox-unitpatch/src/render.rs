//! Writing a [`Value`] as Lua source.

use crate::{TableKey, Value};

/// How the string being replaced was quoted, so a replacement keeps it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Quote {
    Double,
    Single,
    /// `[[...]]`, with this many `=` between the brackets.
    Long(usize),
}

/// `value` as a Lua literal. A string uses `quote` where the string can be
/// written that way, and double quotes otherwise. A table is written as
/// [`value`] writes it with the file's style unknown.
pub fn literal(value: &Value, quote: Quote) -> String {
    match value {
        Value::Bool(true) => "true".into(),
        Value::Bool(false) => "false".into(),
        Value::Number(number) => number_literal(*number),
        Value::String(text) => string_literal(text, quote),
        Value::Table(_) => self::value(
            value,
            &Style {
                quote,
                ..Style::default()
            },
            "",
        ),
    }
}

/// How a file writes its tables, so a table written into it looks like the
/// rest of it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Style {
    pub newline: &'static str,
    /// One level of indentation.
    pub step: String,
    /// `,` or `;`, written after every entry.
    pub separator: String,
    pub quote: Quote,
    /// Whether lists are written `[1] = x` rather than as bare values.
    pub numbered: bool,
    /// Whether keys are written `["name"] = x` rather than `name = x`.
    pub bracketed: bool,
}

impl Default for Style {
    fn default() -> Self {
        Self {
            newline: "\n",
            step: "\t".into(),
            separator: ",".into(),
            quote: Quote::Double,
            numbered: false,
            bracketed: false,
        }
    }
}

/// `value` as Lua source in `style`. A table that is not empty is written one
/// entry per line, each a step deeper than `indent`, the indentation of the
/// line the table starts on, and its closing brace back at `indent`. Entries
/// go in the order the table holds them.
pub fn value(value: &Value, style: &Style, indent: &str) -> String {
    let Value::Table(entries) = value else {
        return literal(value, style.quote);
    };
    if entries.is_empty() {
        return "{}".into();
    }
    // Bare values only for a plain list numbered 1 to n, since a bare value
    // anywhere else would take a position the table does not mean.
    let bare_list = !style.numbered
        && entries
            .iter()
            .enumerate()
            .all(|(at, (k, _))| *k == TableKey::Index(at + 1));
    let inner = format!("{indent}{}", style.step);
    let mut out = String::from("{");
    for (k, item) in entries {
        out.push_str(style.newline);
        out.push_str(&inner);
        match k {
            TableKey::Name(name) => {
                out.push_str(&key(name, style.bracketed));
                out.push_str(" = ");
            }
            TableKey::Index(_) if bare_list => {}
            TableKey::Index(index) => out.push_str(&format!("[{index}] = ")),
        }
        out.push_str(&self::value(item, style, &inner));
        out.push_str(&style.separator);
    }
    out.push_str(style.newline);
    out.push_str(indent);
    out.push('}');
    out
}

fn number_literal(number: f64) -> String {
    // Below 2^53 every whole number is exact, and printing it without a
    // fraction keeps `320` from becoming `320.0` in someone's file.
    if number.fract() == 0.0 && number.abs() < 9_007_199_254_740_992.0 {
        format!("{}", number as i64)
    } else {
        // Rust prints the shortest text that reads back as the same double,
        // and never in a form Lua cannot read.
        format!("{number}")
    }
}

fn string_literal(text: &str, quote: Quote) -> String {
    match quote {
        Quote::Long(level) => {
            let equals = "=".repeat(level);
            let close = format!("]{equals}]");
            // Lua drops a newline straight after the opening bracket, and the
            // closing bracket would end the string early.
            if text.contains(&close) || text.starts_with('\n') || text.starts_with('\r') {
                quoted(text, '"')
            } else {
                format!("[{equals}[{text}{close}")
            }
        }
        Quote::Single => quoted(text, '\''),
        Quote::Double => quoted(text, '"'),
    }
}

fn quoted(text: &str, quote: char) -> String {
    let mut out = String::with_capacity(text.len() + 2);
    out.push(quote);
    for c in text.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if c == quote => {
                out.push('\\');
                out.push(c);
            }
            // Lua 5.1 has no `\x` escape, only decimal.
            c if (c as u32) < 0x20 || c as u32 == 0x7f => {
                out.push_str(&format!("\\{:03}", c as u32));
            }
            c => out.push(c),
        }
    }
    out.push(quote);
    out
}

/// Whether `key` can be written bare, as in `metalcost = 320`.
pub fn is_identifier(key: &str) -> bool {
    const KEYWORDS: &[&str] = &[
        "and", "break", "do", "else", "elseif", "end", "false", "for", "function", "if", "in",
        "local", "nil", "not", "or", "repeat", "return", "then", "true", "until", "while",
    ];
    let mut chars = key.chars();
    let starts_well = chars
        .next()
        .is_some_and(|c| c.is_ascii_alphabetic() || c == '_');
    starts_well && chars.all(|c| c.is_ascii_alphanumeric() || c == '_') && !KEYWORDS.contains(&key)
}

/// `key` as the left side of a table field: bare where it can be, bracketed
/// and quoted where it cannot.
pub fn key(key: &str, bracketed: bool) -> String {
    if !bracketed && is_identifier(key) {
        key.to_string()
    } else {
        format!("[{}]", quoted(key, '"'))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numbers_keep_whole_numbers_whole() {
        assert_eq!(literal(&Value::Number(320.0), Quote::Double), "320");
        assert_eq!(literal(&Value::Number(-4.0), Quote::Double), "-4");
        assert_eq!(literal(&Value::Number(0.9), Quote::Double), "0.9");
        assert_eq!(literal(&Value::Number(1e-7), Quote::Double), "0.0000001");
    }

    #[test]
    fn strings_keep_their_quote_style_when_they_can() {
        let value = Value::String("Heavy BRV".into());
        assert_eq!(literal(&value, Quote::Single), "'Heavy BRV'");
        assert_eq!(literal(&value, Quote::Long(0)), "[[Heavy BRV]]");
        assert_eq!(literal(&value, Quote::Long(1)), "[=[Heavy BRV]=]");
        let awkward = Value::String("a]]b".into());
        assert_eq!(literal(&awkward, Quote::Long(0)), "\"a]]b\"");
        assert_eq!(literal(&awkward, Quote::Long(1)), "[=[a]]b]=]");
    }

    #[test]
    fn strings_escape_what_lua_needs() {
        let value = Value::String("say \"hi\"\n\\ \u{1}".into());
        assert_eq!(
            literal(&value, Quote::Double),
            "\"say \\\"hi\\\"\\n\\\\ \\001\""
        );
        assert_eq!(
            literal(&Value::String("it's".into()), Quote::Single),
            "'it\\'s'"
        );
    }

    fn weapon() -> Value {
        Value::from_json(&serde_json::json!({
            "range": 300,
            "damage": { "default": 100, "vtol": 5 },
            "WeaponType": "LaserCannon",
            "sweepfire": false,
            "list": ["a", "b"],
            "gap": { "1": "x", "3": "y" },
            "empty": {},
        }))
        .expect("a table")
    }

    #[test]
    fn a_table_is_written_one_entry_per_line_in_a_fixed_order() {
        let style = Style {
            step: "  ".into(),
            ..Style::default()
        };
        assert_eq!(
            value(&weapon(), &style, "  "),
            "{\n    damage = {\n      default = 100,\n      vtol = 5,\n    },\n    empty = {},\n    gap = {\n      [1] = \"x\",\n      [3] = \"y\",\n    },\n    list = {\n      \"a\",\n      \"b\",\n    },\n    range = 300,\n    sweepfire = false,\n    WeaponType = \"LaserCannon\",\n  }"
        );
    }

    #[test]
    fn a_table_follows_the_files_separators_quotes_lists_keys_and_line_endings() {
        let style = Style {
            newline: "\r\n",
            step: "\t".into(),
            separator: ";".into(),
            quote: Quote::Single,
            numbered: true,
            bracketed: true,
        };
        let list = Value::from_json(&serde_json::json!({ "l": ["a"] })).expect("a table");
        assert_eq!(
            value(&list, &style, ""),
            "{\r\n\t[\"l\"] = {\r\n\t\t[1] = 'a';\r\n\t};\r\n}"
        );
    }

    #[test]
    fn keys_the_engine_reads_as_one_are_refused() {
        let both = serde_json::json!({ "range": 1, "Range": 2 });
        assert!(Value::from_json(&both).is_err());
    }

    #[test]
    fn keys_are_bare_only_when_lua_allows() {
        assert_eq!(key("metalcost", false), "metalcost");
        assert_eq!(key("end", false), "[\"end\"]");
        assert_eq!(key("has space", false), "[\"has space\"]");
        assert_eq!(key("metalcost", true), "[\"metalcost\"]");
    }
}
