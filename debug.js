require("dotenv").config();
const axios = require("axios");
const { CookieJar } = require("tough-cookie");
const { wrapper } = require("axios-cookiejar-support");

const BASE = "https://academia.srmist.edu.in";
const ZOHO_ORG = "10002227248";
const PORTAL = "academia-academic-services";

const EMAIL = process.env.SRM_EMAIL;
const PASSWORD = process.env.SRM_PASSWORD;

async function debug() {
  const jar = new CookieJar();
  const client = wrapper(axios.create({
    jar,
    baseURL: BASE,
    withCredentials: true,
    maxRedirects: 10,
    timeout: 20000,
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
      "Accept": "*/*",
      "Accept-Language": "en-US,en;q=0.9",
    }
  }));

  // Step 1: Load login page
  console.log("\n[STEP 1] Loading login page...");
  await client.get(`/accounts/p/${ZOHO_ORG}/signin?hide_fp=true&orgtype=40&service_language=en&serviceurl=${encodeURIComponent(BASE + "/portal/" + PORTAL + "/redirectFromLogin")}`);
  
  const cookies1 = await jar.getCookies(BASE);
  const iamcsr = cookies1.find(c => c.key === "iamcsr");
  console.log("iamcsr cookie:", iamcsr?.value ? "✓ Found" : "✗ Not found");

  // Step 2: Lookup email - log FULL response
  console.log("\n[STEP 2] Looking up email...");
  const encodedEmail = encodeURIComponent(EMAIL);
  
  try {
    const res = await client.post(
      `/accounts/p/40-${ZOHO_ORG}/signin/v2/lookup/${encodedEmail}`,
      new URLSearchParams({
        mode: "primary",
        cli_time: Date.now().toString(),
        orgtype: "40",
        service_language: "en",
        serviceurl: `${BASE}/portal/${PORTAL}/redirectFromLogin`,
      }).toString(),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
          "X-Zcsrf-Token": `iamcsrcoo=${iamcsr?.value}`,
          "Referer": `${BASE}/accounts/p/${ZOHO_ORG}/signin`,
          "Origin": BASE,
        }
      }
    );

    console.log("\n=== RAW RESPONSE (this is what we need) ===");
    console.log(JSON.stringify(res.data, null, 2));
    console.log("===========================================");

    console.log("\nResponse status:", res.status);
    console.log("Keys in response:", Object.keys(res.data));

  } catch(err) {
    console.log("Request failed:", err.message);
    if(err.response) {
      console.log("Status:", err.response.status);
      console.log("Response body:", JSON.stringify(err.response.data, null, 2));
    }
  }
}

debug().catch(console.error);