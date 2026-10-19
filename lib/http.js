// Small HTTP helpers: bodies with size limits, JSON replies, cookies, security headers, rate limits.
'use strict';
const fs = require('fs'), crypto = require('crypto');

const TRUST_PROXY = process.env.TRUST_PROXY === '1'; // set when running behind a hosting provider's proxy

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/** Read a JSON body, refusing anything bigger than `limit` bytes or not sent as JSON. */
function readJson(req, limit) {
  return new Promise((resolve, reject) => {
    const type = String(req.headers['content-type'] || '');
    if (!type.startsWith('application/json')) return reject(new HttpError(415, 'Send JSON.'));
    const declared = +req.headers['content-length'];
    if (declared > limit) return reject(new HttpError(413, 'That’s too big.'));
    const chunks = []; let size = 0;
    req.on('data', ch => {
      size += ch.length;
      if (size > limit) { reject(new HttpError(413, 'That’s too big.')); req.destroy(); return; }
      chunks.push(ch);
    });
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        const v = text ? JSON.parse(text) : {};
        if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error();
        resolve(v);
      } catch (e) { reject(new HttpError(400, 'That request wasn’t valid JSON.')); }
    });
    req.on('error', () => reject(new HttpError(400, 'Bad request.')));
  });
}

function json(res, status, obj, headers) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...BASE_HEADERS, ...headers });
  res.end(JSON.stringify(obj));
}

/* ---------- Security headers ---------- */
// Pages never leak their URL as a referrer, can't be framed, and may only run scripts we served
// (each inline <script> carries a fresh nonce). Inline styles are allowed; they can't run code.
const BASE_HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' };
function pageHeaders(nonce) {
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com",
    "img-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "object-src 'none'"
  ].join('; ');
  return { ...BASE_HEADERS, 'Content-Security-Policy': csp, 'Cache-Control': 'no-store', 'Content-Type': 'text/html; charset=utf-8' };
}

const fileCache = new Map();
function readCached(path) {
  // Re-read in development so edits show up; cache once running in production
  if (process.env.NODE_ENV === 'production' && fileCache.has(path)) return fileCache.get(path);
  const text = fs.readFileSync(path, 'utf8');
  fileCache.set(path, text);
  return text;
}

/** Serve an HTML page with a CSP nonce added to every <script> tag. `inject` can fill placeholders. */
function page(res, path, inject, status = 200) {
  const nonce = crypto.randomBytes(16).toString('base64');
  let html = readCached(path).replace(/<script(?=[\s>])/g, `<script nonce="${nonce}"`);
  if (inject) html = inject(html);
  res.writeHead(status, pageHeaders(nonce));
  res.end(html);
}
function script(res, path) {
  res.writeHead(200, { ...BASE_HEADERS, 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=300' });
  res.end(readCached(path));
}
function text(res, status, message) {
  res.writeHead(status, { ...BASE_HEADERS, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(message);
}

/** JSON for a <script> tag: no "</script>", no characters that end a JS line. */
// Characters that could end a <script> tag or a line of JavaScript, written as \uXXXX escapes
const toEscape = new RegExp('[<' + String.fromCharCode(0x2028) + String.fromCharCode(0x2029) + ']', 'g');
const scriptJson = v => JSON.stringify(v).replace(toEscape, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));

/* ---------- Cookies ---------- */
function cookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
const isHttps = req => !!req.socket.encrypted || (TRUST_PROXY && String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https');
function setCookie(req, name, value, { path = '/', maxAge } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`, 'HttpOnly', 'SameSite=Strict'];
  if (maxAge != null) parts.push(`Max-Age=${Math.max(0, Math.floor(maxAge))}`);
  if (isHttps(req)) parts.push('Secure');
  return parts.join('; ');
}

/** Constant-time comparison for secrets. */
function sameSecret(a, b) {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}

/* ---------- Client address and request origin ---------- */
// Behind one trusted proxy, the LAST X-Forwarded-For entry is the one that proxy added; earlier
// entries come from the client and can be faked to dodge rate limits.
function clientIp(req) {
  if (TRUST_PROXY) {
    const hops = String(req.headers['x-forwarded-for'] || '').split(',').map(s => s.trim()).filter(Boolean);
    if (hops.length) return hops[hops.length - 1];
  }
  return req.socket.remoteAddress || 'unknown';
}
/** Browsers send Origin on cross-site POSTs; refuse any that isn't us (defence against forged requests). */
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // same-origin fetches from older browsers, curl, tests
  try { return new URL(origin).host === req.headers.host; } catch (e) { return false; }
}

/* ---------- Rate limits: fixed windows per key ---------- */
class RateLimiter {
  constructor() { this.hits = new Map(); setInterval(() => this.sweep(), 60 * 1000).unref(); }
  /** Returns true if allowed. */
  allow(key, limit, windowMs) {
    const now = Date.now();
    let h = this.hits.get(key);
    if (!h || h.reset <= now) { h = { n: 0, reset: now + windowMs }; this.hits.set(key, h); }
    h.n++;
    return h.n <= limit;
  }
  sweep() { const now = Date.now(); for (const [k, h] of this.hits) if (h.reset <= now) this.hits.delete(k); }
}

module.exports = { HttpError, readJson, json, page, script, text, scriptJson, cookies, setCookie, sameSecret, clientIp, sameOrigin, isHttps, RateLimiter, BASE_HEADERS };
