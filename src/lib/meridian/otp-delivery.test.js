// Email and SMS code delivery against stand-in Resend / Twilio endpoints, and
// the full request → deliver → verify loop for each way a code can be sent.
// Nothing leaves the machine; an unexpected URL fails the test.
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";

const ACCOUNT_SID = `AC${"a".repeat(32)}`;
const VERIFY_SID = `VA${"b".repeat(32)}`;
const MESSAGING_SID = `MG${"c".repeat(32)}`;
const ENV_KEYS = [
  "MONGODB_URI", "SESSION_SECRET", "EMAIL_PROVIDER_KEY", "EMAIL_FROM",
  "SMS_PROVIDER_KEY", "SMS_PROVIDER_SECRET", "SMS_FROM", "SMS_VERIFY_SERVICE_SID",
  "OTP_SMS_HOURLY_LIMIT",
];

let ip = 0;
function makeRequest() {
  ip += 1;
  return new Request("https://meridian.example.com/api/auth/test", {
    headers: { "x-forwarded-for": `10.0.0.${ip}`, "user-agent": "meridian-test" },
  });
}

describe("verification code delivery", () => {
  const saved = {};
  const origFetch = globalThis.fetch;
  const origError = console.error;
  let calls = []; // { url, params | json, headers }
  let respond = () => new Response("{}", { status: 200 });
  let logged = [];
  let auth;
  let otp;

  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  before(async () => {
    for (const key of ENV_KEYS) saved[key] = process.env[key];
    for (const key of ENV_KEYS) if (key !== "MONGODB_URI") delete process.env[key];
    process.env.SESSION_SECRET = "test-session-secret-0123456789abcdef0123456789abcdef";
    const uri = new URL(saved.MONGODB_URI?.trim() || "mongodb://127.0.0.1:27017/meridian");
    uri.pathname = `/meridian_delivery_test_${process.pid}_${Date.now()}`;
    process.env.MONGODB_URI = uri.toString();

    globalThis.fetch = async (input, init = {}) => {
      const url = String(input?.url ?? input);
      if (!/^https:\/\/(api\.resend\.com|api\.twilio\.com|verify\.twilio\.com)\//.test(url)) {
        throw new Error(`unexpected network request in test: ${url}`);
      }
      const headers = new Headers(init.headers);
      const body = String(init.body ?? "");
      calls.push(headers.get("content-type")?.includes("json")
        ? { url, headers, json: JSON.parse(body) }
        : { url, headers, params: new URLSearchParams(body) });
      return respond(url);
    };
    console.error = (...args) => { logged.push(args.join(" ")); };

    auth = await import("./auth.js");
    otp = await import("./otp-flow.js");
    const { requireMongoConnection } = await import("./mongo.js");
    await requireMongoConnection();
    await auth.ensureAuthIndexes();
  });

  after(async () => {
    globalThis.fetch = origFetch;
    console.error = origError;
    const { connectMongo, disconnectMongo } = await import("./mongo.js");
    try {
      const conn = await connectMongo();
      await conn?.connection?.db?.dropDatabase();
    } catch { /* best-effort cleanup */ }
    await disconnectMongo().catch(() => {});
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  function reset(handler) {
    calls = [];
    logged = [];
    respond = handler ?? (() => json({ ok: true }));
  }

  it("offers nothing until credentials exist, and says which are missing", async () => {
    assert.equal(auth.emailConfigured(), false);
    assert.equal(auth.smsConfigured(), false);
    assert.deepEqual(auth.smsMissingEnv(), ["SMS_PROVIDER_KEY", "SMS_PROVIDER_SECRET", "SMS_VERIFY_SERVICE_SID or SMS_FROM"]);
    reset();
    await assert.rejects(auth.sendEmailOtp("a@example.com", "123456"), (err) => err?.status === 503 && err?.code === "EMAIL_PROVIDER_UNCONFIGURED");
    await assert.rejects(auth.sendPhoneOtp("+14155550101", "123456"), (err) => err?.status === 503 && err?.code === "SMS_PROVIDER_UNCONFIGURED");
    assert.equal(calls.length, 0, "no provider is contacted, and no code is faked");
  });

  it("email: a code requested for sign-in arrives through Resend and signs the person in once", async () => {
    process.env.EMAIL_PROVIDER_KEY = "re_test_key";
    process.env.EMAIL_FROM = "Meridian <noreply@meridian.example.com>";
    reset(() => json({ id: "email_1" }));

    const email = "otp-user@example.com";
    const info = await otp.requestOtp(makeRequest(), email, "email", (code) => auth.sendEmailOtp(email, code, { purpose: "auth" }), { purpose: "auth" });
    assert.equal(info.expiresInSeconds, 300);
    assert.equal(info.devCode, undefined, "the code is never returned to the browser");

    assert.equal(calls.length, 1);
    const sent = calls[0];
    assert.equal(sent.url, "https://api.resend.com/emails");
    assert.equal(sent.headers.get("authorization"), "Bearer re_test_key");
    assert.equal(sent.json.from, "Meridian <noreply@meridian.example.com>");
    assert.equal(sent.json.to, email);
    const code = /\b(\d{6})\b/.exec(sent.json.text)?.[1];
    assert.ok(code, "the email carries a 6-digit code");
    assert.ok(sent.json.html.includes(code));
    assert.ok(sent.json.subject.includes(code));

    await assert.rejects(
      otp.consumeOtp(makeRequest(), email, code === "000000" ? "111111" : "000000", { channel: "email", purpose: "auth" }),
      (err) => err?.code === "OTP_INVALID" && /4 attempts left/.test(err.message),
    );
    // A code requested for sign-in cannot be spent on another purpose.
    await assert.rejects(
      otp.consumeOtp(makeRequest(), email, code, { channel: "email", purpose: "reset_password" }),
      (err) => err?.code === "OTP_NOT_FOUND",
    );
    await otp.consumeOtp(makeRequest(), email, code, { channel: "email", purpose: "auth" });
    await assert.rejects(
      otp.consumeOtp(makeRequest(), email, code, { channel: "email", purpose: "auth" }),
      (err) => err?.code === "OTP_NOT_FOUND",
      "a code works once",
    );
  });

  it("email: a rejected send is logged with Resend's reason and leaves no cooldown behind", async () => {
    reset(() => json({ statusCode: 403, name: "validation_error", message: "The meridian.example.com domain is not verified." }, 403));
    const email = "unverified-domain@example.com";
    const send = () => otp.requestOtp(makeRequest(), email, "email", (code) => auth.sendEmailOtp(email, code), { purpose: "auth" });
    await assert.rejects(send(), (err) => err?.status === 502 && err?.code === "EMAIL_SEND_FAILED");
    assert.ok(logged.some((line) => line.includes("HTTP 403") && line.includes("domain is not verified")), "operator can see why");
    assert.ok(!logged.some((line) => /\b\d{6}\b/.test(line) && line.includes("code is")), "the code itself is not logged");
    // The failed attempt must not make the person wait 60s for a code that never left.
    reset(() => json({ id: "email_2" }));
    await send();
    assert.equal(calls.length, 1);
  });

  it("SMS from your own number or a Messaging Service", async () => {
    process.env.SMS_PROVIDER_KEY = ACCOUNT_SID;
    process.env.SMS_PROVIDER_SECRET = "twilio-auth-token";
    process.env.SMS_FROM = "+15550001111";
    assert.equal(auth.smsConfigured(), true);

    reset(() => json({ sid: "SM1", status: "queued" }, 201));
    const sent = await auth.sendPhoneOtp("+14155550102", "654321");
    assert.equal(sent.external, undefined);
    assert.equal(calls[0].url, `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Messages.json`);
    assert.equal(calls[0].headers.get("authorization"), `Basic ${Buffer.from(`${ACCOUNT_SID}:twilio-auth-token`).toString("base64")}`);
    assert.equal(calls[0].params.get("From"), "+15550001111");
    assert.equal(calls[0].params.get("To"), "+14155550102");
    assert.ok(calls[0].params.get("Body").includes("654321"));

    process.env.SMS_FROM = MESSAGING_SID;
    reset(() => json({ sid: "SM2", status: "accepted" }, 201));
    await auth.sendPhoneOtp("+14155550102", "654321");
    assert.equal(calls[0].params.get("MessagingServiceSid"), MESSAGING_SID);
    assert.equal(calls[0].params.get("From"), null);

    reset(() => json({ code: 21608, message: "The number is unverified. Trial accounts cannot send messages to unverified numbers." }, 400));
    await assert.rejects(auth.sendPhoneOtp("+14155550102", "654321"), (err) => err?.status === 502 && err?.code === "SMS_SEND_FAILED");
    assert.ok(logged.some((line) => line.includes("21608") && line.includes("Trial accounts")));
  });

  it("SMS through Twilio Verify: Twilio issues and checks the code", async () => {
    process.env.SMS_PROVIDER_KEY = ACCOUNT_SID;
    process.env.SMS_PROVIDER_SECRET = "twilio-auth-token";
    process.env.SMS_VERIFY_SERVICE_SID = VERIFY_SID;
    delete process.env.SMS_FROM;
    assert.equal(auth.smsConfigured(), true);
    assert.deepEqual(auth.smsMissingEnv(), []);

    const phone = "+919876543210";
    const twilioCode = "804213"; // known only to Twilio and the handset
    reset((url) => {
      if (url.endsWith("/Verifications")) return json({ sid: "VE1", status: "pending" }, 201);
      const check = calls.at(-1).params;
      return json({ sid: "VE1", status: check.get("Code") === twilioCode ? "approved" : "pending" });
    });

    let ourCode = null;
    await otp.requestOtp(makeRequest(), phone, "phone", (code) => { ourCode = code; return auth.sendPhoneOtp(phone, code); }, { purpose: "auth" });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `https://verify.twilio.com/v2/Services/${VERIFY_SID}/Verifications`);
    assert.equal(calls[0].params.get("To"), phone);
    assert.equal(calls[0].params.get("Channel"), "sms");
    assert.ok(![...calls[0].params.values()].includes(ourCode), "our placeholder code is never sent anywhere");

    // The placeholder generated locally must not open the account.
    if (ourCode !== twilioCode) {
      await assert.rejects(
        otp.consumeOtp(makeRequest(), phone, ourCode, { channel: "phone", purpose: "auth" }),
        (err) => err?.code === "OTP_INVALID",
      );
      assert.equal(calls.at(-1).url, `https://verify.twilio.com/v2/Services/${VERIFY_SID}/VerificationCheck`);
    }
    await otp.consumeOtp(makeRequest(), phone, twilioCode, { channel: "phone", purpose: "auth" });
    assert.equal(calls.at(-1).params.get("To"), phone);
    assert.equal(calls.at(-1).params.get("Code"), twilioCode);
    await assert.rejects(
      otp.consumeOtp(makeRequest(), phone, twilioCode, { channel: "phone", purpose: "auth" }),
      (err) => err?.code === "OTP_NOT_FOUND",
      "an approved code cannot be replayed",
    );
  });

  it("Twilio Verify: expiry, lockout and refusals map to clear outcomes", async () => {
    const send = (phone) => otp.requestOtp(makeRequest(), phone, "phone", (code) => auth.sendPhoneOtp(phone, code), { purpose: "auth" });

    reset((url) => (url.endsWith("/Verifications") ? json({ status: "pending" }, 201) : json({ code: 20404, message: "not found" }, 404)));
    await send("+447700900001");
    await assert.rejects(
      otp.consumeOtp(makeRequest(), "+447700900001", "123456", { channel: "phone", purpose: "auth" }),
      (err) => err?.status === 400 && err?.code === "OTP_EXPIRED",
    );

    reset((url) => (url.endsWith("/Verifications") ? json({ status: "pending" }, 201) : json({ code: 60202, message: "Max check attempts reached" }, 429)));
    await send("+447700900002");
    await assert.rejects(
      otp.consumeOtp(makeRequest(), "+447700900002", "123456", { channel: "phone", purpose: "auth" }),
      (err) => err?.status === 429 && err?.code === "OTP_LOCKED",
    );

    reset(() => json({ code: 60203, message: "Max send attempts reached" }, 429));
    await assert.rejects(send("+447700900003"), (err) => err?.status === 429 && err?.code === "RATE_LIMITED");

    reset(() => json({ code: 60205, message: "SMS is not supported by landline phone number" }, 400));
    await assert.rejects(send("+442079460000"), (err) => err?.status === 400 && err?.code === "INVALID_PHONE");
    assert.ok(logged.some((line) => line.includes("60205")));
  });

  it("stops sending once the hourly ceiling is reached", async () => {
    process.env.OTP_SMS_HOURLY_LIMIT = "1"; // already exceeded by the sends above
    reset(() => json({ status: "pending" }, 201));
    await assert.rejects(
      otp.requestOtp(makeRequest(), "+61400000001", "phone", (code) => auth.sendPhoneOtp("+61400000001", code), { purpose: "auth" }),
      (err) => err?.status === 429 && err?.code === "RATE_LIMITED",
    );
    assert.equal(calls.length, 0, "no SMS is paid for past the ceiling");
    delete process.env.OTP_SMS_HOURLY_LIMIT;
  });

  it("POST bodies must be JSON, so another site's form cannot drive sign-in", async () => {
    const { readJson } = await import("./api-route.js");
    const post = (body, type) => new Request("https://meridian.example.com/api/auth/signin-password", {
      method: "POST", body, headers: type ? { "content-type": type } : {},
    });
    assert.deepEqual(await readJson(post('{"email":"a@b.co"}', "application/json")), { email: "a@b.co" });
    assert.deepEqual(await readJson(post('{"email":"a@b.co"}', "application/json; charset=utf-8")), { email: "a@b.co" });
    assert.deepEqual(await readJson(new Request("https://meridian.example.com/api/auth/logout", { method: "POST" })), {});
    for (const type of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x"]) {
      await assert.rejects(readJson(post('{"email":"a@b.co","x":"="}', type)), (err) => err?.status === 415);
    }
  });
});
