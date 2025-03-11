const axios = require('axios');
const qs = require('qs');

// **Configurable Settings**
const test_mode = true;  // If true, does not send real API requests

// Replace with actual credentials
const clientId = '';
const clientSecret = '';
const refreshToken = '';

const sellerId = 'AMORNEXAKDN3S';
const marketplaceId = 'A1PA6795UKMFR9';

// Function to get access token
async function getAccessToken() {
    const tokenUrl = 'https://api.amazon.com/auth/o2/token';
    const tokenData = {
        grant_type: 'refresh_token',
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
    };

    try {
        console.log('Requesting access token...');
        const response = await axios.post(tokenUrl, qs.stringify(tokenData), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        });
        return response.data.access_token;
    } catch (error) {
        console.error('Error getting access token:', error.message);
        throw error;
    }
}

// Function to update listing price
async function updateListingItemPrice(asin, sku, newPrice) {
    if (test_mode) {
        console.log(`🛠️ [TEST MODE] Would update ASIN: ${asin} to Price: ${newPrice}`);
        return;
    }

    const accessToken = await getAccessToken();
    const apiUrl = `https://sellingpartnerapi-eu.amazon.com/listings/2021-08-01/items/${sellerId}/${sku}?marketplaceIds=${marketplaceId}`;
    const listingData = {
        "productType": "PRODUCT",
        "patches": [
            {
                "op": "replace",
                "path": "/attributes/purchasable_offer",
                "value": [
                    {
                        "marketplace_id": marketplaceId,
                        "currency": "EUR",
                        "our_price": [{ "schedule": [{ "value_with_tax": newPrice }] }]
                    }
                ]
            }
        ]
    };

    const headers = {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
    };

    try {
        console.log(`Updating price for ASIN: ${asin} to ${newPrice}€`);
        const response = await axios.patch(apiUrl, listingData, { headers });
        console.log('✅ Price updated successfully:', response.data);
    } catch (error) {
        console.error('❌ Error updating price:', error.message);
    }
}

module.exports = { updateListingItemPrice };
