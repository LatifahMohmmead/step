(() => {
  'use strict';

  /* ---------------- data ---------------- */
  const SECTIONS = {
    grammar: { key: 'grammar', en: 'Grammar', ar: 'القواعد', models: (window.QUIZ_DATA || []).slice().sort((a, b) => a.id - b.id) },
    reading: { key: 'reading', en: 'Reading', ar: 'القراءة', models: (window.READING_DATA || []).slice().sort((a, b) => a.id - b.id) },
    listening: { key: 'listening', en: 'Listening', ar: 'الاستماع', models: (window.LISTENING_DATA || []).slice().sort((a, b) => a.id - b.id) },
  };
  // final exams: 100 questions = 40 grammar + 20 listening + 40 reading (built by tools/build-exams.js)
  const EXAM_PARTS = [['grammar', 40], ['listening', 20], ['reading', 40]];
  const EXAMS = (window.EXAM_DATA || []).slice().sort((a, b) => a.id - b.id);
  const EXAM_TAB = { key: 'exam', en: 'Final Exams', ar: 'نماذج الاختبار' };
  const EXAM_KINDS = ['exam', 'examRandom'];
  const LETTERS = ['A', 'B', 'C', 'D'];
  const STORE_KEY = 'stepquiz.v1';
  const app = document.getElementById('app');

  /* ---------------- storage (safe) ---------------- */
  const defaultState = () => ({ best: {}, last: {}, attempts: {}, mistakes: {}, examLast: {}, prefs: { shuffleQ: false, shuffleO: false, section: 'grammar', translate: false, hints: false, examBlind: false }, v: 2 });
  let store = defaultState();
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const old = JSON.parse(raw);
      store = Object.assign(defaultState(), old);
      store.prefs = Object.assign(defaultState().prefs, old.prefs || {});
      if (!old.v) { // migrate v1 (grammar only) keys
        ['best', 'last', 'attempts'].forEach((k) => {
          const o = {}; Object.entries(store[k] || {}).forEach(([id, v]) => { o['grammar:' + id] = v; }); store[k] = o;
        });
        const mk = {}; Object.keys(store.mistakes || {}).forEach((k) => { mk['grammar:' + k] = 1; }); store.mistakes = mk;
        store.v = 2;
      }
    }
  } catch (e) { /* storage unavailable */ }
  const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) {} };
  const isExamTab = () => store.prefs.section === 'exam' && EXAMS.length > 0;
  if (!SECTIONS[store.prefs.section] && !isExamTab()) store.prefs.section = 'grammar';

  /* ---------------- helpers ---------------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const tpl = (id) => document.getElementById(id).content.cloneNode(true);
  const shuffle = (arr) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  };
  const sec = () => SECTIONS[store.prefs.section];
  const mKey = (s, mid) => s + ':' + mid;
  const qKey = (s, mid, n) => s + ':' + mid + '-' + n;
  const findModel = (s, mid) => SECTIONS[s].models.find((x) => x.id === mid);
  const modelName = (s, mid) => { const m = findModel(s, mid); return (m && m.name) || `Model ${mid}`; };
  const mkItem = (s, m, q) => ({ sec: s, mid: m.id, q, passage: m.passages ? m.passages[q.p] : null });
  const findQ = (key) => {
    const m1 = key.match(/^(\w+):(\d+)-(\d+)$/);
    if (!m1 || !SECTIONS[m1[1]]) return null;
    const m = findModel(m1[1], +m1[2]);
    const q = m && m.questions.find((x) => x.n === +m1[3]);
    return q ? mkItem(m1[1], m, q) : null;
  };
  const level = (pct) => (pct >= 80 ? 'good' : pct >= 60 ? 'mid' : 'low');
  const levelColor = (pct) => (pct >= 80 ? 'var(--ok)' : pct >= 60 ? 'var(--warn)' : 'var(--bad)');
  const fmtTime = (ms) => { const s = Math.round(ms / 1000); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const countQ = (s) => SECTIONS[s].models.reduce((n, m) => n + m.questions.length, 0);
  const secBest = (s) => Object.entries(store.best).filter(([k]) => k.startsWith(s + ':')).map(([, v]) => v);

  function renderTopStats() {
    if (isExamTab()) {
      const vals = Object.entries(store.best).filter(([k]) => k.startsWith('exam:')).map(([, v]) => v);
      const avg = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
      $('#topStats').innerHTML =
        `<span class="chip">${EXAM_TAB.ar} · المختبرة: <b>${vals.length}/${EXAMS.length}</b></span>` +
        (avg !== null ? `<span class="chip">المتوسط: <b dir="ltr">${avg}%</b></span>` : '');
      return;
    }
    const s = sec();
    const vals = secBest(s.key);
    const avg = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
    $('#topStats').innerHTML =
      `<span class="chip">${s.ar} · المختبرة: <b>${vals.length}/${s.models.length}</b></span>` +
      (avg !== null ? `<span class="chip">المتوسط: <b dir="ltr">${avg}%</b></span>` : '');
  }

  /* ---------------- HOME ---------------- */
  let filter = 'all';
  function showHome() {
    session = null;
    stopTimer();
    app.innerHTML = '';
    app.appendChild(tpl('tpl-home'));
    window.scrollTo(0, 0);
    renderTopStats();

    // section tabs
    const tabs = $('#secTabs');
    const tabList = Object.values(SECTIONS).map((x) => ({ ...x, sub: `${x.models.length} نموذج · ${countQ(x.key)} سؤال` }));
    if (EXAMS.length) tabList.push({ ...EXAM_TAB, sub: `${EXAMS.length} نموذج · 100 سؤال لكل نموذج`, cls: ' exam-tab' });
    tabList.forEach((x) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'sec-tab' + (x.cls || '') + (x.key === store.prefs.section ? ' active' : '');
      b.innerHTML = `<span class="sec-en" dir="ltr">${x.en}</span><span class="sec-ar">${x.ar}</span><small>${x.sub}</small>`;
      b.onclick = () => { if (x.key !== store.prefs.section) { store.prefs.section = x.key; save(); filter = 'all'; showHome(); } };
      tabs.appendChild(b);
    });

    if (isExamTab()) { showExamHome(); return; }
    const s = sec();

    $('#heroTitle').textContent = `اختر نموذج ${s.ar} الذي تريد الاختبار فيه`;
    $('#heroSub').textContent = s.key === 'reading'
      ? 'كل سؤال يظهر مع القطعة الخاصة به. يمكنك إظهار ترجمة السؤال والتلميحات (الجمل المظللة في القطعة) من داخل الاختبار.'
      : s.key === 'listening'
        ? 'أسئلة الاستماع من التجميعات (بدون ملفات صوتية) — مفيدة لحفظ الأسئلة وإجاباتها. يظهر رقم التسجيل وموضوعه فوق كل سؤال.'
        : 'اختر نموذجاً لتبدأ، ويمكنك إعادة أي اختبار متى شئت.';

    const sq = $('#optShuffleQ'), so = $('#optShuffleO');
    sq.checked = !!store.prefs.shuffleQ; so.checked = !!store.prefs.shuffleO;
    sq.onchange = () => { store.prefs.shuffleQ = sq.checked; save(); };
    so.onchange = () => { store.prefs.shuffleO = so.checked; save(); };
    $('#shuffleQLabel').textContent = s.key === 'reading' ? 'خلط ترتيب القطع' : 'خلط ترتيب الأسئلة';

    app.querySelectorAll('.seg-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.filter === filter);
      b.onclick = () => { filter = b.dataset.filter; app.querySelectorAll('.seg-btn').forEach((x) => x.classList.toggle('active', x === b)); renderGrid(); };
    });
    renderGrid();

    $('#randomSub').textContent = s.key === 'reading' ? '40 سؤال مختلط من قطع جميع النماذج' : '40 سؤال مختلط من جميع النماذج';
    $('#randomBtn').onclick = () => startRandom(s.key);
    const mk = Object.keys(store.mistakes).filter((k) => k.startsWith(s.key + ':')).filter(findQ);
    $('#mistakesSub').textContent = mk.length ? `${mk.length} سؤال أخطأت فيه سابقاً — يُحذف عند إجابته صحيحاً` : 'لا توجد أخطاء محفوظة بعد';
    $('#mistakesBtn').disabled = !mk.length;
    $('#mistakesBtn').onclick = () => {
      const items = mk.map(findQ).filter(Boolean);
      if (items.length) startQuiz({ kind: 'mistakes', sec: s.key, title: `بنك أخطائي — ${s.ar}`, items: groupOrder(shuffle(items)) });
    };
  }

  function renderGrid() {
    if (isExamTab()) { renderExamGrid(); return; }
    const s = sec();
    const grid = $('#modelGrid');
    grid.innerHTML = '';
    const list = s.models.filter((m) => {
      const b = store.best[mKey(s.key, m.id)];
      if (filter === 'todo') return b === undefined;
      if (filter === 'weak') return b !== undefined && b < 80;
      if (filter === 'done') return b !== undefined && b >= 80;
      return true;
    });
    if (!list.length) { grid.innerHTML = '<div class="empty">لا توجد نماذج في هذا التصنيف</div>'; return; }
    list.forEach((m) => {
      const k = mKey(s.key, m.id);
      const best = store.best[k], last = store.last[k], tries = store.attempts[k] || 0;
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'mcard';
      const badge = best === undefined ? '<span class="badge">جديد</span>' : `<span class="badge ${level(best)}" dir="ltr">${best}%</span>`;
      const extra = m.passages ? ` · ${new Set(m.questions.map((q) => q.p)).size} قطعة` : '';
      card.innerHTML = `
        <div class="m-top"><span class="m-name" dir="ltr">${esc(m.name || 'Model ' + m.id)}</span>${badge}</div>
        <div class="m-count">${m.questions.length} سؤال${extra}</div>
        <div class="mini-bar"><span style="width:${best || 0}%;background:${best === undefined ? 'transparent' : levelColor(best)}"></span></div>
        <div class="m-foot"><span>${tries ? 'محاولات: ' + tries : 'لم يُختبر بعد'}</span><span>${last !== undefined ? 'آخر: <bdi dir="ltr">' + last + '%</bdi>' : ''}</span></div>`;
      card.onclick = () => startModel(s.key, m.id);
      grid.appendChild(card);
    });
  }

  /* ---------------- FINAL EXAMS (home) ---------------- */
  const pctOf = (ok, n) => (n ? Math.round((ok / n) * 100) : 0);

  function showExamHome() {
    $('#heroTitle').textContent = 'نماذج الاختبار النهائي';
    $('#heroSub').textContent = `${EXAMS.length} نموذج، كل نموذج 100 سؤال بالترتيب: 40 قواعد ثم 20 استماع ثم 40 قراءة. ` +
      'فعّل «وضع الاختبار الحقيقي» لإخفاء صحة الإجابة حتى النهاية كما في الاختبار الفعلي. (أسئلة الاستماع بدون ملفات صوتية)';

    const sq = $('#optShuffleQ'), so = $('#optShuffleO'), bl = $('#optBlind');
    $('#blindWrap').hidden = false;
    sq.checked = !!store.prefs.shuffleQ; so.checked = !!store.prefs.shuffleO; bl.checked = !!store.prefs.examBlind;
    sq.onchange = () => { store.prefs.shuffleQ = sq.checked; save(); };
    so.onchange = () => { store.prefs.shuffleO = so.checked; save(); };
    bl.onchange = () => { store.prefs.examBlind = bl.checked; save(); };
    $('#shuffleQLabel').textContent = 'خلط الأسئلة داخل كل قسم';

    app.querySelectorAll('.seg-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.filter === filter);
      b.onclick = () => { filter = b.dataset.filter; app.querySelectorAll('.seg-btn').forEach((x) => x.classList.toggle('active', x === b)); renderExamGrid(); };
    });
    renderExamGrid();

    $('#randomTitle').textContent = 'نموذج نهائي عشوائي جديد';
    $('#randomSub').textContent = '100 سؤال جديد كل مرة (40 قواعد · 20 استماع · 40 قراءة) من كل البنوك';
    $('#randomBtn').onclick = startRandomExam;

    const mk = Object.keys(store.mistakes).filter(findQ);
    $('#mistakesTitle').textContent = 'بنك أخطائي — كل الأقسام';
    $('#mistakesSub').textContent = mk.length ? `${mk.length} سؤال (قواعد + استماع + قراءة) — يُحذف عند إجابته صحيحاً` : 'لا توجد أخطاء محفوظة بعد';
    $('#mistakesBtn').disabled = !mk.length;
    $('#mistakesBtn').onclick = () => {
      const items = mk.map(findQ).filter(Boolean);
      const order = EXAM_PARTS.map(([p]) => p);
      const bySec = order.map((p) => groupOrder(shuffle(items.filter((it) => it.sec === p)))).flat();
      if (bySec.length) startQuiz({ kind: 'mistakes', sec: 'exam', mixed: true, title: 'بنك أخطائي — كل الأقسام', items: bySec });
    };
  }

  function renderExamGrid() {
    const grid = $('#modelGrid');
    grid.innerHTML = '';
    const list = EXAMS.filter((e) => {
      const b = store.best['exam:' + e.id];
      if (filter === 'todo') return b === undefined;
      if (filter === 'weak') return b !== undefined && b < 80;
      if (filter === 'done') return b !== undefined && b >= 80;
      return true;
    });
    if (!list.length) { grid.innerHTML = '<div class="empty">لا توجد نماذج في هذا التصنيف</div>'; return; }
    list.forEach((e) => {
      const k = 'exam:' + e.id;
      const best = store.best[k], last = store.last[k], tries = store.attempts[k] || 0, br = store.examLast[k];
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'mcard ecard';
      const badge = best === undefined ? '<span class="badge">جديد</span>' : `<span class="badge ${level(best)}" dir="ltr">${best}%</span>`;
      const parts = br
        ? `<div class="e-parts" dir="ltr">${EXAM_PARTS.map(([p]) => `<span class="ep ${level(br[p])}" title="${SECTIONS[p].ar}">${SECTIONS[p].en[0]} ${br[p]}%</span>`).join('')}</div>`
        : `<div class="e-parts muted" dir="ltr"><span class="ep">G 40</span><span class="ep">L 20</span><span class="ep">R 40</span></div>`;
      card.innerHTML = `
        <div class="m-top"><span class="m-name" dir="ltr">Exam ${e.id}</span>${badge}</div>
        <div class="m-count">نموذج اختبار نهائي · 100 سؤال</div>
        ${parts}
        <div class="mini-bar"><span style="width:${best || 0}%;background:${best === undefined ? 'transparent' : levelColor(best)}"></span></div>
        <div class="m-foot"><span>${tries ? 'محاولات: ' + tries : 'لم يُختبر بعد'}</span><span>${last !== undefined ? 'آخر: <bdi dir="ltr">' + last + '%</bdi>' : ''}</span></div>`;
      card.onclick = () => startExam(e.id);
      grid.appendChild(card);
    });
  }

  /* ---------------- FINAL EXAMS (build items) ---------------- */
  // group key that keeps a passage / a recording together
  const unitKey = (it) => it.mid + '/' + (it.passage ? 'p' + it.q.p : it.q.r ? 'r' + it.q.r : 'n' + it.q.n);

  function shuffleUnits(items, keepTogether) {
    if (!keepTogether) return shuffle(items);
    const groups = new Map();
    items.forEach((it) => { const g = unitKey(it); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(it); });
    return shuffle([...groups.values()]).flat();
  }

  function examItems(exam) {
    const out = [];
    EXAM_PARTS.forEach(([p]) => {
      let items = (exam[p] || []).map(([mid, n]) => {
        const m = findModel(p, mid);
        const q = m && m.questions.find((x) => x.n === n);
        return q ? mkItem(p, m, q) : null;
      }).filter(Boolean);
      if (store.prefs.shuffleQ) items = shuffleUnits(items, p !== 'grammar');
      out.push(...items);
    });
    return out;
  }

  function startExam(id) {
    const e = EXAMS.find((x) => x.id === id);
    if (!e) return;
    startQuiz({ kind: 'exam', sec: 'exam', eid: id, mixed: true, title: `Final Exam ${id} · نموذج اختبار نهائي`, items: examItems(e) });
  }

  // a brand-new random final exam, drawn from the whole bank (no duplicate text inside it)
  const sig = (q) => String(q.q).replace(/<[^>]+>/g, '').toLowerCase().replace(/[^a-z0-9]/g, '') + '|' + q.o.map((o) => String(o).toLowerCase().replace(/[^a-z0-9]/g, '')).sort().join('|');
  function startRandomExam() {
    const out = [];
    EXAM_PARTS.forEach(([p, need]) => {
      const groups = new Map();
      SECTIONS[p].models.forEach((m) => m.questions.forEach((q) => {
        const it = mkItem(p, m, q);
        const g = p === 'grammar' ? 'g' + m.id + '-' + q.n : unitKey(it);
        if (!groups.has(g)) groups.set(g, []);
        groups.get(g).push(it);
      }));
      const seenQ = new Set(), seenP = new Set(), usedG = new Set();
      const pool = shuffle([...groups.values()]);
      let left = need;
      // pass 1 prefers whole passages/recordings that fit; pass 2 fills whatever is left
      [true, false].forEach((wholeOnly) => {
        for (const g of pool) {
          if (left <= 0) break;
          if (usedG.has(g)) continue;
          const ps = g[0].passage ? g[0].passage.b.filter((b) => typeof b === 'string').join('').replace(/<[^>]+>/g, '').toLowerCase().replace(/[^a-z]/g, '').slice(0, 300) : '';
          if (ps.length > 40 && seenP.has(ps)) continue; // same passage from another compilation
          const fresh = g.filter((it) => !seenQ.has(sig(it.q))).sort((a, b) => a.q.n - b.q.n);
          if (!fresh.length || (wholeOnly && fresh.length > left)) continue;
          usedG.add(g);
          if (ps.length > 40) seenP.add(ps);
          fresh.slice(0, left).forEach((it) => { seenQ.add(sig(it.q)); out.push(it); left--; });
        }
      });
    });
    startQuiz({ kind: 'examRandom', sec: 'exam', mixed: true, title: 'نموذج نهائي عشوائي · 100 سؤال', items: out });
  }

  /* ---------------- QUIZ ---------------- */
  let session = null;
  let timer = null;
  const stopTimer = () => { if (timer) { clearInterval(timer); timer = null; } };

  // keep questions of the same passage next to each other
  function groupOrder(items) {
    const groups = new Map();
    items.forEach((it) => {
      const g = it.passage ? it.mid + '/' + it.q.p : Math.random();
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(it);
    });
    return [...groups.values()].flatMap((g) => g.sort((a, b) => a.q.n - b.q.n));
  }

  function startModel(s, mid) {
    const m = findModel(s, mid);
    let items = m.questions.map((q) => mkItem(s, m, q));
    if (store.prefs.shuffleQ) {
      if (s === 'reading') {
        const groups = {};
        items.forEach((it) => { (groups[it.q.p] = groups[it.q.p] || []).push(it); });
        items = shuffle(Object.values(groups)).flat();
      } else items = shuffle(items);
    }
    startQuiz({ kind: 'model', sec: s, mid, title: `${SECTIONS[s].en} · ${modelName(s, mid)}`, items });
  }

  function startRandom(s) {
    const pool = [];
    SECTIONS[s].models.forEach((m) => m.questions.forEach((q) => pool.push(mkItem(s, m, q))));
    let items = shuffle(pool).slice(0, 40);
    if (s === 'reading') items = groupOrder(items);
    startQuiz({ kind: 'random', sec: s, title: `اختبار عشوائي — ${SECTIONS[s].ar}`, items });
  }

  function startQuiz(cfg) {
    const items = cfg.items.map((it) => {
      const base = it.q.o.map((_, i) => i);
      return { ...it, order: store.prefs.shuffleO ? shuffle(base) : base };
    });
    const isExam = EXAM_KINDS.includes(cfg.kind);
    session = { ...cfg, items, idx: 0, answers: new Array(items.length).fill(null), start: Date.now(), shownPassage: null, blind: isExam && !!store.prefs.examBlind };
    stopTimer();
    app.innerHTML = '';
    app.appendChild(tpl('tpl-quiz'));
    window.scrollTo(0, 0);
    const reading = items.some((it) => it.passage);
    $('#quizWrap').classList.toggle('with-passage', reading);
    $('#quizWrap').classList.toggle('blind', session.blind);
    // exam extras: live timer + (blind mode) answered counter instead of right/wrong
    $('#liveTimeWrap').hidden = !isExam;
    $('#liveDoneWrap').hidden = !session.blind;
    $('#liveOk').parentElement.hidden = session.blind;
    $('#liveBad').parentElement.hidden = session.blind;
    if (isExam) {
      const me = session;
      timer = setInterval(() => { if (session !== me) return stopTimer(); $('#liveTime').textContent = fmtTime(Date.now() - me.start); }, 1000);
    }
    $('#quizTitle').textContent = cfg.title;
    $('#quizTitle').setAttribute('dir', 'auto');
    $('#quitBtn').onclick = () => {
      const answered = session.answers.filter((a) => a !== null).length;
      if (answered && answered < session.items.length && !confirmLeave()) return;
      showHome();
    };
    $('#nextBtn').onclick = next;
    const dots = $('#dots');
    session.items.forEach((it, i) => {
      const d = document.createElement('i');
      if (cfg.mixed && i > 0 && session.items[i - 1].sec !== it.sec) d.dataset.b = 'brk'; // gap between sections
      dots.appendChild(d);
    });

    // toggles
    const tr = $('#trBtn'), hn = $('#hintBtn');
    const syncToggles = () => {
      tr.classList.toggle('on', !!store.prefs.translate);
      hn.classList.toggle('on', !!store.prefs.hints);
      tr.setAttribute('aria-pressed', !!store.prefs.translate);
      hn.setAttribute('aria-pressed', !!store.prefs.hints);
      $('#qTrans').hidden = !store.prefs.translate || !$('#qTrans').textContent;
      $('#passage').classList.toggle('show-hints', !!store.prefs.hints);
    };
    tr.onclick = () => { store.prefs.translate = !store.prefs.translate; save(); syncToggles(); };
    hn.onclick = () => { store.prefs.hints = !store.prefs.hints; save(); syncToggles(); };
    session.syncToggles = syncToggles;
    renderQuestion();
  }

  // inline confirm without blocking browser dialog
  let leaveArmed = false, leaveTimer;
  function confirmLeave() {
    if (leaveArmed) return true;
    leaveArmed = true;
    const b = $('#quitBtn');
    if (b) b.textContent = 'اضغط مرة أخرى للخروج';
    clearTimeout(leaveTimer);
    leaveTimer = setTimeout(() => { leaveArmed = false; if ($('#quitBtn')) $('#quitBtn').textContent = '→ النماذج'; }, 2500);
    return false;
  }

  function passageHTML(p, mid) {
    const head = `<div class="p-head"><span class="p-num" dir="ltr">Model ${mid} · Passage ${p.num || ''}</span>` +
      (p.t ? `<h3 dir="ltr">${esc(p.t)}</h3>` : '') +
      (p.ta ? `<div class="p-ar" dir="rtl">${esc(p.ta)}</div>` : '') + '</div>';
    const body = p.b.map((b) => {
      if (typeof b === 'string') return `<p>${b}</p>`;
      const im = b.img;
      return `<a class="p-fig" href="${im.src}" target="_blank" rel="noopener"><img src="${im.src}" width="${im.w}" height="${im.h}" loading="lazy" alt="Passage figure"></a>`;
    }).join('');
    return head + `<div class="p-body" dir="ltr">${body || '<p class="muted">—</p>'}</div>`;
  }

  function renderQuestion() {
    const s = session, it = s.items[s.idx], q = it.q;
    $('#qCount').textContent = `السؤال ${s.idx + 1} من ${s.items.length}`;
    // section chip (mixed sessions) + per-question passage layout / reading tools
    const qs = $('#qSec');
    if (s.mixed) {
      const same = s.items.filter((x) => x.sec === it.sec);
      qs.textContent = `${SECTIONS[it.sec].ar} ${same.indexOf(it) + 1}/${same.length}`;
      qs.className = 'qsec s-' + it.sec;
      qs.hidden = false;
    } else qs.hidden = true;
    $('#quizWrap').classList.toggle('with-passage', !!it.passage);
    $('#trBtn').hidden = !it.passage;
    $('#hintBtn').hidden = !it.passage;
    $('#qNum').textContent = (s.kind === 'model' ? '' : `${modelName(it.sec, it.mid)} · `) + `Q${q.n}`;
    $('#qCtx').textContent = q.r || '';
    $('#qCtx').hidden = !q.r;
    $('#qText').innerHTML = q.q;
    $('#qTrans').textContent = q.qa || '';
    $('#bar').style.width = (s.idx / s.items.length) * 100 + '%';

    // passage
    const pp = $('#passage');
    if (it.passage) {
      const pid = it.mid + '/' + q.p;
      if (s.shownPassage !== pid) {
        $('#passageInner').innerHTML = passageHTML(it.passage, it.mid);
        $('#passageInner').scrollTop = 0;
        pp.classList.remove('flash'); void pp.offsetWidth; pp.classList.add('flash');
        if (s.shownPassage !== null && window.innerWidth < 1000) pp.open = true;
        s.shownPassage = pid;
      }
      pp.hidden = false;
    } else pp.hidden = true;

    const fb = $('#feedback'); fb.textContent = ''; fb.className = 'feedback';
    const opts = $('#options'); opts.innerHTML = '';
    it.order.forEach((oi, pos) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'opt';
      b.dataset.oi = oi;
      b.innerHTML = `<span class="key">${LETTERS[pos]}</span><span class="otext">${q.o[oi]}</span>`;
      b.onclick = () => choose(oi);
      opts.appendChild(b);
    });
    const card = $('#qcard'); card.style.animation = 'none'; void card.offsetWidth; card.style.animation = '';
    $('#nextBtn').disabled = true;
    $('#nextBtn').textContent = s.idx === s.items.length - 1 ? 'عرض النتيجة ←' : 'التالي ←';
    s.syncToggles();
    updateLive();
  }

  function choose(oi) {
    const s = session;
    if (!s || (s.answers[s.idx] !== null && !s.blind)) return;
    const it = s.items[s.idx], q = it.q;
    const ok = oi === q.a;
    s.answers[s.idx] = oi;
    const key = qKey(it.sec, it.mid, q.n);
    if (ok) delete store.mistakes[key]; else store.mistakes[key] = 1;
    save();
    if (s.blind) { // real-exam mode: just mark the choice (can be changed until "Next")
      app.querySelectorAll('.opt').forEach((b) => b.classList.toggle('picked', Number(b.dataset.oi) === oi));
      const fb = $('#feedback');
      fb.textContent = 'تم حفظ إجابتك — يمكنك تغييرها قبل الضغط على التالي. النتيجة تظهر في النهاية.';
      fb.className = 'feedback note';
      $('#nextBtn').disabled = false;
      updateLive();
      return;
    }
    app.querySelectorAll('.opt').forEach((b) => {
      const v = Number(b.dataset.oi);
      b.disabled = true;
      if (v === q.a) b.classList.add('correct');
      else if (v === oi) b.classList.add('wrong');
      else b.classList.add('dim');
    });
    const fb = $('#feedback');
    if (ok) { fb.textContent = '✓ إجابة صحيحة'; fb.className = 'feedback ok'; }
    else {
      const pos = it.order.indexOf(q.a);
      fb.innerHTML = `✗ إجابة خاطئة — الإجابة الصحيحة هي <span dir="ltr">(${LETTERS[pos]})</span>`;
      fb.className = 'feedback bad';
    }
    $('#nextBtn').disabled = false;
    $('#nextBtn').focus({ preventScroll: true });
    updateLive();
  }

  function updateLive() {
    const s = session;
    let ok = 0, bad = 0;
    const dots = $('#dots').children;
    let done = 0;
    s.items.forEach((it, i) => {
      const a = s.answers[i];
      const d = dots[i];
      let c = '';
      if (a !== null) {
        done++;
        if (s.blind) c = i === s.idx ? 'cur done' : 'done';
        else if (a === it.q.a) { ok++; c = 'ok'; } else { bad++; c = 'bad'; }
      } else if (i === s.idx) c = 'cur';
      d.className = ((d.dataset.b || '') + ' ' + c).trim();
    });
    $('#liveOk').textContent = ok;
    $('#liveBad').textContent = bad;
    $('#liveDone').textContent = done + '/' + s.items.length;
  }

  function next() {
    const s = session;
    if (!s || s.answers[s.idx] === null) return;
    if (s.idx < s.items.length - 1) {
      s.idx++;
      renderQuestion();
      const target = window.innerWidth < 1000 && s.items[s.idx].passage ? $('#qcard') : null;
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      else window.scrollTo({ top: 0, behavior: 'smooth' });
    } else showResult();
  }

  /* ---------------- RESULT ---------------- */
  function showResult() {
    const s = session;
    const total = s.items.length;
    const ok = s.items.filter((it, i) => s.answers[i] === it.q.a).length;
    const pct = Math.round((ok / total) * 100);
    const elapsed = Date.now() - s.start;
    const k = s.kind === 'model' ? mKey(s.sec, s.mid) : s.kind === 'exam' ? 'exam:' + s.eid : null;

    // per-section breakdown for mixed sessions (final exams, all-sections mistakes)
    const breakdown = s.mixed ? EXAM_PARTS.map(([p]) => {
      const idx = s.items.map((it, i) => (it.sec === p ? i : -1)).filter((i) => i >= 0);
      const good = idx.filter((i) => s.answers[i] === s.items[i].q.a).length;
      return { p, n: idx.length, ok: good, pct: pctOf(good, idx.length) };
    }).filter((b) => b.n) : null;

    if (k) {
      store.last[k] = pct;
      store.attempts[k] = (store.attempts[k] || 0) + 1;
      if (store.best[k] === undefined || pct > store.best[k]) store.best[k] = pct;
      if (s.kind === 'exam' && breakdown) { const o = {}; breakdown.forEach((b) => { o[b.p] = b.pct; }); store.examLast[k] = o; }
      save();
    }
    stopTimer();
    const finished = s;
    session = null;

    app.innerHTML = '';
    app.appendChild(tpl('tpl-result'));
    window.scrollTo(0, 0);
    renderTopStats();

    const ring = $('#ring');
    ring.style.setProperty('--c', levelColor(pct));
    let p = 0;
    const step = () => { p = Math.min(pct, p + Math.max(1, Math.ceil(pct / 30))); ring.style.setProperty('--p', p); $('#pct').textContent = p + '%'; if (p < pct) requestAnimationFrame(step); };
    if (pct > 0) requestAnimationFrame(step); else $('#pct').textContent = '0%';

    const lv = level(pct);
    $('#resTitle').textContent = lv === 'good' ? 'ممتاز! أداء رائع 🎉' : lv === 'mid' ? 'جيد، لكن يمكنك أفضل' : 'الدرجة منخفضة — أعد المحاولة';
    $('#resMsg').textContent = lv === 'good'
      ? 'أتقنت هذا الاختبار. راجع الأخطاء القليلة أدناه ثم انتقل لنموذج آخر.'
      : lv === 'mid'
        ? 'راجع الأسئلة الخاطئة أدناه، ثم أعد الاختبار أو أعد الأسئلة الخاطئة فقط.'
        : 'لا بأس! راجع الإجابات الصحيحة أدناه جيداً ثم أعد الاختبار لتحسين درجتك.';
    $('#resOk').textContent = ok;
    $('#resBad').textContent = total - ok;
    $('#resTime').textContent = fmtTime(elapsed);
    const best = k ? store.best[k] : undefined;
    $('#resBest').textContent = best !== undefined ? best + '%' : '—';

    if (breakdown) {
      const box = $('#secBreak');
      box.hidden = false;
      box.innerHTML = breakdown.map((b) => `
        <div class="sb-row">
          <span class="sb-name">${SECTIONS[b.p].ar} <small class="muted" dir="ltr">${SECTIONS[b.p].en}</small></span>
          <span class="sb-bar"><span style="width:${b.pct}%;background:${levelColor(b.pct)}"></span></span>
          <span class="sb-val" dir="ltr">${b.ok}/${b.n} · <b>${b.pct}%</b></span>
        </div>`).join('');
      const weakest = breakdown.slice().sort((a, b) => a.pct - b.pct)[0];
      if (breakdown.length > 1 && weakest.pct < 80) $('#resMsg').textContent += ` أضعف قسم لديك: ${SECTIONS[weakest.p].ar} (${weakest.pct}%) — ركّز عليه.`;
    }

    const retry = $('#retryBtn');
    if (lv === 'low') retry.textContent = '↻ أعد الاختبار الآن';
    const bare = (arr) => arr.map(({ sec: s2, mid, q, passage }) => ({ sec: s2, mid, q, passage }));
    retry.onclick = () => {
      if (finished.kind === 'model') startModel(finished.sec, finished.mid);
      else if (finished.kind === 'random') startRandom(finished.sec);
      else if (finished.kind === 'exam') startExam(finished.eid);
      else if (finished.kind === 'examRandom') startRandomExam();
      else startQuiz({ ...finished, items: bare(finished.items) });
    };

    const wrongItems = finished.items.filter((it, i) => finished.answers[i] !== it.q.a);
    const rw = $('#retryWrongBtn');
    if (!wrongItems.length) rw.style.display = 'none';
    rw.onclick = () => startQuiz({ kind: 'retryWrong', sec: finished.sec, mid: finished.mid, mixed: finished.mixed, title: finished.title.replace(/ — الأسئلة الخاطئة$/, '') + ' — الأسئلة الخاطئة', items: bare(wrongItems) });
    $('#backBtn').onclick = showHome;

    const review = $('#review');
    $('#reviewTitle').textContent = wrongItems.length ? `مراجعة الأخطاء (${wrongItems.length})` : 'لا توجد أخطاء — عمل رائع!';
    finished.items.forEach((it, i) => {
      const a = finished.answers[i];
      if (a === it.q.a) return;
      const div = document.createElement('div');
      div.className = 'rv';
      const tag = (finished.mixed ? `${SECTIONS[it.sec].en} · ` : '') + (finished.kind === 'model' ? '' : `${modelName(it.sec, it.mid)} · `) + (it.passage ? `Passage ${it.passage.num || ''} · ` : '') + (it.q.r ? `${it.q.r} · ` : '');
      div.innerHTML = `
        <div class="rv-q"><span class="n">${tag}Q${it.q.n}</span>${it.q.q}</div>
        <div class="ans yours"><span class="tag">Your answer</span><span>${it.q.o[a]}</span></div>
        <div class="ans right"><span class="tag">Correct</span><span>${it.q.o[it.q.a]}</span></div>`;
      review.appendChild(div);
    });
  }

  /* ---------------- keyboard ---------------- */
  document.addEventListener('keydown', (e) => {
    if (!session || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
    const k = e.key.toLowerCase();
    const map = { '1': 0, '2': 1, '3': 2, '4': 3, a: 0, b: 1, c: 2, d: 3, 'ش': 0, 'لا': 1, 'ؤ': 2, 'ي': 3 };
    if (k in map) {
      const it = session.items[session.idx];
      if ((session.answers[session.idx] === null || session.blind) && map[k] < it.order.length) { e.preventDefault(); choose(it.order[map[k]]); }
    } else if (k === 'enter' || k === 'arrowleft') {
      if (session.answers[session.idx] !== null) { e.preventDefault(); next(); }
    }
  });

  $('#homeBtn').onclick = () => {
    if (session) {
      const answered = session.answers.filter((a) => a !== null).length;
      if (answered && answered < session.items.length && !confirmLeave()) return;
    }
    showHome();
  };

  showHome();
})();
