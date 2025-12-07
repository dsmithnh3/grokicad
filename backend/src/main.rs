use anyhow::Context;
use axum::Router;
use std::sync::Arc;
use tower_http::cors::{Any, CorsLayer};
use tracing::info;
use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;

mod controllers;
mod openapi;
mod routes;
mod services;
mod types;

use openapi::ApiDoc;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Load environment variables from .env file
    dotenvy::dotenv().ok();
    
    tracing_subscriber::fmt().init();

    let pool = kicad_db::create_pool()
        .await
        .context("Failed to create database pool")?;

    let app_state = Arc::new(pool);

    // Configure CORS to allow requests from the frontend domain
    let cors = CorsLayer::new()
        .allow_origin(Any) // Allow all origins in production (can be restricted to specific domains)
        .allow_methods(Any)
        .allow_headers(Any)
        .expose_headers(Any)
        .max_age(std::time::Duration::from_secs(3600));

    let app = Router::new()
        .merge(SwaggerUi::new("/swagger-ui").url("/api-docs/openapi.json", ApiDoc::openapi()))
        .nest("/api/repo", routes::repo::router())
        .nest("/api/hook", routes::hook::router())
        .nest("/api/grok", routes::grok::router())
        .nest("/api/distill", routes::distill::router())
        .nest("/api/digikey", routes::digikey::router())
        .layer(cors)
        .layer(tower_http::trace::TraceLayer::new_for_http())
        .with_state(app_state);

    let listener = tokio::net::TcpListener::bind("0.0.0.0:443").await?;
    info!("Server listening on 0.0.0.0:443");
    info!("Swagger UI available at http://localhost:443/swagger-ui/");

    axum::serve(listener, app).await?;

    Ok(())
}
