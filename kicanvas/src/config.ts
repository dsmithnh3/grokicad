/**
 * Application configuration constants
 * These are non-sensitive frontend constants that can be safely embedded in the bundle
 */

// Backend API base URL
// Set to empty string to use relative URLs (same origin)
// Or set to full URL like "https://api.example.com" for cross-origin requests
export const BACKEND_URL = "http://localhost:8080";

// API base URL - constructed from BACKEND_URL
export const API_BASE_URL = BACKEND_URL ? `${BACKEND_URL}/api` : "/api";

