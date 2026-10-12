#!/usr/bin/env node
"use strict";

// YTM Discord Presence - local script.
//
// Receives "what's playing" from the browser extension on 127.0.0.1 and sets it
// as your Discord "Listening to" status through Discord's local IPC (the same
// mechanism Spotify-style Rich Presence uses). No dependencies, no accounts,
// nothing is sent anywhere except to your own Discord app.

const net = require("net");
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const HOST = "127.0.0.1";
const PORT = 3535;
const MIN_SEND_INTERVAL_MS = 2000; // Discord rate-limits activity updates
const STALE_MS = 30000; // clear status if the browser stops reporting

const log = (...a) => console.log(new Date().toLocaleTimeString(), ...a);

// ---------- config ----------

function loadClientId() {
  const fromArg = process.argv[2];
  if (fromArg) return fromArg.trim();
  if (process.env.DISCORD_CLIENT_ID) return process.env.DISCORD_CLIENT_ID.trim();
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8"));
    if (cfg.clientId) return String(cfg.clientId).trim();
  } catch (_) {}
  return null;
}

const CLIENT_ID = loadClientId();
if (!CLIENT_ID || !/^\d{15,25}$/.test(CLIENT_ID)) {
  console.error(
    "Missing or invalid Discord Application ID.\n" +
      "Create config.json next to server.js containing {\"clientId\": \"YOUR_APPLICATION_ID\"}\n" +
      "or run: node server.js YOUR_APPLICATION_ID\n" +
      "(See README.md, step 1.)"
  );
  process.exit(1);
}

// ---------- minimal Discord IPC client ----------

function encode(op, data) {
  const json = Buffer.from(JSON.stringify(data));
  const head = Buffer.alloc(8);
  head.writeInt32LE(op, 0);
  head.writeInt32LE(json.length, 4);
  return Buffer.concat([head, json]);
}

function socketPaths() {
  const paths = [];
  for (let i = 0; i < 10; i++) {
    if (process.platform === "win32") {
      paths.push(`\\\\?\\pipe\\discord-ipc-${i}`);
    } else {
      const bases = [process.env.XDG_RUNTIME_DIR, process.env.TMPDIR, process.env.TMP, process.env.TEMP, "/tmp"].filter(Boolean);
      for (const base of bases) {
        for (const sub of ["", "app/com.discordapp.Discord", "snap.discord"]) {
          paths.push(path.join(base, sub, `discord-ipc-${i}`));
        }
      }
    }
  }
  return paths;
}

function openSocket(p) {
  return new Promise((resolve, reject) => {
    const s = net.createConnection(p);
    s.once("connect", () => {
      s.removeListener("error", reject);
      resolve(s);
    });
    s.once("error", reject);
  });
}

class Discord {
  constructor(clientId, onClose) {
    this.clientId = clientId;
    this.onClose = onClose;
    this.sock = null;
    this.ready = false;
    this.buf = Buffer.alloc(0);
    this.pending = null;
    this.onFrame = () => {};
  }

  ensure() {
    if (this.ready) return Promise.resolve();
    if (!this.pending) this.pending = this._connect().finally(() => (this.pending = null));
    return this.pending;
  }

  async _connect() {
    let sock = null;
    for (const p of socketPaths()) {
      try {
        sock = await openSocket(p);
        break;
      } catch (_) {}
    }
    if (!sock) throw new Error("Discord desktop app not found (is it open?)");

    this.sock = sock;
    this.buf = Buffer.alloc(0);

    sock.on("data", (chunk) => {
      this.buf = Buffer.concat([this.buf, chunk]);
      while (this.buf.length >= 8) {
        const op = this.buf.readInt32LE(0);
        const len = this.buf.readInt32LE(4);
        if (this.buf.length < 8 + len) break;
        let msg = {};
        try {
          msg = JSON.parse(this.buf.slice(8, 8 + len).toString());
        } catch (_) {}
        this.buf = this.buf.slice(8 + len);
        this.onFrame(op, msg);
      }
    });

    sock.on("close", () => {
      const wasReady = this.ready;
      this.ready = false;
      this.sock = null;
      if (wasReady) this.onClose();
    });
    sock.on("error", () => {});

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Discord handshake timed out")), 5000);
      this.onFrame = (op, msg) => {
        if (op === 1 && msg.evt === "READY") {
          clearTimeout(timer);
          resolve();
        } else if (op === 2 || msg.evt === "ERROR") {
          clearTimeout(timer);
          reject(new Error(msg.message || "Discord refused the connection"));
        }
      };
      sock.write(encode(0, { v: 1, client_id: this.clientId }));
    }).catch((e) => {
      sock.destroy();
      throw e;
    });

    this.ready = true;
    this.onFrame = (op, msg) => {
      if (msg.evt === "ERROR") log("Discord rejected the activity:", msg.data && msg.data.message);
    };
  }

  async setActivity(activity) {
    await this.ensure();
    this.sock.write(
      encode(1, {
        cmd: "SET_ACTIVITY",
        args: { pid: process.pid, activity: activity || null },
        nonce: crypto.randomUUID(),
      })
    );
  }
}

// ---------- activity state ----------

let desired = null; // activity we want shown (null = nothing)
let applied; // JSON of what Discord currently has (undefined = unknown)
let lastSend = 0;
let flushTimer = null;
let lastSeen = 0;

const discord = new Discord(CLIENT_ID, () => {
  log("Discord connection closed; will reconnect on next update.");
  applied = undefined;
  if (desired) schedule(0);
});

function schedule(delay) {
  if (flushTimer) return;
  const wait = delay !== undefined ? delay : Math.max(0, lastSend + MIN_SEND_INTERVAL_MS - Date.now());
  flushTimer = setTimeout(flush, wait);
}

async function flush() {
  flushTimer = null;
  const key = JSON.stringify(desired);
  if (key === applied) return;
  try {
    await discord.setActivity(desired);
    applied = key;
    lastSend = Date.now();
    log(desired ? `Now showing: ${desired.details} - ${desired.state}` : "Status cleared.");
  } catch (e) {
    log(`${e.message}. Retrying in 5s...`);
    schedule(5000);
  }
}

function setDesired(activity) {
  desired = activity;
  schedule();
}

setInterval(() => {
  if (desired && Date.now() - lastSeen > STALE_MS) {
    log("Browser stopped reporting; clearing status.");
    setDesired(null);
  }
}, 5000);

// ---------- input validation ----------

const clean = (v, max) =>
  typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) : "";
const pad2 = (s) => (s.length >= 2 ? s : (s + "  ").slice(0, 2)); // Discord needs >= 2 chars

function buildActivity(s) {
  if (!s || typeof s !== "object" || s.paused) return null;
  const title = clean(s.title, 128);
  if (!title) return null;
  const artist = clean(s.artist, 128) || "Unknown artist";
  const pos = Number(s.position);
  const dur = Number(s.duration);
  if (!Number.isFinite(pos) || !Number.isFinite(dur) || dur <= 0 || pos < 0 || pos > dur + 1) return null;

  const start = Math.round(Date.now() - pos * 1000);
  const end = Math.round(start + dur * 1000);

  const activity = {
    type: 2, // "Listening to"
    details: pad2(title),
    state: pad2(artist),
    timestamps: { start, end },
    instance: false,
  };

  if (typeof s.artwork === "string" && s.artwork.startsWith("https://") && s.artwork.length <= 256) {
    activity.assets = { large_image: s.artwork };
    const album = clean(s.album, 128);
    if (album.length >= 2) activity.assets.large_text = album;
  }

  if (typeof s.url === "string" && /^https:\/\/music\.youtube\.com\/watch\?v=[\w-]{6,20}$/.test(s.url)) {
    activity.buttons = [{ label: "Listen on YouTube Music", url: s.url }];
  }

  return activity;
}

// ---------- local HTTP receiver ----------

function end(res, code) {
  res.writeHead(code, { "Content-Type": "text/plain" });
  res.end();
}

const server = http.createServer((req, res) => {
  // No CORS headers are ever sent, so web pages can't read from or probe this.
  const origin = req.headers.origin;
  const host = (req.headers.host || "").toLowerCase();

  if (host !== `127.0.0.1:${PORT}` && host !== `localhost:${PORT}`) return end(res, 403); // DNS-rebinding guard
  if (req.method !== "POST" || req.url !== "/presence") return end(res, 404);
  if (origin && !/^(chrome|moz)-extension:\/\//.test(origin)) return end(res, 403); // only the extension
  if (!/^application\/json/i.test(req.headers["content-type"] || "")) return end(res, 415);

  const chunks = [];
  let size = 0;
  req.on("data", (c) => {
    size += c.length;
    if (size > 8192) {
      end(res, 413);
      req.destroy();
      return;
    }
    chunks.push(c);
  });
  req.on("end", () => {
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString());
    } catch (_) {
      return end(res, 400);
    }
    lastSeen = Date.now();
    if (body && body.heartbeat === true) return end(res, 204);
    setDesired(buildActivity(body));
    end(res, 204);
  });
});

server.on("error", (e) => {
  if (e.code === "EADDRINUSE") console.error(`Port ${PORT} is already in use. Is the script already running?`);
  else console.error(e.message);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  log(`YTM Discord Presence running on http://${HOST}:${PORT}`);
  log("Open music.youtube.com and play a song. Press Ctrl+C to stop.");
});

// ---------- clean shutdown ----------

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  try {
    await Promise.race([discord.ready ? discord.setActivity(null) : Promise.resolve(), new Promise((r) => setTimeout(r, 1000))]);
  } catch (_) {}
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
