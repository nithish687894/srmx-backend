require("dotenv").config();
const express = require("express");
const cors = require("cors");
const NodeCache = require("node-cache");
const { login, getAttendance, getMarks, getTimetable, getProfile, getAllData } = require("./scraper");

const app = express();
const cache = new NodeCache({ stdTTL: 300 }); // 5 min cache for data
const sessions = new Map(); // token → { client, jar, email, loginTime }

app.use(cors());
app.use(express.json());

// ─── Helper: require valid session token ─────────────────────────────────────
function requireSession(req, res, next) {
  const token = req.headers["x-session-token"];
  if (!token || !sessions.has(token)) {
    return res.status(401).json({ error: "Not logged in. Please login first." });
  }
  req.session = sessions.get(token);
  next();
}

// ─── Helper: cached data fetch ────────────────────────────────────────────────
async function cachedFetch(key, fetchFn) {
  const cached = cache.get(key);
  if (cached) return cached;
  const data = await fetchFn();
  cache.set(key, data);
  return data;
}

// ─── POST /api/login ──────────────────────────────────────────────────────────
app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: "Email and password required" });

  // Check if already have a valid session for this email
  for (const [token, session] of sessions.entries()) {
    if (session.email === email) {
      const age = Date.now() - session.loginTime;
      if (age < 30 * 60 * 1000) { // 30 min session reuse
        console.log(`Reusing existing session for ${email}`);
        return res.json({ success: true, token, reused: true });
      }
    }
  }

  try {
    const { client, jar } = await login(email, password);
    const token = Buffer.from(`${email}:${Date.now()}`).toString("base64url");
    sessions.set(token, { client, jar, email, loginTime: Date.now() });
    res.json({ success: true, token });
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

// ─── GET /api/profile ─────────────────────────────────────────────────────────
app.get("/api/profile", requireSession, async (req, res) => {
  try {
    const data = await cachedFetch(`profile_${req.session.email}`, () =>
      getProfile(req.session.client)
    );
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/attendance ──────────────────────────────────────────────────────
app.get("/api/attendance", requireSession, async (req, res) => {
  try {
    const data = await cachedFetch(`attendance_${req.session.email}`, () =>
      getAttendance(req.session.client)
    );
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/marks ───────────────────────────────────────────────────────────
app.get("/api/marks", requireSession, async (req, res) => {
  try {
    const data = await cachedFetch(`marks_${req.session.email}`, () =>
      getMarks(req.session.client)
    );
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/timetable ───────────────────────────────────────────────────────
app.get("/api/timetable", requireSession, async (req, res) => {
  const batch = parseInt(req.query.batch) || 1;
  try {
    const data = await cachedFetch(`timetable_${req.session.email}_${batch}`, () =>
      getTimetable(req.session.client, batch)
    );
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/all ─────────────────────────────────────────────────────────────
// Returns everything in one call — frontend can use this for dashboard
app.get("/api/all", requireSession, async (req, res) => {
  try {
    const data = await cachedFetch(`all_${req.session.email}`, () =>
      getAllData(req.session.client)
    );
    res.json({ success: true, ...data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/logout ─────────────────────────────────────────────────────────
app.post("/api/logout", requireSession, (req, res) => {
  const token = req.headers["x-session-token"];
  const email = req.session.email;
  sessions.delete(token);
  // Clear cached data for this user
  cache.del([`profile_${email}`, `attendance_${email}`, `marks_${email}`, `timetable_${email}_1`, `timetable_${email}_2`, `all_${email}`]);
  res.json({ success: true });
});

// ─── GET /api/health ──────────────────────────────────────────────────────────
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", activeSessions: sessions.size, cacheKeys: cache.keys().length });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`✓ SRMX Backend running on http://localhost:${PORT}`);
  console.log(`  Endpoints: /api/login, /api/all, /api/attendance, /api/marks, /api/timetable, /api/profile`);
});