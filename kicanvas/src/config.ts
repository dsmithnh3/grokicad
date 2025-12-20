/**
 * Application configuration constants
 * These are non-sensitive frontend constants that can be safely embedded in the bundle
 */

// Note: The backend has been fully migrated to the frontend.
// - Git operations use GitHub REST API directly
// - Schematic distillation runs in the browser
// - Grok AI uses xAI API directly from the browser
// - DigiKey integration uses OAuth 3-legged flow via Cloudflare Worker
// - GitHub authentication uses PKCE OAuth flow (no server-side secret needed)

const isLocalDev = typeof window !== "undefined" && 
    (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");

/**
 * DigiKey Worker URL
 * 
 * In production (when deployed to Cloudflare), leave empty to use same-origin.
 * For local development, set to your deployed worker URL.
 */
export const DIGIKEY_WORKER_URL = isLocalDev 
    ? "https://grokicad.mo0nbase.workers.dev"
    : "";

/**
 * GitHub OAuth Client ID
 * 
 * This is safe to expose in frontend code (it's not a secret).
 * PKCE (Proof Key for Code Exchange) is used for secure auth without a client secret.
 * 
 * To set up GitHub OAuth:
 * 1. Go to https://github.com/settings/developers
 * 2. Click "New OAuth App"
 * 3. Set "Authorization callback URL" to your app's URL (e.g., https://your-app.com/)
 * 4. Copy the Client ID here
 * 
 * Note: The callback URL should be your app's base URL. GitHub will redirect
 * back there with ?code=xxx, and the app handles the rest via PKCE.
 */
// export const GITHUB_CLIENT_ID = "Ov23liS2lfsBjHHh74s2";
export const GITHUB_CLIENT_ID =  "Ov23lieqDuahNqCy55dC";

/**
 * GitHub OAuth scopes
 * - repo: Access private repositories (read/write)
 * - read:user: Read user profile information
 */
export const GITHUB_OAUTH_SCOPES = ["repo", "read:user"];

/**
 * GitHub API rate limits (for reference)
 * - Unauthenticated: 60 requests/hour
 * - Authenticated: 5,000 requests/hour
 */
export const GITHUB_RATE_LIMITS = {
    unauthenticated: 60,
    authenticated: 5000,
};
