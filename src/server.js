require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const crypto = require("crypto");
const NodeCache = require("node-cache");
const { login, getAttendance, getMarks, getTimetable, getProfile, getAllData } = require("./scraper");

const app = express();

// ─── Security Headers ─────────────────────────────────────────────────────────
app.use(helmet());

// ─── CORS — open for dev, restricted for prod ────────────────────────────────
const isProd = process.env.NODE_ENV === "production";
if (isProd) {
  const ALLOWED = [
    "http://localhost:3000",
    "https://srmx-beta.vercel.app",
    process.env.FRONTEND_URL,
  ].filter(Boolean);
  app.use(cors({
    origin: (origin, cb) => {
      if (!origin || ALLOWED.includes(origin)) return cb(null, true);
      return cb(new Error("CORS: origin not allowed"));
    },
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "x-session-token"],
  }));
} else {
  app.use(cors()); // open in development
}

// ─── Body limit ───────────────────────────────────────────────────────────────
app.use(express.json({ limit: "10kb" }));

// ─── Rate Limiting ────────────────────────────────────────────────────────────
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: "Too many login attempts. Try again in 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: "Too many requests. Please slow down." },
});

app.use("/api/", apiLimiter);

// ─── Session Store ────────────────────────────────────────────────────────────
const cache = new NodeCache({ stdTTL: 300 });
const sessions = new Map();

// ─── Input validation ─────────────────────────────────────────────────────────
function isValidEmail(email) {
  return typeof email === "string" &&
    /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/.test(email) &&
    email.length < 100;
}

function isValidPassword(password) {
  return typeof password === "string" &&
    password.length >= 4 &&
    password.length < 200;
}

// ─── Auth Middleware ──────────────────────────────────────────────────────────
function requireSession(req, res, next) {
  const token = req.headers["x-session-token"];
  if (!token || typeof token !== "string" || token.length > 200) {
    return res.status(401).json({ error: "Not logged in." });
  }
  if (!sessions.has(token)) {
    return res.status(401).json({ error: "Session expired. Please login again." });
  }
  req.session = sessions.get(token);
  next();
}

// ─── Cached fetch ─────────────────────────────────────────────────────────────
async function cachedFetch(key, fetchFn) {
  const cached = cache.get(key);
  if (cached) return cached;
  const data = await fetchFn();
  cache.set(key, data);
  return data;
}

// ─── POST /api/login ──────────────────────────────────────────────────────────
app.post("/api/login", loginLimiter, async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password)
    return res.status(400).json({ error: "Email and password required." });
  if (!isValidEmail(email))
    return res.status(400).json({ error: "Invalid email format." });
  if (!isValidPassword(password))
    return res.status(400).json({ error: "Invalid password." });

  // Reuse existing session within 30 mins
  for (const [token, session] of sessions.entries()) {
    if (session.email === email) {
      const age = Date.now() - session.loginTime;
      if (age < 30 * 60 * 1000) {
        return res.json({ success: true, token, reused: true });
      }
    }
  }

  try {
    const { client, jar } = await login(email, password);
    const token = crypto.randomBytes(32).toString("hex");
    sessions.set(token, { client, jar, email, loginTime: Date.now() });
    res.json({ success: true, token });
  } catch (err) {
    const msg = err.message?.includes("Auth cookies missing")
      ? "Login failed — please logout of SRM in browser first, then retry."
      : "Login failed. Check your credentials.";
    res.status(401).json({ error: msg });
  }
});

// ─── GET /api/profile ─────────────────────────────────────────────────────────
app.get("/api/profile", requireSession, async (req, res) => {
  try {
    const data = await cachedFetch(`profile_${req.session.email}`, () =>
      getProfile(req.session.client));
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch profile." });
  }
});

// ─── GET /api/attendance ──────────────────────────────────────────────────────
app.get("/api/attendance", requireSession, async (req, res) => {
  try {
    const data = await cachedFetch(`attendance_${req.session.email}`, () =>
      getAttendance(req.session.client));
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch attendance." });
  }
});

// ─── GET /api/marks ───────────────────────────────────────────────────────────
app.get("/api/marks", requireSession, async (req, res) => {
  try {
    const data = await cachedFetch(`marks_${req.session.email}`, () =>
      getMarks(req.session.client));
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch marks." });
  }
});

// ─── GET /api/timetable ───────────────────────────────────────────────────────
app.get("/api/timetable", requireSession, async (req, res) => {
  const batch = parseInt(req.query.batch);
  if (![1, 2].includes(batch))
    return res.status(400).json({ error: "Invalid batch. Must be 1 or 2." });
  try {
    const data = await cachedFetch(`timetable_${req.session.email}_${batch}`, () =>
      getTimetable(req.session.client, batch));
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch timetable." });
  }
});

// ─── GET /api/all ─────────────────────────────────────────────────────────────
app.get("/api/all", requireSession, async (req, res) => {
  try {
    const data = await cachedFetch(`all_${req.session.email}`, () =>
      getAllData(req.session.client));
    res.json({ success: true, ...data });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch data." });
  }
});

// ─── POST /api/logout ─────────────────────────────────────────────────────────
app.post("/api/logout", requireSession, (req, res) => {
  const token = req.headers["x-session-token"];
  const email = req.session.email;
  sessions.delete(token);
  cache.del([
    `profile_${email}`, `attendance_${email}`, `marks_${email}`,
    `timetable_${email}_1`, `timetable_${email}_2`, `all_${email}`
  ]);
  res.json({ success: true });
});

// ─── GET /api/health ──────────────────────────────────────────────────────────
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

// ─── Global error handler ─────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: "Internal server error." });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`✓ SRMX Backend running on port ${PORT}`);
  console.log(`  Mode: ${isProd ? "production (strict CORS)" : "development (open CORS)"}`);
});