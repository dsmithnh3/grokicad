/**
 * DigiKey OAuth 3-Legged Flow Cloudflare Worker
 *
 * This worker implements the DigiKey OAuth 2.0 3-legged authorization flow,
 * allowing users to authenticate with their own DigiKey accounts to query
 * the DigiKey API directly.
 *
 * Flow:
 * 1. User clicks "Connect DigiKey" → redirected to /auth/digikey/login
 * 2. Worker redirects to DigiKey authorization page
 * 3. User authorizes → DigiKey redirects to /auth/digikey/callback
 * 4. Worker exchanges code for tokens, stores in KV, sets session cookie
 * 5. Frontend can now call /api/digikey/* endpoints using session cookie
 *
 * Required environment bindings:
 * - DIGIKEY_CLIENT_ID: DigiKey OAuth client ID
 * - DIGIKEY_CLIENT_SECRET: DigiKey OAuth client secret
 * - DIGIKEY_SESSIONS: KV namespace for storing user sessions/tokens
 */

export interface Env {
    DIGIKEY_CLIENT_ID: string;
    DIGIKEY_CLIENT_SECRET: string;
    DIGIKEY_SESSIONS: KVNamespace;
}

// DigiKey API endpoints
const DIGIKEY_AUTH_URL = "https://api.digikey.com/v1/oauth2/authorize";
const DIGIKEY_TOKEN_URL = "https://api.digikey.com/v1/oauth2/token";
const DIGIKEY_SEARCH_URL = "https://api.digikey.com/products/v4/search/keyword";

// Cookie/session configuration
const SESSION_COOKIE_NAME = "digikey_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

// Types
interface TokenResponse {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    token_type: string;
}

interface SessionData {
    access_token: string;
    refresh_token: string;
    expires_at: number; // Unix timestamp
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

// Utility functions
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

function createSessionCookie(
    sessionId: string,
    maxAge: number = SESSION_TTL_SECONDS,
): string {
    return `${SESSION_COOKIE_NAME}=${sessionId}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

function corsHeaders(origin: string | null): HeadersInit {
    return {
        "Access-Control-Allow-Origin": origin || "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Credentials": "true",
    };
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

// Convert DigiKey product to our normalized format
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

// Session management
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
): Promise<void> {
    await env.DIGIKEY_SESSIONS.put(sessionId, JSON.stringify(session), {
        expirationTtl: SESSION_TTL_SECONDS,
    });
}

async function deleteSession(env: Env, sessionId: string): Promise<void> {
    await env.DIGIKEY_SESSIONS.delete(sessionId);
}

// Token management
async function exchangeCodeForTokens(
    env: Env,
    code: string,
    redirectUri: string,
): Promise<TokenResponse> {
    const params = new URLSearchParams({
        code,
        client_id: env.DIGIKEY_CLIENT_ID,
        client_secret: env.DIGIKEY_CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
    });

    const response = await fetch(DIGIKEY_TOKEN_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
        },
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
): Promise<TokenResponse> {
    const params = new URLSearchParams({
        refresh_token: refreshToken,
        client_id: env.DIGIKEY_CLIENT_ID,
        client_secret: env.DIGIKEY_CLIENT_SECRET,
        grant_type: "refresh_token",
    });

    const response = await fetch(DIGIKEY_TOKEN_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params.toString(),
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Token refresh failed: ${response.status} - ${error}`);
    }

    return response.json();
}

// Get a valid access token, refreshing if necessary
async function getValidAccessToken(
    env: Env,
    sessionId: string,
    session: SessionData,
): Promise<string | null> {
    const now = Date.now();
    const bufferMs = 60 * 1000; // 1 minute buffer

    // Token is still valid
    if (session.expires_at > now + bufferMs) {
        return session.access_token;
    }

    // Need to refresh
    try {
        const tokens = await refreshAccessToken(env, session.refresh_token);
        const newSession: SessionData = {
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            expires_at: now + tokens.expires_in * 1000,
        };
        await saveSession(env, sessionId, newSession);
        return tokens.access_token;
    } catch (error) {
        console.error("Failed to refresh token:", error);
        // Delete invalid session
        await deleteSession(env, sessionId);
        return null;
    }
}

// Route handlers
async function handleLogin(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const returnUrl =
        url.searchParams.get("return_url") || url.origin + "/debug/";
    const redirectUri = `${url.origin}/auth/digikey/callback`;

    // Store return URL in state parameter (base64 encoded)
    const state = btoa(JSON.stringify({ return_url: returnUrl }));

    const authUrl = new URL(DIGIKEY_AUTH_URL);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("client_id", env.DIGIKEY_CLIENT_ID);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("state", state);

    return Response.redirect(authUrl.toString(), 302);
}

async function handleCallback(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");
    const errorDescription = url.searchParams.get("error_description");

    // Default return URL
    let returnUrl = url.origin + "/debug/";

    // Parse state to get return URL
    if (state) {
        try {
            const stateData = JSON.parse(atob(state));
            if (stateData.return_url) {
                returnUrl = stateData.return_url;
            }
        } catch {
            // Ignore parse errors, use default
        }
    }

    // Handle OAuth errors
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
        redirectUrl.searchParams.set(
            "digikey_error",
            "missing_code",
        );
        return Response.redirect(redirectUrl.toString(), 302);
    }

    try {
        // Exchange code for tokens
        const redirectUri = `${url.origin}/auth/digikey/callback`;
        const tokens = await exchangeCodeForTokens(env, code, redirectUri);

        // Create session
        const sessionId = generateSessionId();
        const session: SessionData = {
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            expires_at: Date.now() + tokens.expires_in * 1000,
        };
        await saveSession(env, sessionId, session);

        // Redirect back with session cookie
        const redirectUrl = new URL(returnUrl);
        redirectUrl.searchParams.set("digikey_connected", "true");

        const response = Response.redirect(redirectUrl.toString(), 302);
        return new Response(response.body, {
            status: response.status,
            headers: {
                ...Object.fromEntries(response.headers.entries()),
                "Set-Cookie": createSessionCookie(sessionId),
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

async function handleLogout(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get("Origin");
    const sessionId = getSessionIdFromRequest(request);

    if (sessionId) {
        await deleteSession(env, sessionId);
    }

    return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: {
            "Content-Type": "application/json",
            "Set-Cookie": createSessionCookie("", 0), // Clear cookie
            ...corsHeaders(origin),
        },
    });
}

async function handleStatus(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get("Origin");
    const sessionId = getSessionIdFromRequest(request);

    if (!sessionId) {
        return jsonResponse(
            {
                connected: false,
                message: "Not connected to DigiKey",
            },
            200,
            corsHeaders(origin),
        );
    }

    const session = await getSession(env, sessionId);
    if (!session) {
        return jsonResponse(
            {
                connected: false,
                message: "Session expired",
            },
            200,
            {
                "Set-Cookie": createSessionCookie("", 0), // Clear invalid cookie
                ...corsHeaders(origin),
            },
        );
    }

    // Check if token is still valid (or can be refreshed)
    const accessToken = await getValidAccessToken(env, sessionId, session);

    return jsonResponse(
        {
            connected: !!accessToken,
            message: accessToken
                ? "Connected to DigiKey"
                : "Session expired, please reconnect",
        },
        200,
        corsHeaders(origin),
    );
}

async function handleSearch(request: Request, env: Env): Promise<Response> {
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
            corsHeaders(origin),
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
                ...corsHeaders(origin),
            },
        );
    }

    const accessToken = await getValidAccessToken(env, sessionId, session);
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
                ...corsHeaders(origin),
            },
        );
    }

    // Parse request body
    let query: string;
    try {
        const body = await request.json();
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
                corsHeaders(origin),
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
            corsHeaders(origin),
        );
    }

    // Make DigiKey API request
    const searchRequest: KeywordSearchRequest = {
        Keywords: query,
        RecordCount: 10,
        RecordStartPosition: 0,
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
                corsHeaders(origin),
            );
        }

        const searchResponse: DigiKeySearchResponse = await response.json();

        // Build results, prioritizing exact matches
        const parts: ReturnType<typeof convertProduct>[] = [];
        const seenMpns = new Set<string>();

        // First, add exact DigiKey product if found
        if (searchResponse.ExactDigiKeyProduct) {
            const converted = convertProduct(searchResponse.ExactDigiKeyProduct);
            if (converted.manufacturer_part_number) {
                seenMpns.add(converted.manufacturer_part_number);
            }
            parts.push(converted);
        }

        // Then add exact manufacturer matches
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

        // Finally add general keyword matches if we don't have enough
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
            corsHeaders(origin),
        );
    } catch (err) {
        console.error("DigiKey search error:", err);
        return jsonResponse(
            {
                query,
                success: false,
                error:
                    err instanceof Error ? err.message : "Unknown error",
                parts: [],
                total_count: 0,
            },
            500,
            corsHeaders(origin),
        );
    }
}

// Main request handler
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

        // Handle CORS preflight
        if (method === "OPTIONS") {
            return new Response(null, {
                status: 204,
                headers: corsHeaders(origin),
            });
        }

        // Route requests
        try {
            // Auth routes
            if (path === "/auth/digikey/login" && method === "GET") {
                return handleLogin(request, env);
            }
            if (path === "/auth/digikey/callback" && method === "GET") {
                return handleCallback(request, env);
            }
            if (path === "/auth/digikey/logout" && method === "POST") {
                return handleLogout(request, env);
            }

            // API routes
            if (path === "/api/digikey/status" && method === "GET") {
                return handleStatus(request, env);
            }
            if (path === "/api/digikey/search" && method === "POST") {
                return handleSearch(request, env);
            }

            // Not found - pass through to static assets
            return new Response(null, { status: 404 });
        } catch (err) {
            console.error("Worker error:", err);
            return jsonResponse(
                {
                    error: "Internal server error",
                    message:
                        err instanceof Error ? err.message : "Unknown error",
                },
                500,
                corsHeaders(origin),
            );
        }
    },
};

