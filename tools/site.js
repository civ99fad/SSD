// تجميع الموقع من site/ وبيانات data/ — يستخدمه build-static.js و server.js
// البوابة (portal.html) ← صفحة لكل جهة (page.html بنفس الميزات، وبيانات كل جهة مستقلة)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const SITE_DIR = path.join(ROOT, 'site');
const DB_DIR = path.join(ROOT, 'data', 'db');
const BLOBS_DIR = path.join(ROOT, 'data', 'blobs');
const SETTINGS_FILE = path.join(ROOT, 'data', 'settings.json');

// الجهات: كل جهة لها صفحتها وبياناتها في مجلد مستقل، والصور والملفات مشتركة في data/blobs
// names: نصوص الصفحة الخاصة بالقسم تُستبدل لكل جهة
// المراكز: نفس صفحة القسم وميزاته، وكل مركز يبدأ فارغًا ببيانات مستقلة (بالترتيب الذي تظهر به في البوابة)
const CENTERS = [
  ['balad', 'مركز البلد'],
  ['sharaf', 'مركز شراف'],
  ['muntazah', 'مركز المنتزه'],
  ['sinaiya', 'مركز الصناعية'],
  ['aziziya', 'مركز العزيزية'],
  ['dairi', 'مركز الدائري'],
  ['aja', 'مركز أجا'],
  ['jabal', 'مركز الجبل'],
  ['hazmat', 'مركز التدخل بحوادث المواد الخطرة'],
];
const centerNames = (name) => ({
  'أرشيف قسم الدعم والإسناد': 'أرشيف ' + name,
  'قسم الدعم والإسناد': name,
  "value:r.from||'قسم الإسناد والاحتياط'": `value:r.from||'${name}'`,
  "'مستودع الإسناد (الرقم غير محدد)'": "'مستودع المركز (الرقم غير محدد)'",
  'مقصور استخدامه على مدير القسم': 'مقصور استخدامه على مدير المركز',
});
const UNITS = {};
for (const [id, name] of CENTERS) {
  UNITS[id] = { name, desc: 'أرشيف الآليات والمستودعات والكادر البشري', dbDir: `data/units/${id}/db`, web: `units/${id}/`, names: centerNames(name) };
}
// قسم الدعم والإسناد آخر البوابة
UNITS.isnad = { name: 'قسم الدعم والإسناد', desc: 'أرشيف الآليات والمستودعات والكادر البشري', dbDir: 'data/db', web: '', names: {}, hide: ['bounds'] }; // قسم الإسناد ليس له حدود
const unitDb = (u) => path.join(ROOT, UNITS[u].dbDir);
// بيانات مشتركة تظهر في كل الجهات (نماذج ومحاضر)، وملفات Word الخاصة بها في data/shared/db/files
const SHARED_DB = path.join(ROOT, 'data', 'shared', 'db');
const SHARED_COLS = ['forms'];
// لوحة مدير الإدارة: تجمع جاهزية كل الجهات في صفحة واحدة، ولها كلمة مرورها (password('manager'))،
// وهي للاطلاع فقط: لا تفتح صفحات الجهات (كل جهة بكلمة مرورها)
// ولا تطّلع على مهام الجهات (داخلية لكل جهة)
const MANAGER = { id: 'manager', name: 'لوحة مدير الإدارة' };

// كلمة مرور كل جهة (البوابة نفسها بلا كلمة مرور). الأولوية:
// SITE_PASSWORD_<الجهة> ثم units.<الجهة> في data/settings.json ثم SITE_PASSWORD ثم password ثم 1234
function password(unit) {
  let settings = {};
  try {
    settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
  } catch {}
  const env = process.env['SITE_PASSWORD_' + String(unit || '').toUpperCase()];
  const own = (settings.units || {})[unit];
  return String(env || own || process.env.SITE_PASSWORD || settings.password || '1234');
}

// المستودع والفرع اللذان يحفظ فيهما المسؤول تعديلاته (GitHub Actions و Render يمرّرانهما تلقائيًا)
const repo = () => ({
  repo: process.env.GITHUB_REPOSITORY || process.env.RENDER_GIT_REPO_SLUG || 'civ99fad/SSD',
  branch: process.env.GITHUB_REF_NAME || process.env.RENDER_GIT_BRANCH || 'claude/civil-defense-archive-site-y3ue1n',
});

const passwordHash = (pw) => crypto.createHash('sha256').update('isnad:' + pw).digest('hex');

// صفحة الجهة: روابط الملفات تأتي من الشيم، والشيم يُحمّل قبل سكربت الصفحة، ونصوص القسم تُستبدل باسم الجهة
function pageHtml(unit, config) {
  const u = UNITS[unit];
  let html = fs.readFileSync(path.join(SITE_DIR, 'page.html'), 'utf8');
  const patch = (from, to) => {
    if (!html.includes(from)) throw new Error('site/page.html: لم يُعثر على: ' + from);
    html = html.split(from).join(to);
  };
  patch("const blob = id => id ? '/_blob/' + encodeURIComponent(id) : '';", "const blob = id => id ? window.ISNAD.blob(id) : '';");
  const cfg = Object.assign(repo(), config, { unit, unitName: u.name, dbDir: u.dbDir, web: u.web });
  // ?v= بصمة الشيم: يجبر المتصفح على تحميل النسخة الجديدة بعد كل تحديث بدل نسخته المخزّنة
  const ver = crypto.createHash('sha1').update(fs.readFileSync(path.join(SITE_DIR, 'shim.js'))).digest('hex').slice(0, 10);
  patch('<script>\n(function(){', `<script>window.ISNAD_CONFIG=${JSON.stringify(cfg)};</script>\n<script src="shim.js?v=${ver}"></script>\n<script>\n(function(){`);
  for (const [from, to] of Object.entries(u.names)) patch(from, to);
  // أقسام لا تنطبق على الجهة تُخفى من قائمتها الجانبية
  if ((u.hide || []).length) patch('</head>', `<style>${u.hide.map((k) => '#nav-' + k).join(',')}{display:none!important}</style>\n</head>`);
  const logo = logoFile();
  if (logo) patch('<title>', `<link rel="icon" href="blobs/${logo}">\n<title>`);
  return html;
}

// البوابة: اختيار الجهة (بلا كلمة مرور) وخانة لوحة المدير
function portalHtml(config) {
  const units = Object.entries(UNITS).map(([id, u]) => ({ id, name: u.name, desc: u.desc }));
  const logo = logoFile();
  return fs
    .readFileSync(path.join(SITE_DIR, 'portal.html'), 'utf8')
    .replace('/*CONFIG*/', `window.ISNAD_CONFIG=${JSON.stringify(Object.assign({ units, manager: MANAGER, logo: logo ? 'blobs/' + logo : '' }, config))};`);
}

// لوحة المدير: تقرأ db.json لكل جهة وتعرض جاهزيتها
function managerHtml(config) {
  const units = Object.entries(UNITS).map(([id, u]) => ({ id, name: u.name, web: u.web }));
  const logo = logoFile();
  let html = fs.readFileSync(path.join(SITE_DIR, 'manager.html'), 'utf8');
  if (logo) html = html.replace('<title>', `<link rel="icon" href="blobs/${logo}">\n<title>`);
  return html.replace('/*CONFIG*/', `window.ISNAD_CONFIG=${JSON.stringify(Object.assign({ units, unit: MANAGER.id, logo: logo ? 'blobs/' + logo : '' }, config))};`);
}

// كل مجموعات الجهة (عدا ملفات Word الكبيرة في db/files) + خريطة معرّف الملف ← مساره
function dbJson(unit) {
  const dir = unitDb(unit);
  const collections = {};
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith('.json')) collections[f.slice(0, -5)] = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    }
  }
  for (const c of SHARED_COLS) {
    const f = path.join(SHARED_DB, c + '.json');
    collections[c] = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {};
  }
  const blobs = {};
  for (const f of blobFiles()) blobs[f.split('.')[0]] = 'blobs/' + f;
  return { collections, blobs };
}

function logoFile() {
  try {
    const id = JSON.parse(fs.readFileSync(path.join(DB_DIR, 'settings.json'), 'utf8')).site.logo;
    return blobFiles().find((f) => f.startsWith(id + '.'));
  } catch {
    return null;
  }
}

const blobFiles = () => fs.readdirSync(BLOBS_DIR).filter((f) => /^[0-9a-f]{32}\.[a-z0-9]+$/.test(f));

module.exports = { ROOT, SITE_DIR, DB_DIR, BLOBS_DIR, UNITS, MANAGER, SHARED_DB, unitDb, password, passwordHash, pageHtml, portalHtml, managerHtml, dbJson, blobFiles, logoFile };
