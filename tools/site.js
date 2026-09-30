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
const UNITS = {
  isnad: { name: 'قسم الدعم والإسناد', desc: 'أرشيف الآليات والمستودعات والكادر البشري', dbDir: 'data/db', web: '', names: {} },
  sharaf: {
    name: 'مركز شراف',
    desc: 'أرشيف الآليات والمستودعات والكادر البشري',
    dbDir: 'data/units/sharaf/db',
    web: 'units/sharaf/',
    names: {
      'أرشيف قسم الدعم والإسناد': 'أرشيف مركز شراف',
      'قسم الدعم والإسناد': 'مركز شراف',
      "value:r.from||'قسم الإسناد والاحتياط'": "value:r.from||'مركز شراف'",
      "'مستودع الإسناد (الرقم غير محدد)'": "'مستودع المركز (الرقم غير محدد)'",
      'مقصور استخدامه على مدير القسم': 'مقصور استخدامه على مدير المركز',
    },
  },
};
const unitDb = (u) => path.join(ROOT, UNITS[u].dbDir);

function password() {
  let settings = {};
  try {
    settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
  } catch {}
  return String(process.env.SITE_PASSWORD || settings.password || '1234');
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
  patch('<script>\n(function(){', `<script>window.ISNAD_CONFIG=${JSON.stringify(cfg)};</script>\n<script src="shim.js"></script>\n<script>\n(function(){`);
  for (const [from, to] of Object.entries(u.names)) patch(from, to);
  const logo = logoFile();
  if (logo) patch('<title>', `<link rel="icon" href="blobs/${logo}">\n<title>`);
  return html;
}

// البوابة: كلمة المرور ثم اختيار الجهة
function portalHtml(config) {
  const units = Object.entries(UNITS).map(([id, u]) => ({ id, name: u.name, desc: u.desc }));
  const logo = logoFile();
  return fs
    .readFileSync(path.join(SITE_DIR, 'portal.html'), 'utf8')
    .replace('/*CONFIG*/', `window.ISNAD_CONFIG=${JSON.stringify(Object.assign({ units, logo: logo ? 'blobs/' + logo : '' }, config))};`);
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

module.exports = { ROOT, SITE_DIR, DB_DIR, BLOBS_DIR, UNITS, unitDb, password, passwordHash, pageHtml, portalHtml, dbJson, blobFiles, logoFile };
