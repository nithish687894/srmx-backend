require("dotenv").config();
const fs = require("fs");
const axios = require("axios");
const { CookieJar } = require("tough-cookie");
const { wrapper } = require("axios-cookiejar-support");

const BASE = "https://academia.srmist.edu.in";
const ZOHO_ORG = "10002227248";
const PORTAL = "academia-academic-services";

async function save() {
  const jar = new CookieJar();
  const client = wrapper(axios.create({
    jar, baseURL: BASE, withCredentials: true, maxRedirects: 10, timeout: 20000,
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    }
  }));

  // Step 1: Load login page
  console.log("[1] Loading login page...");
  await client.get(`/accounts/p/${ZOHO_ORG}/signin?hide_fp=true&orgtype=40&service_language=en&serviceurl=${encodeURIComponent(BASE+"/portal/"+PORTAL+"/redirectFromLogin")}`);
  
  const cookies1 = await jar.getCookies(BASE);
  const iamcsr = cookies1.find(c => c.key === "iamcsr")?.value;
  console.log("   iamcsr:", iamcsr ? "✓" : "✗");

  // Step 2: Lookup
  console.log("[2] Looking up user...");
  const res2 = await client.post(
    `/accounts/p/40-${ZOHO_ORG}/signin/v2/lookup/${encodeURIComponent(process.env.SRM_EMAIL)}`,
    new URLSearchParams({ mode:"primary", cli_time:Date.now().toString(), orgtype:"40", service_language:"en", serviceurl:`${BASE}/portal/${PORTAL}/redirectFromLogin` }).toString(),
    { headers: { "Content-Type":"application/x-www-form-urlencoded;charset=UTF-8", "X-Zcsrf-Token":`iamcsrcoo=${iamcsr}`, Referer:`${BASE}/accounts/p/${ZOHO_ORG}/signin`, Origin:BASE } }
  );
  const digest = res2.data?.lookup?.digest;
  const identifier = res2.data?.lookup?.identifier;
  console.log("   identifier:", identifier, "digest:", digest?.slice(0,15)+"...");

  // Step 3: Password
  console.log("[3] Submitting password...");
  const res3 = await client.post(
    `/accounts/p/40-${ZOHO_ORG}/signin/v2/primary/${identifier}/password?digest=${digest}&cli_time=${Date.now()}&orgtype=40&service_language=en&serviceurl=${encodeURIComponent(BASE+"/portal/"+PORTAL+"/redirectFromLogin")}`,
    JSON.stringify({ passwordauth: { password: process.env.SRM_PASSWORD } }),
    { headers: { "Content-Type":"application/x-www-form-urlencoded;charset=UTF-8", "X-Zcsrf-Token":`iamcsrcoo=${iamcsr}`, Referer:`${BASE}/accounts/p/${ZOHO_ORG}/signin`, Origin:BASE } }
  );
  
  const pwData = res3.data;
  console.log("   code:", pwData?.passwordauth?.code);
  console.log("   redirect_uri:", pwData?.passwordauth?.redirect_uri);

  // Step 4: Follow the announcement redirect if present
  if (pwData?.passwordauth?.redirect_uri) {
    console.log("[4] Following announcement redirect...");
    const redirectUrl = pwData.passwordauth.redirect_uri;
    await client.get(redirectUrl, {
      headers: { Accept:"text/html,application/xhtml+xml", Referer:`${BASE}/accounts/p/${ZOHO_ORG}/signin` }
    });
  }

  // Step 5: Hit redirectFromLogin
  console.log("[5] Finalizing session...");
  const finalRes = await client.get(`/portal/${PORTAL}/redirectFromLogin`, {
    headers: { Accept:"text/html,application/xhtml+xml", Referer:`${BASE}/accounts/p/${ZOHO_ORG}/signin` }
  });
  console.log("   final URL:", finalRes.request?.path || "done");

  // Step 6: Hit home page
  console.log("[6] Loading home...");
  await client.get("/", { headers: { Accept:"text/html,application/xhtml+xml", Referer:`${BASE}/portal/${PORTAL}/redirectFromLogin` } });

  // Step 7: Now fetch attendance
  console.log("[7] Fetching attendance page...");
  const attRes = await client.get(`/srm_university/${PORTAL}/page/My_Attendance`, {
    headers: {
      "X-Requested-With": "XMLHttpRequest",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      Referer: `${BASE}/`,
      Accept: "*/*"
    }
  });

  const html = attRes.data;
  fs.writeFileSync("attendance_raw.html", typeof html === "string" ? html : JSON.stringify(html, null, 2));
  console.log("\n✓ Saved attendance_raw.html");
  console.log("  Size:", typeof html === "string" ? html.length : JSON.stringify(html).length, "bytes");
  console.log("  First 300 chars:", (typeof html === "string" ? html : JSON.stringify(html)).slice(0, 300));

  // Also log all cookies for debugging
  const allCookies = await jar.getCookies(BASE);
  console.log("\n  Cookies set:", allCookies.map(c => c.key).join(", "));
}

save().catch(console.error);