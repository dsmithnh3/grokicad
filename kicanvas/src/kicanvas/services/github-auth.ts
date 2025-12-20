/*
    GitHub OAuth Service with PKCE Flow
    
    Implements GitHub OAuth 2.0 with PKCE for secure browser-based authentication.
    This allows users to access private repositories and get higher API rate limits.
    
    The entire PKCE flow runs in the browser - only the token exchange needs a
    CORS proxy because GitHub's token endpoint doesn't support CORS.
    
    Reference: https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps
*/

import { GITHUB_CLIENT_ID, GITHUB_OAUTH_SCOPES } from "../../config";

// ============================================================================
// Configuration
// ============================================================================

export interface GitHubAuthConfig {
    /** GitHub OAuth App Client ID */
    clientId: string;
    /** OAuth scopes to request */
    scopes: string[];
    /** Storage key for auth data */
    storageKey: string;
    /** PKCE state storage key */
    pkceStateKey: string;
}

const DEFAULT_CONFIG: GitHubAuthConfig = {
    clientId: GITHUB_CLIENT_ID,
    scopes: GITHUB_OAUTH_SCOPES,
    storageKey: "grokicad-github-auth",
    pkceStateKey: "grokicad-github-pkce",
};

// ============================================================================
// Types
// ============================================================================

export interface GitHubUser {
    id: number;
    login: string;
    name: string | null;
    avatar_url: string;
    html_url: string;
}

export interface GitHubAuthState {
    accessToken: string;
    tokenType: string;
    scope: string;
    user: GitHubUser | null;
}

interface PKCEState {
    codeVerifier: string;
    state: string;
    returnUrl: string;
}

// ============================================================================
// PKCE Utilities
// ============================================================================

/**
 * Generate a cryptographically secure random string for state parameter
 */
function generateRandomString(length: number): string {
    const array = new Uint8Array(length);
    crypto.getRandomValues(array);
    return Array.from(array, (byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, length);
}

/**
 * Generate a code verifier for PKCE (43-128 characters)
 */
function generateCodeVerifier(): string {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return base64UrlEncode(array);
}

/**
 * Generate a code challenge from a verifier using S256
 */
async function generateCodeChallenge(verifier: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(verifier);
    const digest = await crypto.subtle.digest("SHA-256", data);
    return base64UrlEncode(new Uint8Array(digest));
}

/**
 * Base64 URL encode (RFC 4648 § 5)
 */
function base64UrlEncode(buffer: Uint8Array): string {
    const base64 = btoa(String.fromCharCode(...buffer));
    return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ============================================================================
// GitHub Auth Service
// ============================================================================

/**
 * GitHub OAuth service with PKCE support.
 * 
 * All PKCE logic runs in the browser. Only the token exchange uses a
 * minimal CORS proxy because GitHub's token endpoint doesn't support CORS.
 */
export class GitHubAuthService {
    private static config: GitHubAuthConfig = { ...DEFAULT_CONFIG };
    private static authState: GitHubAuthState | null = null;
    private static listeners: Set<() => void> = new Set();

    /**
     * Configure the GitHub Auth service
     */
    static configure(config: Partial<GitHubAuthConfig>): void {
        this.config = { ...this.config, ...config };
    }

    /**
     * Get the current configuration
     */
    static getConfig(): Readonly<GitHubAuthConfig> {
        return { ...this.config };
    }

    /**
     * Check if the service is properly configured
     */
    static isConfigured(): boolean {
        return !!this.config.clientId;
    }

    /**
     * Initialize the service - load saved auth state
     */
    static initialize(): void {
        this.loadFromStorage();
    }

    /**
     * Check if user is authenticated
     */
    static isAuthenticated(): boolean {
        return !!this.authState?.accessToken;
    }

    /**
     * Get the current auth state
     */
    static getAuthState(): GitHubAuthState | null {
        return this.authState;
    }

    /**
     * Get the access token if authenticated
     */
    static getAccessToken(): string | null {
        return this.authState?.accessToken ?? null;
    }

    /**
     * Get the authenticated user
     */
    static getUser(): GitHubUser | null {
        return this.authState?.user ?? null;
    }

    /**
     * Subscribe to auth state changes
     */
    static subscribe(callback: () => void): () => void {
        this.listeners.add(callback);
        return () => this.listeners.delete(callback);
    }

    /**
     * Notify all listeners of state change
     */
    private static notifyListeners(): void {
        this.listeners.forEach((callback) => callback());
    }

    /**
     * Start the OAuth login flow with PKCE
     * Redirects the user to GitHub for authorization
     */
    static async startLogin(returnUrl?: string): Promise<void> {
        if (!this.config.clientId) {
            throw new Error("GitHub OAuth is not configured. Please set GITHUB_CLIENT_ID in config.ts");
        }

        // Generate PKCE values
        const codeVerifier = generateCodeVerifier();
        const codeChallenge = await generateCodeChallenge(codeVerifier);
        const state = generateRandomString(32);

        // Store PKCE state for callback (survives the redirect)
        const pkceState: PKCEState = {
            codeVerifier,
            state,
            returnUrl: returnUrl || window.location.href,
        };
        sessionStorage.setItem(this.config.pkceStateKey, JSON.stringify(pkceState));

        // Build the callback URL (same origin)
        const redirectUri = `${window.location.origin}${window.location.pathname}`;

        // Build authorization URL with PKCE parameters
        const authUrl = new URL("https://github.com/login/oauth/authorize");
        authUrl.searchParams.set("client_id", this.config.clientId);
        authUrl.searchParams.set("redirect_uri", redirectUri);
        authUrl.searchParams.set("scope", this.config.scopes.join(" "));
        authUrl.searchParams.set("state", state);
        authUrl.searchParams.set("code_challenge", codeChallenge);
        authUrl.searchParams.set("code_challenge_method", "S256");

        // Redirect to GitHub
        window.location.href = authUrl.toString();
    }

    /**
     * Check if we're returning from an OAuth redirect and handle it
     * Call this on page load to complete the auth flow
     */
    static async handleOAuthCallback(): Promise<boolean> {
        const urlParams = new URLSearchParams(window.location.search);
        const code = urlParams.get("code");
        const state = urlParams.get("state");
        const error = urlParams.get("error");

        // No OAuth params, nothing to handle
        if (!code && !error) {
            return false;
        }

        // Clean up URL immediately
        const cleanUrl = new URL(window.location.href);
        cleanUrl.searchParams.delete("code");
        cleanUrl.searchParams.delete("state");
        cleanUrl.searchParams.delete("error");
        cleanUrl.searchParams.delete("error_description");
        window.history.replaceState(null, "", cleanUrl.toString());

        if (error) {
            const description = urlParams.get("error_description") || error;
            console.error("[GitHubAuth] OAuth error:", description);
            throw new Error(`GitHub authentication failed: ${description}`);
        }

        if (!code) {
            throw new Error("Missing authorization code");
        }

        // Retrieve PKCE state
        const storedStateJson = sessionStorage.getItem(this.config.pkceStateKey);
        if (!storedStateJson) {
            throw new Error("No PKCE state found. Please try signing in again.");
        }

        const pkceState: PKCEState = JSON.parse(storedStateJson);
        sessionStorage.removeItem(this.config.pkceStateKey);

        // Validate state to prevent CSRF
        if (state !== pkceState.state) {
            throw new Error("State mismatch. Please try signing in again.");
        }

        // Exchange code for token via CORS proxy
        const redirectUri = `${window.location.origin}${window.location.pathname}`;
        const tokenResponse = await this.exchangeCodeForToken(
            code,
            pkceState.codeVerifier,
            redirectUri,
        );

        if (tokenResponse.error) {
            throw new Error(tokenResponse.error_description || tokenResponse.error);
        }

        // Fetch user info
        const user = await this.fetchUser(tokenResponse.access_token);

        // Save auth state
        this.authState = {
            accessToken: tokenResponse.access_token,
            tokenType: tokenResponse.token_type || "bearer",
            scope: tokenResponse.scope || "",
            user,
        };

        this.saveToStorage();
        this.notifyListeners();

        console.log("[GitHubAuth] Successfully authenticated as", user?.login);
        return true;
    }

    /**
     * Exchange authorization code for access token
     * Uses a CORS proxy because GitHub's token endpoint doesn't support CORS
     */
    private static async exchangeCodeForToken(
        code: string,
        codeVerifier: string,
        redirectUri: string,
    ): Promise<{
        access_token?: string;
        token_type?: string;
        scope?: string;
        error?: string;
        error_description?: string;
    }> {
        const response = await fetch("/api/github/token", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                client_id: this.config.clientId,
                code,
                code_verifier: codeVerifier,
                redirect_uri: redirectUri,
            }),
        });

        return response.json();
    }

    /**
     * Fetch the authenticated user's info
     */
    private static async fetchUser(accessToken: string): Promise<GitHubUser | null> {
        try {
            const response = await fetch("https://api.github.com/user", {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    Accept: "application/vnd.github+json",
                    "X-GitHub-Api-Version": "2022-11-28",
                },
            });

            if (!response.ok) {
                console.warn("[GitHubAuth] Failed to fetch user info:", response.status);
                return null;
            }

            const data = await response.json();
            return {
                id: data.id,
                login: data.login,
                name: data.name,
                avatar_url: data.avatar_url,
                html_url: data.html_url,
            };
        } catch (error) {
            console.warn("[GitHubAuth] Error fetching user:", error);
            return null;
        }
    }

    /**
     * Log out and clear auth state
     */
    static logout(): void {
        this.authState = null;
        localStorage.removeItem(this.config.storageKey);
        sessionStorage.removeItem(this.config.pkceStateKey);
        this.notifyListeners();
        console.log("[GitHubAuth] Logged out");
    }

    /**
     * Save auth state to localStorage
     */
    private static saveToStorage(): void {
        if (this.authState) {
            localStorage.setItem(this.config.storageKey, JSON.stringify(this.authState));
        }
    }

    /**
     * Load auth state from localStorage
     */
    private static loadFromStorage(): void {
        try {
            const stored = localStorage.getItem(this.config.storageKey);
            if (stored) {
                this.authState = JSON.parse(stored);
                console.log("[GitHubAuth] Loaded auth state for", this.authState?.user?.login);
            }
        } catch (error) {
            console.warn("[GitHubAuth] Failed to load auth state:", error);
            this.authState = null;
        }
    }

    /**
     * Get rate limit info
     */
    static async getRateLimit(): Promise<{
        limit: number;
        remaining: number;
        reset: Date;
        used: number;
    } | null> {
        try {
            const headers: HeadersInit = {
                Accept: "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
            };

            if (this.authState?.accessToken) {
                headers.Authorization = `Bearer ${this.authState.accessToken}`;
            }

            const response = await fetch("https://api.github.com/rate_limit", { headers });
            
            if (!response.ok) {
                return null;
            }

            const data = await response.json();
            const core = data.resources.core;

            return {
                limit: core.limit,
                remaining: core.remaining,
                reset: new Date(core.reset * 1000),
                used: core.used,
            };
        } catch {
            return null;
        }
    }
}

// Initialize on module load
if (typeof window !== "undefined") {
    GitHubAuthService.initialize();
}
