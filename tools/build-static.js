// بناء نسخة ثابتة من الموقع للنشر على GitHub Pages (بدون خادم)
// الاستخدام: npm run build:static  ← ينتج المجلد _site/
// كلمة المرور: من متغير البيئة SITE_PASSWORD إن وُجد، وإلا من data/settings.json
const fs = require('fs');
const path = require('path');
const site = require('./site');

const OUT = path.join(site.ROOT, '_site');

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'blobs'), { recursive: true });

fs.writeFileSync(path.join(OUT, 'index.html'), site.pageHtml({ mode: 'static', hash: site.passwordHash(site.password()) }));
fs.copyFileSync(path.join(site.SITE_DIR, 'shim.js'), path.join(OUT, 'shim.js'));

const db = site.dbJson();
fs.writeFileSync(path.join(OUT, 'db.json'), JSON.stringify(db));
fs.cpSync(path.join(site.DB_DIR, 'files'), path.join(OUT, 'db', 'files'), { recursive: true });

const files = site.blobFiles();
for (const f of files) fs.copyFileSync(path.join(site.BLOBS_DIR, f), path.join(OUT, 'blobs', f));
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');

const n = (c) => Object.keys(db.collections[c] || {}).length;
console.log(`تم البناء في _site/ — ${n('vehicles')} آلية، ${n('equipment')} معدة، ${n('warehouses')} مستودعات، ${files.length} ملفًا`);
