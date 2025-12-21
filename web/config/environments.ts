/**
 * Centralized Environment Configuration
 *
 * Single source of truth for all environment-specific values.
 * Both frontend (src/config.ts) and worker (worker/config.ts) derive from this.
 */

// =============================================================================
// Types
// =============================================================================

export type Environment = "development" | "beta" | "production";

export interface EnvironmentDefinition {
    /** Worker name in Cloudflare */
    workerName: string;

    /** Base URL for the application */
    appUrl: string;

    /** Allowed CORS origins */
    corsOrigins: string[];

    /** GitHub OAuth Client ID (safe for frontend) */
    githubClientId: string;

    /** DigiKey API environment (sandbox for dev, production for others) */
    digikeyApiBase: "sandbox-api.digikey.com" | "api.digikey.com";

    /** Session TTL in seconds */
    sessionTtl: number;

    /** Enable debug logging */
    debug: boolean;
}

// =============================================================================
// Environment Definitions
// =============================================================================

export const environments: Record<Environment, EnvironmentDefinition> = {
    development: {
        workerName: "grokicad-dev",
        appUrl: "http://localhost:8787",
        corsOrigins: [
            "http://localhost:8787",
            "http://127.0.0.1:8787",
            "http://localhost:5173",
            "https://grokicad-dev.mo0nbase.workers.dev",
        ],
        githubClientId: "Ov23liS2lfsBjHHh74s2",
        digikeyApiBase: "sandbox-api.digikey.com",
        sessionTtl: 60 * 60 * 24 * 7, // 7 days
        debug: true,
    },

    beta: {
        workerName: "grokicad-beta",
        appUrl: "https://beta.grokicad.com",
        corsOrigins: [
            "https://beta.grokicad.com",
            "https://grokicad-beta.pages.dev",
        ],
        githubClientId: "Ov23liY7YfRgpNNwEG1x",
        digikeyApiBase: "api.digikey.com",
        sessionTtl: 60 * 60 * 24 * 7, // 7 days
        debug: true,
    },

    production: {
        workerName: "grokicad",
        appUrl: "https://grokicad.com",
        corsOrigins: [
            "https://grokicad.com",
            "https://www.grokicad.com",
            "https://grokicad.pages.dev",
        ],
        githubClientId: "Ov23lieqDuahNqCy55dC",
        digikeyApiBase: "api.digikey.com",
        sessionTtl: 60 * 60 * 24 * 30, // 30 days
        debug: false,
    },
};

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get environment definition by name
 */
export function getEnvironment(name: Environment): EnvironmentDefinition {
    return environments[name];
}

/**
 * Detect environment from hostname (for frontend use)
 */
export function detectEnvironmentFromHostname(hostname: string): Environment {
    // Production
    if (hostname === "grokicad.com" || hostname === "www.grokicad.com") {
        return "production";
    }

    // Beta
    if (
        hostname === "beta.grokicad.com" ||
        hostname.includes("grokicad-beta")
    ) {
        return "beta";
    }

    // Development
    return "development";
}

// =============================================================================
// Derived URLs (computed from base config)
// =============================================================================

export const OAUTH_URLS = {
    github: {
        tokenUrl: "https://github.com/login/oauth/access_token",
    },
    digikey: {
        getAuthUrl: (base: EnvironmentDefinition["digikeyApiBase"]) =>
            `https://${base}/v1/oauth2/authorize`,
        getTokenUrl: (base: EnvironmentDefinition["digikeyApiBase"]) =>
            `https://${base}/v1/oauth2/token`,
        getSearchUrl: (base: EnvironmentDefinition["digikeyApiBase"]) =>
            `https://${base}/products/v4/search/keyword`,
    },
} as const;

// =============================================================================
// Common Constants
// =============================================================================

export const GITHUB_OAUTH_SCOPES = ["repo", "read:user"] as const;

export const GITHUB_RATE_LIMITS = {
    unauthenticated: 60,
    authenticated: 5000,
} as const;
