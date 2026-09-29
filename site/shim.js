// يشغّل صفحة موقع Claude (page.html) خارج Claude: يوفّر window.claude.use('db' | 'user' | 'assets' | 'downloads')
// بنفس الواجهة التي تستخدمها الصفحة، ويضيف خانة كلمة المرور لشاشة الدخول.
// - للفريق: البيانات تُقرأ من ملفات ثابتة (db.json و blobs/) والموقع للعرض فقط.
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

  let blobs = {}; // معرّف الملف ← رابطه
  window.ISNAD = { blob: (id) => blobs[id] || '' };

  // على الخادم لا تُطلب البيانات إلا بعد الدخول (في النسخة الثابتة تُحمّل مباشرة)
  let entered = false;
  try {
    entered = sessionStorage.getItem('isnad-entered') === '1';
  } catch (e) {}
  let authed;
  const authReady = new Promise((res) => (authed = res));
  if (cfg.mode !== 'server' || entered) authed();

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
    const path = single ? `data/db/files/${id}.json` : `data/db/${c}.json`;
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
    const r = await fetch('db.json', { cache: 'no-store' });
    if (r.status === 401) {
      // انتهت جلسة الدخول على الخادم: نعود لشاشة الدخول
      try {
        sessionStorage.removeItem('isnad-entered');
      } catch (e) {}
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
      gh('/contents/data/db' + q),
      blobTree(),
    ]);
    const collections = {};
    await Promise.all(
      (list || [])
        .filter((f) => f.type === 'file' && f.name.endsWith('.json'))
        .map(async (f) => {
          const file = await readFile('data/db/' + f.name);
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
      dbPromise = authReady
        .then(() => (token ? loadFromGitHub() : loadStatic()))
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
          const f = await readFile(`data/db/files/${id}.json`);
          return snap(id, f ? JSON.parse(utf8.dec(f.b64)) : undefined);
        }
        const r = await fetch('db/files/' + encodeURIComponent(id) + '.json');
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

  // ---------- شاشة الدخول: كلمة المرور + تفعيل التعديل ----------
  const enter = document.getElementById('enter');
  if (!enter) return;
  const field = 'width:100%;padding:12px 14px;border-radius:10px;border:1.5px solid var(--line);background:var(--surface-2);font-size:15px;outline:none';
  const box = document.createElement('div');
  box.style.cssText = 'width:100%;margin-top:18px;text-align:start';
  box.innerHTML =
    '<label for="isnadPw" style="display:block;font-size:13px;font-weight:700;color:var(--muted);margin-bottom:6px">كلمة المرور</label>' +
    `<input id="isnadPw" type="password" autocomplete="current-password" placeholder="أدخل كلمة المرور" style="${field}">` +
    '<div id="isnadPwErr" role="alert" style="display:none;margin-top:8px;color:var(--danger);font-size:13.5px;font-weight:600"></div>';
  enter.before(box);
  const input = box.querySelector('input');
  const err = box.querySelector('#isnadPwErr');
  let passed = false;

  async function check(pw) {
    if (cfg.mode === 'server') {
      const r = await fetch('api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pw }),
      });
      return r.ok;
    }
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('isnad:' + pw));
    return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('') === cfg.hash;
  }

  // يعمل قبل مستمع الصفحة على زر «دخول»، ولا يسمح بالمرور إلا بعد التحقق
  enter.addEventListener('click', async (e) => {
    if (passed) return;
    e.stopImmediatePropagation();
    err.style.display = 'none';
    if (!input.value) {
      err.textContent = 'الرجاء إدخال كلمة المرور';
      err.style.display = 'block';
      input.focus();
      return;
    }
    enter.disabled = true;
    let ok = false;
    try {
      ok = await check(input.value);
    } catch (x) {}
    enter.disabled = false;
    if (!ok) {
      err.textContent = 'كلمة المرور غير صحيحة';
      err.style.display = 'block';
      input.select();
      return;
    }
    authed();
    passed = true;
    input.value = '';
    enter.click();
    passed = false;
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') enter.click();
  });

  // تسجيل الخروج ينهي جلسة الخادم أيضًا
  document.addEventListener(
    'click',
    (e) => {
      if (cfg.mode === 'server' && e.target.closest('[data-act="logout"]')) fetch('logout', { method: 'POST' });
    },
    true
  );

  if (!cfg.repo) return;
  const admin = document.createElement('div');
  admin.style.cssText = 'width:100%;margin-top:14px;font-size:13px;text-align:start';
  const link = 'all:unset;cursor:pointer;color:var(--accent);font-weight:700';
  if (token) {
    admin.innerHTML =
      `<span id="isnadEditOn" style="color:var(--ok);font-weight:700">وضع التعديل مفعّل على هذا الجهاز</span> · ` +
      `<button type="button" id="isnadEditOff" style="${link}">إيقاف التعديل</button>`;
    userReady.then((m) => {
      if (!m) admin.querySelector('#isnadEditOn').textContent = 'تعذّر التحقق من مفتاح GitHub. أدخل مفتاحًا جديدًا.';
    });
  } else {
    admin.innerHTML =
      `<button type="button" id="isnadEditShow" style="${link}">تفعيل التعديل (للمسؤول)</button>` +
      '<div id="isnadEditBox" hidden style="margin-top:10px">' +
      '<label for="isnadTok" style="display:block;font-size:13px;font-weight:700;color:var(--muted);margin-bottom:6px">مفتاح GitHub</label>' +
      `<input id="isnadTok" type="password" autocomplete="off" placeholder="github_pat_…" dir="ltr" style="${field}">` +
      '<div style="margin-top:6px;color:var(--faint);font-size:12px;line-height:1.6">يُحفظ على هذا الجهاز فقط. أنشئه من GitHub: Settings ← Developer settings ← Fine-grained tokens، لمستودع ' +
      cfg.repo +
      ' بصلاحية Contents: Read and write.</div>' +
      '<div id="isnadTokErr" role="alert" style="display:none;margin-top:8px;color:var(--danger);font-size:13.5px;font-weight:600"></div>' +
      '<button type="button" id="isnadTokSave" class="btn" style="width:100%;margin-top:10px">حفظ المفتاح</button></div>';
  }
  enter.after(admin);

  admin.addEventListener('click', async (e) => {
    const id = e.target.id;
    if (id === 'isnadEditOff') {
      store.del(TOKEN_KEY);
      location.reload();
    } else if (id === 'isnadEditShow') {
      admin.querySelector('#isnadEditBox').hidden = false;
      admin.querySelector('#isnadTok').focus();
    } else if (id === 'isnadTokSave') {
      const t = admin.querySelector('#isnadTok').value.trim();
      const msg = admin.querySelector('#isnadTokErr');
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
})();
