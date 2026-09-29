// يشغّل صفحة موقع Claude (page.html) خارج Claude: البيانات تُقرأ من ملفات ثابتة، والموقع للعرض فقط.
// يوفّر window.claude.use('db' | 'downloads') بنفس الواجهة التي تستخدمها الصفحة، ويضيف خانة كلمة المرور لشاشة الدخول.
(function () {
  const cfg = window.ISNAD_CONFIG || {}; // { mode: 'static' | 'server', hash }
  let blobs = {};

  window.ISNAD = { blob: (id) => blobs[id] || '' };

  // على الخادم لا تُطلب البيانات إلا بعد الدخول (في النسخة الثابتة تُحمّل مباشرة)
  let entered = false;
  try {
    entered = sessionStorage.getItem('isnad-entered') === '1';
  } catch (e) {}
  let authed;
  const authReady = new Promise((res) => (authed = res));
  if (cfg.mode !== 'server' || entered) authed();

  // ---------- البيانات ----------
  let dbPromise = null;
  function loadDb() {
    if (!dbPromise) {
      dbPromise = authReady.then(() => fetch('db.json', { cache: 'no-store' })).then((r) => {
        if (r.status === 401) {
          // انتهت جلسة الدخول على الخادم: نعود لشاشة الدخول
          try {
            sessionStorage.removeItem('isnad-entered');
          } catch (e) {}
          location.reload();
          throw new Error('unauthorized');
        }
        if (!r.ok) throw new Error(r.status);
        return r.json().then((d) => {
          blobs = d.blobs || {};
          return d.collections || {};
        });
      });
    }
    return dbPromise;
  }

  const snap = (id, data) => ({ id, exists: data !== undefined, data: () => data });
  const readOnly = () => Promise.reject({ code: 'not_granted' });

  function doc(path) {
    const [c, id] = path.split('/');
    const read = async () => {
      if (c === 'files') {
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
        return () => {};
      },
      set: readOnly,
      update: readOnly,
      delete: readOnly,
    };
  }

  function collection(c) {
    return {
      doc: (id) => doc(c + '/' + (id || 'new')),
      add: readOnly,
      onSnapshot(cb, err) {
        loadDb().then((all) => cb({ docs: Object.entries(all[c] || {}).map(([id, v]) => snap(id, v)) }), err || (() => {}));
        return () => {};
      },
    };
  }

  const db = { doc, collection };

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

  window.claude = {
    use(name) {
      if (name === 'db') return loadDb().then(() => db);
      if (name === 'downloads') return Promise.resolve(downloads);
      return Promise.reject(new Error('unavailable'));
    },
  };

  // ---------- كلمة المرور على شاشة الدخول ----------
  const enter = document.getElementById('enter');
  if (!enter) return;
  const box = document.createElement('div');
  box.style.cssText = 'width:100%;margin-top:18px;text-align:start';
  box.innerHTML =
    '<label for="isnadPw" style="display:block;font-size:13px;font-weight:700;color:var(--muted);margin-bottom:6px">كلمة المرور</label>' +
    '<input id="isnadPw" type="password" autocomplete="current-password" placeholder="أدخل كلمة المرور" ' +
    'style="width:100%;padding:12px 14px;border-radius:10px;border:1.5px solid var(--line);background:var(--surface-2);font-size:15px;outline:none">' +
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
})();
