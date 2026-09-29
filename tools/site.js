// تجميع الموقع من صفحة Claude (site/page.html) وبيانات data/ — يستخدمه build-static.js و server.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const SITE_DIR = path.join(ROOT, 'site');
const DB_DIR = path.join(ROOT, 'data', 'db');
const BLOBS_DIR = path.join(ROOT, 'data', 'blobs');
const SETTINGS_FILE = path.join(ROOT, 'data', 'settings.json');

function password() {
  let settings = {};
  try {
    settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
  } catch {}
  return String(process.env.SITE_PASSWORD || settings.password || '1234');
}

const passwordHash = (pw) => crypto.createHash('sha256').update('isnad:' + pw).digest('hex');

// صفحة Claude كما هي، مع تعديلين: روابط الملفات تأتي من الشيم، والشيم يُحمّل قبل سكربت الصفحة
function pageHtml(config) {
  let html = fs.readFileSync(path.join(SITE_DIR, 'page.html'), 'utf8');
  const patch = (from, to) => {
    if (!html.includes(from)) throw new Error('site/page.html: لم يُعثر على: ' + from);
    html = html.replace(from, to);
  };
  patch("const blob = id => id ? '/_blob/' + encodeURIComponent(id) : '';", "const blob = id => id ? window.ISNAD.blob(id) : '';");
  patch('<script>\n(function(){', `<script>window.ISNAD_CONFIG=${JSON.stringify(config)};</script>\n<script src="shim.js"></script>\n<script>\n(function(){`);
  return html;
}

// كل المجموعات (عدا ملفات Word الكبيرة في db/files) + خريطة معرّف الملف ← مساره
function dbJson() {
  const collections = {};
  for (const f of fs.readdirSync(DB_DIR)) {
    if (f.endsWith('.json')) collections[f.slice(0, -5)] = JSON.parse(fs.readFileSync(path.join(DB_DIR, f), 'utf8'));
  }
  const blobs = {};
  for (const f of blobFiles()) blobs[f.split('.')[0]] = 'blobs/' + f;
  return { collections, blobs };
}

const blobFiles = () => fs.readdirSync(BLOBS_DIR).filter((f) => /^[0-9a-f]{32}\.[a-z0-9]+$/.test(f));

module.exports = { ROOT, SITE_DIR, DB_DIR, BLOBS_DIR, password, passwordHash, pageHtml, dbJson, blobFiles };
