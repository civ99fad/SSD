// إنشاء مجلد آلية جديدة من القالب
// الاستخدام: npm run new-vehicle -- 999
const fs = require('fs');
const path = require('path');

const id = (process.argv[2] || '').trim();
if (!/^[\w؀-ۿ-]+$/.test(id)) {
  console.log('اكتب رقم الآلية، مثال:  npm run new-vehicle -- 999');
  process.exit(1);
}
const dir = path.join(__dirname, '..', 'data', 'vehicles', id);
if (fs.existsSync(dir)) {
  console.log(`الآلية ${id} موجودة مسبقًا: ${dir}`);
  process.exit(1);
}
for (const sub of ['photos', 'contents', 'documents', 'form']) {
  fs.mkdirSync(path.join(dir, sub), { recursive: true });
}
fs.copyFileSync(path.join(__dirname, '..', 'data', '_template', 'info.json'), path.join(dir, 'info.json'));
console.log(`تم إنشاء الآلية ${id} في: ${dir}`);
console.log('عدّل ملف info.json وضع الصور والملفات في المجلدات الفرعية.');
