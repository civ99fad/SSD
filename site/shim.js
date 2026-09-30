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
  const token = cfg.repo ? store.get(TOKEN_KEY) : null;

  // ارتفاع الجزء الظاهر فعلًا من النافذة (بعض المتصفحات تعطي 100vh أطول منه فتختفي أسفل القائمة الجانبية)
  const setAppH = () => document.documentElement.style.setProperty('--app-h', window.innerHeight + 'px');
  setAppH();
  window.addEventListener('resize', setAppH);

  let blobs = {}; // معرّف الملف ← رابطه
  window.ISNAD = { blob: (id) => blobs[id] || '' };

  // الدخول بكلمة المرور يتم من البوابة (index.html)، ومنها يختار الجهة؛ بدونه نرجع للبوابة
  const toPortal = () => {
    try {
      sessionStorage.removeItem('isnad-auth');
      sessionStorage.removeItem('isnad-entered');
    } catch (e) {}
    location.replace('index.html');
  };
  let signedIn = false;
  try {
    signedIn = sessionStorage.getItem('isnad-auth') === '1';
    if (signedIn) sessionStorage.setItem('isnad-entered', '1'); // تخطّي شاشة الترحيب داخل الصفحة
  } catch (e) {}
  if (!signedIn) {
    document.documentElement.style.visibility = 'hidden';
    location.replace('index.html');
    return;
  }
  const WEB = cfg.web || ''; // مسار بيانات الجهة في الموقع المنشور
  const DBDIR = cfg.dbDir || 'data/db'; // ومجلدها في المستودع

  // ---------- GitHub ----------
  const b64encode = (bytes) => {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const b64decode = (b64) => Uint8Array.from(atob(b64.replace(/\s/g, '')), (c) => c.charCodeAt(0));
  const utf8 = { enc: (s) => b64encode(new TextEncoder().encode(s)), dec: (b64) => new TextDecoder().decode(b64decode(b64)) };

  async function gh(path, opts = {}) {
    const r = await fetch('https://api.github.com/repos/' + cfg.repo + path, {
      ...opts,
      cache: 'no-store',
      headers: { Authorization: 'Bearer ' + (opts.token || token), Accept: 'application/vnd.github+json', ...(opts.headers || {}) },
    });
    if (r.status === 401 || r.status === 403) throw { code: 'not_granted', status: r.status };
    if (r.status === 404) return null;
    if (r.status === 409 || r.status === 422) throw { code: 'conflict', status: r.status };
    if (!r.ok) throw { code: 'network', status: r.status };
    return r.status === 204 ? {} : r.json();
  }

  const q = '?ref=' + encodeURIComponent(cfg.branch || '');

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
    const path = single ? `${DBDIR}/files/${id}.json` : `${DBDIR}/${c}.json`;
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
      // انتهت جلسة الدخول على الخادم: نعود للبوابة
      toPortal();
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
    const map = Object.assign({}, pub.blobs || {});
    for (const t of tree) {
      const id = t.path.split('.')[0];
      if (!map[id]) map[id] = `https://raw.githubusercontent.com/${cfg.repo}/${cfg.branch}/data/blobs/${t.path}`;
    }
    return { collections, blobs: map };
  }

  function loadDb() {
    if (!dbPromise) {
      dbPromise = (token ? loadFromGitHub() : loadStatic())
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
          const f = await readFile(`${DBDIR}/files/${id}.json`);
          return snap(id, f ? JSON.parse(utf8.dec(f.b64)) : undefined);
        }
        const r = await fetch(WEB + 'db/files/' + encodeURIComponent(id) + '.json');
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

  // يتحقق من المفتاح ويعيد بيانات صاحبه إن كان له صلاحية الكتابة على المستودع
  async function checkToken(t) {
    const [repo, u] = await Promise.all([
      gh('', { token: t }),
      fetch('https://api.github.com/user', { cache: 'no-store', headers: { Authorization: 'Bearer ' + t } }).then((r) => (r.ok ? r.json() : null)),
    ]);
    if (!repo || !repo.permissions || !repo.permissions.push) throw { code: 'not_granted' };
    return { name: (u && (u.name || u.login)) || 'المسؤول', avatarUrl: (u && u.avatar_url) || '', canEdit: true };
  }

  let userReady = Promise.resolve(null);
  if (token) {
    userReady = checkToken(token).then(
      (m) => (me = m),
      (e) => {
        if (e && e.code === 'not_granted') store.del(TOKEN_KEY); // مفتاح منتهٍ أو بلا صلاحية
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

  // ---------- القائمة الجانبية: الرجوع للبوابة، وتسجيل الخروج يرجع للبوابة ----------
  const field = 'width:100%;padding:12px 14px;border-radius:10px;border:1.5px solid var(--line);background:var(--surface-2);font-size:15px;outline:none';
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
  if (logout) {
    const home = document.createElement('a');
    home.className = 'logout';
    home.href = 'index.html';
    home.innerHTML =
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 9.5 12 3l9 6.5"/><path d="M5 9v11h14V9"/></svg>' +
      '<span>البوابة (اختيار الجهة)</span>';
    logout.before(home);
  }

  if (!cfg.repo) return;
  const link = 'all:unset;cursor:pointer;color:var(--accent);font-weight:700';

  // لوحة تفعيل التعديل (تفتح في نافذة من زر القائمة الجانبية)
  function adminPanel(open) {
    const el = document.createElement('div');
    el.style.cssText = 'width:100%;font-size:13px;text-align:start';
    if (token) {
      el.innerHTML =
        `<span data-r="on" style="color:var(--ok);font-weight:700">وضع التعديل مفعّل على هذا الجهاز</span> · ` +
        `<button type="button" data-r="off" style="${link}">إيقاف التعديل</button>`;
      userReady.then((m) => {
        if (!m) el.querySelector('[data-r="on"]').textContent = 'تعذّر التحقق من مفتاح GitHub. أوقف التعديل ثم أدخل مفتاحًا جديدًا.';
      });
    } else {
      el.innerHTML =
        (open ? '' : `<button type="button" data-r="show" style="${link}">تفعيل التعديل (للمسؤول)</button>`) +
        `<div data-r="box"${open ? '' : ' hidden'} style="margin-top:${open ? 0 : 10}px">` +
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
        location.reload();
      } else if (r === 'show') {
        el.querySelector('[data-r="box"]').hidden = false;
        el.querySelector('[data-r="tok"]').focus();
      } else if (r === 'save') {
        const t = el.querySelector('[data-r="tok"]').value.trim();
        const msg = el.querySelector('[data-r="err"]');
        msg.style.display = 'none';
        e.target.disabled = true;
        try {
          await checkToken(t);
          store.set(TOKEN_KEY, t);
          location.reload();
        } catch (x) {
          msg.textContent = x && x.code === 'not_granted' ? 'المفتاح غير صحيح أو ليس له صلاحية الكتابة على المستودع.' : 'تعذّر الاتصال بـ GitHub. حاول مجددًا.';
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
