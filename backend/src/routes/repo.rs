use axum::{routing::post, Router};
use std::sync::Arc;

use crate::controllers::repo::{clear_cache, get_commit_files, get_commit_info, get_commits, init_repo};

pub fn router() -> Router<Arc<sqlx::PgPool>> {
    Router::new()
        .route("/commits", post(get_commits))
        .route("/commit/files", post(get_commit_files))
        .route("/commit/info", post(get_commit_info))
        .route("/init", post(init_repo))
        .route("/clear-cache", post(clear_cache))
}
