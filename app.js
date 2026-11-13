// 화면 그리기와 버튼 처리. 계산은 src/ 의 함수(테스트로 확인한 것)만 쓴다.
import { toKey, addDays, weekKeys, formatKo, weekday, canEdit } from './src/dates.js';
import { isDone, todayProgress, weekSummary, streak } from './src/items.js';
import { formatMinutes, splitMinutes } from './src/format.js';
import { COPIES, wrapValue, middleIndex, glideTarget } from './src/wheel.js';
import {
  missionProgress, missionState, dday, isLoggableToday, missionCheck, dailyShare, completedMissions, deletedMissions,
  ALL_DAYS, scheduleText, matchesFilter, fillAmount, isPlannedOn, splitPast,
} from './src/missions.js';
import {
  emptyState, migrate, setRecord, addItem, updateItem, archiveItem, restoreItem, deleteItem,
  addMission, editMission, setMissionLog, setMissionNote, setMissionStatus, deleteMission, restoreMission, purgeMission,
  needsBackup, markBackup, SAMPLE_ITEMS, addSamples,
} from './src/store.js';

const STORAGE_KEY = 'challenge-board';
const view = document.getElementById('view');

// ---------- 저장 ----------

function load() {
  let raw = null;
  try { raw = localStorage.getItem(STORAGE_KEY); } catch { /* 저장소를 못 쓰는 환경 */ }
  if (!raw) return emptyState();
  try { return migrate(JSON.parse(raw)); } catch (e) {
    toast(`저장된 기록을 읽지 못했어요: ${e.message}`);
    return emptyState();
  }
}

function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {
    toast('이 브라우저에서는 기록을 저장할 수 없어요');
  }
}

let state = load();
// 첫 화면은 항상 홈 (주소에 #missions 등이 남아 있어도 홈으로 시작하고 주소를 정리한다)
if (location.hash) history.replaceState(null, '', location.pathname + location.search);
const ui = {
  tab: 'home',
  slide: 0,
  viewDay: null, // 홈에서 보는 날 (달력에서 고름, null이면 오늘)
  mopen: new Set(), // 미션 화면에서 "오늘 한 양" 칸을 연 숫자형 미션
  wopen: new Set(), // 시간 기록 휠을 펼친 줄 ('item:<id>' / 'mission:<id>')
  cal: { mode: 'week', anchor: null }, // 홈 달력: 한 주 / 한 달, 보고 있는 날짜(null이면 오늘)
  moreOpen: false, // 지난 미션 "더 보기"를 펼쳤는지 (다시 그려도 유지)
  mfilter: 'all', // 미션 탭 필터: 'all' | 'daily' | 요일 번호
};

const today = () => toKey(new Date());
// 어제 기록은 홈에서 "어제"를 골랐을 때만. 미션 화면은 항상 오늘
// 기록·보기 날짜: 홈은 달력에서 고른 날, 미션 탭은 항상 오늘
const selectedDay = () => (ui.tab === 'home' && ui.viewDay ? ui.viewDay : today());
const uid = () => globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36) + Math.random().toString(36).slice(2);

function commit(fn) {
  try {
    state = fn(state);
    save();
    render();
    return true;
  } catch (e) {
    toast(e.message);
    return false;
  }
}

// ---------- 작은 도구 ----------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const pct = (n) => Math.max(0, Math.min(100, n));
const short = (key) => key.slice(5).replace('-', '/');
const stepOf = (goal) => Math.max(1, Math.round(goal / 6));

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), 2400);
}

function celebrate() {
  const box = document.getElementById('confetti');
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return toast('🎉 오늘 할 일을 모두 달성했어요!');
  const marks = ['🎉', '✨', '🔥', '⭐', '💪'];
  box.innerHTML = Array.from({ length: 24 }, (_, i) =>
    `<span style="left:${Math.random() * 100}%;animation-delay:${(i % 8) * 0.08}s">${marks[i % marks.length]}</span>`).join('');
  setTimeout(() => { box.innerHTML = ''; }, 2200);
  toast('🎉 오늘 할 일을 모두 달성했어요!');
}

const STATE_LABEL = { active: '진행 중', overdue: '기한 지남', done: '완료', stopped: '중단' };
const badge = (s) => `<span class="badge b-${s}">${STATE_LABEL[s]}</span>`;

function ddayText(m) {
  const d = dday(m, today());
  if (d === null) return '🔁 매주 반복';
  if (d > 0) return `D-${d}`;
  if (d === 0) return 'D-day';
  return `${-d}일 지남`;
}

// ---------- 홈 ----------

// done: 달성 표시(초록). 매일 항목은 하루 목표, 미션은 카드 체크박스와 같은 기준
function numberInput(attrs, item, value, done = isDone(item, value)) {
  return `<div class="num${done ? ' done' : ''}">
    <button type="button" data-act="step" ${attrs} data-step="-${stepOf(item.goal)}" aria-label="줄이기">−</button>
    <input type="number" inputmode="decimal" min="0" ${attrs} value="${value ?? ''}" placeholder="0" aria-label="${esc(item.name ?? item.title)} 양">
    <button type="button" data-act="step" ${attrs} data-step="${stepOf(item.goal)}" aria-label="늘리기">+</button>
    ${item.unit && item.measure !== 'time' ? `<span class="num-unit">${esc(item.unit)}</span>` : ''}
  </div>`;
}

// ---- 시간형: 휠 선택기 (알람 앱처럼 굴려서 시·분 고르기, 1분 단위) ----

const ROW = 36; // 휠 한 칸 높이(px). style.css의 .wrow 높이와 같아야 한다
const isTime = (x) => x.type === 'number' && x.measure === 'time';
// 목표·양을 단위와 함께 보여 준다 (시간형은 "1시간 25분")
const amount = (x, v) => (x.measure === 'time' ? formatMinutes(v) : `${+Number(v).toFixed(2)}${esc(x.unit)}`);

function wheelPicker(attrs, minutes, maxHours) {
  const { h, m } = splitMinutes(minutes);
  // 끝 다음에 다시 처음이 오도록 같은 목록을 COPIES번 잇고, 가운데 묶음의 칸을 고른 값으로 둔다
  const col = (part, count, cur, label) => `<div class="wcol" data-part="${part}" data-count="${count}" tabindex="0" role="listbox" aria-label="${label}">
      ${Array.from({ length: count * COPIES }, (_, i) => `<div class="wrow${i === middleIndex(cur, count) ? ' on' : ''}" data-v="${wrapValue(i, count)}">${wrapValue(i, count)}</div>`).join('')}
    </div><span class="wunit">${label}</span>`;
  return `<div class="wheel" ${attrs} data-value="${h * 60 + m}">${col('h', maxHours + 1, Math.min(h, maxHours), '시간')}${col('m', 60, m, '분')}</div>`;
}

// 기록용: 값 버튼을 누르면 아래에 휠이 펼쳐진다. 굴려서 멈추면 바로 저장
function timeLog(key, attrs, value, done) {
  const open = ui.wopen.has(key);
  return {
    button: `<button type="button" class="tbtn${done ? ' done' : ''}${open ? ' open' : ''}" data-act="wopen" data-key="${key}">${typeof value === 'number' && value > 0 ? formatMinutes(value) : '⏱ 시간 기록'}</button>`,
    panel: `<div class="wpanel" data-wpanel="${key}" ${open ? '' : 'hidden'}>${wheelPicker(`data-log ${attrs}`, value, 23)}</div>`,
  };
}

// 양식용: 목표 시간 휠 + 숨은 goal 칸(분)
function goalWheel(minutes, maxHours) {
  return `<div class="goal-wheel">${wheelPicker('data-form', minutes, maxHours)}<input type="hidden" name="goal" value="${minutes ?? ''}"></div>`;
}

// 요일 고르기: [매일] [월]…[일]. 누르면 켜고 끈다
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
const DAY_LABEL = ['일', '월', '화', '수', '목', '금', '토'];
function dayPicker(days = ALL_DAYS) {
  const on = new Set(days);
  return `<div class="daypick" data-daypick>
    <button type="button" class="dchip all${on.size === 7 ? ' on' : ''}" data-act="dpick" data-d="all">매일</button>
    ${WEEK_ORDER.map((d) => `<button type="button" class="dchip d${d}${on.has(d) ? ' on' : ''}" data-act="dpick" data-d="${d}">${DAY_LABEL[d]}</button>`).join('')}
  </div>`;
}
const pickedDays = (form) => [...form.querySelectorAll('[data-daypick] [data-d].on')].map((b) => b.dataset.d).filter((d) => d !== 'all').map(Number);

// 양식의 숫자형 칸: 시간형(휠) / 개수형(단위·목표) 고르기
function measureFields(goalLabel, timeDefault, maxHours) {
  return `<div class="seg" data-seg="measure">
      <button type="button" data-v="time" class="on">⏱ 시간</button>
      <button type="button" data-v="count">🔢 개수</button>
    </div>
    <div data-show="time"><p class="muted small" style="margin:0 0 4px"><span class="goal-label">${goalLabel}</span></p>${goalWheel(timeDefault, maxHours)}</div>
    <div data-show="count" hidden class="two">
      <label>단위<input name="unit" placeholder="문제, 개, 페이지…"></label>
      <label><span class="goal-label">${goalLabel}</span><input type="number" name="countGoal" min="0" step="any" placeholder="20"></label>
    </div>`;
}

// 매일 할 일 체크·입력 줄. 홈과 미션 탭이 같은 기록을 쓴다.
function dailyRows(day) {
  return state.items.filter((i) => !i.archived).map((item) => {
    const v = state.records[day]?.[item.id];
    const s = streak(item, state.records, today());
    const meta = item.type === 'number' ? `<span class="muted small">목표 ${amount(item, item.goal)}</span>` : '';
    const tl = isTime(item) ? timeLog(`item:${item.id}`, `data-item="${item.id}"`, v, isDone(item, v)) : null;
    const control = tl ? tl.button : item.type === 'number'
      ? numberInput(`data-item="${item.id}"`, item, v)
      : `<button class="check${v ? ' on' : ''}" data-act="toggle" data-item="${item.id}" aria-pressed="${!!v}" aria-label="${esc(item.name)}">${v ? '✓' : ''}</button>`;
    return `<div class="item">
      ${item.type === 'check' ? control : ''}
      <div class="grow"><h3>${esc(item.name)}</h3>${meta}</div>
      ${s ? `<span class="streak">🔥 ${s}일</span>` : ''}
      ${item.type === 'number' ? control : ''}
      ${tl ? tl.panel : ''}
    </div>`;
  }).join('');
}

// 그날 기록할 수 있는 기간 미션 줄. 홈과 미션 탭이 같은 기록을 쓴다.
function todayMissionRows(day) {
  const editable = canEdit(day, today());
  return state.missions.filter((m) => (editable ? isLoggableToday(m, day) : isPlannedOn(m, day))).map((m) => {
    const v = m.log[day];
    const tl = isTime(m) ? timeLog(`mission:${m.id}`, `data-mission="${m.id}"`, v, missionCheck(m, day) === 'on') : null;
    const control = tl ? tl.button : m.type === 'number'
      ? numberInput(`data-mission="${m.id}"`, m, v, missionCheck(m, day) === "on")
      : `<button class="check${v ? ' on' : ''}" data-act="mtoggle" data-mission="${m.id}" aria-pressed="${!!v}" aria-label="${esc(m.title)}">${v ? '✓' : ''}</button>`;
    return `<div class="item" style="flex-wrap:wrap">
      ${m.type === 'check' ? control : ''}
      <div class="grow"><h3>${esc(m.title)}</h3><span class="muted small">${ddayText(m)} · ${missionProgress(m, today())}%</span></div>
      ${m.type === 'number' ? control : ''}
      ${tl ? tl.panel : ''}
      ${m.notes[day] || editable ? `<details class="note-wrap" ${m.notes[day] ? 'open' : ''}><summary>📝 메모</summary>
        <input class="note" data-note="${m.id}" placeholder="오늘 진행한 내용을 짧게 (선택)" value="${esc(m.notes[day] ?? '')}"></details>` : ''}
    </div>`;
  }).join('');
}

function slideToday() {
  const day = selectedDay();
  const items = state.items.filter((i) => !i.archived);
  const t = today();
  const editable = canEdit(day, t);
  // 지난 날·다음 날은 그날 일정이었던 미션까지 세서 보여 준다 (오늘·어제는 기존 계산)
  const prog = editable ? todayProgress(state, day) : (() => {
    const ms = state.missions.filter((m) => isPlannedOn(m, day));
    const mDone = ms.filter((m) => { const v = m.log[day]; return m.type === 'number' ? typeof v === 'number' && v > 0 : v === true; }).length;
    return { done: items.filter((i) => isDone(i, state.records[day]?.[i.id])).length + mDone, total: items.length + ms.length };
  })();
  const p = prog.total ? Math.round((prog.done / prog.total) * 100) : 0;
  const [, dm, dd] = day.split('-').map(Number);
  const label = day === t ? '오늘' : day === addDays(t, -1) ? '어제' : `${dm}월 ${dd}일`;
  const back = '<button class="linkish" data-act="day">오늘로 돌아가기</button>';
  const note = day === t ? '달력에서 날짜를 누르면 그날을 볼 수 있어요'
    : day === addDays(t, -1) ? `어제 기록은 고칠 수 있어요 · ${back}`
    : day < t ? `🔒 지난 기록은 볼 수만 있어요 · ${back}`
    : `🔒 아직 오지 않은 날이에요. 체크는 그날 할 수 있어요 · ${back}`;

  const samples = items.length ? '' : `
    <div class="card">
      <h2>매일 할 일을 정해 볼까요?</h2>
      <p class="muted small" style="margin:0 0 10px">하고 싶은 예시를 골라 한 번에 넣어요.</p>
      ${samplePicker()}
    </div>`;

  const rows = dailyRows(day);

  const missionRows = todayMissionRows(day);

  return `
    <div class="card hero">
      <div class="ring" style="--p:${p}"><span>${p}%</span></div>
      <div>
        <p><strong>${label} ${day > t ? '할 일' : '달성'} ${day > t ? `${prog.total}개` : `${prog.done} / ${prog.total}`}</strong></p>
        <p class="muted small">${formatKo(day)}</p>
        <p class="muted small" style="margin-top:4px">${note}</p>
      </div>
    </div>
    ${samples}
    ${items.length ? `<div class="card${editable ? '' : ' readonly'}"><h2>매일 할 일</h2>${rows}</div>` : ''}
    <div class="card${editable ? '' : ' readonly'}"><h2>${label}의 미션</h2>
      ${missionRows || (day === t ? '<p class="empty small">기록할 기간 미션이 없어요. 🎯 미션에서 추가해 보세요.</p>' : '<p class="empty small">이날 일정인 기간 미션이 없어요.</p>')}
    </div>`;
}

// 예시 항목 고르기: 누르면 선택만 되고, "선택한 n개 넣기"로 한 번에 넣는다. 이미 있는 이름은 보여 주지 않는다.
function samplePicker() {
  const have = new Set(state.items.map((i) => i.name));
  const chips = SAMPLE_ITEMS.map((s, i) => (have.has(s.name) ? '' : `
    <button type="button" class="pick" data-act="pick" data-i="${i}" aria-pressed="false">
      ${esc(s.name)}${s.type === 'number' ? ` <span class="muted">${amount(s, s.goal)}</span>` : ''}</button>`)).join('');
  if (!chips.trim()) return '';
  return `<div class="picker">
    <div class="chips">${chips}</div>
    <button type="button" class="btn" data-act="samples-picked" disabled style="width:100%;margin-top:12px">항목을 골라 주세요</button>
  </div>`;
}

function slideWeek() {
  const week = weekKeys(today());
  const summary = weekSummary(state, today());
  const rows = summary.map((r) => {
    const item = state.items.find((i) => i.id === r.id);
    const s = streak(item, state.records, today());
    const [label, value] = r.type === 'number'
      ? [`${amount(item, r.total)} / ${amount(item, r.weekGoal)} · 달성 ${r.doneDays}일${r.rawTotal > r.total ? ` (실제 ${amount(item, r.rawTotal)}, 하루 목표 넘은 만큼은 빼고 셈)` : ''}`, (r.total / r.weekGoal) * 100]
      : [`${r.doneDays} / 7일`, (r.doneDays / 7) * 100];
    return `<div class="item" style="display:block">
      <div class="row between"><h3>${esc(r.name)}</h3>${s ? `<span class="streak">🔥 ${s}일 연속</span>` : ''}</div>
      <div class="row between small muted"><span>${label}</span><span>${Math.round(value)}%</span></div>
      <div class="bar${value >= 100 ? ' ok' : ''}"><i style="width:${pct(value)}%"></i></div>
    </div>`;
  }).join('');

  const active = state.missions.filter((m) => !m.deletedAt && ['active', 'overdue'].includes(missionState(m, today())));
  const missions = active.map((m) => {
    const p = missionProgress(m, today());
    return `<div class="item" style="display:block">
      <div class="row between"><h3>${esc(m.title)}</h3>${badge(missionState(m, today()))}</div>
      <div class="row between small muted"><span>${ddayText(m)}</span><span>${p}%</span></div>
      <div class="bar${p >= 100 ? ' ok' : ''}"><i style="width:${pct(p)}%"></i></div>
    </div>`;
  }).join('');

  return `
    <div class="card"><h2>이번 주 <span class="muted small">${short(week[0])} ~ ${short(week[6])}</span></h2>
      ${rows || '<p class="empty small">매일 할 일을 추가하면 여기에 집계돼요.</p>'}
    </div>
    <div class="card"><h2>진행 중인 미션</h2>
      ${missions || '<p class="empty small">진행 중인 미션이 없어요.</p>'}
    </div>`;
}

function renderHome() {
  view.innerHTML = `
    <div class="tabs" role="tablist">
      <button class="tab ${ui.slide === 0 ? 'on' : ''}" data-act="slide" data-i="0" role="tab">오늘</button>
      <button class="tab ${ui.slide === 1 ? 'on' : ''}" data-act="slide" data-i="1" role="tab">이번 주</button>
    </div>
    <div class="slides" id="slides">
      <section class="slide" aria-label="오늘">${slideToday()}</section>
      <section class="slide" aria-label="이번 주">${slideWeek()}</section>
    </div>
    <div class="dots"><i class="${ui.slide === 0 ? 'on' : ''}"></i><i class="${ui.slide === 1 ? 'on' : ''}"></i></div>`;
  view.querySelectorAll('.card.readonly').forEach((c) => c.querySelectorAll('button, input, textarea, select').forEach((x) => { x.disabled = true; }));
  const slides = document.getElementById('slides');
  slides.scrollLeft = ui.slide * slides.clientWidth;
  slides.addEventListener('scroll', () => {
    const i = Math.round(slides.scrollLeft / slides.clientWidth);
    if (i === ui.slide) return;
    ui.slide = i;
    view.querySelectorAll('.tab').forEach((t, n) => t.classList.toggle('on', n === i));
    view.querySelectorAll('.dots i').forEach((d, n) => d.classList.toggle('on', n === i));
  }, { passive: true });
}

// ---------- 미션 ----------

function missionCard(m) {
  const st = missionState(m, today());
  const p = missionProgress(m, today());
  const kind = m.kind === 'once'
    ? `한 번 끝내는 미션 · 마감 ${m.deadline}`
    : `${m.type === 'number' ? `${isTime(m) ? '시간형' : '개수형'} (${m.repeat === 'weekly' ? '하루 ' : ''}목표 ${amount(m, m.goal)})` : '체크형'} · <strong class="sched">${scheduleText(m)}</strong> · ${m.repeat === 'weekly' ? `매주 반복 (${m.start}부터, 진행률은 이번 주)` : `${m.start} ~ ${m.end}`}`;
  const notes = Object.entries(m.notes).sort(([a], [b]) => b.localeCompare(a));
  const open = st === 'active' || st === 'overdue';
  const dateFields = m.kind === 'once'
    ? `<label>마감일<input type="date" name="deadline" value="${m.deadline}"></label>`
    : `<div><p class="muted small" style="margin:0 0 6px">하는 요일</p>${dayPicker(m.days)}</div>
       <div class="two"><label>시작일<input type="date" name="start" value="${m.start}"></label>
         ${m.repeat === 'weekly' ? '' : `<label>마감일<input type="date" name="end" value="${m.end}"></label>`}</div>`;
  const goalFields = m.type === 'number'
    ? (isTime(m)
      ? `<p class="muted small" style="margin:0">${m.repeat === 'weekly' ? '하루 목표' : '기간 전체 목표'}</p>${goalWheel(m.goal, m.repeat === 'weekly' ? 23 : 300)}`
      : `<div class="two"><label>단위<input name="unit" value="${esc(m.unit)}"></label>
         <label>${m.repeat === 'weekly' ? '하루 목표' : '기간 전체 목표'}<input type="number" name="goal" min="0" step="any" value="${m.goal}"></label></div>`)
    : '';
  const editForm = `<form class="form" data-medit="${m.id}" hidden style="margin-top:12px;padding-top:12px;border-top:1px solid var(--line)">
      <label>미션 이름<input name="title" value="${esc(m.title)}"></label>
      ${dateFields}${goalFields}
      <p class="muted small" style="margin:0">미션 종류와 방식, 지금까지의 기록은 그대로 남아요.</p>
      <div class="chips"><button class="btn sm" type="submit">저장</button>
        <button class="btn ghost sm" type="button" data-act="medit" data-mission="${m.id}">취소</button></div>
    </form>`;
  // 그날 체크박스: 한 번 미션은 완료, 기간 미션은 오늘 기록 (숫자형은 양을 넣는 칸이 열린다)
  const t = today();
  const check = missionCheck(m, t);
  const checkLabel = m.kind === 'once' ? '미션 완료' : check === 'disabled' ? '오늘은 기록할 수 없어요' : '오늘 했어요';
  const numberRow = m.kind === 'period' && m.type === 'number' && check !== 'disabled'
    ? `<div class="mnum" ${ui.mopen.has(m.id) || check === 'on' ? '' : 'hidden'} data-mnum="${m.id}">
        <span class="small muted">오늘 한 양${isTime(m) ? '' : ` (${esc(m.unit)})`}<br>하루 몫 ${amount(m, dailyShare(m))}까지 진행률에 들어가요</span>${isTime(m)
          ? wheelPicker(`data-log data-mission="${m.id}"`, m.log[t], 23)
          : numberInput(`data-mission="${m.id}"`, m, m.log[t], check === "on")}
      </div>`
    : '';
  const menu = open
    ? `${m.kind === 'period' ? `<button data-act="mstatus" data-mission="${m.id}" data-status="done">🏁 미션 완료로 끝내기</button>` : ''}
       <button data-act="mstatus" data-mission="${m.id}" data-status="stopped">⏸ 중단하기</button>
       <button class="danger" data-act="mdelete" data-mission="${m.id}">🗑 지우기</button>`
    : `<button data-act="mstatus" data-mission="${m.id}" data-status="active">↩ 다시 진행하기</button>
       <button class="danger" data-act="mdelete" data-mission="${m.id}">🗑 지우기</button>`;
  return `<div class="card mcard${check === 'on' ? ' is-on' : ''}">
    <div class="mhead">
      <button class="check${check === 'on' ? ' on' : ''}" data-act="mcheck" data-mission="${m.id}"
        ${check === 'disabled' ? 'disabled' : ''} aria-pressed="${check === 'on'}" aria-label="${esc(m.title)} ${checkLabel}" title="${checkLabel}">${check === 'on' ? '✓' : ''}</button>
      <div class="grow">
        <div class="row between"><h3>${esc(m.title)}</h3>${badge(st)}</div>
        <p class="muted small" style="margin:2px 0 0">${kind}</p>
      </div>
    </div>
    ${numberRow}
    <div class="mprog">
      <span class="small"><span class="muted">진행률</span> <strong>${p}%</strong></span>
      ${open ? `<span class="dday${dday(m, t) === null ? ' weekly' : dday(m, t) < 0 ? ' late' : dday(m, t) <= 3 ? ' soon' : ''}">${ddayText(m)}</span>` : ''}
      <div class="mtools">
        <button class="icon-btn" data-act="medit" data-mission="${m.id}" aria-label="수정" title="수정">✏️</button>
        <details class="more"><summary class="icon-btn" aria-label="더 보기" title="더 보기">⋯</summary>
          <div class="menu">${menu}</div></details>
      </div>
    </div>
    <div class="bar${p >= 100 ? ' ok' : ''}"><i style="width:${pct(p)}%"></i></div>
    ${notes.length ? `<details class="mnotes"><summary>📝 메모 ${notes.length}</summary>
      <ul>${notes.map(([d, x]) => `<li><span class="muted">${short(d)}</span> ${esc(x)}</li>`).join('')}</ul></details>` : ''}
    ${editForm}
  </div>`;
}

// 매일 할 일 카드: 미션 카드와 같은 모양. 오늘 체크·기록, 이번 주 달성, ✏️ 수정, ⋯ 보관·지우기
function dailyCard(item) {
  const t = today();
  const v = state.records[t]?.[item.id];
  const done = isDone(item, v);
  const s = streak(item, state.records, t);
  const week = weekSummary(state, t).find((r) => r.id === item.id);
  const p = week ? Math.round(((item.type === 'number' ? week.total / week.weekGoal : week.doneDays / 7)) * 100) : 0;
  const kindText = item.type === 'number' ? `${isTime(item) ? '시간형' : '개수형'} (하루 목표 ${amount(item, item.goal)})` : '체크형';
  const tl = isTime(item) ? timeLog(`item:${item.id}`, `data-item="${item.id}"`, v, done) : null;
  const numRow = item.type !== 'number' ? '' : tl
    ? `<div class="mnum"><span class="small muted">오늘 한 시간</span>${tl.button}${tl.panel}</div>`
    : `<div class="mnum"><span class="small muted">오늘 한 양</span>${numberInput(`data-item="${item.id}"`, item, v)}</div>`;
  const checkBtn = item.type === 'check'
    ? `<button class="check${v ? ' on' : ''}" data-act="toggle" data-item="${item.id}" aria-pressed="${!!v}" aria-label="${esc(item.name)}">${v ? '✓' : ''}</button>`
    : `<button class="check${done ? ' on' : ''}" data-act="ifill" data-item="${item.id}" aria-pressed="${done}" aria-label="${esc(item.name)} 하루 목표 채우기" ${isTime(item) ? 'disabled title="시간은 아래에서 기록해요"' : ''}>${done ? '✓' : ''}</button>`;
  return `<div class="card mcard${done ? ' is-on' : ''}">
    <div class="mhead">${checkBtn}
      <div class="grow">
        <div class="row between"><h3>${esc(item.name)}</h3><span class="badge b-daily">매일</span></div>
        <p class="muted small" style="margin:2px 0 0">매일 할 일 · ${kindText}</p>
      </div>
    </div>
    ${numRow}
    <div class="mprog">
      <span class="small"><span class="muted">이번 주</span> <strong>${p}%</strong></span>
      ${s ? `<span class="streak">🔥 ${s}일 연속</span>` : ''}
      <div class="mtools">
        <button class="icon-btn" data-act="iedit" data-item="${item.id}" aria-label="수정" title="수정">✏️</button>
        <details class="more"><summary class="icon-btn" aria-label="더 보기" title="더 보기">⋯</summary>
          <div class="menu"><button data-act="archive" data-item="${item.id}">📦 보관하기</button>
            <button class="danger" data-act="delete" data-item="${item.id}">🗑 완전히 지우기</button></div></details>
      </div>
    </div>
    <div class="bar${p >= 100 ? ' ok' : ''}"><i style="width:${pct(p)}%"></i></div>
    <div data-iedit="${item.id}" hidden style="margin-top:12px;padding-top:12px;border-top:1px solid var(--line)">${itemEditForm(item)}</div>
  </div>`;
}

// 보관한 매일 할 일 (지난 미션 칸에)
function archivedCard(item) {
  return `<div class="card"><div class="row between"><h3>${esc(item.name)}</h3><span class="badge b-stopped">보관됨</span></div>
    <p class="muted small" style="margin:2px 0 8px">매일 할 일 · 화면과 집계에서 빠지고 기록은 남아 있어요</p>
    <div class="chips"><button class="btn ghost sm" data-act="restore" data-item="${item.id}">↩ 꺼내기</button>
      <button class="btn danger sm" data-act="delete" data-item="${item.id}">🗑 완전히 지우기</button></div></div>`;
}

function renderMissions() {
  const t = today();
  const live = state.missions.filter((m) => !m.deletedAt);
  const shown = live.filter((m) => matchesFilter(m, ui.mfilter));
  const open = shown.filter((m) => ['active', 'overdue'].includes(missionState(m, t)));
  const { recent, older } = splitPast(shown, t); // 지난 미션: 최근 7일 완료만 바로, 나머지는 "더 보기"
  const fbtn = (f, label, cls = '') => `<button type="button" class="fchip${cls}${ui.mfilter === f ? ' on' : ''}" data-act="mfilter" data-f="${f}">${label}</button>`;
  const filterBar = `<div class="mfilter" role="group" aria-label="미션 보기">
      ${fbtn('all', '전체')}${fbtn('daily', '매일')}
      ${WEEK_ORDER.map((d) => fbtn(d, DAY_LABEL[d], ` d${d}${d === weekday(t) ? ' is-today' : ''}`)).join('')}
    </div>`;
  // 매일 할 일은 매일 하니 "전체·매일·모든 요일" 필터에 나온다
  const dailyOpen = state.items.filter((i) => !i.archived);
  const dailyPast = state.items.filter((i) => i.archived);
  const openCount = open.length + dailyOpen.length;
  const moreCount = older.length + dailyPast.length;
  view.innerHTML = `
    <div class="card">
      <h2>미션 추가</h2>
      <form class="form" id="mission-form">
        <div class="seg" data-seg="kind">
          <button type="button" data-v="once" class="on">한 번 끝내기</button>
          <button type="button" data-v="period">기간·목표</button>
          <button type="button" data-v="daily">매일 할 일</button>
        </div>
        <label>이름<input name="title" required placeholder="예: 이력서 초안 쓰기"></label>
        <div data-show="once"><label>마감일<input type="date" name="deadline" value="${addDays(t, 7)}"></label></div>
        <div data-show="period" hidden class="stack">
          <div data-show="sched" class="stack">
            <div class="seg" data-seg="repeat">
              <button type="button" data-v="period" class="on">📅 기간 동안</button>
              <button type="button" data-v="weekly">🔁 매주 반복</button>
            </div>
            <div><p class="muted small" style="margin:0 0 6px">하는 요일</p>${dayPicker()}</div>
            <div class="two">
              <label>시작일<input type="date" name="start" value="${t}"></label>
              <label data-show="end">마감일<input type="date" name="end" value="${addDays(t, 13)}"></label>
            </div>
          </div>
          <div class="seg" data-seg="type">
            <button type="button" data-v="check" class="on">체크형 (며칠 했나)</button>
            <button type="button" data-v="number">숫자형 (얼마나 했나)</button>
          </div>
          <div data-show="number" hidden class="stack">${measureFields('기간 전체 목표', 600, 300)}</div>
        </div>
        <button class="btn" type="submit">추가하기</button>
      </form>
      ${samplePicker() ? `<details class="add-daily"><summary>매일 할 일 예시에서 골라 넣기</summary><div style="margin-top:10px">${samplePicker()}</div></details>` : ''}
    </div>
    ${filterBar}
    <h2 class="sec-title">진행 중 <span class="count">${openCount}</span></h2>
    ${dailyOpen.map(dailyCard).join('')}
    ${open.map(missionCard).join('')}
    ${openCount ? '' : '<p class="empty small">진행 중인 미션이 없어요.</p>'}
    <h2 class="sec-title">지난 미션 <span class="count">${recent.length}</span><span class="sec-sub">최근 7일 동안 완료</span></h2>
    ${recent.map(missionCard).join('')}
    ${recent.length ? '' : '<p class="empty small">최근 7일 동안 완료한 미션이 없어요.</p>'}
    ${moreCount ? `<details class="more-past" ${ui.moreOpen ? 'open' : ''}><summary>더 보기 · 7일 지난 완료 · 중단 · 보관 ${moreCount}</summary>
      <div class="more-past-list">${older.map(missionCard).join('')}${dailyPast.map(archivedCard).join('')}</div></details>` : ''}`;
}


// ---------- 설정 ----------

// 매일 할 일 수정 양식 (이름·목표)
function itemEditForm(item) {
  return `<form class="form" data-edit="${item.id}" style="margin-top:8px">
        <label>이름<input name="name" value="${esc(item.name)}"></label>
        ${item.type !== 'number' ? '' : isTime(item)
          ? `<p class="muted small" style="margin:0">하루 목표</p>${goalWheel(item.goal, 23)}`
          : `<div class="two"><label>단위<input name="unit" value="${esc(item.unit)}"></label>
          <label>하루 목표<input type="number" name="goal" min="0" step="any" value="${item.goal}"></label></div>`}
        <button class="btn sm" type="submit">저장</button>
      </form>`;
}

function renderSettings() {
  const done = completedMissions(state.missions, today());
  const gone = deletedMissions(state.missions);
  view.innerHTML = `
    ${needsBackup(state, today()) ? `<div class="notice">💾 ${state.lastBackup ? `마지막 백업(${state.lastBackup}) 후 7일이 지났어요.` : '아직 백업한 적이 없어요.'} 아래에서 백업 파일을 받아 두세요.</div>` : ''}
    <div class="card"><h2>완료한 미션 <span class="muted small">${done.length}</span></h2>
      <p class="muted small" style="margin:0 0 4px">완료로 끝냈고 진행도도 100%를 채운 미션이에요.</p>
      ${done.map((m) => `<div class="item"><div class="grow"><h3>🏆 ${esc(m.title)}</h3>
        <span class="muted small">${m.kind === 'once' ? `마감 ${m.deadline}` : `${m.start} ~ ${m.end}`}</span></div>
        <button class="btn danger sm" data-act="mdelete" data-mission="${m.id}">삭제</button></div>`).join('')
        || '<p class="empty small">아직 없어요.</p>'}
    </div>
    <div class="card"><h2>지운 미션 <span class="muted small">${gone.length}</span></h2>
      <p class="muted small" style="margin:0 0 4px">되살리면 기록과 메모가 그대로 돌아와요. 영구 삭제하면 되돌릴 수 없어요.</p>
      ${gone.map((m) => `<div class="item"><div class="grow"><h3>${esc(m.title)}</h3>
        <span class="muted small">${m.deletedAt}에 지움</span></div>
        <button class="btn ghost sm" data-act="mrestore" data-mission="${m.id}">되살리기</button>
        <button class="btn danger sm" data-act="mpurge" data-mission="${m.id}">영구 삭제</button></div>`).join('')
        || '<p class="empty small">없어요.</p>'}
    </div>
    <div class="card stack">
      <h2>백업</h2>
      <p class="muted small" style="margin:0">기록은 <strong>이 컴퓨터의 이 브라우저</strong>에만 저장돼요. 브라우저 데이터를 지우면 사라지니 가끔 백업 파일을 받아 두세요.
        ${state.lastBackup ? `마지막 백업: ${state.lastBackup}` : ''}</p>
      <div class="chips">
        <button class="btn" data-act="export">백업 파일 받기</button>
        <label class="btn ghost" style="display:inline-block">백업 파일 불러오기<input type="file" id="import" accept="application/json,.json" hidden></label>
      </div>
    </div>`;
}

// ---------- 달력 ----------

// 홈 머리말 달력: 평소엔 한 주, 펼치면 한 달. 날마다 그날 달성률을 링으로 보여 준다
function calendarHtml() {
  const t = today();
  const anchor = ui.cal.anchor ?? t;
  const [y, mo] = anchor.split('-').map(Number);
  let keys; let title;
  if (ui.cal.mode === 'week') {
    keys = weekKeys(anchor);
    const [, m1, d1] = keys[0].split('-').map(Number);
    const [, m2, d2] = keys[6].split('-').map(Number);
    title = m1 === m2 ? `${m1}월 ${d1}일 ~ ${d2}일` : `${m1}월 ${d1}일 ~ ${m2}월 ${d2}일`;
  } else {
    const first = `${y}-${String(mo).padStart(2, '0')}-01`;
    const start = weekKeys(first)[0];
    keys = [];
    for (let d = start; keys.length < 42; d = addDays(d, 1)) keys.push(d);
    while (keys.length > 35 && Number(keys[35].split('-')[1]) !== mo) keys.splice(35); // 다섯 줄이면 충분할 때
    title = `${y}년 ${mo}월`;
  }
  const inView = keys.includes(t);
  const cell = (k) => {
    const [, km, kd] = k.split('-').map(Number);
    const past = k <= t;
    const prog = past ? todayProgress(state, k) : { done: 0, total: 0 };
    const p = prog.total ? Math.round((prog.done / prog.total) * 100) : 0;
    const cls = [
      'cal-day', `w${weekday(k)}`,
      k === t && 'today', k === selectedDay() && 'sel', !past && 'future',
      ui.cal.mode === 'month' && km !== mo && 'out', prog.total && p === 100 && 'full', prog.total && 'has',
    ].filter(Boolean).join(' ');
    return `<button type="button" class="${cls}" data-act="calday" data-key="${k}" style="--p:${p}"
      title="${formatKo(k)}${prog.total ? ` · 달성 ${prog.done}/${prog.total}` : ''}">
      ${ui.cal.mode === 'week' ? `<span class="cal-wd">${DAY_LABEL[weekday(k)]}</span>` : ''}<span class="cal-num">${kd}</span></button>`;
  };
  return `<div class="cal-head">
      <button type="button" class="cal-nav" data-act="calnav" data-dir="-1" aria-label="이전">‹</button>
      <span class="cal-title">${title}</span>
      <button type="button" class="cal-nav" data-act="calnav" data-dir="1" aria-label="다음">›</button>
      ${inView ? '' : '<button type="button" class="cal-mode" data-act="caltoday">오늘</button>'}
      <button type="button" class="cal-mode" data-act="calmode">${ui.cal.mode === 'week' ? '한 달 ▾' : '한 주 ▴'}</button>
    </div>
    ${ui.cal.mode === 'month' ? `<div class="cal-grid cal-wdh">${WEEK_ORDER.map((d) => `<span class="w${d}">${DAY_LABEL[d]}</span>`).join('')}</div>` : ''}
    <div class="cal-grid ${ui.cal.mode}">${keys.map(cell).join('')}</div>`;
}

document.getElementById('calendar').addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const t = today();
  const anchor = ui.cal.anchor ?? t;
  if (b.dataset.act === 'calnav') {
    const dir = Number(b.dataset.dir);
    if (ui.cal.mode === 'week') ui.cal.anchor = addDays(anchor, dir * 7);
    else {
      const [y, m] = anchor.split('-').map(Number);
      const d = new Date(y, m - 1 + dir, 1);
      ui.cal.anchor = toKey(d);
    }
  } else if (b.dataset.act === 'calmode') {
    ui.cal.mode = ui.cal.mode === 'week' ? 'month' : 'week';
  } else if (b.dataset.act === 'caltoday') {
    ui.cal.anchor = null;
  } else if (b.dataset.act === 'calday') {
    const k = b.dataset.key;
    ui.viewDay = k === t ? null : k;
    ui.tab = 'home';
    ui.slide = 0;
  }
  render();
});

// ---------- 전체 ----------

function render() {
  requestAnimationFrame(() => initWheels(view));
  document.getElementById('today-label').textContent = formatKo(today());
  const cal = document.getElementById('calendar');
  const withCal = ui.tab === 'home' || ui.tab === 'missions';
  cal.hidden = !withCal;
  document.getElementById('today-label').hidden = withCal;
  if (withCal) cal.innerHTML = calendarHtml();
  document.querySelectorAll('[data-nav]').forEach((b) => b.classList.toggle('on', b.dataset.nav === ui.tab));
  document.getElementById('backup-dot').hidden = !needsBackup(state, today());
  if (ui.tab === 'missions') renderMissions();
  else if (ui.tab === 'settings') renderSettings();
  else renderHome();
}

function setValue(el, value) {
  const day = selectedDay();
  const before = todayProgress(state, day);
  const ok = el.dataset.item
    ? commit((s) => setRecord(s, day, el.dataset.item, value, today()))
    : commit((s) => setMissionLog(s, el.dataset.mission, day, value, today()));
  if (!ok) return;
  const after = todayProgress(state, day);
  if (after.total && after.done === after.total && before.done < before.total) celebrate();
  const sel = el.dataset.item ? `[data-item="${el.dataset.item}"]` : `[data-mission="${el.dataset.mission}"]`;
  view.querySelector(`.check${sel}`)?.classList.add('pop');
}

document.querySelector('.bottom-nav').addEventListener('click', (e) => {
  const b = e.target.closest('[data-nav]');
  if (!b) return;
  ui.tab = b.dataset.nav;
  render();
  scrollTo({ top: 0 });
});

view.addEventListener('click', (e) => {
  const seg = e.target.closest('[data-seg] button');
  if (seg) {
    const box = seg.parentElement;
    box.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === seg));
    const form = box.closest('form');
    if (box.dataset.seg === 'kind') {
      const k = seg.dataset.v;
      form.querySelector('[data-show="once"]').hidden = k !== 'once';
      form.querySelector('[data-show="period"]').hidden = k === 'once';
      const sched = form.querySelector('[data-show="sched"]');
      if (sched) sched.hidden = k === 'daily';
      const weekly = form.querySelector('[data-seg="repeat"] .on')?.dataset.v === 'weekly';
      form.querySelectorAll('.goal-label').forEach((l) => { l.textContent = k === 'daily' || weekly ? '하루 목표' : '기간 전체 목표'; });
      form.querySelector('[name="title"]').placeholder = k === 'daily' ? '예: 운동, 공고 확인' : '예: 이력서 초안 쓰기';
    } else if (box.dataset.seg === 'repeat') {
      const weekly = seg.dataset.v === 'weekly';
      form.querySelector('[data-show="end"]').hidden = weekly;
      form.querySelectorAll('.goal-label').forEach((l) => { l.textContent = weekly ? '하루 목표' : '기간 전체 목표'; });
    } else if (box.dataset.seg === 'measure') {
      form.querySelector('[data-show="time"]').hidden = seg.dataset.v !== 'time';
      form.querySelector('[data-show="count"]').hidden = seg.dataset.v !== 'count';
    } else {
      form.querySelector('[data-show="number"]').hidden = seg.dataset.v !== 'number';
    }
    initWheels(form);
    return;
  }

  const b = e.target.closest('[data-act]');
  if (!b) return;
  const { act } = b.dataset;
  if (act === 'dpick') {
    const box = b.closest('[data-daypick]');
    if (b.dataset.d === 'all') {
      const turnOn = !b.classList.contains('on'); // 매일을 켜면 모두 켜고, 끄면 모두 끈다
      box.querySelectorAll('[data-d]').forEach((x) => x.classList.toggle('on', turnOn));
    } else b.classList.toggle('on');
    const n = box.querySelectorAll('[data-d]:not([data-d="all"]).on').length;
    box.querySelector('[data-d="all"]').classList.toggle('on', n === 7);
    return;
  }
  if (act === 'mfilter') {
    const f = ['all', 'daily'].includes(b.dataset.f) ? b.dataset.f : Number(b.dataset.f);
    ui.mfilter = ui.mfilter === f ? 'all' : f; // 켜진 버튼을 다시 누르면 해제되어 전체로
    render();
    return;
  }
  if (act === 'slide') {
    ui.slide = Number(b.dataset.i);
    document.getElementById('slides').scrollTo({ left: ui.slide * view.clientWidth, behavior: 'smooth' });
  } else if (act === 'day') {
    ui.viewDay = null;
    render();
  } else if (act === 'toggle') {
    setValue(b, !state.records[selectedDay()]?.[b.dataset.item]);
  } else if (act === 'mtoggle') {
    const m = state.missions.find((x) => x.id === b.dataset.mission);
    setValue(b, !m.log[selectedDay()]);
  } else if (act === 'step') {
    const input = b.parentElement.querySelector('input');
    const next = Math.max(0, (Number(input.value) || 0) + Number(b.dataset.step));
    setValue(input, next);
  } else if (act === 'pick') {
    const on = b.getAttribute('aria-pressed') !== 'true';
    b.setAttribute('aria-pressed', String(on));
    b.classList.toggle('on', on);
    const box = b.closest('.picker');
    const n = box.querySelectorAll('.pick.on').length;
    const go = box.querySelector('[data-act="samples-picked"]');
    go.disabled = n === 0;
    go.textContent = n ? `선택한 ${n}개 넣기` : '항목을 골라 주세요';
  } else if (act === 'samples-picked') {
    const picked = [...b.closest('.picker').querySelectorAll('.pick.on')].map((x) => Number(x.dataset.i));
    const before = state.items.length;
    if (commit((s) => addSamples(s, uid, picked))) toast(`${state.items.length - before}개를 넣었어요`);
  } else if (act === 'archive') {
    commit((s) => archiveItem(s, b.dataset.item));
    toast('보관했어요. 기록은 남아 있어요.');
  } else if (act === 'restore') {
    commit((s) => restoreItem(s, b.dataset.item));
  } else if (act === 'delete') {
    const item = state.items.find((i) => i.id === b.dataset.item);
    if (confirm(`"${item.name}"을(를) 완전히 지울까요?\n이 항목의 기록도 함께 사라집니다.`)) commit((s) => deleteItem(s, item.id));
  } else if (act === 'mstatus') {
    commit((s) => setMissionStatus(s, b.dataset.mission, b.dataset.status, today()));
    if (b.dataset.status === 'done') celebrate();
  } else if (act === 'mdelete') {
    const m = state.missions.find((x) => x.id === b.dataset.mission);
    if (confirm(`"${m.title}" 미션을 지울까요?
⚙️ 설정의 "지운 미션"에서 되살릴 수 있어요.`)) {
      if (commit((s) => deleteMission(s, m.id, today()))) toast('지웠어요. 설정에서 되살릴 수 있어요');
    }
  } else if (act === 'mrestore') {
    if (commit((s) => restoreMission(s, b.dataset.mission))) toast('되살렸어요');
  } else if (act === 'mpurge') {
    const m = state.missions.find((x) => x.id === b.dataset.mission);
    if (confirm(`"${m.title}" 미션을 영구 삭제할까요?
진행 기록과 메모도 함께 사라지고 되돌릴 수 없어요.`)) commit((s) => purgeMission(s, m.id));
  } else if (act === 'mcheck') {
    const m = state.missions.find((x) => x.id === b.dataset.mission);
    if (m.kind === 'once') {
      const done = m.status !== 'done';
      commit((s) => setMissionStatus(s, m.id, done ? 'done' : 'active', today()));
      if (done) celebrate();
    } else if (m.type === 'number' && !isTime(m)) {
      const on = missionCheck(m, today()) === 'on';
      ui.mopen.add(m.id);
      setValue(b, on ? undefined : fillAmount(m));
    } else if (m.type === 'number') {
      const row = view.querySelector(`[data-mnum="${m.id}"]`);
      row.hidden = !row.hidden;
      if (row.hidden) ui.mopen.delete(m.id);
      else { ui.mopen.add(m.id); initWheels(row); row.querySelector('input, .wcol')?.focus(); }
    } else {
      setValue(b, !m.log[today()]);
    }
  } else if (act === 'ifill') {
    const item = state.items.find((x) => x.id === b.dataset.item);
    setValue(b, isDone(item, state.records[today()]?.[item.id]) ? undefined : item.goal);
  } else if (act === 'iedit') {
    const box = view.querySelector(`[data-iedit="${b.dataset.item}"]`);
    box.hidden = !box.hidden;
    if (!box.hidden) initWheels(box);
  } else if (act === 'medit') {
    const form = view.querySelector(`[data-medit="${b.dataset.mission}"]`);
    form.hidden = !form.hidden;
    if (!form.hidden) form.querySelector('input').focus();
  } else if (act === 'export') {
    exportBackup();
  }
});

view.addEventListener('change', (e) => {
  const el = e.target;
  if (el.matches('.num input')) {
    setValue(el, el.value === '' ? undefined : Number(el.value));
  } else if (el.matches('[data-note]')) {
    commit((s) => setMissionNote(s, el.dataset.note, selectedDay(), el.value, today()));
  } else if (el.id === 'import') {
    importBackup(el.files[0]);
  }
});

view.addEventListener('submit', (e) => {
  e.preventDefault();
  const form = e.target;
  const f = Object.fromEntries(new FormData(form));
  const segOf = (name) => form.querySelector(`[data-seg="${name}"] .on`)?.dataset.v;
  if (form.querySelector('[data-seg="measure"]')) {
    f.measure = segOf('measure');
    if (f.measure === 'count') f.goal = f.countGoal;
  }
  if (form.id === 'item-form') {
    if (commit((s) => addItem(s, { ...f, type: segOf('type') }, uid()))) toast('추가했어요');
  } else if (form.id === 'mission-form' && segOf('kind') === 'daily') {
    if (commit((s) => addItem(s, { ...f, name: f.title, type: segOf('type') }, uid()))) toast('매일 할 일을 추가했어요');
  } else if (form.id === 'mission-form') {
    const input = { ...f, kind: segOf('kind'), type: segOf('type'), repeat: segOf('repeat'), days: pickedDays(form) };
    if (commit((s) => addMission(s, input, uid()))) toast('미션을 추가했어요');
  } else if (form.dataset.edit) {
    if (commit((s) => updateItem(s, form.dataset.edit, f))) toast('저장했어요');
  } else if (form.dataset.medit) {
    const patch = form.querySelector('[data-daypick]') ? { ...f, days: pickedDays(form) } : f;
    if (commit((s) => editMission(s, form.dataset.medit, patch))) toast('미션을 수정했어요');
  }
});

function exportBackup() {
  const t = today();
  state = markBackup(state, t);
  save();
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `challenge-board-backup-${t}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  render();
  toast('백업 파일을 받았어요');
}

async function importBackup(file) {
  if (!file) return;
  try {
    const data = migrate(JSON.parse(await file.text()));
    if (!confirm('지금 기록을 백업 파일의 내용으로 바꿀까요?\n지금 브라우저에 있는 기록은 사라집니다.')) return render();
    state = data;
    save();
    render();
    toast('백업 파일을 불러왔어요');
  } catch (e) {
    toast(`불러오지 못했어요: ${e.message}`);
    render();
  }
}

// 자정이 지나면 날짜를 새로 그린다
let shownDay = today();
setInterval(() => {
  if (today() !== shownDay) { shownDay = today(); render(); }
}, 60_000);

render();

// ⋯ 메뉴 바깥을 누르면 닫는다
document.addEventListener('click', (e) => {
  document.querySelectorAll('details.more[open]').forEach((d) => { if (!d.contains(e.target)) d.open = false; });
});

// ---------- 휠 선택기 동작 ----------

// 보이는 휠의 칸을 저장된 값 위치로 맞춘다 (숨어 있던 칸을 펼친 뒤에도 부른다)
function initWheels(root) {
  root.querySelectorAll('.wcol').forEach((col) => {
    if (!col.offsetParent) return;
    const on = col.querySelector('.wrow.on');
    col.scrollTop = (on ? [...col.children].indexOf(on) : middleIndex(0, Number(col.dataset.count))) * ROW;
  });
}

const wheelIndex = (col) => Math.max(0, Math.min(col.children.length - 1, Math.round(col.scrollTop / ROW)));

// 굴리는 동안은 가운데 칸만 밝히고, 멈추면 값을 정한다
function onWheelScroll(col) {
  const i = wheelIndex(col);
  col.querySelectorAll('.wrow').forEach((r, n) => r.classList.toggle('on', n === i));
  clearTimeout(col.settle);
  col.settle = setTimeout(() => settleWheel(col.closest('.wheel')), 160);
}

// 칸 번호 → 값 (순환)
const wheelValue = (col) => wrapValue(wheelIndex(col), Number(col.dataset.count));

function settleWheel(wheel) {
  if (!wheel?.isConnected) return;
  const cols = [...wheel.querySelectorAll('.wcol')];
  if (cols.some((c) => c.classList.contains('dragging'))) return; // 끌거나 미끄러지는 중에는 기다린다
  const [h, m] = cols.map(wheelValue);
  // 앞뒤 묶음으로 갔으면 같은 값의 가운데 묶음으로 조용히 옮긴다 (계속 돌릴 수 있게)
  for (const col of cols) {
    const i = middleIndex(wheelValue(col), Number(col.dataset.count));
    if (i !== wheelIndex(col)) col.scrollTop = i * ROW;
  }
  const total = h * 60 + m;
  if (total === Number(wheel.dataset.value)) return;
  wheel.dataset.value = total;
  if (wheel.hasAttribute('data-form')) {
    wheel.parentElement.querySelector('input[name="goal"]').value = total;
  } else if (wheel.hasAttribute('data-log')) {
    setValue(wheel, total);
  }
}

view.addEventListener('scroll', (e) => {
  if (e.target.classList?.contains('wcol')) onWheelScroll(e.target);
}, true);

// 마우스 휠 한 번에 한 칸씩 (1분 단위로 정확하게)
view.addEventListener('wheel', (e) => {
  const col = e.target.closest?.('.wcol');
  if (!col) return;
  e.preventDefault();
  col.scrollBy({ top: Math.sign(e.deltaY) * ROW });
}, { passive: false });

// 위아래 방향키
view.addEventListener('keydown', (e) => {
  const col = e.target.closest?.('.wcol');
  if (!col || !['ArrowUp', 'ArrowDown'].includes(e.key)) return;
  e.preventDefault();
  col.scrollBy({ top: (e.key === 'ArrowUp' ? -1 : 1) * ROW });
});

// 칸을 누르면 그 값으로, 기록 버튼을 누르면 휠을 펼치거나 접는다
view.addEventListener('click', (e) => {
  const row = e.target.closest('.wrow');
  if (row && justDragged) return; // 끌기가 끝나며 생긴 클릭은 무시
  if (row) {
    row.parentElement.scrollTo({ top: [...row.parentElement.children].indexOf(row) * ROW, behavior: 'smooth' });
    return;
  }
  const b = e.target.closest('[data-act="wopen"]');
  if (!b) return;
  const panel = view.querySelector(`[data-wpanel="${b.dataset.key}"]`);
  panel.hidden = !panel.hidden;
  b.classList.toggle('open', !panel.hidden);
  if (panel.hidden) ui.wopen.delete(b.dataset.key);
  else { ui.wopen.add(b.dataset.key); initWheels(panel); }
});

// 마우스로 끌어서 돌리기. 놓으면 가까운 칸에 맞춰 멈추고 저장된다 (손가락은 브라우저 스크롤이 처리)
let drag = null;
let justDragged = false;
view.addEventListener('pointerdown', (e) => {
  const col = e.target.closest?.('.wcol');
  if (!col || e.pointerType !== 'mouse' || e.button !== 0) return;
  e.preventDefault();
  col.focus({ preventScroll: true });
  drag = { col, y: e.clientY, top: col.scrollTop, moved: false, trail: [{ t: e.timeStamp, y: e.clientY }] };
  col.classList.add('dragging');
  col.setPointerCapture(e.pointerId);
});
view.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const dy = e.clientY - drag.y;
  if (Math.abs(dy) > 3) drag.moved = true;
  drag.col.scrollTop = drag.top - dy;
  drag.trail.push({ t: e.timeStamp, y: e.clientY });
  if (drag.trail.length > 6) drag.trail.shift();
});
function endDrag(e) {
  if (!drag) return;
  const { col, moved, trail } = drag;
  drag = null;
  // 놓기 직전 100ms 동안의 속도(px/ms). 손을 아래로 끌면 휠은 위로 굴러간다
  const now = e?.timeStamp ?? trail.at(-1).t;
  const recent = trail.filter((p) => now - p.t <= 100);
  const first = recent[0] ?? trail.at(-1);
  const last = trail.at(-1);
  const velocity = last.t > first.t ? -(last.y - first.y) / (last.t - first.t) : 0;
  const max = (col.children.length - 1) * ROW;
  const target = Math.max(0, Math.min(max, glideTarget(col.scrollTop, velocity, ROW)));
  glide(col, target);
  justDragged = moved;
  setTimeout(() => { justDragged = false; }, 50);
}

// 목표 칸까지 점점 느려지며 미끄러진다. 끝나면 칸 맞춤을 다시 켜고 값을 정한다
function glide(col, target) {
  const from = col.scrollTop;
  const dist = target - from;
  const ms = Math.min(900, 220 + Math.abs(dist) * 0.9);
  const t0 = performance.now();
  const step = (now) => {
    const p = Math.min(1, (now - t0) / ms);
    col.scrollTop = from + dist * (1 - (1 - p) ** 3);
    if (p < 1) requestAnimationFrame(step);
    else {
      col.classList.remove('dragging');
      col.scrollTop = target;
      settleWheel(col.closest('.wheel'));
    }
  };
  requestAnimationFrame(step);
}
view.addEventListener('pointerup', endDrag);
view.addEventListener('pointercancel', endDrag);

// ---------- 홈 슬라이드: 마우스로 끌어서 오늘 ↔ 이번 주 넘기기 ----------
// (손가락은 브라우저 가로 스크롤이 처리. 휠 선택기·입력칸 위에서 시작한 끌기는 넘기지 않는다)
let swipe = null;
let swiped = false;
document.addEventListener('pointerdown', (e) => {
  // 홈 화면이면 카드 위든 여백이든 끌어서 넘긴다 (아래 메뉴·휠·입력칸 위는 제외)
  const slides = ui.tab === 'home' && document.getElementById('slides');
  if (!slides || e.pointerType !== 'mouse' || e.button !== 0) return;
  if (e.target.closest?.('.bottom-nav, .calendar, .wcol, input, textarea, select')) return;
  swipe = { slides, x: e.clientX, left: slides.scrollLeft, moved: false, id: e.pointerId };
});
document.addEventListener('pointermove', (e) => {
  if (!swipe) return;
  const dx = e.clientX - swipe.x;
  if (!swipe.moved && Math.abs(dx) > 6) {
    swipe.moved = true;
    swipe.slides.classList.add('dragging');
    swipe.slides.setPointerCapture(swipe.id);
    document.body.classList.add('no-select'); // 끄는 동안 글자가 선택되지 않게
    window.getSelection()?.removeAllRanges();
  }
  if (swipe.moved) swipe.slides.scrollLeft = swipe.left - dx;
});
function endSwipe(e) {
  if (!swipe) return;
  const { slides, x, moved } = swipe;
  swipe = null;
  if (!moved) return;
  const width = slides.clientWidth;
  const dx = (e?.clientX ?? x) - x;
  // 화면 폭의 15% 넘게 끌면 다음/이전 장으로
  let i = Math.round(slides.scrollLeft / width);
  if (Math.abs(dx) > width * 0.15) i = Math.round((slides.scrollLeft + (dx < 0 ? width * 0.35 : -width * 0.35)) / width);
  i = Math.max(0, Math.min(1, i));
  slides.classList.remove('dragging');
  document.body.classList.remove('no-select');
  slides.scrollTo({ left: i * width, behavior: 'smooth' });
  swiped = true;
  setTimeout(() => { swiped = false; }, 60);
}
document.addEventListener('pointerup', endSwipe);
document.addEventListener('pointercancel', endSwipe);
// 끌기가 끝나며 생긴 클릭은 버튼을 누르지 않게 막는다
document.addEventListener('click', (e) => {
  if (swiped) { e.stopPropagation(); e.preventDefault(); }
}, true);

// "더 보기"를 펼친 상태는 다시 그려도 유지
view.addEventListener('toggle', (e) => {
  if (e.target.classList?.contains('more-past')) ui.moreOpen = e.target.open;
}, true);
