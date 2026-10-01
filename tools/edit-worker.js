// «الحارس»: وسيط تعديل على Cloudflare Workers يعطي كل مدير مركز صلاحية التعديل على مركزه فقط.
// يحتفظ بمفتاح GitHub مخفيًا، ويتحقق من رمز المركز، ولا يسمح بالكتابة إلا في ملفات ذلك المركز
// (وإضافة صور/ملفات جديدة إلى data/blobs دون حذف أو استبدال). الملفات المشتركة لا تُعدَّل من خلاله.
//
// الإعداد في Cloudflare (Settings ← Variables and Secrets):
//   GITHUB_TOKEN  (Secret) مفتاح GitHub بصلاحية Contents: Read and write على المستودع
//   CODES         (Secret) رموز المراكز بصيغة JSON، مثال: {"balad":"رمز-البلد","sharaf":"رمز-شراف","manager":"رمز-لوحة-المدير"}
//                 (manager: كلمة دخول لوحة مدير الإدارة، ويسمح بإرسال التعاميم فقط)
//                 (admin اختياري: رمز المسؤول العام يفتح أي مركز أو قسم أو لوحة المدير، ويعدّل على الجهة المفتوحة)
//   اختياري: REPO (الافتراضي civ99fad/SSD)، BRANCH، ORIGIN (الافتراضي https://civ99fad.github.io)

const NAMES = {
  balad: 'مركز البلد', sharaf: 'مركز شراف', muntazah: 'مركز المنتزه', sinaiya: 'مركز الصناعية', aziziya: 'مركز العزيزية',
  dairi: 'مركز الدائري', aja: 'مركز أجا', jabal: 'مركز الجبل', hazmat: 'مركز التدخل بحوادث المواد الخطرة', isnad: 'قسم الدعم والإسناد',
  manager: 'لوحة مدير الإدارة', // رمزه لدخول لوحة المدير فقط (بلا أي تعديل)
};
const unitDir = (u) => (u === 'isnad' ? 'data/db/' : `data/units/${u}/db/`);

export default {
  async fetch(req, env) {
    const origin = env.ORIGIN || 'https://civ99fad.github.io';
    const cors = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, PUT, DELETE, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Unit, X-Code',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    };
    const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' } });
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const url = new URL(req.url);
    const unit = req.headers.get('X-Unit') || '';
    const code = req.headers.get('X-Code') || '';
    let codes = {};
    try {
      codes = JSON.parse(env.CODES || '{}');
    } catch (e) {
      return json(500, { message: 'CODES غير صالح' });
    }
    const ok = (k) => typeof codes[k] === 'string' && codes[k].length > 0 && same(codes[k], code);
    const valid = NAMES[unit] && (ok(unit) || ok('admin'));
    if (!valid) {
      await new Promise((r) => setTimeout(r, 700)); // إبطاء محاولات التخمين
      return json(401, { message: 'رمز المركز غير صحيح' });
    }

    if (url.pathname === '/check') return json(200, { ok: true, unit, name: NAMES[unit] });
    if (!url.pathname.startsWith('/gh')) return json(404, { message: 'not found' });

    const path = url.pathname.slice(3); // مسار واجهة GitHub بعد /repos/<المستودع>
    const m = req.method;
    let body;
    if (m === 'GET') {
      if (!(path === '' || /^\/(contents|git\/trees|git\/blobs)\//.test(path))) return json(403, { message: 'غير مسموح' });
    } else if (m === 'PUT' || m === 'DELETE') {
      const cm = path.match(/^\/contents\/(.+)$/);
      if (!cm) return json(403, { message: 'غير مسموح' });
      let file;
      try {
        file = decodeURIComponent(cm[1]);
      } catch (e) {
        return json(400, { message: 'مسار غير صالح' });
      }
      if (file.includes('..')) return json(400, { message: 'مسار غير صالح' });
      try {
        body = await req.json();
      } catch (e) {
        return json(400, { message: 'طلب غير صالح' });
      }
      // رمز لوحة المدير يكتب في ملف التعاميم المشترك فقط (تصل لجميع المراكز والأقسام)
      const own = unit === 'manager' ? file === 'data/shared/db/circulars.json' && m === 'PUT' : file.startsWith(unitDir(unit)) && /\.json$/.test(file);
      const newBlob = m === 'PUT' && !body.sha && /^data\/blobs\/[0-9a-f]{32}\.[a-z0-9]+$/.test(file);
      if (!own && !newBlob) return json(403, { message: 'هذا الرمز يسمح بالتعديل على ' + NAMES[unit] + ' فقط' });
      if (env.BRANCH) body.branch = env.BRANCH;
      body.message = `[${NAMES[unit]}] ` + String(body.message || 'تعديل من الموقع').slice(0, 200);
    } else {
      return json(405, { message: 'غير مسموح' });
    }

    const r = await fetch('https://api.github.com/repos/' + (env.REPO || 'civ99fad/SSD') + path + url.search, {
      method: m,
      headers: {
        Authorization: 'Bearer ' + env.GITHUB_TOKEN,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'isnad-edit-worker',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return new Response(r.body, { status: r.status, headers: { ...cors, 'Content-Type': r.headers.get('Content-Type') || 'application/json' } });
  },
};

// مقارنة بزمن ثابت
function same(a, b) {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] || 0) ^ (y[i] || 0);
  return d === 0;
}
