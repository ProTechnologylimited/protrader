import "dotenv/config";
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";

const dbPath = path.resolve(
  process.env.ADMIN_DB_PATH || "./data/protrader.sqlite"
);

mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

const username = "admin";

const existing = db.prepare(
  "SELECT id FROM admins WHERE username = ?"
).get(username);

if (existing) {
  console.error("An admin account already exists. No changes made.");
  db.close();
  process.exit(1);
}

const password = randomBytes(32).toString("base64url");
const passwordHash = await bcrypt.hash(password, 12);

db.prepare(`
  INSERT INTO admins (username, password_hash)
  VALUES (?, ?)
`).run(username, passwordHash);

db.close();

console.log("\nProTrader administrator created successfully.");
console.log("Username:", username);
console.log("Temporary password:", password);
console.log("\nSave this password in a password manager.");
console.log("It will not be displayed again.");