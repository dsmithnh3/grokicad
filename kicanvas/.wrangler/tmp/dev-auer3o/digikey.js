var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker/digikey.ts
var DIGIKEY_AUTH_URL = "https://api.digikey.com/v1/oauth2/authorize";
var DIGIKEY_TOKEN_URL = "https://api.digikey.com/v1/oauth2/token";
var DIGIKEY_SEARCH_URL = "https://api.digikey.com/products/v4/search/keyword";
var SESSION_COOKIE_NAME = "digikey_session";
var SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
var GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
function generateSessionId() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(generateSessionId, "generateSessionId");
function getSessionIdFromRequest(request) {
  const cookieHeader = request.headers.get("Cookie");
  if (!cookieHeader) return null;
  const cookies = cookieHeader.split(";").map((c) => c.trim());
  for (const cookie of cookies) {
    const [name, value] = cookie.split("=");
    if (name === SESSION_COOKIE_NAME) {
      return value;
    }
  }
  return null;
}
__name(getSessionIdFromRequest, "getSessionIdFromRequest");
function createSessionCookie(sessionId, maxAge = SESSION_TTL_SECONDS) {
  return `${SESSION_COOKIE_NAME}=${sessionId}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}
__name(createSessionCookie, "createSessionCookie");
function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Credentials": "true"
  };
}
__name(corsHeaders, "corsHeaders");
function jsonResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...headers
    }
  });
}
__name(jsonResponse, "jsonResponse");
function convertProduct(product) {
  const digikeyPartNumber = product.ProductVariations?.[0]?.DigiKeyProductNumber ?? null;
  const status = product.ProductStatus?.Status ?? null;
  const isObsolete = status ? /obsolete|discontinued|not for new designs|last time buy/i.test(status) : false;
  return {
    digikey_part_number: digikeyPartNumber,
    manufacturer_part_number: product.ManufacturerProductNumber ?? null,
    manufacturer: product.Manufacturer?.Name ?? null,
    description: product.Description?.ProductDescription ?? null,
    detailed_description: product.Description?.DetailedDescription ?? null,
    product_url: product.ProductUrl ?? null,
    datasheet_url: product.DatasheetUrl ?? null,
    photo_url: product.PhotoUrl ?? null,
    quantity_available: product.QuantityAvailable ?? null,
    unit_price: product.UnitPrice ?? null,
    product_status: status,
    is_obsolete: isObsolete,
    lifecycle_status: isObsolete ? status ?? "Obsolete" : status,
    category: product.Category?.Name ?? null,
    parameters: (product.Parameters ?? []).filter((p) => p.ParameterText).map((p) => ({
      name: p.ParameterText,
      value: p.ValueText ?? ""
    }))
  };
}
__name(convertProduct, "convertProduct");
async function getSession(env, sessionId) {
  const data = await env.DIGIKEY_SESSIONS.get(sessionId, "json");
  return data;
}
__name(getSession, "getSession");
async function saveSession(env, sessionId, session) {
  await env.DIGIKEY_SESSIONS.put(sessionId, JSON.stringify(session), {
    expirationTtl: SESSION_TTL_SECONDS
  });
}
__name(saveSession, "saveSession");
async function deleteSession(env, sessionId) {
  await env.DIGIKEY_SESSIONS.delete(sessionId);
}
__name(deleteSession, "deleteSession");
async function exchangeCodeForTokens(env, code, redirectUri) {
  const params = new URLSearchParams({
    code,
    client_id: env.DIGIKEY_CLIENT_ID,
    client_secret: env.DIGIKEY_CLIENT_SECRET,
    redirect_uri: redirectUri,
    grant_type: "authorization_code"
  });
  const response = await fetch(DIGIKEY_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString()
  });
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token exchange failed: ${response.status} - ${error}`);
  }
  return response.json();
}
__name(exchangeCodeForTokens, "exchangeCodeForTokens");
async function refreshAccessToken(env, refreshToken) {
  const params = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: env.DIGIKEY_CLIENT_ID,
    client_secret: env.DIGIKEY_CLIENT_SECRET,
    grant_type: "refresh_token"
  });
  const response = await fetch(DIGIKEY_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString()
  });
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token refresh failed: ${response.status} - ${error}`);
  }
  return response.json();
}
__name(refreshAccessToken, "refreshAccessToken");
async function getValidAccessToken(env, sessionId, session) {
  const now = Date.now();
  const bufferMs = 60 * 1e3;
  if (session.expires_at > now + bufferMs) {
    return session.access_token;
  }
  try {
    const tokens = await refreshAccessToken(env, session.refresh_token);
    const newSession = {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: now + tokens.expires_in * 1e3
    };
    await saveSession(env, sessionId, newSession);
    return tokens.access_token;
  } catch (error) {
    console.error("Failed to refresh token:", error);
    await deleteSession(env, sessionId);
    return null;
  }
}
__name(getValidAccessToken, "getValidAccessToken");
async function handleDigiKeyLogin(request, env) {
  const url = new URL(request.url);
  const returnUrl = url.searchParams.get("return_url") || url.origin + "/debug/";
  const redirectUri = `${url.origin}/auth/digikey/callback`;
  const state = btoa(JSON.stringify({ return_url: returnUrl }));
  const authUrl = new URL(DIGIKEY_AUTH_URL);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", env.DIGIKEY_CLIENT_ID);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("state", state);
  return Response.redirect(authUrl.toString(), 302);
}
__name(handleDigiKeyLogin, "handleDigiKeyLogin");
async function handleDigiKeyCallback(request, env) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  const errorDescription = url.searchParams.get("error_description");
  let returnUrl = url.origin + "/debug/";
  if (state) {
    try {
      const stateData = JSON.parse(atob(state));
      if (stateData.return_url) {
        returnUrl = stateData.return_url;
      }
    } catch {
    }
  }
  if (error) {
    const redirectUrl = new URL(returnUrl);
    redirectUrl.searchParams.set("digikey_error", error);
    if (errorDescription) {
      redirectUrl.searchParams.set("digikey_error_description", errorDescription);
    }
    return Response.redirect(redirectUrl.toString(), 302);
  }
  if (!code) {
    const redirectUrl = new URL(returnUrl);
    redirectUrl.searchParams.set("digikey_error", "missing_code");
    return Response.redirect(redirectUrl.toString(), 302);
  }
  try {
    const redirectUri = `${url.origin}/auth/digikey/callback`;
    const tokens = await exchangeCodeForTokens(env, code, redirectUri);
    const sessionId = generateSessionId();
    const session = {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: Date.now() + tokens.expires_in * 1e3
    };
    await saveSession(env, sessionId, session);
    const redirectUrl = new URL(returnUrl);
    redirectUrl.searchParams.set("digikey_connected", "true");
    const response = Response.redirect(redirectUrl.toString(), 302);
    return new Response(response.body, {
      status: response.status,
      headers: {
        ...Object.fromEntries(response.headers.entries()),
        "Set-Cookie": createSessionCookie(sessionId)
      }
    });
  } catch (err) {
    console.error("OAuth callback error:", err);
    const redirectUrl = new URL(returnUrl);
    redirectUrl.searchParams.set("digikey_error", "token_exchange_failed");
    redirectUrl.searchParams.set(
      "digikey_error_description",
      err instanceof Error ? err.message : "Unknown error"
    );
    return Response.redirect(redirectUrl.toString(), 302);
  }
}
__name(handleDigiKeyCallback, "handleDigiKeyCallback");
async function handleDigiKeyLogout(request, env) {
  const origin = request.headers.get("Origin");
  const sessionId = getSessionIdFromRequest(request);
  if (sessionId) {
    await deleteSession(env, sessionId);
  }
  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": createSessionCookie("", 0),
      ...corsHeaders(origin)
    }
  });
}
__name(handleDigiKeyLogout, "handleDigiKeyLogout");
async function handleDigiKeyStatus(request, env) {
  const origin = request.headers.get("Origin");
  const sessionId = getSessionIdFromRequest(request);
  if (!sessionId) {
    return jsonResponse(
      { connected: false, message: "Not connected to DigiKey" },
      200,
      corsHeaders(origin)
    );
  }
  const session = await getSession(env, sessionId);
  if (!session) {
    return jsonResponse(
      { connected: false, message: "Session expired" },
      200,
      { "Set-Cookie": createSessionCookie("", 0), ...corsHeaders(origin) }
    );
  }
  const accessToken = await getValidAccessToken(env, sessionId, session);
  return jsonResponse(
    {
      connected: !!accessToken,
      message: accessToken ? "Connected to DigiKey" : "Session expired, please reconnect"
    },
    200,
    corsHeaders(origin)
  );
}
__name(handleDigiKeyStatus, "handleDigiKeyStatus");
async function handleDigiKeySearch(request, env) {
  const origin = request.headers.get("Origin");
  const sessionId = getSessionIdFromRequest(request);
  if (!sessionId) {
    return jsonResponse(
      {
        success: false,
        error: "Not authenticated. Please connect your DigiKey account.",
        parts: [],
        total_count: 0
      },
      401,
      corsHeaders(origin)
    );
  }
  const session = await getSession(env, sessionId);
  if (!session) {
    return jsonResponse(
      {
        success: false,
        error: "Session expired. Please reconnect your DigiKey account.",
        parts: [],
        total_count: 0
      },
      401,
      { "Set-Cookie": createSessionCookie("", 0), ...corsHeaders(origin) }
    );
  }
  const accessToken = await getValidAccessToken(env, sessionId, session);
  if (!accessToken) {
    return jsonResponse(
      {
        success: false,
        error: "Session expired. Please reconnect your DigiKey account.",
        parts: [],
        total_count: 0
      },
      401,
      { "Set-Cookie": createSessionCookie("", 0), ...corsHeaders(origin) }
    );
  }
  let query;
  try {
    const body = await request.json();
    query = body.query || body.mpn || "";
    if (!query) {
      return jsonResponse(
        { query: "", success: false, error: "Missing search query", parts: [], total_count: 0 },
        400,
        corsHeaders(origin)
      );
    }
  } catch {
    return jsonResponse(
      { query: "", success: false, error: "Invalid request body", parts: [], total_count: 0 },
      400,
      corsHeaders(origin)
    );
  }
  const searchRequest = {
    Keywords: query,
    RecordCount: 10,
    RecordStartPosition: 0
  };
  try {
    const response = await fetch(DIGIKEY_SEARCH_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "X-DIGIKEY-Client-Id": env.DIGIKEY_CLIENT_ID,
        "X-DIGIKEY-Locale-Site": "US",
        "X-DIGIKEY-Locale-Language": "en",
        "X-DIGIKEY-Locale-Currency": "USD",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(searchRequest)
    });
    if (!response.ok) {
      const errorText = await response.text();
      console.error("DigiKey search failed:", response.status, errorText);
      return jsonResponse(
        { query, success: false, error: `DigiKey API error: ${response.status}`, parts: [], total_count: 0 },
        502,
        corsHeaders(origin)
      );
    }
    const searchResponse = await response.json();
    const parts = [];
    const seenMpns = /* @__PURE__ */ new Set();
    if (searchResponse.ExactDigiKeyProduct) {
      const converted = convertProduct(searchResponse.ExactDigiKeyProduct);
      if (converted.manufacturer_part_number) {
        seenMpns.add(converted.manufacturer_part_number);
      }
      parts.push(converted);
    }
    if (searchResponse.ExactManufacturerProducts) {
      for (const product of searchResponse.ExactManufacturerProducts) {
        const converted = convertProduct(product);
        if (converted.manufacturer_part_number && !seenMpns.has(converted.manufacturer_part_number)) {
          seenMpns.add(converted.manufacturer_part_number);
          parts.push(converted);
        }
      }
    }
    if (parts.length < 5 && searchResponse.Products) {
      for (const product of searchResponse.Products) {
        if (parts.length >= 10) break;
        const converted = convertProduct(product);
        if (converted.manufacturer_part_number && !seenMpns.has(converted.manufacturer_part_number)) {
          seenMpns.add(converted.manufacturer_part_number);
          parts.push(converted);
        }
      }
    }
    return jsonResponse(
      { query, success: true, error: null, parts, total_count: parts.length },
      200,
      corsHeaders(origin)
    );
  } catch (err) {
    console.error("DigiKey search error:", err);
    return jsonResponse(
      { query, success: false, error: err instanceof Error ? err.message : "Unknown error", parts: [], total_count: 0 },
      500,
      corsHeaders(origin)
    );
  }
}
__name(handleDigiKeySearch, "handleDigiKeySearch");
async function handleGitHubTokenExchange(request, env) {
  const origin = request.headers.get("Origin");
  let body;
  try {
    body = await request.json();
    if (!body.client_id || !body.code || !body.code_verifier) {
      return jsonResponse(
        { error: "invalid_request", error_description: "Missing required parameters" },
        400,
        corsHeaders(origin)
      );
    }
  } catch {
    return jsonResponse(
      { error: "invalid_request", error_description: "Invalid request body" },
      400,
      corsHeaders(origin)
    );
  }
  try {
    const params = new URLSearchParams({
      client_id: body.client_id,
      code: body.code,
      code_verifier: body.code_verifier
    });
    if (env.GITHUB_CLIENT_SECRET) {
      params.set("client_secret", env.GITHUB_CLIENT_SECRET);
    }
    if (body.redirect_uri) {
      params.set("redirect_uri", body.redirect_uri);
    }
    const response = await fetch(GITHUB_TOKEN_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: params.toString()
    });
    const contentType = response.headers.get("Content-Type") || "";
    let tokenResponse;
    if (contentType.includes("application/json")) {
      tokenResponse = await response.json();
    } else {
      const text = await response.text();
      tokenResponse = {};
      const searchParams = new URLSearchParams(text);
      for (const [key, value] of searchParams.entries()) {
        tokenResponse[key] = value;
      }
    }
    return jsonResponse(tokenResponse, response.ok ? 200 : 400, corsHeaders(origin));
  } catch (err) {
    console.error("GitHub token exchange error:", err);
    return jsonResponse(
      { error: "server_error", error_description: err instanceof Error ? err.message : "Unknown error" },
      500,
      corsHeaders(origin)
    );
  }
}
__name(handleGitHubTokenExchange, "handleGitHubTokenExchange");
var digikey_default = {
  async fetch(request, env, _ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    const origin = request.headers.get("Origin");
    if (method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(origin)
      });
    }
    try {
      if (path === "/auth/digikey/login" && method === "GET") {
        return handleDigiKeyLogin(request, env);
      }
      if (path === "/auth/digikey/callback" && method === "GET") {
        return handleDigiKeyCallback(request, env);
      }
      if (path === "/auth/digikey/logout" && method === "POST") {
        return handleDigiKeyLogout(request, env);
      }
      if (path === "/api/digikey/status" && method === "GET") {
        return handleDigiKeyStatus(request, env);
      }
      if (path === "/api/digikey/search" && method === "POST") {
        return handleDigiKeySearch(request, env);
      }
      if (path === "/api/github/token" && method === "POST") {
        return handleGitHubTokenExchange(request, env);
      }
      return env.ASSETS.fetch(request);
    } catch (err) {
      console.error("Worker error:", err);
      return jsonResponse(
        {
          error: "Internal server error",
          message: err instanceof Error ? err.message : "Unknown error"
        },
        500,
        corsHeaders(origin)
      );
    }
  }
};

// node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-PvB49o/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = digikey_default;

// node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-PvB49o/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=digikey.js.map
