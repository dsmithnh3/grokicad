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
import { GitHubAuthService, type GitHubUser } from "../services/github-auth";
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
    
    // GitHub Auth state
    #githubUser: GitHubUser | null = null;
    #githubAuthLoading: boolean = false;
    #githubRateLimit: { remaining: number; limit: number; reset: Date } | null = null;
    
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

    @attribute({ type: Boolean })
    public switching: boolean;
    
    // Switching commit info for corner loader
    #switchingCommit: string | null = null;

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
            // Initialize GitHub auth and load configuration
            await this.initializeGitHubAuth();
            
            // Handle GitHub OAuth callback
            await this.handleGitHubOAuthCallback();
            
            // Load cached repos
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
            this.setupGitHubAuthListeners();
        });
        
        // Initialize API settings inputs from stored values
        this.#apiKeyInput = xaiSettings.apiKey ?? "";
        this.#apiBaseUrlInput = xaiSettings.baseUrl;
        
        // Subscribe to GitHub auth state changes
        GitHubAuthService.subscribe(() => {
            this.#githubUser = GitHubAuthService.getUser();
            this.update();
            later(() => this.reattachAllListeners());
        });
    }
    
    /**
     * Initialize GitHub auth - loads saved state and handles OAuth callback
     */
    private async initializeGitHubAuth(): Promise<void> {
        try {
            // Load saved auth state
            this.#githubUser = GitHubAuthService.getUser();
            
            // Fetch rate limit info if authenticated
            if (GitHubAuthService.isAuthenticated()) {
                await this.refreshGitHubRateLimit();
            }
        } catch (e) {
            console.warn("[KiCanvasShell] Failed to initialize GitHub auth:", e);
        }
    }
    
    /**
     * Handle GitHub OAuth callback if present in URL (PKCE flow)
     */
    private async handleGitHubOAuthCallback(): Promise<void> {
        // Check if we're returning from GitHub OAuth
        const urlParams = new URLSearchParams(window.location.search);
        if (!urlParams.has("code") && !urlParams.has("error")) {
            return; // Not an OAuth callback
        }
        
        this.#githubAuthLoading = true;
        this.update();
        
        try {
            const success = await GitHubAuthService.handleOAuthCallback();
            if (success) {
                this.#githubUser = GitHubAuthService.getUser();
                await this.refreshGitHubRateLimit();
            }
        } catch (e) {
            console.error("[KiCanvasShell] GitHub callback error:", e);
            this.showError(e instanceof Error ? e.message : "Failed to complete GitHub authentication");
        } finally {
            this.#githubAuthLoading = false;
            this.update();
            later(() => this.reattachAllListeners());
        }
    }
    
    /**
     * Refresh GitHub rate limit info
     */
    private async refreshGitHubRateLimit(): Promise<void> {
        const rateLimit = await GitHubAuthService.getRateLimit();
        if (rateLimit) {
            this.#githubRateLimit = {
                remaining: rateLimit.remaining,
                limit: rateLimit.limit,
                reset: rateLimit.reset,
            };
        }
    }
    
    /**
     * Setup GitHub auth button listeners
     */
    private setupGitHubAuthListeners(): void {
        const loginBtn = this.renderRoot.querySelector("#github-login-btn");
        if (loginBtn) {
            const handler = async () => {
                if (!GitHubAuthService.isConfigured()) {
                    this.showError("GitHub OAuth is not configured. Please set GITHUB_CLIENT_ID in config.ts");
                    return;
                }
                
                this.#githubAuthLoading = true;
                this.update();
                later(() => this.reattachAllListeners());
                
                try {
                    // This will redirect to GitHub
                    await GitHubAuthService.startLogin();
                } catch (e) {
                    console.error("[KiCanvasShell] GitHub login error:", e);
                    this.showError(e instanceof Error ? e.message : "Failed to start GitHub authentication");
                    this.#githubAuthLoading = false;
                    this.update();
                    later(() => this.reattachAllListeners());
                }
            };
            loginBtn.addEventListener("click", handler);
            this.#eventListeners.push({ element: loginBtn, event: "click", handler });
        }
        
        const logoutBtn = this.renderRoot.querySelector("#github-logout-btn");
        if (logoutBtn) {
            const handler = () => {
                GitHubAuthService.logout();
                this.#githubUser = null;
                this.#githubRateLimit = null;
                this.update();
                later(() => this.reattachAllListeners());
            };
            logoutBtn.addEventListener("click", handler);
            this.#eventListeners.push({ element: logoutBtn, event: "click", handler });
        }
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
        this.setupGitHubAuthListeners();
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
                    case "NOT_FOUND":
                        if (!GitHubAuthService.isAuthenticated()) {
                            errorMessage =
                                "Repository not found. If this is a private repository, please sign in with GitHub.";
                        } else {
                            errorMessage =
                                "Repository not found. Please check that the repository exists and you have access.";
                        }
                        break;
                    case "RATE_LIMITED":
                        if (!GitHubAuthService.isAuthenticated()) {
                            errorMessage =
                                "GitHub API rate limit exceeded. Sign in with GitHub to get 5,000 requests/hour.";
                        } else {
                            errorMessage = e.message;
                        }
                        break;
                    case "UNAUTHORIZED":
                        errorMessage =
                            "Authentication expired. Please sign in with GitHub again.";
                        GitHubAuthService.logout();
                        this.#githubUser = null;
                        this.update();
                        later(() => this.reattachAllListeners());
                        break;
                    case "FORBIDDEN":
                        if (!GitHubAuthService.isAuthenticated()) {
                            errorMessage =
                                "Access denied. This may be a private repository - try signing in with GitHub.";
                        } else {
                            errorMessage =
                                "Access denied. You may not have permission to access this repository.";
                        }
                        break;
                    case "NETWORK_ERROR":
                        errorMessage =
                            "Network error. Please check your internet connection and try again.";
                        break;
                    case "INVALID_REPO":
                        errorMessage = e.message;
                        break;
                    default:
                        errorMessage = `${e.message}. Please check that the repository exists.`;
                        break;
                }
            } else if (e instanceof Error) {
                errorMessage = `${e.message}. Please check that the repository exists.`;
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

        // If we already have content loaded, use the subtle corner loader
        // Otherwise, show the full loading overlay
        const wasLoaded = this.loaded;
        
        if (wasLoaded) {
            // Subtle corner loader for switching commits
            this.switching = true;
            this.#switchingCommit = commit;
        } else {
            // Full overlay for initial load
            this.loaded = false;
            this.loading = true;
        }
        
        this.removeAttribute("error");
        this.#current_commit = commit;

        try {
            const vfs = await CommitFileSystem.fromCommit(repo, commit);
            await this.setup_project(vfs);
        } catch (e) {
            console.error("Failed to load commit:", e);
            this.loading = false;
            this.switching = false;
            this.#switchingCommit = null;
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
        // Only set full loading overlay if not already switching
        if (!this.switching) {
            this.loaded = false;
            this.loading = true;
        }

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
            this.switching = false;
            this.#switchingCommit = null;
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
                    
                    <!-- GitHub Authentication Section -->
                    <div class="github-auth">
                        ${this.#githubUser
                            ? html`
                                <div class="github-user">
                                    <img 
                                        class="github-avatar" 
                                        src="${this.#githubUser.avatar_url}" 
                                        alt="${this.#githubUser.login}" />
                                    <div class="github-user-info">
                                        <span class="github-username">${this.#githubUser.name || this.#githubUser.login}</span>
                                        <span class="github-rate-limit">
                                            ${this.#githubRateLimit
                                                ? `${this.#githubRateLimit.remaining}/${this.#githubRateLimit.limit} API calls`
                                                : "Authenticated"}
                                        </span>
                                    </div>
                                    <button id="github-logout-btn" class="github-logout-btn" title="Sign out">
                                        ✕
                                    </button>
                                </div>
                            `
                            : html`
                                <button 
                                    id="github-login-btn" 
                                    class="github-login-btn"
                                    ?disabled="${this.#githubAuthLoading}">
                                    <svg class="github-icon" viewBox="0 0 24 24" fill="currentColor">
                                        <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                                    </svg>
                                    ${this.#githubAuthLoading 
                                        ? "Signing in..." 
                                        : "Sign in with GitHub"}
                                </button>
                                <span class="github-hint">
                                    Access private repos & get 5,000 API calls/hour
                                </span>
                            `}
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
                                      <span>📂 Recent Repositories</span>
                                      <button
                                          id="clear-cache-btn"
                                          class="clear-cache-btn"
                                          title="Clear history">
                                          🗑️ Clear
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
                                                      title="Remove from history">
                                                      ✕
                                                  </button>
                                              </div>
                                          `,
                                      )}
                                  </div>
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
                            ${this.#cloneProgress ? "Loading Repository" : "Loading Repository"}
                        </h2>
                        <p class="loading-message">
                            ${this.#cloneProgress
                                ? `${this.#cloneProgress.phase}: ${this.#cloneProgress.loaded} / ${this.#cloneProgress.total} commits`
                                : "Fetching and parsing your schematic files..."}
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
                
                <!-- Corner loader for commit switching -->
                <div class="corner-loader">
                    <div class="corner-loader-spinner"></div>
                    <span class="corner-loader-text">Loading commit</span>
                    ${this.#switchingCommit 
                        ? html`<span class="corner-loader-commit">${this.#switchingCommit.substring(0, 7)}</span>` 
                        : null}
                </div>
            </kc-ui-app>
        `;
    }
}

window.customElements.define("kc-kicanvas-shell", KiCanvasShellElement);
