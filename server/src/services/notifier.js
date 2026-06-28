/**
 * Alert Notifier — channel-agnostic operational alerting.
 *
 * Goal: when something the operator MUST know about happens (circuit breaker,
 * stop-loss placement failure, WebSocket disconnect, token expiry, crash, fills),
 * dispatch a structured alert. Defaults to console + a local alerts.jsonl file.
 *
 * Remote channels are DORMANT unless their env vars are set, so enabling Telegram
 * or a Slack/Discord webhook later is a pure configuration change — no code edits:
 *   ALERT_WEBHOOK_URL=...                      -> generic incoming webhook (Slack/Discord/custom)
 *   TELEGRAM_BOT_TOKEN=... TELEGRAM_CHAT_ID=...-> Telegram push
 * Other knobs:
 *   ALERT_MIN_INTERVAL_MS  (default 60000) throttle window per alert type (CRITICAL bypasses)
 *   ALERT_MIN_LEVEL        (INFO|WARN|CRITICAL, default INFO)
 *   ALERT_FILE_LOGGING=off to disable the alerts.jsonl file
 *   ALERT_LOG_FILE=...      override the alerts.jsonl path
 *
 * Contract: notify() NEVER throws — alerting must never crash the trader.
 */

import fs from "fs";
import path from "path";

const LEVELS = { INFO: 10, WARN: 20, CRITICAL: 30 };

const lastSentAt = new Map();

/**
 * Throttle decision for a given key. Pure (caller supplies `now`) so it is trivially testable.
 * Returns true if an alert with this key should be sent at `now`, and records the send time.
 */
export function shouldSend(key, now, minIntervalMs) {
  const interval = minIntervalMs ?? (Number(process.env.ALERT_MIN_INTERVAL_MS) || 60000);
  const last = lastSentAt.get(key);
  if (last !== undefined && now - last < interval) return false;
  lastSentAt.set(key, now);
  return true;
}

/** Test helper: clear throttle state. */
export function _resetThrottle() {
  lastSentAt.clear();
}

/** Normalize a raw event into a structured alert entry. */
export function formatAlert(event) {
  const level = LEVELS[event.level] ? event.level : "INFO";
  return {
    timestamp: new Date().toISOString(),
    level,
    type: event.type || "ALERT",
    message: event.message || "",
    data: event.data ?? null,
  };
}

function toConsole(entry) {
  const line = `[ALERT:${entry.level}] ${entry.type} — ${entry.message}`;
  if (entry.level === "CRITICAL") console.error(line, entry.data ?? "");
  else if (entry.level === "WARN") console.warn(line, entry.data ?? "");
  else console.log(line, entry.data ?? "");
}

async function toWebhook(entry) {
  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) return;
  // Slack/Discord both accept a { text } body; extra fields are harmless for custom sinks.
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: `[${entry.level}] ${entry.type}: ${entry.message}`, ...entry }),
    signal: AbortSignal.timeout(5000),
  });
}

async function toTelegram(entry) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  const text = `⚠️ [${entry.level}] ${entry.type}\n${entry.message}`;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
    signal: AbortSignal.timeout(5000),
  });
}

/**
 * Fire an alert. Never throws. Throttled per (type) by default so repeated
 * failures don't spam; CRITICAL always sends.
 *
 * @param {{level?: string, type?: string, message?: string, data?: any,
 *          throttleKey?: string, throttle?: boolean}} event
 */
export async function notify(event = {}) {
  try {
    const entry = formatAlert(event);

    const minLevel = LEVELS[process.env.ALERT_MIN_LEVEL] || LEVELS.INFO;
    if (LEVELS[entry.level] < minLevel) return entry;

    const bypass = entry.level === "CRITICAL" || event.throttle === false;
    const throttleKey = event.throttleKey || entry.type;
    if (!bypass && !shouldSend(throttleKey, Date.now())) return entry;

    toConsole(entry);

    if (process.env.ALERT_FILE_LOGGING !== "off") {
      const file = process.env.ALERT_LOG_FILE || path.join(process.cwd(), "alerts.jsonl");
      try {
        fs.appendFileSync(file, JSON.stringify(entry) + "\n");
      } catch (err) {
        console.error("[NOTIFIER] file log failed:", err.message);
      }
    }

    // Best-effort remote delivery; dormant unless configured. Never let a slow/failed
    // channel reject the caller.
    await Promise.allSettled([toWebhook(entry), toTelegram(entry)]);
    return entry;
  } catch (err) {
    try {
      console.error("[NOTIFIER] notify failed:", err?.message);
    } catch {
      /* ignore */
    }
    return null;
  }
}

export const alertInfo = (type, message, data) => notify({ level: "INFO", type, message, data });
export const alertWarn = (type, message, data) => notify({ level: "WARN", type, message, data });
export const alertCritical = (type, message, data) => notify({ level: "CRITICAL", type, message, data });
