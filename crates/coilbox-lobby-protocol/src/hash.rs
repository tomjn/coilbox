//! Password hashing for the lobby login handshake.
//!
//! The lobby protocol transmits the password as `BASE64(MD5(password))` — the
//! raw 16-byte MD5 digest, standard base64 encoded. This is not a security
//! measure (the server stores its own bcrypt), it is just the historic wire
//! format that every TASServer client uses.

use base64::Engine as _;
use md5::{Digest, Md5};

/// Compute the lobby password hash: `base64_standard(md5(password))`.
pub fn password_hash(pw: &str) -> String {
    let digest = Md5::digest(pw.as_bytes());
    base64::engine::general_purpose::STANDARD.encode(digest)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_vector_password() {
        // md5("password") = 5f4dcc3b5aa765d61d8327deb882cf99
        // base64 of those raw digest bytes:
        assert_eq!(password_hash("password"), "X03MO1qnZdYdgyfeuILPmQ==");
    }

    #[test]
    fn known_vector_empty() {
        // md5("") = d41d8cd98f00b204e9800998ecf8427e
        assert_eq!(password_hash(""), "1B2M2Y8AsgTpgAmY7PhCfg==");
    }
}
