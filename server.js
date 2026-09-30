// خادم محلي لموقع أرشيف قسم الدعم والإسناد — بدون أي مكتبات خارجية (Node.js فقط)
// التشغيل: node server.js  ثم افتح http://localhost:3000
// يعرض نفس صفحة موقع Claude، والبيانات والملفات محمية بكلمة المرور (بخلاف نسخة GitHub Pages)

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const site = require('./tools/site');

const PORT = Number(process.env.PORT) || 3000;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.pdf': 'application/pdf',
};

// ---------- الجلسات (في الذاكرة) ----------
const SESSION_COOKIE = 'isnad_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 ساعة
const sessions = new Map();

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function isAuthed(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token || !sessions.has(token)) return false;
  if (Date.now() > sessions.get(token)) {
    sessions.delete(token);
    return false;
  }
  return true;
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// ---------- أدوات الرد ----------
function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}

function sendJson(res, status, obj, headers = {}) {
  send(res, status, JSON.stringify(obj), { 'Content-Type': MIME['.json'], ...headers });
}

function sendFile(res, file) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'Not found');
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': 'no-store',
    });
    fs.createReadStream(file).pipe(res);
  });
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 1e5) req.destroy();
    });
    req.on('end', () => resolve(data));
  });
}

// ---------- الموجّه ----------
async function handle(req, res) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    return send(res, 400, 'Bad request');
  }

  // البوابة وصفحات الجهات عامة (لا بيانات فيها)؛ البيانات والملفات بعدها تتطلب الدخول
  if (pathname === '/' || pathname === '/index.html') {
    return send(res, 200, site.portalHtml({ mode: 'server' }), { 'Content-Type': MIME['.html'] });
  }
  let um = pathname.match(/^\/([a-z]+)\.html$/);
  if (um && site.UNITS[um[1]]) return send(res, 200, site.pageHtml(um[1], { mode: 'server' }), { 'Content-Type': MIME['.html'] });
  if (pathname === '/shim.js') return sendFile(res, path.join(site.SITE_DIR, 'shim.js'));
  const logo = site.logoFile();
  if (logo && pathname === '/blobs/' + logo) return sendFile(res, path.join(site.BLOBS_DIR, logo)); // أيقونة التبويب قبل الدخول

  if (pathname === '/api/login' && req.method === 'POST') {
    let password = '';
    try {
      password = JSON.parse(await readBody(req)).password || '';
    } catch {}
    // على الاستضافة تُضبط كلمة المرور من متغير البيئة SITE_PASSWORD
    if (!safeEqual(password, site.password())) {
      return sendJson(res, 401, { ok: false, error: 'كلمة المرور غير صحيحة' });
    }
    const token = crypto.randomBytes(24).toString('hex');
    sessions.set(token, Date.now() + SESSION_TTL_MS);
    return sendJson(res, 200, { ok: true }, {
      'Set-Cookie': `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_MS / 1000}${
        req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : ''
      }`,
    });
  }

  if (pathname === '/logout') {
    const token = parseCookies(req)[SESSION_COOKIE];
    if (token) sessions.delete(token);
    return send(res, 204, '', { 'Set-Cookie': `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0` });
  }

  // كل ما بعد هذا (البيانات والملفات) يتطلب تسجيل الدخول
  if (!isAuthed(req)) return sendJson(res, 401, { ok: false, error: 'unauthorized' });
  if (req.method !== 'GET') return send(res, 405, 'Method not allowed');

  // بيانات كل جهة في مسارها: /db.json لقسم الدعم والإسناد، و/units/<الجهة>/db.json لغيره
  const unitOf = (web) => Object.keys(site.UNITS).find((u) => site.UNITS[u].web === web);
  um = pathname.match(/^\/(units\/[a-z]+\/)?db\.json$/);
  if (um && unitOf(um[1] || '')) {
    try {
      return sendJson(res, 200, site.dbJson(unitOf(um[1] || '')));
    } catch (e) {
      console.error('خطأ في قراءة البيانات:', e.message);
      return sendJson(res, 500, { error: 'خطأ في ملف البيانات: ' + e.message });
    }
  }
  let m = pathname.match(/^\/(units\/[a-z]+\/)?db\/files\/([A-Za-z0-9_-]+\.json)$/);
  if (m && unitOf(m[1] || '')) return sendFile(res, path.join(site.unitDb(unitOf(m[1] || '')), 'files', m[2]));
  m = pathname.match(/^\/blobs\/([0-9a-f]{32}\.[a-z0-9]+)$/);
  if (m) return sendFile(res, path.join(site.BLOBS_DIR, m[1]));

  return send(res, 404, 'Not found');
}

http
  .createServer((req, res) => {
    handle(req, res).catch((e) => {
      console.error(e);
      send(res, 500, 'Server error');
    });
  })
  .listen(PORT, () => {
    console.log('');
    console.log('  موقع أرشيف قسم الدعم والإسناد يعمل الآن');
    console.log(`  افتح المتصفح على:  http://localhost:${PORT}`);
    console.log('  لإيقاف الموقع اضغط Ctrl + C');
    console.log('');
  });
