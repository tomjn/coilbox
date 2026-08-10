//! Why a sign-in did not produce a token.

/// Why a sign-in did not produce a token.
#[derive(Debug)]
pub enum AuthError {
    /// The service did not describe its sign-in: the document was missing,
    /// unreadable, or lacked something we need.
    Discovery(String),
    /// A request to the service failed before it could answer.
    Http(String),
    /// The loopback listener could not be bound or read.
    Listener(String),
    /// The browser came back to the callback without the parameters we need.
    BadCallback(String),
    /// The callback carried a `state` that was not the one we sent, so it did not
    /// come from the sign-in we started.
    StateMismatch,
    /// The authorization server redirected back with an error instead of a code,
    /// most often because the user cancelled.
    Denied {
        error: String,
        description: Option<String>,
    },
    /// Nobody hit the callback in time.
    TimedOut,
    /// The system browser would not open.
    Browser(String),
    /// The token endpoint answered with an OAuth error.
    Token {
        error: String,
        description: Option<String>,
    },
    /// The OS keychain refused to store or return the refresh token.
    Storage(String),
    /// There is no stored refresh token for this account, so the user has to sign
    /// in through the browser again.
    NotSignedIn,
    /// The service would not take the stored refresh token, so it is of no further
    /// use and the user has to sign in through the browser again.
    SignInRefused(String),
}

impl AuthError {
    /// Whether the only way past this failure is another trip through the browser.
    ///
    /// This is what separates a request worth retrying from one that never will
    /// be. A refresh grant is refused with an HTTP 400 and an OAuth error body,
    /// and RFC 6749 gives every one of those a cause the client cannot fix:
    /// the grant is expired, revoked, or was never ours. Teiserver flattens them
    /// all to `invalid_request`, so the error name is no help and the shape of
    /// the answer is what we go on.
    ///
    /// Everything else stays retryable. A server that is down, slow, or answering
    /// 5xx will work again on its own.
    pub fn needs_sign_in(&self) -> bool {
        matches!(
            self,
            Self::NotSignedIn | Self::SignInRefused(_) | Self::Token { .. }
        )
    }
}

impl std::fmt::Display for AuthError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Discovery(m) => write!(f, "the server did not describe its sign-in: {m}"),
            Self::Http(m) => write!(f, "could not reach the server: {m}"),
            Self::Listener(m) => write!(f, "could not listen for the browser: {m}"),
            Self::BadCallback(m) => write!(f, "the browser came back with {m}"),
            Self::StateMismatch => {
                write!(f, "the sign-in that came back was not the one we started")
            }
            Self::Denied { error, description } => match description {
                Some(d) => write!(f, "sign-in refused: {error}: {d}"),
                None => write!(f, "sign-in refused: {error}"),
            },
            Self::TimedOut => write!(f, "the sign-in was not finished in time"),
            Self::Browser(m) => write!(f, "could not open the browser: {m}"),
            Self::Token { error, description } => match description {
                Some(d) => write!(f, "the server refused the token request: {error}: {d}"),
                None => write!(f, "the server refused the token request: {error}"),
            },
            Self::Storage(m) => write!(f, "keychain error: {m}"),
            Self::NotSignedIn => write!(f, "not signed in to this server"),
            Self::SignInRefused(m) => {
                write!(f, "the server would not accept your sign-in: {m}")
            }
        }
    }
}
