// خادم محلي لموقع أرشيف قسم الإسناد — بدون أي مكتبات خارجية (Node.js فقط)
// التشغيل: node server.js  ثم افتح http://localhost:3000

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const VEHICLES_DIR = path.join(DATA_DIR, 'vehicles');
const WAREHOUSES_DIR = path.join(DATA_DIR, 'warehouses');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

const IMAGE_EXT = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.ico': 'image/x-icon',
};

// ---------- الجلسات (في الذاكرة) ----------
const SESSION_COOKIE = 'isnad_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 ساعة
const sessions = new Map();

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
  } catch {
    return { password: '1234' };
  }
}

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

// ---------- قراءة البيانات من المجلدات ----------
function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function listFiles(dir, exts) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => !f.startsWith('.') && (!exts || exts.includes(path.extname(f).toLowerCase())))
    .sort((a, b) => a.localeCompare(b, 'ar', { numeric: true }));
}

function fileUrl(...parts) {
  return '/files/' + parts.map(encodeURIComponent).join('/');
}

function vehicleIds() {
  if (!fs.existsSync(VEHICLES_DIR)) return [];
  return fs
    .readdirSync(VEHICLES_DIR)
    .filter((d) => fs.existsSync(path.join(VEHICLES_DIR, d, 'info.json')))
    .sort((a, b) => a.localeCompare(b, 'ar', { numeric: true }));
}

function loadVehicle(id) {
  const dir = path.join(VEHICLES_DIR, id);
  const info = readJson(path.join(dir, 'info.json'));
  const photos = listFiles(path.join(dir, 'photos'), IMAGE_EXT).map((f) => fileUrl('vehicles', id, 'photos', f));
  const contents = listFiles(path.join(dir, 'contents'), IMAGE_EXT).map((f) => fileUrl('vehicles', id, 'contents', f));
  const forms = listFiles(path.join(dir, 'form'), ['.docx', '.doc', '.pdf']).map((f) => ({
    name: f,
    url: fileUrl('vehicles', id, 'form', f),
  }));
  const history = (info.history || []).map((h) => ({
    ...h,
    url: h.file ? fileUrl('vehicles', id, 'documents', h.file) : null,
  }));
  history.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  return { id, ...info, photos, contents, forms, history };
}

function vehicleSummary(v) {
  return {
    id: v.id,
    name: v.name,
    plate: v.plate,
    make: v.make,
    model: v.model,
    warehouse: v.warehouse || '',
    thumb: v.photos[0] || null,
  };
}

function warehouseIds() {
  if (!fs.existsSync(WAREHOUSES_DIR)) return [];
  return fs
    .readdirSync(WAREHOUSES_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -5))
    .sort((a, b) => a.localeCompare(b, 'ar', { numeric: true }));
}

function loadWarehouse(id) {
  return { id, ...readJson(path.join(WAREHOUSES_DIR, id + '.json')) };
}

// ---------- أدوات الرد ----------
function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}

function sendJson(res, status, obj, headers = {}) {
  send(res, status, JSON.stringify(obj), { 'Content-Type': MIME['.json'], ...headers });
}

function redirect(res, to) {
  send(res, 302, '', { Location: to });
}

function sendFile(res, file, extraHeaders = {}) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'Not found');
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': 'no-store',
      ...extraHeaders,
    });
    fs.createReadStream(file).pipe(res);
  });
}

// يمنع الخروج من المجلد المسموح (path traversal)
function resolveInside(base, rel) {
  const full = path.resolve(base, rel);
  return full.startsWith(base + path.sep) ? full : null;
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
  const url = new URL(req.url, 'http://localhost');
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return send(res, 400, 'Bad request');
  }
  const authed = isAuthed(req);

  // ملفات عامة (خطوط، تنسيقات، سكربت صفحة الدخول)
  if (pathname.startsWith('/assets/')) {
    const file = resolveInside(PUBLIC_DIR, pathname.slice('/assets/'.length));
    return file ? sendFile(res, file) : send(res, 404, 'Not found');
  }

  if (pathname === '/login') {
    if (authed) return redirect(res, '/');
    return sendFile(res, path.join(PUBLIC_DIR, 'login.html'));
  }

  if (pathname === '/api/login' && req.method === 'POST') {
    let password = '';
    try {
      password = JSON.parse(await readBody(req)).password || '';
    } catch {}
    const expected = String(readSettings().password ?? '1234');
    if (!safeEqual(password, expected)) {
      return sendJson(res, 401, { ok: false, error: 'كلمة المرور غير صحيحة' });
    }
    const token = crypto.randomBytes(24).toString('hex');
    sessions.set(token, Date.now() + SESSION_TTL_MS);
    return sendJson(res, 200, { ok: true }, {
      'Set-Cookie': `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_MS / 1000}`,
    });
  }

  if (pathname === '/logout') {
    const token = parseCookies(req)[SESSION_COOKIE];
    if (token) sessions.delete(token);
    return send(res, 302, '', {
      Location: '/login',
      'Set-Cookie': `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`,
    });
  }

  // كل ما بعد هذا يتطلب تسجيل الدخول
  if (!authed) {
    if (pathname.startsWith('/api/') || pathname.startsWith('/files/')) {
      return sendJson(res, 401, { ok: false, error: 'unauthorized' });
    }
    return redirect(res, '/login');
  }

  if (req.method !== 'GET') return send(res, 405, 'Method not allowed');

  try {
    if (pathname === '/api/vehicles') {
      const list = vehicleIds().map((id) => vehicleSummary(loadVehicle(id)));
      return sendJson(res, 200, list);
    }
    let m = pathname.match(/^\/api\/vehicles\/([^/]+)$/);
    if (m) {
      if (!vehicleIds().includes(m[1])) return sendJson(res, 404, { error: 'not found' });
      return sendJson(res, 200, loadVehicle(m[1]));
    }
    if (pathname === '/api/warehouses') {
      return sendJson(res, 200, warehouseIds().map(loadWarehouse));
    }
    m = pathname.match(/^\/api\/warehouses\/([^/]+)$/);
    if (m) {
      if (!warehouseIds().includes(m[1])) return sendJson(res, 404, { error: 'not found' });
      return sendJson(res, 200, loadWarehouse(m[1]));
    }
  } catch (e) {
    console.error('خطأ في قراءة البيانات:', e.message);
    return sendJson(res, 500, { error: 'خطأ في ملف البيانات: ' + e.message });
  }

  if (pathname.startsWith('/files/')) {
    // يُسمح فقط بملفات مجلدات الصور والمستندات للآليات (وليس الإعدادات أو ملفات البيانات)
    const rel = pathname.slice('/files/'.length);
    const file = resolveInside(DATA_DIR, rel);
    const allowed = /^vehicles\/[^/]+\/(photos|contents|documents|form)\/[^/]+$/.test(rel);
    if (!file || !allowed || path.basename(file).startsWith('.')) return send(res, 404, 'Not found');
    const headers = {};
    if (url.searchParams.has('download')) {
      headers['Content-Disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(file))}`;
    }
    return sendFile(res, file, headers);
  }

  // باقي المسارات: تطبيق الصفحة الواحدة
  return sendFile(res, path.join(PUBLIC_DIR, 'app.html'));
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
    console.log('  موقع أرشيف قسم الإسناد يعمل الآن');
    console.log(`  افتح المتصفح على:  http://localhost:${PORT}`);
    console.log('  لإيقاف الموقع اضغط Ctrl + C');
    console.log('');
  });
