// Consistent REST envelope for every /api/* response.
// Success: { success:true, data, meta:{ source, fetchedAt, cached, requestId } }
// Error:   { success:false, error:{ code, message }, requestId }
import { randomUUID } from "node:crypto";

export function requestId() {
  try {
    return randomUUID();
  } catch {
    return `req-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  }
}

export function ok(data, meta = {}) {
  return {
    success: true,
    data,
    meta: {
      source: meta.source ?? "meridian",
      fetchedAt: meta.fetchedAt ?? new Date().toISOString(),
      cached: meta.cached ?? false,
      requestId: meta.requestId ?? requestId(),
      ...(meta.extra ?? {}),
    },
  };
}

export function fail(code, message, status = 500, requestIdValue) {
  return {
    status,
    body: {
      success: false,
      error: { code, message },
      requestId: requestIdValue ?? requestId(),
    },
  };
}

// Wrap a TanStack Start server handler with envelope + error mapping.
export async function handleApi(handler, meta = {}) {
  const rid = requestId();
  const started = Date.now();
  try {
    const { data, source, cached, fetchedAt, extra, status } = await handler(rid);
    void started;
    return {
      status: status ?? 200,
      body: ok(data, { source: source ?? meta.source, cached, fetchedAt, requestId: rid, extra }),
    };
  } catch (err) {
    const code = err?.code ?? "INTERNAL_ERROR";
    const status = err?.status ?? 500;
    console.error(`[api] ${rid} ${code}:`, err?.message ?? err);
    return fail(code, err?.message ?? "Unexpected error", status, rid);
  }
}

export function httpError(status, code, message) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}
