/**
 * Application configuration constants
 * These are non-sensitive frontend constants that can be safely embedded in the bundle
 */

// Backend API base URL
// Note: The Grok AI functionality now runs entirely in the browser using the xAI API directly.
// The backend URL is only used for DigiKey integration (if enabled).
// Set to empty string to use relative URLs (same origin)
// Or set to full URL like "https://api.example.com" for cross-origin requests
export const BACKEND_URL = "http://localhost:8080";

// API base URL - constructed from BACKEND_URL (used for DigiKey integration only)
export const API_BASE_URL = BACKEND_URL ? `${BACKEND_URL}/api` : "/api";
