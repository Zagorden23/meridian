// Commercial first-party authentication forms:
// 1. PasswordForm — Sign up (Full Name, Email, Password w/ strength + Confirm, Email OTP verification),
//    Sign in (Password, unverified email OTP rescue), and inline Forgot/Reset password.
// 2. EmailCodeForm — Passwordless Email + 6-digit OTP sign-in/up with countdown + auto-submit.
// 3. PhoneCodeForm — International country dial selector (40+ countries) + E.164 SMS 6-digit OTP.
import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Eye, EyeOff, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/meridian/api-client.js";
import { apiErrorMessage, authErrorMessage } from "@/lib/meridian/auth-messages.js";
import { COUNTRY_CODES } from "@/lib/meridian/country-codes.js";
import { cn } from "@/lib/utils";

const INPUT = "h-11 w-full rounded-xl bg-surface-raised/70 px-3.5 text-sm text-fg outline-none transition-shadow duration-150 placeholder:text-subtle focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50";
const validEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v ?? "").trim());

function formatTimer(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${String(rem).padStart(2, "0")}`;
}

function passwordStrength(pw) {
  const val = String(pw ?? "");
  if (!val) return { level: 0, label: "" };
  let score = 0;
  if (val.length >= 8) score += 1;
  if (val.length >= 12) score += 1;
  if (/[a-z]/.test(val) && /[A-Z]/.test(val)) score += 1;
  if (/\d/.test(val) || /[^A-Za-z0-9]/.test(val)) score += 1;
  if (val.length < 8) return { level: 1, label: "Too short (min 8 chars)" };
  if (score <= 2) return { level: 2, label: "Fair" };
  return { level: 3, label: score >= 4 ? "Strong" : "Good" };
}

function Field({ label, optional, hint, right, children }) {
  return (
    <label className="block text-xs text-muted">
      <span className="flex items-center justify-between gap-2">
        <span>
          {label}
          {optional && <span className="text-subtle"> (optional)</span>}
        </span>
        {right}
      </span>
      <span className="mt-1.5 block">{children}</span>
      {hint && <span className="mt-1 block text-[11px] text-subtle">{hint}</span>}
    </label>
  );
}

function FormError({ message }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-xl border border-white/10 bg-surface-raised/80 px-3 py-2 text-sm text-fg/95">
      {message}
    </p>
  );
}

function Unavailable({ message }) {
  if (!message) return null;
  return <p className="text-xs leading-relaxed text-subtle">{message}</p>;
}

function SandboxNote({ show, channel }) {
  if (!show) return null;
  return (
    <p className="rounded-xl border border-border/80 bg-surface-raised/40 px-3 py-2 text-[11px] leading-relaxed text-muted">
      Local dev mode: verification {channel === "phone" ? "SMS" : "email"} codes are printed in the server log and previewed cleanly at the code step until live {channel === "phone" ? "Twilio" : "Resend"} keys are configured.
    </p>
  );
}

function DevCodePreview({ devCode, onFill, disabled }) {
  if (!devCode) return null;
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface-raised/60 px-3 py-2 text-xs">
      <div className="min-w-0">
        <p className="text-[11px] uppercase tracking-label text-subtle">Dev preview code</p>
        <p className="font-mono text-sm font-semibold tracking-widest text-fg">{devCode}</p>
      </div>
      {onFill && (
        <button
          type="button"
          onClick={() => onFill(devCode)}
          disabled={disabled}
          className="shrink-0 rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-fg transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40"
        >
          Use code
        </button>
      )}
    </div>
  );
}

function SubmitButton({ pending, pendingLabel, disabled, children }) {
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      aria-busy={pending}
      className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-accent px-3 text-sm font-semibold text-accent-fg transition-[opacity,transform] duration-150 hover:opacity-90 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:opacity-40 disabled:active:scale-100"
    >
      {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {pending ? pendingLabel : children}
    </button>
  );
}

function NameField({ value, onChange, disabled, label = "Full name" }) {
  return (
    <Field label={label} optional>
      <input
        name="name"
        autoComplete="name"
        value={value}
        disabled={disabled}
        maxLength={120}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Ada Lovelace"
        className={INPUT}
      />
    </Field>
  );
}

function PasswordInput({
  value,
  onChange,
  disabled,
  name = "password",
  autoComplete = "current-password",
  placeholder = "Your password",
  show,
  onToggleShow,
  ariaLabel,
}) {
  return (
    <span className="relative block">
      <input
        type={show ? "text" : "password"}
        name={name}
        autoComplete={autoComplete}
        value={value}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(INPUT, "pr-11")}
      />
      <button
        type="button"
        onClick={onToggleShow}
        aria-label={show ? "Hide password" : "Show password"}
        aria-pressed={show}
        className="absolute right-1.5 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-lg text-subtle transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        {show ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
      </button>
    </span>
  );
}

function StrengthMeter({ password }) {
  const { level, label } = passwordStrength(password);
  if (!password) return null;
  return (
    <div className="space-y-1">
      <div className="grid grid-cols-3 gap-1.5" aria-hidden>
        {[1, 2, 3].map((step) => (
          <span
            key={step}
            className={cn(
              "h-1 rounded-full transition-colors duration-150",
              level >= step
                ? level === 1 ? "bg-muted" : level === 2 ? "bg-fg/75" : "bg-accent"
                : "bg-white/10",
            )}
          />
        ))}
      </div>
      <p className="text-[11px] text-subtle">Password strength: <span className="text-muted">{label}</span></p>
    </div>
  );
}

export function OtpBoxes({ value, onChange, disabled, autoFocus }) {
  const refs = useRef([]);
  useEffect(() => {
    if (autoFocus) refs.current[0]?.focus();
  }, [autoFocus]);

  const set = (i, raw) => {
    const digits = raw.replace(/\D/g, "");
    if (digits.length > 1) {
      const merged = (value.slice(0, i) + digits).slice(0, 6);
      onChange(merged);
      refs.current[Math.min(merged.length, 5)]?.focus();
      return;
    }
    const next = Array.from({ length: 6 }, (_, idx) => (idx === i ? digits : (value[idx] ?? "")));
    onChange(next.join(""));
    if (digits && i < 5) refs.current[i + 1]?.focus();
  };

  return (
    <fieldset>
      <legend className="text-xs text-muted">Verification code</legend>
      <div className="mt-1.5 grid grid-cols-6 gap-2">
        {Array.from({ length: 6 }, (_, i) => (
          <input
            key={i}
            ref={(el) => { refs.current[i] = el; }}
            value={value[i] ?? ""}
            disabled={disabled}
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete={i === 0 ? "one-time-code" : "off"}
            aria-label={`Digit ${i + 1} of 6`}
            onChange={(e) => set(i, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Backspace" && !value[i] && i > 0) refs.current[i - 1]?.focus();
              if (e.key === "ArrowLeft" && i > 0) refs.current[i - 1]?.focus();
              if (e.key === "ArrowRight" && i < 5) refs.current[i + 1]?.focus();
            }}
            onPaste={(e) => {
              e.preventDefault();
              const digits = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
              if (digits) {
                onChange(digits);
                refs.current[Math.min(digits.length, 5)]?.focus();
              }
            }}
            className="h-12 w-full rounded-xl bg-surface-raised/70 text-center text-lg tabular-nums outline-none transition-shadow duration-150 focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40"
          />
        ))}
      </div>
    </fieldset>
  );
}

/** Shared request → code → verify state with expiry countdown + resend cooldown. */
function useCodeFlow({ request, verify, diagnostics, sentMessage, onDone }) {
  const [sent, setSent] = useState(false);
  const [code, setCodeState] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const [expiresIn, setExpiresIn] = useState(0);
  const [devCode, setDevCode] = useState("");
  const autoVerifyCodeRef = useRef("");

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  useEffect(() => {
    if (!sent || expiresIn <= 0) return undefined;
    const t = setTimeout(() => setExpiresIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [sent, expiresIn]);

  const setCode = useCallback((next) => {
    const clean = String(next ?? "").replace(/\D/g, "").slice(0, 6);
    if (clean.length < 6) autoVerifyCodeRef.current = "";
    setCodeState(clean);
  }, []);

  const adoptChallenge = useCallback((info = {}) => {
    setSent(true);
    setCodeState("");
    autoVerifyCodeRef.current = "";
    setError("");
    setCooldown(info.resendInSeconds ?? 60);
    setExpiresIn(info.expiresInSeconds ?? 300);
    setDevCode(info.devCode ?? "");
  }, []);

  const send = useCallback(async () => {
    setError("");
    setPending(true);
    try {
      const res = await request();
      adoptChallenge(res?.data ?? {});
      if (sentMessage) toast.success(sentMessage);
    } catch (err) {
      setError(apiErrorMessage(err, { diagnostics }));
    } finally {
      setPending(false);
    }
  }, [request, adoptChallenge, sentMessage, diagnostics]);

  const confirm = useCallback(async (doneCb = onDone, overrideCode = null) => {
    const targetCode = overrideCode ?? code;
    if (targetCode.length !== 6) return;
    setError("");
    setPending(true);
    try {
      const res = await verify(targetCode);
      doneCb?.(res.data);
    } catch (err) {
      setError(apiErrorMessage(err, { diagnostics }));
      if (err?.code === "OTP_LOCKED" || err?.code === "OTP_EXPIRED" || err?.code === "OTP_NOT_FOUND") {
        setCodeState("");
        autoVerifyCodeRef.current = "";
      }
    } finally {
      setPending(false);
    }
  }, [code, verify, onDone, diagnostics]);

  useEffect(() => {
    if (!sent || pending || code.length !== 6 || error || !onDone) return;
    if (autoVerifyCodeRef.current === code) return;
    autoVerifyCodeRef.current = code;
    confirm(onDone, code);
  }, [sent, pending, code, error, onDone, confirm]);

  const fillDevCode = useCallback((sample) => {
    autoVerifyCodeRef.current = "";
    setError("");
    setCodeState(sample);
  }, []);

  const restart = useCallback(() => {
    setSent(false);
    setCodeState("");
    setError("");
    setDevCode("");
    setExpiresIn(0);
    autoVerifyCodeRef.current = "";
  }, []);

  return {
    sent,
    code,
    setCode,
    pending,
    error,
    setError,
    cooldown,
    expiresIn,
    devCode,
    send,
    confirm,
    adoptChallenge,
    fillDevCode,
    restart,
  };
}

function CodeStep({ flow, destination, submitLabel, backLabel }) {
  return (
    <>
      <div className="flex items-start justify-between gap-2 text-xs leading-relaxed text-muted">
        <p>
          We sent a 6-digit code to <span className="font-medium text-fg">{destination}</span>.
        </p>
        <span className="shrink-0 tabular-nums text-subtle">
          {flow.expiresIn > 0 ? `Expires in ${formatTimer(flow.expiresIn)}` : "Code expired"}
        </span>
      </div>
      <OtpBoxes value={flow.code} onChange={flow.setCode} disabled={flow.pending} autoFocus />
      <DevCodePreview devCode={flow.devCode} onFill={flow.fillDevCode} disabled={flow.pending} />
      <FormError message={flow.error} />
      <SubmitButton pending={flow.pending} pendingLabel="Verifying…" disabled={flow.code.length !== 6}>
        {submitLabel}
      </SubmitButton>
      <div className="flex items-center justify-between text-xs text-subtle">
        <button
          type="button"
          onClick={flow.restart}
          disabled={flow.pending}
          className="rounded underline-offset-2 hover:text-fg hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40"
        >
          {backLabel}
        </button>
        <button
          type="button"
          onClick={flow.send}
          disabled={flow.pending || flow.cooldown > 0}
          className="rounded underline-offset-2 hover:text-fg hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40 disabled:hover:no-underline"
        >
          {flow.cooldown > 0 ? `Resend in ${flow.cooldown}s` : "Resend code"}
        </button>
      </div>
    </>
  );
}

export function EmailCodeForm({ mode, email, onEmail, disabled, unavailable, sandbox, diagnostics, onDone }) {
  const [name, setName] = useState("");
  const flow = useCodeFlow({
    request: () => api.requestEmailOtp(email.trim()),
    verify: (code) => api.verifyEmailOtp(email.trim(), code, mode === "signup" ? name.trim() || undefined : undefined),
    diagnostics,
    sentMessage: "Verification code sent to your email.",
    onDone,
  });

  const submit = (e) => {
    e.preventDefault();
    if (flow.sent) {
      flow.confirm(onDone);
      return;
    }
    if (!validEmail(email)) {
      flow.setError(authErrorMessage("INVALID_EMAIL"));
      return;
    }
    flow.send();
  };

  const locked = disabled || flow.pending;
  return (
    <form onSubmit={submit} noValidate className="space-y-3.5">
      {flow.sent ? (
        <CodeStep
          flow={flow}
          destination={email.trim()}
          submitLabel={mode === "signup" ? "Verify & create account" : "Verify & sign in"}
          backLabel="Use a different email"
        />
      ) : (
        <>
          <Unavailable message={unavailable} />
          <Field label="Email address">
            <input
              type="email"
              name="email"
              autoComplete="email"
              inputMode="email"
              value={email}
              disabled={locked}
              onChange={(e) => onEmail(e.target.value)}
              placeholder="you@example.com"
              className={INPUT}
            />
          </Field>
          {mode === "signup" && <NameField value={name} onChange={setName} disabled={locked} />}
          <SandboxNote show={sandbox && !unavailable} channel="email" />
          <FormError message={flow.error} />
          <SubmitButton pending={flow.pending} pendingLabel="Sending code…" disabled={disabled || Boolean(unavailable)}>
            {mode === "signup" ? "Send verification code" : "Continue with Email code"}
          </SubmitButton>
        </>
      )}
    </form>
  );
}

export function PhoneCodeForm({ mode, disabled, unavailable, sandbox, diagnostics, onDone }) {
  const [cc, setCc] = useState("+1");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const flow = useCodeFlow({
    request: () => api.requestPhoneOtp(phone, cc),
    verify: (code) => api.verifyPhoneOtp(phone, cc, code, mode === "signup" ? name.trim() || undefined : undefined),
    diagnostics,
    sentMessage: "Verification code sent by SMS.",
    onDone,
  });

  const submit = (e) => {
    e.preventDefault();
    if (flow.sent) {
      flow.confirm(onDone);
      return;
    }
    if (phone.replace(/\D/g, "").length < 6) {
      flow.setError(authErrorMessage("INVALID_PHONE"));
      return;
    }
    flow.send();
  };

  const locked = disabled || flow.pending;
  return (
    <form onSubmit={submit} noValidate className="space-y-3.5">
      {flow.sent ? (
        <CodeStep
          flow={flow}
          destination={`${cc} ${phone.trim()}`}
          submitLabel={mode === "signup" ? "Verify & create account" : "Verify & sign in"}
          backLabel="Use a different number"
        />
      ) : (
        <>
          <Unavailable message={unavailable} />
          <div className="flex gap-2">
            <div className="w-32 shrink-0 sm:w-36">
              <Field label="Country">
                <select
                  name="countryCode"
                  aria-label="Country dial code"
                  autoComplete="tel-country-code"
                  value={cc}
                  disabled={locked}
                  onChange={(e) => setCc(e.target.value)}
                  className={cn(INPUT, "px-2.5")}
                >
                  {COUNTRY_CODES.map((c) => (
                    <option key={`${c.code}-${c.name}`} value={c.code}>
                      {c.code} · {c.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="min-w-0 flex-1">
              <Field label="Phone number">
                <input
                  type="tel"
                  name="phone"
                  autoComplete="tel-national"
                  inputMode="tel"
                  value={phone}
                  disabled={locked}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="415 555 0199"
                  className={INPUT}
                />
              </Field>
            </div>
          </div>
          {mode === "signup" && <NameField value={name} onChange={setName} disabled={locked} />}
          <SandboxNote show={sandbox && !unavailable} channel="phone" />
          <FormError message={flow.error} />
          <SubmitButton pending={flow.pending} pendingLabel="Sending SMS…" disabled={disabled || Boolean(unavailable)}>
            {mode === "signup" ? "Send verification code" : "Continue with Phone"}
          </SubmitButton>
        </>
      )}
    </form>
  );
}

export function PasswordForm({
  mode,
  email,
  onEmail,
  disabled,
  unavailable,
  diagnostics,
  canResetPassword = false,
  onDone,
}) {
  // stage: "credentials" | "verify_email" | "forgot_request" | "forgot_reset"
  const [stage, setStage] = useState("credentials");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [resetCode, setResetCode] = useState("");
  const [resetNewPassword, setResetNewPassword] = useState("");
  const [resetConfirmPassword, setResetConfirmPassword] = useState("");
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [resetDevCode, setResetDevCode] = useState("");
  const [resetCooldown, setResetCooldown] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (resetCooldown <= 0) return undefined;
    const t = setTimeout(() => setResetCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [resetCooldown]);

  const verifyFlow = useCodeFlow({
    request: () => api.requestEmailOtp(email.trim(), "verify_email"),
    verify: (code) => api.verifyEmailOtp(email.trim(), code, name.trim() || undefined, "verify_email"),
    diagnostics,
    sentMessage: "Verification code sent to your inbox.",
    onDone,
  });

  const submitCredentials = async (e) => {
    e.preventDefault();
    setError("");
    const cleanEmail = email.trim();
    if (!validEmail(cleanEmail)) {
      setError(authErrorMessage("INVALID_EMAIL"));
      return;
    }
    if (mode === "signup") {
      if (password.length < 8) {
        setError(authErrorMessage("WEAK_PASSWORD"));
        return;
      }
      if (password !== confirmPassword) {
        setError(authErrorMessage("PASSWORD_MISMATCH"));
        return;
      }
    } else if (!password) {
      setError(authErrorMessage("PASSWORD_REQUIRED"));
      return;
    }

    setPending(true);
    try {
      const res = mode === "signup"
        ? await api.signupPassword(cleanEmail, password, name.trim() || undefined)
        : await api.signinPassword(cleanEmail, password);
      if (res.data?.requiresVerification) {
        verifyFlow.adoptChallenge(res.data);
        setStage("verify_email");
        toast.success("Account created — enter the 6-digit code sent to your email.");
        return;
      }
      onDone(res.data);
    } catch (err) {
      if (err?.code === "EMAIL_VERIFICATION_REQUIRED") {
        verifyFlow.adoptChallenge(err.details ?? {});
        setStage("verify_email");
        toast.message("Confirm your email address with the 6-digit code we sent.");
        return;
      }
      setError(apiErrorMessage(err, { diagnostics }));
    } finally {
      setPending(false);
    }
  };

  const requestReset = async (e) => {
    if (e) e.preventDefault();
    setError("");
    const cleanEmail = email.trim();
    if (!validEmail(cleanEmail)) {
      setError(authErrorMessage("INVALID_EMAIL"));
      return;
    }
    setPending(true);
    try {
      const res = await api.forgotPassword(cleanEmail);
      setResetDevCode(res.data?.devCode ?? "");
      setResetCooldown(res.data?.resendInSeconds ?? 60);
      setResetCode("");
      setStage("forgot_reset");
      toast.success("If an account exists for that email, a reset code was sent.");
    } catch (err) {
      setError(apiErrorMessage(err, { diagnostics }));
    } finally {
      setPending(false);
    }
  };

  const submitReset = async (e) => {
    e.preventDefault();
    setError("");
    const cleanEmail = email.trim();
    if (resetCode.replace(/\D/g, "").length !== 6) {
      setError(authErrorMessage("OTP_REQUIRED"));
      return;
    }
    if (resetNewPassword.length < 8) {
      setError(authErrorMessage("WEAK_PASSWORD"));
      return;
    }
    if (resetNewPassword !== resetConfirmPassword) {
      setError(authErrorMessage("PASSWORD_MISMATCH"));
      return;
    }
    setPending(true);
    try {
      const res = await api.resetPassword(cleanEmail, resetCode, resetNewPassword);
      onDone(res.data);
    } catch (err) {
      setError(apiErrorMessage(err, { diagnostics }));
    } finally {
      setPending(false);
    }
  };

  const locked = disabled || pending || verifyFlow.pending;

  if (stage === "verify_email") {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          verifyFlow.confirm(onDone);
        }}
        noValidate
        className="space-y-3.5"
      >
        <div className="flex items-center gap-2 text-xs font-medium text-fg">
          <ShieldCheck className="size-4 text-accent" aria-hidden />
          <span>Confirm your email address</span>
        </div>
        <CodeStep
          flow={{
            ...verifyFlow,
            restart: () => {
              verifyFlow.restart();
              setStage("credentials");
            },
          }}
          destination={email.trim()}
          submitLabel="Verify email & continue"
          backLabel="Edit email or password"
        />
      </form>
    );
  }

  if (stage === "forgot_request") {
    return (
      <form onSubmit={requestReset} noValidate className="space-y-3.5">
        <p className="text-xs leading-relaxed text-muted">
          Enter the email linked to your account. We&apos;ll send a 6-digit code to set a new password.
        </p>
        <Field label="Email address">
          <input
            type="email"
            name="email"
            autoComplete="email"
            inputMode="email"
            value={email}
            disabled={locked}
            onChange={(e) => onEmail(e.target.value)}
            placeholder="you@example.com"
            className={INPUT}
          />
        </Field>
        {!canResetPassword && (
          <Unavailable message="Email delivery is not configured on this server yet, so password reset emails cannot be sent." />
        )}
        <FormError message={error} />
        <SubmitButton pending={pending} pendingLabel="Sending reset code…" disabled={disabled || !canResetPassword}>
          Send reset code
        </SubmitButton>
        <button
          type="button"
          onClick={() => { setError(""); setStage("credentials"); }}
          disabled={locked}
          className="text-xs text-subtle underline-offset-2 hover:text-fg hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Back to password sign-in
        </button>
      </form>
    );
  }

  if (stage === "forgot_reset") {
    return (
      <form onSubmit={submitReset} noValidate className="space-y-3.5">
        <p className="text-xs leading-relaxed text-muted">
          Enter the 6-digit code sent to <span className="font-medium text-fg">{email.trim()}</span> and choose a new password.
        </p>
        <OtpBoxes value={resetCode} onChange={setResetCode} disabled={locked} autoFocus />
        <DevCodePreview devCode={resetDevCode} onFill={(c) => setResetCode(c)} disabled={locked} />
        <Field label="New password — at least 8 characters">
          <PasswordInput
            name="new-password"
            autoComplete="new-password"
            value={resetNewPassword}
            disabled={locked}
            onChange={setResetNewPassword}
            placeholder="Choose a new password"
            show={showResetPassword}
            onToggleShow={() => setShowResetPassword((s) => !s)}
          />
        </Field>
        <StrengthMeter password={resetNewPassword} />
        <Field label="Confirm new password">
          <input
            type={showResetPassword ? "text" : "password"}
            name="confirm-new-password"
            autoComplete="new-password"
            value={resetConfirmPassword}
            disabled={locked}
            onChange={(e) => setResetConfirmPassword(e.target.value)}
            placeholder="Re-enter your new password"
            className={INPUT}
          />
        </Field>
        <FormError message={error} />
        <SubmitButton pending={pending} pendingLabel="Updating password…" disabled={disabled}>
          Reset password & sign in
        </SubmitButton>
        <div className="flex items-center justify-between text-xs text-subtle">
          <button
            type="button"
            onClick={() => { setError(""); setStage("credentials"); }}
            disabled={locked}
            className="rounded underline-offset-2 hover:text-fg hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Back to sign in
          </button>
          <button
            type="button"
            onClick={() => requestReset()}
            disabled={locked || resetCooldown > 0}
            className="rounded underline-offset-2 hover:text-fg hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40"
          >
            {resetCooldown > 0 ? `Resend in ${resetCooldown}s` : "Resend code"}
          </button>
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={submitCredentials} noValidate className="space-y-3.5">
      <Unavailable message={unavailable} />
      {mode === "signup" && <NameField value={name} onChange={setName} disabled={locked} />}
      <Field label="Email address">
        <input
          type="email"
          name="email"
          autoComplete="username"
          inputMode="email"
          value={email}
          disabled={locked}
          onChange={(e) => onEmail(e.target.value)}
          placeholder="you@example.com"
          className={INPUT}
        />
      </Field>
      <Field
        label={mode === "signup" ? "Password — at least 8 characters" : "Password"}
        right={mode === "signin" && canResetPassword && (
          <button
            type="button"
            onClick={() => { setError(""); setStage("forgot_request"); }}
            disabled={locked}
            className="text-xs text-muted underline-offset-2 transition-colors hover:text-fg hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Forgot password?
          </button>
        )}
      >
        <PasswordInput
          name="password"
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          value={password}
          disabled={locked}
          onChange={setPassword}
          placeholder={mode === "signup" ? "Create a password (8+ chars)" : "Your password"}
          show={showPassword}
          onToggleShow={() => setShowPassword((s) => !s)}
        />
      </Field>
      {mode === "signup" && (
        <>
          <StrengthMeter password={password} />
          <Field
            label="Confirm password"
            right={confirmPassword && password === confirmPassword && (
              <span className="inline-flex items-center gap-1 text-[11px] text-fg/80">
                <CheckCircle2 className="size-3 text-accent" aria-hidden /> Matches
              </span>
            )}
          >
            <input
              type={showPassword ? "text" : "password"}
              name="confirmPassword"
              autoComplete="new-password"
              value={confirmPassword}
              disabled={locked}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Re-enter your password"
              className={INPUT}
            />
          </Field>
        </>
      )}
      <FormError message={error} />
      <SubmitButton
        pending={pending}
        pendingLabel={mode === "signup" ? "Creating account…" : "Signing in…"}
        disabled={disabled || Boolean(unavailable)}
      >
        {mode === "signup" ? "Create account" : "Sign in"}
      </SubmitButton>
    </form>
  );
}