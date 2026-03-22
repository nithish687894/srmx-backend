require("dotenv").config();
const { login, getAllData, getTimetable } = require("./src/scraper");

const EMAIL = process.env.SRM_EMAIL;
const PASSWORD = process.env.SRM_PASSWORD;

async function test() {
  console.log("═══════════════════════════════════");
  console.log("  SRMX Scraper Test");
  console.log("═══════════════════════════════════");

  console.log("\n[TEST 1] Login...");
  let client;
  try {
    const result = await login(EMAIL, PASSWORD);
    client = result.client;
    console.log("✓ Login SUCCESS\n");
  } catch (err) {
    console.log("✗ Login FAILED:", err.message);
    process.exit(1);
  }

  console.log("[TEST 2] Fetching all academic data...");
  try {
    const { profile, attendance, marks } = await getAllData(client);

    console.log("\n── PROFILE ──────────────────────────");
    console.log(JSON.stringify(profile, null, 2));

    console.log("\n── ATTENDANCE ───────────────────────");
    console.log(`Found ${attendance.length} courses`);
    if (attendance.length > 0) console.log("Sample:", JSON.stringify(attendance[0], null, 2));

    console.log("\n── MARKS ────────────────────────────");
    console.log(`Found ${marks.length} mark entries`);
    if (marks.length > 0) console.log("Sample:", JSON.stringify(marks[0], null, 2));

  } catch (err) {
    console.log("✗ FAILED:", err.message);
  }

  console.log("\n[TEST 3] Fetching timetable (Batch 1)...");
  try {
    const tt = await getTimetable(client, 1);
    console.log(`✓ Timetable SUCCESS — ${tt.data?.length || tt.data?.days?.length || 0} rows`);
    if (tt.data.length > 0) console.log("Sample row:", tt.data[0]);
  } catch (err) {
    console.log("✗ Timetable FAILED:", err.message);
  }

  console.log("\n═══════════════════════════════════");
  console.log("  Done!");
  console.log("═══════════════════════════════════");
}

test().catch(console.error);