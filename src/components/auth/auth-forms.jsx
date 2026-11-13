// The three first-party sign-in forms: emailed code, password, texted code.
// Each owns its own request state and reports success through `onDone` with
// the API payload ({ user, method, created, claimed }).
import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/meridian/api-client.js";
import { apiErrorMessage, authErrorMessage } from "@/lib/meridian/auth-messages.js";
import { cn } from "@/lib/utils";

const COUNTRY_CODES = ["+91", "+1", "+44", "+61", "+65", "+971", "+81", "+49", "+33", "+34"];
const INPUT = "h-11 w-full rounded-xl bg-surface-raised/70 px-3.5 text-sm text-fg outline-none transition-shadow duration-150 placeholder:text-subtle focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50";
const validEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v ?? "").trim());

function Field({ label, optional, children }) {
  return (
    <label className="block text-xs text-muted">
      <span>{label}{optional && <span className="text-subtle"> (optional)</span>}</span>
      <span className="mt-1.5 block">{children}</span>
    </label>
  );
}

function FormError({ message }) {
  if (!message) return null;
  return <p role="alert" className="rounded-xl bg-surface-raised/70 px-3 py-2 text-sm text-fg/90">{message}</p>;
}

function Unavailable({ message }) {
  if (!message) return null;
  return <p className="text-xs leading-relaxed text-subtle">{message}</p>;
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

function NameField({ value, onChange, disabled }) {
  return (
    <Field label="Display name" optional>
      <input name="name" autoComplete="name" value={value} disabled={disabled} maxLength={120}
        onChange={(e) => onChange(e.target.value)} placeholder="Ada" className={INPUT} />
    </Field>
  );
}

function OtpBoxes({ value, onChange, disabled, autoFocus }) {
  const refs = useRef([]);
  useEffect(() => {
    if (autoFocus) refs.current[0]?.focus();
  }, [autoFocus]);
  const set = (i, raw) => {
    const digits = raw.replace(/\D/g, "");
    if (digits.length > 1) {
      // Autofill or a typed burst lands in one box — spread it across.
      const merged = (value.slice(0, i) + digits).slice(0, 6);
      onChange(merged);
      refs.current[Math.min(merged.length, 5)]?.focus();
      return;
    }
    const next = value.split("");
    next[i] = digits;
    onChange(next.join("").slice(0, 6));
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

/** Shared request → code → verify machinery for the email and phone channels. */
function useCodeFlow({ request, verify, diagnostics, sentMessage }) {
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const send = async () => {
    setError("");
    setPending(true);
    try {
      await request();
      setSent(true);
      setCode("");
      setCooldown(60);
      toast.success(sentMessage);
    } catch (err) {
      setError(apiErrorMessage(err, { diagnostics }));
    } finally {
      setPending(false);
    }
  };

  const confirm = async (onDone) => {
    setError("");
    setPending(true);
    try {
      const res = await verify(code);
      onDone(res.data);
    } catch (err) {
      // Keep the code step open so a typo can be corrected without a new code.
      setError(apiErrorMessage(err, { diagnostics }));
      if (err?.code === "OTP_LOCKED" || err?.code === "OTP_EXPIRED" || err?.code === "OTP_NOT_FOUND") setCode("");
    } finally {
      setPending(false);
    }
  };

  const restart = () => { setSent(false); setCode(""); setError(""); };
  return { sent, code, setCode, pending, error, setError, cooldown, send, confirm, restart };
}

function CodeStep({ flow, mode, destination }) {
  return (
    <>
      <p className="text-xs leading-relaxed text-muted">
        We sent a 6-digit code to <span className="text-fg">{destination}</span>. It expires in 5 minutes.
      </p>
      <OtpBoxes value={flow.code} onChange={flow.setCode} disabled={flow.pending} autoFocus />
      <FormError message={flow.error} />
      <SubmitButton pending={flow.pending} pendingLabel="Verifying…" disabled={flow.code.length !== 6}>
        {mode === "signup" ? "Verify and create account" : "Verify and sign in"}
      </SubmitButton>
      <div className="flex items-center justify-between text-xs text-subtle">
        <button type="button" onClick={flow.restart} disabled={flow.pending}
          className="rounded underline-offset-2 hover:text-fg hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40">
          Use a different {destination.includes("@") ? "address" : "number"}
        </button>
        <button type="button" onClick={flow.send} disabled={flow.pending || flow.cooldown > 0}
          className="rounded underline-offset-2 hover:text-fg hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40 disabled:hover:no-underline">
          {flow.cooldown > 0 ? `Resend in ${flow.cooldown}s` : "Resend code"}
        </button>
      </div>
    </>
  );
}

export function EmailCodeForm({ mode, email, onEmail, disabled, unavailable, diagnostics, onDone }) {
  const [name, setName] = useState("");
  const flow = useCodeFlow({
    request: () => api.requestEmailOtp(email.trim()),
    verify: (code) => api.verifyEmailOtp(email.trim(), code, mode === "signup" ? name.trim() || undefined : undefined),
    diagnostics,
    sentMessage: "Code sent — check your inbox.",
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
        <CodeStep flow={flow} mode={mode} destination={email.trim()} />
      ) : (
        <>
          <Unavailable message={unavailable} />
          <Field label="Email address">
            <input type="email" name="email" autoComplete="email" inputMode="email" value={email} disabled={locked}
              onChange={(e) => onEmail(e.target.value)} placeholder="you@example.com" className={INPUT} />
          </Field>
          {mode === "signup" && <NameField value={name} onChange={setName} disabled={locked} />}
          <FormError message={flow.error} />
          <SubmitButton pending={flow.pending} pendingLabel="Sending code…" disabled={disabled || Boolean(unavailable)}>
            Continue with Email
          </SubmitButton>
        </>
      )}
    </form>
  );
}

export function PhoneCodeForm({ mode, disabled, unavailable, diagnostics, onDone }) {
  const [cc, setCc] = useState("+91");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const flow = useCodeFlow({
    request: () => api.requestPhoneOtp(phone, cc),
    verify: (code) => api.verifyPhoneOtp(phone, cc, code, mode === "signup" ? name.trim() || undefined : undefined),
    diagnostics,
    sentMessage: "Code sent — check your messages.",
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
        <CodeStep flow={flow} mode={mode} destination={`${cc} ${phone.trim()}`} />
      ) : (
        <>
          <Unavailable message={unavailable} />
          <div className="flex gap-2">
            <div className="w-24 shrink-0">
              <Field label="Country">
                <select name="countryCode" autoComplete="tel-country-code" value={cc} disabled={locked}
                  onChange={(e) => setCc(e.target.value)} className={cn(INPUT, "px-2.5")}>
                  {COUNTRY_CODES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>
            </div>
            <div className="min-w-0 flex-1">
              <Field label="Phone number">
                <input type="tel" name="phone" autoComplete="tel-national" inputMode="tel" value={phone} disabled={locked}
                  onChange={(e) => setPhone(e.target.value)} placeholder="98765 43210" className={INPUT} />
              </Field>
            </div>
          </div>
          {mode === "signup" && <NameField value={name} onChange={setName} disabled={locked} />}
          <FormError message={flow.error} />
          <SubmitButton pending={flow.pending} pendingLabel="Sending code…" disabled={disabled || Boolean(unavailable)}>
            Continue with Phone
          </SubmitButton>
        </>
      )}
    </form>
  );
}

export function PasswordForm({ mode, email, onEmail, disabled, unavailable, diagnostics, onDone, onUseEmailCode }) {
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (!validEmail(email)) {
      setError(authErrorMessage("INVALID_EMAIL"));
      return;
    }
    if (mode === "signup" && password.length < 8) {
      setError(authErrorMessage("WEAK_PASSWORD"));
      return;
    }
    if (mode === "signin" && !password) {
      setError(authErrorMessage("PASSWORD_REQUIRED"));
      return;
    }
    setPending(true);
    try {
      const res = mode === "signup"
        ? await api.signupPassword(email.trim(), password, name.trim() || undefined)
        : await api.signinPassword(email.trim(), password);
      onDone(res.data);
    } catch (err) {
      setError(apiErrorMessage(err, { diagnostics }));
    } finally {
      setPending(false);
    }
  };
  const locked = disabled || pending;
  return (
    <form onSubmit={submit} noValidate className="space-y-3.5">
      <Unavailable message={unavailable} />
      <Field label="Email address">
        <input type="email" name="email" autoComplete="username" inputMode="email" value={email} disabled={locked}
          onChange={(e) => onEmail(e.target.value)} placeholder="you@example.com" className={INPUT} />
      </Field>
      <Field label={mode === "signup" ? "Password — at least 8 characters" : "Password"}>
        <span className="relative block">
          <input type={show ? "text" : "password"} name="password"
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            value={password} disabled={locked} onChange={(e) => setPassword(e.target.value)}
            placeholder={mode === "signup" ? "Choose a password" : "Your password"} className={cn(INPUT, "pr-11")} />
          <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? "Hide password" : "Show password"} aria-pressed={show}
            className="absolute right-1.5 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-lg text-subtle transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
            {show ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
          </button>
        </span>
      </Field>
      {mode === "signup" && <NameField value={name} onChange={setName} disabled={locked} />}
      <FormError message={error} />
      <SubmitButton pending={pending} pendingLabel={mode === "signup" ? "Creating account…" : "Signing in…"} disabled={disabled || Boolean(unavailable)}>
        {mode === "signup" ? "Create account" : "Sign in"}
      </SubmitButton>
      {mode === "signin" && onUseEmailCode && (
        <p className="text-xs text-subtle">
          Forgot your password?{" "}
          <button type="button" onClick={onUseEmailCode}
            className="rounded underline underline-offset-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
            Sign in with an email code
          </button>
          , then choose a new one in Settings.
        </p>
      )}
    </form>
  );
}
