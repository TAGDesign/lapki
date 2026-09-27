// Лапки: страница рендерится из data/shelters.json и data/delivered.json

const FALLBACK_CHAT = 'https://t.me/designta';
const PLATFORM = { ozon: 'Ozon', market: 'Маркет', wb: 'WB' };
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

function trackClick(kind, slug) {
  // место для ym(ID, 'reachGoal', kind, { shelter: slug })
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
  const html = `<span class="t-head">Адрес пункта выдачи скопирован</span>`
    + `<b>${esc(addr)}</b>`
    + `<span class="t-load">Вставьте его в поле доставки на ${esc(platform)}</span>`;
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
    `<a class="buy" href="${esc(outLink(it.url, shelter.slug, 'buy'))}" target="_blank" rel="noopener" data-track="buy" data-slug="${shelter.slug}" data-addr="${esc(addr)}" aria-label="Купить: ${esc(it.title)} для ${esc(shelter.name)}, ${formatPrice(it.price)} на ${PLATFORM[it.platform] || ''}. Откроется в новой вкладке">Купить<small>${formatPrice(it.price)} · ${PLATFORM[it.platform] || ''}</small></a>`;
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
          ${open.map((it, n) => position(it, s, { extra: n >= VISIBLE })).join('')}
          ${rest > 0 ? `<button type="button" class="more" data-rest="${rest}" aria-expanded="false" aria-controls="list-${s.slug}">Ещё ${rest} ${plural(rest, 'позиция', 'позиции', 'позиций')}</button>` : ''}
        </div>
        <div class="pvz"><p class="cap">Пункты выдачи</p><ul>${pvz}</ul></div>
        ${links ? `<button type="button" class="rowlink" data-toggle="links" aria-expanded="false" aria-controls="links-${s.slug}"><span>Группы и отчёты приюта</span><span class="ic ic-chevron-down" aria-hidden="true"></span></button>
        <div class="links" id="links-${s.slug}">${links}</div>` : ''}
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
    need.hidden = false;
  }
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
    const list = t.closest('.list');
    const all = list.classList.toggle('all');
    const n = +t.dataset.rest;
    t.textContent = all ? 'Свернуть' : `Ещё ${n} ${plural(n, 'позиция', 'позиции', 'позиций')}`;
    t.setAttribute('aria-expanded', all);
    if (all) {
      const first = list.querySelector('.pos.extra');
      const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (first) first.scrollIntoView({ block: 'center', behavior: calm ? 'auto' : 'smooth' });
    }
    return;
  }

  if (t.matches('.copy')) {
    if (navigator.clipboard) navigator.clipboard.writeText(t.dataset.copy).catch(() => {});
    t.classList.add('ok');
    toast('Адрес скопирован<b>' + esc(t.dataset.copy) + '</b>');
    setTimeout(() => t.classList.remove('ok'), 1500);
    return;
  }

  if (t.dataset.toggle === 'links') {
    const on = t.nextElementSibling.classList.toggle('on');
    t.setAttribute('aria-expanded', on);
    return;
  }

  if (t.matches('.buy')) {
    const addr = t.dataset.addr;
    if (addr) {
      // не отменяем переход: вкладка должна открыться тем же нажатием
      if (navigator.clipboard) navigator.clipboard.writeText(addr).catch(() => {});
      handoff(addr, t.querySelector('small').textContent.split('·').pop().trim());
    }
  }

  if (t.dataset.track) trackClick(t.dataset.track, t.dataset.slug || '');
});

// В блоке доверия открыт только один пункт
document.addEventListener('toggle', e => {
  const d = e.target;
  if (d.tagName !== 'DETAILS' || !d.open) return;
  d.parentElement.querySelectorAll('details[open]').forEach(o => { if (o !== d) o.open = false; });
}, true);

window.addEventListener('hashchange', () => {
  const el = document.getElementById(location.hash.slice(1));
  if (el && el.classList.contains('folder')) goToFolder(el);
});

function load() {
  document.getElementById('lists').innerHTML = '';
  return Promise.all([
    fetch('data/shelters.json').then(r => r.json()),
    fetch('data/delivered.json').then(r => r.json()).catch(() => []),
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
load();
