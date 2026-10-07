// يشغّل صفحة موقع Claude (page.html) خارج Claude: يوفّر window.claude.use('db' | 'user' | 'assets' | 'downloads')
// بنفس الواجهة التي تستخدمها الصفحة. الدخول بكلمة المرور يتم من البوابة (portal.html)، ولكل جهة بياناتها.
// - للفريق: البيانات تُقرأ من ملفات ثابتة (db.json للجهة و blobs/) والموقع للعرض فقط.
// - للمسؤول: بعد إدخال مفتاح GitHub تُقرأ البيانات من المستودع مباشرة، وكل حفظ يُرفع إليه كتعديل (commit)
//   فيُعاد نشر الموقع تلقائيًا.
(function () {
  const cfg = window.ISNAD_CONFIG || {}; // { mode: 'static' | 'server', hash, repo, branch }
  const TOKEN_KEY = 'isnad-gh-token';
  const store = {
    get(k) {
      try {
        return localStorage.getItem(k);
      } catch (e) {
        return null;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(k, v);
      } catch (e) {}
    },
    del(k) {
      try {
        localStorage.removeItem(k);
      } catch (e) {}
    },
  };
  // مدير المركز يعدّل برمز مركزه عبر «الحارس» (cfg.editProxy) الذي لا يسمح إلا بملفات مركزه؛ المسؤول يعدّل بمفتاح GitHub
  const PROXY = (cfg.editProxy || '').replace(/\/+$/, '');
  const CODE_KEY = 'isnad-edit-' + (cfg.unit || 'isnad');
  // لوحات مفاتيح الجوال قد تكتب أرقامًا عربية أو شرطة طويلة أو مسافات خفية؛ نوحّدها قبل الإرسال (الترويسات لا تقبل غير ASCII)
  const cleanCred = (v) => String(v == null ? '' : v)
    .replace(/[٠-٩]/g, (c) => '٠١٢٣٤٥٦٧٨٩'.indexOf(c)).replace(/[۰-۹]/g, (c) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(c))
    .replace(/[\u2010-\u2015\u2212\uFE63\uFF0D]/g, '-').replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF\u00A0]/g, '').trim();
  const asciiOk = (v) => /^[\x21-\x7E]+$/.test(v);
  const sess = {
    get: (k) => { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { sessionStorage.setItem(k, v); } catch (e) {} },
    del: (k) => { try { sessionStorage.removeItem(k); } catch (e) {} },
  };
  const USR_KEY = 'isnad-usr-' + (cfg.unit || 'isnad'), REF_KEY = 'isnad-ref-' + (cfg.unit || 'isnad');
  // اسم المستخدم ورمز المرجع (يُتحقق منهما في «الحارس» مع رمز الدخول)
  const OLDW_KEY = 'isnad-oldw-' + (cfg.unit || 'isnad'); // الحارس بنسخة قديمة لا تقبل ترويستي الاسم والمرجع
  const uh = () => { if (sess.get(OLDW_KEY)) return {}; const h = {}, u = sess.get(USR_KEY), r = sess.get(REF_KEY); if (u) h['X-User'] = u; if (r) h['X-Ref'] = r; return h; };
  store.del(CODE_KEY); // رموز قديمة كانت تُحفظ دائمًا على الجهاز
  const unitCode = PROXY ? sess.get(CODE_KEY) : null;
  const token = cfg.repo ? store.get(TOKEN_KEY) || (unitCode ? 'unit:' + unitCode : null) : null;
  const isUnit = (t) => /^unit:/.test(t || '');

  // ارتفاع الجزء الظاهر فعلًا من النافذة (بعض المتصفحات تعطي 100vh أطول منه فتختفي أسفل القائمة الجانبية)
  const setAppH = () => document.documentElement.style.setProperty('--app-h', window.innerHeight + 'px');
  setAppH();
  window.addEventListener('resize', setAppH);

  let blobs = {}; // معرّف الملف ← رابطه
  window.ISNAD = { blob: (id) => blobs[id] || '' };

  // البوابة (index.html) بلا كلمة مرور؛ كل جهة لها كلمة مرورها وتُطلب في شاشة الترحيب داخل صفحتها.
  // الدخول لجهة لا يفتح غيرها (مفتاح الجلسة خاص بالجهة).
  const AUTH_KEY = 'isnad-auth-' + (cfg.unit || 'isnad');
  const ss = {
    get(k) {
      try {
        return sessionStorage.getItem(k);
      } catch (e) {
        return null;
      }
    },
    set(k, v) {
      try {
        sessionStorage.setItem(k, v);
      } catch (e) {}
    },
    del(k) {
      try {
        sessionStorage.removeItem(k);
      } catch (e) {}
    },
  };
  // كل جهة تُفتح برمزها فقط (لوحة المدير لا تفتح الجهات). عند وجود «الحارس» يكون الرمز هو رمز الجهة فيه،
  // فالجلسة القديمة التي فُتحت بكلمة المرور العامة (بلا رمز) لا تُعتمد
  const GATE = PROXY && cfg.mode !== 'server';
  // المسؤول بمفتاح GitHub المحفوظ على جهازه يدخل كل الجهات مباشرة (يُتحقق من المفتاح، وإن كان غير صالح يُطلب الرمز)
  const adminTok = cfg.repo && store.get(TOKEN_KEY);
  const signedIn = (ss.get(AUTH_KEY) === '1' && (!GATE || !!unitCode)) || (GATE && !!adminTok);
  // الصفحة تقرأ isnad-entered لتتخطى شاشة الترحيب: نضبطه حسب هذه الجهة فقط
  if (signedIn) ss.set('isnad-entered', '1');
  else ss.del('isnad-entered');
  const signOut = () => {
    ss.del(AUTH_KEY);
    ss.del('isnad-entered');
    sess.del(CODE_KEY); sess.del(USR_KEY); sess.del(REF_KEY); // الخروج يُنهي وضع التعديل برمز المركز
  };
  const toPortal = () => {
    signOut();
    location.replace('index.html');
  };
  // على الخادم لا تُطلب البيانات إلا بعد الدخول (في النسخة الثابتة تُحمّل مباشرة)
  let authed;
  const authReady = new Promise((res) => (authed = res));
  if (cfg.mode !== 'server' || signedIn) authed();
  const WEB = cfg.web || ''; // مسار بيانات الجهة في الموقع المنشور
  const DBDIR = cfg.dbDir || 'data/db'; // ومجلدها في المستودع
  // بيانات مشتركة بين كل الجهات (نماذج ومحاضر): مجموعاتها وملفات Word التي تبدأ معرّفاتها بـ shared-
  // SHARED_MIX: مجموعات لكل جهة عناصرها الخاصة، وتُضاف إليها عناصر مشتركة معرّفاتها تبدأ بـ shared- (مثل المكتبة التعليمية)
  const SHARED_DIR = 'data/shared/db', SHARED_WEB = 'shared/db/', SHARED_COLS = ['forms', 'guide', 'circulars'], SHARED_MIX = ['profiles'];
  const isShared = (id) => /^shared-/.test(id || '');
  const dirOf = (c, id) => ((c === 'files' || SHARED_MIX.includes(c) ? isShared(id) : SHARED_COLS.includes(c)) ? SHARED_DIR : DBDIR);

  // ---------- GitHub ----------
  const b64encode = (bytes) => {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const b64decode = (b64) => Uint8Array.from(atob(b64.replace(/\s/g, '')), (c) => c.charCodeAt(0));
  const utf8 = { enc: (s) => b64encode(new TextEncoder().encode(s)), dec: (b64) => new TextDecoder().decode(b64decode(b64)) };

  async function gh(path, opts = {}) {
    const t = opts.token || token;
    const r = await fetch(isUnit(t) ? PROXY + '/gh' + path : 'https://api.github.com/repos/' + cfg.repo + path, {
      ...opts,
      cache: 'no-store',
      headers: isUnit(t)
        ? { 'X-Unit': cfg.unit || 'isnad', 'X-Code': t.slice(5), ...uh(), ...(opts.headers || {}) }
        : { Authorization: 'Bearer ' + t, Accept: 'application/vnd.github+json', ...(opts.headers || {}) },
    });
    if (r.status === 401 || r.status === 403) throw { code: 'not_granted', status: r.status };
    if (r.status === 404) return null;
    if (r.status === 409 || r.status === 422) throw { code: 'conflict', status: r.status };
    if (!r.ok) throw { code: 'network', status: r.status };
    return r.status === 204 ? {} : r.json();
  }

  const q = '?ref=' + encodeURIComponent(cfg.branch || '');

  // سجل التدقيق (يقرؤه قسم الإسناد): ملفات الأحداث في فرع audit، ملف لكل حدث
  window.ISNAD_AUDIT = {
    async day(day) {
      if (!token) throw { code: 'not_granted' };
      const ls = await gh('/contents/data/audit/' + encodeURIComponent(day) + '?ref=audit');
      if (!Array.isArray(ls)) return [];
      const items = ls.filter((x) => /\.json$/.test(x.name)).slice(-400), out = [];
      for (let i = 0; i < items.length; i += 8) {
        await Promise.all(items.slice(i, i + 8).map(async (x) => {
          try { const m = await gh('/contents/' + x.path + '?ref=audit'); out.push(JSON.parse(utf8.dec(m.content))); } catch (e) {}
        }));
      }
      return out.sort((a, b) => a.t - b.t);
    },
  };

  // يعيد { sha, text } لملف في المستودع، أو null إن لم يوجد
  async function readFile(path) {
    const meta = await gh('/contents/' + path.split('/').map(encodeURIComponent).join('/') + q);
    if (!meta) return null;
    let b64 = meta.content;
    if (!b64 && meta.sha) b64 = (await gh('/git/blobs/' + meta.sha)).content; // الملفات الأكبر من 1 ميجابايت
    return { sha: meta.sha, b64 };
  }

  async function writeFile(path, b64, sha, message) {
    return gh('/contents/' + path.split('/').map(encodeURIComponent).join('/'), {
      method: 'PUT',
      body: JSON.stringify({ message, content: b64, sha: sha || undefined, branch: cfg.branch || undefined }),
    });
  }

  async function deleteFile(path, sha, message) {
    return gh('/contents/' + path.split('/').map(encodeURIComponent).join('/'), {
      method: 'DELETE',
      body: JSON.stringify({ message, sha, branch: cfg.branch || undefined }),
    });
  }

  // قائمة كل الملفات في data/blobs (قد تتجاوز حد 1000 ملف في واجهة المجلدات، لذا نستخدم شجرة git)
  async function blobTree() {
    const dir = ((await gh('/contents/data' + q)) || []).find((f) => f.name === 'blobs');
    return dir ? ((await gh('/git/trees/' + dir.sha)) || {}).tree || [] : [];
  }

  // التعديلات على الملف الواحد تُنفَّذ بالترتيب، وتُعاد المحاولة إن سبق تعديلٌ آخر
  const queues = {};
  function serial(key, fn) {
    const run = (queues[key] || Promise.resolve()).catch(() => {}).then(fn);
    queues[key] = run;
    return run;
  }

  async function withRetry(fn) {
    for (let i = 0; ; i++) {
      try {
        return await fn();
      } catch (e) {
        if (e && e.code === 'conflict' && i < 3) continue;
        throw e;
      }
    }
  }

  // يطبّق mutate على مستند واحد ويرفع النتيجة (undefined = حذف المستند)
  function commitDoc(c, id, mutate) {
    const single = c === 'files';
    const path = single ? `${dirOf(c, id)}/files/${id}.json` : `${dirOf(c, id)}/${c}.json`;
    const msg = `تعديل من الموقع: ${c}/${id}`;
    return serial(path, () =>
      withRetry(async () => {
        const cur = await readFile(path);
        if (single) {
          const next = mutate(cur ? JSON.parse(utf8.dec(cur.b64)) : undefined);
          if (next === undefined) {
            if (cur) await deleteFile(path, cur.sha, msg);
          } else await writeFile(path, utf8.enc(JSON.stringify(next)), cur && cur.sha, msg);
          return next;
        }
        const all = cur ? JSON.parse(utf8.dec(cur.b64)) : {};
        const next = mutate(all[id]);
        if (next === undefined) delete all[id];
        else all[id] = next;
        await writeFile(path, utf8.enc(JSON.stringify(all, null, 1) + '\n'), cur && cur.sha, msg);
        return next;
      })
    );
  }

  // ---------- البيانات ----------
  let dbPromise = null;
  let cols = {};

  async function loadStatic() {
    const r = await fetch(WEB + 'db.json', { cache: 'no-store' });
    if (r.status === 401) {
      // انتهت جلسة الدخول على الخادم: نعود لشاشة الدخول
      signOut();
      location.reload();
      throw new Error('unauthorized');
    }
    if (!r.ok) throw new Error(r.status);
    return r.json();
  }

  // للمسؤول: أحدث نسخة من المستودع (ملفات db.json المنشورة قد تتأخر دقيقة أو دقيقتين بعد كل حفظ)
  async function loadFromGitHub() {
    const [pub, list, tree] = await Promise.all([
      loadStatic().catch(() => ({})),
      gh('/contents/' + DBDIR + q),
      blobTree(),
    ]);
    const collections = {};
    await Promise.all(
      (list || [])
        .filter((f) => f.type === 'file' && f.name.endsWith('.json'))
        .map(async (f) => {
          const file = await readFile(DBDIR + '/' + f.name);
          collections[f.name.slice(0, -5)] = JSON.parse(utf8.dec(file.b64));
        })
    );
    await Promise.all(
      [...SHARED_COLS, ...SHARED_MIX].map(async (c) => {
        const file = await readFile(`${SHARED_DIR}/${c}.json`);
        const data = file ? JSON.parse(utf8.dec(file.b64)) : {};
        collections[c] = SHARED_MIX.includes(c) ? Object.assign({}, collections[c], data) : data;
      })
    );
    const map = Object.assign({}, pub.blobs || {});
    for (const t of tree) {
      const id = t.path.split('.')[0];
      if (!map[id]) map[id] = `https://raw.githubusercontent.com/${cfg.repo}/${cfg.branch}/data/blobs/${t.path}`;
    }
    return { collections, blobs: map };
  }

  function loadDb() {
    if (!dbPromise) {
      dbPromise = authReady
        // مدير المركز: إن تعذّر التحقق أو القراءة عبر الحارس تُعرض البيانات المنشورة للاطلاع بدل صفحة الخطأ
        .then(() => (!token ? loadStatic() : isUnit(token) ? userReady.then((m) => (m ? loadFromGitHub() : loadStatic())).catch(() => loadStatic()) : loadFromGitHub()))
        .then((d) => {
          blobs = d.blobs || {};
          cols = d.collections || {};
          return cols;
        });
    }
    return dbPromise;
  }

  const snap = (id, data) => ({ id, exists: data !== undefined, data: () => data });
  const readOnly = () => Promise.reject({ code: 'not_granted' });

  // المستمعون (onSnapshot) يُبلَّغون بعد كل حفظ لتُحدَّث الصفحة
  const listeners = { col: {}, doc: {} };
  const listen = (bucket, key, fn) => {
    (bucket[key] = bucket[key] || new Set()).add(fn);
    return () => bucket[key].delete(fn);
  };
  const colSnap = (c) => ({ docs: Object.entries(cols[c] || {}).map(([id, v]) => snap(id, v)) });
  function notify(c, id) {
    (listeners.col[c] || []).forEach((fn) => fn(colSnap(c)));
    (listeners.doc[c + '/' + id] || []).forEach((fn) => fn(snap(id, (cols[c] || {})[id])));
  }

  async function write(c, id, mutate) {
    if (!token) throw { code: 'not_granted' };
    const next = await commitDoc(c, id, mutate);
    if (c !== 'files') {
      cols[c] = cols[c] || {};
      if (next === undefined) delete cols[c][id];
      else cols[c][id] = next;
      notify(c, id);
    }
  }

  const clone = (o) => JSON.parse(JSON.stringify(o));
  const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => (b % 36).toString(36)).join('');

  function doc(path) {
    const [c, id] = path.split('/');
    const read = async () => {
      if (c === 'files') {
        if (token) {
          const f = await readFile(`${dirOf(c, id)}/files/${id}.json`);
          return snap(id, f ? JSON.parse(utf8.dec(f.b64)) : undefined);
        }
        const r = await fetch((/^shared-/.test(id) ? SHARED_WEB : WEB + 'db/') + 'files/' + encodeURIComponent(id) + '.json');
        return snap(id, r.ok ? await r.json() : undefined);
      }
      return snap(id, ((await loadDb())[c] || {})[id]);
    };
    return {
      id,
      get: read,
      onSnapshot(cb, err) {
        read().then(cb, err || (() => {}));
        return c === 'files' ? () => {} : listen(listeners.doc, path, cb);
      },
      set: token ? (data) => write(c, id, () => clone(data)) : readOnly,
      update: token
        ? (patch) =>
            write(c, id, (cur) => {
              if (cur === undefined) throw { code: 'not_found' };
              return Object.assign({}, cur, clone(patch));
            })
        : readOnly,
      delete: token ? () => write(c, id, () => undefined) : readOnly,
    };
  }

  function collection(c) {
    return {
      doc: (id) => doc(c + '/' + (id || newId())),
      add: token ? (data) => { const id = newId(); return write(c, id, () => clone(data)).then(() => doc(c + '/' + id)); } : readOnly,
      onSnapshot(cb, err) {
        loadDb().then(() => cb(colSnap(c)), err || (() => {}));
        return listen(listeners.col, c, cb);
      },
    };
  }

  const db = { doc, collection };

  // ---------- الملفات (صور و PDF) ----------
  const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'application/pdf': 'pdf' };
  const assets = {
    async upload(file, { type } = {}) {
      const ext = EXT[type || file.type];
      if (!ext) throw { code: 'unsupported_type' };
      if (file.size > 20 * 1024 * 1024) throw { code: 'too_large' };
      const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
      const bytes = new Uint8Array(await file.arrayBuffer());
      await writeFile(`data/blobs/${id}.${ext}`, b64encode(bytes), null, `رفع ملف من الموقع: ${file.name}`);
      blobs[id] = URL.createObjectURL(file); // يظهر فورًا قبل اكتمال إعادة النشر
      return { id };
    },
    async delete(id) {
      const t = (await blobTree()).find((x) => x.path.split('.')[0] === id);
      if (t) await deleteFile('data/blobs/' + t.path, t.sha, `حذف ملف من الموقع: ${id}`);
    },
  };

  let me = null;
  const user = {
    async me() {
      return me;
    },
  };

  const downloads = {
    async save({ filename, data }) {
      const url = URL.createObjectURL(data);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    },
  };

  // مفتاح GitHub: نحذف المسافات والعلامات المخفية (مثل علامات الاتجاه) التي تُنسخ معه فتُفسد الطلب
  const cleanTok = (v) => String(v || '').replace(/[^\x21-\x7E]/g, '');
  const ghErr = (x) => 'تعذّر الاتصال بـ GitHub. حاول مجددًا.' + (x && (x.status || x.message) ? ` (التفاصيل: ${String(x.status || x.message).slice(0, 80)})` : '');
  // يتحقق من المفتاح ويعيد بيانات صاحبه إن كان له صلاحية الكتابة على المستودع
  async function checkToken(t) {
    if (isUnit(t)) {
      const r = await fetch(PROXY + '/check', { method: 'POST', cache: 'no-store', headers: { 'X-Unit': cfg.unit || 'isnad', 'X-Code': t.slice(5), ...uh() } });
      if (r.status === 401) throw { code: 'not_granted' };
      if (!r.ok) throw { code: 'network' };
      // الرمز صحيح؛ نتأكد أن مفتاح GitHub المحفوظ في الحارس يعمل وله صلاحية الكتابة
      let repo = null;
      try {
        repo = await gh('', { token: t });
      } catch (e) {
        if (e && e.code === 'not_granted') throw { code: 'ghkey', status: e.status };
        throw e;
      }
      if (!repo || !repo.permissions || !repo.permissions.push) throw { code: 'ghkey', status: repo ? 'no-push' : 404 };
      return { name: 'مدير ' + (cfg.unitName || 'المركز'), avatarUrl: '', canEdit: true, unitEditor: true };
    }
    const [repo, u] = await Promise.all([
      gh('', { token: t }),
      fetch('https://api.github.com/user', { cache: 'no-store', headers: { Authorization: 'Bearer ' + t } }).then((r) => (r.ok ? r.json() : null)),
    ]);
    if (!repo || !repo.permissions || !repo.permissions.push) throw { code: 'not_granted' };
    return { name: (u && (u.name || u.login)) || 'المسؤول', avatarUrl: (u && u.avatar_url) || '', canEdit: true };
  }

  let userReady = Promise.resolve(null);
  let unitErr = null;
  if (token) {
    userReady = checkToken(token).then(
      (m) => (me = m),
      (e) => {
        unitErr = e;
        if (e && e.code === 'not_granted') isUnit(token) ? sess.del(CODE_KEY) : store.del(TOKEN_KEY); // مفتاح أو رمز منتهٍ أو بلا صلاحية
        if (e && e.code === 'not_granted' && GATE && !isUnit(token) && !unitCode) {
          signOut();
          location.reload();
        }
        return null;
      }
    );
  }

  window.claude = {
    use(name) {
      if (name === 'db') return loadDb().then(() => db);
      if (name === 'downloads') return Promise.resolve(downloads);
      if (name === 'user') return userReady.then((m) => (m ? user : Promise.reject(new Error('view only'))));
      if (name === 'assets') return userReady.then((m) => (m ? assets : Promise.reject(new Error('view only'))));
      return Promise.reject(new Error('unavailable'));
    },
  };

  // ---------- شاشة الترحيب: كلمة مرور هذه الجهة ----------
  const field = 'width:100%;padding:12px 14px;border-radius:10px;border:1.5px solid var(--line);background:var(--surface-2);font-size:15px;outline:none';
  const enter = document.getElementById('enter');
  if (enter) {
    const box = document.createElement('div');
    box.style.cssText = 'width:100%;margin-top:18px;text-align:start';
    const lbl = 'display:block;font-size:13px;font-weight:700;color:var(--muted);margin:10px 0 6px';
    box.innerHTML =
      (GATE ? `<label for="isnadUsr" style="${lbl};margin-top:0">اسم المستخدم</label><input id="isnadUsr" type="text" autocomplete="username" autocapitalize="off" spellcheck="false" dir="ltr" placeholder="اسم المستخدم" style="${field}">` : '') +
      `<label for="isnadPw" style="${lbl}">${GATE ? 'كلمة المرور' : 'كلمة المرور'}</label>` +
      `<input id="isnadPw" type="password" autocomplete="current-password" placeholder="أدخل ${GATE ? 'رمز' : 'كلمة مرور'} ${String(cfg.unitName || '').replace(/[<>&"]/g, '')}" style="${field}">` +
      (GATE ? `<label for="isnadRef" style="${lbl}">رمز المرجع</label><input id="isnadRef" type="password" inputmode="numeric" autocomplete="off" dir="ltr" placeholder="رمز المرجع" style="${field}">` : '') +
      '<div id="isnadPwErr" role="alert" style="display:none;margin-top:8px;color:var(--danger);font-size:13.5px;font-weight:600"></div>';
    enter.before(box);
    const back = document.createElement('a');
    back.href = 'index.html';
    back.textContent = '→ الرجوع للقائمة الرئيسية';
    back.style.cssText = 'margin-top:14px;font-size:13px;font-weight:700;color:var(--accent);text-decoration:none';
    enter.after(back);
    if (GATE && cfg.repo) {
      // للمسؤول: مفتاح GitHub يُحفظ على هذا الجهاز ويفتح كل المراكز والأقسام ولوحة المدير مع التعديل
      const gbox = document.createElement('div');
      gbox.style.cssText = 'width:100%;margin-top:12px;text-align:start';
      gbox.innerHTML =
        '<button type="button" data-g="show" style="background:none;border:0;padding:0;color:var(--muted);font:inherit;font-size:12.5px;font-weight:700;cursor:pointer;text-decoration:underline">للمسؤول: الدخول بمفتاح GitHub</button>' +
        `<div data-g="box" hidden style="margin-top:8px"><input data-g="tok" type="password" autocomplete="off" placeholder="github_pat_…" dir="ltr" style="${field}">` +
        '<div data-g="err" role="alert" style="display:none;margin-top:8px;color:var(--danger);font-size:13.5px;font-weight:600"></div>' +
        '<button type="button" data-g="save" class="btn" style="width:100%;margin-top:8px">دخول بالمفتاح</button></div>';
      back.before(gbox);
      gbox.addEventListener('click', async (e) => {
        const g = e.target.dataset && e.target.dataset.g;
        if (g === 'show') {
          gbox.querySelector('[data-g="box"]').hidden = false;
          gbox.querySelector('[data-g="tok"]').focus();
        } else if (g === 'save') {
          const t = cleanTok(gbox.querySelector('[data-g="tok"]').value), m = gbox.querySelector('[data-g="err"]');
          m.style.display = 'none';
          if (!t) return;
          e.target.disabled = true;
          try {
            await checkToken(t);
            store.set(TOKEN_KEY, t);
            location.reload();
          } catch (x) {
            m.textContent = x && x.code === 'not_granted' ? 'المفتاح غير صحيح أو ليس له صلاحية الكتابة على المستودع.' : ghErr(x);
            m.style.display = 'block';
            e.target.disabled = false;
          }
        }
      });
    }
    const input = box.querySelector('#isnadPw'), usrIn = box.querySelector('#isnadUsr'), refIn = box.querySelector('#isnadRef');
    const err = box.querySelector('#isnadPwErr');
    let passed = false;
    const check = async (pw) => {
      if (cfg.mode === 'server') {
        const r = await fetch('api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw, unit: cfg.unit }) });
        return r.ok;
      }
      const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('isnad:' + pw));
      return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('') === cfg.hash;
    };
    // يعمل قبل مستمع الصفحة على زر «دخول»، ولا يسمح بالمرور إلا بعد التحقق
    enter.addEventListener('click', async (e) => {
      if (passed) return;
      e.stopImmediatePropagation();
      err.style.display = 'none';
      if (usrIn && !usrIn.value.trim()) { err.textContent = 'الرجاء إدخال اسم المستخدم'; err.style.display = 'block'; usrIn.focus(); return; }
      if (refIn && !refIn.value.trim()) { err.textContent = 'الرجاء إدخال رمز المرجع'; err.style.display = 'block'; refIn.focus(); return; }
      if (!input.value) {
        err.textContent = 'الرجاء إدخال كلمة المرور';
        err.style.display = 'block';
        input.focus();
        return;
      }
      if (GATE) {
        const u0 = cleanCred(usrIn ? usrIn.value : ''), r0 = cleanCred(refIn ? refIn.value : ''), p0 = cleanCred(input.value);
        if ((usrIn && !asciiOk(u0)) || (refIn && !asciiOk(r0)) || !asciiOk(p0)) {
          err.textContent = 'اكتب البيانات بالأحرف والأرقام الإنجليزية فقط (غيّر لغة لوحة المفاتيح) وبدون مسافات.';
          err.style.display = 'block';
          return;
        }
        input.value = p0; if (usrIn) usrIn.value = u0; if (refIn) refIn.value = r0;
      }
      enter.disabled = true;
      let ok = false, editCode = false, netErr = false;
      if (GATE) {
        // الدخول برمز الجهة في «الحارس» فقط (أو الرمز العام للمسؤول)، ويفتح وضع التعديل مباشرة
        try {
          let r;
          sess.del(OLDW_KEY);
          try {
            r = await fetch(PROXY + '/check?login=1', { method: 'POST', cache: 'no-store', headers: { 'X-Unit': cfg.unit || 'isnad', 'X-Code': input.value, 'X-User': usrIn ? usrIn.value.trim() : '', 'X-Ref': refIn ? refIn.value.trim() : '' } });
          } catch (x0) {
            // نسخة الحارس المنشورة قديمة (ترفض الترويسات الجديدة): نتحقق بالرمز وحده
            r = await fetch(PROXY + '/check', { method: 'POST', cache: 'no-store', headers: { 'X-Unit': cfg.unit || 'isnad', 'X-Code': input.value } });
            if (r.ok) { sess.set(OLDW_KEY, '1'); console.warn('الحارس يحتاج تحديث الكود (Edit code ← Deploy)'); }
          }
          ok = editCode = r.ok;
          netErr = !r.ok && r.status !== 401;
        } catch (x) {
          netErr = true;
        }
      } else {
        try {
          ok = await check(input.value);
        } catch (x) {}
      }
      enter.disabled = false;
      if (netErr) {
        err.textContent = 'تعذّر التحقق من الرمز الآن. تأكد من اتصال الإنترنت وحاول مرة أخرى.';
        err.style.display = 'block';
        return;
      }
      if (editCode) {
        // رمز تعديل هذا المركز: دخول مع وضع التعديل على هذا المركز فقط
        ss.set(AUTH_KEY, '1');
        ss.set('isnad-entered', '1');
        sess.set(CODE_KEY, input.value);
        if (usrIn) { sess.set(USR_KEY, usrIn.value.trim()); sess.set(REF_KEY, refIn.value.trim()); }
        location.reload();
        return;
      }
      if (!ok) {
        err.textContent = GATE ? 'بيانات الدخول غير صحيحة' : 'كلمة المرور غير صحيحة';
        err.style.display = 'block';
        input.select();
        return;
      }
      ss.set(AUTH_KEY, '1');
      authed();
      passed = true;
      input.value = '';
      enter.click();
      passed = false;
    });
    [input, usrIn, refIn].forEach((el) => el && el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') enter.click();
    }));
  }


  // زر «إظهار/إخفاء» داخل كل خانة كلمة مرور أو رمز، ليتأكد المستخدم مما يكتبه
  (function () {
    const EYE = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>';
    const NOEYE = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 3l18 18"/><path d="M10.6 5.1A10.4 10.4 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6A17.4 17.4 0 0 0 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';
    const add = (inp) => {
      if (inp.dataset.eye) return;
      inp.dataset.eye = '1';
      const w = document.createElement('span');
      w.style.cssText = 'position:relative;display:block;width:100%';
      inp.parentNode.insertBefore(w, inp);
      w.appendChild(inp);
      inp.style.paddingLeft = '44px';
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('aria-label', 'إظهار ما كُتب');
      b.title = 'إظهار / إخفاء';
      b.innerHTML = EYE;
      b.style.cssText = 'position:absolute;top:50%;transform:translateY(-50%);left:6px;width:34px;height:34px;display:flex;align-items:center;justify-content:center;border:0;border-radius:8px;background:transparent;color:var(--muted,#555);cursor:pointer;padding:0';
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', () => {
        const show = inp.type === 'password';
        inp.type = show ? 'text' : 'password';
        b.innerHTML = show ? NOEYE : EYE;
        b.setAttribute('aria-label', show ? 'إخفاء ما كُتب' : 'إظهار ما كُتب');
        inp.focus();
      });
      w.appendChild(b);
    };
    const scan = () => document.querySelectorAll('input[type="password"]').forEach(add);
    scan();
    new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
  })();

  // ---------- القائمة الجانبية: زر القائمة الرئيسية، وتسجيل الخروج يرجع للبوابة ----------
  document.addEventListener(
    'click',
    (e) => {
      if (!e.target.closest('[data-act="logout"]')) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      if (cfg.mode === 'server') fetch('logout', { method: 'POST' });
      toPortal();
    },
    true
  );
  const logout = document.querySelector('.side-foot [data-act="logout"]');
  // زر «القائمة الرئيسية» تحت الشعار أعلى القائمة الجانبية: ظاهر دائمًا داخل أي قسم أو مركز
  const brand = document.querySelector('.side .brand');
  if (brand) {
    const home = document.createElement('a');
    home.className = 'isnad-home';
    home.href = 'index.html';
    home.innerHTML =
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 9.5 12 3l9 6.5"/><path d="M5 9v11h14V9"/></svg>' +
      '<span>القائمة الرئيسية</span>';
    brand.after(home);
    // زر «تحديث» لجلب أحدث نسخة من الموقع والبيانات (يتجاوز النسخة المخزّنة في المتصفح)
    const rf = document.createElement('button');
    rf.type = 'button';
    rf.className = 'isnad-home isnad-refresh';
    rf.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/></svg><span>تحديث</span>';
    rf.addEventListener('click', () => {
      rf.disabled = true;
      rf.querySelector('span').textContent = 'جارٍ التحديث…';
      Promise.all([fetch(location.href, { cache: 'reload' }), fetch('version.json', { cache: 'reload' }), fetch('db.json', { cache: 'reload' })].map((p) => p.catch(() => null))).then(() => location.reload());
    });
    home.after(rf);
    const css = document.createElement('style');
    css.textContent =
      '.isnad-home{display:flex;align-items:center;justify-content:center;gap:8px;padding:9px 12px;border-radius:10px;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.18);color:#fff;font-weight:700;font-size:13.5px;text-decoration:none;flex-shrink:0}' +
      '.isnad-refresh{cursor:pointer;font-family:inherit;margin-top:6px;width:100%}.isnad-home:hover{background:rgba(255,255,255,.18)}.isnad-home:focus-visible{outline:2px solid #4FBE8E;outline-offset:2px}' +
      '@media (max-width:860px){.isnad-home{padding:7px 10px;font-size:12.5px}}';
    document.head.appendChild(css);
  }

  if (!cfg.repo) return;
  const link = 'all:unset;cursor:pointer;color:var(--accent);font-weight:700';

  // لوحة تفعيل التعديل (تفتح في نافذة من زر القائمة الجانبية)
  function adminPanel(open) {
    const el = document.createElement('div');
    el.style.cssText = 'width:100%;font-size:13px;text-align:start';
    if (token) {
      el.innerHTML =
        `<span data-r="on" style="color:var(--ok);font-weight:700">${isUnit(token) ? 'التعديل على ' + (cfg.unitName || 'المركز') + ' مفعّل على هذا الجهاز' : 'وضع التعديل مفعّل على هذا الجهاز'}</span> · ` +
        `<button type="button" data-r="off" style="${link}">إيقاف التعديل</button>`;
      userReady.then((m) => {
        if (!m) el.querySelector('[data-r="on"]').textContent = isUnit(token) ? 'تعذّر التعديل: ' + (unitErr && unitErr.code === 'ghkey' ? 'مفتاح GitHub المحفوظ في الحارس (GITHUB_TOKEN) لا يعمل أو ليس له صلاحية الكتابة (' + unitErr.status + ').' : 'تعذّر التحقق من رمز المركز.') + ' أوقف التعديل ثم أعد المحاولة.' : 'تعذّر التحقق من مفتاح GitHub. أوقف التعديل ثم أدخل مفتاحًا جديدًا.';
      });
    } else {
      el.innerHTML =
        (open ? '' : `<button type="button" data-r="show" style="${link}">تفعيل التعديل (للمسؤول)</button>`) +
        (PROXY
          ? `<div data-r="ubox"${open ? '' : ' hidden'} style="margin-top:${open ? 0 : 10}px">` +
            `<label style="display:block;font-size:13px;font-weight:700;color:var(--muted);margin-bottom:6px">رمز تعديل ${String(cfg.unitName || 'المركز').replace(/[<>&"]/g, '')}` +
            `<input data-r="code" type="password" autocomplete="off" dir="ltr" style="${field};margin-top:6px;font-weight:400"></label>` +
            '<div style="margin-top:6px;color:var(--faint);font-size:12px;line-height:1.6">لمدير المركز: يسمح بالتعديل على هذا المركز فقط، ويُحفظ على هذا الجهاز.</div>' +
            '<div data-r="uerr" role="alert" style="display:none;margin-top:8px;color:var(--danger);font-size:13.5px;font-weight:600"></div>' +
            '<button type="button" data-r="usave" class="btn primary" style="width:100%;margin-top:10px">تفعيل التعديل</button>' +
            `<button type="button" data-r="gh" style="${link};display:block;margin-top:14px;font-size:12.5px">للمسؤول: الدخول بمفتاح GitHub</button></div>`
          : '') +
        `<div data-r="box"${open && !PROXY ? '' : ' hidden'} style="margin-top:${open && !PROXY ? 0 : 10}px">` +
        '<label style="display:block;font-size:13px;font-weight:700;color:var(--muted);margin-bottom:6px">مفتاح GitHub' +
        `<input data-r="tok" type="password" autocomplete="off" placeholder="github_pat_…" dir="ltr" style="${field};margin-top:6px;font-weight:400"></label>` +
        '<div style="margin-top:6px;color:var(--faint);font-size:12px;line-height:1.6">يُحفظ على هذا الجهاز فقط. أنشئه من GitHub: Settings ← Developer settings ← Fine-grained tokens، لمستودع ' +
        cfg.repo +
        ' بصلاحية Contents: Read and write.</div>' +
        '<div data-r="err" role="alert" style="display:none;margin-top:8px;color:var(--danger);font-size:13.5px;font-weight:600"></div>' +
        '<button type="button" data-r="save" class="btn primary" style="width:100%;margin-top:10px">حفظ المفتاح</button></div>';
    }
    el.addEventListener('click', async (e) => {
      const r = e.target.dataset && e.target.dataset.r;
      if (r === 'off') {
        store.del(TOKEN_KEY);
        sess.del(CODE_KEY);
        location.reload();
      } else if (r === 'gh') {
        el.querySelector('[data-r="box"]').hidden = false;
        el.querySelector('[data-r="tok"]').focus();
      } else if (r === 'usave') {
        const c = el.querySelector('[data-r="code"]').value.trim();
        const msg = el.querySelector('[data-r="uerr"]');
        msg.style.display = 'none';
        if (!c) return;
        e.target.disabled = true;
        try {
          await checkToken('unit:' + c);
          sess.set(CODE_KEY, c);
          location.reload();
        } catch (x) {
          msg.textContent =
            x && x.code === 'not_granted'
              ? 'رمز المركز غير صحيح.'
              : x && x.code === 'ghkey'
                ? 'الرمز صحيح، لكن مفتاح GitHub المحفوظ في الحارس (GITHUB_TOKEN) لا يعمل أو ليس له صلاحية الكتابة على المستودع (' + x.status + ').'
                : 'تعذّر الاتصال بالحارس. حاول مجددًا.';
          msg.style.display = 'block';
          e.target.disabled = false;
        }
      } else if (r === 'show') {
        const b = el.querySelector(PROXY ? '[data-r="ubox"]' : '[data-r="box"]');
        b.hidden = false;
        b.querySelector('input').focus();
      } else if (r === 'save') {
        const t = cleanTok(el.querySelector('[data-r="tok"]').value);
        const msg = el.querySelector('[data-r="err"]');
        msg.style.display = 'none';
        e.target.disabled = true;
        try {
          await checkToken(t);
          store.set(TOKEN_KEY, t);
          location.reload();
        } catch (x) {
          msg.textContent = x && x.code === 'not_granted' ? 'المفتاح غير صحيح أو ليس له صلاحية الكتابة على المستودع.' : ghErr(x);
          msg.style.display = 'block';
          e.target.disabled = false;
        }
      }
    });
    return el;
  }

  // زر في القائمة الجانبية (فوق «تسجيل الخروج») يفتح لوحة تفعيل التعديل في نافذة
  if (!logout) return;
  const sideBtn = document.createElement('button');
  sideBtn.type = 'button';
  sideBtn.className = 'logout';
  sideBtn.innerHTML =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4z"/></svg>' +
    `<span>${token ? 'وضع التعديل' : 'تفعيل التعديل'}</span>`;
  logout.before(sideBtn);

  const dlg = document.createElement('div');
  dlg.className = 'modal';
  dlg.hidden = true;
  dlg.innerHTML = '<div class="mbox" role="dialog" aria-modal="true" aria-labelledby="isnadAdminT"><h2 id="isnadAdminT">تفعيل التعديل</h2></div>';
  const mbox = dlg.firstChild;
  mbox.appendChild(adminPanel(true));
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'btn';
  close.style.cssText = 'width:100%;margin-top:10px';
  close.textContent = 'إغلاق';
  mbox.appendChild(close);
  document.body.appendChild(dlg);
  const hide = () => {
    dlg.hidden = true;
    sideBtn.focus();
  };
  sideBtn.addEventListener('click', () => {
    dlg.hidden = false;
    (mbox.querySelector('input') || close).focus();
  });
  close.addEventListener('click', hide);
  dlg.addEventListener('mousedown', (e) => {
    if (e.target === dlg) hide();
  });
  dlg.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hide();
  });
})();
