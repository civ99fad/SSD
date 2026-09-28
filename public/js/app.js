// واجهة موقع أرشيف قسم الإسناد (تطبيق صفحة واحدة بدون مكتبات)

const PAGE_SIZE = 9;
const view = document.getElementById('view');

// ---------- أدوات ----------
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const toArDigits = (s) => String(s).replace(/\d/g, (d) => AR_DIGITS[d]);

const HIJRI_MONTHS = [
  'محرم', 'صفر', 'ربيع الأول', 'ربيع الآخر', 'جمادى الأولى', 'جمادى الآخرة',
  'رجب', 'شعبان', 'رمضان', 'شوال', 'ذو القعدة', 'ذو الحجة',
];

// "1448-03-26" ← "٢٦ ربيع الأول ١٤٤٨هـ"
function hijri(date) {
  const m = String(date || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) return esc(date || '');
  const month = HIJRI_MONTHS[Number(m[2]) - 1] || m[2];
  return `${toArDigits(Number(m[3]))} ${month} ${toArDigits(m[1])}هـ`;
}

// توحيد النص للبحث: إزالة المسافات والتشكيل وتوحيد الألف والتاء المربوطة والأرقام
function norm(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[٠-٩]/g, (d) => AR_DIGITS.indexOf(d))
    .replace(/[ً-ْـ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/\s+/g, '');
}

const plural = (n, one, two, few, many) =>
  n === 1 ? one : n === 2 ? two : n >= 3 && n <= 10 ? `${n} ${few}` : `${n} ${many}`;
const vehiclesLabel = (n) => plural(n, 'آلية واحدة', 'آليتان', 'آليات', 'آلية');
const warehousesLabel = (n) => plural(n, 'مستودع واحد', 'مستودعان', 'مستودعات', 'مستودعًا');
const itemsLabel = (n) => plural(n, 'صنف واحد', 'صنفان', 'أصناف', 'صنفًا');

const ICON = {
  truck: (size, color) =>
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.7" aria-hidden="true"><rect x="1" y="7" width="15" height="11" rx="1.5"/><path d="M16 10h3l3 3v5h-6z"/><circle cx="6" cy="19.5" r="1.8"/><circle cx="17.5" cy="19.5" r="1.8"/></svg>`,
  house: (size, color) =>
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.8" aria-hidden="true"><path d="M3 9.5 12 3l9 6.5"/><path d="M5 9v11h14V9"/><path d="M9 20v-6h6v6"/></svg>`,
  arrow: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke-width="2.5" aria-hidden="true"><path d="m10 17-5-5 5-5"/><path d="M5 12h14"/></svg>`,
  search: `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>`,
  chevron: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6B7280" stroke-width="2" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>`,
  image: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke-width="1.8" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/></svg>`,
  file: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2B579A" stroke-width="1.8" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13l1.2 5L11 14l1.8 4L14 13"/></svg>`,
  download: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#1A1400" stroke-width="2.2" aria-hidden="true"><path d="M12 3v12"/><path d="m7 11 5 5 5-5"/><path d="M5 21h14"/></svg>`,
};

const STATUS = { ready: 'جاهزة', down: 'متعطلة بالمقر', maint: 'في الصيانة', away: 'مدعومة لجهة أخرى', none: 'غير محددة' };
const statusPill = (st) => `<span class="stpill st-${esc(st in STATUS ? st : 'none')}"><i></i>${STATUS[st] || STATUS.none}</span>`;
const DASH = '<span class="muted-dash">—</span>';
const fileLink = (url, label = 'عرض المستند') =>
  url ? `<a class="link-more" href="${esc(url)}" target="_blank" rel="noopener">${esc(label)} ${ICON.arrow}</a>` : '';
const sharedFile = (name) => (name ? '/files/files/' + encodeURIComponent(name) : null);

async function api(path) {
  const r = await fetch(path, { headers: { Accept: 'application/json' } });
  if (r.status === 401) {
    location.href = '/login';
    throw new Error('unauthorized');
  }
  if (r.status === 404) return null;
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'خطأ في الخادم');
  return r.json();
}

// ---------- التوجيه ----------
function navigate(url, replace = false) {
  history[replace ? 'replaceState' : 'pushState']({}, '', url);
  render();
}

document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-link]');
  if (!a || e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
  e.preventDefault();
  navigate(a.getAttribute('href'));
});
window.addEventListener('popstate', render);

function setActiveNav(section) {
  document.querySelectorAll('[data-nav]').forEach((a) => {
    const on = a.dataset.nav === section;
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
}

let renderSeq = 0;
async function render() {
  const seq = ++renderSeq;
  const path = location.pathname.replace(/\/+$/, '') || '/vehicles';
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  const section = SECTIONS[parts[0]] ? parts[0] : 'vehicles';
  setActiveNav(section);
  view.innerHTML = '<div class="loading">جارٍ التحميل…</div>';
  try {
    let html;
    if (section === 'vehicles' && parts[1]) html = await vehicleDetail(parts[1]);
    else if (section === 'vehicles') html = await vehiclesList();
    else if (section === 'warehouses' && parts[1]) html = await warehouseDetail(parts[1]);
    else html = await SECTIONS[section]();
    if (seq !== renderSeq) return;
    view.innerHTML = html;
    afterRender();
    window.scrollTo(0, 0);
  } catch (e) {
    if (seq !== renderSeq) return;
    view.innerHTML = `<div class="error-box">تعذّر تحميل الصفحة: ${esc(e.message)}</div>`;
  }
}

let afterRender = () => {};

function notFound(what, backHref, backLabel) {
  return `
    <nav class="crumbs"><a href="${backHref}" data-link>${backLabel}</a></nav>
    <div class="empty">${what} غير موجود. <a class="link-more" href="${backHref}" data-link>العودة إلى ${backLabel}</a></div>`;
}

// ---------- الآليات: القائمة ----------
async function vehiclesList() {
  const [vehicles, warehouses] = await Promise.all([api('/api/vehicles'), api('/api/warehouses')]);
  const params = new URLSearchParams(location.search);
  const state = {
    q: params.get('q') || '',
    model: params.get('model') || '',
    wh: params.get('wh') || '',
    st: params.get('st') || '',
    page: Math.max(1, Number(params.get('page')) || 1),
  };

  const models = [...new Set(vehicles.map((v) => String(v.model || '')).filter(Boolean))].sort();
  const whName = Object.fromEntries(warehouses.map((w) => [w.id, w.name]));

  afterRender = () => {
    const qInput = document.getElementById('q');
    const modelSel = document.getElementById('fModel');
    const whSel = document.getElementById('fWh');
    const stSel = document.getElementById('fSt');
    const grid = document.getElementById('vehGrid');
    const pagerRow = document.getElementById('pagerRow');

    const update = (resetPage) => {
      if (resetPage) state.page = 1;
      state.q = qInput.value;
      state.model = modelSel.value;
      state.wh = whSel.value;
      state.st = stSel.value;

      const nq = norm(state.q);
      const filtered = vehicles.filter(
        (v) =>
          (!nq || norm(v.name).includes(nq) || norm(v.plate).includes(nq) || norm(v.id).includes(nq)) &&
          (!state.model || String(v.model) === state.model) &&
          (!state.wh || v.warehouse === state.wh) &&
          (!state.st || v.status === state.st)
      );
      const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
      state.page = Math.min(state.page, pages);
      const start = (state.page - 1) * PAGE_SIZE;
      const shown = filtered.slice(start, start + PAGE_SIZE);

      grid.innerHTML = shown.length
        ? shown.map(vehicleCard).join('')
        : `<div class="empty" style="grid-column: 1 / -1">${ICON.image}لا توجد آليات مطابقة للبحث</div>`;

      pagerRow.innerHTML = filtered.length
        ? `<div class="pager-info">عرض ${start + 1}–${start + shown.length} من ${filtered.length}</div>
           <div class="pager">${pagerButtons(state.page, pages)}</div>`
        : '';

      const qs = new URLSearchParams();
      if (state.q) qs.set('q', state.q);
      if (state.model) qs.set('model', state.model);
      if (state.wh) qs.set('wh', state.wh);
      if (state.st) qs.set('st', state.st);
      if (state.page > 1) qs.set('page', state.page);
      const s = qs.toString();
      history.replaceState({}, '', '/vehicles' + (s ? '?' + s : ''));
    };

    qInput.addEventListener('input', () => update(true));
    modelSel.addEventListener('change', () => update(true));
    whSel.addEventListener('change', () => update(true));
    stSel.addEventListener('change', () => update(true));
    document.querySelectorAll('[data-stchip]').forEach((b) =>
      b.addEventListener('click', () => {
        stSel.value = stSel.value === b.dataset.stchip ? '' : b.dataset.stchip;
        update(true);
      })
    );
    pagerRow.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-page]');
      if (!b || b.disabled) return;
      state.page = Number(b.dataset.page);
      update(false);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    update(false);
  };

  return `
    <div class="page-head">
      <h1 class="page-title">الآليات</h1>
      <div class="count-pill">${vehiclesLabel(vehicles.length)}</div>
    </div>

    ${readinessPanel(vehicles)}

    <div class="toolbar">
      <div class="search">
        <label class="sr-only" for="q">البحث</label>
        <input id="q" type="search" placeholder="ابحث بالاسم أو رقم اللوحة" value="${esc(state.q)}" autocomplete="off">
        ${ICON.search}
      </div>
      <div class="select">
        <label class="sr-only" for="fModel">الموديل</label>
        <select id="fModel">
          <option value="">كل الموديلات</option>
          ${models.map((m) => `<option value="${esc(m)}" ${m === state.model ? 'selected' : ''}>موديل ${esc(m)}</option>`).join('')}
        </select>
        ${ICON.chevron}
      </div>
      <div class="select">
        <label class="sr-only" for="fWh">المستودع</label>
        <select id="fWh">
          <option value="">كل المستودعات</option>
          ${warehouses.map((w) => `<option value="${esc(w.id)}" ${w.id === state.wh ? 'selected' : ''}>${esc(whName[w.id])}</option>`).join('')}
        </select>
        ${ICON.chevron}
      </div>
      <div class="select">
        <label class="sr-only" for="fSt">الحالة</label>
        <select id="fSt">
          <option value="">كل الحالات</option>
          ${Object.entries(STATUS).map(([k, l]) => `<option value="${k}" ${k === state.st ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
        ${ICON.chevron}
      </div>
    </div>

    <div class="veh-grid" id="vehGrid"></div>
    <div class="pager-row" id="pagerRow"></div>`;
}

function readinessPanel(vehicles) {
  const c = {};
  vehicles.forEach((v) => (c[v.status] = (c[v.status] || 0) + 1));
  const total = vehicles.length || 1;
  const pct = Math.round(((c.ready || 0) / total) * 100);
  const order = ['ready', 'maint', 'down', 'away', 'none'].filter((k) => c[k]);
  return `
    <section class="card ready-card" aria-label="جاهزية الآليات">
      <div class="ready-top">
        <div>
          <div class="ready-title">نسبة الجاهزية</div>
          <div class="ready-big">${toArDigits(pct)}٪</div>
        </div>
        <div class="ready-chips">
          ${order
            .map((k) => `<button type="button" class="ready-chip" data-stchip="${k}">${statusPill(k)}<b>${c[k]}</b></button>`)
            .join('')}
        </div>
      </div>
      <div class="ready-bar" role="img" aria-label="توزيع حالات الآليات">
        ${order.map((k) => `<span class="bar-${k}" style="width:${((c[k] / total) * 100).toFixed(2)}%"></span>`).join('')}
      </div>
    </section>`;
}

function vehicleCard(v) {
  const href = `/vehicles/${encodeURIComponent(v.id)}`;
  const thumb = `<div class="veh-thumb-wrap">${
    v.thumb
      ? `<img class="veh-thumb" src="${esc(v.thumb)}" alt="" loading="lazy">`
      : `<div class="veh-thumb-empty">${ICON.truck(40, '#B7C1CE')}</div>`
  }<span class="thumb-status">${statusPill(v.status)}</span></div>`;
  return `
    <a class="card veh-card" href="${href}" data-link>
      ${thumb}
      <div class="veh-body">
        <div class="veh-name">${esc(v.name)}</div>
        <div class="veh-meta">
          <span class="plate">${esc(v.plate)}</span>
          <span class="veh-model">${esc([v.make, v.model].filter(Boolean).join(' · '))}</span>
        </div>
        <span class="link-more">عرض التفاصيل ${ICON.arrow}</span>
      </div>
    </a>`;
}

function pagerButtons(page, pages) {
  const prev = `<button data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''} aria-label="الصفحة السابقة">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="m9 18 6-6-6-6"/></svg></button>`;
  const next = `<button data-page="${page + 1}" ${page >= pages ? 'disabled' : ''} aria-label="الصفحة التالية">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="m15 18-6-6 6-6"/></svg></button>`;
  let nums = '';
  for (let i = 1; i <= pages; i++) {
    nums += `<button data-page="${i}" ${i === page ? 'aria-current="page"' : ''}>${i}</button>`;
  }
  return prev + nums + next;
}

// ---------- الآليات: التفاصيل ----------
async function vehicleDetail(id) {
  const [v, profiles] = await Promise.all([api(`/api/vehicles/${encodeURIComponent(id)}`), api('/api/records/profiles')]);
  if (!v) return notFound('الآلية', '/vehicles', 'الآليات');
  const myProfiles = profiles.filter((p) => (p.vehicles || []).includes(v.id) || p.vehicle === v.id);

  const galleries = { photos: v.photos, contents: v.contents, specs: v.specs && v.specs.imageUrl ? [v.specs.imageUrl] : [] };
  afterRender = () => {
    view.querySelectorAll('[data-gallery]').forEach((btn) =>
      btn.addEventListener('click', () => openLightbox(galleries[btn.dataset.gallery], Number(btn.dataset.index)))
    );
  };

  const subtitle = [v.make, v.model && `موديل ${v.model}`].filter(Boolean).join(' · ');

  return `
    <nav class="crumbs" aria-label="مسار التنقل">
      <a href="/vehicles" data-link>الآليات</a><span>/</span><span class="cur">${esc(v.name)}</span>
    </nav>

    <div class="detail-head">
      <div class="head-icon">${ICON.truck(28, '#142A47')}</div>
      <div>
        <h1 class="page-title">${esc(v.name)}</h1>
        <div class="head-sub">
          <span class="plate">${esc(v.plate)}</span>
          <span class="veh-model">${esc(subtitle)}</span>
        </div>
      </div>
    </div>

    <section class="card info-grid" aria-label="البيانات الأساسية">
      ${infoCell('اسم الآلية', v.name)}
      ${infoCell('رقم اللوحة', v.plate)}
      ${infoCell('الموديل', v.model)}
      ${infoCell('الرمز', v.code)}
    </section>

    <section class="card status-card" aria-label="حالة الآلية">
      <div class="status-row">
        <span class="info-label" style="margin:0">حالة الآلية</span>
        ${statusPill(v.status)}
        ${v.statusAction ? `<span class="status-action">${esc(v.statusAction)}</span>` : ''}
      </div>
      ${v.statusNote ? `<div class="status-note">${esc(v.statusNote)}</div>` : ''}
    </section>

    ${
      (v.review || []).length
        ? `<section class="card review-box"><b>ملاحظات للمراجعة</b><ul>${v.review.map((r) => `<li>${esc(r)}</li>`).join('')}</ul></section>`
        : ''
    }

    ${specsSection(v.specs)}

    ${
      myProfiles.length
        ? `<section><h2 class="section-title">الملفات التعريفية</h2>${myProfiles
            .map(
              (p) => `<div class="card file-card">
                <div class="file-icon">${ICON.file}</div>
                <div style="flex-grow:1;min-width:0"><div class="file-name">${esc(p.title)}</div><div class="file-sub">${esc(p.fileName || '')}</div></div>
                ${fileLink(sharedFile(p.file), 'عرض الملف')}
              </div>`
            )
            .join('')}</section>`
        : ''
    }

    <section>
      <h2 class="section-title">صور الآلية</h2>
      ${gallery(v.photos, 'photos', 'لم تُرفع صور للآلية بعد')}
    </section>

    <section>
      <h2 class="section-title">صور محتويات الآلية</h2>
      ${gallery(v.contents, 'contents', 'لم تُرفع صور للمحتويات بعد')}
    </section>

    <section>
      <div class="inv-head">
        <h2 class="section-title">الجرد</h2>
        ${v.inventoryDate ? `<div class="inv-date">آخر تحديث: ${hijri(v.inventoryDate)}</div>` : ''}
        ${v.inventoryUrl ? `<span style="margin-inline-start:auto">${fileLink(v.inventoryUrl, 'عرض ورقة الجرد')}</span>` : ''}
      </div>
      ${inventoryTable(v.inventory || [], v.inventoryNotes || [])}
    </section>

    <section>
      <h2 class="section-title">سجل الآلية</h2>
      ${timeline(v.history)}
    </section>

    <section>
      <h2 class="section-title">نموذج الاستلام والتسليم</h2>
      ${
        v.forms.length
          ? v.forms.map(formCard).join('')
          : `<div class="empty">${ICON.image}لم يُرفع نموذج الاستلام والتسليم بعد</div>`
      }
    </section>`;
}

function specsSection(sp) {
  if (!sp) return '';
  const rows = (sp.rows || []).map(([k, val]) => `<div><dt>${esc(k)}</dt><dd>${esc(val)}</dd></div>`).join('');
  const comps = (sp.compartments || [])
    .map(
      (c) => `<div class="card comp-card"><div class="comp-name">${esc(c.name)}</div>
        <table class="data"><tbody>${c.items
          .map(([n, q]) => `<tr><td class="name">${esc(n)}</td><td class="qty">${esc(q)}</td></tr>`)
          .join('')}</tbody></table></div>`
    )
    .join('');
  return `<section>
    <h2 class="section-title">${esc(sp.title || 'المواصفات الفنية')}</h2>
    <div class="card specs">
      <div class="specs-head">
        ${sp.imageUrl ? `<button type="button" class="specs-img" data-gallery="specs" data-index="0" aria-label="تكبير صورة المواصفات"><img src="${esc(sp.imageUrl)}" alt=""></button>` : ''}
        ${sp.summary ? `<p class="specs-sum">${esc(sp.summary)}</p>` : ''}
      </div>
      ${rows ? `<dl class="specs-dl">${rows}</dl>` : ''}
      ${comps ? `<details class="specs-comps"><summary>محتويات الأدراج (${toArDigits((sp.compartments || []).length)})</summary><div class="comps">${comps}</div></details>` : ''}
      ${sp.uncertain ? `<div class="specs-unc">${esc(sp.uncertain)}</div>` : ''}
    </div>
  </section>`;
}

function infoCell(label, value) {
  return `<div><div class="info-label">${label}</div><div class="info-value">${esc(value || '—')}</div></div>`;
}

function gallery(list, key, emptyText) {
  if (!list.length) return `<div class="empty">${ICON.image}${emptyText}</div>`;
  return `<div class="gallery">${list
    .map(
      (src, i) =>
        `<button type="button" data-gallery="${key}" data-index="${i}" aria-label="تكبير الصورة ${i + 1}">
           <img src="${esc(src)}" alt="" loading="lazy"></button>`
    )
    .join('')}</div>`;
}

function inventoryTable(items, notes) {
  if (!items.length) return `<div class="empty">لا توجد بيانات جرد بعد</div>`;
  const cell = (i) =>
    items[i]
      ? `<td class="n">${i + 1}</td><td class="name">${esc(items[i][0])}</td><td class="qty">${esc(items[i][1])}</td>`
      : `<td class="n"></td><td class="name"></td><td class="qty"></td>`;

  // الشكل الرسمي: قائمتان متجاورتان (النصف الأول يمين، النصف الثاني يسار)
  const half = Math.ceil(items.length / 2);
  let doubleRows = '';
  for (let r = 0; r < half; r++) {
    doubleRows += `<tr>${cell(r)}${cell(r + half).replace('<td class="n">', '<td class="n sep">')}</tr>`;
  }
  const head = '<th class="n">م</th><th>النوع</th><th class="qty">العدد</th>';
  const singleRows = items.map((_, i) => `<tr>${cell(i)}</tr>`).join('');

  const notesHtml = notes.length
    ? `<div class="inv-notes"><b>ملاحظات:</b><ul>${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul></div>`
    : '';

  return `
    <div class="card table-card">
      <div class="table-scroll">
        <table class="data inv">
          <thead><tr>${head}${head.replace('<th class="n">', '<th class="n sep">')}</tr></thead>
          <tbody>${doubleRows}</tbody>
        </table>
        <table class="data inv-single">
          <thead><tr>${head}</tr></thead>
          <tbody>${singleRows}</tbody>
        </table>
      </div>
      ${notesHtml}
    </div>`;
}

function timeline(history) {
  if (!history.length) return `<div class="empty">لا توجد سجلات للآلية بعد</div>`;
  const cls = (t) => (t === 'استلام' ? 't-receive' : t === 'تسليم' ? 't-deliver' : t === 'حركة' ? 't-status' : 't-report');
  return `<div class="card timeline">${history
    .map(
      (h) => `
      <div class="tl-item ${cls(h.type)}">
        <div class="tl-rail"><div class="tl-dot"></div><div class="tl-line"></div></div>
        <div class="tl-body">
          <div class="tl-top">
            <span class="tl-badge">${esc(h.type || 'محضر')}</span>
            <span class="tl-date">${hijri(h.date)}</span>
          </div>
          ${h.title ? `<div class="tl-title">${esc(h.title)}</div>` : ''}
          ${h.description ? `<div class="tl-desc">${esc(h.description)}</div>` : ''}
          ${h.url ? `<a class="link-more" href="${esc(h.url)}" target="_blank" rel="noopener">عرض المستند ${ICON.arrow}</a>` : ''}
        </div>
      </div>`
    )
    .join('')}</div>`;
}

function formCard(f) {
  const dot = f.name.lastIndexOf('.');
  const ext = f.name.slice(dot + 1).toLowerCase();
  const base = dot > 0 ? f.name.slice(0, dot) : f.name;
  const kind = ext === 'pdf' ? 'ملف PDF' : 'ملف Word';
  return `
    <div class="card file-card">
      <div class="file-icon">${ICON.file}</div>
      <div style="flex-grow: 1; min-width: 0;">
        <div class="file-name">${esc(base)}</div>
        <div class="file-sub">${kind} <bdi>(.${esc(ext)})</bdi></div>
      </div>
      <a class="btn-gold" href="${esc(f.url)}?download=1" download>${ICON.download} تحميل الملف</a>
    </div>`;
}

// ---------- المستودعات ----------
async function warehousesList() {
  const list = await api('/api/warehouses');
  afterRender = () => {};
  const cards = list
    .map((w) => {
      const items = w.items || [];
      const preview = items
        .slice(0, 3)
        .map(([n, q]) => `<div><span>${esc(n)}</span><span>${esc(q)}</span></div>`)
        .join('');
      const more = items.length > 3 ? `<div class="wh-more">+${items.length - 3} ${items.length - 3 <= 10 ? 'أصناف أخرى' : 'صنفًا آخر'}</div>` : '';
      return `
      <div class="card wh-card">
        <div class="wh-top">
          <div class="wh-icon">${ICON.house(24, '#142A47')}</div>
          <div>
            <div class="wh-name">${esc(w.name)}</div>
            <div class="wh-count">${items.length ? itemsLabel(items.length) : 'لا توجد أصناف بعد'}</div>
          </div>
        </div>
        ${items.length ? `<div class="wh-preview">${preview}</div>` : ''}
        <div class="wh-foot">
          ${more || '<span></span>'}
          <a class="link-more" href="/warehouses/${encodeURIComponent(w.id)}" data-link>عرض المحتويات ${ICON.arrow}</a>
        </div>
        ${w.sample ? '<div><span class="sample-note">بيانات تجريبية</span></div>' : ''}
      </div>`;
    })
    .join('');

  return `
    <div class="page-head">
      <h1 class="page-title">المستودعات</h1>
      <div class="count-pill">${warehousesLabel(list.length)}</div>
    </div>
    <div class="wh-grid">${cards}</div>`;
}

async function warehouseDetail(id) {
  const w = await api(`/api/warehouses/${encodeURIComponent(id)}`);
  afterRender = () => {};
  if (!w) return notFound('المستودع', '/warehouses', 'المستودعات');
  const items = w.items || [];
  const sub = [items.length ? `${itemsLabel(items.length)} مسجل` : 'لا توجد أصناف بعد', w.updated && `آخر تحديث ${hijri(w.updated)}`]
    .filter(Boolean)
    .join(' — ');

  return `
    <nav class="crumbs" aria-label="مسار التنقل">
      <a href="/warehouses" data-link>المستودعات</a><span>/</span><span class="cur">${esc(w.name)}</span>
    </nav>

    <div class="detail-head">
      <div class="head-icon" style="width:50px;height:50px">${ICON.house(26, '#142A47')}</div>
      <div>
        <h1 class="page-title" style="font-size:22px">${esc(w.name)}</h1>
        <div class="detail-sub">${sub}</div>
      </div>
      ${w.sample ? '<span class="sample-note" style="margin-inline-start:auto">بيانات تجريبية</span>' : ''}
    </div>

    ${
      items.length
        ? `<div class="card table-card"><div class="table-scroll">
            <table class="data wh">
              <thead><tr><th class="n">م</th><th>نوع الصنف</th><th class="qty">العدد</th></tr></thead>
              <tbody>${items
                .map(([n, q], i) => `<tr><td class="n">${i + 1}</td><td class="name">${esc(n)}</td><td class="qty">${esc(q)}</td></tr>`)
                .join('')}</tbody>
            </table></div></div>`
        : `<div class="empty">${ICON.house(22, '#B7C1CE')}لم تُسجّل محتويات لهذا المستودع بعد</div>`
    }

    ${
      (w.custody || []).length
        ? `<section><h2 class="section-title">العُهد</h2><div class="card table-card"><div class="table-scroll">
            <table class="data wh">
              <thead><tr><th class="n">م</th><th>الصنف</th><th class="qty">العدد</th></tr></thead>
              <tbody>${w.custody
                .map(([n, q], i) => `<tr><td class="n">${i + 1}</td><td class="name">${esc(n)}</td><td class="qty">${esc(q)}</td></tr>`)
                .join('')}</tbody>
            </table></div></div></section>`
        : ''
    }`;
}

// ================= الأقسام الإضافية =================
const pageHead = (title, count) =>
  `<div class="page-head"><h1 class="page-title">${title}</h1>${count != null ? `<div class="count-pill">${count}</div>` : ''}</div>`;
const pill = (text, cls = 'p-neutral') => `<span class="pill ${cls}">${esc(text)}</span>`;
const emptyBox = (t) => `<div class="empty">${t}</div>`;
const table = (heads, rows) =>
  `<div class="card table-card"><div class="table-scroll"><table class="data rec"><thead><tr>${heads
    .map((h) => `<th>${h}</th>`)
    .join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div></div>`;
const multiline = (t) => esc(t || '').replace(/\n/g, '<br>');
const vehLink = (id, vmap) =>
  id ? `<a class="link-more" href="/vehicles/${encodeURIComponent(id)}" data-link>${esc((vmap[id] && vmap[id].name) || id)}</a>` : '';

// تبويبات بسيطة داخل الصفحة
function tabs(key, list, current) {
  return `<div class="tabs" role="tablist">${list
    .map(
      ([k, l, n]) =>
        `<a role="tab" class="tab${k === current ? ' on' : ''}" href="?${key}=${k}" data-link aria-selected="${k === current}">${esc(l)}${
          n != null ? ` <b>${n}</b>` : ''
        }</a>`
    )
    .join('')}</div>`;
}
const qp = (k, d) => new URLSearchParams(location.search).get(k) || d;
const vehMap = async () => Object.fromEntries((await api('/api/vehicles')).map((v) => [v.id, v]));

// ---------- الملفات التعريفية ----------
async function profilesPage() {
  const [list, vmap] = await Promise.all([api('/api/records/profiles'), vehMap()]);
  afterRender = () => {};
  return `${pageHead('الملفات التعريفية', toArDigits(list.length) + ' ملف')}
    ${
      list.length
        ? `<div class="doc-list">${list
            .map(
              (p) => `<div class="card doc-card">
                <div class="file-icon">${ICON.file}</div>
                <div class="doc-body">
                  <div class="file-name">${esc(p.title)}</div>
                  ${p.note ? `<div class="doc-note">${multiline(p.note)}</div>` : ''}
                  ${
                    (p.vehicles || []).length
                      ? `<div class="doc-meta">الآليات: ${(p.vehicles || []).map((id) => vehLink(id, vmap)).join('، ')}</div>`
                      : ''
                  }
                </div>
                ${fileLink(sharedFile(p.file), 'عرض الملف')}
              </div>`
            )
            .join('')}</div>`
        : emptyBox('لا توجد ملفات تعريفية')
    }`;
}

// ---------- تقارير الرجيع ----------
async function returnsPage() {
  const [list, vmap] = await Promise.all([api('/api/records/returns'), vehMap()]);
  afterRender = () => {};
  return `${pageHead('تقارير الرجيع', toArDigits(list.length) + ' تقرير')}
    ${
      list.length
        ? `<div class="doc-list">${list
            .map(
              (r) => `<div class="card doc-card">
                <div class="file-icon">${ICON.file}</div>
                <div class="doc-body">
                  <div class="file-name">${esc(r.title)}</div>
                  <div class="doc-meta">${[r.date && esc(r.date), r.num && 'رقم ' + esc(r.num)].filter(Boolean).join(' · ')}${
                    r.vehicle ? ' · ' + vehLink(r.vehicle, vmap) : ''
                  }</div>
                  ${r.items ? `<div class="doc-note"><b>الأصناف:</b><br>${multiline(r.items)}</div>` : ''}
                  ${r.rec ? `<div class="doc-note"><b>التوصية:</b> ${multiline(r.rec)}</div>` : ''}
                  ${r.note ? `<div class="doc-note">${multiline(r.note)}</div>` : ''}
                </div>
                ${fileLink(sharedFile(r.file), 'عرض التقرير')}
              </div>`
            )
            .join('')}</div>`
        : emptyBox('لا توجد تقارير رجيع')
    }`;
}

// ---------- أعطال المبنى ----------
const FSTAT = { open: ['مفتوح', 'p-bad'], prog: ['قيد المعالجة', 'p-mid'], done: ['تم الإصلاح', 'p-ok'] };
const FTYPE = { elec: 'كهرباء', plumb: 'سباكة وتسريبات', ac: 'تكييف وتهوية', civil: 'إنشائي ومباني', doors: 'أبواب ونوافذ', safety: 'أنظمة السلامة والإطفاء', comms: 'اتصالات وشبكات', other: 'أخرى' };
async function faultsPage() {
  const list = await api('/api/records/faults');
  const f = qp('f', 'all');
  const cnt = (k) => list.filter((x) => x.status === k).length;
  const shown = list.filter((x) => f === 'all' || x.status === f);
  const galleries = {};
  afterRender = () => {
    view.querySelectorAll('[data-gallery]').forEach((btn) =>
      btn.addEventListener('click', () => openLightbox(galleries[btn.dataset.gallery], Number(btn.dataset.index)))
    );
  };
  return `${pageHead('أعطال المبنى', toArDigits(list.length) + ' عطل')}
    ${tabs('f', [['all', 'الكل', list.length], ['open', 'مفتوح', cnt('open')], ['prog', 'قيد المعالجة', cnt('prog')], ['done', 'تم الإصلاح', cnt('done')]], f)}
    ${
      shown.length
        ? `<div class="doc-list">${shown
            .map((x) => {
              const [sl, sc] = FSTAT[x.status] || FSTAT.open;
              galleries[x.id] = (x.photos || []).map(sharedFile);
              return `<div class="card fault-card">
                <div class="fault-top">
                  <div class="file-name">${esc(x.title)}</div>
                  ${pill(sl, sc)} ${pill(FTYPE[x.type] || 'أخرى')}
                </div>
                <div class="doc-meta">${[x.location, x.date, x.reporter && 'المُبلّغ: ' + x.reporter].filter(Boolean).map(esc).join(' · ')}</div>
                ${x.desc ? `<div class="doc-note">${multiline(x.desc)}</div>` : ''}
                ${
                  galleries[x.id].length
                    ? `<div class="gallery small">${galleries[x.id]
                        .map((src, i) => `<button type="button" data-gallery="${esc(x.id)}" data-index="${i}" aria-label="تكبير الصورة"><img src="${esc(src)}" alt="" loading="lazy"></button>`)
                        .join('')}</div>`
                    : ''
                }
                ${
                  (x.actions || []).length
                    ? `<ul class="actions">${x.actions
                        .map((a) => `<li><span class="tl-date">${esc(a.date || '')}</span> ${esc(a.text)}${a.close ? ' ' + pill('إغلاق', 'p-ok') : ''}</li>`)
                        .join('')}</ul>`
                    : ''
                }
              </div>`;
            })
            .join('')}</div>`
        : emptyBox('لا توجد أعطال بهذا التصنيف')
    }`;
}

// ---------- الكادر البشري ----------
const HST = { present: ['موجود', 'p-ok'], absent: ['غياب', 'p-bad'], lateP: ['تأخير بإذن', 'p-mid'], lateN: ['تأخير بدون إذن', 'p-bad'], leave: ['إجازة', 'p-in'], permit: ['رخصة', 'p-in'], support: ['دعم وردية', 'p-sup'], course: ['دورة', 'p-mid'], assign: ['تكليف', 'p-mid'], attach: ['إلحاق', 'p-mid'] };
const SHN = { 1: 'الوردية الأولى', 2: 'الوردية الثانية', 3: 'الوردية الثالثة' };
async function staffPage() {
  const tab = qp('t', 'team');
  const [staff, absences, missions, misdocs] = await Promise.all([
    api('/api/records/staff'),
    api('/api/records/absences'),
    api('/api/records/missions'),
    api('/api/records/misdocs'),
  ]);
  afterRender = () => {};
  let body = '';
  if (tab === 'team') {
    const present = staff.filter((p) => !p.status || p.status === 'present' || p.status === 'support').length;
    body =
      `<div class="card ready-card"><div class="ready-top"><div><div class="ready-title">الموجود من الكادر</div><div class="ready-big">${toArDigits(present)} / ${toArDigits(staff.length)}</div></div></div></div>` +
      ['1', '2', '3']
        .map((k) => {
          const ps = staff.filter((p) => String(p.shift || '1') === k);
          if (!ps.length) return '';
          return `<section><h2 class="section-title">${SHN[k]} <span class="muted-dash">(${toArDigits(ps.length)})</span></h2>${table(
            ['م', 'الرتبة', 'الاسم', 'الرقم العسكري', 'التخصص', 'الحالة', 'الفترة / ملاحظة'],
            ps.map((p, i) => {
              const [sl, sc] = HST[p.status] || HST.present;
              const per = p.status && p.status !== 'present' ? [p.from && 'من ' + p.from, p.to && 'إلى ' + p.to].filter(Boolean).join(' ') : '';
              const lbl = p.status === 'support' && p.toShift ? `${sl} ← ${SHN[p.toShift] || ''}` : sl;
              return `<tr><td class="n">${i + 1}</td><td>${esc(p.rank || '')}</td><td class="name">${esc(p.name)}</td><td>${esc(p.num || '')}</td><td>${esc(p.spec || '')}</td><td>${pill(lbl, sc)}</td><td class="muted-cell">${esc([per, p.note].filter(Boolean).join(' — ')) || DASH}</td></tr>`;
            })
          )}</section>`;
        })
        .join('');
  } else if (tab === 'abs') {
    body = absences.length
      ? table(
          ['التاريخ', 'الاسم', 'النوع', 'الإجراء المتخذ', 'المحضر'],
          absences.map(
            (a) => `<tr><td>${esc(a.date || '')}</td><td class="name">${esc(a.pN || '')}</td><td>${pill(a.kind === 'late' ? 'تأخير' : 'غياب', a.kind === 'late' ? 'p-mid' : 'p-bad')}</td><td>${esc(a.action || '')}${a.note ? `<div class="muted-cell">${esc(a.note)}</div>` : ''}</td><td>${fileLink(sharedFile(a.file), 'عرض') || DASH}</td></tr>`
          )
        )
      : emptyBox('لا توجد غيابات أو تأخيرات');
  } else {
    body = ['ext', 'int']
      .map((k) => {
        const ms = missions.filter((m) => (m.kind === 'int' ? 'int' : 'ext') === k);
        const next = ms.find((m) => !m.done);
        const md = misdocs[k];
        return `<section><h2 class="section-title">${k === 'ext' ? 'المهمات الخارجية' : 'المهمات الداخلية'}</h2>
          ${md && md.file ? `<div class="card file-card"><div class="file-icon">${ICON.file}</div><div style="flex-grow:1"><div class="file-name">${esc(md.title || 'بيان الترتيب')}</div></div>${fileLink(sharedFile(md.file), 'عرض البيان')}</div>` : ''}
          ${
            ms.length
              ? table(
                  ['م', 'الفردان', 'انتهت المهمة', 'التاريخ', 'الموقع', 'سبب المهمة'],
                  ms.map(
                    (m, i) => `<tr${m === next ? ' class="next-row"' : ''}><td class="n">${i + 1}</td><td class="name">${esc(m.aN || '')} <span class="muted-dash">و</span> ${esc(m.bN || '')}${m === next ? ' ' + pill('الدور القادم', 'p-mid') : ''}</td><td>${m.done ? pill('✓ تمت', 'p-ok') : DASH}</td><td>${esc(m.date || '') || DASH}</td><td>${esc(m.location || '') || DASH}</td><td>${esc(m.reason || '') || DASH}</td></tr>`
                  )
                )
              : emptyBox('لا يوجد ترتيب بعد')
          }</section>`;
      })
      .join('');
  }
  return `${pageHead('الكادر البشري', toArDigits(staff.length) + ' فرد')}
    ${tabs('t', [['team', 'الأفراد والورديات', staff.length], ['abs', 'الغيابات والتأخيرات', absences.length], ['mis', 'المهمات', missions.length]], tab)}
    ${body}`;
}

// ---------- المعاملات ----------
async function txPage() {
  const tab = qp('t', 'letters');
  const [letters, ptx] = await Promise.all([api('/api/records/letters'), api('/api/records/ptx')]);
  afterRender = () => {};
  const st = (s) => (s === 'done' ? pill('منتهية', 'p-ok') : pill('قيد الإجراء', 'p-mid'));
  const body =
    tab === 'letters'
      ? letters.length
        ? `<div class="doc-list">${letters
            .map(
              (l) => `<div class="card doc-card">
                <div class="file-icon">${ICON.file}</div>
                <div class="doc-body">
                  <div class="fault-top"><div class="file-name">${esc(l.subject)}</div>${pill(l.dir === 'in' ? 'وارد' : 'صادر', 'p-in')} ${st(l.status)}</div>
                  <div class="doc-meta">${[l.date, l.num && 'رقم ' + l.num, l.party].filter(Boolean).map(esc).join(' · ')}</div>
                  ${l.note ? `<div class="doc-note">${multiline(l.note)}</div>` : ''}
                </div>
                ${fileLink(sharedFile(l.file), 'عرض الخطاب')}
              </div>`
            )
            .join('')}</div>`
        : emptyBox('لا توجد خطابات')
      : ptx.length
      ? `<div class="doc-list">${ptx
          .map(
            (t) => `<div class="card doc-card">
              <div class="file-icon">${ICON.file}</div>
              <div class="doc-body">
                <div class="fault-top"><div class="file-name">${esc(t.type || 'معاملة')} — ${esc(t.pN || '')}</div>${st(t.status)}</div>
                <div class="doc-meta">${esc(t.date || '')}</div>
                ${t.details ? `<div class="doc-note">${multiline(t.details)}</div>` : ''}
              </div>
              ${fileLink(sharedFile(t.file), 'عرض المعاملة')}
            </div>`
          )
          .join('')}</div>`
      : emptyBox('لا توجد معاملات أفراد');
  return `${pageHead('المعاملات', toArDigits(letters.length + ptx.length) + ' معاملة')}
    ${tabs('t', [['letters', 'الخطابات', letters.length], ['ptx', 'معاملات الأفراد', ptx.length]], tab)}
    ${body}`;
}

// ---------- الرغاوي والمحروقات ----------
const CNK = { foam: 'الرغاوي', fuel: 'المحروقات', powder: 'طفايات البودرة' };
async function consumPage() {
  const [list, vmap] = await Promise.all([api('/api/records/consum'), vehMap()]);
  const kinds = Object.keys(CNK).filter((k) => list.some((x) => x.kind === k));
  const tab = qp('k', kinds[0] || 'foam');
  afterRender = () => {};
  const rows = list.filter((x) => x.kind === tab);
  return `${pageHead('الرغاوي والمحروقات', toArDigits(list.length) + ' حركة')}
    ${tabs('k', kinds.map((k) => [k, CNK[k], list.filter((x) => x.kind === k).length]), tab)}
    ${
      rows.length
        ? table(
            ['التاريخ', 'النوع', 'الصنف', 'الكمية', 'الجهة', 'الآلية', 'ملاحظة', 'المستند'],
            rows.map(
              (x) => `<tr><td>${esc(x.date || '')}</td><td>${pill(x.dir === 'in' ? 'وارد' : 'صرف', x.dir === 'in' ? 'p-ok' : 'p-mid')}</td><td class="name">${esc(x.item || '')}</td><td>${esc(x.qty || '')} ${esc(x.unit || '')}</td><td>${esc(x.party || '') || DASH}</td><td>${vehLink(x.vehicle, vmap) || DASH}</td><td class="muted-cell">${multiline(x.note) || DASH}</td><td>${fileLink(sharedFile(x.file), 'عرض') || DASH}</td></tr>`
            )
          )
        : emptyBox('لا توجد حركات')
    }`;
}

const SECTIONS = {
  vehicles: vehiclesList,
  warehouses: warehousesList,
  profiles: profilesPage,
  returns: returnsPage,
  faults: faultsPage,
  staff: staffPage,
  tx: txPage,
  consum: consumPage,
};

// ---------- عارض الصور ----------
const lb = {
  el: document.getElementById('lightbox'),
  img: document.getElementById('lbImg'),
  count: document.getElementById('lbCount'),
  list: [],
  i: 0,
  lastFocus: null,
};

function showLb() {
  lb.img.src = lb.list[lb.i];
  lb.count.textContent = `${lb.i + 1} / ${lb.list.length}`;
  const multi = lb.list.length > 1;
  document.getElementById('lbPrev').style.display = multi ? '' : 'none';
  document.getElementById('lbNext').style.display = multi ? '' : 'none';
}
function openLightbox(list, i) {
  lb.list = list;
  lb.i = i;
  lb.lastFocus = document.activeElement;
  showLb();
  lb.el.classList.add('open');
  document.body.style.overflow = 'hidden';
  document.getElementById('lbClose').focus();
}
function closeLightbox() {
  lb.el.classList.remove('open');
  document.body.style.overflow = '';
  lb.img.removeAttribute('src');
  lb.lastFocus?.focus();
}
const step = (d) => {
  lb.i = (lb.i + d + lb.list.length) % lb.list.length;
  showLb();
};
document.getElementById('lbClose').addEventListener('click', closeLightbox);
document.getElementById('lbPrev').addEventListener('click', () => step(-1));
document.getElementById('lbNext').addEventListener('click', () => step(1));
lb.el.addEventListener('click', (e) => {
  if (e.target === lb.el) closeLightbox();
});
lb.el.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeLightbox();
  // في الاتجاه من اليمين لليسار: السهم الأيسر = التالي
  if (e.key === 'ArrowLeft') step(1);
  if (e.key === 'ArrowRight') step(-1);
});

render();
