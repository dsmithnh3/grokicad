use anyhow::{Context, Result};
use once_cell::sync::Lazy;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::sync::RwLock;
use std::time::{Duration, Instant};
use tracing::{debug, error, info, warn};

use crate::types::{DigiKeyParameter, DigiKeyPartInfo};

// DigiKey API Configuration
static DIGIKEY_CLIENT_ID: Lazy<String> = Lazy::new(|| {
    std::env::var("DIGIKEY_CLIENT_ID").unwrap_or_else(|_| {
        warn!("DIGIKEY_CLIENT_ID not set - DigiKey integration will not work");
        String::new()
    })
});

static DIGIKEY_CLIENT_SECRET: Lazy<String> = Lazy::new(|| {
    std::env::var("DIGIKEY_CLIENT_SECRET").unwrap_or_else(|_| {
        warn!("DIGIKEY_CLIENT_SECRET not set - DigiKey integration will not work");
        String::new()
    })
});

// DigiKey API endpoints
const DIGIKEY_AUTH_URL: &str = "https://api.digikey.com/v1/oauth2/token";
const DIGIKEY_SEARCH_URL: &str = "https://api.digikey.com/products/v4/search/keyword";

// Token cache with thread-safe access
static TOKEN_CACHE: Lazy<RwLock<Option<TokenCache>>> = Lazy::new(|| RwLock::new(None));

// Shared HTTP client - reqwest Client uses connection pooling internally
static HTTP_CLIENT: Lazy<Client> = Lazy::new(|| {
    Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .expect("Failed to create HTTP client")
});

#[derive(Debug, Clone)]
struct TokenCache {
    access_token: String,
    expires_at: Instant,
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: String,
    expires_in: u64,
    #[allow(dead_code)]
    token_type: String,
}

#[derive(Debug, Serialize)]
struct KeywordSearchRequest {
    #[serde(rename = "Keywords")]
    keywords: String,
    #[serde(rename = "RecordCount")]
    record_count: i32,
    #[serde(rename = "RecordStartPosition")]
    record_start_position: i32,
}

#[derive(Debug, Deserialize)]
struct DigiKeySearchResponse {
    #[serde(rename = "Products")]
    products: Option<Vec<DigiKeyProduct>>,
    #[serde(rename = "ProductsCount")]
    #[allow(dead_code)]
    products_count: Option<i32>,
    #[serde(rename = "ExactManufacturerProducts")]
    exact_manufacturer_products: Option<Vec<DigiKeyProduct>>,
    #[serde(rename = "ExactManufacturerProductsCount")]
    #[allow(dead_code)]
    exact_manufacturer_products_count: Option<i32>,
    #[serde(rename = "ExactDigiKeyProduct")]
    exact_digikey_product: Option<DigiKeyProduct>,
}

#[derive(Debug, Deserialize)]
struct DigiKeyProduct {
    // Note: v4 API doesn't include DigiKey part number in the product object
    // It's available through ProductVariations
    #[serde(rename = "ManufacturerProductNumber")]
    manufacturer_part_number: Option<String>,
    #[serde(rename = "Manufacturer")]
    manufacturer: Option<ManufacturerInfo>,
    // Description is an object containing ProductDescription and DetailedDescription
    #[serde(rename = "Description")]
    description: Option<DescriptionInfo>,
    #[serde(rename = "ProductUrl")]
    product_url: Option<String>,
    #[serde(rename = "DatasheetUrl")]
    datasheet_url: Option<String>,
    #[serde(rename = "PhotoUrl")]
    primary_photo: Option<String>,
    #[serde(rename = "QuantityAvailable")]
    quantity_available: Option<i64>,
    #[serde(rename = "UnitPrice")]
    unit_price: Option<f64>,
    #[serde(rename = "ProductStatus")]
    product_status: Option<ProductStatus>,
    #[serde(rename = "Category")]
    category: Option<CategoryInfo>,
    #[serde(rename = "Parameters")]
    parameters: Option<Vec<ParameterInfo>>,
    // v4 has ProductVariations which contains the DigiKey part numbers
    #[serde(rename = "ProductVariations")]
    product_variations: Option<Vec<ProductVariation>>,
}

#[derive(Debug, Deserialize)]
struct DescriptionInfo {
    #[serde(rename = "ProductDescription")]
    product_description: Option<String>,
    #[serde(rename = "DetailedDescription")]
    detailed_description: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ProductVariation {
    #[serde(rename = "DigiKeyProductNumber")]
    digikey_product_number: Option<String>,
    #[serde(rename = "PackageType")]
    #[allow(dead_code)]
    package_type: Option<PackageType>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct PackageType {
    #[serde(rename = "Name")]
    name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ManufacturerInfo {
    #[serde(rename = "Name")]
    name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ProductStatus {
    #[serde(rename = "Status")]
    status: Option<String>,
    #[serde(rename = "Id")]
    #[allow(dead_code)]
    id: Option<i32>,
}

#[derive(Debug, Deserialize)]
struct CategoryInfo {
    #[serde(rename = "Name")]
    name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ParameterInfo {
    #[serde(rename = "ParameterText")]
    parameter_text: Option<String>,
    #[serde(rename = "ValueText")]
    value_text: Option<String>,
}

pub struct DigiKeyClient;

impl DigiKeyClient {
    pub fn new() -> Self {
        Self
    }

    /// Check if DigiKey integration is configured
    pub fn is_configured() -> bool {
        !DIGIKEY_CLIENT_ID.is_empty() && !DIGIKEY_CLIENT_SECRET.is_empty()
    }

    /// Get a valid access token, refreshing if necessary
    async fn get_access_token(&self) -> Result<String> {
        // Check cache first
        {
            let cache = TOKEN_CACHE.read().unwrap();
            if let Some(ref cached) = *cache {
                // Use token if it has at least 60 seconds remaining
                if cached.expires_at > Instant::now() + Duration::from_secs(60) {
                    debug!("Using cached DigiKey access token");
                    return Ok(cached.access_token.clone());
                }
            }
        }

        // Need to refresh token
        info!("Refreshing DigiKey access token");
        
        let params = [
            ("client_id", DIGIKEY_CLIENT_ID.as_str()),
            ("client_secret", DIGIKEY_CLIENT_SECRET.as_str()),
            ("grant_type", "client_credentials"),
        ];

        let response = HTTP_CLIENT
            .post(DIGIKEY_AUTH_URL)
            .form(&params)
            .send()
            .await
            .context("Failed to send token request to DigiKey")?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            error!("DigiKey auth failed: {} - {}", status, body);
            anyhow::bail!("DigiKey authentication failed: {} - {}", status, body);
        }

        let token_response: TokenResponse = response
            .json()
            .await
            .context("Failed to parse DigiKey token response")?;

        let expires_at = Instant::now() + Duration::from_secs(token_response.expires_in);
        
        // Update cache
        {
            let mut cache = TOKEN_CACHE.write().unwrap();
            *cache = Some(TokenCache {
                access_token: token_response.access_token.clone(),
                expires_at,
            });
        }

        info!("DigiKey access token refreshed successfully");
        Ok(token_response.access_token)
    }

    /// Search for parts by keyword/MPN
    /// This uses the keyword search endpoint which is more flexible and returns
    /// exact manufacturer matches when searching by MPN
    pub async fn search_keyword(&self, query: &str) -> Result<Vec<DigiKeyPartInfo>> {
        if !Self::is_configured() {
            anyhow::bail!("DigiKey API not configured. Set DIGIKEY_CLIENT_ID and DIGIKEY_CLIENT_SECRET environment variables.");
        }

        let access_token = self.get_access_token().await?;

        let request_body = KeywordSearchRequest {
            keywords: query.to_string(),
            record_count: 10,
            record_start_position: 0,
        };

        debug!("Searching DigiKey for: {}", query);

        let response = HTTP_CLIENT
            .post(DIGIKEY_SEARCH_URL)
            .header("Authorization", format!("Bearer {}", access_token))
            .header("X-DIGIKEY-Client-Id", DIGIKEY_CLIENT_ID.as_str())
            .header("X-DIGIKEY-Locale-Site", "US")
            .header("X-DIGIKEY-Locale-Language", "en")
            .header("X-DIGIKEY-Locale-Currency", "USD")
            .json(&request_body)
            .send()
            .await
            .context("Failed to send search request to DigiKey")?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            error!("DigiKey search failed: {} - {}", status, body);
            anyhow::bail!("DigiKey search failed: {} - {}", status, body);
        }

        let search_response: DigiKeySearchResponse = response
            .json()
            .await
            .context("Failed to parse DigiKey search response")?;

        // Prioritize exact manufacturer matches over general keyword matches
        // This gives better results when searching by MPN (e.g., "ESP32-WROOM-32E-N4")
        let mut parts = Vec::new();

        // First, add exact DigiKey product if found
        if let Some(exact_dk) = search_response.exact_digikey_product {
            info!("Found exact DigiKey product match");
            parts.push(Self::convert_product(exact_dk));
        }

        // Then add exact manufacturer matches (best for MPN searches)
        if let Some(exact_mfr) = search_response.exact_manufacturer_products {
            let count = exact_mfr.len();
            info!("Found {} exact manufacturer product matches", count);
            for product in exact_mfr {
                parts.push(Self::convert_product(product));
            }
        }

        // Finally add general keyword matches if we don't have enough results
        if parts.len() < 5 {
            if let Some(products) = search_response.products {
                let remaining = 10 - parts.len();
                for product in products.into_iter().take(remaining) {
                    // Avoid duplicates by checking part numbers
                    let mpn = product.manufacturer_part_number.as_ref();
                    let already_included = parts.iter().any(|p| {
                        p.manufacturer_part_number.as_ref() == mpn
                    });
                    if !already_included {
                        parts.push(Self::convert_product(product));
                    }
                }
            }
        }

        info!("DigiKey search returned {} total parts", parts.len());
        Ok(parts)
    }

    /// Convert DigiKey API product to our internal representation
    fn convert_product(product: DigiKeyProduct) -> DigiKeyPartInfo {
        // Get DigiKey part number from first product variation
        let digikey_part_number = product
            .product_variations
            .as_ref()
            .and_then(|variations| variations.first())
            .and_then(|v| v.digikey_product_number.clone());
        
        debug!(
            "Converting product: DK#={:?}, MPN={:?}, Mfr={:?}",
            digikey_part_number,
            product.manufacturer_part_number,
            product.manufacturer.as_ref().and_then(|m| m.name.as_ref())
        );
        
        let status = product.product_status.as_ref().and_then(|s| s.status.clone());
        let is_obsolete = status
            .as_ref()
            .map(|s| {
                let s_lower = s.to_lowercase();
                s_lower.contains("obsolete")
                    || s_lower.contains("discontinued")
                    || s_lower.contains("not for new designs")
                    || s_lower.contains("last time buy")
            })
            .unwrap_or(false);

        let lifecycle_status = if is_obsolete {
            Some(status.clone().unwrap_or_else(|| "Obsolete".to_string()))
        } else {
            status.clone()
        };

        // Extract descriptions from the Description object
        let (description, detailed_description) = match product.description {
            Some(desc) => (desc.product_description, desc.detailed_description),
            None => (None, None),
        };

        DigiKeyPartInfo {
            digikey_part_number,
            manufacturer_part_number: product.manufacturer_part_number,
            manufacturer: product.manufacturer.and_then(|m| m.name),
            description,
            detailed_description,
            product_url: product.product_url,
            datasheet_url: product.datasheet_url,
            photo_url: product.primary_photo,
            quantity_available: product.quantity_available,
            unit_price: product.unit_price,
            product_status: status,
            is_obsolete,
            lifecycle_status,
            category: product.category.and_then(|c| c.name),
            parameters: product
                .parameters
                .unwrap_or_default()
                .into_iter()
                .filter_map(|p| {
                    Some(DigiKeyParameter {
                        name: p.parameter_text?,
                        value: p.value_text.unwrap_or_default(),
                    })
                })
                .collect(),
        }
    }
}

impl Default for DigiKeyClient {
    fn default() -> Self {
        Self::new()
    }
}
