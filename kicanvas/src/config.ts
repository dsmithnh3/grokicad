/**
 * Application configuration constants
 * These are non-sensitive frontend constants that can be safely embedded in the bundle
 */

// Note: The backend has been fully migrated to the frontend.
// - Git operations use isomorphic-git in the browser
// - Schematic distillation runs in the browser
// - Grok AI uses xAI API directly from the browser
// - DigiKey integration uses OAuth 3-legged flow via Cloudflare Worker

/**
 * DigiKey Worker URL
 * 
 * In production (when deployed to Cloudflare), leave empty to use same-origin.
 * For local development, set to your deployed worker URL.
 * 
 * Replace with your actual worker URL after deploying:
 * e.g., "https://grokicad.your-subdomain.workers.dev"
 */
const isLocalDev = typeof window !== "undefined" && 
    (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");

export const DIGIKEY_WORKER_URL = isLocalDev 
    ? "https://grokicad.mo0nbase.workers.dev"
    : "";
