/*
    XAI Settings Manager - Securely stores xAI API configuration in localStorage.
    
    The API key is stored with basic obfuscation (not true encryption) to prevent
    casual inspection. For production use, consider a proper secrets manager or
    having users authenticate through a secure backend.
*/

import { LocalStorage } from "../../base/local-storage";

/** XAI configuration settings */
export interface XAISettings {
    apiKey: string | null;
    baseUrl: string;
    model: string;
    thinkingModel: string;
}

/** Default xAI API configuration */
const XAI_DEFAULTS = {
    baseUrl: "https://api.x.ai/v1/chat/completions",
    model: "grok-4-1-fast",
    thinkingModel: "grok-4-1-fast",
} as const;

/** Key prefix for obfuscation */
const OBFUSCATION_PREFIX = "xai_v1_";

/**
 * Simple obfuscation for API keys.
 * This is NOT secure encryption - it's just to prevent casual inspection.
 * The key is base64 encoded with a prefix.
 */
function obfuscateKey(key: string): string {
    if (!key) return "";
    return OBFUSCATION_PREFIX + btoa(key);
}

/**
 * Reverse the obfuscation.
 */
function deobfuscateKey(obfuscated: string): string {
    if (!obfuscated || !obfuscated.startsWith(OBFUSCATION_PREFIX)) return "";
    try {
        return atob(obfuscated.slice(OBFUSCATION_PREFIX.length));
    } catch {
        return "";
    }
}

/**
 * XAI Settings Manager singleton.
 * Provides secure storage and retrieval of xAI API configuration.
 */
export class XAISettingsManager extends EventTarget {
    public static readonly INSTANCE = new XAISettingsManager();

    private storage = new LocalStorage("kc:xai");
    private _apiKey: string | null = null;
    private _baseUrl: string = XAI_DEFAULTS.baseUrl;
    private _model: string = XAI_DEFAULTS.model;
    private _thinkingModel: string = XAI_DEFAULTS.thinkingModel;

    private constructor() {
        super();
        this.load();
    }

    /** Check if the API is configured (has an API key) */
    get isConfigured(): boolean {
        return !!this._apiKey;
    }

    /** Get the API key (null if not configured) */
    get apiKey(): string | null {
        return this._apiKey;
    }

    /** Get the base URL for the xAI API */
    get baseUrl(): string {
        return this._baseUrl;
    }

    /** Get the default model for chat completions */
    get model(): string {
        return this._model;
    }

    /** Get the model for thinking/reasoning mode */
    get thinkingModel(): string {
        return this._thinkingModel;
    }

    /** Get all settings as an object */
    get settings(): XAISettings {
        return {
            apiKey: this._apiKey,
            baseUrl: this._baseUrl,
            model: this._model,
            thinkingModel: this._thinkingModel,
        };
    }

    /**
     * Set the API key and optionally save immediately.
     */
    setApiKey(key: string | null): void {
        this._apiKey = key;
    }

    /**
     * Set the base URL.
     */
    setBaseUrl(url: string): void {
        this._baseUrl = url || XAI_DEFAULTS.baseUrl;
    }

    /**
     * Set the default model.
     */
    setModel(model: string): void {
        this._model = model || XAI_DEFAULTS.model;
    }

    /**
     * Set the thinking model.
     */
    setThinkingModel(model: string): void {
        this._thinkingModel = model || XAI_DEFAULTS.thinkingModel;
    }

    /**
     * Update all settings at once.
     */
    updateSettings(settings: Partial<XAISettings>): void {
        if (settings.apiKey !== undefined) this._apiKey = settings.apiKey;
        if (settings.baseUrl !== undefined) this._baseUrl = settings.baseUrl || XAI_DEFAULTS.baseUrl;
        if (settings.model !== undefined) this._model = settings.model || XAI_DEFAULTS.model;
        if (settings.thinkingModel !== undefined) this._thinkingModel = settings.thinkingModel || XAI_DEFAULTS.thinkingModel;
    }

    /**
     * Save settings to localStorage.
     */
    save(): void {
        if (this._apiKey) {
            this.storage.set("apiKey", obfuscateKey(this._apiKey));
        } else {
            this.storage.delete("apiKey");
        }
        this.storage.set("baseUrl", this._baseUrl);
        this.storage.set("model", this._model);
        this.storage.set("thinkingModel", this._thinkingModel);
        
        this.dispatchEvent(new XAISettingsChangeEvent({ settings: this.settings }));
    }

    /**
     * Load settings from localStorage.
     */
    load(): void {
        const obfuscatedKey = this.storage.get("apiKey", "");
        this._apiKey = deobfuscateKey(obfuscatedKey) || null;
        this._baseUrl = this.storage.get("baseUrl", XAI_DEFAULTS.baseUrl);
        this._model = this.storage.get("model", XAI_DEFAULTS.model);
        this._thinkingModel = this.storage.get("thinkingModel", XAI_DEFAULTS.thinkingModel);
    }

    /**
     * Clear all settings.
     */
    clear(): void {
        this._apiKey = null;
        this._baseUrl = XAI_DEFAULTS.baseUrl;
        this._model = XAI_DEFAULTS.model;
        this._thinkingModel = XAI_DEFAULTS.thinkingModel;
        this.storage.delete("apiKey");
        this.storage.delete("baseUrl");
        this.storage.delete("model");
        this.storage.delete("thinkingModel");
        
        this.dispatchEvent(new XAISettingsChangeEvent({ settings: this.settings }));
    }

    /**
     * Test the API connection with the current settings.
     * Returns true if the connection is successful.
     */
    async testConnection(): Promise<{ success: boolean; error?: string }> {
        if (!this._apiKey) {
            return { success: false, error: "No API key configured" };
        }

        try {
            const response = await fetch(this._baseUrl, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${this._apiKey}`,
                },
                body: JSON.stringify({
                    model: this._model,
                    messages: [{ role: "user", content: "test" }],
                    max_tokens: 1,
                }),
            });

            if (response.status === 401) {
                return { success: false, error: "Invalid API key" };
            }
            if (response.status === 429) {
                return { success: false, error: "Rate limited - API key is valid" };
            }
            if (!response.ok) {
                const text = await response.text();
                return { success: false, error: `API error: ${response.status} ${text}` };
            }

            return { success: true };
        } catch (e) {
            return { 
                success: false, 
                error: e instanceof Error ? e.message : "Connection failed" 
            };
        }
    }
}

/** Event details for settings changes */
export interface XAISettingsChangeEventDetails {
    settings: XAISettings;
}

/** Event dispatched when XAI settings change */
export class XAISettingsChangeEvent extends CustomEvent<XAISettingsChangeEventDetails> {
    static readonly type = "xai:settings:change";

    constructor(detail: XAISettingsChangeEventDetails) {
        super(XAISettingsChangeEvent.type, {
            detail,
            composed: true,
            bubbles: true,
        });
    }
}

/** Singleton instance for convenience */
export const xaiSettings = XAISettingsManager.INSTANCE;

