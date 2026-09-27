// تغيير كلمة مرور الدخول
// الاستخدام: npm run set-password -- 5678
const fs = require('fs');
const path = require('path');

const pw = process.argv[2];
if (!pw) {
  console.log('اكتب كلمة المرور الجديدة، مثال:  npm run set-password -- 5678');
  process.exit(1);
}
const file = path.join(__dirname, '..', 'data', 'settings.json');
let settings = {};
try { settings = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
settings.password = pw;
fs.writeFileSync(file, JSON.stringify(settings, null, 2) + '\n');
console.log('تم تغيير كلمة المرور. تُطبّق فورًا على عمليات الدخول الجديدة.');
