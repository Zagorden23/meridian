// Human-readable copy for every authentication outcome — shared by the auth
// screen and the in-app toasts. Pure and browser-safe.
//
// Rules: say what happened and what to do next; name the provider when we know
// it; never echo a raw code, a provider's own error string, or anything taken
// from the URL. Configuration detail (which variable is missing) is developer
// copy and only appears when the server says diagnostics are on.

export const PROVIDER_LABEL = {
  google: "Google",
  microsoft: "Microsoft",
  apple: "Apple",
  amazon: "Amazon",
  password: "Password",
  email: "Email code",
  phone: "Phone code",
};

const GENERIC = "Something went wrong. Please try again.";

// `{P}` is replaced with the provider's name ("Google"), or a neutral phrase.
const MESSAGES = {
  // OAuth
  OAUTH_CANCELLED: "{P} sign-in was cancelled.",
  OAUTH_STATE_INVALID: "That sign-in request expired. Please try again.",
  OAUTH_PROVIDER_UNCONFIGURED: "{P} sign-in isn't available right now.",
  OAUTH_EXCHANGE_FAILED: "{P} sign-in couldn't be completed. Please try again.",
  OAUTH_VERIFY_FAILED: "{P} sign-in couldn't be completed. Please try again.",
  OAUTH_FAILED: "{P} sign-in couldn't be completed. Please try again.",
  OAUTH_START_FAILED: "{P} sign-in couldn't be started. Please try again.",
  UNKNOWN_PROVIDER: "That sign-in method isn't supported.",
  // Accounts and linking
  ACCOUNT_LINK_REQUIRED: "An account already exists with this email. Sign in the way you did before, then connect {P} from Settings.",
  ACCOUNT_LINK_CONFLICT: "That {P} account is already connected to a different Meridian account.",
  PROVIDER_ALREADY_LINKED: "A different {P} account is already connected. Disconnect it first.",
  LAST_PROVIDER: "Keep at least one way to sign in.",
  ACCOUNT_DISABLED: "This account is disabled.",
  SESSION_REQUIRED: "Your session has ended. Please sign in again.",
  EMAIL_TAKEN: "An account with this email already exists. Sign in instead.",
  EMAIL_REQUIRED: "Add an email sign-in to this account before setting a password.",
  // Password
  INVALID_CREDENTIALS: "Incorrect email or password.",
  WEAK_PASSWORD: "Use a password with at least 8 characters.",
  PASSWORD_REQUIRED: "Enter your password.",
  CURRENT_PASSWORD_REQUIRED: "Enter your current password.",
  // One-time codes
  OTP_INVALID: "Incorrect code.",
  OTP_EXPIRED: "This code has expired. Request a new one.",
  OTP_LOCKED: "Too many incorrect attempts. Request a new code.",
  OTP_NOT_FOUND: "No active code. Request a new one first.",
  OTP_REQUIRED: "Enter the 6-digit code.",
  OTP_RESEND_COOLDOWN: "Please wait a moment before requesting a new code.",
  EMAIL_SEND_FAILED: "The email couldn't be sent. Please try again shortly.",
  SMS_SEND_FAILED: "The text message couldn't be sent. Please try again shortly.",
  EMAIL_PROVIDER_UNCONFIGURED: "Email codes aren't available right now.",
  SMS_PROVIDER_UNCONFIGURED: "Text message codes aren't available right now.",
  // Input and limits
  INVALID_EMAIL: "Enter a valid email address.",
  INVALID_PHONE: "Enter a valid phone number, including the country code.",
  RATE_LIMITED: "Too many attempts. Please wait a little and try again.",
  // Service
  MONGO_UNCONFIGURED: "Accounts aren't available right now.",
  SESSION_SECRET_MISSING: "Sign-in isn't available right now.",
};

// Developer-facing detail, appended only when diagnostics are on.
const DIAGNOSTICS = {
  OAUTH_PROVIDER_UNCONFIGURED: "Its credentials are not set on the server — open the provider's setup steps below.",
  OAUTH_EXCHANGE_FAILED: "Check that this app's callback URL is registered in the provider console and that the client secret is current.",
  OAUTH_VERIFY_FAILED: "The provider's ID token failed verification (issuer, audience, signature or nonce) — see the server log.",
  EMAIL_PROVIDER_UNCONFIGURED: "Set EMAIL_PROVIDER_KEY and EMAIL_FROM on the server.",
  SMS_PROVIDER_UNCONFIGURED: "Set SMS_PROVIDER_KEY, SMS_PROVIDER_SECRET and SMS_FROM on the server.",
  MONGO_UNCONFIGURED: "Set MONGODB_URI on the server.",
  SESSION_SECRET_MISSING: "Set SESSION_SECRET (32+ random characters) on the server and restart.",
};

// The server's own wording carries detail the table cannot (attempts left,
// seconds to wait), and it is written for people.
const PREFER_SERVER_MESSAGE = new Set(["OTP_INVALID", "OTP_RESEND_COOLDOWN"]);

function fill(template, provider) {
  const label = PROVIDER_LABEL[provider];
  if (label) return template.replaceAll("{P}", label);
  // No provider known: read naturally without one.
  return template
    .replace("{P} sign-in", "Sign-in")
    .replace("That {P} account", "That account")
    .replace("A different {P} account", "A different account")
    .replace("connect {P} from", "connect the new one from");
}

/**
 * Message for an error code that arrived without a server message — e.g. in
 * the URL after an OAuth redirect. Unknown codes get a generic line: text from
 * the address bar is never reflected into the page.
 */
export function authErrorMessage(code, { provider = null, diagnostics = false } = {}) {
  const template = MESSAGES[code];
  if (!template) return GENERIC;
  const base = fill(template, provider);
  return diagnostics && DIAGNOSTICS[code] ? `${base} ${DIAGNOSTICS[code]}` : base;
}

/** Message for an error thrown by the API client (`{ code, status, message }`). */
export function apiErrorMessage(err, { provider = null, diagnostics = false } = {}) {
  const code = err?.code;
  if (PREFER_SERVER_MESSAGE.has(code) && err?.message) return err.message;
  if (MESSAGES[code]) return authErrorMessage(code, { provider, diagnostics });
  // Our own 4xx messages are user-facing; anything else stays generic.
  if (err?.status >= 400 && err?.status < 500 && err?.message) return err.message;
  return GENERIC;
}
