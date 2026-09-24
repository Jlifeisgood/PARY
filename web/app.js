"use strict";
// Darsim — расписание, задания и оценки студента ТГЭУ (HEMIS + EduPage).

const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const A = window.Android || null;
const MS_DAY = 864e5;
const TZ_OFFSET = 5 * 3600e3;   // Ташкент, UTC+5 без перехода на летнее время

let L = "uz", T = I18N.uz;
const S = {
  state: null, me: null, tab: "schedule", sel: null,
  weeks: {}, pending: {},
  tasks: null, taskFilter: "active", openTask: null,
  grades: null, gradesSem: null,
  reminders: [10], animating: false, lastToast: 0,
};

// ------------------------------------------------------------------ утилиты

const sleep = ms => new Promise(r => setTimeout(r, ms));
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* нет места */ } },
  clear() { try { localStorage.clear(); } catch (e) { } },
};
const haptic = () => { try { A && A.haptic(); } catch (e) { } };

// «Настенное» время Ташкента, хранится как UTC-дата
const nowT = () => new Date(Date.now() + TZ_OFFSET);
const dayStart = d => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const addDays = (d, n) => new Date(d.getTime() + n * MS_DAY);
const iso = d => d.toISOString().slice(0, 10);
const parseIso = s => { const [y, m, d] = s.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const dow = d => (d.getUTCDay() + 6) % 7;
const mondayOf = d => addDays(dayStart(d), -dow(d));
const today = () => dayStart(nowT());
const mins = t => { const [h, m] = String(t || "0:0").split(":").map(Number); return h * 60 + (m || 0); };
const nowMin = () => { const n = nowT(); return n.getUTCHours() * 60 + n.getUTCMinutes() + n.getUTCSeconds() / 60; };
const dur = (m, short) => { m = Math.max(0, Math.round(m)); return (short ? T.durShort : T.dur)(Math.floor(m / 60), m % 60); };
const fmtDate = d => T.date(d.getUTCDate(), T.months[d.getUTCMonth()]);
const fromEpoch = sec => new Date(sec * 1000 + TZ_OFFSET);
const hhmm = d => `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;

function relDay(d) {
  const diff = Math.round((dayStart(d) - today()) / MS_DAY);
  if (diff === 0) return T.today;
  if (diff === 1) return T.tomorrow;
  if (diff === -1) return T.yesterday;
  return T.days[dow(d)];
}

function plainText(html) {
  try { return new DOMParser().parseFromString(String(html || ""), "text/html").body.textContent.trim(); }
  catch (e) { return String(html || ""); }
}

// ------------------------------------------------------------------ иконки

const P = {
  calendar: '<rect x="3" y="4.5" width="18" height="17" rx="3.5"/><path d="M8 2.5v4M16 2.5v4M3 10h18"/>',
  tasks: '<rect x="3" y="3" width="18" height="18" rx="4.5"/><path d="m8 12.5 2.8 2.8L16.5 9"/>',
  grades: '<path d="M12 3 3 8l9 5 9-5-9-5z"/><path d="M7 10.5V16c0 1.4 2.2 3 5 3s5-1.6 5-3v-5.5"/>',
  pin: '<path d="M12 21s-7-6.1-7-11a7 7 0 0 1 14 0c0 4.9-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 21c1.4-4 4.2-6 7.5-6s6.1 2 7.5 6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 2"/>',
  sun: '<circle cx="12" cy="12" r="4.5"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  coffee: '<path d="M4 9h13v4.5A5.5 5.5 0 0 1 11.5 19h-2A5.5 5.5 0 0 1 4 13.5z"/><path d="M17 11h1.5a2.5 2.5 0 0 1 0 5H17M8.5 2.5c-.8 1 .8 2 0 3M12.5 2.5c-.8 1 .8 2 0 3"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  refresh: '<path d="M20.5 12a8.5 8.5 0 1 1-2.8-6.3"/><path d="M20.5 3.5v5h-5"/>',
  down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  logout: '<path d="M15 17l5-5-5-5M20 12H9M12 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6"/>',
  bell: '<path d="M6 8.5a6 6 0 1 1 12 0c0 6.5 2.5 8.5 2.5 8.5h-17S6 15 6 8.5"/><path d="M10.2 20.5a2 2 0 0 0 3.6 0"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M3 3l18 18M10.6 5.1A10.8 10.8 0 0 1 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.2M6.6 6.6A17.4 17.4 0 0 0 2 12s3.6 7 10 7a9.9 9.9 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  shield: '<path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.2-7.5 9.5-4.3-1.3-7.5-4.9-7.5-9.5V6z"/><path d="M8.8 12l2.2 2.2 4.2-4.4"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.5v.5"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  party: '<path d="M4 20l4.5-12L16 15.5z"/><path d="M13.5 4.5c.5 1.5 0 3-1.5 4M19.5 10.5c-1.5-.5-3 0-4 1.5M17 3v2M21 7h-2M20.5 14l-1 1"/>',
};
const icon = name => `<svg class="i" viewBox="0 0 24 24">${P[name]}</svg>`;

// логотип-календарь (экран входа и настройки)
const LOGO = `<svg viewBox="0 0 100 100"><defs><linearGradient id="lg-g" x1="0" y1="0" x2="1" y2="1">
  <stop offset="0" stop-color="#6D6AF6"/><stop offset="1" stop-color="#9B5DE5"/></linearGradient></defs>
  <rect x="6" y="6" width="88" height="88" rx="24" fill="url(#lg-g)"/>
  <circle cx="20" cy="20" r="40" fill="#fff" fill-opacity=".1"/>
  <rect x="22" y="20" width="8" height="16" rx="4" fill="#fff" fill-opacity=".85"/>
  <rect x="70" y="20" width="8" height="16" rx="4" fill="#fff" fill-opacity=".85"/>
  <rect x="24" y="30" width="52" height="46" rx="11" fill="#fff"/>
  <rect x="24" y="30" width="52" height="15" rx="11" fill="#EDE9FE"/>
  <rect x="24" y="38" width="52" height="7" fill="#EDE9FE"/>
  <g fill="#C7CBF5"><circle cx="34" cy="54" r="3"/><circle cx="50" cy="54" r="3"/><circle cx="66" cy="54" r="3"/><circle cx="34" cy="66" r="3"/></g>
  <circle cx="50" cy="66" r="5.5" fill="#22C55E"/><circle cx="66" cy="66" r="3" fill="#C7CBF5"/></svg>`;

// ------------------------------------------------------------------ API

async function api(path, timeout = 120000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch("/api/" + path, { cache: "no-store", signal: ctl.signal });
    return await res.json();
  } catch (e) {
    return { ok: false, code: "network", error: String(e && e.message || e) };
  } finally {
    clearTimeout(timer);
  }
}

function handleError(r, silent) {
  if (!r || r.ok) return;
  if (r.code === "login_failed" || r.code === "not_logged_in") {
    try { A && A.logout(); } catch (e) { }
    store.clear();
    showLogin(r.code === "login_failed" ? T.loginFailed : "");
    return;
  }
  if (!silent) toast(r.code === "network" ? T.staleData : (r.error || T.networkError));
}

function toast(text) {
  const el = $("#toast");
  if (Date.now() - S.lastToast < 4000 && el.textContent === text) return;
  S.lastToast = Date.now();
  el.textContent = text;
  el.classList.add("show");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove("show"), 2800);
}

// ------------------------------------------------------------------ язык и тема

function detectLang() {
  const n = (navigator.language || "").toLowerCase();
  return n.startsWith("ru") ? "ru" : n.startsWith("en") ? "en" : "uz";
}

function setLang(lang, save) {
  L = I18N[lang] ? lang : "uz";
  T = I18N[L];
  document.documentElement.lang = L;
  if (save) { try { A && A.setLang(L); } catch (e) { } }
  $$("[data-t]").forEach(el => { el.textContent = T[el.dataset.t]; });
}

const isDark = () => window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches;
function applyBars(splash) {
  if (!A) return;
  const bg = splash ? "#1E1B4B" : getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
  try { A.setBars(bg, splash || isDark()); } catch (e) { }
}

function segHtml(id, items, current) {
  return `<div class="seg" id="${id}"><div class="seg-pill"></div>${items.map(([v, label]) =>
    `<button data-v="${v}" class="${v === current ? "on" : ""}">${label}</button>`).join("")}</div>`;
}
function placeSeg(el) {
  if (!el) return;
  const on = el.querySelector("button.on"), pill = el.querySelector(".seg-pill");
  if (!on || !pill) return;
  pill.style.width = on.offsetWidth + "px";
  pill.style.transform = `translateX(${on.offsetLeft}px)`;
}
const LANGS = [["uz", "O'zbek"], ["ru", "Русский"], ["en", "English"]];
const LANGS_SHORT = [["uz", "UZ"], ["ru", "RU"], ["en", "EN"]];

// ------------------------------------------------------------------ заставка

const APP_NAME = "Пары";
const FLIP_STEP = 0.24, FLIP_DUR = 0.5;
function startSplash() {
  // календарь, у которого страницы перелистываются к сегодняшнему дню
  const now = nowT(), mon = T.months[now.getUTCMonth()].slice(0, 3).toUpperCase();
  let sheets = "";
  for (let i = 0; i < 4; i++) {
    const d = addDays(dayStart(now), i - 3), final = i === 3;
    sheets += `<div class="cal-sheet${final ? " final" : " flip"}" style="z-index:${4 - i};--d:${(i * FLIP_STEP).toFixed(2)}s">
      <div class="hd">${esc(mon)}</div>
      <div class="bd"><span>${esc(T.daysShort[dow(d)])}</span><b>${d.getUTCDate()}</b></div></div>`;
  }
  $("#sp-icon").innerHTML = `<div class="cal"><div class="cal-hang"><i></i><i></i></div><div class="cal-stack">${sheets}</div></div>`;

  const nameAt = 3 * FLIP_STEP + FLIP_DUR - 0.15;   // имя проявляется, когда долистали до сегодня
  $("#sp-name").innerHTML = [...APP_NAME].map((c, i) => `<span style="animation-delay:${(nameAt + i * 0.09).toFixed(2)}s">${esc(c)}</span>`).join("");
  $("#sp-tag").style.animationDelay = (nameAt + APP_NAME.length * 0.09 + 0.12).toFixed(2) + "s";
  $("#sp-tag").textContent = T.tagline;
  applyBars(true);
}
const SPLASH_MS = Math.round((3 * FLIP_STEP + FLIP_DUR + APP_NAME.length * 0.09 + 0.5) * 1000);

async function endSplash() {
  const sp = $("#splash");
  sp.classList.add("out");
  applyBars(false);
  await sleep(600);
  sp.remove();
}

// ------------------------------------------------------------------ вход

function showLogin(message) {
  $("#main").hidden = true;
  closeSheet();
  const el = $("#login");
  el.hidden = false;
  el.innerHTML = `
    <div class="lg-top">${segHtml("lg-lang", LANGS_SHORT, L)}</div>
    <div class="lg-hero"><div class="logo">${LOGO}</div><h1>${esc(APP_NAME)}</h1><p>${esc(T.tagline)}</p></div>
    <div class="card lg-card" id="lg-card">
      <h2>${esc(T.loginTitle)}</h2><p>${esc(T.loginHint)}</p>
      <form id="lg-form" autocomplete="on">
        <div class="field"><label for="lg-login">${esc(T.login)}</label>
          <input id="lg-login" name="login" inputmode="numeric" autocomplete="username" autocapitalize="off" spellcheck="false"></div>
        <div class="field"><label for="lg-pass">${esc(T.password)}</label>
          <input id="lg-pass" name="password" type="password" autocomplete="current-password">
          <button type="button" class="eye" id="lg-eye" aria-label="Show password">${icon("eye")}</button></div>
        <div class="lg-error" id="lg-error">${esc(message || "")}</div>
        <button class="btn" id="lg-btn" type="submit">${esc(T.signIn)}</button>
      </form>
      <div class="lg-privacy">${icon("shield")}<span>${esc(T.privacy)}</span></div>
    </div>`;
  requestAnimationFrame(() => placeSeg($("#lg-lang")));
  $("#lg-lang").addEventListener("click", e => {
    const b = e.target.closest("button[data-v]");
    if (!b || b.dataset.v === L) return;
    const login = $("#lg-login").value;
    setLang(b.dataset.v, true);
    showLogin();
    $("#lg-login").value = login;
  });
  $("#lg-eye").addEventListener("click", () => {
    const p = $("#lg-pass");
    p.type = p.type === "password" ? "text" : "password";
    $("#lg-eye").innerHTML = icon(p.type === "password" ? "eye" : "eyeOff");
  });
  $("#lg-form").addEventListener("submit", e => { e.preventDefault(); doLogin(); });
}

async function doLogin() {
  const login = $("#lg-login").value.trim(), pass = $("#lg-pass").value;
  const card = $("#lg-card"), btn = $("#lg-btn"), err = $("#lg-error");
  const fail = msg => {
    err.textContent = msg;
    card.classList.remove("shake"); void card.offsetWidth; card.classList.add("shake");
    btn.disabled = false; btn.innerHTML = esc(T.signIn);
  };
  if (!login || !pass) return fail(T.loginHint);
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span>`;
  err.textContent = "";
  document.activeElement && document.activeElement.blur();

  if (A && !A.saveLogin(login, pass)) return fail(T.networkError);
  const r = await api("login", 45000);
  if (!r.ok) {
    if (r.code === "login_failed") { try { A && A.logout(); } catch (e) { } }
    return fail(r.code === "login_failed" ? T.loginFailed : T.networkError);
  }
  S.me = r;
  store.set("me:" + L, r);
  haptic();
  card.innerHTML = `<div class="lg-success"><div class="check-anim">${icon("check")}</div>
    <h2>${esc(T.welcome(r.firstName || ""))}</h2><p style="color:var(--muted);margin:4px 0 0">${esc(T.groupDetected)}</p>
    <div class="grp">${esc(r.group || "—")}</div></div>`;
  ensureWeek(mondayOf(today()));
  await sleep(1700);
  $("#login").hidden = true;
  showMain();
}

// ------------------------------------------------------------------ основной экран

function showMain() {
  $("#login").hidden = true;
  $("#main").hidden = false;
  S.sel = today();
  $("#nav-i-schedule").innerHTML = icon("calendar");
  $("#nav-i-tasks").innerHTML = icon("tasks");
  $("#nav-i-grades").innerHTML = icon("grades");
  setLang(L, false);
  renderAvatar();
  setTab("schedule", true);
  renderPager(true);

  preloadWeeks();
  syncSoon();
  loadMe(true);
  loadTasks(false, true);
  if (S.reminders.length) { try { A && A.askNotificationsOnce(); } catch (e) { } }
}

async function loadMe(force) {
  const r = await api("me" + (force ? "?refresh=1" : ""));
  if (r.ok) {
    S.me = r;
    store.set("me:" + L, r);
    renderAvatar();
    renderHeader(false);
  } else handleError(r, true);
}

function initials() {
  const me = S.me || {};
  return ((me.firstName || "").charAt(0) + (me.lastName || "").charAt(0)).toUpperCase() || "D";
}

function setAvatar(el) {
  const me = S.me || {};
  if (!el) return;
  if (me.image) {
    el.innerHTML = `<img src="${esc(me.image)}" alt="">`;
    el.firstChild.onerror = () => { el.textContent = initials(); };
  } else el.textContent = initials();
}
const renderAvatar = () => setAvatar($("#avatar"));

function renderHeader(anim, date) {
  if (!S.sel) return;
  const d = date || S.sel;
  let title, sub;
  if (S.tab === "schedule") {
    title = relDay(d);
    const grp = S.me && S.me.group ? ` · ${S.me.group}` : "";
    sub = (L === "en" ? `${T.days[dow(d)]}, ${fmtDate(d)}` : `${fmtDate(d)}, ${T.days[dow(d)].toLowerCase()}`) + grp;
  } else if (S.tab === "tasks") {
    title = T.tabTasks;
    const active = (S.tasks && S.tasks.items || []).filter(t => taskState(t) !== "done").length;
    sub = S.tasks ? `${T.tasksActive}: ${active}` : T.loading;
  } else {
    title = T.tabGrades;
    const sem = S.grades && (S.grades.semesters || []).find(s => s.code === S.grades.semester);
    sub = sem ? sem.name : (S.me && S.me.semesterName) || "";
  }
  const t = $("#t-title"), s = $("#t-sub");
  if (t.textContent === title && s.textContent === sub) return;
  t.textContent = title;
  s.textContent = sub;
  if (anim) { t.classList.remove("t-anim"); void t.offsetWidth; t.classList.add("t-anim"); }
}

function setTab(tab, silent) {
  if (!silent && tab === S.tab) {
    if (tab === "schedule" && iso(S.sel) !== iso(today())) goToDate(today());
    return;
  }
  S.tab = tab;
  $$(".tab").forEach(el => el.classList.toggle("active", el.id === "tab-" + tab));
  const idx = ["schedule", "tasks", "grades"].indexOf(tab);
  $$("#nav button").forEach((b, i) => b.classList.toggle("on", i === idx));
  $("#nav-pill").style.transform = `translateX(${idx * 100}%)`;
  if (!silent) haptic();
  if (tab === "tasks") { renderTasks(true); loadTasks(false); }
  if (tab === "grades") { renderGrades(true); loadGrades(false); }
  renderHeader(true);
}

// ------------------------------------------------------------------ расписание: данные

const weekKey = m => iso(m) + ":" + L;
const getWeek = m => S.weeks[weekKey(m)] || null;

function ensureWeek(m, force, recheck) {
  const k = weekKey(m);
  if (!S.weeks[k]) {
    const cached = store.get("w:" + k);
    if (cached) S.weeks[k] = cached;
  }
  if (S.pending[k]) return S.pending[k];
  const w = S.weeks[k];
  if (!force && !recheck && w && w.lessons && Date.now() - (w._at || 0) < 5 * 60e3) return Promise.resolve(w);

  const p = api(`week?start=${iso(m)}${force ? "&refresh=1" : ""}`).then(r => {
    delete S.pending[k];
    if (r.ok) {
      r._at = Date.now();
      noticeSiteChange(r.changedAt);
      const before = S.weeks[k] && JSON.stringify(S.weeks[k].lessons);
      S.weeks[k] = r;
      store.set("w:" + k, r);
      pruneWeeks();
      onWeekLoaded(m, before !== JSON.stringify(r.lessons));
    } else {
      handleError(r, !!(S.weeks[k] && S.weeks[k].lessons));
      if (!(S.weeks[k] && S.weeks[k].lessons)) { S.weeks[k] = { error: r }; onWeekLoaded(m, true); }
    }
    return r;
  });
  S.pending[k] = p;
  return p;
}

// сайт изменил расписание после того, как пользователь его видел
function noticeSiteChange(changedAt) {
  if (!changedAt) return;
  const seen = store.get("seenChange") || 0;
  if (changedAt > seen) {
    store.set("seenChange", changedAt);
    if (seen) toast(T.scheduleChanged);
  }
}

// синхронизация с tsue.edupage.org: сервер приложения обновляет данные в фоне,
// поэтому через некоторое время после открытия перечитываем неделю
function syncSoon() {
  [25000, 70000].forEach(ms => setTimeout(() => {
    if (!S.sel) return;
    const m = mondayOf(today());
    ensureWeek(m, false, true).then(() => ensureWeek(addDays(m, 7), false, true)).then(syncReminders);
  }, ms));
}

// текущая и две следующие недели: для полосы дней и для напоминаний
function preloadWeeks() {
  const m = mondayOf(today());
  return ensureWeek(m).then(() => ensureWeek(addDays(m, 7))).then(() => ensureWeek(addDays(m, 14)))
    .then(() => { if (S.sel) renderStrip(); syncReminders(); });
}

function pruneWeeks() {
  const min = iso(addDays(mondayOf(today()), -28));
  try {
    Object.keys(localStorage).filter(k => k.startsWith("w:") && k.slice(2, 12) < min).forEach(k => localStorage.removeItem(k));
  } catch (e) { }
}

function lessonsOn(date) {
  const w = getWeek(mondayOf(date));
  if (!w || !w.lessons) return null;
  const key = iso(date);
  return w.lessons.filter(l => l.date === key).sort((a, b) => mins(a.start) - mins(b.start));
}

function onWeekLoaded(m, changed) {
  if (!changed || !S.sel || $("#main").hidden) return;
  const visible = [-1, 0, 1].some(i => iso(mondayOf(addDays(S.sel, i))) === iso(m));
  if (visible && !S.animating) renderPager(false, true);
  if (iso(mondayOf(S.sel)) === iso(m)) renderStrip();
  syncReminders();
}

// ------------------------------------------------------------------ расписание: отрисовка

function lessonState(l, date) {
  const d = iso(date), t = iso(today());
  if (d < t) return "past";
  if (d > t) return "";
  const n = nowMin();
  if (n >= mins(l.end)) return "past";
  if (n >= mins(l.start)) return "now";
  return "future";
}

function progress(l) {
  const s = mins(l.start), e = mins(l.end);
  return Math.min(100, Math.max(0, (nowMin() - s) / Math.max(1, e - s) * 100));
}

function kindLabel(l) { return l.kindName || T.kind[l.kind] || T.kind.other; }

function lessonHtml(l, st, i, anim) {
  const kind = T.kind[l.kind] ? l.kind : "other";
  let fill = "", extra = "";
  if (st === "now") {
    const p = (progress(l) / 100).toFixed(4);
    fill = `<div class="l-fill" style="--p:${p}"><i class="fill"></i><i class="edge"></i></div>`;
    extra = `<div class="l-live"><span class="live-dot"></span><span class="batt" style="--p:${p}"><i></i></span>
      <b class="pct">${Math.floor(progress(l))}%</b><span class="rest">${esc(T.left(dur(mins(l.end) - nowMin(), true)))}</span></div>`;
  } else if (st === "next") {
    extra = `<div class="l-next">${esc(T.nextUp)} · ${esc(T.inTime(dur(mins(l.start) - nowMin())))}</div>`;
  }
  const meta = [
    l.room && `<span>${icon("pin")}${esc(l.room)}${l.building ? ", " + esc(l.building) : ""}</span>`,
    l.teacher && `<span>${icon("user")}${esc(l.teacher)}</span>`,
  ].filter(Boolean).join("");
  return `<div class="lesson k-${kind} ${st}${anim ? " anim" : ""}" style="--i:${i}" data-start="${esc(l.start)}" data-end="${esc(l.end)}">${fill}
    <div class="l-time"><b>${esc(l.start)}</b><span>${esc(l.end)}</span></div>
    <div class="l-body">
      <div class="l-top"><span class="chip">${esc(kindLabel(l))}</span>${l.period ? `<span class="l-num">${esc(T.pair(l.period))}</span>` : ""}</div>
      <div class="l-subj">${esc(translateSubject(l.subject, L))}</div>
      ${meta ? `<div class="l-meta">${meta}</div>` : ""}${extra}
    </div></div>`;
}

function nextLessonAfter(date) {
  for (let i = 1; i <= 14; i++) {
    const d = addDays(date, i);
    const list = lessonsOn(d);
    if (list === null) return null;
    if (list.length) return { date: d, lesson: list[0] };
  }
  return null;
}

function emptyHtml(date, anim) {
  const sunday = dow(date) === 6;
  const isToday = iso(date) === iso(today());
  const next = nextLessonAfter(date);
  let nextBtn = "";
  if (next) {
    const soon = Math.round((next.date - today()) / MS_DAY) === 1;
    let day = soon ? T.tomorrow : T.days[dow(next.date)];
    if (L !== "en") day = day.toLowerCase();
    nextBtn = `<button class="em-next press" data-go="${iso(next.date)}">${esc(T.nextLessonOn(day, next.lesson.start))}${icon("arrow")}</button>`;
  }
  return `<div class="empty${anim ? " anim" : ""}"><div class="em-ico">${icon(sunday ? "sun" : isToday ? "coffee" : "moon")}</div>
    <h3>${esc(sunday ? T.sunday : T.noLessons)}</h3><p>${sunday ? "" : esc(T.freeDay)}</p>${nextBtn}</div>`;
}

function skeletonHtml() {
  return `<div class="sk"></div><div class="sk" style="opacity:.7"></div><div class="sk" style="opacity:.4"></div>
    <div class="sk-hint">${esc(T.firstLoad)}</div>`;
}

function errorHtml(r) {
  const net = r && r.code === "network";
  return `<div class="empty anim"><div class="em-ico">${icon("info")}</div><h3>${esc(net ? T.networkError : (r && r.error) || T.networkError)}</h3>
    <button class="em-next press" data-retry="1">${icon("refresh")}${esc(T.retry)}</button></div>`;
}

function pageHtml(date, anim) {
  const w = getWeek(mondayOf(date));
  if (!w) return skeletonHtml();
  if (!w.lessons) return errorHtml(w.error);
  let html = "";
  if (w.note === "group_not_found") html += `<div class="note">${icon("info")}<span>${esc(T.groupNotFound)}</span></div>`;
  else if (w.outdated) html += `<div class="note">${icon("info")}<span>${esc(T.outdated)}</span></div>`;
  const list = lessonsOn(date);
  if (!list.length) return html + emptyHtml(date, anim);

  const states = list.map(l => lessonState(l, date));
  const nowIdx = states.indexOf("now");
  const nextIdx = states.indexOf("future");
  let prevEnd = null;
  list.forEach((l, i) => {
    if (prevEnd !== null) {
      const gap = mins(l.start) - prevEnd;
      if (gap >= 20) html += `<div class="break">${icon("coffee")}${esc(T.brk(dur(gap, true)))}</div>`;
    }
    let st = states[i];
    if (st === "future") st = (i === nextIdx && nowIdx < 0) ? "next" : "";
    html += lessonHtml(l, st, i, anim);
    prevEnd = mins(l.end);
  });
  if (iso(date) === iso(today()) && states.every(s => s === "past")) {
    html += `<div class="note ok">${icon("party")}<span>${esc(T.dayDone)}</span></div>`;
  }
  if (w.source === "edupage") html += `<div class="src">${esc(T.sourceEdupage)}</div>`;
  return html;
}

function pages() { return $$("#track .page"); }

function renderPager(anim, keepScroll) {
  const ps = pages();
  ps.forEach((p, i) => {
    const d = addDays(S.sel, i - 1);
    const top = p.scrollTop;
    p.innerHTML = pageHtml(d, anim && i === 1);
    p.dataset.date = iso(d);
    p.scrollTop = keepScroll && i === 1 ? top : 0;
  });
  renderStrip();
  renderHeader(false);
  pageSignature = signature();
}

let stripMonday = null;
function renderStrip() {
  const m = mondayOf(S.sel), t = iso(today());
  const row = $("#wd-row");
  let html = "";
  for (let i = 0; i < 7; i++) {
    const d = addDays(m, i), list = lessonsOn(d);
    const cls = [list && list.length ? "has" : "", iso(d) === t ? "today" : "", i === dow(S.sel) ? "sel" : ""].join(" ");
    html += `<button class="wd ${cls}" data-date="${iso(d)}"><span>${esc(T.daysShort[i])}</span><b>${d.getUTCDate()}</b><i></i></button>`;
  }
  row.innerHTML = html;
  if (stripMonday && stripMonday !== iso(m)) {
    row.classList.remove("from-r", "from-l"); void row.offsetWidth;
    row.classList.add(iso(m) > stripMonday ? "from-r" : "from-l");
  }
  stripMonday = iso(m);
  $("#week-pill").style.transform = `translateX(${dow(S.sel) * 100}%)`;
}

function goToDate(target) {
  target = dayStart(target);
  const diff = Math.round((target - S.sel) / MS_DAY);
  if (!diff || S.animating) return;
  if (Math.abs(diff) === 1) return slide(diff);
  S.sel = target;
  haptic();
  renderPager(true);
  const mid = pages()[1];
  mid.classList.remove("enter-r", "enter-l"); void mid.offsetWidth;
  mid.classList.add(diff > 0 ? "enter-r" : "enter-l");
  prefetchAround();
}

// перемещает выделение дня в полосе недели без перерисовки (если это та же неделя)
function moveStripTo(date) {
  if (iso(mondayOf(date)) !== stripMonday) return false;
  const wd = dow(date);
  $("#week-pill").style.transform = `translateX(${wd * 100}%)`;
  $$("#wd-row .wd").forEach((el, i) => el.classList.toggle("sel", i === wd));
  return true;
}

function slide(dir) {
  const track = $("#track");
  S.animating = true;
  haptic();
  // заголовок и полоса недели меняются СРАЗУ, вместе с началом анимации, а не в конце
  const target = addDays(S.sel, dir);
  renderHeader(true, target);
  const sameWeek = moveStripTo(target);
  track.classList.add("anim");
  track.style.transform = `translate3d(${dir > 0 ? "-66.6667%" : "0%"},0,0)`;
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    track.classList.remove("anim");
    S.sel = target;
    // страницы не перерисовываются: крайняя переезжает на другую сторону, заново рисуется только она
    const ps = pages();
    if (dir > 0) track.appendChild(ps[0]); else track.insertBefore(ps[2], ps[0]);
    track.style.transform = "translate3d(-33.3333%,0,0)";
    const side = pages()[dir > 0 ? 2 : 0], d = addDays(S.sel, dir);
    side.innerHTML = pageHtml(d, false);
    side.dataset.date = iso(d);
    side.scrollTop = 0;
    if (!sameWeek) renderStrip();   // перешли на другую неделю - перерисовать полосу
    pageSignature = signature();
    S.animating = false;
    prefetchAround();
  };
  track.addEventListener("transitionend", finish, { once: true });
  setTimeout(finish, 380);
}

function prefetchAround() {
  const m = mondayOf(S.sel);
  ensureWeek(m);
  if (dow(S.sel) >= 5) ensureWeek(addDays(m, 7));
  if (dow(S.sel) === 0) ensureWeek(addDays(m, -7));
}

// обновление «текущей пары» каждые 15 секунд без перерисовки всей страницы
let pageSignature = "";
function signature() {
  const list = lessonsOn(S.sel) || [];
  return iso(today()) + "|" + list.map(l => lessonState(l, S.sel)).join(",");
}

function tick() {
  if ($("#main").hidden) return;
  if (S.tab === "schedule" && !S.animating) {
    const sig = signature();
    if (sig !== pageSignature) {
      renderPager(false, true);
    } else {
      const card = pages()[1].querySelector(".lesson.now");
      if (card) {
        const l = { start: card.dataset.start, end: card.dataset.end };
        const p = progress(l);
        card.querySelector(".l-fill").style.setProperty("--p", (p / 100).toFixed(4));
        card.querySelector(".batt").style.setProperty("--p", (p / 100).toFixed(4));
        card.querySelector(".pct").textContent = Math.floor(p) + "%";
        card.querySelector(".rest").textContent = T.left(dur(mins(l.end) - nowMin(), true));
      }
      const next = pages()[1].querySelector(".lesson.next .l-next");
      if (next) {
        const start = next.closest(".lesson").dataset.start;
        next.textContent = `${T.nextUp} · ${T.inTime(dur(mins(start) - nowMin()))}`;
      }
    }
  }
}

// ------------------------------------------------------------------ жесты: листание и «потяни, чтобы обновить»

function attachPull(container, getScroller, ptrEl, onRefresh, allowHorizontal) {
  let sx = 0, sy = 0, mode = null, dx = 0, dist = 0, t0 = 0, busy = false, previewDay = null;
  ptrEl.innerHTML = icon("down");
  container.addEventListener("touchstart", e => {
    if (S.animating || busy) { mode = "x"; return; }
    const t = e.touches[0];
    sx = t.clientX; sy = t.clientY; mode = null; dx = 0; dist = 0; t0 = Date.now();
    ptrEl.classList.remove("back");
  }, { passive: true });

  container.addEventListener("touchmove", e => {
    if (mode === "x" || mode === "v") return;
    const t = e.touches[0], mx = t.clientX - sx, my = t.clientY - sy;
    if (!mode) {
      if (allowHorizontal && Math.abs(mx) > 10 && Math.abs(mx) > Math.abs(my) * 1.2) mode = "h";
      else if (Math.abs(my) > 8) mode = my > 0 && getScroller().scrollTop <= 0 ? "pull" : "v";
      else return;
    }
    if (mode === "h") {
      e.preventDefault();
      dx = mx;
      $("#track").style.transform = `translate3d(calc(-33.3333% + ${dx}px),0,0)`;
      // день в шапке меняется уже во время перетаскивания, как только палец прошёл треть экрана
      const want = Math.abs(dx) > container.clientWidth * 0.3 ? addDays(S.sel, dx < 0 ? 1 : -1) : S.sel;
      if (iso(want) !== previewDay) { previewDay = iso(want); renderHeader(false, want); moveStripTo(want); }
    } else if (mode === "pull") {
      e.preventDefault();
      dist = Math.min(120, Math.max(0, my * 0.5));
      ptrEl.style.opacity = Math.min(1, dist / 60);
      ptrEl.style.transform = `translateY(${dist - 44}px) rotate(${dist * 3}deg)`;
      ptrEl.firstChild.style.transform = dist > 70 ? "rotate(180deg)" : "";
    }
  }, { passive: false });

  const end = async () => {
    if (mode === "h") {
      const w = container.clientWidth, v = dx / Math.max(1, Date.now() - t0);
      const track = $("#track");
      previewDay = null;
      if (dx < -w * 0.2 || v < -0.45) slide(1);
      else if (dx > w * 0.2 || v > 0.45) slide(-1);
      else {
        renderHeader(false, S.sel); moveStripTo(S.sel);   // недотянули - вернуть день обратно
        track.classList.add("anim");
        track.style.transform = "translate3d(-33.3333%,0,0)";
        setTimeout(() => track.classList.remove("anim"), 300);
      }
    } else if (mode === "pull") {
      ptrEl.classList.add("back");
      if (dist > 70) {
        busy = true;
        haptic();
        ptrEl.classList.add("loading");
        ptrEl.innerHTML = icon("refresh");
        ptrEl.style.transform = "translateY(18px)";
        try { await onRefresh(); } finally {
          busy = false;
          ptrEl.classList.remove("loading");
          ptrEl.style.opacity = 0;
          ptrEl.style.transform = "translateY(-50px)";
          setTimeout(() => { ptrEl.innerHTML = icon("down"); }, 300);
        }
      } else {
        ptrEl.style.opacity = 0;
        ptrEl.style.transform = "translateY(-50px)";
      }
    }
    mode = null;
  };
  container.addEventListener("touchend", end);
  container.addEventListener("touchcancel", end);
}

async function refreshAll() {
  const m = mondayOf(S.sel);
  const jobs = [ensureWeek(m, true), loadMe(true)];
  if (S.tab === "tasks") jobs.push(loadTasks(true));
  if (S.tab === "grades") jobs.push(loadGrades(true));
  await Promise.all(jobs);
  toast(T.updated);
}

// ------------------------------------------------------------------ задания

function taskState(t) {
  const graded = t.grade !== null && t.grade !== undefined && t.grade !== "";
  const doneText = /baholan|tekshiril|yuborilgan|topshirilgan|qabul|оцен|отправ|сдан|провер|принят|graded|submitted|checked|marked|accepted|done|complete/i;
  if (graded || doneText.test(t.status || "")) return "done";
  if (t.deadline && t.deadline * 1000 < Date.now()) return "overdue";
  return "active";
}

async function loadTasks(force, background) {
  if (!S.tasks) S.tasks = store.get("tasks:" + L);
  if (!background) renderTasks(false);
  const r = await api("tasks" + (force ? "?refresh=1" : ""));
  if (r.ok) {
    const changed = JSON.stringify(r.items) !== JSON.stringify(S.tasks && S.tasks.items);
    S.tasks = r;
    store.set("tasks:" + L, r);
    if (changed && S.tab === "tasks") renderTasks(true);
  } else {
    handleError(r, !!S.tasks);
    if (!S.tasks) S.tasks = { error: r };
    if (S.tab === "tasks") renderTasks(false);
  }
  updateBadge();
  if (S.tab === "tasks") renderHeader(false);
}

function updateBadge() {
  const items = S.tasks && S.tasks.items || [];
  const soon = items.filter(t => taskState(t) === "active" && t.deadline && t.deadline * 1000 - Date.now() < 3 * MS_DAY).length;
  const b = $("#task-badge");
  b.hidden = !soon;
  b.textContent = soon;
}

function deadlineInfo(t, st) {
  if (!t.deadline) return { text: T.noDeadline, cls: "" };
  const left = t.deadline * 1000 - Date.now();
  const d = fromEpoch(t.deadline);
  const date = `${fmtDate(d)}, ${hhmm(d)}`;
  if (st === "done") return { text: date, cls: "green" };
  if (left < 0) return { text: `${T.overdue} · ${date}`, cls: "red", urgency: "" };
  if (left < 48 * 3600e3) return { text: T.hoursLeft(Math.max(1, Math.round(left / 3600e3))), cls: "red", urgency: "urgent", date };
  if (left < 4 * MS_DAY) return { text: T.daysLeft(Math.round(left / MS_DAY)), cls: "amber", urgency: "soon", date };
  return { text: T.daysLeft(Math.round(left / MS_DAY)), cls: "blue", urgency: "", date };
}

function taskHtml(t, idx, i, anim) {
  const st = taskState(t);
  const dl = deadlineInfo(t, st);
  const graded = t.grade !== null && t.grade !== undefined && t.grade !== "";
  const score = graded ? `<span class="score">${esc(t.grade)}${t.max !== null && t.max !== undefined ? " / " + esc(t.max) : ""}</span>` : "";
  const files = (t.files || []).filter(f => f.url).map(f =>
    `<button class="file press" data-url="${esc(f.url)}">${icon("file")}<span>${esc(f.name || f.url)}</span>${icon("arrow")}</button>`).join("");
  const kv = [
    [T.type, [t.type, t.trainingType].filter(Boolean).join(" · ")],
    [T.teacher, t.teacher],
    [T.deadline, t.deadline ? `${fmtDate(fromEpoch(t.deadline))}, ${hhmm(fromEpoch(t.deadline))}` : ""],
    [T.maxScore, t.max],
    [T.attempts, t.attemptLimit ? `${t.attempts || 0} / ${t.attemptLimit}` : ""],
  ].filter(([, v]) => v !== null && v !== undefined && v !== "").map(([k, v]) => `<div class="kv"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join("");
  const comment = plainText(t.comment);
  return `<div class="task st-${st} ${dl.urgency || ""}${anim ? " anim" : ""}${S.openTask === idx ? " open" : ""}" style="--i:${i}" data-idx="${idx}">
    <div class="tk-top"><span class="tk-subj">${esc(translateSubject(t.subject, L))}</span>${score}</div>
    <div class="tk-name">${esc(t.name)}</div>
    <div class="tk-row"><span class="pill ${dl.cls}">${icon(st === "done" ? "check" : "clock")}${esc(dl.text)}</span>${t.status ? `<span class="pill">${esc(t.status)}</span>` : ""}</div>
    <div class="tk-more"><div><div class="tk-det">${kv}${comment ? `<div class="tk-comment">${esc(comment)}</div>` : ""}${files}</div></div></div>
  </div>`;
}

function renderTasks(anim) {
  const box = $("#tasks-scroll");
  if (!S.tasks) { box.innerHTML = `<div class="sk"></div><div class="sk" style="opacity:.6"></div>`; return; }
  if (!S.tasks.items) { box.innerHTML = errorHtml(S.tasks.error); return; }
  const items = S.tasks.items.map((t, idx) => ({ t, idx, st: taskState(t) }));
  const count = f => items.filter(x => f === "all" || (f === "done" ? x.st === "done" : x.st !== "done")).length;
  const chips = [["active", T.tasksActive], ["all", T.tasksAll], ["done", T.tasksDone]].map(([f, label]) =>
    `<button class="fchip press ${S.taskFilter === f ? "on" : ""}" data-filter="${f}">${esc(label)}<small>${count(f)}</small></button>`).join("");

  let list = items.filter(x => S.taskFilter === "all" || (S.taskFilter === "done" ? x.st === "done" : x.st !== "done"));
  const rank = x => x.st === "active" ? 0 : x.st === "overdue" ? 1 : 2;
  list.sort((a, b) => rank(a) - rank(b) || (a.st === "active"
    ? (a.t.deadline || 9e12) - (b.t.deadline || 9e12)
    : (b.t.deadline || 0) - (a.t.deadline || 0)));

  const body = list.length ? list.map((x, i) => taskHtml(x.t, x.idx, i, anim)).join("")
    : `<div class="empty anim"><div class="em-ico">${icon(S.taskFilter === "active" ? "party" : "tasks")}</div>
       <h3>${esc(S.taskFilter === "active" ? T.noActiveTasks : T.noTasks)}</h3></div>`;
  box.innerHTML = (S.tasks.stale ? `<div class="note">${icon("info")}<span>${esc(T.staleData)}</span></div>` : "") +
    `<div class="chips">${chips}</div>` + body;
}

// ------------------------------------------------------------------ оценки

async function loadGrades(force, sem) {
  const semester = sem || S.gradesSem || "";
  const key = "grades:" + (semester || "cur") + ":" + L;
  if (!S.grades || sem) {
    S.grades = store.get(key);
    renderGrades(true);
  }
  const r = await api(`grades?semester=${encodeURIComponent(semester)}${force ? "&refresh=1" : ""}`);
  if (r.ok) {
    const changed = JSON.stringify(r.subjects) !== JSON.stringify(S.grades && S.grades.subjects);
    S.grades = r;
    store.set(key, r);
    if (S.tab === "grades" && changed) renderGrades(true);
  } else {
    handleError(r, !!S.grades);
    if (!S.grades) S.grades = { error: r };
    if (S.tab === "grades") renderGrades(false);
  }
  if (S.tab === "grades") renderHeader(false);
}

const num = v => { const n = parseFloat(String(v).replace(",", ".")); return isFinite(n) ? n : null; };
function percentOf(o) {
  if (!o) return null;
  const p = num(o.percent);
  if (p !== null) return Math.max(0, Math.min(100, p));
  const g = num(o.grade), m = num(o.max);
  return g !== null && m ? Math.max(0, Math.min(100, g / m * 100)) : null;
}
const rateClass = p => p === null ? "r0" : p >= 86 ? "r5" : p >= 71 ? "r4" : p >= 55 ? "r3" : "r2";

function gradeHtml(s, i) {
  const p = percentOf(s.overall);
  const exams = (s.exams || []).map(e => {
    const ep = percentOf(e);
    return `<div class="bar ${rateClass(ep)}"><span>${esc(e.name)}</span><i style="--w:${ep === null ? 0 : (ep / 100).toFixed(3)}"></i><b>${esc(e.grade)}${e.max !== null && e.max !== undefined ? "/" + esc(e.max) : ""}</b></div>`;
  }).join("");
  const info = [s.credit !== null && s.credit !== undefined && s.credit !== "" ? `${T.credits}: ${s.credit}` : "", s.overall && s.overall.label].filter(Boolean).join(" · ");
  const mark = s.overall && s.overall.grade !== null && s.overall.grade !== undefined && s.overall.grade !== "" ? esc(s.overall.grade) : "";
  return `<div class="grade anim ${rateClass(p)}" style="--i:${i}">
    <div class="g-head">
      <div class="ring"><svg viewBox="0 0 44 44"><circle class="rg-bg" cx="22" cy="22" r="18"/><circle class="rg" cx="22" cy="22" r="18" style="--p:${p === null ? 0 : p.toFixed(1)}"/></svg><b>${p === null ? "—" : Math.round(p)}</b></div>
      <div class="g-name"><b>${esc(translateSubject(s.name, L))}</b><small>${esc(info)}</small></div>
      ${mark && num(mark) !== null && num(mark) <= 5 ? `<div class="g-mark">${mark}</div>` : ""}
    </div>${exams ? `<div class="bars">${exams}</div>` : ""}</div>`;
}

function renderGrades(anim) {
  const box = $("#grades-scroll");
  const g = S.grades;
  if (!g) { box.innerHTML = `<div class="sk" style="height:110px"></div><div class="sk"></div><div class="sk" style="opacity:.6"></div>`; return; }
  if (!g.subjects) { box.innerHTML = errorHtml(g.error); return; }

  const subjects = g.subjects;
  const ps = subjects.map(s => percentOf(s.overall)).filter(p => p !== null);
  const avg = ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : null;
  const gpa = g.gpa && num(g.gpa.gpa);
  const hero = gpa !== null && gpa !== undefined && gpa > 0
    ? `<div class="hero"><div class="h-main"><span>${esc(T.gpa)}</span><b class="count" data-to="${gpa}" data-dec="2">0</b></div>
        <div class="h-side">${g.gpa.credits ? `<b>${esc(g.gpa.credits)}</b>${esc(T.credits)}<br>` : ""}${esc(g.gpa.year || "")}</div></div>`
    : avg !== null ? `<div class="hero"><div class="h-main"><span>${esc(T.average)}</span><b class="count" data-to="${avg.toFixed(1)}" data-dec="0" data-suffix="%">0</b></div>
        <div class="h-side"><b>${subjects.length}</b>${esc(T.tabGrades.toLowerCase())}</div></div>` : "";

  const sems = (g.semesters || []).filter(s => s.code);
  const chips = sems.length > 1 ? `<div class="chips">${sems.map(s =>
    `<button class="fchip press ${s.code === g.semester ? "on" : ""}" data-sem="${esc(s.code)}">${esc(s.name || s.code)}</button>`).join("")}</div>` : "";

  const list = subjects.length ? subjects.map((s, i) => gradeHtml(s, i)).join("")
    : `<div class="empty anim"><div class="em-ico">${icon("grades")}</div><h3>${esc(T.noGrades)}</h3></div>`;
  box.innerHTML = (g.stale ? `<div class="note">${icon("info")}<span>${esc(T.staleData)}</span></div>` : "") + hero + chips + list;
  if (!anim) box.querySelectorAll(".anim").forEach(el => el.classList.remove("anim"));
  countUp(box);
  const on = box.querySelector(".chips .fchip.on");
  if (on) on.scrollIntoView({ inline: "center", block: "nearest" });
}

function countUp(root) {
  root.querySelectorAll(".count").forEach(el => {
    const to = parseFloat(el.dataset.to), dec = +el.dataset.dec || 0, suffix = el.dataset.suffix || "";
    const t0 = performance.now(), len = 1100;
    const step = t => {
      const k = Math.min(1, (t - t0) / len), e = 1 - Math.pow(1 - k, 3);
      el.textContent = (to * e).toFixed(dec) + suffix;
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

// ------------------------------------------------------------------ настройки

function openSheet(html) {
  setSheet(html);
  $("#sheet").scrollTop = 0;
  document.body.classList.add("sheet-open");
}
function setSheet(html) {
  $("#sheet").innerHTML = `<div class="grab"></div>` + html;
  setAvatar($("#set-avatar"));
  placeSeg($("#set-lang"));
}
function closeSheet() { document.body.classList.remove("sheet-open"); }
const sheetOpen = () => document.body.classList.contains("sheet-open");

function notifAllowed() { try { return !A || A.notificationsAllowed(); } catch (e) { return true; } }

function settingsHtml() {
  const me = S.me || {};
  const sub = [me.specialty, me.level].filter(Boolean).join(" · ");
  const toggles = [1, 5, 10].map(n => `<button class="tgl press ${S.reminders.includes(n) ? "on" : ""}" data-rem="${n}">${icon("bell")}${esc(T.minBefore(n))}</button>`).join("");
  const warn = S.reminders.length && !notifAllowed()
    ? `<div class="warn">${icon("bell")}<span>${esc(T.notifOff)}</span><button data-act="allow">${esc(T.allow)}</button></div>` : "";
  return `
    <div class="card profile"><div class="avatar" id="set-avatar"></div><div style="min-width:0">
      <b>${esc(me.fullName || [me.lastName, me.firstName].filter(Boolean).join(" "))}</b>
      ${sub ? `<small>${esc(sub)}</small>` : ""}${me.group ? `<span class="gchip">${esc(me.group)}</span>` : ""}</div></div>
    <div class="sec"><h4>${icon("globe")}${esc(T.language)}</h4>${segHtml("set-lang", LANGS, L).replace('class="seg"', 'class="seg wide"')}</div>
    <div class="sec"><h4>${icon("bell")}${esc(T.reminders)}</h4><div class="toggles">${toggles}</div><p>${esc(T.remindersHint)}</p>${warn}</div>
    <div class="actions">
      <button class="btn ghost" data-act="refresh">${icon("refresh")}${esc(T.refresh)}</button>
      <button class="btn danger" data-act="logout">${icon("logout")}${esc(T.logout)}</button>
    </div>
    <div class="ver">${esc(APP_NAME)} ${esc(S.state && S.state.version || "")}${S.state && S.state.webVersion ? " · web " + esc(S.state.webVersion) : ""} · tsue.edupage.org · HEMIS</div>`;
}

function openSettings() {
  haptic();
  openSheet(settingsHtml());
}

function onSheetClick(e) {
  const langBtn = e.target.closest("#set-lang button[data-v]");
  if (langBtn && langBtn.dataset.v !== L) {
    setLang(langBtn.dataset.v, true);
    S.me = store.get("me:" + L) || S.me;
    S.tasks = null; S.grades = null;
    setSheet(settingsHtml());
    renderPager(false);
    renderHeader(true);
    ensureWeek(mondayOf(S.sel));
    preloadWeeks();
    loadMe(false);
    loadTasks(false, S.tab !== "tasks");
    if (S.tab === "grades") loadGrades(false);
    syncReminders();
    return;
  }
  const rem = e.target.closest("[data-rem]");
  if (rem) {
    const n = +rem.dataset.rem;
    S.reminders = S.reminders.includes(n) ? S.reminders.filter(x => x !== n) : [...S.reminders, n].sort((a, b) => a - b);
    try { A && A.setReminders(S.reminders.join(",")); } catch (err) { }
    rem.classList.toggle("on", S.reminders.includes(n));
    haptic();
    if (S.reminders.length && !notifAllowed()) { try { A.requestNotifications(); } catch (err) { } }
    syncReminders();
    setTimeout(refreshSettings, 300);
    return;
  }
  const act = e.target.closest("[data-act]");
  if (!act) return;
  switch (act.dataset.act) {
    case "allow": try { A && A.requestNotifications(); } catch (err) { } break;
    case "refresh": closeSheet(); refreshAll(); break;
    case "logout":
      setSheet(`<div class="confirm"><div class="em-ico" style="animation:none">${icon("logout")}</div>
        <p>${esc(T.logoutConfirm)}</p><div class="actions" style="margin-top:0">
        <button class="btn danger" data-act="logout-yes">${esc(T.yes)}</button><button class="btn ghost" data-act="close">${esc(T.cancel)}</button></div></div>`);
      break;
    case "logout-yes":
      try { A && A.logout(); } catch (err) { }
      store.clear();
      S.me = null; S.weeks = {}; S.tasks = null; S.grades = null;
      closeSheet();
      showLogin();
      break;
    case "close": closeSheet(); break;
  }
}

function refreshSettings() {
  if (sheetOpen() && $("#set-lang")) setSheet(settingsHtml());
}

// ------------------------------------------------------------------ напоминания

let syncTimer = null;
function syncReminders() {
  if (!A) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    const list = [], now = Date.now(), t0 = today();
    for (let i = 0; i < 21; i++) {
      const d = addDays(t0, i), lessons = lessonsOn(d);
      if (!lessons) continue;
      for (const l of lessons) {
        const [y, m, dd] = iso(d).split("-").map(Number), [h, mi] = String(l.start).split(":").map(Number);
        const at = Date.UTC(y, m - 1, dd, h, mi || 0) - TZ_OFFSET;
        if (at > now) list.push({ at, subject: translateSubject(l.subject, L), room: l.room || "", kind: kindLabel(l) });
      }
    }
    try { A.setUpcoming(JSON.stringify(list)); } catch (e) { }
  }, 400);
}

// ------------------------------------------------------------------ события

function bindEvents() {
  $("#nav").addEventListener("click", e => { const b = e.target.closest("button[data-tab]"); if (b) setTab(b.dataset.tab); });
  $("#avatar").addEventListener("click", openSettings);
  $("#sheet-bg").addEventListener("click", closeSheet);
  $("#sheet").addEventListener("click", onSheetClick);

  $("#wd-row").addEventListener("click", e => { const b = e.target.closest("[data-date]"); if (b) goToDate(parseIso(b.dataset.date)); });
  $("#track").addEventListener("click", e => {
    const go = e.target.closest("[data-go]");
    if (go) return goToDate(parseIso(go.dataset.go));
    if (e.target.closest("[data-retry]")) { ensureWeek(mondayOf(S.sel), true); renderPager(false); }
  });

  $("#tasks-scroll").addEventListener("click", e => {
    const f = e.target.closest("[data-filter]");
    if (f) { S.taskFilter = f.dataset.filter; S.openTask = null; haptic(); renderTasks(true); return; }
    const file = e.target.closest("[data-url]");
    if (file) { try { A ? A.openUrl(file.dataset.url) : window.open(file.dataset.url); } catch (err) { } return; }
    if (e.target.closest("[data-retry]")) { loadTasks(true); return; }
    const card = e.target.closest(".task");
    if (card) {
      const idx = +card.dataset.idx;
      S.openTask = S.openTask === idx ? null : idx;
      $$("#tasks-scroll .task").forEach(el => el.classList.toggle("open", +el.dataset.idx === S.openTask));
      haptic();
    }
  });

  $("#grades-scroll").addEventListener("click", e => {
    const s = e.target.closest("[data-sem]");
    if (s && (!S.grades || s.dataset.sem !== S.grades.semester)) { S.gradesSem = s.dataset.sem; haptic(); loadGrades(false, s.dataset.sem); return; }
    if (e.target.closest("[data-retry]")) loadGrades(true);
  });

  attachPull($("#pager"), () => pages()[1], $("#ptr-schedule"), refreshAll, true);
  attachPull($("#tab-tasks"), () => $("#tasks-scroll"), $("#ptr-tasks"), () => loadTasks(true), false);
  attachPull($("#tab-grades"), () => $("#grades-scroll"), $("#ptr-grades"), () => loadGrades(true), false);

  if (window.matchMedia) matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => applyBars(false));
  setInterval(tick, 15000);
}

// если прошлый запуск завершился сбоем - показать текст ошибки, чтобы его можно было прислать разработчику
function showLastCrash() {
  let text = "";
  try { text = A && A.lastCrash ? A.lastCrash() : ""; } catch (e) { }
  if (!text) return;
  setTimeout(() => openSheet(`<div class="confirm" style="text-align:left">
    <h3 style="margin:0 0 6px">${esc(T.crashTitle)}</h3><p style="color:var(--muted);margin:0 0 10px">${esc(T.crashHint)}</p>
    <div class="tk-comment" style="font:11px/1.35 monospace;max-height:50vh;overflow:auto">${esc(text)}</div>
    <div class="actions"><button class="btn ghost" data-act="close">OK</button></div></div>`), 2200);
}

// вызывается из Android
window.onBack = () => {
  if (sheetOpen()) { closeSheet(); return true; }
  if (!$("#main").hidden) {
    if (S.tab !== "schedule") { setTab("schedule"); return true; }
    if (iso(S.sel) !== iso(today())) { goToDate(today()); return true; }
  }
  return false;
};
window.onAppResume = () => {
  if ($("#main").hidden || !S.sel) return;
  tick();
  preloadWeeks();
  syncSoon();
  refreshSettings();
};
window.onNotifPermission = granted => {
  refreshSettings();
  if (granted) syncReminders();
};

// ------------------------------------------------------------------ запуск

async function boot() {
  setLang(detectLang(), false);
  startSplash();
  const minSplash = sleep(SPLASH_MS);
  const st = await api("state", 10000);
  S.state = st.ok ? st : { loggedIn: false, lang: detectLang(), langChosen: false, reminders: "10" };
  setLang(S.state.langChosen ? S.state.lang : detectLang(), !S.state.langChosen);
  $("#sp-tag").textContent = T.tagline;
  S.reminders = String(S.state.reminders || "").split(",").map(Number).filter(n => n > 0);
  bindEvents();
  showLastCrash();

  if (S.state.loggedIn) {
    S.me = store.get("me:" + L);
    const m = mondayOf(today());
    const first = ensureWeek(m);
    if (!S.me) await Promise.race([loadMe(false), sleep(4000)]);
    await Promise.race([first, sleep(2500)]);
    await minSplash;
    showMain();
  } else {
    await minSplash;
    showLogin();
  }
}

boot().catch(e => console.error(e)).finally(endSplash);   // заставка уходит в любом случае
window.addEventListener("unhandledrejection", e => console.error(e.reason));
