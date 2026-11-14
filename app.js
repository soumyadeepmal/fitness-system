'use strict';
// ---------- state ----------
const LS_KEY = 'fitlog.v1';
let S = { profile: { name: '', height: '', time: '', place: '' }, days: {} };
try { const raw = localStorage.getItem(LS_KEY); if (raw) S = Object.assign(S, JSON.parse(raw)); } catch (e) {}
function save() { try { localStorage.setItem(LS_KEY, JSON.stringify(S)); flashSaved(); } catch (e) {} }
function flashSaved() { const el = document.querySelector('.saved'); if (el) { el.textContent = 'Saved ✓'; setTimeout(() => { if (el.textContent === 'Saved ✓') el.textContent = ''; }, 1500); } }

const pad = n => String(n).padStart(2, '0');
const dkey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const TODAY = dkey(new Date());
const pretty = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }); };
const num = v => { const n = parseFloat(v); return isFinite(n) && n > 0 && n < 500 ? n : 0; };
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function weekKey(k) { const [y, m, d] = k.split('-').map(Number); const dt = new Date(y, m - 1, d); const day = (dt.getDay() + 6) % 7; dt.setDate(dt.getDate() - day); return dkey(dt); }
const entry = k => S.days[k] || {};

// ---------- photos (IndexedDB, isi phone par) ----------
let PHOTOS = []; // {id, date, url}
let PHOTODAYS = new Set();
let IDB_OK = false;
function idbOpen() {
  return new Promise(res => {
    try {
      if (!('indexedDB' in window)) return res(null);
      const req = indexedDB.open('fitness-system', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('photos', { keyPath: 'id' });
      req.onsuccess = () => res(req.result);
      req.onerror = () => res(null);
    } catch (e) { res(null); }
  });
}
async function idbPut(rec) { const db = await idbOpen(); if (!db) return false; return new Promise(res => { const tx = db.transaction('photos', 'readwrite'); tx.objectStore('photos').put(rec); tx.oncomplete = () => res(true); tx.onerror = () => res(false); }); }
async function idbAll() { const db = await idbOpen(); if (!db) return null; return new Promise(res => { const rq = db.transaction('photos', 'readonly').objectStore('photos').getAll(); rq.onsuccess = () => res(rq.result); rq.onerror = () => res(null); }); }
async function idbDel(id) { const db = await idbOpen(); if (!db) return; return new Promise(res => { const tx = db.transaction('photos', 'readwrite'); tx.objectStore('photos').delete(id); tx.oncomplete = () => res(); tx.onerror = () => res(); }); }
async function fileToJpeg(file) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const sc = Math.min(1, 900 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * sc)); c.height = Math.max(1, Math.round(bmp.height * sc));
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('encode')), 'image/jpeg', 0.75));
}
async function loadPhotos() {
  const rows = await idbAll();
  IDB_OK = rows !== null;
  PHOTOS = (rows || []).sort((a, b) => a.id < b.id ? -1 : 1).map(r => ({ id: r.id, date: r.date, rating: r.rating || '', url: URL.createObjectURL(r.blob) }));
  PHOTODAYS = new Set(PHOTOS.map(p => p.id));
}

// ---------- XP / levels ----------
// Daily quests
const QUESTS = [
  { id: 'meals', label: 'Khana log karo', xp: 10, done: (e, k) => !!(e.nashta || e.lunch || e.snacks || e.dinner) },
  { id: 'protein', label: 'Protein liya (dal, egg, fish, doodh)', xp: 5, done: e => !!e.protein },
  { id: 'water', label: 'Paani 4+ glass', xp: 5, done: e => e.water === '4-7' || e.water === '8+' },
  { id: 'workout', label: 'Workout complete', xp: 20, done: e => !!e.workout },
  { id: 'run', label: 'Running log', xp: 15, done: e => num(e.runKm) > 0 },
];
// Weekly quest: physique photo + aapki apni rating (app photo judge nahi karta)
const WEEKLY = { id: 'photo', label: 'Is hafte ki physique photo', xp: 20, done: (e, k) => [...PHOTODAYS].some(p => weekKey(p) === weekKey(k)) };
// Self-rating par koi XP nahi: better dikhna neutral/worse se zyada reward nahi kamaata. Rating sirf note hai.
// Weekly plan-completion: user self-marks; rest days count as following the plan, no extra workouts needed
const PLAN_WEEK_XP = 25;
const PLAN_WEEK = { id: 'planweek', label: 'Hafte ka plan follow kiya (training + rest days dono)', xp: PLAN_WEEK_XP, done: (e, k) => !!(S.weekChecks && S.weekChecks[weekKey(k)]) };

function dayXp(k) {
  const e = entry(k);
  let xp = 0;
  for (const q of QUESTS) if (q.done(e, k)) xp += q.xp;
  return xp;
}
function totalXp() {
  let xp = 0;
  for (const k of Object.keys(S.days)) xp += dayXp(k);
  const weeks = new Set(Object.keys(S.days).map(weekKey));
  xp += [...weeks].filter(w => [...PHOTODAYS].some(p => weekKey(p) === w)).length * WEEKLY.xp;
  if (S.weekChecks) for (const w of Object.keys(S.weekChecks)) if (S.weekChecks[w]) xp += PLAN_WEEK_XP;
  return xp;
}
function levelFromXp(xp) {
  let lvl = 1, need = 100, base = 0;
  while (xp >= base + need) { base += need; lvl++; need = 100 * lvl; }
  return { lvl, into: xp - base, need };
}
const rankOf = l => l <= 4 ? 'E' : l <= 9 ? 'D' : l <= 14 ? 'C' : l <= 19 ? 'B' : l <= 29 ? 'A' : 'S';
function streakDays() {
  let n = 0; const c = new Date();
  const has = k => dayXp(k) > 0;
  if (!has(dkey(c))) c.setDate(c.getDate() - 1);
  while (has(dkey(c)) && n < 3650) { n++; c.setDate(c.getDate() - 1); }
  return n;
}
function totals() {
  let workouts = 0, km = 0;
  for (const e of Object.values(S.days)) { if (e.workout) workouts++; km += num(e.runKm); }
  return { workouts, km, days: Object.keys(S.days).filter(k => dayXp(k) > 0).length };
}

// ---------- router ----------
const TABS = [['status', 'STATUS'], ['log', 'LOG'], ['plan', 'QUESTS'], ['photos', 'PHOTOS'], ['progress', 'PROGRESS']];
function cur() { const h = location.hash.replace('#/', ''); return TABS.some(t => t[0] === h) ? h : 'status'; }
function render() {
  document.getElementById('tabs').innerHTML = TABS.map(t => `<a href="#/${t[0]}" class="${cur() === t[0] ? 'on' : ''}">${t[1]}</a>`).join('');
  const v = document.getElementById('view');
  ({ status: vStatus, log: vLog, plan: vPlan, photos: vPhotos, progress: vProgress })[cur()](v);
}
window.addEventListener('hashchange', render);

// ---------- STATUS ----------
function vStatus(v) {
  const xp = totalXp(); const L = levelFromXp(xp); const t = totals();
  const e = entry(TODAY);
  const allQ = QUESTS.concat([WEEKLY, PLAN_WEEK]);
  const questHtml = allQ.map(q => { const d = q.done(e, TODAY); return `<div class="quest ${d ? 'done' : ''}"><span class="qbox">${d ? '✓' : ''}</span><span>${q.label}</span><span class="qxp">${d ? '+' + q.xp + ' XP' : q.xp + ' XP'}</span></div>`; }).join('');
  let banner = '';
  const m = (S.profile.time || '').match(/^(\d{1,2}):(\d{2})$/);
  const trainDay = [1, 2, 4, 5].includes(new Date().getDay());
  if (m && !e.workout && trainDay) {
    const now = new Date(); const mins = now.getHours() * 60 + now.getMinutes();
    if (mins >= parseInt(m[1]) * 60 + parseInt(m[2])) banner = `<div class="banner">[ ALERT ] Daily quest pending: WORKOUT${S.profile.place ? ' - ' + (S.profile.place === 'gym' ? 'Gym' : 'Home workout') : ''}</div>`;
  }
  const next = L.lvl + 1;
  v.innerHTML = `${banner}
  <div class="panel">
    <div class="ptitle">PLAYER STATUS</div>
    <div class="levelwrap">
      <div class="lvllabel">LEVEL</div>
      <div class="levelnum">${L.lvl}</div>
      <div class="rank">RANK ${rankOf(L.lvl)}</div>
      <div class="xpbar"><div class="xpfill" style="width:${Math.round(100 * L.into / L.need)}%"></div></div>
      <div class="xptext">${L.into} / ${L.need} XP to Lv ${next} (total ${xp} XP)</div>
    </div>
  </div>
  <div class="panel">
    <div class="ptitle">STATS</div>
    <div class="stats">
      <div class="stat"><b>${t.workouts}</b><span>WORKOUTS</span></div>
      <div class="stat"><b>${t.km.toFixed(1)}</b><span>KM RUN</span></div>
      <div class="stat"><b>${streakDays()}</b><span>STREAK</span></div>
      <div class="stat"><b>${t.days}</b><span>LOG DAYS</span></div>
    </div>
    <div class="note">Level activity se badhta hai - log, workout, running, weekly photo. App body ya fat khud measure nahi karta; physique ka progress weekly photo compare + aapki apni rating se aata hai.</div>
  </div>
  <div class="panel">
    <div class="ptitle">TODAY'S QUESTS</div>
    ${questHtml}
    <div class="note">Weekly quest: physique photo (hafte mein 1) + apni rating - photo compare aap khud karte ho.</div>
  </div>
  <div class="panel">
    <div class="ptitle">PLAYER INFO</div>
    <label class="f">Naam</label><input type="text" id="pname" value="${esc(S.profile.name)}" placeholder="Player name">
    <label class="f">Height</label><input type="text" id="pheight" value="${esc(S.profile.height)}" placeholder="jaise 5 ft 11 in">
    <label class="f">Workout time</label><input type="time" id="ptime" value="${esc(S.profile.time)}">
    <label class="f">Workout place</label>
    <div class="chips">
      <button class="chip ${S.profile.place === 'home' ? 'on' : ''}" data-place="home">Home workout</button>
      <button class="chip ${S.profile.place === 'gym' ? 'on' : ''}" data-place="gym">Gym</button>
    </div>
    <div class="note">Time set karne par workout pending ho to yahan alert dikhta hai. App band hone par notification nahi aa sakta - wo agle version ka kaam hai. Saara data is phone ke browser mein rehta hai; browser data clear/evict hone par delete ho sakta hai.</div>
    <div class="saved"></div>
  </div>`;
  bindProfile(v);
}
function bindProfile(v) {
  const bind = (id, key) => { const el = v.querySelector('#' + id); el.addEventListener('input', () => { S.profile[key] = el.value; save(); }); };
  bind('pname', 'name'); bind('pheight', 'height'); bind('ptime', 'time');
  v.querySelectorAll('[data-place]').forEach(b => b.addEventListener('click', () => { S.profile.place = b.dataset.place; save(); render(); }));
}

// ---------- LOG ----------
function vLog(v) {
  const e = entry(TODAY);
  const chip = (cur, val, label) => `<button class="chip ${cur === val ? 'on' : ''}" data-val="${val}">${label}</button>`;
  v.innerHTML = `
  <div class="panel">
    <div class="ptitle">TODAY'S LOG - ${pretty(TODAY).toUpperCase()}</div>
    <label class="f">Nashta</label><input type="text" id="nashta" value="${esc(e.nashta)}">
    <label class="f">Dopahar ka khana</label><input type="text" id="lunch" value="${esc(e.lunch)}">
    <label class="f">Snacks</label><input type="text" id="snacks" value="${esc(e.snacks)}">
    <label class="f">Raat ka khana</label><input type="text" id="dinner" value="${esc(e.dinner)}">
    <label class="f">Paani (glass)</label><div class="chips" data-k="water">${chip(e.water, '<4', '<4')}${chip(e.water, '4-7', '4-7')}${chip(e.water, '8+', '8+')}</div>
    <label class="f">Protein liya</label><div class="chips" data-k="protein">${chip(e.protein === undefined ? '' : String(!!e.protein), 'true', 'Haan')}${chip(e.protein === undefined ? '' : String(!!e.protein), 'false', 'Nahi')}</div>
  </div>
  <div class="panel">
    <div class="ptitle">TRAINING</div>
    <label class="f">Aaj workout hua</label><div class="chips" data-k="workout">${chip(e.workout === undefined ? '' : String(!!e.workout), 'true', 'Haan')}${chip(e.workout === undefined ? '' : String(!!e.workout), 'false', 'Nahi')}</div>
    <label class="f">Running (km)</label><input type="number" inputmode="decimal" step="0.1" min="0" id="runKm" value="${esc(e.runKm || '')}">
    <label class="f">Strength note (jaise push-ups 12/10/8)</label><input type="text" id="reps" value="${esc(e.reps)}">
  </div>
  <div class="panel">
    <div class="ptitle">WEIGHT</div>
    <label class="f">Aaj ka weight (kg)</label><input type="number" inputmode="decimal" step="0.1" min="0" id="weight" value="${esc(e.weight || '')}">
    <div class="note">Sab apne aap save hota hai - isi phone ke browser mein.</div>
    <div class="saved"></div>
  </div>`;
  const setE = patch => { S.days[TODAY] = Object.assign({}, entry(TODAY), patch); save(); };
  ['nashta', 'lunch', 'snacks', 'dinner', 'runKm', 'reps', 'weight'].forEach(id => {
    const el = v.querySelector('#' + id);
    el.addEventListener('input', () => setE({ [id]: el.value }));
  });
  v.querySelectorAll('.chips').forEach(g => {
    const k = g.dataset.k;
    g.querySelectorAll('.chip').forEach(c => c.addEventListener('click', () => {
      const val = c.dataset.val;
      setE({ [k]: (k === 'protein' || k === 'workout') ? val === 'true' : val });
      render();
    }));
  });
}

// ---------- PLAN (weekly quests) ----------
function vPlan(v) {
  const days = [
    ['MON', 'Strength - push-ups 3 set, squats 3 set, plank 3 baar (form sahi, jitna ho sake).'],
    ['TUE', 'Easy running ya tez walk 20-30 min. Km LOG tab mein likho.'],
    ['WED', 'Rest ya halki walk - recovery bhi training ka hissa hai.'],
    ['THU', 'Strength - wahi 3 exercise, pichhli baar se 1-2 rep zyada try karo.'],
    ['FRI', 'Easy running 20-30 min.'],
    ['SAT', 'Strength (optional) ya koi khel - football, cricket, cycling.'],
    ['SUN', 'Poora rest.'],
  ];
  v.innerHTML = `
  <div class="panel">
    <div class="ptitle">WEEKLY QUEST BOARD</div>
    ${days.map(d => `<div class="plan-day"><b>${d[0]}</b><span>${d[1]}</span></div>`).join('')}
    <div class="note">Strength note mein reps likho - jab 3 set easy lagein, agle hafte reps badhao. WHO hafte mein kam se kam 2 din muscle-strengthening suggest karta hai.</div>
  </div>
  <div class="panel">
    <div class="ptitle">WEEKLY CHECK-IN</div>
    <div class="note" style="margin-bottom:8px">Hafte ke aakhir mein mark karo agar plan follow kiya - training days bhi, rest days bhi. Rest lena plan todna nahi hai.</div>
    <button class="chip ${(S.weekChecks && S.weekChecks[weekKey(TODAY)]) ? 'on' : ''}" id="planweek">Is hafte ka plan follow kiya (+${PLAN_WEEK_XP} XP)</button>
  </div>
  <div class="panel">
    <div class="ptitle">RULES</div>
    <div class="fbl">Roz heavy training mat karo - muscle rest ke din strong hota hai.</div>
    <div class="fbl">Workout reminder sirf training days par aata hai (Mon/Tue/Thu/Fri) - Sat optional hai, Wed/Sun rest par koi reminder nahi.</div>
    <div class="fbl">Running easy pace par - baat kar pao itni speed kaafi hai.</div>
    <div class="fbl">Level activity se badhta hai, jaldi nahi - consistency hi asli cheat code hai.</div>
    <div class="fbl">Sharp pain ho to ruk jao; lagatar dard ho to doctor ko dikhao.</div>
  </div>`;
  const pw = v.querySelector('#planweek');
  if (pw) pw.addEventListener('click', () => {
    if (!S.weekChecks) S.weekChecks = {};
    const w = weekKey(TODAY);
    S.weekChecks[w] = !S.weekChecks[w];
    save(); render();
  });
}

// ---------- PHOTOS (weekly) ----------
let sessionPhotos = []; // fallback jab IndexedDB available nahi
function vPhotos(v) {
  const byWeek = {};
  PHOTOS.forEach(p => { (byWeek[weekKey(p.id)] = byWeek[weekKey(p.id)] || []).push(p); });
  const weeks = Object.keys(byWeek).sort();
  const thisWeek = (byWeek[weekKey(TODAY)] || [])[0];
  const first = PHOTOS[0], latest = PHOTOS[PHOTOS.length - 1];
  v.innerHTML = `
  <div class="panel">
    <div class="ptitle">WEEKLY PHYSIQUE PHOTO</div>
    ${thisWeek ? `<div class="photos-grid"><div><img src="${thisWeek.url}" data-view="${PHOTOS.indexOf(thisWeek)}" alt="Is hafte ki photo"><div class="pdate">${pretty(thisWeek.date)}${thisWeek.rating ? ' - ' + ratingLabel(thisWeek.rating) : ''}</div></div></div>` : '<div class="note">Is hafte ki photo abhi nahi hai. Same light aur pose mein lo - comparison tabhi sahi dikhta hai.</div>'}
    <input type="file" id="pick" accept="image/*" hidden>
    <button class="btn" id="addphoto">${thisWeek ? 'PHOTO BADLO' : 'IS HAFTE KI PHOTO ADD KARO'}</button>
    ${thisWeek ? `<label class="f">Aapki apni rating (app photo judge nahi karta)</label>
    <div class="chips" id="rating">
      <button class="chip ${thisWeek.rating === 'same' ? 'on' : ''}" data-r="same">Same</button>
      <button class="chip ${thisWeek.rating === 'better' ? 'on' : ''}" data-r="better">Better</button>
      <button class="chip ${thisWeek.rating === 'great' ? 'on' : ''}" data-r="great">Much better</button>
    </div>
    <button class="btn ghost" id="delphoto">IS HAFTE KI PHOTO HATAO</button>` : ''}
    <div class="note">${IDB_OK ? 'Photos sirf is phone ke browser mein save hoti hain. Browser data clear/evict hone par delete ho sakti hain.' : 'Is browser mein photo storage available nahi - photos page band hone tak hi rahengi.'}</div>
  </div>
  ${PHOTOS.length >= 2 ? `<div class="panel"><div class="ptitle">FIRST vs LATEST</div>
    <div class="compare">
      <div><img src="${first.url}" data-view="0" alt="Pehli photo"><div class="pdate">${pretty(first.date)}</div></div>
      <div><img src="${latest.url}" data-view="${PHOTOS.length - 1}" alt="Latest photo"><div class="pdate">${pretty(latest.date)}</div></div>
    </div>
    <div class="note">Comparison aap khud karte ho - ye app fat ya muscle nahi naapta.</div>
  </div>` : ''}
  ${PHOTOS.length ? `<div class="panel"><div class="ptitle">ALL PHOTOS (${PHOTOS.length})</div>
    <div class="photos-grid">${PHOTOS.map((p, i) => `<div><img src="${p.url}" data-view="${i}" alt="Photo ${pretty(p.date)}"><div class="pdate">${pretty(p.date)}</div></div>`).join('')}</div>
  </div>` : ''}`;
  const pick = v.querySelector('#pick');
  v.querySelector('#addphoto').addEventListener('click', () => pick.click());
  pick.addEventListener('change', async () => {
    const f = pick.files && pick.files[0]; pick.value = '';
    if (!f) return;
    try {
      const blob = await fileToJpeg(f);
      const rec = { id: TODAY, date: TODAY, blob, rating: thisWeek ? thisWeek.rating : '' };
      if (IDB_OK) { const ok = await idbPut(rec); if (!ok) IDB_OK = false; }
      const url = URL.createObjectURL(blob);
      PHOTOS = PHOTOS.filter(p => p.id !== TODAY).concat([{ id: TODAY, date: TODAY, rating: rec.rating, url }]).sort((a, b) => a.id < b.id ? -1 : 1);
      PHOTODAYS = new Set(PHOTOS.map(p => p.id));
      render();
    } catch (e) { alert('Photo load nahi hui. Dusri try karo.'); }
  });
  const del = v.querySelector('#delphoto');
  if (del) del.addEventListener('click', async () => { await idbDel(TODAY); PHOTOS = PHOTOS.filter(p => p.id !== TODAY); PHOTODAYS = new Set(PHOTOS.map(p => p.id)); render(); });
  const rating = v.querySelector('#rating');
  if (rating) rating.querySelectorAll('.chip').forEach(c => c.addEventListener('click', async () => {
    const p = PHOTOS.find(x => x.id === TODAY); if (!p) return;
    p.rating = c.dataset.r;
    if (IDB_OK) { const res = await fetch(p.url); const blob = await res.blob(); await idbPut({ id: p.id, date: p.date, blob, rating: p.rating }); }
    render();
  }));
  v.querySelectorAll('[data-view]').forEach(img => img.addEventListener('click', () => openViewer(parseInt(img.dataset.view))));
}
function ratingLabel(r) { return r === 'great' ? 'Much better' : r === 'better' ? 'Better' : 'Same'; }

// ---------- viewer ----------
let vIdx = 0;
function openViewer(i) {
  vIdx = i;
  const vw = document.getElementById('viewer');
  vw.hidden = false;
  showV();
}
function showV() { const p = PHOTOS[vIdx]; if (p) document.getElementById('vimg').src = p.url; }
document.getElementById('vclose').addEventListener('click', () => { document.getElementById('viewer').hidden = true; });
document.getElementById('vprev').addEventListener('click', () => { vIdx = (vIdx - 1 + PHOTOS.length) % PHOTOS.length; showV(); });
document.getElementById('vnext').addEventListener('click', () => { vIdx = (vIdx + 1) % PHOTOS.length; showV(); });

// ---------- PROGRESS ----------
function vProgress(v) {
  const ws = Object.keys(S.days).filter(k => num(entry(k).weight) > 0).sort().slice(-30);
  const pts = ws.map(k => ({ k, v: num(entry(k).weight) }));
  let chart = '<div class="note">Weight likhte hi yahan trend chart banega.</div>';
  if (pts.length >= 1) {
    const W = 320, H = 120, P = 14;
    const vals = pts.map(p => p.v); const mn = Math.min(...vals), mx = Math.max(...vals);
    const rng = (mx - mn) || 1;
    const X = i => P + (pts.length === 1 ? (W - 2 * P) / 2 : i * (W - 2 * P) / (pts.length - 1));
    const Y = val => H - P - (val - mn) * (H - 2 * P) / rng;
    const line = pts.map((p, i) => `${X(i)},${Y(p.v)}`).join(' ');
    chart = `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <line class="grid" x1="${P}" y1="${H - P}" x2="${W - P}" y2="${H - P}"/>
      <polyline points="${line}"/>
      ${pts.map((p, i) => `<circle cx="${X(i)}" cy="${Y(p.v)}" r="3" fill="#35c4ff"><title>${pretty(p.k)}: ${p.v} kg</title></circle>`).join('')}
    </svg>
    <div class="xptext">${pretty(pts[0].k)}: ${pts[0].v} kg → ${pretty(pts[pts.length - 1].k)}: ${pts[pts.length - 1].v} kg</div>`;
  }
  const t = totals();
  let km7 = 0, longest = 0;
  const last7 = new Set(); for (let i = 0; i < 7; i++) { const d = new Date(); d.setDate(d.getDate() - i); last7.add(dkey(d)); }
  for (const k of Object.keys(S.days)) { const km = num(entry(k).runKm); if (km) { if (last7.has(k)) km7 += km; longest = Math.max(longest, km); } }
  let w7 = 0; for (const k of last7) if (entry(k).workout) w7++;
  const xp = totalXp(); const L = levelFromXp(xp);
  v.innerHTML = `
  <div class="panel">
    <div class="ptitle">SYSTEM SUMMARY</div>
    <div class="stats">
      <div class="stat"><b>Lv ${L.lvl}</b><span>LEVEL</span></div>
      <div class="stat"><b>${xp}</b><span>TOTAL XP</span></div>
      <div class="stat"><b>${streakDays()}</b><span>STREAK</span></div>
      <div class="stat"><b>${PHOTOS.length}</b><span>PHOTOS</span></div>
    </div>
  </div>
  <div class="panel"><div class="ptitle">WEIGHT TREND</div>${chart}
    <div class="note">Sirf weight se body fat ya muscle nahi dikhti - strength aur photos bhi dekho.</div></div>
  <div class="panel"><div class="ptitle">FEEDBACK</div>
    <div class="fbl">Pichhle 7 din: ${w7} workout din, ${km7.toFixed(1)} km running${longest ? ', sabse lamba run ' + longest.toFixed(1) + ' km' : ''}.</div>
    <div class="fbl">Level activity se badhta hai - log, workout, running, weekly photo. Body ka verdict app nahi deta.</div>
    <div class="fbl">Weekly photo compare karo PHOTOS tab mein - same light, same pose.</div>
  </div>
  <div class="panel"><div class="note">Ye app sirf aapka record rakhta hai - koi medical advice ya body measurement nahi. Saara data is phone ke browser mein rehta hai.</div></div>`;
}

// ---------- init ----------
(async function init() {
  await loadPhotos();
  render();
  if ('serviceWorker' in navigator && location.protocol === 'https:') { try { navigator.serviceWorker.register('sw.js'); } catch (e) {} }
})();
