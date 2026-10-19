//! The error a Rust command reports to the frontend (issue #4595).
//!
//! A command that returns `Result<_, String>` can return a [`UiError`] with no
//! signature change, because `String: From<UiError>` writes it as JSON. The
//! frontend's `parseUiError` reads that JSON back, looks the `code` up in its
//! message table and fills in `params`. A code the table does not know shows
//! `fallback`, which is the English text the command produced before it
//! migrated, so a crate can move over one message at a time.

use serde::{Deserialize, Serialize};
use std::borrow::Cow;
use std::collections::BTreeMap;
use std::fmt;

/// A stable code, the values to put in the translated message, and the English
/// text to show when the frontend has no message for the code.
///
/// `code` is a [`Cow`] so it can be a `&'static str` constant when raised and an
/// owned string when [`UiError::parse`] reads it back.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct UiError {
    pub code: Cow<'static, str>,
    #[serde(default)]
    pub params: BTreeMap<String, String>,
    pub fallback: String,
}

impl UiError {
    pub fn new(code: &'static str, fallback: impl Into<String>) -> Self {
        Self {
            code: Cow::Borrowed(code),
            params: BTreeMap::new(),
            fallback: fallback.into(),
        }
    }

    /// Add a value the translated message interpolates.
    pub fn param(mut self, name: impl Into<String>, value: impl ToString) -> Self {
        self.params.insert(name.into(), value.to_string());
        self
    }

    /// Read the string form back. `None` for plain text, and for JSON that is
    /// not a `UiError`.
    pub fn parse(message: &str) -> Option<Self> {
        serde_json::from_str(message).ok()
    }
}

/// The fallback, so a `UiError` prints as the English text in logs and tests.
impl fmt::Display for UiError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.fallback)
    }
}

impl std::error::Error for UiError {}

impl From<UiError> for String {
    fn from(error: UiError) -> String {
        // Three string fields and a string map always serialise.
        serde_json::to_string(&error).unwrap_or(error.fallback)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_through_a_string() {
        let error =
            UiError::new("test.exists", "/tmp/a.sdd already exists").param("path", "/tmp/a.sdd");
        let text: String = error.clone().into();
        assert_eq!(UiError::parse(&text), Some(error));
    }

    #[test]
    fn serialises_the_three_fields() {
        let text: String = UiError::new("test.code", "English").param("n", 3).into();
        assert_eq!(
            text,
            r#"{"code":"test.code","params":{"n":"3"},"fallback":"English"}"#
        );
    }

    #[test]
    fn plain_text_and_other_json_are_not_a_ui_error() {
        assert_eq!(UiError::parse("could not write the file"), None);
        assert_eq!(UiError::parse(r#"{"error":"x"}"#), None);
    }

    #[test]
    fn displays_as_the_fallback() {
        assert_eq!(UiError::new("test.code", "English").to_string(), "English");
    }
}
