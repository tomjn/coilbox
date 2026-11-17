//! The facts the hub asks for before it accepts a map or game archive upload
//! (issue #5257), and the rules it checks them against.
//!
//! `POST /api/v1/uploads` takes these as its JSON body. The hub's own checks are
//! `UploadFacts::parse` and `ArchiveFilename::isValid` in coilbox-hub, and
//! [`UploadFacts::check`] repeats them, so a broken archive is explained inside
//! Coilbox in words a player can act on rather than arriving as a 400.
//!
//! This file holds the shape and the rules only. Reading the facts out of an
//! archive needs unitsync and lives in the worker binary's `upload_facts`
//! module.

use serde::{Deserialize, Serialize};

/// The hub refuses a body larger than this, in bytes.
pub const MAX_BODY_BYTES: usize = 16384;

/// Whether an archive is a map or a game.
#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum UploadKind {
    Map,
    Game,
}

/// One archive's facts, serialised exactly as the hub's upload body.
///
/// `None` fields serialise as `null` rather than being left out. The hub reads
/// either as absent.
#[derive(Serialize, Deserialize, Clone, PartialEq, Eq, Debug)]
pub struct UploadFacts {
    /// SHA-256 of the whole archive file, 64 lowercase hex characters.
    pub sha256: String,
    /// The file's size in bytes.
    pub size: u64,
    /// The archive's file name as it is on disk.
    pub filename: String,
    pub kind: UploadKind,
    /// A map's versioned name, or a game's archive name.
    pub internal_name: String,
    /// Empty is allowed, absent is not.
    pub version: String,
    /// Required for a game, always `None` for a map.
    pub shortname: Option<String>,
    pub author: Option<String>,
    pub description: Option<String>,
}

/// What the `--upload-facts` mode prints. Exactly one of `facts` and `problem`
/// is set. `problem` is a sentence for the person who asked, and `errors` is
/// unitsync's own diagnostics for the log.
#[derive(Serialize, Deserialize, Default, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct UploadFactsOutput {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub facts: Option<UploadFacts>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub problem: Option<String>,
    pub errors: Vec<String>,
}

impl UploadFacts {
    /// `Ok` when the hub would accept these facts, otherwise the first rule
    /// broken, as a sentence for the person who has to fix it.
    pub fn check(&self) -> Result<(), String> {
        if self.sha256.len() != 64
            || !self
                .sha256
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        {
            return Err("The archive's hash is not 64 lowercase hex characters.".into());
        }
        if self.size < 1 {
            return Err("The archive file is empty.".into());
        }
        // The hub's size is a JSON integer, which its PHP reads as a signed 64
        // bit number.
        if i64::try_from(self.size).is_err() {
            return Err("The archive file is too large for the hub to record.".into());
        }
        if let Err(why) = archive_filename_problem(&self.filename) {
            return Err(format!(
                "The hub would refuse the file name \"{}\": {why}.",
                self.filename
            ));
        }
        let internal_name = self.internal_name.trim();
        let what = match self.kind {
            UploadKind::Map => "map name",
            UploadKind::Game => "game's archive name",
        };
        if internal_name.is_empty() || internal_name.chars().count() > 256 {
            return Err(format!(
                "The {what} must be 1 to 256 characters, and this one is {}.",
                internal_name.chars().count()
            ));
        }
        if self.version.chars().count() > 256 {
            return Err(format!(
                "The version must be at most 256 characters, and this one is {}.",
                self.version.chars().count()
            ));
        }
        match (self.kind, self.shortname.as_deref()) {
            (UploadKind::Game, None | Some("")) => {
                return Err(
                    "This game's modinfo.lua has no shortname. The hub uses it to check \
                    who owns the game, so the game cannot be uploaded without one."
                        .into(),
                );
            }
            (_, Some(shortname)) if shortname.chars().count() > 64 => {
                return Err(format!(
                    "The game's shortname must be at most 64 characters, and this one is {}.",
                    shortname.chars().count()
                ));
            }
            (UploadKind::Map, Some("")) => {
                return Err("The shortname must be left out for a map or hold text.".into());
            }
            _ => {}
        }
        if let Some(author) = &self.author {
            if author.chars().count() > 256 {
                return Err(format!(
                    "The author must be at most 256 characters, and this one is {}.",
                    author.chars().count()
                ));
            }
        }
        if let Some(description) = &self.description {
            if description.chars().count() > 4000 {
                return Err(format!(
                    "The description must be at most 4000 characters, and this one is {}.",
                    description.chars().count()
                ));
            }
        }
        let body = serde_json::to_vec(self).map_err(|e| e.to_string())?;
        if body.len() > MAX_BODY_BYTES {
            return Err(format!(
                "These facts come to {} bytes and the hub takes at most {MAX_BODY_BYTES}. \
                 A shorter description or author would bring them under.",
                body.len()
            ));
        }
        Ok(())
    }
}

/// Why the hub would refuse `name` as an archive file name, or `Ok` when it
/// would not. The same test as coilbox-hub's `ArchiveFilename::isValid`: 1 to 255
/// bytes, no slash, backslash, control, format, line separator or paragraph
/// separator character, not starting with a dot, ending in `.sd7` or `.sdz` in
/// any case.
pub fn archive_filename_problem(name: &str) -> Result<(), &'static str> {
    if name.is_empty() || name.len() > 255 {
        return Err("it must be 1 to 255 bytes long");
    }
    if name
        .chars()
        .any(|c| c == '/' || c == '\\' || is_hidden_character(c))
    {
        return Err("it has a slash, a backslash or an invisible or control character in it");
    }
    if name.starts_with('.') {
        return Err("it starts with a dot");
    }
    let lower = name.to_lowercase();
    if !(lower.ends_with(".sd7") || lower.ends_with(".sdz")) {
        return Err("it must end in .sd7 or .sdz");
    }
    Ok(())
}

/// Unicode categories Cc, Cf, Zl and Zp, which the hub refuses in a file name.
///
/// Cf covers invisible format characters such as U+202E, which flips text so a
/// listing can show a fake extension. Rust's standard library knows Cc
/// (`is_control`) and no other category, so the Cf ranges are written out from
/// Unicode's own table.
fn is_hidden_character(c: char) -> bool {
    if c.is_control() || c == '\u{2028}' || c == '\u{2029}' {
        return true;
    }
    matches!(
        u32::from(c),
        0xAD | 0x600..=0x605
            | 0x61C
            | 0x6DD
            | 0x70F
            | 0x890..=0x891
            | 0x8E2
            | 0x180E
            | 0x200B..=0x200F
            | 0x202A..=0x202E
            | 0x2060..=0x2064
            | 0x2066..=0x206F
            | 0xFEFF
            | 0xFFF9..=0xFFFB
            | 0x110BD
            | 0x110CD
            | 0x13430..=0x1343F
            | 0x1BCA0..=0x1BCA3
            | 0x1D173..=0x1D17A
            | 0xE0001
            | 0xE0020..=0xE007F
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn a_map() -> UploadFacts {
        UploadFacts {
            sha256: "a".repeat(64),
            size: 1234,
            filename: "acidic_quarry_5.17.sd7".into(),
            kind: UploadKind::Map,
            internal_name: "Acidic Quarry 5.17".into(),
            version: "5.17".into(),
            shortname: None,
            author: Some("Someone".into()),
            description: Some("A quarry.".into()),
        }
    }

    fn a_game() -> UploadFacts {
        UploadFacts {
            kind: UploadKind::Game,
            filename: "splinterfaction.sdz".into(),
            internal_name: "Splinter Faction 1.2".into(),
            shortname: Some("SF".into()),
            author: None,
            description: None,
            ..a_map()
        }
    }

    fn refusal(facts: &UploadFacts) -> String {
        facts.check().expect_err("the facts should be refused")
    }

    #[test]
    fn a_map_and_a_game_with_every_fact_pass() {
        assert_eq!(a_map().check(), Ok(()));
        assert_eq!(a_game().check(), Ok(()));
    }

    #[test]
    fn a_map_with_no_version_passes_with_an_empty_one() {
        let map = UploadFacts {
            version: String::new(),
            ..a_map()
        };
        assert_eq!(map.check(), Ok(()));
    }

    #[test]
    fn the_body_is_the_hubs_field_names_with_nulls_kept() {
        let body = serde_json::to_value(a_map()).unwrap();
        assert_eq!(
            body,
            serde_json::json!({
                "sha256": "a".repeat(64),
                "size": 1234,
                "filename": "acidic_quarry_5.17.sd7",
                "kind": "map",
                "internal_name": "Acidic Quarry 5.17",
                "version": "5.17",
                "shortname": null,
                "author": "Someone",
                "description": "A quarry.",
            })
        );
    }

    #[test]
    fn a_game_with_no_shortname_says_what_the_hub_uses_it_for() {
        for shortname in [None, Some(String::new())] {
            let game = UploadFacts {
                shortname,
                ..a_game()
            };
            let said = refusal(&game);
            assert!(said.contains("no shortname"), "{said}");
            assert!(said.contains("owns the game"), "{said}");
        }
    }

    #[test]
    fn a_shortname_over_64_characters_is_refused_and_64_passes() {
        let long = UploadFacts {
            shortname: Some("s".repeat(65)),
            ..a_game()
        };
        assert!(refusal(&long).contains("at most 64"));
        let edge = UploadFacts {
            shortname: Some("s".repeat(64)),
            ..a_game()
        };
        assert_eq!(edge.check(), Ok(()));
    }

    #[test]
    fn a_description_over_4000_characters_is_counted_in_characters_not_bytes() {
        let long = UploadFacts {
            description: Some("x".repeat(4001)),
            ..a_map()
        };
        assert!(refusal(&long).contains("at most 4000"));
        // 4000 two byte characters is 8000 bytes and still allowed: the hub
        // counts characters.
        let edge = UploadFacts {
            description: Some("é".repeat(4000)),
            ..a_map()
        };
        assert_eq!(edge.check(), Ok(()));
    }

    #[test]
    fn an_author_or_version_or_name_over_256_characters_is_refused() {
        let author = UploadFacts {
            author: Some("a".repeat(257)),
            ..a_map()
        };
        assert!(refusal(&author).contains("author"));
        let version = UploadFacts {
            version: "1".repeat(257),
            ..a_map()
        };
        assert!(refusal(&version).contains("version"));
        let name = UploadFacts {
            internal_name: "n".repeat(257),
            ..a_map()
        };
        assert!(refusal(&name).contains("map name"));
    }

    #[test]
    fn a_name_that_is_blank_once_trimmed_is_refused() {
        let blank = UploadFacts {
            internal_name: "   ".into(),
            ..a_game()
        };
        assert!(refusal(&blank).contains("game's archive name"));
    }

    #[test]
    fn a_hash_that_is_not_lowercase_hex_is_refused() {
        for bad in [
            "A".repeat(64),
            "a".repeat(63),
            "g".repeat(64),
            String::new(),
        ] {
            let map = UploadFacts {
                sha256: bad,
                ..a_map()
            };
            assert!(refusal(&map).contains("hash"));
        }
    }

    #[test]
    fn an_empty_file_is_refused() {
        let map = UploadFacts { size: 0, ..a_map() };
        assert!(refusal(&map).contains("empty"));
    }

    #[test]
    fn facts_that_would_overflow_the_body_limit_are_refused() {
        // Both fields are within their own limits. A description of 4000
        // four byte characters is 16000 bytes and the rest tips it over.
        let map = UploadFacts {
            description: Some("\u{1F600}".repeat(4000)),
            author: Some("\u{1F600}".repeat(256)),
            ..a_map()
        };
        assert!(refusal(&map).contains("16384"));
    }

    #[test]
    fn a_file_name_the_hub_would_refuse_is_refused_here_first() {
        let refused = [
            "map.zip",
            "map",
            ".hidden.sd7",
            ".sd7",
            "dir/map.sd7",
            "dir\\map.sd7",
            "map\n.sd7",
            "map\u{202E}.sd7",
            "map\u{FEFF}.sd7",
            "map\u{2028}.sd7",
            "map\u{2029}.sd7",
            "map\u{7F}.sd7",
        ];
        for name in refused {
            let map = UploadFacts {
                filename: name.into(),
                ..a_map()
            };
            let said = refusal(&map);
            assert!(
                said.contains("The hub would refuse the file name"),
                "{name}"
            );
        }
        let too_long = format!("{}.sd7", "a".repeat(252));
        assert!(archive_filename_problem(&too_long).is_err());
        let longest = format!("{}.sd7", "a".repeat(251));
        assert_eq!(archive_filename_problem(&longest), Ok(()));
        assert_eq!(
            archive_filename_problem(""),
            Err("it must be 1 to 255 bytes long")
        );
    }

    #[test]
    fn the_extension_is_matched_in_any_case_and_a_short_name_is_fine() {
        for name in [
            "Map.SD7",
            "map.Sdz",
            "a.sd7",
            "über map (v2).sdz",
            "a b.sd7",
        ] {
            assert_eq!(archive_filename_problem(name), Ok(()), "{name}");
        }
    }

    #[test]
    fn a_name_in_the_hubs_own_refusal_list_stays_refused() {
        // Zero width space is Cf too: invisible, so it could hide a second
        // extension from a listing.
        assert!(archive_filename_problem("map\u{200B}.sd7").is_err());
        // A visible non ASCII letter is not.
        assert_eq!(archive_filename_problem("kärtchen.sd7"), Ok(()));
    }
}
