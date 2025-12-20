/**
 * Worker Configuration
 * 
 * This module provides environment-specific configuration for the Cloudflare Worker.
 * Uses centralized environment definitions from config/environments.ts
 */

import {
    type Environment,
    type EnvironmentDefinition,
    environments,
    OAUTH_URLS,
} from "../config/environments";

// Re-export for convenience
export type { Environment, EnvironmentDefinition };

// =============================================================================
// Worker-Specific Configuration
// =============================================================================

export interface WorkerConfig {
    /** Environment name */
    environment: Environment;
    
    /** Base URL for the application */
    appBaseUrl: string;
    
    /** Allowed CORS origins */
    allowedOrigins: string[];
    
    /** Session TTL in seconds */
    sessionTtl: number;
    
    /** Enable debug logging */
    debug: boolean;
    
    /** DigiKey OAuth URLs */
    digikey: {
        authUrl: string;
        tokenUrl: string;
        searchUrl: string;
    };
    
    /** GitHub OAuth URLs */
    github: {
        tokenUrl: string;
    };
}

/**
 * Build worker config from environment definition
 */
function buildWorkerConfig(env: Environment, def: EnvironmentDefinition): WorkerConfig {
    return {
        environment: env,
        appBaseUrl: def.appUrl,
        allowedOrigins: [...def.corsOrigins],
        sessionTtl: def.sessionTtl,
        debug: def.debug,
        digikey: {
            authUrl: OAUTH_URLS.digikey.getAuthUrl(def.digikeyApiBase),
            tokenUrl: OAUTH_URLS.digikey.getTokenUrl(def.digikeyApiBase),
            searchUrl: OAUTH_URLS.digikey.getSearchUrl(def.digikeyApiBase),
        },
        github: {
            tokenUrl: OAUTH_URLS.github.tokenUrl,
        },
    };
}

// Pre-built configs for each environment
const workerConfigs: Record<Environment, WorkerConfig> = {
    development: buildWorkerConfig("development", environments.development),
    beta: buildWorkerConfig("beta", environments.beta),
    production: buildWorkerConfig("production", environments.production),
};

// =============================================================================
// Public API
// =============================================================================

/**
 * Get configuration for the current environment
 */
export function getConfig(env: { ENVIRONMENT?: string }): WorkerConfig {
    const environment = (env.ENVIRONMENT || "development") as Environment;
    return workerConfigs[environment] ?? workerConfigs.development;
}

/**
 * Check if an origin is allowed for CORS
 */
export function isOriginAllowed(origin: string | null, config: WorkerConfig): boolean {
    if (!origin) return false;
    
    // In development, be more permissive with localhost
    if (config.debug && (origin.includes("localhost") || origin.includes("127.0.0.1"))) {
        return true;
    }
    
    return config.allowedOrigins.includes(origin);
}

/**
 * Get appropriate CORS headers based on origin and config
 */
export function getCorsHeaders(origin: string | null, config: WorkerConfig): HeadersInit {
    const allowedOrigin = isOriginAllowed(origin, config) ? origin : config.allowedOrigins[0];
    
    return {
        "Access-Control-Allow-Origin": allowedOrigin || "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Max-Age": "86400",
    };
}
