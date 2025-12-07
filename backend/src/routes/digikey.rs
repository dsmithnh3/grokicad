use axum::{
    routing::{get, post},
    Router,
};
use std::sync::Arc;

use crate::controllers::digikey::{get_status, search_parts};

pub fn router() -> Router<Arc<sqlx::PgPool>> {
    Router::new()
        .route("/search", post(search_parts))
        .route("/status", get(get_status))
}
