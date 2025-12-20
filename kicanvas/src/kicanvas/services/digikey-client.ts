/**
 * DigiKey API Client
 *
 * This client interacts with the DigiKey OAuth worker endpoints.
 * Users authenticate with their own DigiKey accounts using the 3-legged OAuth flow.
 *
 * Flow:
 * 1. Check status with getStatus() - returns whether user is connected
 * 2. If not connected, call login() to redirect user to DigiKey OAuth
 * 3. After OAuth callback, user is returned with session cookie set
 * 4. Use search() to query DigiKey API with user's credentials
 * 5. Call logout() to disconnect and clear session
 */

import { DIGIKEY_WORKER_URL } from "../../config";

// Types
export interface DigiKeyParameter {
    name: string;
    value: string;
}

export interface DigiKeyPartInfo {
    digikey_part_number: string | null;
    manufacturer_part_number: string | null;
    manufacturer: string | null;
    description: string | null;
    detailed_description: string | null;
    product_url: string | null;
    datasheet_url: string | null;
    photo_url: string | null;
    quantity_available: number | null;
    unit_price: number | null;
    product_status: string | null;
    is_obsolete: boolean;
    lifecycle_status: string | null;
    category: string | null;
    parameters: DigiKeyParameter[];
}

export interface DigiKeySearchResponse {
    query: string;
    success: boolean;
    error: string | null;
    parts: DigiKeyPartInfo[];
    total_count: number;
}

export interface DigiKeyStatusResponse {
    connected: boolean;
    message: string;
}

/**
 * DigiKey API client for the frontend.
 * Uses the Cloudflare Worker endpoints for OAuth and API calls.
 */
export class DigiKeyClient {
    private static baseUrl = DIGIKEY_WORKER_URL;

    /**
     * Set the base URL for the DigiKey worker endpoints.
     * Leave empty to use same origin (default for Cloudflare Workers).
     */
    static setBaseUrl(url: string): void {
        this.baseUrl = url.replace(/\/$/, ""); // Remove trailing slash
    }

    /**
     * Check if the user is connected to DigiKey.
     * Returns the connection status and a message.
     */
    static async getStatus(): Promise<DigiKeyStatusResponse> {
        try {
            const response = await fetch(`${this.baseUrl}/api/digikey/status`, {
                method: "GET",
                credentials: "include", // Include session cookie
            });

            if (!response.ok) {
                return {
                    connected: false,
                    message: `Failed to check status: ${response.status}`,
                };
            }

            return await response.json();
        } catch (error) {
            return {
                connected: false,
                message:
                    error instanceof Error
                        ? error.message
                        : "Failed to connect to server",
            };
        }
    }

    /**
     * Initiate DigiKey OAuth login.
     * Redirects the user to DigiKey for authorization.
     *
     * @param returnUrl - URL to return to after OAuth completes (defaults to current page)
     */
    static login(returnUrl?: string): void {
        const currentUrl = returnUrl || window.location.href;
        const loginUrl = new URL(`${this.baseUrl}/auth/digikey/login`, window.location.origin);
        loginUrl.searchParams.set("return_url", currentUrl);
        window.location.href = loginUrl.toString();
    }

    /**
     * Log out from DigiKey and clear the session.
     */
    static async logout(): Promise<boolean> {
        try {
            const response = await fetch(
                `${this.baseUrl}/auth/digikey/logout`,
                {
                    method: "POST",
                    credentials: "include",
                },
            );

            return response.ok;
        } catch {
            return false;
        }
    }

    /**
     * Search DigiKey for parts.
     *
     * @param query - Search query (part number, keyword, MPN, etc.)
     * @param mpn - Optional manufacturer part number for more precise search
     */
    static async search(
        query: string,
        mpn?: string,
    ): Promise<DigiKeySearchResponse> {
        try {
            const response = await fetch(
                `${this.baseUrl}/api/digikey/search`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    credentials: "include", // Include session cookie
                    body: JSON.stringify({ query, mpn }),
                },
            );

            // Handle 401 specially - means user needs to reconnect
            if (response.status === 401) {
                const data = await response.json();
                return {
                    query: mpn || query,
                    success: false,
                    error: data.error || "Not authenticated",
                    parts: [],
                    total_count: 0,
                };
            }

            if (!response.ok) {
                const errorText = await response.text().catch(() => "");
                return {
                    query: mpn || query,
                    success: false,
                    error: `Search failed: ${response.status}${errorText ? ` - ${errorText}` : ""}`,
                    parts: [],
                    total_count: 0,
                };
            }

            return await response.json();
        } catch (error) {
            return {
                query: mpn || query,
                success: false,
                error:
                    error instanceof Error
                        ? error.message
                        : "Failed to connect to server",
                parts: [],
                total_count: 0,
            };
        }
    }

    /**
     * Check URL parameters for OAuth callback status.
     * Call this on page load to handle OAuth results.
     *
     * Returns:
     * - { connected: true } if just connected
     * - { error, description } if OAuth failed
     * - null if no OAuth callback parameters present
     */
    static checkOAuthCallback(): {
        connected: boolean;
        error?: string;
        description?: string;
    } | null {
        const params = new URLSearchParams(window.location.search);

        // Check for success
        if (params.get("digikey_connected") === "true") {
            // Clean up URL
            this.cleanupOAuthParams();
            return { connected: true };
        }

        // Check for error
        const error = params.get("digikey_error");
        if (error) {
            const description =
                params.get("digikey_error_description") || undefined;
            // Clean up URL
            this.cleanupOAuthParams();
            return { connected: false, error, description };
        }

        return null;
    }

    /**
     * Remove OAuth callback parameters from the URL without reloading.
     */
    private static cleanupOAuthParams(): void {
        const url = new URL(window.location.href);
        url.searchParams.delete("digikey_connected");
        url.searchParams.delete("digikey_error");
        url.searchParams.delete("digikey_error_description");
        window.history.replaceState({}, "", url.toString());
    }

    /**
     * Check if DigiKey integration is available.
     * This is a quick check that the worker endpoints are reachable.
     */
    static async isAvailable(): Promise<boolean> {
        try {
            const response = await fetch(`${this.baseUrl}/api/digikey/status`, {
                method: "GET",
                credentials: "include",
            });
            return response.ok;
        } catch {
            return false;
        }
    }
}

// Default export for convenience
export default DigiKeyClient;

