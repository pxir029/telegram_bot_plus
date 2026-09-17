/**
 * PX Bot v1.1 — Cloudflare Worker
 * Features: users, block, search, templates (username/time), scheduled messages, broadcast, menus
 */
import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";

const app = new Hono();
const USERS_PER_PAGE = 15;
const TZ_OFFSET_MS = 3.5 * 60 * 60 * 1000; // Asia/Tehran approx (adjust if needed)

app.use("*", secureHeaders({
  contentSecurityPolicy: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", "'unsafe-inline'"],
    styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
    fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
    imgSrc: ["'self'", "data:", "https:"],
    connectSrc: ["'self'"],
    frameSrc: ["'none'"],
    objectSrc: ["'none'"],
  },
  xFrameOptions: "DENY",
  xContentTypeOptions: "nosniff",
  referrerPolicy: "strict-origin-when-cross-origin",
}));
app.use("/api/*", cors({ origin: (o) => o || "*", credentials: true }));

// ── Utils ─────────────────────────────────────────────────────────
const json = (c, data, status = 200) => c.json(data, status);

function randomToken(len = 32) {
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return [...arr].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hashPassword(password, salt) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(password), { name: "PBKDF2" }, false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: enc.encode(salt), iterations: 100000, hash: "SHA-256" },
    key, 256
  );
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function formatTime(ts = Date.now()) {
  const d = new Date(ts + TZ_OFFSET_MS);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

function formatDate(ts = Date.now()) {
  const d = new Date(ts + TZ_OFFSET_MS);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}/${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}`;
}

function formatDateTime(ts = Date.now()) {
  return `${formatDate(ts)} ${formatTime(ts)}`;
}

/** Replace template vars: (username) (first_name) (last_name) (id) (time) (date) (datetime) */
function applyTemplate(text, user = {}) {
  if (!text) return "";
  const now = Date.now();
  const map = {
    username: user.username || user.firstName || "کاربر",
    first_name: user.firstName || "",
    last_name: user.lastName || "",
    full_name: [user.firstName, user.lastName].filter(Boolean).join(" ") || user.username || "کاربر",
    id: String(user.id || ""),
    time: formatTime(now),
    date: formatDate(now),
    datetime: formatDateTime(now),
  };
  return String(text).replace(/\((username|first_name|last_name|full_name|id|time|date|datetime)\)/gi, (_, k) => map[k.toLowerCase()] ?? "");
}

async function getSession(c) {
  const token = getCookie(c, "px_session");
  if (!token) return null;
  const raw = await c.env.PX_KV.get(`session:${token}`);
  if (!raw) return null;
  const session = JSON.parse(raw);
  if (session.expires < Date.now()) {
    await c.env.PX_KV.delete(`session:${token}`);
    return null;
  }
  return session;
}

async function requireAuth(c) {
  return getSession(c);
}

async function tgApi(token, method, body) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function getBotToken(env) {
  return env.PX_KV.get("bot:token");
}

// ── Auth ──────────────────────────────────────────────────────────
app.post("/api/auth/login", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const password = String(body.password || "");
  const stored = await c.env.PX_KV.get("admin:password");
  const salt = (await c.env.PX_KV.get("admin:salt")) || "px-bot-default-salt";
  let valid = false;
  if (!stored) valid = password === "pxbot123";
  else valid = (await hashPassword(password, salt)) === stored;
  if (!valid) return json(c, { ok: false, error: "رمز عبور نادرست است" }, 401);

  const token = randomToken(32);
  const mustChange = !stored;
  const session = { id: token, created: Date.now(), expires: Date.now() + 12 * 3600 * 1000, mustChange };
  await c.env.PX_KV.put(`session:${token}`, JSON.stringify(session), { expirationTtl: 12 * 3600 });
  setCookie(c, "px_session", token, { httpOnly: true, secure: true, sameSite: "Strict", path: "/", maxAge: 12 * 3600 });
  return json(c, { ok: true, mustChange });
});

app.post("/api/auth/password", async (c) => {
  const session = await requireAuth(c);
  if (!session) return json(c, { ok: false, error: "Unauthorized" }, 401);
  const body = await c.req.json().catch(() => ({}));
  const newPass = String(body.password || "");
  if (newPass.length < 8) return json(c, { ok: false, error: "رمز باید حداقل ۸ کاراکتر باشد" }, 400);
  const salt = randomToken(16);
  const hash = await hashPassword(newPass, salt);
  await c.env.PX_KV.put("admin:password", hash);
  await c.env.PX_KV.put("admin:salt", salt);
  session.mustChange = false;
  await c.env.PX_KV.put(`session:${session.id}`, JSON.stringify(session), { expirationTtl: 12 * 3600 });
  return json(c, { ok: true });
});

app.post("/api/auth/logout", async (c) => {
  const token = getCookie(c, "px_session");
  if (token) {
    await c.env.PX_KV.delete(`session:${token}`);
    deleteCookie(c, "px_session", { path: "/" });
  }
  return json(c, { ok: true });
});

app.get("/api/auth/me", async (c) => {
  const session = await requireAuth(c);
  if (!session) return json(c, { ok: false }, 401);
  return json(c, { ok: true, mustChange: !!session.mustChange });
});

// ── Settings ──────────────────────────────────────────────────────
app.get("/api/settings", async (c) => {
  if (!(await requireAuth(c))) return json(c, { ok: false }, 401);
  const token = await c.env.PX_KV.get("bot:token");
  const username = await c.env.PX_KV.get("bot:username");
  const startText = (await c.env.PX_KV.get("bot:start_text")) || "سلام (username)!\nساعت الان: (time)\nتاریخ: (date)";
  return json(c, { ok: true, hasToken: !!token, username: username || null, startText });
});

app.post("/api/settings/bot", async (c) => {
  if (!(await requireAuth(c))) return json(c, { ok: false }, 401);
  const body = await c.req.json().catch(() => ({}));
  const token = String(body.token || "").trim();
  if (!token || !token.includes(":")) return json(c, { ok: false, error: "توکن نامعتبر است" }, 400);
  const me = await tgApi(token, "getMe", {});
  if (!me.ok) return json(c, { ok: false, error: "توکن توسط تلگرام رد شد" }, 400);
  await c.env.PX_KV.put("bot:token", token);
  await c.env.PX_KV.put("bot:username", me.result.username || "");
  const secret = randomToken(24);
  await c.env.PX_KV.put("bot:webhook_secret", secret);
  const url = new URL(c.req.url);
  const webhookUrl = `${url.protocol}//${url.host}/telegram/${secret}`;
  await tgApi(token, "setWebhook", {
    url: webhookUrl,
    secret_token: secret,
    allowed_updates: ["message", "callback_query"],
  });
  return json(c, { ok: true, username: me.result.username, webhookUrl });
});

app.post("/api/settings/start-text", async (c) => {
  if (!(await requireAuth(c))) return json(c, { ok: false }, 401);
  const body = await c.req.json().catch(() => ({}));
  const text = String(body.text || "").slice(0, 4000);
  await c.env.PX_KV.put("bot:start_text", text);
  return json(c, { ok: true });
});

// ── Users ─────────────────────────────────────────────────────────
async function listUsers(kv, { page = 1, q = "", blockedOnly = false } = {}) {
  const list = await kv.list({ prefix: "user:" });
  let users = [];
  for (const key of list.keys) {
    const raw = await kv.get(key.name);
    if (!raw) continue;
    try { users.push(JSON.parse(raw)); } catch {}
  }
  users.sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
  if (q) {
    const qq = q.toLowerCase();
    users = users.filter((u) =>
      String(u.id).includes(qq) ||
      (u.username || "").toLowerCase().includes(qq) ||
      (u.firstName || "").toLowerCase().includes(qq) ||
      (u.lastName || "").toLowerCase().includes(qq)
    );
  }
  if (blockedOnly) users = users.filter((u) => u.blocked);
  const total = users.length;
  const pages = Math.max(1, Math.ceil(total / USERS_PER_PAGE));
  const p = Math.min(Math.max(1, page), pages);
  return { users: users.slice((p - 1) * USERS_PER_PAGE, p * USERS_PER_PAGE), total, page: p, pages, perPage: USERS_PER_PAGE };
}

app.get("/api/users", async (c) => {
  if (!(await requireAuth(c))) return json(c, { ok: false }, 401);
  const page = parseInt(c.req.query("page") || "1", 10);
  const q = c.req.query("q") || "";
  const blockedOnly = c.req.query("blocked") === "1";
  return json(c, { ok: true, ...(await listUsers(c.env.PX_KV, { page, q, blockedOnly })) });
});

app.post("/api/users/:id/block", async (c) => {
  if (!(await requireAuth(c))) return json(c, { ok: false }, 401);
  const id = c.req.param("id");
  const raw = await c.env.PX_KV.get(`user:${id}`);
  if (!raw) return json(c, { ok: false, error: "کاربر یافت نشد" }, 404);
  const user = JSON.parse(raw);
  user.blocked = true;
  user.blockedAt = Date.now();
  await c.env.PX_KV.put(`user:${id}`, JSON.stringify(user));
  return json(c, { ok: true, user });
});

app.post("/api/users/:id/unblock", async (c) => {
  if (!(await requireAuth(c))) return json(c, { ok: false }, 401);
  const id = c.req.param("id");
  const raw = await c.env.PX_KV.get(`user:${id}`);
  if (!raw) return json(c, { ok: false, error: "کاربر یافت نشد" }, 404);
  const user = JSON.parse(raw);
  user.blocked = false;
  delete user.blockedAt;
  await c.env.PX_KV.put(`user:${id}`, JSON.stringify(user));
  return json(c, { ok: true, user });
});

app.get("/api/stats", async (c) => {
  if (!(await requireAuth(c))) return json(c, { ok: false }, 401);
  const list = await c.env.PX_KV.list({ prefix: "user:" });
  let total = 0, blocked = 0, active24h = 0;
  const now = Date.now();
  for (const key of list.keys) {
    const raw = await c.env.PX_KV.get(key.name);
    if (!raw) continue;
    try {
      const u = JSON.parse(raw);
      total++;
      if (u.blocked) blocked++;
      if (u.lastSeen && now - u.lastSeen < 86400000) active24h++;
    } catch {}
  }
  const schedules = await c.env.PX_KV.list({ prefix: "schedule:" });
  return json(c, { ok: true, total, blocked, active24h, schedules: schedules.keys.length });
});

// ── Broadcast (one-shot to all non-blocked) ───────────────────────
app.post("/api/broadcast", async (c) => {
  if (!(await requireAuth(c))) return json(c, { ok: false }, 401);
  const body = await c.req.json().catch(() => ({}));
  const text = String(body.text || "").trim();
  if (!text) return json(c, { ok: false, error: "متن خالی است" }, 400);
  const token = await getBotToken(c.env);
  if (!token) return json(c, { ok: false, error: "توکن ربات ثبت نشده" }, 400);

  const list = await c.env.PX_KV.list({ prefix: "user:" });
  let sent = 0, failed = 0;
  for (const key of list.keys) {
    const raw = await c.env.PX_KV.get(key.name);
    if (!raw) continue;
    let user;
    try { user = JSON.parse(raw); } catch { continue; }
    if (user.blocked) continue;
    const msg = applyTemplate(text, user);
    const r = await tgApi(token, "sendMessage", { chat_id: user.id, text: msg, parse_mode: "HTML" });
    if (r.ok) sent++; else failed++;
  }
  return json(c, { ok: true, sent, failed });
});

// ── Scheduled messages ────────────────────────────────────────────
// schedule: { id, text, type: 'once'|'daily'|'hourly', at: ISO or HH:MM, enabled, lastRun, created }
app.get("/api/schedules", async (c) => {
  if (!(await requireAuth(c))) return json(c, { ok: false }, 401);
  const list = await c.env.PX_KV.list({ prefix: "schedule:" });
  const items = [];
  for (const key of list.keys) {
    const raw = await c.env.PX_KV.get(key.name);
    if (!raw) continue;
    try { items.push(JSON.parse(raw)); } catch {}
  }
  items.sort((a, b) => (b.created || 0) - (a.created || 0));
  return json(c, { ok: true, items });
});

app.post("/api/schedules", async (c) => {
  if (!(await requireAuth(c))) return json(c, { ok: false }, 401);
  const body = await c.req.json().catch(() => ({}));
  const text = String(body.text || "").trim();
  const type = body.type === "daily" || body.type === "hourly" ? body.type : "once";
  const at = String(body.at || "").trim();
  if (!text) return json(c, { ok: false, error: "متن پیام الزامی است" }, 400);
  if (!at) return json(c, { ok: false, error: "زمان الزامی است" }, 400);

  if (type === "once") {
    const t = Date.parse(at);
    if (Number.isNaN(t) || t < Date.now() - 60000) {
      return json(c, { ok: false, error: "زمان یک‌باره باید معتبر و آینده باشد (ISO یا تاریخ-زمان)" }, 400);
    }
  } else if (type === "daily") {
    if (!/^\d{1,2}:\d{2}$/.test(at)) return json(c, { ok: false, error: "برای روزانه فرمت HH:MM وارد کنید" }, 400);
  }

  const id = randomToken(12);
  const item = {
    id,
    text,
    type,
    at,
    enabled: true,
    lastRun: null,
    created: Date.now(),
  };
  await c.env.PX_KV.put(`schedule:${id}`, JSON.stringify(item));
  return json(c, { ok: true, item });
});

app.post("/api/schedules/:id/toggle", async (c) => {
  if (!(await requireAuth(c))) return json(c, { ok: false }, 401);
  const id = c.req.param("id");
  const raw = await c.env.PX_KV.get(`schedule:${id}`);
  if (!raw) return json(c, { ok: false, error: "یافت نشد" }, 404);
  const item = JSON.parse(raw);
  item.enabled = !item.enabled;
  await c.env.PX_KV.put(`schedule:${id}`, JSON.stringify(item));
  return json(c, { ok: true, item });
});

app.delete("/api/schedules/:id", async (c) => {
  if (!(await requireAuth(c))) return json(c, { ok: false }, 401);
  const id = c.req.param("id");
  await c.env.PX_KV.delete(`schedule:${id}`);
  return json(c, { ok: true });
});

async function runSchedules(env) {
  const token = await env.PX_KV.get("bot:token");
  if (!token) return;

  const list = await env.PX_KV.list({ prefix: "schedule:" });
  const now = Date.now();
  const local = new Date(now + TZ_OFFSET_MS);
  const hh = String(local.getUTCHours()).padStart(2, "0");
  const mm = String(local.getUTCMinutes()).padStart(2, "0");
  const hm = `${hh}:${mm}`;

  for (const key of list.keys) {
    const raw = await env.PX_KV.get(key.name);
    if (!raw) continue;
    let item;
    try { item = JSON.parse(raw); } catch { continue; }
    if (!item.enabled) continue;

    let shouldRun = false;
    if (item.type === "once") {
      const t = Date.parse(item.at);
      if (!Number.isNaN(t) && now >= t && (!item.lastRun || item.lastRun < t)) {
        shouldRun = true;
      }
    } else if (item.type === "daily") {
      if (item.at === hm) {
        const last = item.lastRun || 0;
        if (now - last > 50 * 1000) shouldRun = true; // avoid double in same minute
      }
    } else if (item.type === "hourly") {
      // at = minute "MM" or full — if empty run every hour at :00
      const targetMin = item.at.includes(":") ? item.at.split(":")[1] : (item.at || "00");
      if (mm === String(targetMin).padStart(2, "0")) {
        const last = item.lastRun || 0;
        if (now - last > 50 * 1000) shouldRun = true;
      }
    }

    if (!shouldRun) continue;

    const usersList = await env.PX_KV.list({ prefix: "user:" });
    for (const uk of usersList.keys) {
      const uraw = await env.PX_KV.get(uk.name);
      if (!uraw) continue;
      let user;
      try { user = JSON.parse(uraw); } catch { continue; }
      if (user.blocked) continue;
      const msg = applyTemplate(item.text, user);
      await tgApi(token, "sendMessage", { chat_id: user.id, text: msg, parse_mode: "HTML" });
    }

    item.lastRun = now;
    if (item.type === "once") item.enabled = false;
    await env.PX_KV.put(`schedule:${item.id}`, JSON.stringify(item));
  }
}

// ── Telegram webhook ──────────────────────────────────────────────
app.post("/telegram/:secret", async (c) => {
  const secret = c.req.param("secret");
  const stored = await c.env.PX_KV.get("bot:webhook_secret");
  if (!stored || secret !== stored) return c.text("Forbidden", 403);
  const headerSecret = c.req.header("X-Telegram-Bot-Api-Secret-Token");
  if (headerSecret && headerSecret !== stored) return c.text("Forbidden", 403);

  const update = await c.req.json().catch(() => null);
  if (!update) return c.text("Bad Request", 400);
  const token = await getBotToken(c.env);
  if (!token) return c.text("No bot token", 500);

  const from = update.message?.from || update.callback_query?.from;
  if (from && !from.is_bot) {
    const key = `user:${from.id}`;
    const prev = await c.env.PX_KV.get(key);
    const user = prev ? JSON.parse(prev) : {
      id: from.id,
      firstName: from.first_name || "",
      lastName: from.last_name || "",
      username: from.username || "",
      language: from.language_code || "",
      joined: Date.now(),
      blocked: false,
    };
    user.firstName = from.first_name || user.firstName;
    user.lastName = from.last_name || user.lastName;
    user.username = from.username || user.username;
    user.lastSeen = Date.now();
    await c.env.PX_KV.put(key, JSON.stringify(user));
    if (user.blocked) return c.text("OK");
  }

  if (update.message?.text === "/start") {
    const user = from ? {
      id: from.id,
      firstName: from.first_name || "",
      lastName: from.last_name || "",
      username: from.username || "",
    } : {};
    const startRaw = (await c.env.PX_KV.get("bot:start_text")) ||
      "سلام (username)!\nساعت الان: (time)\nتاریخ: (date)";
    const text = applyTemplate(startRaw, user);
    await tgApi(token, "sendMessage", {
      chat_id: update.message.chat.id,
      text,
      reply_markup: {
        inline_keyboard: [
          [
            { text: "منوی اصلی", callback_data: "menu_main" },
            { text: "ساعت", callback_data: "show_time" },
          ],
          [
            { text: "پشتیبانی", callback_data: "support" },
            { text: "درباره", callback_data: "about" },
          ],
        ],
      },
    });
  }

  if (update.callback_query) {
    const data = update.callback_query.data;
    const cq = update.callback_query;
    const user = {
      id: cq.from.id,
      firstName: cq.from.first_name || "",
      lastName: cq.from.last_name || "",
      username: cq.from.username || "",
    };
    await tgApi(token, "answerCallbackQuery", { callback_query_id: cq.id });

    if (data === "show_time") {
      await tgApi(token, "sendMessage", {
        chat_id: cq.message.chat.id,
        text: applyTemplate("زمان فعلی: (datetime)\nکاربر: (username)", user),
      });
    } else if (data === "menu_main") {
      await tgApi(token, "editMessageText", {
        chat_id: cq.message.chat.id,
        message_id: cq.message.message_id,
        text: applyTemplate("منوی اصلی — (username)\n(time)", user),
        reply_markup: {
          inline_keyboard: [[{ text: "بازگشت", callback_data: "back" }]],
        },
      });
    } else if (data === "support") {
      await tgApi(token, "sendMessage", {
        chat_id: cq.message.chat.id,
        text: "برای پشتیبانی با ادمین در ارتباط باشید.",
      });
    } else if (data === "about") {
      await tgApi(token, "sendMessage", {
        chat_id: cq.message.chat.id,
        text: "PX Bot — پنل مدیریت حرفه‌ای ربات تلگرام",
      });
    } else if (data === "back") {
      const startRaw = (await c.env.PX_KV.get("bot:start_text")) || "سلام (username)!";
      await tgApi(token, "editMessageText", {
        chat_id: cq.message.chat.id,
        message_id: cq.message.message_id,
        text: applyTemplate(startRaw, user),
        reply_markup: {
          inline_keyboard: [
            [{ text: "منوی اصلی", callback_data: "menu_main" }, { text: "ساعت", callback_data: "show_time" }],
            [{ text: "پشتیبانی", callback_data: "support" }, { text: "درباره", callback_data: "about" }],
          ],
        },
      });
    }
  }

  return c.text("OK");
});

app.get("*", async (c) => c.env.ASSETS.fetch(c.req.raw));

export default {
  async fetch(request, env, ctx) {
    return app.fetch(request, env, ctx);
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runSchedules(env));
  },
};
