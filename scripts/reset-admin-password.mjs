import "dotenv/config";
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import path from "node:path";

const dbPath = path.resolve(
  process.env.ADMIN_DB_PATH || "./data/protrader.sqlite"
);

const db = new Database(dbPath);

const username = "admin";

const existing = db.prepare(
  "SELECT id FROM admins WHERE username = ?"
).get(username);

if (!existing) {
  console.error("Admin account not found.");
  db.close();
  process.exit(1);
}

const password = randomBytes(32).toString("base64url");
const passwordHash = await bcrypt.hash(password, 12);

db.prepare(
  "UPDATE admins SET password_hash = ? WHERE username = ?"
).run(passwordHash, username);

db.close();

console.log("\nAdmin password reset successfully.");
console.log("Username:", username);
console.log("New temporary password:", password);
console.log("\nSave this password securely. It will not be displayed again.");