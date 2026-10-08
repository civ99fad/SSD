// «الحارس»: وسيط تعديل على Cloudflare Workers يعطي كل مدير مركز صلاحية التعديل على مركزه فقط.
// يحتفظ بمفتاح GitHub مخفيًا، ويتحقق من رمز المركز، ولا يسمح بالكتابة إلا في ملفات ذلك المركز
// (وإضافة صور/ملفات جديدة إلى data/blobs دون حذف أو استبدال). الملفات المشتركة لا تُعدَّل من خلاله.
//
// الإعداد في Cloudflare (Settings ← Variables and Secrets):
//   GITHUB_TOKEN  (Secret) مفتاح GitHub بصلاحية Contents: Read and write على المستودع
//   USERS         (Secret، اختياري) اسم المستخدم ورمز المرجع لكل جهة: {"balad":{"u":"ALbalad-1075","r":"105"}}
//   CODES         (Secret) رموز المراكز بصيغة JSON، مثال: {"balad":"رمز-البلد","sharaf":"رمز-شراف","manager":"رمز-لوحة-المدير"}
//                 (manager: كلمة دخول لوحة مدير الإدارة، ويسمح بإرسال التعاميم فقط)
//                 (admin اختياري: رمز المسؤول العام يفتح أي مركز أو قسم أو لوحة المدير، ويعدّل على الجهة المفتوحة)
//   اختياري: REPO (الافتراضي civ99fad/SSD)، BRANCH، ORIGIN (الافتراضي https://civ99fad.github.io)

const NAMES = {
  balad: 'مركز البلد', sharaf: 'مركز شراف', muntazah: 'مركز المنتزه', sinaiya: 'مركز الصناعية', aziziya: 'مركز العزيزية',
  dairi: 'مركز الدائري', aja: 'مركز أجا', jabal: 'مركز الجبل', hazmat: 'مركز التدخل بحوادث المواد الخطرة', rawda: 'مركز الروضة', jubba: 'مركز جبة', khatta: 'مركز الخطة', control: 'مركز التحكم والتوجيه', isnad: 'قسم الدعم والإسناد', supply: 'شعبة التموين', admaff: 'إدارة الشؤون الإدارية', techaff: 'شعبة الشؤون الفنية', hrdiv: 'شعبة الموارد البشرية', sfnpat: 'قسم الدوريات — السلامة في الشمال', sfnlic: 'قسم التراخيص — السلامة في الشمال', sfspat: 'قسم الدوريات — السلامة في الجنوب', sfslic: 'قسم التراخيص — السلامة في الجنوب',
  manager: 'لوحة مدير الإدارة', // رمزه لدخول لوحة المدير فقط (بلا أي تعديل)
};
const unitDir = (u) => (u === 'isnad' ? 'data/db/' : `data/units/${u}/db/`);

export default {
  async fetch(req, env, ctx) {
    const origin = env.ORIGIN || 'https://civ99fad.github.io';
    const cors = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, PUT, DELETE, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Unit, X-Code, X-User, X-Ref, X-Login',
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
    // USERS (اختياري): {"balad":{"u":"ALbalad-1075","r":"105"}} — اسم المستخدم ورمز المرجع لكل جهة (لا يُطلبان لرمز المسؤول admin)
    let users = {};
    try { users = JSON.parse(env.USERS || '{}'); } catch (e) {}
    const want = users[unit]; // كائن {u,r} أو مصفوفة منها (لوحة المدير ولوحة العمليات تشتركان في رمز manager)
    const xu = (req.headers.get('X-User') || '').trim().toLowerCase(), xr = (req.headers.get('X-Ref') || '').trim();
    const userOk = !want || [].concat(want).some((w) => same(String(w.u || '').toLowerCase(), xu) && same(String(w.r || ''), xr));
    const valid = NAMES[unit] && (ok('admin') || (ok(unit) && userOk));
    if (!valid) {
      await new Promise((r) => setTimeout(r, 700)); // إبطاء محاولات التخمين
      return json(401, { message: 'رمز المركز غير صحيح' });
    }

    // من دخل: admin إن كان رمز المسؤول، وإلا مستخدم الجهة (لا يُخزَّن اسم المستخدم ولا الرموز)
    const by = ok('admin') && !ok(unit) ? 'admin' : 'user';
    if (url.pathname === '/check') {
      if (req.headers.get('X-Login') === '1' || url.searchParams.get('login') === '1') ctx.waitUntil(audit(env, { k: 'login', unit, by }));
      return json(200, { ok: true, unit, name: NAMES[unit] });
    }
    if (!url.pathname.startsWith('/gh')) return json(404, { message: 'not found' });

    const path = url.pathname.slice(3); // مسار واجهة GitHub بعد /repos/<المستودع>
    const m = req.method;
    let body, oldDb = null, auditFile = '', isUpload = false;
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
      isUpload = newBlob;
      if (own && m === 'PUT' && /\.json$/.test(file)) {
        auditFile = file;
        oldDb = await readOld(env, file); // نسخة الملف قبل التعديل لمعرفة ما تغيّر
      }
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
    if (r.ok && m !== 'GET') {
      if (auditFile && oldDb !== undefined) {
        let neu = null;
        try { neu = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(String(body.content || '').replace(/\s/g, '')), (c) => c.charCodeAt(0)))); } catch (e) {}
        const ch = diffDb(oldDb, neu);
        if (ch.length) ctx.waitUntil(audit(env, { k: 'edit', unit, by, file: auditFile.split('/').pop().replace(/\.json$/, ''), ch }));
      } else if (isUpload) ctx.waitUntil(audit(env, { k: 'upload', unit, by }));
    }
    return new Response(r.body, { status: r.status, headers: { ...cors, 'Content-Type': r.headers.get('Content-Type') || 'application/json' } });
  },
};

// ---------- سجل التدقيق: ملف صغير لكل حدث في فرع audit (لا يعيد نشر الموقع) ----------
const GH = (env) => 'https://api.github.com/repos/' + (env.REPO || 'civ99fad/SSD');
const ghHeaders = (env, extra) => ({ Authorization: 'Bearer ' + env.GITHUB_TOKEN, Accept: 'application/vnd.github+json', 'User-Agent': 'isnad-edit-worker', ...(extra || {}) });

// محتوى الملف قبل التعديل كائنًا (أو {} إن لم يوجد، أو undefined إن تعذّرت القراءة)
async function readOld(env, file) {
  try {
    const r = await fetch(GH(env) + '/contents/' + file.split('/').map(encodeURIComponent).join('/') + (env.BRANCH ? '?ref=' + encodeURIComponent(env.BRANCH) : ''), { headers: ghHeaders(env, { Accept: 'application/vnd.github.raw' }) });
    if (r.status === 404) return {};
    if (!r.ok) return undefined;
    return JSON.parse(await r.text());
  } catch (e) {
    return undefined;
  }
}

async function audit(env, entry) {
  try {
    const t = Date.now();
    const day = new Date(t + 3 * 3600 * 1000).toISOString().slice(0, 10); // توقيت الرياض
    const path = `data/audit/${day}/${t}-${entry.unit}-${Math.random().toString(36).slice(2, 6)}.json`;
    const bytes = new TextEncoder().encode(JSON.stringify({ ...entry, t }));
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    await fetch(GH(env) + '/contents/' + path, {
      method: 'PUT',
      headers: ghHeaders(env, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ message: `[تدقيق] ${entry.unit} ${entry.k}`, content: btoa(bin), branch: env.AUDIT_BRANCH || 'audit' }),
    });
  } catch (e) {}
}

// ملخص الفرق بين نسختين من ملف قاعدة بيانات (خريطة معرّف ← سجل): إضافة / تعديل (أسماء الحقول) / حذف
function diffDb(a, b) {
  const isO = (x) => x && typeof x === 'object' && !Array.isArray(x);
  if (!isO(a) || !isO(b)) return JSON.stringify(a) === JSON.stringify(b) ? [] : [{ op: 'edit', l: '(الملف)' }];
  const lab = (r, id) => String((isO(r) && (r.name || r.title || r.plate || r.subject || r.num || r.text || r.item || r.pN)) || id).slice(0, 60);
  const short = (v) => (v == null ? '' : typeof v === 'object' ? '…' : String(v).slice(0, 40));
  const out = [];
  for (const k of Object.keys(b)) {
    if (!(k in a)) out.push({ op: 'add', l: lab(b[k], k) });
    else if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) {
      const f = [];
      if (isO(a[k]) && isO(b[k])) {
        for (const x of new Set([...Object.keys(a[k]), ...Object.keys(b[k])])) {
          if (['at', 'updated', 'ts'].includes(x)) continue;
          if (JSON.stringify(a[k][x]) !== JSON.stringify(b[k][x])) f.push({ f: x, o: short(a[k][x]), n: short(b[k][x]) });
        }
      }
      if (f.length || !isO(a[k])) out.push({ op: 'edit', l: lab(b[k], k), f: f.slice(0, 6) });
    }
  }
  for (const k of Object.keys(a)) if (!(k in b)) out.push({ op: 'del', l: lab(a[k], k) });
  return out.slice(0, 30);
}

// مقارنة بزمن ثابت
function same(a, b) {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] || 0) ^ (y[i] || 0);
  return d === 0;
}
