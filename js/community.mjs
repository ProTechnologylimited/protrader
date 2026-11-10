/* ProTrader shared community API.
 * Customer-facing writes require a ProTrader customer session.
 * Public feed reads expose display names only, never customer email addresses.
 */

export function installCommunity(app, {
  db,
  requireCustomer,
  requireAdmin,
  rateLimit,
}) {
  if (!app || !db || !requireCustomer || !requireAdmin || !rateLimit) {
    throw new Error("Community API dependencies are incomplete.");
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS community_profiles (
      customer_id INTEGER PRIMARY KEY,
      display_name TEXT NOT NULL COLLATE NOCASE UNIQUE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(customer_id) REFERENCES customers(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS community_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL,
      channel TEXT NOT NULL CHECK(channel IN ('general','markets','help','feedback')),
      body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 2000),
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','hidden')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(customer_id) REFERENCES customers(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_community_posts_feed
      ON community_posts(status, channel, id DESC);

    CREATE TABLE IF NOT EXISTS community_replies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL,
      customer_id INTEGER NOT NULL,
      body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 1000),
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','hidden')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(post_id) REFERENCES community_posts(id) ON DELETE CASCADE,
      FOREIGN KEY(customer_id) REFERENCES customers(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_community_replies_post
      ON community_replies(post_id, status, id ASC);

    CREATE TABLE IF NOT EXISTS community_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reporter_customer_id INTEGER NOT NULL,
      target_type TEXT NOT NULL CHECK(target_type IN ('post','reply')),
      target_id INTEGER NOT NULL,
      reason TEXT NOT NULL CHECK(reason IN ('spam','scam','harassment','misinformation','other')),
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','reviewed','dismissed')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(reporter_customer_id) REFERENCES customers(id) ON DELETE CASCADE,
      UNIQUE(reporter_customer_id, target_type, target_id)
    );

    CREATE INDEX IF NOT EXISTS idx_community_reports_status
      ON community_reports(status, id DESC);
  `);

  const postLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    limit: 8,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many community posts. Please try again later." },
  });

  const replyLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many replies. Please try again later." },
  });

  const reportLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many reports. Please try again later." },
  });

  const channels = new Set(["general", "markets", "help", "feedback"]);
  const reasons = new Set(["spam", "scam", "harassment", "misinformation", "other"]);

  function customerId(req) {
    return Number(req.session.customerId);
  }

  function hasProfile(id) {
    return db.prepare(`
      SELECT customer_id, display_name
      FROM community_profiles
      WHERE customer_id = ?
    `).get(id);
  }

  app.get("/api/community/posts", (req, res) => {
    const channel = String(req.query.channel || "all").toLowerCase();
    const limit = Math.max(1, Math.min(50, Number.parseInt(req.query.limit, 10) || 30));

    if (channel !== "all" && !channels.has(channel)) {
      return res.status(400).json({ error: "Unknown community channel." });
    }

    const base = `
      SELECT
        p.id,
        p.channel,
        p.body,
        p.created_at AS createdAt,
        cp.display_name AS displayName,
        (SELECT COUNT(*) FROM community_replies r
          WHERE r.post_id = p.id AND r.status = 'active') AS replyCount
      FROM community_posts p
      INNER JOIN community_profiles cp ON cp.customer_id = p.customer_id
      WHERE p.status = 'active'
    `;

    const posts = channel === "all"
      ? db.prepare(`${base} ORDER BY p.id DESC LIMIT ?`).all(limit)
      : db.prepare(`${base} AND p.channel = ? ORDER BY p.id DESC LIMIT ?`).all(channel, limit);

    return res.json({ ok: true, posts });
  });

  app.get("/api/community/posts/:postId/replies", (req, res) => {
    const postId = Number(req.params.postId);
    if (!Number.isSafeInteger(postId) || postId < 1) {
      return res.status(400).json({ error: "Invalid post ID." });
    }

    const post = db.prepare(`
      SELECT id FROM community_posts WHERE id = ? AND status = 'active'
    `).get(postId);

    if (!post) return res.status(404).json({ error: "Community post not found." });

    const replies = db.prepare(`
      SELECT r.id, r.body, r.created_at AS createdAt,
             cp.display_name AS displayName
      FROM community_replies r
      INNER JOIN community_profiles cp ON cp.customer_id = r.customer_id
      WHERE r.post_id = ? AND r.status = 'active'
      ORDER BY r.id ASC
      LIMIT 100
    `).all(postId);

    return res.json({ ok: true, replies });
  });

  app.get("/api/community/profile", requireCustomer, (req, res) => {
    const profile = hasProfile(customerId(req));
    return res.json({
      ok: true,
      profile: profile ? { displayName: profile.display_name } : null,
    });
  });

  app.post("/api/community/profile", requireCustomer, (req, res) => {
    const displayName = typeof req.body?.displayName === "string"
      ? req.body.displayName.trim()
      : "";

    if (!/^[A-Za-z0-9][A-Za-z0-9 _-]{2,23}$/.test(displayName)) {
      return res.status(400).json({
        error: "Choose a display name of 3–24 characters using letters, numbers, spaces, underscores or hyphens.",
      });
    }

    try {
      db.prepare(`
        INSERT INTO community_profiles (customer_id, display_name)
        VALUES (?, ?)
        ON CONFLICT(customer_id) DO UPDATE SET
          display_name = excluded.display_name,
          updated_at = CURRENT_TIMESTAMP
      `).run(customerId(req), displayName);

      return res.json({ ok: true, profile: { displayName } });
    } catch (error) {
      if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
        return res.status(409).json({ error: "That display name is already in use. Choose another." });
      }
      console.error("Community profile save failed:", error.message);
      return res.status(500).json({ error: "Unable to save your community profile." });
    }
  });

  app.post("/api/community/posts", requireCustomer, postLimiter, (req, res) => {
    const channel = typeof req.body?.channel === "string"
      ? req.body.channel.toLowerCase()
      : "";
    const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";

    if (!channels.has(channel)) {
      return res.status(400).json({ error: "Choose a valid community channel." });
    }
    if (!body || body.length > 2000) {
      return res.status(400).json({ error: "Your post must contain 1–2,000 characters." });
    }
    if (!hasProfile(customerId(req))) {
      return res.status(409).json({ error: "Set your community display name before posting." });
    }

    const result = db.prepare(`
      INSERT INTO community_posts (customer_id, channel, body)
      VALUES (?, ?, ?)
    `).run(customerId(req), channel, body);

    return res.status(201).json({ ok: true, postId: Number(result.lastInsertRowid) });
  });

  app.post("/api/community/posts/:postId/replies", requireCustomer, replyLimiter, (req, res) => {
    const postId = Number(req.params.postId);
    const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";

    if (!Number.isSafeInteger(postId) || postId < 1) {
      return res.status(400).json({ error: "Invalid post ID." });
    }
    if (!body || body.length > 1000) {
      return res.status(400).json({ error: "Your reply must contain 1–1,000 characters." });
    }
    if (!hasProfile(customerId(req))) {
      return res.status(409).json({ error: "Set your community display name before replying." });
    }

    const post = db.prepare(`
      SELECT id FROM community_posts WHERE id = ? AND status = 'active'
    `).get(postId);
    if (!post) return res.status(404).json({ error: "Community post not found." });

    const result = db.prepare(`
      INSERT INTO community_replies (post_id, customer_id, body)
      VALUES (?, ?, ?)
    `).run(postId, customerId(req), body);

    return res.status(201).json({ ok: true, replyId: Number(result.lastInsertRowid) });
  });

  app.post("/api/community/reports", requireCustomer, reportLimiter, (req, res) => {
    const targetType = req.body?.targetType;
    const targetId = Number(req.body?.targetId);
    const reason = req.body?.reason;

    if (!['post', 'reply'].includes(targetType) || !Number.isSafeInteger(targetId) || targetId < 1) {
      return res.status(400).json({ error: "Choose a valid post or reply to report." });
    }
    if (!reasons.has(reason)) {
      return res.status(400).json({ error: "Choose a valid report reason." });
    }

    const table = targetType === "post" ? "community_posts" : "community_replies";
    const target = db.prepare(`SELECT id FROM ${table} WHERE id = ? AND status = 'active'`).get(targetId);
    if (!target) return res.status(404).json({ error: "The reported content was not found." });

    try {
      db.prepare(`
        INSERT INTO community_reports (reporter_customer_id, target_type, target_id, reason)
        VALUES (?, ?, ?, ?)
      `).run(customerId(req), targetType, targetId, reason);
      return res.status(201).json({ ok: true, message: "Report sent to the moderation team." });
    } catch (error) {
      if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
        return res.status(409).json({ error: "You have already reported this item." });
      }
      console.error("Community report failed:", error.message);
      return res.status(500).json({ error: "Unable to submit your report." });
    }
  });

  // Moderator endpoints use the separate administrator session.
  app.get("/api/admin/community/reports", requireAdmin, (req, res) => {
    const reports = db.prepare(`
      SELECT r.id, r.target_type AS targetType, r.target_id AS targetId,
             r.reason, r.status, r.created_at AS createdAt,
             reporter.display_name AS reporter,
             CASE WHEN r.target_type = 'post'
               THEN (SELECT body FROM community_posts WHERE id = r.target_id)
               ELSE (SELECT body FROM community_replies WHERE id = r.target_id)
             END AS targetBody
      FROM community_reports r
      LEFT JOIN community_profiles reporter
        ON reporter.customer_id = r.reporter_customer_id
      WHERE r.status = 'pending'
      ORDER BY r.id DESC
      LIMIT 100
    `).all();

    return res.json({ ok: true, reports });
  });

  app.post("/api/admin/community/dismiss-report", requireAdmin, (req, res) => {
    const reportId = Number(req.body?.reportId);
    if (!Number.isSafeInteger(reportId) || reportId < 1) {
      return res.status(400).json({ error: "Invalid report ID." });
    }

    const result = db.prepare(`
      UPDATE community_reports
      SET status = 'dismissed'
      WHERE id = ? AND status = 'pending'
    `).run(reportId);

    if (result.changes !== 1) {
      return res.status(404).json({ error: "Pending report not found." });
    }

    return res.json({ ok: true, status: "dismissed" });
  });

  app.post("/api/admin/community/moderate", requireAdmin, (req, res) => {
    const type = req.body?.type;
    const action = req.body?.action;
    const id = Number(req.body?.id);

    if (!['post', 'reply'].includes(type) || !['hide', 'restore'].includes(action) || !Number.isSafeInteger(id) || id < 1) {
      return res.status(400).json({ error: "Invalid moderation request." });
    }

    const table = type === "post" ? "community_posts" : "community_replies";
    const status = action === "hide" ? "hidden" : "active";
    const result = db.prepare(`UPDATE ${table} SET status = ? WHERE id = ?`).run(status, id);

    if (result.changes !== 1) return res.status(404).json({ error: "Community content not found." });

    db.prepare(`
      UPDATE community_reports
      SET status = 'reviewed'
      WHERE target_type = ? AND target_id = ? AND status = 'pending'
    `).run(type, id);

    return res.json({ ok: true, status });
  });
}
