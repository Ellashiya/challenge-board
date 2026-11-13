// 상태(데이터) 바꾸기. 모든 함수는 원래 상태를 고치지 않고 새 상태를 돌려준다.
import { canEdit, daysBetween } from './dates.js';

export const VERSION = 3;

export const SAMPLE_ITEMS = [
  { name: '운동', type: 'number', measure: 'time', goal: 30 },
  { name: '공고 확인', type: 'check' },
  { name: '스터디', type: 'number', measure: 'time', goal: 60 },
  { name: '자격증 문제 풀이', type: 'number', measure: 'count', unit: '문제', goal: 20 },
  { name: '영어 단어', type: 'number', measure: 'count', unit: '개', goal: 20 },
  { name: '포트폴리오 작업', type: 'number', measure: 'time', goal: 60 },
  { name: '공부 기록 쓰기', type: 'check' },
  { name: '면접 답변 연습', type: 'check' },
];

const MISSION_STATUSES = ['active', 'done', 'stopped'];

export function emptyState() {
  return { version: VERSION, items: [], records: {}, missions: [], lastBackup: null };
}

// 저장된 데이터나 백업 파일을 읽을 때 쓴다. 버전이 다르면 여기서 바꿔 읽는다.
export function migrate(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('데이터 형식이 아닙니다');
  if (data.version === 1) data = fromV1(data);
  if (data.version === 2) data = fromV2(data);
  if (data.version !== VERSION) throw new Error(`알 수 없는 데이터 버전: ${data.version}`);
  return {
    version: VERSION,
    items: Array.isArray(data.items) ? data.items : [],
    records: data.records && typeof data.records === 'object' ? data.records : {},
    missions: Array.isArray(data.missions) ? data.missions : [],
    lastBackup: data.lastBackup ?? null,
  };
}

const clone = (s) => structuredClone(s);

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

// 버전 2 → 3: 기간 미션에 요일(매일)과 반복(기간 동안)을 붙인다
function fromV2(v2) {
  const d = clone(v2);
  for (const m of d.missions ?? []) if (m.kind === 'period') Object.assign(m, { days: m.days ?? ALL_DAYS, repeat: m.repeat ?? 'period' });
  d.version = 3;
  return d;
}

// 요일 목록 확인: 0~6 중 하나 이상, 정렬·중복 제거. 없으면 매일
function checkDays(days) {
  if (days === undefined) return [...ALL_DAYS];
  const list = [...new Set(days.map(Number))].filter((x) => x >= 0 && x <= 6).sort();
  if (!list.length) throw new Error('요일을 하나 이상 골라 주세요');
  return list;
}

// 버전 1 → 2: 숫자형에 measure(시간형/개수형)를 붙인다. 단위가 "분"·"시간"이면 시간형(분 단위로 저장)
const TIME_FACTOR = { '분': 1, '시간': 60 };
function fromV1(v1) {
  const d = clone(v1);
  const convert = (x, scaleValues) => {
    if (x.type !== 'number' || x.measure) return;
    const factor = TIME_FACTOR[x.unit];
    if (!factor) { x.measure = 'count'; return; }
    Object.assign(x, { measure: 'time', unit: '분', goal: x.goal * factor });
    scaleValues(factor);
  };
  for (const item of d.items ?? []) {
    convert(item, (f) => {
      for (const day of Object.values(d.records ?? {})) if (typeof day[item.id] === 'number') day[item.id] *= f;
    });
  }
  for (const m of d.missions ?? []) {
    convert(m, (f) => { for (const k of Object.keys(m.log ?? {})) if (typeof m.log[k] === 'number') m.log[k] *= f; });
  }
  d.version = 2;
  return d;
}

function checkName(name) {
  const trimmed = (name ?? '').trim();
  if (!trimmed) throw new Error('이름을 입력해 주세요');
  return trimmed;
}

function checkGoal(input) {
  if (!(input.unit ?? '').trim()) throw new Error('단위를 입력해 주세요');
  if (!(Number(input.goal) > 0)) throw new Error('목표는 0보다 커야 합니다');
}

// 숫자형의 measure·unit·goal을 정해 target에 넣는다.
// measure가 없으면 단위로 짐작한다 (분·시간 → 시간형). 시간형은 목표를 정수 분으로 저장한다.
function applyNumber(target, input) {
  const measure = input.measure ?? (TIME_FACTOR[(input.unit ?? '').trim()] ? 'time' : 'count');
  if (measure === 'time') {
    const goal = Number(input.goal) * (input.measure ? 1 : TIME_FACTOR[input.unit.trim()]);
    if (!(goal >= 1) || !Number.isInteger(goal)) throw new Error('목표 시간을 1분 이상으로 골라 주세요');
    Object.assign(target, { measure, unit: '분', goal });
  } else {
    checkGoal(input);
    Object.assign(target, { measure, unit: input.unit.trim(), goal: Number(input.goal) });
  }
}

function checkValue(value) {
  if (typeof value === 'number' && (!Number.isFinite(value) || value < 0)) {
    throw new Error('0 이상의 숫자를 입력해 주세요');
  }
}

function checkDate(key, today) {
  if (!canEdit(key, today)) throw new Error('오늘과 어제만 기록할 수 있습니다');
}

// ---- 매일 항목 ----

export function addItem(state, input, id) {
  const name = checkName(input.name);
  const item = { id, name, type: input.type };
  if (input.type === 'number') applyNumber(item, input);
  item.archived = false;
  const s = clone(state);
  s.items.push(item);
  return s;
}

// 예시 항목을 한 번에 넣는다. picked(예시 번호 목록)를 주면 고른 것만, 없으면 전부.
// 넣는 순서는 예시 목록 순서. 같은 이름이 이미 있거나 없는 번호면 건너뛴다.
export function addSamples(state, makeId, picked) {
  const names = new Set(state.items.map((i) => i.name));
  const chosen = picked ? new Set(picked) : null;
  return SAMPLE_ITEMS
    .filter((sample, i) => (!chosen || chosen.has(i)) && !names.has(sample.name))
    .reduce((s, sample) => addItem(s, sample, makeId()), state);
}

export function updateItem(state, id, patch) {
  const s = clone(state);
  const item = s.items.find((i) => i.id === id);
  if (patch.name !== undefined) item.name = checkName(patch.name);
  if (item.type === 'number') {
    applyNumber(item, { measure: item.measure, unit: patch.unit ?? item.unit, goal: patch.goal ?? item.goal });
  }
  return s;
}

const setArchived = (state, id, archived) => {
  const s = clone(state);
  s.items.find((i) => i.id === id).archived = archived;
  return s;
};
export const archiveItem = (state, id) => setArchived(state, id, true);
export const restoreItem = (state, id) => setArchived(state, id, false);

export function deleteItem(state, id) {
  const s = clone(state);
  s.items = s.items.filter((i) => i.id !== id);
  for (const day of Object.values(s.records)) delete day[id];
  return s;
}

export function setRecord(state, key, itemId, value, today) {
  checkDate(key, today);
  checkValue(value);
  const s = clone(state);
  s.records[key] = { ...s.records[key], [itemId]: value };
  return s;
}

// ---- 미션 ----

export function addMission(state, input, id) {
  const title = checkName(input.title);
  let mission;
  if (input.kind === 'once') {
    if (!input.deadline) throw new Error('마감일을 입력해 주세요');
    mission = { id, kind: 'once', title, deadline: input.deadline };
  } else {
    const repeat = input.repeat === 'weekly' ? 'weekly' : 'period';
    if (!input.start || (repeat === 'period' && !input.end)) throw new Error('시작일과 마감일을 입력해 주세요');
    if (repeat === 'period' && input.start > input.end) throw new Error('시작일이 마감일보다 늦습니다');
    mission = {
      id, kind: 'period', type: input.type, title, start: input.start,
      end: repeat === 'weekly' ? null : input.end, repeat, days: checkDays(input.days),
    };
    if (input.type === 'number') applyNumber(mission, input);
  }
  Object.assign(mission, { status: 'active', log: {}, notes: {} });
  const s = clone(state);
  s.missions.push(mission);
  return s;
}

// 이름·날짜·단위·목표만 바꾼다. 종류(once/period)·방식(check/number)·상태·기록·메모는 그대로 둔다.
export function editMission(state, id, patch) {
  return updateMission(state, id, (m) => {
    if (patch.title !== undefined) m.title = checkName(patch.title);
    if (m.kind === 'once') {
      if (patch.deadline !== undefined) {
        if (!patch.deadline) throw new Error('마감일을 입력해 주세요');
        m.deadline = patch.deadline;
      }
      return;
    }
    const start = patch.start ?? m.start;
    const end = m.repeat === 'weekly' ? null : patch.end ?? m.end;
    if (!start || (m.repeat !== 'weekly' && !end)) throw new Error('시작일과 마감일을 입력해 주세요');
    if (end && start > end) throw new Error('시작일이 마감일보다 늦습니다');
    Object.assign(m, { start, end });
    if (patch.days !== undefined) m.days = checkDays(patch.days);
    if (m.type === 'number') applyNumber(m, { measure: m.measure, unit: patch.unit ?? m.unit, goal: patch.goal ?? m.goal });
  });
}

function updateMission(state, id, fn) {
  const s = clone(state);
  fn(s.missions.find((m) => m.id === id));
  return s;
}

export function setMissionLog(state, id, key, value, today) {
  checkDate(key, today);
  checkValue(value);
  return updateMission(state, id, (m) => { m.log[key] = value; });
}

export function setMissionNote(state, id, key, text, today) {
  checkDate(key, today);
  return updateMission(state, id, (m) => {
    if (text.trim()) m.notes[key] = text.trim();
    else delete m.notes[key];
  });
}

// 완료하면 그날(today)을 doneAt에 남긴다 (지난 미션을 최근 7일로 거르는 데 쓴다)
export function setMissionStatus(state, id, status, today) {
  if (!MISSION_STATUSES.includes(status)) throw new Error(`알 수 없는 상태: ${status}`);
  return updateMission(state, id, (m) => {
    m.status = status;
    if (status === 'done' && today) m.doneAt = today;
    else delete m.doneAt;
  });
}

// 지우기는 휴지통으로 (deletedAt). 설정에서 되살리거나 영구 삭제한다.
export function deleteMission(state, id, today) {
  return updateMission(state, id, (m) => { m.deletedAt = today; });
}

export function restoreMission(state, id) {
  return updateMission(state, id, (m) => { delete m.deletedAt; });
}

export function purgeMission(state, id) {
  if (!state.missions.find((m) => m.id === id)?.deletedAt) throw new Error('지운 미션만 영구 삭제할 수 있습니다');
  const s = clone(state);
  s.missions = s.missions.filter((m) => m.id !== id);
  return s;
}

// ---- 백업 ----

const hasRecords = (s) =>
  Object.values(s.records).some((day) => Object.keys(day).length > 0) ||
  s.missions.some((m) => Object.keys(m.log).length > 0);

export function needsBackup(state, today) {
  if (!hasRecords(state)) return false;
  if (!state.lastBackup) return true;
  return daysBetween(state.lastBackup, today) >= 7;
}

export function markBackup(state, today) {
  return { ...clone(state), lastBackup: today };
}
