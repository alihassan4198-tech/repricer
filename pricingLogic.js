const fs = require('fs');
const path = require('path');
const { readDatabase, appendToDatabase, generateUUID } = require('./database');
const { updateListingItemPrice } = require('./patchPrice');

// **Load Config File**
const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
const priceStep = config.priceStep;
const test_mode = config.test_mode;
const X = config.hasBuyBoxInAtLeastXZips; // Minimum ZIPs required to consider price increase // v2
const Y = config.hasBuyBoxInLessThanYZips; // Maximum ZIPs before considering price decrease // v2

// **Process Pricing for a Single Product with new table structure** 
async function processPricing(productAsin) {
    try {
        console.log(`🔍 Checking pricing strategy for ASIN: ${productAsin}`);

        // Filter data where place=1 (Buy Box Winner)
        const last24HoursData = readDatabase()?.filter(row => row[3] === productAsin && row[8] === "1");

        if (last24HoursData.length === 0) {
            console.log(`⚠️ No data found for last 24 hours for ASIN: ${productAsin}`);
            return;
        }

        // **Check Buy Box Status Across ZIPs**
        const allZipBuyBoxWinners = last24HoursData.map(row => row[6]); // SellerName column
        const allZipPrices = last24HoursData.map(row => parseFloat(row[7])); // Price column
        const allZipLowStock = last24HoursData.map(row => row[9]); // Low stock column // v2

        // **Check if the Buy Box Winner is low on stock** // v2
        const hasLowStock = allZipLowStock.some(stock => stock && !isNaN(stock) && parseInt(stock) > 0);
        if (hasLowStock) {
            console.log(`🚨 Low stock detected for Buy Box Winner, skipping price adjustment.`);
            return; // No price change when low stock is detected
        }

        const hasBuyBoxEverywhere = allZipBuyBoxWinners.every(seller => seller === "SodaSmart-de");
        const hasBuyBoxNowhere = allZipBuyBoxWinners.every(seller => seller !== "SodaSmart-de");

        // **New Buy Box ZIP-based Conditions** // v2
        const buyBoxZipCount = allZipBuyBoxWinners?.filter(seller => seller === "SodaSmart-de").length;
        const hasBuyBoxInAtLeastXZips = buyBoxZipCount >= X;
        const hasBuyBoxInLessThanYZips = buyBoxZipCount < Y;

        const currentPrice = Math.min(...allZipPrices);
        //const newPrice = hasBuyBoxEverywhere ? currentPrice + priceStep : currentPrice - priceStep; // v1
        const newPrice = hasBuyBoxInAtLeastXZips ? currentPrice + priceStep : currentPrice - priceStep; // v2

        // **Determine Action** // v1
        /*
        let action = null;
        if (hasBuyBoxEverywhere && !last24HoursData.some(row => row[10]?.includes("increase price"))) {
            action = `increase price by ${priceStep}`;
        } else if (hasBuyBoxNowhere && currentPrice > config.products.find(p => p.asin === productAsin).minimumPrice + priceStep) {
            action = `decrease price by ${priceStep}`;
        }
        */
        // **Determine Action** // v2
        let action = null;
        if (hasBuyBoxInAtLeastXZips && !last24HoursData.some(row => row[10]?.includes("increase price"))) {
            action = `increase price by ${priceStep}`;
        } else if (hasBuyBoxInLessThanYZips && currentPrice > config.products.find(p => p.asin === productAsin).minimumPrice + priceStep) {
            action = `decrease price by ${priceStep}`;
        }

        // **Apply Price Update if Needed**
        if (action) {
            console.log(`✅ Applying action: ${action}`);
            if (!test_mode) {
                await updateListingItemPrice(productAsin, newPrice);
            } else {
                console.log(`🛠️ [TEST MODE] Would update price to: ${newPrice}`);
            }
            appendToDatabase({
                PricingID: generateUUID(),
                channel: "Amazon",
                timestamp: new Date().toISOString(),
                productAsin,
                productSKU: "N/A",
                zip: "ALL",
                SellerName: "N/A",
                price: newPrice,
                place: "N/A",
                lowStock: "N/A",
                action
            });
        } else {
            console.log(`❌ No price adjustment needed.`);
        }
    } catch (error) {
        console.error(`❌ Error processing pricing for ASIN: ${productAsin}:`, error);
    }
}


// **Run for Specific Product**
const productAsin = process.argv[2];
if (productAsin) processPricing(productAsin);
else console.log("❌ No product ASIN provided.");
