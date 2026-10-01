// بناء نسخة ثابتة من الموقع للنشر على GitHub Pages (بدون خادم)
// الاستخدام: npm run build:static  ← ينتج المجلد _site/
//   index.html = البوابة، و<الجهة>.html = صفحة كل جهة، وبيانات كل جهة في مسارها (db.json أو units/<الجهة>/db.json)
// كلمات المرور: لكل جهة كلمتها (انظر password() في tools/site.js)، والبوابة بلا كلمة مرور
const fs = require('fs');
const path = require('path');
const site = require('./site');

const OUT = path.join(site.ROOT, '_site');

// بصمة هذه النسخة: كل صفحة تتحقق من version.json المنشور، وإن كانت نسخة الصفحة المخزّنة في المتصفح أقدم تعيد تحميل نفسها مرة واحدة،
// وتظهر البصمة صغيرة أسفل الصفحة ليتأكد المستخدم أنه يرى آخر نسخة
const BUILD = String(Date.now());
const guard = (html) =>
  html.replace(
    '</head>',
    `<script>(function(){var B=${JSON.stringify(BUILD)};
function put(){var d=document.createElement('div');d.textContent='نسخة الموقع: '+new Date(+B).toLocaleString('ar-SA-u-nu-latn',{timeZone:'Asia/Riyadh',dateStyle:'short',timeStyle:'short'});d.style.cssText='position:fixed;left:6px;bottom:4px;font:10px sans-serif;opacity:.55;pointer-events:none;z-index:9999;direction:rtl';document.body.appendChild(d);}
if(document.body)put();else document.addEventListener('DOMContentLoaded',put);
fetch('version.json',{cache:'no-store'}).then(function(r){return r.json()}).then(function(v){if(String(v.build)===B)return;var k='isnad-fresh',n=0;try{n=+sessionStorage.getItem(k)||0;sessionStorage.setItem(k,n+1)}catch(e){}
if(n>1)return;fetch(location.href,{cache:'reload'}).catch(function(){}).then(function(){location.reload()});}).catch(function(){});})();</script>\n</head>`
  );

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'blobs'), { recursive: true });

fs.writeFileSync(path.join(OUT, 'index.html'), guard(site.portalHtml({ mode: 'static' })));
fs.copyFileSync(path.join(site.SITE_DIR, 'shim.js'), path.join(OUT, 'shim.js'));
fs.writeFileSync(path.join(OUT, 'manager.html'), guard(site.managerHtml({ mode: 'static', hash: site.passwordHash(site.password(site.MANAGER.id)) })));
fs.writeFileSync(path.join(OUT, 'ops.html'), guard(site.managerHtml({ mode: 'static', hash: site.passwordHash(site.password(site.MANAGER.id)), title: 'لوحة مدير إدارة العمليات' })));

const report = [];
for (const [unit, u] of Object.entries(site.UNITS)) {
  fs.writeFileSync(path.join(OUT, unit + '.html'), guard(site.pageHtml(unit, { mode: 'static', hash: site.passwordHash(site.password(unit)) })));
  const web = path.join(OUT, u.web);
  fs.mkdirSync(web, { recursive: true });
  const db = site.dbJson(unit);
  fs.writeFileSync(path.join(web, 'db.json'), JSON.stringify(db));
  const files = path.join(site.unitDb(unit), 'files');
  if (fs.existsSync(files)) fs.cpSync(files, path.join(web, 'db', 'files'), { recursive: true });
  report.push(`${u.name}: ${Object.keys(db.collections.vehicles || {}).length} آلية`);
}

const shared = path.join(site.SHARED_DB, 'files');
if (fs.existsSync(shared)) fs.cpSync(shared, path.join(OUT, 'shared', 'db', 'files'), { recursive: true });

const files = site.blobFiles();
for (const f of files) fs.copyFileSync(path.join(site.BLOBS_DIR, f), path.join(OUT, 'blobs', f));
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');
fs.writeFileSync(path.join(OUT, 'version.json'), JSON.stringify({ build: BUILD }));

console.log(`تم البناء في _site/ — ${report.join('، ')} — ${files.length} ملفًا`);
