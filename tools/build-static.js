// بناء نسخة ثابتة من الموقع للنشر على GitHub Pages (بدون خادم)
// الاستخدام: npm run build:static  ← ينتج المجلد _site/
// كلمة المرور: من متغير البيئة SITE_PASSWORD إن وُجد، وإلا من data/settings.json
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const data = require('../server.js');

const ROOT = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const OUT = path.join(ROOT, '_site');

// روابط الملفات من الخادم تبدأ بـ /files/ — في النسخة الثابتة تصبح نسبية
function relativize(v) {
  if (typeof v === 'string') return v.startsWith('/files/') ? v.slice(1) : v;
  if (Array.isArray(v)) return v.map(relativize);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, relativize(x)]));
  return v;
}

function writeJson(rel, obj) {
  const file = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(relativize(obj)));
}

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return 0;
  let n = 0;
  fs.mkdirSync(dest, { recursive: true });
  for (const f of fs.readdirSync(src)) {
    if (f.startsWith('.')) continue;
    const from = path.join(src, f);
    if (fs.statSync(from).isFile()) {
      fs.copyFileSync(from, path.join(dest, f));
      n++;
    }
  }
  return n;
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

// ---------- البيانات ----------
const ids = data.vehicleIds();
const vehicles = ids.map(data.loadVehicle);
writeJson('api/vehicles.json', vehicles.map(data.vehicleSummary));
vehicles.forEach((v) => writeJson(`api/vehicles/${v.id}.json`, v));

const warehouses = data.warehouseIds().map(data.loadWarehouse);
writeJson('api/warehouses.json', warehouses);
warehouses.forEach((w) => writeJson(`api/warehouses/${w.id}.json`, w));

for (const name of data.RECORDS) {
  const file = path.join(DATA_DIR, 'records', name + '.json');
  writeJson(`api/records/${name}.json`, fs.existsSync(file) ? data.readJson(file) : name === 'misdocs' ? {} : []);
}

// ---------- الملفات (نفس المجلدات التي يسمح بها الخادم فقط) ----------
let files = copyDir(path.join(DATA_DIR, 'files'), path.join(OUT, 'files', 'files'));
for (const id of ids) {
  for (const sub of ['photos', 'contents', 'documents', 'form']) {
    files += copyDir(path.join(DATA_DIR, 'vehicles', id, sub), path.join(OUT, 'files', 'vehicles', id, sub));
  }
}

// ---------- الصفحات ----------
fs.cpSync(PUBLIC_DIR, path.join(OUT, 'assets'), { recursive: true });

const password = String(process.env.SITE_PASSWORD || data.readSettings().password || '1234');
const site = {
  hash: crypto.createHash('sha256').update('isnad:' + password).digest('hex'),
  key: 'isnad_auth',
};
const siteScript = `<script>window.STATIC_SITE=${JSON.stringify(site)};</script>`;
// يُحوَّل الزائر لصفحة الدخول قبل ظهور أي محتوى إن لم يدخل كلمة المرور
const guard = `<script>try{if(localStorage.getItem(STATIC_SITE.key)!==STATIC_SITE.hash)location.replace('login.html')}catch(e){location.replace('login.html')}</script>`;

function page(src, extraHead = '') {
  return fs
    .readFileSync(path.join(PUBLIC_DIR, src), 'utf8')
    .replace(/(href|src)="\/assets\//g, '$1="assets/')
    .replace('<head>', '<head>\n' + siteScript + extraHead);
}
fs.writeFileSync(path.join(OUT, 'index.html'), page('app.html', guard));
fs.writeFileSync(path.join(OUT, 'login.html'), page('login.html'));
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');

console.log(`تم البناء في _site/ — ${vehicles.length} آلية، ${warehouses.length} مستودعات، ${files} ملفًا`);
