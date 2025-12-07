use axum::{extract::State, http::StatusCode, response::Json};
use std::sync::Arc;
use tracing::{error, info};

use crate::services::digikey::DigiKeyClient;
use crate::types::{ApiError, DigiKeySearchRequest, DigiKeySearchResponse};
use kicad_db::PgPool;

pub type AppState = Arc<PgPool>;

/// Search DigiKey for part information
#[utoipa::path(
    post,
    path = "/api/digikey/search",
    request_body = DigiKeySearchRequest,
    responses(
        (status = 200, description = "DigiKey search results", body = DigiKeySearchResponse),
        (status = 400, description = "Bad request", body = ApiError),
        (status = 500, description = "Internal server error", body = ApiError),
        (status = 503, description = "DigiKey API not configured", body = ApiError)
    ),
    tag = "digikey"
)]
pub async fn search_parts(
    State(_state): State<AppState>,
    Json(req): Json<DigiKeySearchRequest>,
) -> Result<Json<DigiKeySearchResponse>, (StatusCode, Json<ApiError>)> {
    // Check if DigiKey is configured
    if !DigiKeyClient::is_configured() {
        return Err((
            StatusCode::SERVICE_UNAVAILABLE,
            Json(ApiError::new(
                "not_configured",
                "DigiKey API is not configured. Please set DIGIKEY_CLIENT_ID and DIGIKEY_CLIENT_SECRET environment variables.",
            )),
        ));
    }

    let client = DigiKeyClient::new();
    
    // Use keyword search for all queries - it handles both MPNs and keywords well
    // The keyword search returns ExactManufacturerProducts for exact MPN matches
    let search_query = req.mpn.as_ref().unwrap_or(&req.query);
    info!("Searching DigiKey for: {}", search_query);
    let search_result = client.search_keyword(search_query).await;

    match search_result {
        Ok(parts) => {
            let total_count = parts.len();
            info!("DigiKey search returned {} parts", total_count);
            
            Ok(Json(DigiKeySearchResponse {
                query: req.mpn.unwrap_or(req.query),
                success: true,
                error: None,
                parts,
                total_count,
            }))
        }
        Err(e) => {
            error!("DigiKey search failed: {}", e);
            
            // Return a successful response with error details
            // This allows the frontend to handle gracefully
            Ok(Json(DigiKeySearchResponse {
                query: req.mpn.unwrap_or(req.query),
                success: false,
                error: Some(e.to_string()),
                parts: vec![],
                total_count: 0,
            }))
        }
    }
}

/// Check DigiKey API configuration status
#[utoipa::path(
    get,
    path = "/api/digikey/status",
    responses(
        (status = 200, description = "DigiKey configuration status")
    ),
    tag = "digikey"
)]
pub async fn get_status(
    State(_state): State<AppState>,
) -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "configured": DigiKeyClient::is_configured(),
        "message": if DigiKeyClient::is_configured() {
            "DigiKey API is configured and ready"
        } else {
            "DigiKey API is not configured. Set DIGIKEY_CLIENT_ID and DIGIKEY_CLIENT_SECRET environment variables."
        }
    }))
}
