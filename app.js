// Лапки: страница рендерится из data/shelters.json и data/delivered.json

const FALLBACK_CHAT = 'https://t.me/designta';
const PLATFORM = { ozon: 'Ozon', market: 'Маркет', wb: 'WB' };
const PLATFORM_ON = { ozon: 'Ozon', market: 'Маркете', wb: 'WB' };
const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const VISIBLE = 3;
const WEEK = 7 * 24 * 60 * 60 * 1000;

// Единая обёртка внешних ссылок. Сюда же позже встанут партнёрские параметры и цель Метрики.
function outLink(url, slug, kind) {
  if (!url) return '#';
  if (kind !== 'buy' && kind !== 'money') return url;
  try {
    const u = new URL(url);
    u.searchParams.set('utm_source', 'lapki');
    u.searchParams.set('utm_medium', 'list');
    u.searchParams.set('utm_campaign', slug);
    return u.toString();
  } catch (e) {
    return url;
  }
}

// navigator.clipboard есть только на https; на http и в старых браузерах копируем через скрытое поле
function copyText(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;font-size:16px';
  document.body.appendChild(ta);
  ta.select();
  ta.setSelectionRange(0, text.length);
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (e) {}
  ta.remove();
  if (!ok && navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {});
}

const YM_ID = 113157493;
// цели Метрики: buy / money / groups / chat / channel / copy / verify / cta
function trackClick(kind, slug) {
  if (typeof ym !== 'function') return;
  ym(YM_ID, 'reachGoal', kind, slug ? { shelter: slug } : undefined);
  // то же — параметром визита: по нему Метрика умеет группировать в отчётах и дашбордах
  if (slug) ym(YM_ID, 'params', { [kind]: slug });
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const formatPrice = n => n.toLocaleString('ru-RU').replace(/ /g, ' ') + ' ₽';
const formatDate = iso => { const d = new Date(iso); return d.getDate() + ' ' + MONTHS[d.getMonth()]; };
const plural = (n, one, few, many) => {
  const a = n % 10, b = n % 100;
  return a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 12 || b > 14) ? few : many;
};

// Типографика: короткие слова (1–3 буквы) держатся за следующее, тире — за предыдущее,
// число — за единицу. Меняем только пробелы в текстовых узлах.
const SHORT = /(^|[\s\u00A0(«„"])([А-Яа-яЁё]{1,3})[ \t\n]+(?=\S)/g;
const DASH = /[ \t\n]+(—|–)/g;
const ABBR = /(^|[\s\u00A0,])(стр|корп|пав|ул|пр|бул|д|к)\.[ \t\n]+/g;
const UNIT = /(\d)[ \t\n]+(?=(?:кг|г|мл|л|шт|см|мин|₽)(?![А-Яа-яЁё]))/g;
function nbspText(t) {
  let prev;
  do { prev = t; t = t.replace(SHORT, '$1$2\u00A0'); } while (t !== prev);
  return t.replace(DASH, '\u00A0$1').replace(UNIT, '$1\u00A0').replace(ABBR, '$1$2.\u00A0');
}
function nbsp(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: n => n.parentElement && n.parentElement.closest('script,style') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach(n => { const v = nbspText(n.nodeValue); if (v !== n.nodeValue) n.nodeValue = v; });
}

let toastTimer;
function toast(text) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.classList.add('on');
  el.innerHTML = text;
  nbsp(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('on'), 4200);
}

// Переход на маркетплейс. Ссылка открывается штатно, в новой вкладке: Safari на iOS
// разрешает открыть вкладку только в момент нажатия и блокирует любое отложенное открытие.
// Поэтому адрес кладём в буфер синхронно, а тост остаётся на странице — его видно,
// когда человек возвращается с маркетплейса.
function handoff(addr, platform) {
  const el = document.getElementById('toast');
  if (!el) return;
  clearTimeout(toastTimer);
  const html = `<span class="t-head">Пункт выдачи приюта</span>`
    + `<b>${esc(addr)}</b>`
    + `<span class="t-load">На ${esc(platform)} найдите его на карте пунктов выдачи. Адрес уже в буфере</span>`;
  el.classList.add('wide', 'on');
  el.innerHTML = html;
  nbsp(el);
  toastTimer = setTimeout(() => el.classList.remove('on'), 12000);
}

// Липкий заголовок карточки: убираем скругление, когда он прилип посреди карточки
function markStuck() {
  document.querySelectorAll('.folder').forEach(f => {
    const r = f.getBoundingClientRect();
    f.querySelector('.head').classList.toggle('stuck', r.top < 0 && r.bottom > 80);
  });
}
let stuckRaf;
window.addEventListener('scroll', () => {
  cancelAnimationFrame(stuckRaf);
  stuckRaf = requestAnimationFrame(markStuck);
}, { passive: true });

const isConstant = it => it.type === 'constant';
const isOpen = it => isConstant(it) || it.bought < it.need;
const closedThisWeek = it => !isOpen(it) && (!it.closed_at || Date.now() - new Date(it.closed_at) < WEEK);

function ring(it) {
  const icon = `<span class="ic ic-${isOpen(it) ? esc(it.category || 'food') : 'check'}" aria-hidden="true"></span>`;
  if (isConstant(it)) return `<span class="ring const" aria-hidden="true"><span>${icon}</span></span>`;
  if (!isOpen(it)) return `<span class="ring done" aria-hidden="true"><span>${icon}</span></span>`;
  const p = Math.round(it.bought / it.need * 100);
  return `<span class="ring" style="--p:${p}" aria-hidden="true"><span>${icon}</span></span>`;
}

const counter = it => isConstant(it)
  ? '<span aria-hidden="true">∞</span><span class="sr-only">нужно постоянно</span>'
  : `${it.bought} из ${it.need}`;

function position(it, shelter, opts = {}) {
  const pvz = (shelter.pvz || []).find(p => p.platform === it.platform);
  const addr = pvz && pvz.address ? pvz.address : '';
  const buy = opts.buy === false ? '' :
    `<a class="buy" href="${esc(outLink(it.url, shelter.slug, 'buy'))}" target="_blank" rel="noopener" data-track="buy" data-slug="${shelter.slug}" data-addr="${esc(addr)}" data-platform="${PLATFORM_ON[it.platform] || ''}" aria-label="Купить: ${esc(it.title)} для ${esc(shelter.name)}, ${formatPrice(it.price)} на ${PLATFORM_ON[it.platform] || ''}. Откроется в новой вкладке">Купить на ${PLATFORM_ON[it.platform] || ''}<small>за ${formatPrice(it.price)}</small></a>`;
  const note = opts.noteOverride || it.note;
  return `<div class="pos${opts.extra ? ' extra' : ''}${opts.buy === false ? ' nobuy' : ''}">`
    + `<span class="ind">${ring(it)}${opts.noCount || (!isConstant(it) && !it.bought) ? '' : `<span class="cnt${isConstant(it) ? ' inf' : ''}">${counter(it)}</span>`}</span>`
    + `<span class="txt"><b>${esc(it.title)}</b><span class="muted">${esc(note)}</span></span>`
    + buy + `</div>`;
}

function folder(s, i, deliveredCount) {
  const open = s.items.filter(isOpen);
  const rest = open.length - VISIBLE;
  const pvz = s.pvz.map(p => {
    const name = `<b>${PLATFORM[p.platform] || p.platform}</b>`;
    return p.address
      ? `<li><span>${name} · ${esc(p.address)}</span><button type="button" class="copy" data-copy="${esc(p.address)}" aria-label="Скопировать адрес ${esc(p.address)}"><span class="ic ic-copy" aria-hidden="true"></span><i>Скопировать</i></button></li>`
      : `<li><span>${name} · <span class="tbd">адрес уточняем с волонтёрами</span></span></li>`;
  }).join('');
  const links = s.links.map(l => `<a href="${esc(outLink(l.url, s.slug, 'groups'))}" target="_blank" rel="noopener" data-track="groups" data-slug="${s.slug}">${esc(l.label)}</a>`).join('');
  const delivered = deliveredCount
    ? `<a class="rowlink" href="#delivered"><span>Доехало ${deliveredCount} ${plural(deliveredCount, 'посылка', 'посылки', 'посылок')}</span><span class="ic ic-arrow-right" aria-hidden="true"></span></a>` : '';

  return `<article class="folder" id="${s.slug}">
    <header class="head">
      ${s.type ? `<p class="cap kind">${esc(s.type)}</p>` : ''}
      <h3 class="head-name">${esc(s.tab || s.name)}</h3>
      <div class="meta">
        <span class="muted">${esc(s.who)}</span>
        <span class="cap">обновлён ${formatDate(s.updated)}</span>
      </div>
    </header>
    <div class="sheet">
      <div class="body" id="body-${s.slug}">
        <div class="list" id="list-${s.slug}">
          <p class="cap">Нужно сейчас · ${open.length} ${plural(open.length, 'позиция', 'позиции', 'позиций')}</p>
          ${open.slice(0, VISIBLE).map(it => position(it, s)).join('')}
          ${rest > 0 ? `<div class="acc" id="extra-${s.slug}" style="height:0px"><div class="acc-in">${open.slice(VISIBLE).map(it => position(it, s, { extra: true })).join('')}</div></div>` : ''}
          ${rest > 0 ? `<button type="button" class="more" data-rest="${rest}" aria-expanded="false" aria-controls="extra-${s.slug}">Ещё ${rest} ${plural(rest, 'позиция', 'позиции', 'позиций')}</button>` : ''}
        </div>
        <div class="pvz"><p class="cap">Пункты выдачи</p><ul>${pvz}</ul></div>
        ${links ? `<button type="button" class="rowlink" data-toggle="links" aria-expanded="false" aria-controls="links-${s.slug}"><span>${/волонт/i.test(s.type || '') ? 'Где проверить команду' : 'Где проверить приют'}</span><span class="ic ic-chevron-down" aria-hidden="true"></span></button>
        <div class="acc" id="links-${s.slug}" style="height:0px"><div class="acc-in"><div class="links">${links}</div></div></div>` : ''}
        ${delivered}
      </div>
    </div>
  </article>`;
}

function goToFolder(el) {
  if (el) el.scrollIntoView({ block: 'start' });
}

function render(data, delivered) {
  const shelters = data.shelters;

  // ссылки на канал и чат
  document.querySelectorAll('[data-link]').forEach(a => {
    const url = a.dataset.link === 'chat' ? data.chat_url : data.channel_url;
    a.href = outLink(url, '', a.dataset.link);
    a.dataset.track = a.dataset.link;
  });

  // папки
  const counts = {};
  delivered.forEach(d => { counts[d.shelter] = (counts[d.shelter] || 0) + 1; });
  const lists = document.getElementById('lists');
  lists.innerHTML = shelters.map((s, i) => folder(s, i, counts[s.slug] || 0)).join('');
  lists.querySelectorAll('.folder').forEach(f => { f.classList.add('rv'); f.dataset.rv = 'scroll'; });
  watchReveal(lists);

  // карточка первого экрана и «от N ₽»
  const allOpen = shelters.flatMap(s => s.items.filter(isOpen).map(it => ({ it, s })));
  // карточка первого экрана: первая открытая позиция первого получателя
  const firstShelter = shelters.find(s => s.items.some(isOpen));
  const hero = firstShelter ? { s: firstShelter, it: firstShelter.items.find(isOpen) } : null;
  const need = document.getElementById('hero-need');
  if (hero) {
    need.href = '#' + hero.s.slug;
    need.innerHTML = `<span class="cap"><span>${esc(hero.s.tab || hero.s.name)} · обновлён ${formatDate(hero.s.updated)}</span><span class="ic ic-arrow-right" aria-hidden="true"></span></span>` +
      position(hero.it, hero.s, { buy: false, noCount: true });
    need.classList.add('rv');
    need.classList.remove('need-wait');
    need.removeAttribute('aria-hidden');
    need.removeAttribute('tabindex');
    needReady = true;
    revealNeed();
  }
  if (!hero) need.hidden = true;
  if (allOpen.length) {
    const min = Math.min(...allOpen.map(x => x.it.price));
    document.getElementById('min-price').textContent = ' · от ' + formatPrice(min);
  }

  // что доехало
  if (delivered.length) {
    const byslug = Object.fromEntries(shelters.map(s => [s.slug, s]));
    document.getElementById('delivered-grid').innerHTML = delivered.map(d =>
      `<figure><img src="${esc(d.photo)}" alt="${esc(d.item)}" loading="lazy"><figcaption><b>${esc(d.item)}</b>${esc((byslug[d.shelter] || {}).tab || d.shelter)} · ${formatDate(d.date)}${d.donor ? ' · ' + esc(d.donor) : ''}</figcaption></figure>`).join('');
    document.getElementById('delivered').hidden = false;
  }

  // закрыто на этой неделе
  const closed = shelters.flatMap(s => s.items.filter(closedThisWeek).map(it => ({ it, s })));
  if (closed.length) {
    document.getElementById('closed-list').innerHTML = closed.map(x =>
      position(x.it, x.s, { buy: false, noteOverride: x.s.tab || x.s.name })).join('');
    document.getElementById('closed').hidden = false;
  }

  // удобнее деньгами
  const money = shelters.filter(s => s.money_url);
  document.getElementById('money-links').innerHTML = money.map(s =>
    `<a href="${esc(outLink(s.money_url, s.slug, 'money'))}" target="_blank" rel="noopener" data-track="money" data-slug="${s.slug}">${esc(s.tab || s.name)}</a>`).join(', ');
  document.getElementById('money-line').hidden = !money.length;

  nbsp(document.body);

  // переход по якорю из поста в канале
  const fromHash = document.getElementById(location.hash.slice(1));
  if (fromHash && fromHash.classList.contains('folder')) goToFolder(fromHash);
}

document.addEventListener('click', e => {
  const t = e.target.closest('.more, .copy, [data-toggle], [data-track], .buy');
  if (!t) return;

  if (t.matches('.more')) {
    const all = t.getAttribute('aria-expanded') !== 'true';
    const n = +t.dataset.rest;
    t.textContent = all ? 'Свернуть' : `Ещё ${n} ${plural(n, 'позиция', 'позиции', 'позиций')}`;
    t.setAttribute('aria-expanded', all);
    slide(document.getElementById(t.getAttribute('aria-controls')), all);
    return;
  }

  if (t.matches('.copy')) {
    trackClick('copy', t.closest('.folder')?.id || '');
    // человек уже нажимал «Купить» и вернулся за адресом вручную — автокопирование для него не сработало
    if (window.__boughtAt && Date.now() - window.__boughtAt < 10 * 60 * 1000) trackClick('copy_after_buy', t.closest('.folder')?.id || '');
    copyText(t.dataset.copy);
    t.classList.add('ok');
    toast('Адрес скопирован<b>' + esc(t.dataset.copy) + '</b>');
    setTimeout(() => t.classList.remove('ok'), 1500);
    return;
  }

  if (t.dataset.toggle === 'links') {
    if (t.getAttribute('aria-expanded') !== 'true') trackClick('verify', t.getAttribute('aria-controls').replace('links-', ''));
    const on = t.getAttribute('aria-expanded') !== 'true';
    t.setAttribute('aria-expanded', on);
    slide(document.getElementById(t.getAttribute('aria-controls')), on);
    return;
  }

  if (t.matches('.buy')) {
    window.__boughtAt = Date.now();
    const addr = t.dataset.addr;
    if (addr) {
      // не отменяем переход: вкладка должна открыться тем же нажатием
      copyText(addr);
      handoff(addr, t.dataset.platform);
    }
  }

  if (t.dataset.track) trackClick(t.dataset.track, t.dataset.slug || '');
});

// ——— Анимации (как в проекте М) ———
const CALM = matchMedia('(prefers-reduced-motion: reduce)').matches;
const MS = 800;

function revealIn(el, delay) {
  el.style.setProperty('--d', (delay || 0) + 'ms');
  el.classList.add('in');
}

// первый экран: сначала иллюстрация (только из размытия, без сдвига), потом шапка и заголовок, подзаголовок, кнопка
let heroT0 = null, needReady = false;
function revealHero() {
  heroT0 = performance.now();
  document.querySelectorAll('[data-rv="hero"]').forEach(el => revealIn(el, CALM ? 0 : +el.dataset.d || 0));
  revealNeed();
}
// карточка — через 900 от начала первого экрана, до кнопки (1300); данные могут прийти раньше или позже
function revealNeed() {
  if (heroT0 === null || !needReady) return;
  revealIn(document.getElementById('hero-need'), CALM ? 0 : Math.max(0, heroT0 + 900 - performance.now()));
}

// остальное — при доскролле
const scrollIO = 'IntersectionObserver' in window && !CALM
  ? new IntersectionObserver(entries => entries.forEach(en => {
      if (!en.isIntersecting) return;
      revealIn(en.target, +en.target.dataset.d || 0);
      scrollIO.unobserve(en.target);
    }), { threshold: 0.12, rootMargin: '0px 0px -8% 0px' })
  : null;
function watchReveal(root) {
  (root || document).querySelectorAll('[data-rv="scroll"]:not(.in)').forEach(el =>
    scrollIO ? scrollIO.observe(el) : revealIn(el, 0));
}

// Раскрытие блока: высота + появление содержимого (сдвиг и прозрачность), 800 мс
// wrap — .acc, внутри один .acc-in
function slide(wrap, show, done) {
  const inner = wrap.firstElementChild;
  clearTimeout(wrap._t);
  if (CALM) {
    wrap.style.height = show ? 'auto' : '0px';
    inner.classList.toggle('shown', show);
    if (done) done();
    return;
  }
  const from = wrap.offsetHeight;
  const to = show ? inner.offsetHeight : 0;
  wrap.style.transition = 'none';
  wrap.style.height = from + 'px';
  void wrap.offsetWidth;
  wrap.style.transition = `height ${MS}ms var(--ease-expo)`;
  wrap.style.height = to + 'px';
  inner.classList.toggle('shown', show);
  wrap._t = setTimeout(() => {
    if (show) { wrap.style.transition = 'none'; wrap.style.height = 'auto'; }
    if (done) done();
  }, MS);
}

// Аккордеон в блоке доверия: высота + появление текста, открыт один
function setupAccordion() {
  const items = [...document.querySelectorAll('.page details')];
  const timers = new WeakMap();
  items.forEach(d => {
    // всё содержимое пункта (там может быть несколько абзацев) — в одну обёртку
    const wrap = document.createElement('div');
    wrap.className = 'acc';
    const p = document.createElement('div');
    p.className = 'acc-in';
    p.append(...[...d.children].filter(el => el.tagName !== 'SUMMARY'));
    wrap.append(p);
    d.append(wrap);
    if (d.open) { d.classList.add('is-open'); p.classList.add('shown'); }
    else wrap.style.height = '0px';
    d.querySelector('summary').addEventListener('click', e => {
      e.preventDefault();
      if (d.classList.contains('is-open')) close(d);
      else { items.forEach(o => o !== d && o.classList.contains('is-open') && close(o)); open(d); }
    });
  });
  function parts(d) { const w = d.querySelector('.acc'); return [w, w.firstElementChild]; }
  function open(d) {
    const [w, p] = parts(d);
    clearTimeout(timers.get(d));
    const from = d.open ? w.offsetHeight : 0;
    d.open = true;
    d.classList.add('is-open');
    if (CALM) { w.style.height = 'auto'; p.classList.add('shown'); return; }
    const h = p.offsetHeight;
    w.style.transition = 'none';
    w.style.height = from + 'px';
    void w.offsetWidth;
    w.style.transition = `height ${MS}ms var(--ease-expo)`;
    w.style.height = h + 'px';
    p.classList.add('shown');
    timers.set(d, setTimeout(() => { w.style.transition = 'none'; w.style.height = 'auto'; }, MS));
  }
  function close(d) {
    const [w, p] = parts(d);
    clearTimeout(timers.get(d));
    d.classList.remove('is-open');
    if (CALM) { w.style.height = '0px'; p.classList.remove('shown'); d.open = false; return; }
    w.style.transition = 'none';
    w.style.height = w.offsetHeight + 'px';
    void w.offsetWidth;
    w.style.transition = `height ${MS}ms var(--ease-expo)`;
    w.style.height = '0px';
    p.classList.remove('shown');
    timers.set(d, setTimeout(() => { d.open = false; }, MS));
  }
}

window.addEventListener('hashchange', () => {
  const el = document.getElementById(location.hash.slice(1));
  if (el && el.classList.contains('folder')) goToFolder(el);
});

const SKELETON = '<div class="folder sk" aria-hidden="true"><div class="sk-b" style="width:40%"></div><div class="sk-b" style="width:70%;height:24px"></div><div class="sk-b" style="width:55%"></div><div class="sk-b" style="height:48px;border-radius:16px"></div><div class="sk-b" style="height:48px;border-radius:16px"></div></div>';

function load() {
  document.getElementById('lists').innerHTML = SKELETON.repeat(2);
  return Promise.all([
    // списки всегда берём свежие: браузер на телефоне иначе может сутками показывать сохранённую копию
    fetch('data/shelters.json?t=' + Date.now(), { cache: 'no-store' }).then(r => r.json()),
    fetch('data/delivered.json?t=' + Date.now(), { cache: 'no-store' }).then(r => r.json()).catch(() => []),
  ]).then(([data, delivered]) => render(data, Array.isArray(delivered) ? delivered : []))
    .catch(() => {
      // чат — единственный запасной канал связи, он должен работать и без данных
      document.getElementById('money-line').hidden = true;
      document.querySelectorAll('[data-link]').forEach(a => { a.href = FALLBACK_CHAT; });
      document.getElementById('lists').innerHTML =
        '<div class="load-error" role="alert"><p>Не получилось загрузить списки.</p>'
        + '<button type="button" class="more" id="retry">Попробовать снова</button></div>';
      document.getElementById('retry').addEventListener('click', load);
    });
}
// показываем первый экран, когда догрузились шрифты: иначе текст над иллюстрацией
// перестраивается под новый шрифт и сдвигает её вниз
// ...и когда иллюстрации полностью скачаны и раскодированы: иначе они проявляются кусками.
// Ждём не дольше 1,5 с, чтобы медленная сеть не держала пустой экран
const heroImgs = [...document.querySelectorAll('.duo img')].map(img =>
  (img.complete && img.naturalWidth ? Promise.resolve() : new Promise(r => { img.onload = img.onerror = r; }))
    .then(() => img.decode ? img.decode().catch(() => {}) : null));
Promise.race([
  Promise.all([document.fonts ? document.fonts.ready : Promise.resolve(), ...heroImgs]),
  new Promise(r => setTimeout(r, 1500)),
]).then(() => revealHero());
watchReveal();
setupAccordion();
window.__lapkiReady = true;
load();

// плашка cookie: показываем один раз, согласие храним в localStorage
(() => {
  const el = document.getElementById('cookie');
  if (!el) return;
  let seen = false;
  try { seen = localStorage.getItem('lapki-cookie') === '1'; } catch (e) {}
  if (seen) return;
  el.hidden = false;
  document.getElementById('cookie-ok').addEventListener('click', () => {
    el.hidden = true;
    try { localStorage.setItem('lapki-cookie', '1'); } catch (e) {}
  });
})();
