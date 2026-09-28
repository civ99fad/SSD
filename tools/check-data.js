// فحص ملفات البيانات والتنبيه على الأخطاء الشائعة
// الاستخدام: npm run check
const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', 'data');
let problems = 0;
const warn = (msg) => { problems++; console.log('  ✗ ' + msg); };

const whIds = fs.readdirSync(path.join(DATA, 'warehouses')).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
for (const id of whIds) {
  try { JSON.parse(fs.readFileSync(path.join(DATA, 'warehouses', id + '.json'), 'utf8')); }
  catch (e) { warn(`المستودع ${id}: خطأ في الصياغة — ${e.message}`); }
}

const vDir = path.join(DATA, 'vehicles');
const ids = fs.readdirSync(vDir).filter((d) => fs.statSync(path.join(vDir, d)).isDirectory());
for (const id of ids) {
  const file = path.join(vDir, id, 'info.json');
  if (!fs.existsSync(file)) { warn(`الآلية ${id}: لا يوجد ملف info.json`); continue; }
  let v;
  try { v = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { warn(`الآلية ${id}: خطأ في صياغة info.json — ${e.message}`); continue; }
  for (const k of ['name', 'plate', 'model']) if (!v[k]) warn(`الآلية ${id}: الحقل "${k}" فارغ`);
  if (v.warehouse && !whIds.includes(String(v.warehouse))) warn(`الآلية ${id}: المستودع "${v.warehouse}" غير موجود`);
  for (const h of v.history || []) {
    if (h.file && !fs.existsSync(path.join(vDir, id, 'documents', h.file))) warn(`الآلية ${id}: المستند "${h.file}" غير موجود في documents`);
  }
}
console.log(problems ? `\nعدد الملاحظات: ${problems}` : `كل البيانات سليمة (${ids.length} آلية، ${whIds.length} مستودعات).`);
process.exit(problems ? 1 : 0);
