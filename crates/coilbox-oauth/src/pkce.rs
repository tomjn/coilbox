//! The PKCE half of the flow, and the randomness `state` also comes from.

use base64::Engine as _;
use sha2::{Digest as _, Sha256};

use crate::AuthError;

/// A PKCE verifier and the challenge derived from it.
///
/// `Debug` is deliberately not derived. The verifier is the secret half.
pub struct Pkce {
    verifier: String,
    challenge: String,
}

impl Pkce {
    /// 32 bytes from the OS random source, base64url encoded to a 43 character
    /// verifier, which is the length RFC 7636 recommends.
    pub fn generate() -> Result<Self, AuthError> {
        let verifier = random_token(32)?;
        let challenge = challenge_for(&verifier);
        Ok(Self {
            verifier,
            challenge,
        })
    }

    /// The secret half, sent only to the token endpoint.
    pub fn verifier(&self) -> &str {
        &self.verifier
    }

    /// The public half, sent to the authorization endpoint.
    pub fn challenge(&self) -> &str {
        &self.challenge
    }
}

/// `base64url(sha256(verifier))` with no padding, which is the `S256` method.
pub fn challenge_for(verifier: &str) -> String {
    let digest = Sha256::digest(verifier.as_bytes());
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(digest)
}

/// `len` bytes from the OS random source, base64url encoded without padding.
/// `getrandom` reads the platform CSPRNG, so this is safe for a PKCE verifier and
/// for `state`.
pub fn random_token(len: usize) -> Result<String, AuthError> {
    let mut bytes = vec![0u8; len];
    getrandom::fill(&mut bytes)
        .map_err(|e| AuthError::Listener(format!("no random source: {e}")))?;
    Ok(base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The RFC 7636 appendix B vector. Self-consistency would not catch a base64
    /// alphabet or padding mistake, and this does.
    #[test]
    fn s256_challenge_matches_the_rfc_7636_vector() {
        assert_eq!(
            challenge_for("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }

    #[test]
    fn a_generated_verifier_is_43_characters_and_never_repeats() {
        let a = Pkce::generate().unwrap();
        let b = Pkce::generate().unwrap();
        assert_eq!(a.verifier().len(), 43);
        assert_ne!(a.verifier(), b.verifier());
        assert_eq!(a.challenge(), challenge_for(a.verifier()));
    }
}
