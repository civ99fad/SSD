// بناء نسخة ثابتة من الموقع للنشر على GitHub Pages (بدون خادم)
// الاستخدام: npm run build:static  ← ينتج المجلد _site/
//   index.html = البوابة، و<الجهة>.html = صفحة كل جهة، وبيانات كل جهة في مسارها (db.json أو units/<الجهة>/db.json)
// كلمات المرور: لكل جهة كلمتها (انظر password() في tools/site.js)، والبوابة بلا كلمة مرور
const fs = require('fs');
const path = require('path');
const site = require('./site');

const OUT = path.join(site.ROOT, '_site');

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'blobs'), { recursive: true });

fs.writeFileSync(path.join(OUT, 'index.html'), site.portalHtml({ mode: 'static' }));
fs.copyFileSync(path.join(site.SITE_DIR, 'shim.js'), path.join(OUT, 'shim.js'));
fs.mkdirSync(path.join(OUT, site.MANAGER.web), { recursive: true });
fs.writeFileSync(path.join(OUT, site.MANAGER.web, 'db.json'), JSON.stringify(site.managerJson()));
fs.writeFileSync(path.join(OUT, 'manager.html'), site.managerHtml({ mode: 'static', hash: site.passwordHash(site.password(site.MANAGER.id)) }));

const report = [];
for (const [unit, u] of Object.entries(site.UNITS)) {
  fs.writeFileSync(path.join(OUT, unit + '.html'), site.pageHtml(unit, { mode: 'static', hash: site.passwordHash(site.password(unit)) }));
  const web = path.join(OUT, u.web);
  fs.mkdirSync(web, { recursive: true });
  const db = site.dbJson(unit);
  fs.writeFileSync(path.join(web, 'db.json'), JSON.stringify(db));
  const files = path.join(site.unitDb(unit), 'files');
  if (fs.existsSync(files)) fs.cpSync(files, path.join(web, 'db', 'files'), { recursive: true });
  report.push(`${u.name}: ${Object.keys(db.collections.vehicles || {}).length} آلية`);
}

const files = site.blobFiles();
for (const f of files) fs.copyFileSync(path.join(site.BLOBS_DIR, f), path.join(OUT, 'blobs', f));
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');

console.log(`تم البناء في _site/ — ${report.join('، ')} — ${files.length} ملفًا`);
