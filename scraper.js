/*
How Everything Connects
✔ scraper.js → Collects price & buy box data and writes to pricing.csv via database.js.
✔ database.js → Handles reading and writing to pricing.csv.
✔ pricingLogic.js → Reads the last 24 hours of data, determines if a price update is needed, and calls patchPrice.js if required.
✔ patchPrice.js → Updates the price on Amazon (or simulates it in test mode).

📂 project-folder
 ├── scraper.js         <-- Scrapes data & writes to pricing.csv
 ├── database.js        <-- Reads/Writes pricing.csv
 ├── pricingLogic.js    <-- Decides if price should change & calls patchPrice.js
 ├── patchPrice.js      <-- Updates price on Amazon (or simulates in test mode) 
 ├── pricing.csv        <-- Stores pricing history
 ├── config.json        <-- Stores product settings (asin, sku, min price)

Open Todos
- 1. Rebuild to let it run on DigitalOcean droplet, Functions or Container (+test so it works in cloud as on local machine)
- 2. Build database in RDS
- 3. Build APIs so we can read/write from the DigitalOcean machine onto AWS RDS.
- 4. Extend config (Kevin)
- 4. Setup 1-hourly CRON job to run the scraper.js script.
- 5. Put dataset into Superset 
- 6. Lets see if the database design is optimal to have perfect visualiztion in Superset (Kevin)
- 7. Add error handling for the scraper and pricing logic.
*/

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');
const { initializeDatabase, appendToDatabase, generateUUID } = require('./database');
const { exec } = require('child_process');

puppeteer.use(StealthPlugin());

// **Load Config File**
const configPath = path.join(__dirname, 'config.json');
if (!fs.existsSync(configPath)) {
    console.error("❌ config.json is missing! Please create it.");
    process.exit(1);
}
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

initializeDatabase();

// **Randomized User-Agents (For Human-Like Browsing)** 
const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36'
];

// **Function to Scrape Amazon**
async function scrapeAmazon(product, zipCode) {
    try {
        const amazonURL = `https://www.amazon.de/dp/${product.asin}`;
        const browser = await puppeteer.launch({
            executablePath: '/usr/bin/google-chrome',
            headless: true, // MUST BE HEADLESS
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-blink-features=AutomationControlled',
                '--disable-web-security',
                '--user-agent=' + userAgents[Math.floor(Math.random() * userAgents.length)] // randomize user-agent 
            ]
        });
        const page = await browser.newPage();
        console.log(`pagepagepage ${JSON.stringify(page)}`);

        await page.setUserAgent(userAgents[Math.floor(Math.random() * userAgents.length)]); // Apply random user-agent again 
        await page.setViewport({ width: 1280, height: 800 });

        console.log(`Opening Amazon page for ASIN: ${product.asin} in ZIP ${zipCode}`);
        await page.goto(amazonURL, { waitUntil: 'domcontentloaded' });

        // **Perform Human-Like Mouse Movements & Scrolls** 
        await page.evaluate(() => {
            window.scrollBy(0, window.innerHeight / 2);
        });
        await new Promise(resolve => setTimeout(resolve, 2000 + Math.random() * 2000)); // Random wait time

        // **Handle Cookie Banner**
        try {
            await page.waitForSelector('form[action*="/cookiePrefs"] button', { timeout: 5000 });
            await page.evaluate(() => {
                let btn = [...document.querySelectorAll('button')].find(b => b.innerText.includes("Ablehnen"));
                if (btn) btn.click();
            });
            console.log("✅ Clicked cookie reject button.");
            await new Promise(resolve => setTimeout(resolve, 2000));
        } catch (error) {
            console.log("✅ No cookie popup found.");
        }

        // **Detect CAPTCHA and Retry with Human-Like Interaction** 
        let captchaDetected = false;
        if (await page.$("form[action*='/errors/validateCaptcha']")) {
            console.log("⚠️ CAPTCHA detected! Solving...");
            captchaDetected = true;
            await page.waitForTimeout(5000);

            // **Try to bypass CAPTCHA by reloading or waiting for it to disappear** 
            for (let i = 0; i < 3; i++) {
                console.log(`🔄 Attempting to reload (${i + 1}/3)`);
                await page.reload({ waitUntil: 'domcontentloaded' });
                await page.waitForTimeout(3000 + Math.random() * 2000);
                if (!(await page.$("form[action*='/errors/validateCaptcha']"))) {
                    console.log("✅ CAPTCHA bypassed!");
                    captchaDetected = false;
                    break;
                }
            }

            if (captchaDetected) {
                console.log("❌ CAPTCHA could not be solved after retries.");
                await browser.close();
                return;
            }
        }

        // **Extract Buy Box Price & Seller**
        let priceValue = null;
        let buyBoxSeller = "Unknown";
        let lowStock = null;

        try {
            priceValue = await page.$eval(
                '#corePrice_feature_div .a-price .a-offscreen',
                el => parseFloat(el.innerText.replace('€', '').replace(',', '.').trim()) // Extract price as number, example: "€ 27,95" -> 27.95
            );
        } catch (error) {
            let message = JSON.stringify(error)
            console.log("messagemessage",message)
            console.log("⚠️ Could not extract Buy Box price.");
        }

        try {
            buyBoxSeller = await page.$eval('#sellerProfileTriggerId', el => el.innerText.trim()); // Extract seller name, example: "SodaSmart-de"
        } catch (error) {
            console.log("⚠️ Could not extract Buy Box seller.");
        }

        try {
            const stockText = await page.$eval(
                'span.a-size-base.a-color-price.a-text-bold',
                el => el.innerText.trim()
            );

            // Extract the number (if available)
            const match = stockText.match(/\d+/); // Extract number from text, example: "Only 5 left in stock." -> 5
            if (match) {
                lowStock = parseInt(match[0], 10);
            }
        } catch (error) {
            console.log("⚠️ Could not extract low stock info.");
        }

        console.log(`✅ Low Stock: ${lowStock !== null ? lowStock : "Not Displayed"}`);


        console.log(`✅ Buy Box Winner: ${buyBoxSeller}, Price: ${priceValue}`);

        // **Navigate to Alternative Seller List**
        let sellers = [];
        let prices = [];

        try {
            const secondPageURL = `https://www.amazon.de/dp/${product.asin}/ref=olp-opf-redir?aod=1&ie=UTF8&condition=NEW`;
            await page.goto(secondPageURL, { waitUntil: 'domcontentloaded' });

            await page.waitForSelector('#aod-offer-list', { timeout: 5000 });

            const offerElements = await page.$$('#aod-offer');

            for (let i = 0; i < 3; i++) {
                if (offerElements[i]) {
                    try {
                        sellers[i] = await offerElements[i].$eval('#aod-offer-soldBy a', el => el.innerText.trim()); // Extract seller name, example: "SodaSmart-de"
                    } catch (error) {
                        sellers[i] = "Unknown Seller";
                    }

                    let fullPrice = null;

                    try {
                        // **Option 1: Extract from aok-offscreen (First Approach)**
                        let priceText = await offerElements[i].$eval('.aok-offscreen', el => el.innerText.trim()).catch(() => null);

                        if (priceText) {
                            let match = priceText.match(/(\d+,\d+)/); // Find price like 27,95
                            if (match) {
                                fullPrice = parseFloat(match[0].replace(',', '.')); // Convert to number like 27.95, example: "27,95" -> 27.95
                            }
                        }
                    } catch (error) {
                        console.log(`⚠️ Option 1 failed for offer ${i + 1}, trying Option 2...`);
                    }

                    // **Option 2: Extract from Whole + Decimal + Fraction**
                    if (!fullPrice) {
                        try {
                            let wholePart = await offerElements[i].$eval('.a-price-whole', el => el.innerText.trim()).catch(() => "0");
                            let decimalPart = await offerElements[i].$eval('.a-price-decimal', el => el.innerText.trim()).catch(() => ".");
                            let fractionPart = await offerElements[i].$eval('.a-price-fraction', el => el.innerText.trim()).catch(() => "00");

                            fullPrice = parseFloat(`${wholePart}${decimalPart}${fractionPart}`); // Combine parts and convert to number, example: 27 + . + 95 -> 27.95
                        } catch (error) {
                            console.log(`⚠️ Option 2 also failed for offer ${i + 1}.`);
                            fullPrice = null;
                        }
                    }

                    prices[i] = fullPrice;
                }
            }
        } catch (error) {
            console.log("⚠️ Could not extract alternative sellers.");
        }

        console.log(`✅ 2nd Place Seller: ${sellers[0] || "Unknown"}, Price: ${prices[0] || "NULL"}`);
        console.log(`✅ 3rd Place Seller: ${sellers[1] || "Unknown"}, Price: ${prices[1] || "NULL"}`);
        console.log(`✅ 4th Place Seller: ${sellers[2] || "Unknown"}, Price: ${prices[2] || "NULL"}`);

        // **Store Extracted Data in CSV**
        const timestamp = new Date().toISOString();
        const channel = "Amazon";
        const pricingEntries = [
            { place: 1, seller: buyBoxSeller, price: priceValue },
            { place: 2, seller: sellers[0] || "Unknown", price: prices[0] || "NULL" },
            { place: 3, seller: sellers[1] || "Unknown", price: prices[1] || "NULL" },
            { place: 4, seller: sellers[2] || "Unknown", price: prices[2] || "NULL" }
        ];

        pricingEntries.forEach(entry => {
            const pricingData = {
                PricingID: generateUUID(),
                channel,
                timestamp,
                productAsin: product.asin,
                productSKU: product.sku,
                zip: zipCode,
                SellerName: entry.seller,
                price: entry.price,
                place: entry.place,
                lowStock: entry.place === 1 ? lowStock || "NULL" : "NULL",
                action: null
            };
            appendToDatabase(pricingData);
        });
    } catch (error) {
        console.error(`❌ Error scraping Amazon for ASIN: ${product.asin} in ZIP ${zipCode}:`, error);
    }

}
// **Run Scraper for Each Product & ZIP**
(async () => {
    try {
        for (const product of config.products) {
            for (const zip of config.zipList) {
                await scrapeAmazon(product, zip);
            }
            console.log(`✅ Scraping completed for ${product.asin}. Running pricing logic...`);

            await new Promise((resolve) => {
                exec(`node pricingLogic.js ${product.asin}`, (error, stdout, stderr) => {
                    if (error) {
                        console.error(`❌ Error executing pricing logic: ${error.message}`);
                        resolve();
                    } else {
                        console.log(stdout);
                        if (stderr) console.error(`⚠️ Pricing logic stderr: ${stderr}`);
                        resolve();
                    }
                });
            });
        }
        console.log("✅ All products processed. Exiting script.");
    } catch (error) {
        console.error('❌ Error in main execution:', error);
    } finally {
        process.exit(0);
    }
})();



