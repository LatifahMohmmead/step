#!/usr/bin/env node
/*
 * يولّد ملف data-exams.js: 20 نموذج اختبار نهائي، كل نموذج 100 سؤال
 *   40 قواعد + 20 استماع + 40 قراءة
 * التشغيل (من مجلد المشروع):   node tools/build-exams.js
 *
 * - يحذف الأسئلة/القطع المكررة بين التجميعات قبل التوزيع.
 * - أسئلة القطعة الواحدة تبقى معاً، وأسئلة التسجيل الواحد تبقى معاً.
 * - لا يتكرر سؤال داخل النموذج الواحد، والتوزيع يقلل التكرار بين النماذج
 *   (القواعد والقراءة بدون تكرار؛ الاستماع يتكرر لأن بنكه 247 سؤال فقط).
 * - التوزيع ثابت (seed) فتبقى النماذج نفسها في كل مرة.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const EXAMS = 20;
const PLAN = { grammar: 40, listening: 20, reading: 40 };
const SEED = 20261017;

const ctx = { window: {} };
vm.createContext(ctx);
['data.js', 'data-reading.js', 'data-listening.js'].forEach((f) => vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx));
const W = ctx.window;

// deterministic RNG
let s = SEED >>> 0;
const rnd = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const norm = (x) => String(x).replace(/<[^>]+>/g, ' ').replace(/&[#\w]+;/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const qSig = (q) => norm(q.q) + '|' + q.o.map(norm).sort().join('|');

/* ---- build units (a unit = questions that must stay together) ---- */
function grammarUnits() {
  const seen = new Set(), units = [];
  W.QUIZ_DATA.forEach((m) => m.questions.forEach((q) => {
    const k = qSig(q);
    if (seen.has(k)) return;
    seen.add(k);
    units.push({ id: 'g' + m.id + '-' + q.n, qs: [[m.id, q.n]] });
  }));
  return units;
}

function readingUnits() {
  // the same passage appears in several compilations with small differences (numbering, typos).
  // two passages are "the same" if their text matches OR they share an identical question+options.
  const all = [];
  W.READING_DATA.forEach((m) => m.passages.forEach((p, pi) => {
    const qs = m.questions.filter((q) => q.p === pi).sort((a, b) => a.n - b.n);
    if (!qs.length) return;
    const seenQ = new Set(); // remove duplicate questions inside the same passage
    const uq = qs.filter((q) => { const sg = qSig(q); if (seenQ.has(sg)) return false; seenQ.add(sg); return true; });
    const text = norm(p.b.filter((b) => typeof b === 'string').join(' ').replace(/\d+/g, '')).slice(0, 300);
    all.push({ id: 'r' + m.id + '/' + pi, qs: uq.map((q) => [m.id, q.n]), keys: [...(text.length > 40 ? ['t|' + text] : []), ...uq.map((q) => 'q|' + qSig(q))] });
  }));
  // union-find over shared keys
  const parent = all.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const owner = new Map();
  all.forEach((u, i) => u.keys.forEach((k) => { if (owner.has(k)) parent[find(i)] = find(owner.get(k)); else owner.set(k, i); }));
  const best = new Map(); // cluster -> version with most questions
  all.forEach((u, i) => { const r = find(i); if (!best.has(r) || best.get(r).qs.length < u.qs.length) best.set(r, u); });
  return [...best.values()];
}

function listeningUnits() {
  const seen = new Set(), groups = new Map();
  W.LISTENING_DATA.forEach((m) => m.questions.slice().sort((a, b) => a.n - b.n).forEach((q) => {
    const k = qSig(q);
    if (seen.has(k)) return;
    seen.add(k);
    const g = q.r ? m.id + '|' + q.r : m.id + '#' + q.n; // same recording stays together
    if (!groups.has(g)) groups.set(g, { id: 'l' + g, qs: [] });
    groups.get(g).qs.push([m.id, q.n]);
  }));
  return [...groups.values()];
}

/* ---- distribute: least-used first, whole units preferred, exact count ---- */
function distribute(units, per) {
  const use = new Map(); // question key -> times used
  const qk = (x) => x[0] + '-' + x[1];
  const score = (u) => u.qs.reduce((n, x) => n + (use.get(qk(x)) || 0), 0) / u.qs.length;
  const out = [];
  for (let e = 0; e < EXAMS; e++) {
    const used = new Set(), picked = [];
    let need = per;
    while (need > 0) {
      const cand = shuffle(units.filter((u) => !used.has(u.id))).sort((a, b) => score(a) - score(b));
      if (!cand.length) throw new Error('not enough questions');
      const low = score(cand[0]);
      const tier = cand.filter((u) => score(u) === low);
      let u = tier.find((x) => x.qs.length <= need) || cand.find((x) => x.qs.length <= need && score(x) <= low + 1);
      let qs;
      if (u) qs = u.qs;
      else { // must split a unit: take its least-used questions, keep original order
        u = tier[0];
        const keep = new Set(u.qs.slice().sort((a, b) => (use.get(qk(a)) || 0) - (use.get(qk(b)) || 0)).slice(0, need).map(qk));
        qs = u.qs.filter((x) => keep.has(qk(x)));
      }
      used.add(u.id);
      qs.forEach((x) => use.set(qk(x), (use.get(qk(x)) || 0) + 1));
      picked.push(...qs);
      need -= qs.length;
    }
    out.push(picked);
  }
  const counts = [...use.values()];
  return { out, stats: { pool: units.reduce((n, u) => n + u.qs.length, 0), distinctUsed: use.size, maxRepeat: Math.max(...counts) } };
}

const parts = {
  grammar: distribute(grammarUnits(), PLAN.grammar),
  listening: distribute(listeningUnits(), PLAN.listening),
  reading: distribute(readingUnits(), PLAN.reading),
};

const exams = [];
for (let e = 0; e < EXAMS; e++) {
  exams.push({ id: e + 1, grammar: parts.grammar.out[e], listening: parts.listening.out[e], reading: parts.reading.out[e] });
}

const header = '/* نماذج الاختبار النهائي — مولّد تلقائياً بواسطة tools/build-exams.js\n' +
  ' * كل نموذج: 40 قواعد + 20 استماع + 40 قراءة = 100 سؤال. كل سؤال مرجع [رقم النموذج الأصلي, رقم السؤال]. */\n';
fs.writeFileSync(path.join(ROOT, 'data-exams.js'), header + 'window.EXAM_DATA = ' + JSON.stringify(exams) + ';\n');

Object.entries(parts).forEach(([k, v]) => console.log(k.padEnd(10), 'bank (unique):', v.stats.pool, '| used:', v.stats.distinctUsed, '| max repeats across exams:', v.stats.maxRepeat));
console.log('wrote data-exams.js with', exams.length, 'exams');
