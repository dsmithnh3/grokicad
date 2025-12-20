/*
    Copyright (c) 2023 Alethea Katherine Flowers.
    Published under the standard MIT License.
    Full text available at: https://opensource.org/licenses/MIT
*/

import { later } from "../../base/async";
import { DropTarget } from "../../base/dom/drag-drop";
import { CSS, attribute, html, query } from "../../base/web-components";
import { KCUIElement, KCUIIconElement } from "../../kc-ui";
import { sprites_url } from "../icons/sprites";
import { Project } from "../project";
import { FetchFileSystem, type VirtualFileSystem } from "../services/vfs";
import { CommitFileSystem } from "../services/commit-vfs";
import { GrokiAPI } from "../services/api";
import { GitService, GitServiceError, type CachedRepoInfo } from "../services/git-service";
import { xaiSettings } from "../services/xai-settings";
import { KCBoardAppElement } from "./kc-board/app";
import { KCSchematicAppElement } from "./kc-schematic/app";
import kc_ui_styles from "../../kc-ui/kc-ui.css";
import shell_styles from "./kicanvas-shell.css";

import "../icons/sprites";
import "./common/project-panel";

// Setup KCUIIconElement to use icon sprites.
KCUIIconElement.sprites_url = sprites_url;

/**
 * <kc-kicanvas-shell> is the main entrypoint for the standalone KiCanvas
 * application- it's the thing you see when you go to kicanvas.org.
 *
 * The shell is responsible for managing the currently loaded Project and
 * switching between the different viewer apps (<kc-schematic-app>,
 * <kc-board-app>).
 *
 * This is a simplified version of the subtree:
 *
 * <kc-kicanvas-shell>
 *   <kc-ui-app>
 *     <kc-project-panel>
 *     <kc-schematic-app>
 *       <kc-schematic-viewer>
 *       <kc-ui-activity-side-bar>
 *         <kc-schematic-git-panel> (commit history)
 *     <kc-board-app>
 *       <kc-board-viewer>
 *       <kc-ui-activity-side-bar>
 *
 */
class KiCanvasShellElement extends KCUIElement {
    static override styles = [
        ...KCUIElement.styles,
        // TODO: Figure out a better way to handle these two styles.
        new CSS(kc_ui_styles),
        new CSS(shell_styles),
    ];

    project: Project = new Project();

    #schematic_app: KCSchematicAppElement;
    #board_app: KCBoardAppElement;
    #current_repo: string | null = null;
    #current_commit: string | null = null;
    #cached_repos: CachedRepoInfo[] = [];
    #eventListeners: Array<{ element: Element; event: string; handler: EventListener }> = [];
    
    // Loading progress state
    #cloneProgress: { phase: string; loaded: number; total: number } | null = null;
    #storageInfo: { usage: number; quota: number; usagePercent: number } | null = null;
    
    // API Settings state
    #apiSettingsExpanded: boolean = false;
    #apiKeyInput: string = "";
    #apiBaseUrlInput: string = "";
    #apiStatusMessage: string = "";
    #apiStatusType: "success" | "error" | "info" | "" = "";
    #isTestingConnection: boolean = false;

    constructor() {
        super();
        this.provideContext("project", this.project);
        this.provideLazyContext("repoInfo", () => ({
            repo: this.#current_repo,
            commit: this.#current_commit,
        }));
    }

    @attribute({ type: Boolean })
    public loading: boolean;

    @attribute({ type: Boolean })
    public loaded: boolean;

    @attribute({ type: String })
    public error: string;

    @attribute({ type: String })
    public src: string;

    @query(`input[name="link"]`, true)
    public link_input: HTMLInputElement;

    override initialContentCallback() {
        const url_params = new URLSearchParams(document.location.search);
        const github_paths = url_params.getAll("github");

        later(async () => {
            // Load cached repos from IndexedDB
            await this.refreshCachedRepos();
            
            // Load storage info (don't trigger update, will be included in next render)
            await this.refreshStorageInfo();

            if (this.src) {
                const vfs = new FetchFileSystem([this.src]);
                await this.setup_project(vfs);
                return;
            }

            if (github_paths.length) {
                // Extract repo from the first GitHub URL
                const repo = GrokiAPI.extractRepoFromUrl(github_paths[0]!);
                if (repo) {
                    this.#current_repo = repo;
                    // Load via isomorphic-git in the browser
                    await this.loadFromGitHub(repo);
                } else {
                    console.error("Could not extract repo from GitHub URL");
                }
                return;
            }

            new DropTarget(this, async (fs) => {
                // For drag+drop, we don't have commit history
                this.#current_repo = null;
                this.#current_commit = null;
                this.clearError();
                await this.setup_project(fs);
            });
        });

        // Clear error when user types
        this.link_input.addEventListener("input", () => {
            this.clearError();
        });

        // Load on Enter key
        this.link_input.addEventListener("keydown", async (e) => {
            if (e.key !== "Enter") {
                return;
            }
            e.preventDefault();

            const link = this.link_input.value;

            // Extract repo from the link
            const repo = GrokiAPI.extractRepoFromUrl(link);
            if (!repo) {
                return;
            }

            this.#current_repo = repo;
            await this.loadFromGitHub(repo);

            const location = new URL(window.location.href);
            location.searchParams.set("github", link);
            window.history.pushState(null, "", location);
        });

        // Listen for commit selection events from the history panel
        this.addEventListener("commit-select", async (e: Event) => {
            const detail = (e as CustomEvent).detail;
            await this.loadCommit(detail.repo, detail.commit);
        });

        // Wait a tick for initial render, then setup button listeners
        // This ensures they're set up after the DOM is ready
        later(() => {
            this.setupExampleButtons();
            this.setupCachedRepoListeners();
            this.setupApiSettingsListeners();
        });
        
        // Initialize API settings inputs from stored values
        this.#apiKeyInput = xaiSettings.apiKey ?? "";
        this.#apiBaseUrlInput = xaiSettings.baseUrl;
    }

    /**
     * Refresh the list of cached repositories from IndexedDB
     */
    private async refreshCachedRepos(): Promise<void> {
        try {
            this.#cached_repos = await GitService.getCachedRepos();
            // Also refresh storage info when repo list changes
            await this.refreshStorageInfo();
            this.update();
            // Re-setup listeners after update (all interactive elements)
            later(() => this.reattachAllListeners());
        } catch (e) {
            console.error("Failed to load cached repos:", e);
        }
    }

    /**
     * Clean up all tracked event listeners to prevent memory leaks
     */
    private cleanupEventListeners(): void {
        for (const { element, event, handler } of this.#eventListeners) {
            element.removeEventListener(event, handler);
        }
        this.#eventListeners = [];
    }

    /**
     * Re-setup all interactive element listeners after a DOM update
     */
    private reattachAllListeners(): void {
        this.cleanupEventListeners();
        this.setupExampleButtons();
        this.setupCachedRepoListeners();
        this.setupApiSettingsListeners();
    }

    /**
     * Called when the element is removed from the DOM
     * Clean up event listeners and other resources
     */
    override disconnectedCallback(): void {
        super.disconnectedCallback();
        this.cleanupEventListeners();
    }

    /**
     * Setup event listeners for example buttons
     * Called after render/update to ensure listeners are attached to current DOM
     */
    private setupExampleButtons(): void {
        const exampleBtns = this.renderRoot.querySelectorAll(
            "#grok-watch-btn, #ubms-btn",
        );
        exampleBtns.forEach((btn) => {
            const handler = (e: Event) => this.loadExample(e as MouseEvent);
            btn.addEventListener("click", handler);
            this.#eventListeners.push({
                element: btn,
                event: "click",
                handler,
            });
        });
    }

    /**
     * Setup event listeners for cached repo buttons
     */
    private setupCachedRepoListeners(): void {
        // Cached repo buttons
        const cachedBtns = this.renderRoot.querySelectorAll(".cached-repo-btn");
        cachedBtns.forEach((btn) => {
            const handler = (e: Event) => {
                const target = e.currentTarget as HTMLButtonElement;
                const slug = target.dataset["slug"];
                if (slug) {
                    this.loadCachedRepo(slug);
                }
            };
            btn.addEventListener("click", handler);
            this.#eventListeners.push({
                element: btn,
                event: "click",
                handler,
            });
        });

        // Delete individual repo buttons
        const deleteBtns = this.renderRoot.querySelectorAll(".delete-repo-btn");
        deleteBtns.forEach((btn) => {
            const handler = async (e: Event) => {
                e.stopPropagation();
                const target = e.currentTarget as HTMLButtonElement;
                const slug = target.dataset["slug"];
                if (slug) {
                    try {
                        await GitService.invalidateCache(slug);
                        await this.refreshCachedRepos();
                    } catch (error) {
                        console.error("Failed to invalidate cache:", error);
                        this.showError(
                            `Failed to remove repository from cache: ${error instanceof Error ? error.message : "Unknown error"}`,
                        );
                    }
                }
            };
            btn.addEventListener("click", handler);
            this.#eventListeners.push({
                element: btn,
                event: "click",
                handler,
            });
        });

        // Clear all cache button
        const clearBtn = this.renderRoot.querySelector("#clear-cache-btn");
        if (clearBtn) {
            const handler = async () => {
                if (
                    confirm(
                        "Clear all cached repositories? This will free up storage space.",
                    )
                ) {
                    try {
                        await GitService.clearAllCaches();
                        await this.refreshCachedRepos();
                    } catch (error) {
                        console.error("Failed to clear caches:", error);
                        this.showError(
                            `Failed to clear cache: ${error instanceof Error ? error.message : "Unknown error"}`,
                        );
                    }
                }
            };
            clearBtn.addEventListener("click", handler);
            this.#eventListeners.push({
                element: clearBtn,
                event: "click",
                handler,
            });
        }
    }

    /**
     * Setup event listeners for API settings panel
     */
    private setupApiSettingsListeners(): void {
        // Toggle API settings panel
        const apiHeader = this.renderRoot.querySelector(".api-settings-header");
        if (apiHeader) {
            const handler = () => {
                this.#apiSettingsExpanded = !this.#apiSettingsExpanded;
                this.update();
                later(() => this.reattachAllListeners());
            };
            apiHeader.addEventListener("click", handler);
            this.#eventListeners.push({
                element: apiHeader,
                event: "click",
                handler,
            });
        }

        // API Key input
        const apiKeyInput = this.renderRoot.querySelector("#api-key-input") as HTMLInputElement;
        if (apiKeyInput) {
            const handler = (e: Event) => {
                this.#apiKeyInput = (e.target as HTMLInputElement).value;
                this.#apiStatusMessage = "";
                this.#apiStatusType = "";
            };
            apiKeyInput.addEventListener("input", handler);
            this.#eventListeners.push({
                element: apiKeyInput,
                event: "input",
                handler,
            });
        }

        // Base URL input
        const baseUrlInput = this.renderRoot.querySelector("#api-base-url-input") as HTMLInputElement;
        if (baseUrlInput) {
            const handler = (e: Event) => {
                this.#apiBaseUrlInput = (e.target as HTMLInputElement).value;
                this.#apiStatusMessage = "";
                this.#apiStatusType = "";
            };
            baseUrlInput.addEventListener("input", handler);
            this.#eventListeners.push({
                element: baseUrlInput,
                event: "input",
                handler,
            });
        }

        // Save button
        const saveBtn = this.renderRoot.querySelector(".api-buttons .save-btn");
        if (saveBtn) {
            const handler = () => {
                this.saveApiSettings();
            };
            saveBtn.addEventListener("click", handler);
            this.#eventListeners.push({
                element: saveBtn,
                event: "click",
                handler,
            });
        }

        // Clear button
        const clearBtn = this.renderRoot.querySelector(".api-buttons .clear-btn");
        if (clearBtn) {
            const handler = () => {
                this.clearApiSettings();
            };
            clearBtn.addEventListener("click", handler);
            this.#eventListeners.push({
                element: clearBtn,
                event: "click",
                handler,
            });
        }

        // Test button
        const testBtn = this.renderRoot.querySelector(".api-buttons .test-btn");
        if (testBtn) {
            const handler = () => {
                this.testApiConnection();
            };
            testBtn.addEventListener("click", handler);
            this.#eventListeners.push({
                element: testBtn,
                event: "click",
                handler,
            });
        }
    }

    /**
     * Save API settings
     */
    private saveApiSettings(): void {
        xaiSettings.setApiKey(this.#apiKeyInput || null);
        xaiSettings.setBaseUrl(this.#apiBaseUrlInput);
        xaiSettings.save();
        
        this.#apiStatusMessage = "Settings saved successfully!";
        this.#apiStatusType = "success";
        this.update();
        later(() => this.reattachAllListeners());
    }

    /**
     * Clear API settings
     */
    private clearApiSettings(): void {
        xaiSettings.clear();
        this.#apiKeyInput = "";
        this.#apiBaseUrlInput = xaiSettings.baseUrl;
        this.#apiStatusMessage = "Settings cleared";
        this.#apiStatusType = "info";
        this.update();
        later(() => this.reattachAllListeners());
    }

    /**
     * Test API connection
     */
    private async testApiConnection(): Promise<void> {
        if (!this.#apiKeyInput) {
            this.#apiStatusMessage = "Please enter an API key first";
            this.#apiStatusType = "error";
            this.update();
            later(() => this.reattachAllListeners());
            return;
        }

        this.#isTestingConnection = true;
        this.#apiStatusMessage = "Testing connection...";
        this.#apiStatusType = "info";
        this.update();
        later(() => this.reattachAllListeners());

        // Temporarily save settings for testing
        const originalKey = xaiSettings.apiKey;
        const originalUrl = xaiSettings.baseUrl;
        
        xaiSettings.setApiKey(this.#apiKeyInput);
        xaiSettings.setBaseUrl(this.#apiBaseUrlInput);

        const result = await xaiSettings.testConnection();

        // Restore original settings if not saved
        xaiSettings.setApiKey(originalKey);
        xaiSettings.setBaseUrl(originalUrl);

        this.#isTestingConnection = false;
        if (result.success) {
            this.#apiStatusMessage = "Connection successful! Click Save to keep these settings.";
            this.#apiStatusType = "success";
        } else {
            this.#apiStatusMessage = result.error || "Connection failed";
            this.#apiStatusType = "error";
        }
        this.update();
        later(() => this.reattachAllListeners());
    }

    /**
     * Load a cached repository
     */
    private async loadCachedRepo(slug: string): Promise<void> {
        this.#current_repo = slug;
        this.link_input.value = `https://github.com/${slug}`;
        await this.loadFromGitHub(slug);

        const location = new URL(window.location.href);
        location.searchParams.set("github", `https://github.com/${slug}`);
        window.history.pushState(null, "", location);
    }
    
    /**
     * Refresh storage quota information
     */
    private async refreshStorageInfo(): Promise<void> {
        this.#storageInfo = await GitService.getStorageQuota();
        // Don't call this.update() here - let the caller handle updates
        // to avoid unnecessary re-renders and listener detachment
    }

    /**
     * Load repository using isomorphic-git in the browser (no backend required)
     */
    private async loadFromGitHub(repo: string): Promise<void> {
        this.loaded = false;
        this.loading = true;
        this.removeAttribute("error");
        this.#cloneProgress = null;

        try {
            // Clone repo and get commits using isomorphic-git with progress tracking
            const commits = await GrokiAPI.getCommits(repo, (progress) => {
                this.#cloneProgress = progress;
                this.update();
            });

            if (commits.length > 0) {
                // Load the most recent commit
                const latestCommit = commits[0]!.commit_hash;
                this.#current_commit = latestCommit;

                // Load the schematic files for this commit
                const vfs = await CommitFileSystem.fromCommit(
                    repo,
                    latestCommit,
                );
                await this.setup_project(vfs);

                // Refresh cached repos list (repo is now cached in IndexedDB)
                // This also refreshes storage info
                await this.refreshCachedRepos();
            } else {
                throw new Error("No commits with schematic files found");
            }
        } catch (e) {
            console.error("Failed to load from GitHub:", e);
            this.loading = false;

            // Provide user-friendly error messages based on error type
            let errorMessage = "Failed to load schematic.";

            if (e instanceof GitServiceError) {
                // Use typed error codes for precise error handling
                switch (e.code) {
                    case "TIMEOUT":
                        errorMessage =
                            "Request timed out. The repository may be too large. Please try a smaller repository.";
                        break;
                    case "NOT_FOUND":
                        errorMessage =
                            "Repository not found. Please check that the repository exists and is public.";
                        break;
                    case "NETWORK_ERROR":
                        errorMessage =
                            "Network error. Please check your internet connection and try again.";
                        break;
                    case "DB_ERROR":
                        errorMessage =
                            "Storage quota exceeded. Please clear some cached repositories and try again.";
                        break;
                    case "INVALID_REPO":
                        errorMessage = e.message;
                        break;
                    case "CLONE_FAILED":
                    default:
                        errorMessage = `${e.message}. Please check that the repository exists and is public.`;
                        break;
                }
            } else if (e instanceof Error) {
                // Fallback for non-GitServiceError exceptions
                if (e.message.includes("quota") || e.message.includes("QuotaExceededError")) {
                    errorMessage =
                        "Storage quota exceeded. Please clear some cached repositories and try again.";
                } else {
                    errorMessage = `${e.message}. Please check that the repository exists and is public.`;
                }
            }

            this.showError(errorMessage);
        }
    }

    /**
     * Load a specific commit
     */
    private async loadCommit(repo: string, commit: string): Promise<void> {
        if (this.#current_commit === commit) {
            return;
        }

        this.loaded = false;
        this.loading = true;
        this.removeAttribute("error");
        this.#current_commit = commit;

        try {
            const vfs = await CommitFileSystem.fromCommit(repo, commit);
            await this.setup_project(vfs);
        } catch (e) {
            console.error("Failed to load commit:", e);
            this.loading = false;
            this.showError(
                `Failed to load commit ${commit.substring(0, 7)}: ${e instanceof Error ? e.message : "Unknown error"}`,
            );
        }
    }

    /**
     * Show error message
     */
    private showError(message: string): void {
        const errorBar = this.renderRoot.querySelector(".error-bar");
        if (errorBar) errorBar.textContent = message;
        this.error = message;
    }

    /**
     * Clear error state
     */
    private clearError(): void {
        const errorBar = this.renderRoot.querySelector(".error-bar");
        if (errorBar) errorBar.textContent = "";
        this.removeAttribute("error");
    }

    private async setup_project(vfs: VirtualFileSystem) {
        this.loaded = false;
        this.loading = true;

        try {
            await this.project.load(vfs);
            // Prefer schematic pages over board pages
            const schematicPage =
                this.project.root_schematic_page ?? this.project.first_page;
            this.project.set_active_page(schematicPage);
            this.loaded = true;
        } catch (e) {
            console.error(e);
        } finally {
            this.loading = false;
        }
    }

    private loadExample(e: MouseEvent): void {
        const button = e.currentTarget as HTMLButtonElement;
        const repoUrl = button.dataset['repo'];
        if (!repoUrl) return;
        this.link_input.value = repoUrl;
        const repo = GrokiAPI.extractRepoFromUrl(repoUrl);
        if (repo) {
            this.#current_repo = repo;
            this.loadFromGitHub(repo).then(() => {
                const location = new URL(window.location.href);
                location.searchParams.set("github", repoUrl);
                window.history.pushState(null, "", location);
            });
        }
    }

    /**
     * Format a date string as relative time (e.g., "2 hours ago")
     */
    private formatRelativeDate(isoDate: string): string {
        const date = new Date(isoDate);
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffSecs = Math.floor(diffMs / 1000);
        const diffMins = Math.floor(diffSecs / 60);
        const diffHours = Math.floor(diffMins / 60);
        const diffDays = Math.floor(diffHours / 24);

        if (diffSecs < 60) return "just now";
        if (diffMins < 60) return `${diffMins}m ago`;
        if (diffHours < 24) return `${diffHours}h ago`;
        if (diffDays < 7) return `${diffDays}d ago`;
        return date.toLocaleDateString();
    }
    
    private formatBytes(bytes: number): string {
        if (bytes === 0) return "0 B";
        const k = 1024;
        const sizes = ["B", "KB", "MB", "GB", "TB"];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
    }

    override render() {
        this.#schematic_app = html`
            <kc-schematic-app controls="full"></kc-schematic-app>
        ` as KCSchematicAppElement;
        this.#board_app = html`
            <kc-board-app controls="full"></kc-board-app>
        ` as KCBoardAppElement;

        return html`
            <kc-ui-app>
                <section class="overlay">
                    <div class="hero-glow"></div>
                    <div class="circuit-pattern"></div>
                    <h1>
                        <img
                            class="logo-icon"
                            src="images/Grok_Logomark_Light.png"
                            alt="Grok" />
                        <span class="logo-text">groki</span>
                    </h1>
                    <p class="tagline">
                        <strong>AI-powered</strong> schematic intelligence
                    </p>
                    <p class="description">
                        An <strong>interactive</strong> viewer for KiCAD
                        schematics with <strong>Grok-powered</strong> component
                        analysis. Get instant summaries, understand circuit
                        blocks, and explore your designs like never before.
                    </p>
                    <div class="features">
                        <div class="feature">
                            <span class="feature-icon">🔍</span>
                            <span>Component Analysis</span>
                        </div>
                        <div class="feature">
                            <span class="feature-icon">💡</span>
                            <span>Circuit Summaries</span>
                        </div>
                        <div class="feature">
                            <img
                                class="feature-icon"
                                src="images/xAI_Logomark_Light.png"
                                alt="xAI" />
                            <span>Powered by Grok</span>
                        </div>
                    </div>
                    <input
                        name="link"
                        type="text"
                        placeholder="Paste a GitHub link to your schematic..."
                        autofocus />
                    <div class="error-bar">${this.error}</div>
                    <div class="examples">
                        <h3>Examples</h3>
                        <button
                            id="grok-watch-btn"
                            data-repo="https://github.com/CwbhX/GrokKiCADWatch">
                            Smart Watch
                        </button>
                        <button
                            id="ubms-btn"
                            data-repo="https://github.com/CwbhX/uBMS-2">
                            Battery System
                        </button>
                    </div>
                    ${this.#cached_repos.length > 0
                        ? html`
                              <div class="cached-repos">
                                  <h3>
                                      <span>📦 Cached Repositories</span>
                                      <button
                                          id="clear-cache-btn"
                                          class="clear-cache-btn"
                                          title="Clear all cached repositories">
                                          🗑️ Clear All
                                      </button>
                                  </h3>
                                  <div class="cached-repo-list">
                                      ${this.#cached_repos.map(
                                          (repo) => html`
                                              <div class="cached-repo-item">
                                                  <button
                                                      class="cached-repo-btn"
                                                      data-slug="${repo.slug}"
                                                      title="Load ${repo.slug}">
                                                      <span class="repo-name"
                                                          >${repo.slug}</span
                                                      >
                                                      <span class="repo-date"
                                                          >${this.formatRelativeDate(
                                                              repo.lastAccessed,
                                                          )}</span
                                                      >
                                                  </button>
                                                  <button
                                                      class="delete-repo-btn"
                                                      data-slug="${repo.slug}"
                                                      title="Remove from cache">
                                                      ✕
                                                  </button>
                                              </div>
                                          `,
                                      )}
                                  </div>
                                  ${this.#storageInfo
                                      ? html`
                                            <div class="storage-info">
                                                <span class="storage-label">Storage Used:</span>
                                                <span class="storage-value"
                                                    >${this.formatBytes(this.#storageInfo.usage)} / ${this.formatBytes(this.#storageInfo.quota)}</span
                                                >
                                                <div class="storage-bar">
                                                    <div
                                                        class="storage-bar-fill ${this.#storageInfo.usagePercent > 80 ? "warning" : ""}"
                                                        style="width: ${Math.min(this.#storageInfo.usagePercent, 100)}%"></div>
                                                </div>
                                                <span class="storage-percent">${this.#storageInfo.usagePercent.toFixed(1)}%</span>
                                            </div>
                                        `
                                      : null}
                              </div>
                          `
                        : null}
                    <p class="drop-hint">or drag & drop your KiCAD files</p>
                    
                    <!-- API Settings Panel -->
                    <div class="api-settings ${this.#apiSettingsExpanded ? "expanded" : ""}">
                        <div class="api-settings-header">
                            <h3>
                                <span class="status-indicator ${xaiSettings.isConfigured ? "configured" : ""}"></span>
                                <span>⚙️ xAI API Settings</span>
                            </h3>
                            <span class="toggle-icon">▼</span>
                        </div>
                        <div class="api-settings-body">
                            <div class="api-field">
                                <label for="api-key-input">API Key</label>
                                <input
                                    type="password"
                                    id="api-key-input"
                                    placeholder="Enter your xAI API key..."
                                    value="${this.#apiKeyInput}"
                                    autocomplete="off"
                                />
                                <span class="field-hint">
                                    Get your API key from <a href="https://console.x.ai/" target="_blank" rel="noopener">console.x.ai</a>
                                </span>
                            </div>
                            <div class="api-field">
                                <label for="api-base-url-input">Base URL (optional)</label>
                                <input
                                    type="text"
                                    id="api-base-url-input"
                                    placeholder="https://api.x.ai/v1/chat/completions"
                                    value="${this.#apiBaseUrlInput}"
                                    autocomplete="off"
                                />
                                <span class="field-hint">Leave default unless using a proxy</span>
                            </div>
                            ${this.#apiStatusMessage
                                ? html`<div class="api-status ${this.#apiStatusType}">${this.#apiStatusMessage}</div>`
                                : null}
                            <div class="api-buttons">
                                <button class="test-btn" ?disabled="${this.#isTestingConnection || !this.#apiKeyInput}">
                                    ${this.#isTestingConnection ? "Testing..." : "Test"}
                                </button>
                                <button class="save-btn" ?disabled="${!this.#apiKeyInput}">Save</button>
                                <button class="clear-btn">Clear</button>
                            </div>
                        </div>
                    </div>
                    
                    <p class="credits">Made by Clement Hathaway, Ernest Yeung, Evan Hekman, Julian Carrier</p>

                </section>
                <section class="loading-overlay">
                    <div class="hero-glow"></div>
                    <div class="circuit-pattern"></div>
                    <div class="loading-content">
                        <div class="loading-spinner">
                            <img
                                class="loading-logo"
                                src="images/Grok_Logomark_Light.png"
                                alt="Grok" />
                        </div>
                        <h2 class="loading-title">
                            ${this.#cloneProgress ? "Cloning Repository" : "Loading Repository"}
                        </h2>
                        <p class="loading-message">
                            ${this.#cloneProgress
                                ? `${this.#cloneProgress.phase}: ${this.#cloneProgress.loaded} / ${this.#cloneProgress.total} objects`
                                : "Cloning and parsing your schematic files..."}
                        </p>
                        <div class="loading-progress">
                            <div
                                class="loading-progress-bar ${this.#cloneProgress ? "determinate" : ""}"
                                style="${this.#cloneProgress && this.#cloneProgress.total > 0 ? `width: ${(this.#cloneProgress.loaded / this.#cloneProgress.total) * 100}%` : ""}"></div>
                        </div>
                        <p class="loading-hint">
                            ${this.#cloneProgress && this.#cloneProgress.total > 0
                                ? `${Math.round((this.#cloneProgress.loaded / this.#cloneProgress.total) * 100)}% complete`
                                : "This may take a moment for larger repositories"}
                        </p>
                    </div>
                </section>
                <main>${this.#schematic_app} ${this.#board_app}</main>
            </kc-ui-app>
        `;
    }
}

window.customElements.define("kc-kicanvas-shell", KiCanvasShellElement);
