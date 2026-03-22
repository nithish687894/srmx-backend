const axios = require("axios");
const { CookieJar } = require("tough-cookie");
const { wrapper } = require("axios-cookiejar-support");
const cheerio = require("cheerio");

const BASE = "https://academia.srmist.edu.in";
const ZOHO_ORG = "10002227248";
const PORTAL = "academia-academic-services";
const SERVICE_URL = `${BASE}/portal/${PORTAL}/redirectFromLogin`;

const PAGES = {
  ATTENDANCE: "My_Attendance",
  TIMETABLE_B1: "Unified_Time_Table_2025_Batch_1",
  TIMETABLE_B2: "Unified_Time_Table_2025_batch_2",
};

// ─── Create axios client with cookie jar ─────────────────────────────────────
function createClient() {
  const jar = new CookieJar();
  const client = wrapper(axios.create({
    jar, baseURL: BASE, withCredentials: true, maxRedirects: 10, timeout: 20000,
    validateStatus: () => true,
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9",
    }
  }));
  return { client, jar };
}

async function getCsrfToken(jar) {
  const cookies = await jar.getCookies(BASE);
  return cookies.find(c => c.key === "iamcsr")?.value;
}

// ─── LOGIN ────────────────────────────────────────────────────────────────────
async function login(email, password) {
  const { client, jar } = createClient();
  try {
    // Step 1: Load login page
    console.log("[1/4] Loading login page...");
    await client.get(`/accounts/p/${ZOHO_ORG}/signin?hide_fp=true&orgtype=40&service_language=en&serviceurl=${encodeURIComponent(SERVICE_URL)}`, {
      headers: { Accept: "text/html,application/xhtml+xml" }
    });
    const iamcsr = await getCsrfToken(jar);
    if (!iamcsr) throw new Error("No CSRF token");
    const CSRF = {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      "X-Zcsrf-Token": `iamcsrcoo=${iamcsr}`,
      "Referer": `${BASE}/accounts/p/${ZOHO_ORG}/signin`,
      "Origin": BASE
    };

    // Step 2: Lookup email
    console.log("[2/4] Looking up user...");
    const r2 = await client.post(
      `/accounts/p/40-${ZOHO_ORG}/signin/v2/lookup/${encodeURIComponent(email)}`,
      new URLSearchParams({ mode:"primary", cli_time:Date.now().toString(), orgtype:"40", service_language:"en", serviceurl:SERVICE_URL }).toString(),
      { headers: CSRF }
    );
    const { digest, identifier } = r2.data?.lookup || {};
    if (!digest) throw new Error("Digest not found");

    // Step 3: Submit password
    console.log("[3/4] Submitting password...");
    const r3 = await client.post(
      `/accounts/p/40-${ZOHO_ORG}/signin/v2/primary/${identifier}/password?digest=${digest}&cli_time=${Date.now()}&orgtype=40&service_language=en&serviceurl=${encodeURIComponent(SERVICE_URL)}`,
      JSON.stringify({ passwordauth: { password } }),
      { headers: CSRF }
    );
    const redirectUri = r3.data?.passwordauth?.redirect_uri;

    // Step 4: Follow redirect (announcement/block-sessions/direct)
    console.log("[4/4] Finalizing session...");
    if (redirectUri) {
      await client.get(redirectUri, {
        headers: { Accept: "text/html,application/xhtml+xml", Referer: `${BASE}/accounts/p/${ZOHO_ORG}/signin` }
      });
    }

    // Step 5: Hit redirectFromLogin to get auth cookies
    await client.get(`/portal/${PORTAL}/redirectFromLogin`, {
      headers: { Accept: "text/html,application/xhtml+xml", Referer: `${BASE}/` }
    });

    // Step 6: Load home
    await client.get("/", {
      headers: { Accept: "text/html", Referer: `${BASE}/portal/${PORTAL}/redirectFromLogin` }
    });

    // Verify auth cookies
    const cookies = await jar.getCookies(BASE);
    const hasAuth = cookies.some(c => c.key === "_z_identity" || c.key.startsWith("_iamadt"));
    if (!hasAuth) throw new Error("Auth cookies missing — please logout of SRM in browser first, then retry");

    console.log("[✓] Login successful!");
    return { client, jar };
  } catch (err) {
    throw new Error(`Login failed: ${err.message}`);
  }
}

// ─── FETCH PAGE ───────────────────────────────────────────────────────────────
async function fetchPage(client, pageName) {
  const res = await client.get(
    `/srm_university/${PORTAL}/page/${pageName}`,
    { headers: { "X-Requested-With":"XMLHttpRequest", "Content-Type":"application/x-www-form-urlencoded; charset=UTF-8", Referer:`${BASE}/`, Accept:"*/*" } }
  );
  return typeof res.data === "string" ? res.data : JSON.stringify(res.data);
}

// ─── DECODE HEX-ENCODED HTML ─────────────────────────────────────────────────
// SRM stores page content as \xNN hex-escaped JS string inside pageSanitizer.sanitize('...')
function decodeHexHtml(rawHtml) {
  // Extract content between pageSanitizer.sanitize('...') 
  const match = rawHtml.match(/pageSanitizer\.sanitize\('([\s\S]+?)'\)(?:\s*;|\s*\})/);
  if (!match) {
    // Fallback: try to find innerHTML assignment
    const match2 = rawHtml.match(/\.innerHTML\s*=\s*pageSanitizer\.sanitize\('([\s\S]+?)'\)/);
    if (!match2) return rawHtml; // return as-is if no encoding found
    return decodeHexString(match2[1]);
  }
  return decodeHexString(match[1]);
}

function decodeHexString(str) {
  // Replace \xNN with actual characters
  return str.replace(/\\x([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

// ─── PARSE ACADEMIC STATUS PAGE ───────────────────────────────────────────────
function parseAcademicStatus(rawHtml) {
  const decoded = decodeHexHtml(rawHtml);
  const $ = cheerio.load(decoded);

  // ── Profile ──
  const profile = {};
  $("table").each((_, table) => {
    $(table).find("tr").each((_, row) => {
      const tds = $(row).find("td");
      if (tds.length >= 2) {
        const key = $(tds[0]).text().trim().replace(/\s+/g, " ").replace(/:$/, "");
        const val = $(tds[1]).text().trim();
        if (key && val && key.length < 50 && !key.includes("Course")) {
          profile[key] = val;
        }
      }
    });
    // Stop after profile table
    const text = $(table).text();
    if (text.includes("Registration Number") && text.includes("Semester")) return false;
  });

  // ── Attendance ──
  const attendance = [];
  $("table").each((_, table) => {
    const headerText = $(table).find("tr").first().text();
    if (!headerText.includes("Attn") && !headerText.includes("Hours Conducted")) return;
    
    const headers = $(table).find("tr").first().find("td,th")
      .map((_, c) => $(c).text().trim()).get()
      .filter(h => h); // remove empty

    $(table).find("tr").slice(1).each((_, row) => {
      const cells = $(row).find("td").map((_, c) => $(c).text().trim().replace(/\s+/g," ")).get();
      if (cells.length > 3 && cells[0] && cells[0].match(/^\d{2}[A-Z]/)) {
        // Clean course code (remove Regular/Arrear tag)
        cells[0] = cells[0].replace(/\s*(Regular|Arrear)\s*$/i, "").trim();
        const obj = {};
        headers.forEach((h, i) => { if (h) obj[h] = cells[i] || ""; });
        attendance.push(obj);
      }
    });
  });

  // ── Marks ──
  const marks = [];
  $("table").each((_, table) => {
    const headerText = $(table).find("tr").first().text();
    if (!headerText.includes("Test Performance") && !headerText.includes("Course Type")) return;

    $(table).find("tr").slice(1).each((_, row) => {
      const tds = $(row).find("td");
      if (tds.length < 2) return;
      const courseCode = $(tds[0]).text().trim();
      const courseType = $(tds[1]).text().trim();
      if (!courseCode.match(/^\d{2}[A-Z]/)) return;

      // Each nested td has <strong>FT-II/15.00</strong><br>0.90
      const testResults = [];
      $(tds[2]).find("table td").each((_, td) => {
        const testName = $(td).find("strong").text().trim();
        if (!testName) return;
        const allText = $(td).text().trim();
        const score = allText.replace(testName, "").trim();
        testResults.push({ test: testName, score: score || "N/A" });
      });

      marks.push({ courseCode, courseType, tests: testResults });
    });
  });

  return { profile, attendance, marks };
}

// ─── PARSE TIMETABLE (also hex-encoded) ──────────────────────────────────────
function parseTimetable(rawHtml) {
  const decoded = decodeHexHtml(rawHtml);
  const $ = cheerio.load(decoded);
  const result = { days: [] };

  $("table tr").each((i, row) => {
    const cells = $(row).find("td,th").map((_, c) => $(c).text().trim()).get();
    if (cells.length > 1) result.days.push(cells);
  });

  return result.days;
}

// ─── PUBLIC API ───────────────────────────────────────────────────────────────
async function getAllData(client) {
  const html = await fetchPage(client, PAGES.ATTENDANCE);
  return parseAcademicStatus(html);
}

async function getAttendance(client) {
  const { attendance, profile } = await getAllData(client);
  return { success: true, data: attendance, profile };
}

async function getMarks(client) {
  const { marks } = await getAllData(client);
  return { success: true, data: marks };
}

async function getProfile(client) {
  const { profile } = await getAllData(client);
  return { success: true, data: profile };
}

async function getTimetable(client, batch = 1) {
  const pageName = batch === 1 ? PAGES.TIMETABLE_B1 : PAGES.TIMETABLE_B2;
  const html = await fetchPage(client, pageName);
  const data = parseTimetable(html);
  return { success: true, data, batch };
}

module.exports = { login, getAttendance, getMarks, getTimetable, getProfile, getAllData, fetchPage };