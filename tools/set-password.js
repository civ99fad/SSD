// تغيير كلمة مرور جهة (أو كلمة المرور الافتراضية لكل الجهات)
// الاستخدام: npm run set-password -- 5678 sharaf   ← كلمة مرور مركز شراف فقط
//            npm run set-password -- 5678          ← الكلمة الافتراضية للجهات التي ليس لها كلمة خاصة
const fs = require('fs');
const path = require('path');
const { UNITS } = require('./site');

const [pw, unit] = process.argv.slice(2);
if (!pw || (unit && !UNITS[unit])) {
  console.log('مثال:  npm run set-password -- 5678 sharaf');
  console.log('الجهات: ' + Object.keys(UNITS).join('، '));
  process.exit(1);
}
const file = path.join(__dirname, '..', 'data', 'settings.json');
let settings = {};
try { settings = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
if (unit) settings.units = Object.assign({}, settings.units, { [unit]: pw });
else settings.password = pw;
fs.writeFileSync(file, JSON.stringify(settings, null, 2) + '\n');
console.log(unit ? `تم تغيير كلمة مرور ${UNITS[unit].name}.` : 'تم تغيير كلمة المرور الافتراضية.');
