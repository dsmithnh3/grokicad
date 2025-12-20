/**
 * Application Configuration (Frontend)
 * 
 * This module provides environment-specific configuration for the frontend application.
 * Configuration is determined at runtime based on the current hostname.
 * 
 * Uses centralized environment definitions from config/environments.ts
 */

import {
    type Environment,
    type EnvironmentDefinition,
    environments,
    detectEnvironmentFromHostname,
    GITHUB_OAUTH_SCOPES,
    GITHUB_RATE_LIMITS,
} from "../config/environments";

// Re-export types for convenience
export type { Environment, EnvironmentDefinition };

// =============================================================================
// Environment Detection
// =============================================================================

/**
 * Current environment (auto-detected from hostname)
 */
export const ENVIRONMENT: Environment = 
    typeof window !== "undefined" 
        ? detectEnvironmentFromHostname(window.location.hostname)
        : "development";

/**
 * Current environment configuration
 */
const envConfig: EnvironmentDefinition = environments[ENVIRONMENT];

// =============================================================================
// Exported Configuration Values
// =============================================================================

/**
 * API/Worker base URL
 * Empty string means same-origin (for deployed environments)
 * Full URL for development (pointing to deployed dev worker)
 */
export const API_BASE_URL = ENVIRONMENT === "development" 
    ? "https://grokicad-dev.mo0nbase.workers.dev"
    : "";

/**
 * DigiKey Worker URL (for backward compatibility)
 * @deprecated Use API_BASE_URL instead
 */
export const DIGIKEY_WORKER_URL = API_BASE_URL;

/**
 * GitHub OAuth Client ID
 */
export const GITHUB_CLIENT_ID = envConfig.githubClientId;

/**
 * GitHub OAuth scopes
 */
export { GITHUB_OAUTH_SCOPES };

/**
 * Enable debug mode
 */
export const DEBUG = envConfig.debug;

/**
 * GitHub API rate limits
 */
export { GITHUB_RATE_LIMITS };

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get full API URL for an endpoint
 * @param path API path (e.g., "/api/digikey/search")
 */
export function getApiUrl(path: string): string {
    const cleanPath = path.startsWith("/") ? path : `/${path}`;
    
    if (!API_BASE_URL) {
        return cleanPath;
    }
    
    return `${API_BASE_URL}${cleanPath}`;
}

// =============================================================================
// Debug Logging
// =============================================================================

if (DEBUG && typeof console !== "undefined") {
    console.log("[Config] Environment:", ENVIRONMENT);
    console.log("[Config] API Base URL:", API_BASE_URL || "(same-origin)");
    console.log("[Config] GitHub Client ID:", GITHUB_CLIENT_ID);
    console.log("[Config] Debug Mode:", DEBUG);
}
