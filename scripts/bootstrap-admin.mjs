import "dotenv/config";
import path from "node:path";
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";

function readHidden(promptText) {
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    if (!input.isTTY || typeof input.setRawMode !== "function") {
      reject(new Error("Run this script in an interactive terminal so the password can be entered without echo."));
      return;
    }

    process.stdout.write(promptText);
    let value = "";
    const finish = (error) => {
      input.off("data", onData);
      input.setRawMode(false);
      input.pause();
      process.stdout.write("\n");
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (buffer) => {
      for (const byte of buffer) {
        if (byte === 3) return finish(new Error("Cancelled."));
        if (byte === 13 || byte === 10) return finish();
        if (byte === 8 || byte === 127) {
          value = value.slice(0, -1);
          continue;
        }
        if (byte >= 32 && byte <= 126 && value.length < 200) {
          value += String.fromCharCode(byte);
        }
      }
    };
    input.setRawMode(true);
    input.resume();
    input.on("data", onData);
  });
}

const username = (process.env.PROTRADER_ADMIN_USERNAME || "").trim().toLowerCase();
const selectedUsername = username || (await new Promise((resolve) => {
  process.stdout.write("New administrator username (3–40 characters): ");
  process.stdin.once("data", (data) => resolve(String(data).trim().toLowerCase()));
}));

if (!/^[a-z0-9._-]{3,40}$/.test(selectedUsername)) {
  throw new Error("Username must be 3–40 characters and use letters, numbers, dots, underscores or hyphens.");
}

const password = await readHidden("New administrator password (16–200 characters; input hidden): ");
const confirm = await readHidden("Enter the administrator password again (input hidden): ");
if (password.length < 16 || password.length > 200) {
  throw new Error("Administrator password must contain 16–200 characters.");
}
if (password !== confirm) {
  throw new Error("The two password entries do not match. No administrator was created.");
}

const dbPath = path.resolve(process.env.ADMIN_DB_PATH || "./data/protrader.sqlite");
const db = new Database(dbPath);
db.pragma("busy_timeout = 5000");
db.exec(`
  CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

try {
  const exists = db.prepare("SELECT id FROM admins WHERE username = ?").get(selectedUsername);
  if (exists) {
    throw new Error("That administrator username already exists. No changes were made.");
  }

  const passwordHash = await bcrypt.hash(password, 12);
  db.prepare("INSERT INTO admins (username, password_hash) VALUES (?, ?)")
    .run(selectedUsername, passwordHash);

  console.log("Administrator account created successfully.");
  console.log("Username:", selectedUsername);
  console.log("Database:", dbPath);
  console.log("Password and hash were not displayed.");
} finally {
  db.close();
}
