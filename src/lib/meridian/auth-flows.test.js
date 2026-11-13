// End-to-end persistence & auth flow tests running against real MongoDB.
// Uses an isolated temporary database dropped cleanly in after().

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";

function makeRequest(headers = {}) {
  return new Request("http://127.0.0.1:8080/api/auth/test", {
    headers: { "x-forwarded-for": "127.0.0.1", "user-agent": "meridian-test", ...headers },
  });
}

function buildTestMongoUri() {
  const dbName = `meridian_auth_test_${process.pid}_${Date.now()}`;
  const base = process.env.MONGODB_URI?.trim();
  if (base) {
    try {
      const u = new URL(base);
      u.pathname = `/${dbName}`;
      return u.toString();
    } catch {
      // fall back to local default
    }
  }
  return `mongodb://127.0.0.1:27017/${dbName}`;
}

describe("MongoDB auth storage and flows", () => {
  const prevMongo = process.env.MONGODB_URI;
  const prevSecret = process.env.SESSION_SECRET;
  const testUri = buildTestMongoUri();

  before(async () => {
    process.env.MONGODB_URI = testUri;
    process.env.SESSION_SECRET = "test-session-secret-0123456789abcdef0123456789abcdef";
    const { requireMongoConnection } = await import("./mongo.js");
    const { ensureAuthIndexes } = await import("./auth-models.js");
    await requireMongoConnection();
    await ensureAuthIndexes();
  });

  after(async () => {
    const { disconnectMongo, connectMongo } = await import("./mongo.js");
    try {
      const conn = await connectMongo();
      if (conn?.connection?.db) {
        await conn.connection.db.dropDatabase();
      }
    } catch {
      // ignore cleanup error
    }
    await disconnectMongo().catch(() => {});
    if (prevMongo !== undefined) process.env.MONGODB_URI = prevMongo;
    else delete process.env.MONGODB_URI;
    if (prevSecret !== undefined) process.env.SESSION_SECRET = prevSecret;
    else delete process.env.SESSION_SECRET;
  });

  it("reports mongodb backend exclusively and rejects when MONGODB_URI is unset", async () => {
    const { authBackend, findUserByEmail } = await import("./auth-storage.js");
    const { disconnectMongo } = await import("./mongo.js");
    assert.equal(authBackend(), "mongodb");

    const saved = process.env.MONGODB_URI;
    try {
      delete process.env.MONGODB_URI;
      await disconnectMongo();
      await assert.rejects(
        () => findUserByEmail("nobody@meridian.test"),
        (err) => err?.status === 503 && err?.code === "MONGO_UNCONFIGURED",
      );
    } finally {
      process.env.MONGODB_URI = saved;
      const { requireMongoConnection } = await import("./mongo.js");
      await requireMongoConnection();
    }
  });

  it("supports password signup, email verification, sign-in, password errors, and reset", async () => {
    const {
      signupWithPassword,
      signinWithPassword,
      forgotPassword,
      resetPassword,
      setPassword,
    } = await import("./password-flow.js");
    const { findUserByEmail, saveUser } = await import("./auth-storage.js");
    const { getSessionUser, resolveOAuthAccount } = await import("./auth.js");

    function cookieHeader(setCookie) {
      return String(setCookie || "").split(";")[0];
    }

    // Weak password rejected
    await assert.rejects(
      () => signupWithPassword(makeRequest(), {
        email: "weak@meridian.test",
        password: "123",
        name: "Weak",
      }),
      (err) => err?.status === 400 && err?.code === "WEAK_PASSWORD",
    );

    const signup = await signupWithPassword(makeRequest(), {
      email: "Ada@Meridian.Test",
      password: "Correct-Horse-Battery-99!",
      name: "Ada Lovelace",
    });
    assert.equal(signup.user.email, "ada@meridian.test");
    assert.equal(signup.user.name, "Ada Lovelace");
    assert.ok(signup.cookie?.includes("meridian_session="));

    // Duplicate email rejected cleanly (409 EMAIL_TAKEN)
    await assert.rejects(
      () => signupWithPassword(makeRequest(), {
        email: "ada@meridian.test",
        password: "Another-Strong-Password-99!",
        name: "Ada 2",
      }),
      (err) => err?.status === 409 && err?.code === "EMAIL_TAKEN",
    );

    // Wrong password rejected (401 INVALID_CREDENTIALS)
    await assert.rejects(
      () => signinWithPassword(makeRequest(), {
        email: "ada@meridian.test",
        password: "Wrong-Password-00!",
      }),
      (err) => err?.status === 401 && err?.code === "INVALID_CREDENTIALS",
    );

    // Valid password sign-in creates persistent MongoDB session
    const signin = await signinWithPassword(makeRequest(), {
      email: "ada@meridian.test",
      password: "Correct-Horse-Battery-99!",
    });
    assert.equal(signin.user.id, signup.user.id);
    assert.ok(signin.cookie?.includes("meridian_session="));
    const resolvedSess = await getSessionUser(makeRequest({
      cookie: cookieHeader(signin.cookie),
    }));
    assert.equal(resolvedSess?.user?.id, signup.user.id);

    // Verified account required for password reset: mark verified then issue + consume OTP via mocked email provider
    const u = await findUserByEmail("ada@meridian.test", { includeSecrets: true });
    u.emailVerified = true;
    await saveUser(u);

    let capturedCode = null;
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      if (String(url).includes("api.resend.com")) {
        const payload = JSON.parse(opts.body);
        const match = payload.text.match(/\b(\d{6})\b/);
        capturedCode = match?.[1] ?? null;
        return new Response(JSON.stringify({ id: "resend_1" }), { status: 200 });
      }
      return origFetch(url, opts);
    };
    process.env.EMAIL_PROVIDER_KEY = "re_test_key";
    process.env.EMAIL_FROM = "noreply@meridian.test";

    try {
      await forgotPassword(makeRequest(), { email: "ada@meridian.test" });
      assert.ok(capturedCode && capturedCode.length === 6);

      // Invalid reset code rejected
      await assert.rejects(
        () => resetPassword(makeRequest(), {
          email: "ada@meridian.test",
          code: "000000",
          newPassword: "New-Password-12345!",
        }),
        (err) => err?.code === "OTP_INVALID",
      );

      // Valid reset updates password & revokes old sessions
      const resetRes = await resetPassword(makeRequest(), {
        email: "ada@meridian.test",
        code: capturedCode,
        newPassword: "New-Stronger-Password-77!",
      });
      assert.ok(resetRes.cookie?.includes("meridian_session="));

      const oldSessAfterReset = await getSessionUser(makeRequest({
        cookie: cookieHeader(signin.cookie),
      }));
      assert.equal(oldSessAfterReset, null);

      const reLogin = await signinWithPassword(makeRequest(), {
        email: "ada@meridian.test",
        password: "New-Stronger-Password-77!",
      });
      assert.equal(reLogin.user.id, signup.user.id);

      // OAuth user can set a password when none set yet, then change requires matching current password
      const { createSession } = await import("./auth.js");
      const oauthRes = await resolveOAuthAccount(
        {
          providerUserId: "ms-set-pw-1",
          email: "setpw@meridian.test",
          emailVerified: true,
          name: "Ms SetPw",
        },
        "microsoft",
      );
      const oaSess = await createSession(oauthRes.user._id, makeRequest(), { method: "microsoft" });
      const linked = await setPassword(
        makeRequest({ cookie: cookieHeader(oaSess.cookie) }),
        { newPassword: "Initial-OAuth-Password-88!" },
      );
      assert.ok(linked.user.providers.includes("password"));
      await assert.rejects(
        () => setPassword(
          makeRequest({ cookie: cookieHeader(oaSess.cookie) }),
          {
            currentPassword: "WrongCurrentPassword!",
            newPassword: "Second-Password-99!",
          },
        ),
        (err) => err?.status === 401 && err?.code === "INVALID_CREDENTIALS",
      );
    } finally {
      globalThis.fetch = origFetch;
      delete process.env.EMAIL_PROVIDER_KEY;
      delete process.env.EMAIL_FROM;
    }
  });

  it("handles email OTP request, verification, single-use, and attempt lockout", async () => {
    const { requestOtp, consumeOtp } = await import("./otp-flow.js");

    let sentCode = null;
    const req = await requestOtp(
      makeRequest(),
      "otp@meridian.test",
      "email",
      async (code) => { sentCode = code; return true; },
      { purpose: "login" },
    );
    assert.ok(sentCode && sentCode.length === 6);
    assert.equal(req.channel, "email");

    const ok = await consumeOtp(makeRequest(), "otp@meridian.test", sentCode, {
      channel: "email",
      purpose: "login",
    });
    assert.ok(ok._id);

    // Reusing consumed OTP fails
    await assert.rejects(
      () => consumeOtp(makeRequest(), "otp@meridian.test", sentCode, {
        channel: "email",
        purpose: "login",
      }),
      (err) => err?.code === "OTP_NOT_FOUND",
    );

    // Request another OTP and fail 5 times to trigger OTP_LOCKED
    let secondCode = null;
    await requestOtp(
      makeRequest(),
      "cooldown@meridian.test",
      "email",
      async (code) => { secondCode = code; return true; },
      { purpose: "login" },
    );
    const wrong = secondCode === "000000" ? "111111" : "000000";
    for (let i = 0; i < 4; i++) {
      await assert.rejects(
        () => consumeOtp(makeRequest(), "cooldown@meridian.test", wrong, { channel: "email", purpose: "login" }),
        (err) => err?.code === "OTP_INVALID",
      );
    }
    await assert.rejects(
      () => consumeOtp(makeRequest(), "cooldown@meridian.test", wrong, { channel: "email", purpose: "login" }),
      (err) => err?.code === "OTP_LOCKED",
    );
  });

  it("handles OAuth creation, conflict guarding, multiple phone users without sparse null conflict, and saved locations", async () => {
    const { resolveOAuthAccount, publicUser } = await import("./auth.js");
    const {
      createUser,
      findUserByPhone,
      upsertSavedLocation,
      listSavedLocations,
      deleteSavedLocation,
    } = await import("./auth-storage.js");

    const googleRes = await resolveOAuthAccount(
      {
        providerUserId: "goog-sub-42",
        email: "pilot@meridian.test",
        emailVerified: true,
        name: "Amelia Orbit",
        avatar: "https://example.com/avatar.png",
      },
      "google",
    );
    assert.equal(googleRes.created, true);
    assert.equal(publicUser(googleRes.user).email, "pilot@meridian.test");

    // Sign back in via same Google identity
    const googleAgain = await resolveOAuthAccount(
      {
        providerUserId: "goog-sub-42",
        email: "pilot@meridian.test",
        emailVerified: true,
        name: "Amelia Orbit",
      },
      "google",
    );
    assert.equal(googleAgain.created, false);
    assert.equal(googleAgain.user.id, googleRes.user.id);

    // Different OAuth provider sharing the same email refuses auto-merge
    await assert.rejects(
      () => resolveOAuthAccount(
        {
          providerUserId: "ms-oid-99",
          email: "pilot@meridian.test",
          emailVerified: true,
          name: "Amelia MS",
        },
        "microsoft",
      ),
      (err) => err?.status === 409 && Boolean(err?.code),
    );

    // Multiple phone-only users (no email) must not collide on null email unique index
    const phoneUser1 = await createUser({
      phone: "+14155550101",
      phoneVerified: true,
      name: "Phone User One",
      authProviders: [{ provider: "phone", providerUserId: "+14155550101" }],
    });
    const phoneUser2 = await createUser({
      phone: "+14155550102",
      phoneVerified: true,
      name: "Phone User Two",
      authProviders: [{ provider: "phone", providerUserId: "+14155550102" }],
    });
    assert.notEqual(phoneUser1.id, phoneUser2.id);
    const foundPhone = await findUserByPhone("+14155550101");
    assert.equal(foundPhone.id, phoneUser1.id);

    // Saved locations CRUD + cross-user isolation + invalid ID resilience
    const loc = await upsertSavedLocation(phoneUser1.id, {
      kind: "CITY",
      name: "Tokyo",
      country: "Japan",
      lat: 35.6762,
      lon: 139.6503,
      note: "Observatory stop",
    });
    assert.equal(loc.name, "Tokyo");
    const list1 = await listSavedLocations(phoneUser1.id);
    assert.equal(list1.length, 1);

    // User 2 cannot delete User 1's location
    const crossRemoved = await deleteSavedLocation(loc.id, phoneUser2.id);
    assert.equal(crossRemoved, false);
    assert.equal((await listSavedLocations(phoneUser1.id)).length, 1);

    // Malformed ID doesn't throw CastError
    assert.equal(await deleteSavedLocation("not-an-objectid", phoneUser1.id), false);

    // Owner deletes cleanly
    assert.equal(await deleteSavedLocation(loc.id, phoneUser1.id), true);
    assert.equal((await listSavedLocations(phoneUser1.id)).length, 0);
  });
});
