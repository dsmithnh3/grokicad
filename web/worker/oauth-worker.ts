/**
 * GrokiCAD Cloudflare Worker - OAuth & API Proxy
 *
 * This worker handles OAuth flows and API proxying for multiple services:
 * 1. DigiKey OAuth 3-Legged Flow
 * 2. GitHub OAuth token exchange (CORS proxy for PKCE flow)
 *
 * Required environment bindings:
 * - DIGIKEY_CLIENT_ID: DigiKey OAuth client ID
 * - DIGIKEY_CLIENT_SECRET: DigiKey OAuth client secret
 * - DIGIKEY_SESSIONS: KV namespace for storing DigiKey sessions
 * - GITHUB_CLIENT_SECRET: GitHub OAuth client secret (optional - only needed for OAuth Apps)
 * - ENVIRONMENT: Environment name (development, beta, production)
 */

import { getConfig, getCorsHeaders, type WorkerConfig } from "./config";

export interface Env {
    DIGIKEY_CLIENT_ID: string;
    DIGIKEY_CLIENT_SECRET: string;
    DIGIKEY_SESSIONS: KVNamespace;
    ASSETS: Fetcher;
    // GitHub OAuth (optional - only needed if using OAuth App, not GitHub App)
    GITHUB_CLIENT_SECRET?: string;
    // Environment identifier
    ENVIRONMENT?: string;
    // Basic auth for beta (optional)
    BETA_AUTH_USERNAME?: string;
    BETA_AUTH_PASSWORD?: string;
}

// ============================================================================
// Constants
// ============================================================================

const SESSION_COOKIE_NAME = "digikey_session";

// ============================================================================
// Types
// ============================================================================

interface TokenResponse {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    token_type: string;
}

interface SessionData {
    access_token: string;
    refresh_token: string;
    expires_at: number;
}

interface KeywordSearchRequest {
    Keywords: string;
    RecordCount: number;
    RecordStartPosition: number;
}

interface DigiKeyProduct {
    ManufacturerProductNumber?: string;
    Manufacturer?: { Name?: string };
    Description?: {
        ProductDescription?: string;
        DetailedDescription?: string;
    };
    ProductUrl?: string;
    DatasheetUrl?: string;
    PhotoUrl?: string;
    QuantityAvailable?: number;
    UnitPrice?: number;
    ProductStatus?: { Status?: string; Id?: number };
    Category?: { Name?: string };
    Parameters?: Array<{ ParameterText?: string; ValueText?: string }>;
    ProductVariations?: Array<{
        DigiKeyProductNumber?: string;
        PackageType?: { Name?: string };
    }>;
}

interface DigiKeySearchResponse {
    Products?: DigiKeyProduct[];
    ProductsCount?: number;
    ExactManufacturerProducts?: DigiKeyProduct[];
    ExactManufacturerProductsCount?: number;
    ExactDigiKeyProduct?: DigiKeyProduct;
}

// ============================================================================
// Utility Functions
// ============================================================================

function generateSessionId(): string {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}

function getSessionIdFromRequest(request: Request): string | null {
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

function createSessionCookie(sessionId: string, maxAge: number): string {
    return `${SESSION_COOKIE_NAME}=${sessionId}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

function jsonResponse(
    data: unknown,
    status: number = 200,
    headers: HeadersInit = {},
): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            "Content-Type": "application/json",
            ...headers,
        },
    });
}

// ============================================================================
// DigiKey Functions
// ============================================================================

function convertProduct(product: DigiKeyProduct) {
    const digikeyPartNumber =
        product.ProductVariations?.[0]?.DigiKeyProductNumber ?? null;

    const status = product.ProductStatus?.Status ?? null;
    const isObsolete = status
        ? /obsolete|discontinued|not for new designs|last time buy/i.test(
              status,
          )
        : false;

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
        parameters: (product.Parameters ?? [])
            .filter((p) => p.ParameterText)
            .map((p) => ({
                name: p.ParameterText!,
                value: p.ValueText ?? "",
            })),
    };
}

async function getSession(
    env: Env,
    sessionId: string,
): Promise<SessionData | null> {
    const data = await env.DIGIKEY_SESSIONS.get(sessionId, "json");
    return data as SessionData | null;
}

async function saveSession(
    env: Env,
    sessionId: string,
    session: SessionData,
    config: WorkerConfig,
): Promise<void> {
    await env.DIGIKEY_SESSIONS.put(sessionId, JSON.stringify(session), {
        expirationTtl: config.sessionTtl,
    });
}

async function deleteSession(env: Env, sessionId: string): Promise<void> {
    await env.DIGIKEY_SESSIONS.delete(sessionId);
}

async function exchangeCodeForTokens(
    env: Env,
    code: string,
    redirectUri: string,
    config: WorkerConfig,
): Promise<TokenResponse> {
    const params = new URLSearchParams({
        code,
        client_id: env.DIGIKEY_CLIENT_ID,
        client_secret: env.DIGIKEY_CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
    });

    const response = await fetch(config.digikey.tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Token exchange failed: ${response.status} - ${error}`);
    }

    return response.json();
}

async function refreshAccessToken(
    env: Env,
    refreshToken: string,
    config: WorkerConfig,
): Promise<TokenResponse> {
    const params = new URLSearchParams({
        refresh_token: refreshToken,
        client_id: env.DIGIKEY_CLIENT_ID,
        client_secret: env.DIGIKEY_CLIENT_SECRET,
        grant_type: "refresh_token",
    });

    const response = await fetch(config.digikey.tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Token refresh failed: ${response.status} - ${error}`);
    }

    return response.json();
}

async function getValidAccessToken(
    env: Env,
    sessionId: string,
    session: SessionData,
    config: WorkerConfig,
): Promise<string | null> {
    const now = Date.now();
    const bufferMs = 60 * 1000;

    if (session.expires_at > now + bufferMs) {
        return session.access_token;
    }

    try {
        const tokens = await refreshAccessToken(
            env,
            session.refresh_token,
            config,
        );
        const newSession: SessionData = {
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            expires_at: now + tokens.expires_in * 1000,
        };
        await saveSession(env, sessionId, newSession, config);
        return tokens.access_token;
    } catch (error) {
        console.error("Failed to refresh token:", error);
        await deleteSession(env, sessionId);
        return null;
    }
}

// ============================================================================
// DigiKey Route Handlers
// ============================================================================

async function handleDigiKeyLogin(
    request: Request,
    env: Env,
    config: WorkerConfig,
): Promise<Response> {
    const url = new URL(request.url);
    const returnUrl =
        url.searchParams.get("return_url") || url.origin + "/debug/";
    const redirectUri = `${url.origin}/auth/digikey/callback`;
    const state = btoa(JSON.stringify({ return_url: returnUrl }));

    const authUrl = new URL(config.digikey.authUrl);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("client_id", env.DIGIKEY_CLIENT_ID);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("state", state);

    return Response.redirect(authUrl.toString(), 302);
}

async function handleDigiKeyCallback(
    request: Request,
    env: Env,
    config: WorkerConfig,
): Promise<Response> {
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
            // Ignore parse errors
        }
    }

    if (error) {
        const redirectUrl = new URL(returnUrl);
        redirectUrl.searchParams.set("digikey_error", error);
        if (errorDescription) {
            redirectUrl.searchParams.set(
                "digikey_error_description",
                errorDescription,
            );
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
        const tokens = await exchangeCodeForTokens(
            env,
            code,
            redirectUri,
            config,
        );

        const sessionId = generateSessionId();
        const session: SessionData = {
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            expires_at: Date.now() + tokens.expires_in * 1000,
        };
        await saveSession(env, sessionId, session, config);

        const redirectUrl = new URL(returnUrl);
        redirectUrl.searchParams.set("digikey_connected", "true");

        const response = Response.redirect(redirectUrl.toString(), 302);
        return new Response(response.body, {
            status: response.status,
            headers: {
                ...Object.fromEntries(response.headers.entries()),
                "Set-Cookie": createSessionCookie(sessionId, config.sessionTtl),
            },
        });
    } catch (err) {
        console.error("OAuth callback error:", err);
        const redirectUrl = new URL(returnUrl);
        redirectUrl.searchParams.set("digikey_error", "token_exchange_failed");
        redirectUrl.searchParams.set(
            "digikey_error_description",
            err instanceof Error ? err.message : "Unknown error",
        );
        return Response.redirect(redirectUrl.toString(), 302);
    }
}

async function handleDigiKeyLogout(
    request: Request,
    env: Env,
    config: WorkerConfig,
): Promise<Response> {
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
            ...getCorsHeaders(origin, config),
        },
    });
}

async function handleDigiKeyStatus(
    request: Request,
    env: Env,
    config: WorkerConfig,
): Promise<Response> {
    const origin = request.headers.get("Origin");
    const sessionId = getSessionIdFromRequest(request);

    if (!sessionId) {
        return jsonResponse(
            { connected: false, message: "Not connected to DigiKey" },
            200,
            getCorsHeaders(origin, config),
        );
    }

    const session = await getSession(env, sessionId);
    if (!session) {
        return jsonResponse(
            { connected: false, message: "Session expired" },
            200,
            {
                "Set-Cookie": createSessionCookie("", 0),
                ...getCorsHeaders(origin, config),
            },
        );
    }

    const accessToken = await getValidAccessToken(
        env,
        sessionId,
        session,
        config,
    );

    return jsonResponse(
        {
            connected: !!accessToken,
            message: accessToken
                ? "Connected to DigiKey"
                : "Session expired, please reconnect",
        },
        200,
        getCorsHeaders(origin, config),
    );
}

async function handleDigiKeySearch(
    request: Request,
    env: Env,
    config: WorkerConfig,
): Promise<Response> {
    const origin = request.headers.get("Origin");
    const sessionId = getSessionIdFromRequest(request);

    if (!sessionId) {
        return jsonResponse(
            {
                success: false,
                error: "Not authenticated. Please connect your DigiKey account.",
                parts: [],
                total_count: 0,
            },
            401,
            getCorsHeaders(origin, config),
        );
    }

    const session = await getSession(env, sessionId);
    if (!session) {
        return jsonResponse(
            {
                success: false,
                error: "Session expired. Please reconnect your DigiKey account.",
                parts: [],
                total_count: 0,
            },
            401,
            {
                "Set-Cookie": createSessionCookie("", 0),
                ...getCorsHeaders(origin, config),
            },
        );
    }

    const accessToken = await getValidAccessToken(
        env,
        sessionId,
        session,
        config,
    );
    if (!accessToken) {
        return jsonResponse(
            {
                success: false,
                error: "Session expired. Please reconnect your DigiKey account.",
                parts: [],
                total_count: 0,
            },
            401,
            {
                "Set-Cookie": createSessionCookie("", 0),
                ...getCorsHeaders(origin, config),
            },
        );
    }

    let query: string;
    try {
        const body = (await request.json()) as { query?: string; mpn?: string };
        query = body.query || body.mpn || "";
        if (!query) {
            return jsonResponse(
                {
                    query: "",
                    success: false,
                    error: "Missing search query",
                    parts: [],
                    total_count: 0,
                },
                400,
                getCorsHeaders(origin, config),
            );
        }
    } catch {
        return jsonResponse(
            {
                query: "",
                success: false,
                error: "Invalid request body",
                parts: [],
                total_count: 0,
            },
            400,
            getCorsHeaders(origin, config),
        );
    }

    const searchRequest: KeywordSearchRequest = {
        Keywords: query,
        RecordCount: 10,
        RecordStartPosition: 0,
    };

    try {
        const response = await fetch(config.digikey.searchUrl, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${accessToken}`,
                "X-DIGIKEY-Client-Id": env.DIGIKEY_CLIENT_ID,
                "X-DIGIKEY-Locale-Site": "US",
                "X-DIGIKEY-Locale-Language": "en",
                "X-DIGIKEY-Locale-Currency": "USD",
                "Content-Type": "application/json",
            },
            body: JSON.stringify(searchRequest),
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error("DigiKey search failed:", response.status, errorText);
            return jsonResponse(
                {
                    query,
                    success: false,
                    error: `DigiKey API error: ${response.status}`,
                    parts: [],
                    total_count: 0,
                },
                502,
                getCorsHeaders(origin, config),
            );
        }

        const searchResponse: DigiKeySearchResponse = await response.json();

        const parts: ReturnType<typeof convertProduct>[] = [];
        const seenMpns = new Set<string>();

        if (searchResponse.ExactDigiKeyProduct) {
            const converted = convertProduct(
                searchResponse.ExactDigiKeyProduct,
            );
            if (converted.manufacturer_part_number) {
                seenMpns.add(converted.manufacturer_part_number);
            }
            parts.push(converted);
        }

        if (searchResponse.ExactManufacturerProducts) {
            for (const product of searchResponse.ExactManufacturerProducts) {
                const converted = convertProduct(product);
                if (
                    converted.manufacturer_part_number &&
                    !seenMpns.has(converted.manufacturer_part_number)
                ) {
                    seenMpns.add(converted.manufacturer_part_number);
                    parts.push(converted);
                }
            }
        }

        if (parts.length < 5 && searchResponse.Products) {
            for (const product of searchResponse.Products) {
                if (parts.length >= 10) break;
                const converted = convertProduct(product);
                if (
                    converted.manufacturer_part_number &&
                    !seenMpns.has(converted.manufacturer_part_number)
                ) {
                    seenMpns.add(converted.manufacturer_part_number);
                    parts.push(converted);
                }
            }
        }

        return jsonResponse(
            {
                query,
                success: true,
                error: null,
                parts,
                total_count: parts.length,
            },
            200,
            getCorsHeaders(origin, config),
        );
    } catch (err) {
        console.error("DigiKey search error:", err);
        return jsonResponse(
            {
                query,
                success: false,
                error: err instanceof Error ? err.message : "Unknown error",
                parts: [],
                total_count: 0,
            },
            500,
            getCorsHeaders(origin, config),
        );
    }
}

// ============================================================================
// GitHub Token Exchange (CORS proxy for PKCE flow)
// ============================================================================

/**
 * Proxy the GitHub token exchange to work around CORS restrictions.
 * The browser handles the PKCE flow, we proxy this request and add the client_secret.
 *
 * Note: GitHub OAuth Apps require client_secret even with PKCE.
 * PKCE adds security but doesn't replace the secret.
 * If GITHUB_CLIENT_SECRET is not set, we try without it (works for GitHub Apps).
 */
async function handleGitHubTokenExchange(
    request: Request,
    env: Env,
    config: WorkerConfig,
): Promise<Response> {
    const origin = request.headers.get("Origin");

    interface TokenRequestBody {
        client_id?: string;
        code?: string;
        code_verifier?: string;
        redirect_uri?: string;
    }

    let body: TokenRequestBody;

    try {
        body = (await request.json()) as TokenRequestBody;
        if (!body.client_id || !body.code || !body.code_verifier) {
            return jsonResponse(
                {
                    error: "invalid_request",
                    error_description: "Missing required parameters",
                },
                400,
                getCorsHeaders(origin, config),
            );
        }
    } catch {
        return jsonResponse(
            {
                error: "invalid_request",
                error_description: "Invalid request body",
            },
            400,
            getCorsHeaders(origin, config),
        );
    }

    try {
        // Build token exchange params
        const params = new URLSearchParams({
            client_id: body.client_id!,
            code: body.code!,
            code_verifier: body.code_verifier!,
        });

        // GitHub OAuth Apps require client_secret even with PKCE
        // If not set, try without (works for GitHub Apps which don't require it)
        if (env.GITHUB_CLIENT_SECRET) {
            params.set("client_secret", env.GITHUB_CLIENT_SECRET);
        }

        if (body.redirect_uri) {
            params.set("redirect_uri", body.redirect_uri);
        }

        const response = await fetch(config.github.tokenUrl, {
            method: "POST",
            headers: {
                Accept: "application/json",
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: params.toString(),
        });

        // GitHub may return JSON or URL-encoded depending on Accept header
        // Try JSON first, fall back to parsing URL-encoded response
        const contentType = response.headers.get("Content-Type") || "";
        let tokenResponse: Record<string, string>;

        if (contentType.includes("application/json")) {
            tokenResponse = await response.json();
        } else {
            // Parse URL-encoded response (application/x-www-form-urlencoded)
            const text = await response.text();
            tokenResponse = {};
            const searchParams = new URLSearchParams(text);
            for (const [key, value] of searchParams.entries()) {
                tokenResponse[key] = value;
            }
        }

        // Pass through the response (success or error)
        return jsonResponse(
            tokenResponse,
            response.ok ? 200 : 400,
            getCorsHeaders(origin, config),
        );
    } catch (err) {
        console.error("GitHub token exchange error:", err);
        return jsonResponse(
            {
                error: "server_error",
                error_description:
                    err instanceof Error ? err.message : "Unknown error",
            },
            500,
            getCorsHeaders(origin, config),
        );
    }
}

// ============================================================================
// Main Request Handler
// ============================================================================

export default {
    async fetch(
        request: Request,
        env: Env,
        _ctx: ExecutionContext,
    ): Promise<Response> {
        const url = new URL(request.url);
        const path = url.pathname;
        const method = request.method;
        const origin = request.headers.get("Origin");

        // Get environment-specific configuration
        const config = getConfig(env);

        // Log environment info in debug mode
        if (config.debug) {
            console.log(`[${config.environment}] ${method} ${path}`);
        }

        // Handle CORS preflight
        if (method === "OPTIONS") {
            return new Response(null, {
                status: 204,
                headers: getCorsHeaders(origin, config),
            });
        }

        // ============================================================
        // Basic Auth for Beta Environment
        // ============================================================
        if (
            config.environment === "beta" &&
            env.BETA_AUTH_USERNAME &&
            env.BETA_AUTH_PASSWORD
        ) {
            const auth = request.headers.get("Authorization");

            if (!auth) {
                return new Response("Authentication required", {
                    status: 401,
                    headers: {
                        "WWW-Authenticate": 'Basic realm="Beta Access"',
                    },
                });
            }

            const [scheme, encoded] = auth.split(" ");
            if (!encoded || scheme !== "Basic") {
                return new Response("Invalid authentication", { status: 401 });
            }

            const decoded = atob(encoded);
            const [username, password] = decoded.split(":");

            if (
                username !== env.BETA_AUTH_USERNAME ||
                password !== env.BETA_AUTH_PASSWORD
            ) {
                return new Response("Invalid credentials", {
                    status: 401,
                    headers: {
                        "WWW-Authenticate": 'Basic realm="Beta Access"',
                    },
                });
            }
        }

        try {
            // ============================================================
            // API Routes - Handle these BEFORE falling back to assets
            // ============================================================

            // DigiKey Auth Routes
            if (path === "/auth/digikey/login" && method === "GET") {
                return handleDigiKeyLogin(request, env, config);
            }
            if (path === "/auth/digikey/callback" && method === "GET") {
                return handleDigiKeyCallback(request, env, config);
            }
            if (path === "/auth/digikey/logout" && method === "POST") {
                return handleDigiKeyLogout(request, env, config);
            }

            // DigiKey API Routes
            if (path === "/api/digikey/status" && method === "GET") {
                return handleDigiKeyStatus(request, env, config);
            }
            if (path === "/api/digikey/search" && method === "POST") {
                return handleDigiKeySearch(request, env, config);
            }

            // GitHub Token Exchange (CORS proxy for PKCE)
            if (path === "/api/github/token" && method === "POST") {
                return handleGitHubTokenExchange(request, env, config);
            }

            // ============================================================
            // Static Assets - Fallback to serving files from /debug
            // ============================================================
            return env.ASSETS.fetch(request);
        } catch (err) {
            console.error("Worker error:", err);
            return jsonResponse(
                {
                    error: "Internal server error",
                    message:
                        err instanceof Error ? err.message : "Unknown error",
                },
                500,
                getCorsHeaders(origin, config),
            );
        }
    },
};
