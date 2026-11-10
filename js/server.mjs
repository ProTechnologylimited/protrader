
import cors from "cors";
import express from "express";
import { installCommunity } from "./community.mjs";
import "dotenv/config";
import session from "express-session";
import { rateLimit } from "express-rate-limit";
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import path from "node:path";
import { mkdirSync } from "node:fs";
import {
  randomBytes,
  createHash,
  randomUUID,
} from "node:crypto";
import {
  JsonRpcProvider,
  isHexString,
  getAddress,
  formatEther,
  verifyMessage,
} from "ethers";

// --------------------------------------------------
// Configuration
// --------------------------------------------------

const app = express();

const PORT = Number(process.env.PORT || 3001);
const CHAIN_ID = 11155111;
const MIN_CONFIRMATIONS = 3;
const SESSION_DURATION = 8 * 60 * 60 * 1000;
const WALLET_CHALLENGE_DURATION = 5 * 60 * 1000;
const IS_PRODUCTION = process.env.NODE_ENV === "production";

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error("Invalid PORT in .env");
}

const sessionSecret = process.env.SESSION_SECRET;

if (
  typeof sessionSecret !== "string" ||
  sessionSecret.length < 32
) {
  throw new Error(
    "SESSION_SECRET is missing or too short in .env"
  );
}

const allowedOrigins = [
  ...(
    process.env.CORS_ORIGINS ||
    "http://localhost:5173,http://127.0.0.1:5173,http://localhost:3001,http://127.0.0.1:3001"
  )
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  process.env.RENDER_EXTERNAL_URL,
  process.env.APP_ORIGIN,
].filter(Boolean);

app.disable("x-powered-by");

if (IS_PRODUCTION) {
  app.set("trust proxy", 1);
}

// --------------------------------------------------
// Database setup
// --------------------------------------------------

const dbPath = path.resolve(
  process.env.ADMIN_DB_PATH || "./data/protrader.sqlite"
);

mkdirSync(path.dirname(dbPath), {
  recursive: true,
});

const db = new Database(dbPath);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");

db.exec(`
  CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS admin_sessions (
    sid TEXT PRIMARY KEY,
    session_data TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_admin_sessions_expiry
  ON admin_sessions(expires_at);

  CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    email_verified INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_customers_email
  ON customers(email);

  CREATE TABLE IF NOT EXISTS customer_sessions (
    sid TEXT PRIMARY KEY,
    session_data TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_customer_sessions_expiry
  ON customer_sessions(expires_at);

  CREATE TABLE IF NOT EXISTS customer_wallets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL,
    chain_id INTEGER NOT NULL,
    wallet_address TEXT NOT NULL COLLATE NOCASE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY(customer_id)
      REFERENCES customers(id)
      ON DELETE CASCADE,

    UNIQUE(chain_id, wallet_address)
  );

  CREATE INDEX IF NOT EXISTS idx_customer_wallets_customer
  ON customer_wallets(customer_id);

  CREATE TABLE IF NOT EXISTS customer_deposits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL,
    chain_id INTEGER NOT NULL,
    transaction_hash TEXT NOT NULL UNIQUE COLLATE NOCASE,
    from_address TEXT NOT NULL COLLATE NOCASE,
    to_address TEXT NOT NULL COLLATE NOCASE,
    amount_wei TEXT NOT NULL,
    block_number INTEGER NOT NULL,
    block_hash TEXT NOT NULL,
    confirmations INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'verified',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY(customer_id)
      REFERENCES customers(id)
      ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_customer_deposits_customer
  ON customer_deposits(customer_id);

  CREATE TABLE IF NOT EXISTS wallet_challenges (
    id TEXT PRIMARY KEY,
    customer_id INTEGER NOT NULL,
    chain_id INTEGER NOT NULL,
    wallet_address TEXT NOT NULL COLLATE NOCASE,
    message TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    consumed_at INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY(customer_id)
      REFERENCES customers(id)
      ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_wallet_challenges_expiry
  ON wallet_challenges(expires_at);

  CREATE TABLE IF NOT EXISTS platform_fee_ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT NOT NULL,
    side TEXT NOT NULL,
    fee_type TEXT NOT NULL,
    amount_usdt REAL NOT NULL CHECK(amount_usdt >= 0),
    reference TEXT UNIQUE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_platform_fee_created
  ON platform_fee_ledger(created_at);
`);

// --------------------------------------------------
// Passphrase helpers
// --------------------------------------------------

// SHA-256 preprocessing gives bcrypt a fixed-size input.
// This prevents bcrypt's 72-byte input limit from silently
// truncating longer customer passphrases.

function prepareCustomerPassphrase(passphrase) {
  return createHash("sha256")
    .update("ProTrader customer passphrase v1\0", "utf8")
    .update(passphrase, "utf8")
    .digest("hex");
}

async function hashCustomerPassphrase(passphrase) {
  const prepared = prepareCustomerPassphrase(passphrase);
  return bcrypt.hash(prepared, 12);
}

async function verifyCustomerPassphrase(
  passphrase,
  passwordHash
) {
  const prepared = prepareCustomerPassphrase(passphrase);

  return bcrypt.compare(prepared, passwordHash);
}

// --------------------------------------------------
// SQLite session store
// --------------------------------------------------

class SQLiteSessionStore extends session.Store {
  constructor(tableName = "admin_sessions") {
    super();

    const allowedTables = [
      "admin_sessions",
      "customer_sessions",
    ];

    if (!allowedTables.includes(tableName)) {
      throw new Error("Invalid session table.");
    }

    this.tableName = tableName;
  }

  get(sid, callback) {
    try {
      const row = db.prepare(`
        SELECT session_data, expires_at
        FROM ${this.tableName}
        WHERE sid = ?
      `).get(sid);

      if (!row || row.expires_at <= Date.now()) {
        db.prepare(`
          DELETE FROM ${this.tableName}
          WHERE sid = ?
        `).run(sid);

        return callback(null, null);
      }

      return callback(null, JSON.parse(row.session_data));
    } catch (error) {
      return callback(error);
    }
  }

  set(sid, sessionData, callback = () => {}) {
    try {
      const cookieExpiry = sessionData.cookie?.expires
        ? new Date(sessionData.cookie.expires).getTime()
        : Date.now() + SESSION_DURATION;

      const expiresAt = Number.isFinite(cookieExpiry)
        ? cookieExpiry
        : Date.now() + SESSION_DURATION;

      db.prepare(`
        INSERT INTO ${this.tableName} (
          sid,
          session_data,
          expires_at
        )
        VALUES (?, ?, ?)
        ON CONFLICT(sid) DO UPDATE SET
          session_data = excluded.session_data,
          expires_at = excluded.expires_at
      `).run(
        sid,
        JSON.stringify(sessionData),
        expiresAt
      );

      db.prepare(`
        DELETE FROM ${this.tableName}
        WHERE expires_at <= ?
      `).run(Date.now());

      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  destroy(sid, callback = () => {}) {
    try {
      db.prepare(`
        DELETE FROM ${this.tableName}
        WHERE sid = ?
      `).run(sid);

      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  touch(sid, sessionData, callback = () => {}) {
    try {
      const cookieExpiry = sessionData.cookie?.expires
        ? new Date(sessionData.cookie.expires).getTime()
        : Date.now() + SESSION_DURATION;

      const expiresAt = Number.isFinite(cookieExpiry)
        ? cookieExpiry
        : Date.now() + SESSION_DURATION;

      db.prepare(`
        UPDATE ${this.tableName}
        SET expires_at = ?
        WHERE sid = ?
      `).run(expiresAt, sid);

      callback(null);
    } catch (error) {
      callback(error);
    }
  }
}

// --------------------------------------------------
// Middleware
// --------------------------------------------------

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(new Error("Origin not allowed by CORS"));
  },
  credentials: true,
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));

app.use(express.json({
  limit: "16kb",
}));

const sessionCookieOptions = {
  httpOnly: true,
  secure: IS_PRODUCTION,
  sameSite: "lax",
  maxAge: SESSION_DURATION,
  path: "/",
};

const adminSession = session({
  name: "protrader.admin.sid",
  secret: sessionSecret,
  store: new SQLiteSessionStore("admin_sessions"),
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: { ...sessionCookieOptions },
});

const customerSession = session({
  name: "protrader.customer.sid",
  secret: sessionSecret,
  store: new SQLiteSessionStore("customer_sessions"),
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: { ...sessionCookieOptions },
});

// Customer and administrator sessions use separate cookies
// and separate SQLite session tables.

app.use((req, res, next) => {
  if (
    req.path.startsWith("/api/customer/") ||
    req.path.startsWith("/api/community/") ||
    req.path === "/api/deposits/verify"
  ) {
    return customerSession(req, res, next);
  }

  return adminSession(req, res, next);
});

// --------------------------------------------------
// Authentication middleware
// --------------------------------------------------

function requireAdmin(req, res, next) {
  if (!req.session || !req.session.adminId) {
    return res.status(401).json({
      error: "Administrator authentication required.",
    });
  }

  return next();
}

function requireCustomer(req, res, next) {
  if (!req.session || !req.session.customerId) {
    return res.status(401).json({
      error: "Customer authentication required.",
    });
  }

  return next();
}

// --------------------------------------------------
installCommunity(app, { db, requireCustomer, requireAdmin, rateLimit });

// Rate limiting
// --------------------------------------------------

const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Too many administrator login attempts. Try again in 15 minutes.",
  },
});

// Allow up to 10 unsuccessful registration attempts per IP
// during the 15-minute window. Successful requests are skipped.

const customerRegisterLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Too many unsuccessful registration attempts. Try again in 15 minutes.",
  },
});

const customerLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Too many login attempts. Try again in 15 minutes.",
  },
});

const walletChallengeLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Too many wallet verification requests. Try again shortly.",
  },
});

const depositVerifyLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Too many deposit verification requests. Try again shortly.",
  },
});

// --------------------------------------------------
// Health check
// --------------------------------------------------

app.get("/api/health", (req, res) => {
  return res.json({
    ok: true,
    service: "ProTrader verification API",
    network: "sepolia",
  });
});

// --------------------------------------------------
// Customer registration
// --------------------------------------------------

app.post(
  "/api/customer/register",
  customerRegisterLimiter,
  async (req, res) => {
    try {
      const { email, passphrase, confirmPassphrase } =
        req.body || {};

      if (
        typeof email !== "string" ||
        typeof passphrase !== "string" ||
        typeof confirmPassphrase !== "string"
      ) {
        return res.status(400).json({
          error: "Enter your email and both passphrase fields.",
        });
      }

      const normalizedEmail = email.trim().toLowerCase();

      const emailPattern =
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

      if (
        normalizedEmail.length > 254 ||
        !emailPattern.test(normalizedEmail)
      ) {
        return res.status(400).json({
          error: "Enter a valid email address.",
        });
      }

      if (
        passphrase.length < 12 ||
        passphrase.length > 200
      ) {
        return res.status(400).json({
          error: "Your passphrase must contain 12 to 200 characters.",
        });
      }

      if (passphrase !== confirmPassphrase) {
        return res.status(400).json({
          error: "Your passphrases do not match.",
        });
      }

      const passwordHash =
        await hashCustomerPassphrase(passphrase);

      let result;

      try {
        result = db.prepare(`
          INSERT INTO customers (
            email,
            password_hash
          )
          VALUES (?, ?)
        `).run(normalizedEmail, passwordHash);
      } catch (error) {
        if (
          error.code === "SQLITE_CONSTRAINT_UNIQUE" ||
          error.code === "SQLITE_CONSTRAINT_PRIMARYKEY"
        ) {
          return res.status(409).json({
            error: "An account with this email already exists.",
          });
        }

        throw error;
      }

      const customer = {
        id: Number(result.lastInsertRowid),
        email: normalizedEmail,
      };

      req.session.regenerate((error) => {
        if (error) {
          console.error(
            "Customer session regeneration failed:",
            error.message
          );

          return res.status(500).json({
            error: "Account created, but login session could not be created. Please log in.",
          });
        }

        req.session.customerId = customer.id;
        req.session.customerEmail = customer.email;

        req.session.save((saveError) => {
          if (saveError) {
            console.error(
              "Customer session save failed:",
              saveError.message
            );

            return res.status(500).json({
              error: "Account created, but login session could not be saved. Please log in.",
            });
          }

          return res.status(201).json({
            ok: true,
            message: "Customer account created successfully.",
            customer,
          });
        });
      });
    } catch (error) {
      console.error(
        "Customer registration failed:",
        error.message
      );

      return res.status(500).json({
        error: "Unable to create your account at this time.",
      });
    }
  }
);

// --------------------------------------------------
// Customer login
// --------------------------------------------------

app.post(
  "/api/customer/login",
  customerLoginLimiter,
  async (req, res) => {
    try {
      const { email, passphrase } = req.body || {};

      if (
        typeof email !== "string" ||
        typeof passphrase !== "string" ||
        email.trim().length < 1 ||
        email.length > 254 ||
        passphrase.length < 1 ||
        passphrase.length > 200
      ) {
        return res.status(400).json({
          error: "Enter a valid email and passphrase.",
        });
      }

      const normalizedEmail = email.trim().toLowerCase();

      const customer = db.prepare(`
        SELECT id, email, password_hash
        FROM customers
        WHERE email = ?
      `).get(normalizedEmail);

      if (!customer) {
        return res.status(401).json({
          error: "Invalid email or passphrase.",
        });
      }

      const passphraseMatches =
        await verifyCustomerPassphrase(
          passphrase,
          customer.password_hash
        );

      if (!passphraseMatches) {
        return res.status(401).json({
          error: "Invalid email or passphrase.",
        });
      }

      req.session.regenerate((error) => {
        if (error) {
          console.error(
            "Customer login session regeneration failed:",
            error.message
          );

          return res.status(500).json({
            error: "Unable to create customer session.",
          });
        }

        req.session.customerId = customer.id;
        req.session.customerEmail = customer.email;

        req.session.save((saveError) => {
          if (saveError) {
            console.error(
              "Customer login session save failed:",
              saveError.message
            );

            return res.status(500).json({
              error: "Unable to save customer session.",
            });
          }

          return res.json({
            ok: true,
            message: "Customer login successful.",
            customer: {
              id: customer.id,
              email: customer.email,
            },
          });
        });
      });
    } catch (error) {
      console.error(
        "Customer login failed:",
        error.message
      );

      return res.status(500).json({
        error: "Unable to log in at this time.",
      });
    }
  }
);

// --------------------------------------------------
// Check customer session
// --------------------------------------------------

app.get("/api/customer/me", (req, res) => {
  if (!req.session || !req.session.customerId) {
    return res.json({
      authenticated: false,
      customer: null,
    });
  }

  return res.json({
    authenticated: true,
    customer: {
      id: req.session.customerId,
      email: req.session.customerEmail,
    },
  });
});

// --------------------------------------------------
// Customer logout
// --------------------------------------------------

app.post("/api/customer/logout", (req, res) => {
  if (!req.session) {
    res.clearCookie("protrader.customer.sid", {
      ...sessionCookieOptions,
    });

    return res.json({
      ok: true,
      message: "Customer logged out.",
    });
  }

  req.session.destroy((error) => {
    if (error) {
      console.error(
        "Customer logout failed:",
        error.message
      );

      return res.status(500).json({
        error: "Unable to log out.",
      });
    }

    res.clearCookie("protrader.customer.sid", {
      ...sessionCookieOptions,
    });

    return res.json({
      ok: true,
      message: "Customer logged out.",
    });
  });
});

// --------------------------------------------------
// Request optional Web3 wallet-link challenge
// --------------------------------------------------

app.post(
  "/api/customer/wallet/challenge",
  requireCustomer,
  walletChallengeLimiter,
  (req, res) => {
    try {
      const { address, chainId } = req.body || {};

      if (
        typeof address !== "string" ||
        !Number.isSafeInteger(chainId) ||
        chainId < 1
      ) {
        return res.status(400).json({
          error: "A valid wallet address and EVM chain ID are required.",
        });
      }

      let normalizedAddress;

      try {
        normalizedAddress = getAddress(address);
      } catch {
        return res.status(400).json({
          error: "Invalid EVM wallet address.",
        });
      }

      const challengeId = randomUUID();

      const nonce = randomBytes(24).toString("hex");

      const issuedAt = new Date().toISOString();

      const expiresAt =
        Date.now() + WALLET_CHALLENGE_DURATION;

      const expirationTime =
        new Date(expiresAt).toISOString();

      const message = [
        "ProTrader Wallet Connection",
        "",
        "Sign this message to link your wallet to your ProTrader account.",
        "This signature does not authorize a token transfer or payment.",
        "",
        `Customer ID: ${req.session.customerId}`,
        `Wallet Address: ${normalizedAddress}`,
        `Chain ID: ${chainId}`,
        `Nonce: ${nonce}`,
        `Issued At: ${issuedAt}`,
        `Expiration Time: ${expirationTime}`,
      ].join("\n");

      db.prepare(`
        INSERT INTO wallet_challenges (
          id,
          customer_id,
          chain_id,
          wallet_address,
          message,
          expires_at
        )
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        challengeId,
        req.session.customerId,
        chainId,
        normalizedAddress,
        message,
        expiresAt
      );

      db.prepare(`
        DELETE FROM wallet_challenges
        WHERE expires_at <= ?
           OR consumed_at IS NOT NULL
      `).run(Date.now());

      return res.json({
        ok: true,
        challengeId,
        message,
        expiresAt,
      });
    } catch (error) {
      console.error(
        "Wallet challenge creation failed:",
        error.message
      );

      return res.status(500).json({
        error: "Unable to create wallet verification challenge.",
      });
    }
  }
);

// --------------------------------------------------
// Verify and link optional Web3 wallet
// --------------------------------------------------

app.post(
  "/api/customer/wallet/verify",
  requireCustomer,
  walletChallengeLimiter,
  (req, res) => {
    try {
      const { challengeId, signature } = req.body || {};

      if (
        typeof challengeId !== "string" ||
        typeof signature !== "string" ||
        !isHexString(signature, 65)
      ) {
        return res.status(400).json({
          error: "A valid challenge ID and wallet signature are required.",
        });
      }

      const challenge = db.prepare(`
        SELECT
          id,
          customer_id,
          chain_id,
          wallet_address,
          message,
          expires_at,
          consumed_at
        FROM wallet_challenges
        WHERE id = ?
          AND customer_id = ?
      `).get(
        challengeId,
        req.session.customerId
      );

      if (!challenge) {
        return res.status(404).json({
          error: "Wallet challenge not found.",
        });
      }

      if (challenge.consumed_at !== null) {
        return res.status(409).json({
          error: "This wallet challenge has already been used.",
        });
      }

      if (challenge.expires_at <= Date.now()) {
        return res.status(410).json({
          error: "Wallet challenge expired. Request a new challenge.",
        });
      }

      let recoveredAddress;

      try {
        recoveredAddress = getAddress(
          verifyMessage(challenge.message, signature)
        );
      } catch {
        return res.status(400).json({
          error: "Wallet signature verification failed.",
        });
      }

      if (
        recoveredAddress !== challenge.wallet_address
      ) {
        return res.status(401).json({
          error: "The signature does not match the requested wallet.",
        });
      }

      const saveWallet = db.transaction(() => {
        const consumed = db.prepare(`
          UPDATE wallet_challenges
          SET consumed_at = ?
          WHERE id = ?
            AND customer_id = ?
            AND consumed_at IS NULL
            AND expires_at > ?
        `).run(
          Date.now(),
          challenge.id,
          req.session.customerId,
          Date.now()
        );

        if (consumed.changes !== 1) {
          throw new Error("CHALLENGE_ALREADY_USED");
        }

        db.prepare(`
          INSERT INTO customer_wallets (
            customer_id,
            chain_id,
            wallet_address
          )
          VALUES (?, ?, ?)
        `).run(
          req.session.customerId,
          challenge.chain_id,
          challenge.wallet_address
        );
      });

      try {
        saveWallet();
      } catch (error) {
        if (
          error.message === "CHALLENGE_ALREADY_USED"
        ) {
          return res.status(409).json({
            error: "This wallet challenge has already been used.",
          });
        }

        if (
          error.code === "SQLITE_CONSTRAINT_UNIQUE"
        ) {
          return res.status(409).json({
            error: "This wallet is already linked to a ProTrader account.",
          });
        }

        throw error;
      }

      return res.json({
        ok: true,
        message: "Wallet successfully linked to your ProTrader account.",
        wallet: {
          address: challenge.wallet_address,
          chainId: challenge.chain_id,
        },
      });
    } catch (error) {
      console.error(
        "Wallet verification failed:",
        error.message
      );

      return res.status(500).json({
        error: "Unable to verify and link wallet.",
      });
    }
  }
);

// --------------------------------------------------
// List authenticated customer's linked wallets
// --------------------------------------------------

app.get(
  "/api/customer/wallets",
  requireCustomer,
  (req, res) => {
    try {
      const wallets = db.prepare(`
        SELECT
          id,
          chain_id AS chainId,
          wallet_address AS address,
          created_at AS createdAt
        FROM customer_wallets
        WHERE customer_id = ?
        ORDER BY id DESC
      `).all(req.session.customerId);

      return res.json({
        ok: true,
        wallets,
      });
    } catch (error) {
      console.error(
        "Customer wallet lookup failed:",
        error.message
      );

      return res.status(500).json({
        error: "Unable to load linked wallets.",
      });
    }
  }
);

// --------------------------------------------------
// Administrator login
// --------------------------------------------------

app.post(
  "/api/admin/login",
  adminLoginLimiter,
  async (req, res) => {
    try {
      const { username, password } = req.body || {};

      if (
        typeof username !== "string" ||
        typeof password !== "string" ||
        username.trim().length < 1 ||
        username.length > 100 ||
        password.length < 1 ||
        password.length > 200
      ) {
        return res.status(400).json({
          error: "Enter a valid username and password.",
        });
      }

      const normalizedUsername =
        username.trim().toLowerCase();

      const admin = db.prepare(`
        SELECT id, username, password_hash
        FROM admins
        WHERE username = ?
      `).get(normalizedUsername);

      if (!admin) {
        return res.status(401).json({
          error: "Invalid username or password.",
        });
      }

      // Existing administrator password hashes remain compatible.
      const passwordMatches = await bcrypt.compare(
        password,
        admin.password_hash
      );

      if (!passwordMatches) {
        return res.status(401).json({
          error: "Invalid username or password.",
        });
      }

      req.session.regenerate((error) => {
        if (error) {
          console.error(
            "Admin session regeneration failed:",
            error.message
          );

          return res.status(500).json({
            error: "Unable to create administrator session.",
          });
        }

        req.session.adminId = admin.id;
        req.session.adminUsername = admin.username;

        req.session.save((saveError) => {
          if (saveError) {
            console.error(
              "Admin session save failed:",
              saveError.message
            );

            return res.status(500).json({
              error: "Unable to save administrator session.",
            });
          }

          return res.json({
            ok: true,
            message: "Administrator login successful.",
            admin: {
              id: admin.id,
              username: admin.username,
            },
          });
        });
      });
    } catch (error) {
      console.error(
        "Admin login failed:",
        error.message
      );

      return res.status(500).json({
        error: "Administrator login failed.",
      });
    }
  }
);

// --------------------------------------------------
// Check administrator session
// --------------------------------------------------

app.get("/api/admin/me", requireAdmin, (req, res) => {
  return res.json({
    authenticated: true,
    admin: {
      id: req.session.adminId,
      username: req.session.adminUsername,
    },
  });
});

// --------------------------------------------------
// Administrator logout
// --------------------------------------------------

app.post("/api/admin/logout", requireAdmin, (req, res) => {
  req.session.destroy((error) => {
    if (error) {
      console.error(
        "Admin logout failed:",
        error.message
      );

      return res.status(500).json({
        error: "Unable to log out.",
      });
    }

    res.clearCookie("protrader.admin.sid", {
      ...sessionCookieOptions,
    });

    return res.json({
      ok: true,
      message: "Administrator logged out.",
    });
  });
});

// --------------------------------------------------
// Protected administrator fee report
// --------------------------------------------------

app.get("/api/admin/fees", requireAdmin, (req, res) => {
  try {
    const summary = db.prepare(`
      SELECT
        COALESCE(SUM(amount_usdt), 0) AS totalUSDT,
        COUNT(*) AS transactionCount
      FROM platform_fee_ledger
    `).get();

    const fees = db.prepare(`
      SELECT
        id,
        symbol,
        side,
        fee_type AS type,
        amount_usdt AS amountUSDT,
        reference,
        created_at AS createdAt
      FROM platform_fee_ledger
      ORDER BY id DESC
      LIMIT 500
    `).all();

    return res.json({
      ok: true,
      totalUSDT: summary.totalUSDT,
      transactionCount: summary.transactionCount,
      fees,
    });
  } catch (error) {
    console.error(
      "Admin fee report failed:",
      error.message
    );

    return res.status(500).json({
      error: "Unable to load platform fee report.",
    });
  }
});

// --------------------------------------------------
// Sepolia deposit verification configuration
// --------------------------------------------------

const rpcUrl = process.env.RPC_URL;
const depositAddress = process.env.DEPOSIT_WALLET_ADDRESS;

if (!rpcUrl) {
  throw new Error("Missing RPC_URL in your .env file");
}

if (!depositAddress) {
  throw new Error(
    "Missing DEPOSIT_WALLET_ADDRESS in your .env file"
  );
}

let depositWallet;

try {
  depositWallet = getAddress(depositAddress);
} catch {
  throw new Error(
    "DEPOSIT_WALLET_ADDRESS is not a valid Ethereum address"
  );
}

const provider = new JsonRpcProvider(rpcUrl);

// --------------------------------------------------
// Sepolia native ETH deposit verification
// --------------------------------------------------

app.post(
  "/api/deposits/verify",
  requireCustomer,
  depositVerifyLimiter,
  async (req, res) => {
    try {
      const { transactionHash } = req.body || {};

      if (
        typeof transactionHash !== "string" ||
        !isHexString(transactionHash.trim(), 32)
      ) {
        return res.status(400).json({
          error: "Invalid transaction hash",
        });
      }

      const hash = transactionHash.trim();

      const network = await provider.getNetwork();

      if (Number(network.chainId) !== CHAIN_ID) {
        console.error("Deposit RPC network mismatch.");

        return res.status(503).json({
          error: "Deposit verification network is unavailable.",
        });
      }

      const tx = await provider.getTransaction(hash);

      if (!tx) {
        return res.status(404).json({
          error: "Transaction not found",
        });
      }

      if (Number(tx.chainId) !== CHAIN_ID) {
        return res.status(400).json({
          error: "Transaction is not on Sepolia.",
        });
      }

      const transactionDestination = tx.to
        ? getAddress(tx.to)
        : null;

      if (transactionDestination !== depositWallet) {
        return res.status(400).json({
          error: "Incorrect deposit destination",
        });
      }

      if (tx.value <= 0n || tx.data !== "0x") {
        return res.status(400).json({
          error: "Expected a native ETH transfer",
        });
      }

      const receipt =
        await provider.getTransactionReceipt(hash);

      if (!receipt) {
        return res.status(202).json({
          status: "confirming",
          confirmations: 0,
          required: MIN_CONFIRMATIONS,
        });
      }

      if (receipt.status !== 1) {
        return res.status(409).json({
          error: "Transaction was not successful.",
        });
      }

      if (
        receipt.hash.toLowerCase() !== hash.toLowerCase()
      ) {
        return res.status(409).json({
          error: "Transaction receipt does not match.",
        });
      }

      const latestBlock = await provider.getBlockNumber();

      const confirmations =
        latestBlock - receipt.blockNumber + 1;

      if (confirmations < MIN_CONFIRMATIONS) {
        return res.status(202).json({
          status: "confirming",
          confirmations,
          required: MIN_CONFIRMATIONS,
        });
      }

      const latestReceipt =
        await provider.getTransactionReceipt(hash);

      if (
        !latestReceipt ||
        latestReceipt.status !== 1 ||
        latestReceipt.blockHash !== receipt.blockHash
      ) {
        return res.status(409).json({
          error: "Transaction confirmation changed. Please retry.",
        });
      }

      // Only accept deposits sent from a wallet already linked
      // to the authenticated ProTrader customer on this chain.
      const senderAddress = getAddress(tx.from);

      const linkedWallet = db.prepare(`
        SELECT id
        FROM customer_wallets
        WHERE customer_id = ?
          AND chain_id = ?
          AND wallet_address = ?
      `).get(
        req.session.customerId,
        CHAIN_ID,
        senderAddress
      );

      if (!linkedWallet) {
        return res.status(403).json({
          error:
            "The sending wallet is not linked to your ProTrader account on Sepolia.",
        });
      }

      const normalizedHash = hash.toLowerCase();

      // A transaction hash can belong to only one customer.
      // Repeated verification by that same customer is idempotent.
      const existingDeposit = db.prepare(`
        SELECT
          customer_id AS customerId,
          transaction_hash AS transactionHash,
          chain_id AS chainId,
          from_address AS fromAddress,
          to_address AS toAddress,
          amount_wei AS amountWei,
          block_number AS blockNumber,
          block_hash AS blockHash,
          confirmations,
          status,
          created_at AS createdAt
        FROM customer_deposits
        WHERE transaction_hash = ?
      `).get(normalizedHash);

      if (existingDeposit) {
        if (existingDeposit.customerId !== req.session.customerId) {
          return res.status(409).json({
            error: "This transaction has already been claimed by another ProTrader account.",
          });
        }

        if (
          existingDeposit.blockHash !== receipt.blockHash ||
          existingDeposit.blockNumber !== receipt.blockNumber
        ) {
          return res.status(409).json({
            error: "The recorded transaction block has changed. Please contact support before retrying.",
          });
        }

        return res.json({
          status: "verified",
          transactionHash: existingDeposit.transactionHash,
          chainId: existingDeposit.chainId,
          from: existingDeposit.fromAddress,
          to: existingDeposit.toAddress,
          amountWei: existingDeposit.amountWei,
          amountEth: formatEther(BigInt(existingDeposit.amountWei)),
          confirmations,
          requiredConfirmations: MIN_CONFIRMATIONS,
          recordedAt: existingDeposit.createdAt,
          message:
            "Deposit verified and recorded for your ProTrader account. No account balance has been credited.",
        });
      }

      // Persist attribution only. This does not credit a customer balance.
      try {
        const saveDeposit = db.transaction(() => {
          db.prepare(`
            INSERT INTO customer_deposits (
              customer_id,
              chain_id,
              transaction_hash,
              from_address,
              to_address,
              amount_wei,
              block_number,
              block_hash,
              confirmations
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            req.session.customerId,
            CHAIN_ID,
            normalizedHash,
            senderAddress,
            depositWallet,
            tx.value.toString(),
            receipt.blockNumber,
            receipt.blockHash,
            confirmations
          );
        });

        saveDeposit();
      } catch (error) {
        // The UNIQUE constraint is the final protection against
        // simultaneous claims of the same transaction hash.
        if (
          error.code === "SQLITE_CONSTRAINT_UNIQUE" ||
          error.code === "SQLITE_CONSTRAINT_PRIMARYKEY"
        ) {
          const claimedDeposit = db.prepare(`
            SELECT customer_id AS customerId
            FROM customer_deposits
            WHERE transaction_hash = ?
          `).get(normalizedHash);

          if (
            claimedDeposit &&
            claimedDeposit.customerId !== req.session.customerId
          ) {
            return res.status(409).json({
              error: "This transaction has already been claimed by another ProTrader account.",
            });
          }

          if (claimedDeposit) {
            return res.status(409).json({
              error: "This deposit was recorded moments ago. Please verify it again.",
            });
          }
        }

        throw error;
      }

      return res.status(201).json({
        status: "verified",
        transactionHash: normalizedHash,
        chainId: CHAIN_ID,
        from: senderAddress,
        to: depositWallet,
        amountWei: tx.value.toString(),
        amountEth: formatEther(tx.value),
        confirmations,
        requiredConfirmations: MIN_CONFIRMATIONS,
        message:
          "Deposit verified and recorded for your ProTrader account. No account balance has been credited.",
      });
    } catch (error) {
      console.error(
        "Deposit verification failed:",
        error.message
      );

      return res.status(503).json({
        error: "Unable to verify deposit at this time. Please retry.",
      });
    }
  }
);

// --------------------------------------------------
// --------------------------------------------------
// Public frontend routes. Deliberately allowlist browser scripts so the
// project root, .env, database, backups, and server source are never exposed.
// --------------------------------------------------

const frontendRoot = process.cwd();
const publicRootScripts = new Set([
  "config.js", "util.js", "store.js", "ui.js", "market.js", "chart.js", "wallet.js", "app.js",
]);
const publicViewScripts = new Set([
  "trade.js", "launch.js", "airdrops.js", "earn.js", "bots.js", "wallet-view.js",
]);

app.get("/", (req, res, next) => {
  res.sendFile(path.join(frontendRoot, "index.html"), (error) => {
    if (error && !res.headersSent) next(error);
  });
});

app.get("/community", (req, res, next) => {
  res.sendFile(path.join(frontendRoot, "community.html"), (error) => {
    if (error && !res.headersSent) next(error);
  });
});

app.use("/assets", express.static(path.join(frontendRoot, "assets"), {
  dotfiles: "deny", index: false, fallthrough: true,
}));
app.use("/css", express.static(path.join(frontendRoot, "css"), {
  dotfiles: "deny", index: false, fallthrough: true,
}));

app.get("/js/views/:filename", (req, res, next) => {
  if (!publicViewScripts.has(req.params.filename)) {
    return res.status(404).json({ error: "File not found." });
  }
  res.sendFile(path.join(frontendRoot, "js", "views", req.params.filename), (error) => {
    if (error && !res.headersSent) next(error);
  });
});

app.get("/js/:filename", (req, res, next) => {
  if (!publicRootScripts.has(req.params.filename)) {
    return res.status(404).json({ error: "File not found." });
  }
  res.sendFile(path.join(frontendRoot, "js", req.params.filename), (error) => {
    if (error && !res.headersSent) next(error);
  });
});

// Not found and error handling
// --------------------------------------------------

app.use((req, res) => {
  return res.status(404).json({
    error: "API endpoint not found.",
  });
});

app.use((error, req, res, next) => {
  if (res.headersSent) {
    return next(error);
  }

  if (error.type === "entity.parse.failed") {
    return res.status(400).json({
      error: "Invalid JSON request body.",
    });
  }

  if (error.message === "Origin not allowed by CORS") {
    return res.status(403).json({
      error: "Request origin is not allowed.",
    });
  }

  console.error("API error:", error.message);

  return res.status(500).json({
    error: "Internal server error.",
  });
});

// --------------------------------------------------
// Start API
// --------------------------------------------------

const server = app.listen(PORT, () => {
  console.log(
    `ProTrader verification API running on port ${PORT}`
  );

  console.log("Network: Sepolia");
  console.log("Chain ID:", CHAIN_ID);
  console.log("Minimum confirmations:", MIN_CONFIRMATIONS);
  console.log("Administrator authentication is enabled.");
  console.log("Customer authentication is enabled.");
  console.log("Optional EVM wallet linking is enabled.");
  console.log("SQLite database:", dbPath);
});

// --------------------------------------------------
// Graceful shutdown
// --------------------------------------------------

function shutdown(signal) {
  console.log(
    `${signal} received. Shutting down ProTrader API...`
  );

  server.close(() => {
    try {
      provider.destroy();
      db.close();

      console.log("ProTrader API shut down successfully.");
      process.exit(0);
    } catch (error) {
      console.error("Shutdown error:", error.message);
      process.exit(1);
    }
  });

  setTimeout(() => {
    console.error("Shutdown timed out.");
    process.exit(1);
  }, 10000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
