import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyState, migrate, setRecord, addItem, updateItem, archiveItem, restoreItem, deleteItem,
  addMission, editMission, setMissionLog, setMissionNote, setMissionStatus, deleteMission,
  needsBackup, markBackup, SAMPLE_ITEMS, addSamples,
} from '../src/store.js';

const TODAY = '2026-11-13';

test('빈 상태에는 버전 번호 3이 있다', () => {
  const s = emptyState();
  assert.equal(s.version, 3);
  assert.deepEqual(s.items, []);
  assert.deepEqual(s.records, {});
  assert.deepEqual(s.missions, []);
  assert.equal(s.lastBackup, null);
});

test('버전 3 데이터는 그대로 읽는다', () => {
  const s = { ...emptyState(), items: [{ id: 'a', name: 'x', type: 'check', archived: false }] };
  assert.deepEqual(migrate(JSON.parse(JSON.stringify(s))), s);
});

test('빠진 칸은 기본값으로 채운다', () => {
  const s = migrate({ version: 1, items: [] });
  assert.deepEqual(s.records, {});
  assert.deepEqual(s.missions, []);
  assert.equal(s.lastBackup, null);
});

test('버전이 없거나 모르는 버전이면 거부한다', () => {
  assert.throws(() => migrate({ items: [] }));
  assert.throws(() => migrate({ version: 99 }));
  assert.throws(() => migrate(null));
  assert.throws(() => migrate('문자열'));
});

test('항목 추가: 체크형', () => {
  const s = addItem(emptyState(), { name: '공고 확인', type: 'check' }, 'id1');
  assert.deepEqual(s.items[0], { id: 'id1', name: '공고 확인', type: 'check', archived: false });
});

test('항목 추가: 숫자형은 단위와 목표가 필요하다', () => {
  const s = addItem(emptyState(), { name: '운동', type: 'number', unit: '분', goal: 30 }, 'id2');
  assert.deepEqual(s.items[0], { id: 'id2', name: '운동', type: 'number', measure: 'time', unit: '분', goal: 30, archived: false });
  assert.throws(() => addItem(emptyState(), { name: '운동', type: 'number', unit: '분', goal: 0 }, 'x'));
  assert.throws(() => addItem(emptyState(), { name: '단어', type: 'number', measure: 'count', goal: 30 }, 'x'));
});

test('항목 이름이 비어 있으면 거부한다', () => {
  assert.throws(() => addItem(emptyState(), { name: '  ', type: 'check' }, 'x'));
});

test('원래 상태는 바뀌지 않는다 (새 상태를 돌려준다)', () => {
  const before = emptyState();
  addItem(before, { name: 'a', type: 'check' }, 'x');
  assert.equal(before.items.length, 0);
});

test('항목 수정', () => {
  let s = addItem(emptyState(), { name: '운동', type: 'number', unit: '분', goal: 30 }, 'b');
  s = updateItem(s, 'b', { name: '걷기', goal: 40 });
  assert.equal(s.items[0].name, '걷기');
  assert.equal(s.items[0].goal, 40);
});

test('보관하면 기록은 남고, 다시 꺼낼 수 있다', () => {
  let s = addItem(emptyState(), { name: 'a', type: 'check' }, 'a');
  s = setRecord(s, TODAY, 'a', true, TODAY);
  s = archiveItem(s, 'a');
  assert.equal(s.items[0].archived, true);
  assert.equal(s.records[TODAY].a, true);
  s = restoreItem(s, 'a');
  assert.equal(s.items[0].archived, false);
});

test('완전히 지우면 항목과 기록이 함께 사라진다', () => {
  let s = addItem(emptyState(), { name: 'a', type: 'check' }, 'a');
  s = addItem(s, { name: 'b', type: 'check' }, 'b');
  s = setRecord(s, TODAY, 'a', true, TODAY);
  s = setRecord(s, TODAY, 'b', true, TODAY);
  s = deleteItem(s, 'a');
  assert.deepEqual(s.items.map((i) => i.id), ['b']);
  assert.deepEqual(s.records[TODAY], { b: true });
});

test('기록: 오늘과 어제만 남길 수 있다', () => {
  let s = addItem(emptyState(), { name: 'a', type: 'check' }, 'a');
  s = setRecord(s, '2026-11-12', 'a', true, TODAY);
  assert.equal(s.records['2026-11-12'].a, true);
  assert.throws(() => setRecord(s, '2026-11-11', 'a', true, TODAY));
});

test('기록: 숫자형에 음수는 넣을 수 없다', () => {
  let s = addItem(emptyState(), { name: '운동', type: 'number', unit: '분', goal: 30 }, 'b');
  assert.throws(() => setRecord(s, TODAY, 'b', -5, TODAY));
});

test('미션 추가: 한 번 끝내는 미션', () => {
  const s = addMission(emptyState(), { kind: 'once', title: '이력서 초안', deadline: '2026-11-20' }, 'm1');
  assert.deepEqual(s.missions[0], {
    id: 'm1', kind: 'once', title: '이력서 초안', deadline: '2026-11-20', status: 'active', log: {}, notes: {},
  });
});

test('미션 추가: 기간 미션은 시작일이 마감일보다 늦으면 거부한다', () => {
  assert.throws(() => addMission(emptyState(),
    { kind: 'period', type: 'check', title: 'x', start: '2026-11-20', end: '2026-11-10' }, 'm'));
});

test('미션 추가: 기간 숫자형은 목표가 필요하다', () => {
  assert.throws(() => addMission(emptyState(),
    { kind: 'period', type: 'number', measure: 'count', unit: '문제', title: 'x', start: '2026-11-01', end: '2026-11-30' }, 'm'));
  const s = addMission(emptyState(),
    { kind: 'period', type: 'number', measure: 'count', unit: '문제', goal: 20, title: '자격증', start: '2026-11-01', end: '2026-11-30' }, 'm');
  assert.equal(s.missions[0].goal, 20);
});

test('미션 기록과 메모: 오늘과 어제만', () => {
  let s = addMission(emptyState(),
    { kind: 'period', type: 'check', title: 'x', start: '2026-11-01', end: '2026-11-30' }, 'm');
  s = setMissionLog(s, 'm', TODAY, true, TODAY);
  s = setMissionNote(s, 'm', TODAY, '오늘 3개 봄', TODAY);
  assert.equal(s.missions[0].log[TODAY], true);
  assert.equal(s.missions[0].notes[TODAY], '오늘 3개 봄');
  assert.throws(() => setMissionLog(s, 'm', '2026-11-10', true, TODAY));
});

test('미션 상태 바꾸기와 지우기', () => {
  let s = addMission(emptyState(), { kind: 'once', title: 'x', deadline: '2026-11-20' }, 'm');
  s = setMissionStatus(s, 'm', 'done');
  assert.equal(s.missions[0].status, 'done');
  assert.throws(() => setMissionStatus(s, 'm', '이상한값'));
  s = deleteMission(s, 'm', TODAY);
  assert.equal(s.missions.length, 1);
  assert.equal(s.missions[0].deletedAt, TODAY);
});

test('백업 알림: 기록이 없으면 알리지 않는다', () => {
  assert.equal(needsBackup(emptyState(), TODAY), false);
});

test('백업 알림: 기록이 있는데 한 번도 백업 안 했으면 알린다', () => {
  let s = addItem(emptyState(), { name: 'a', type: 'check' }, 'a');
  s = setRecord(s, TODAY, 'a', true, TODAY);
  assert.equal(needsBackup(s, TODAY), true);
});

test('백업 알림: 마지막 백업 후 7일이 지나면 알린다', () => {
  let s = addItem(emptyState(), { name: 'a', type: 'check' }, 'a');
  s = setRecord(s, TODAY, 'a', true, TODAY);
  s = markBackup(s, '2026-11-07');
  assert.equal(needsBackup(s, '2026-11-13'), false); // 6일
  assert.equal(needsBackup(s, '2026-11-14'), true); // 7일
});

test('예시 항목: 8개이고, 체크형과 숫자형이 모두 있고, 그대로 추가할 수 있다', () => {
  assert.equal(SAMPLE_ITEMS.length, 8);
  assert.ok(SAMPLE_ITEMS.some((i) => i.type === 'check'));
  assert.ok(SAMPLE_ITEMS.some((i) => i.type === 'number'));
  for (const [n, sample] of SAMPLE_ITEMS.entries()) addItem(emptyState(), sample, `s${n}`);
});

test('예시 항목 이름은 겹치지 않는다', () => {
  assert.equal(new Set(SAMPLE_ITEMS.map((i) => i.name)).size, SAMPLE_ITEMS.length);
});

test('예시 한 번에 넣기: 8개가 모두 들어간다', () => {
  let n = 0;
  const s = addSamples(emptyState(), () => `s${n++}`);
  assert.equal(s.items.length, 8);
  assert.deepEqual(s.items.map((i) => i.name), SAMPLE_ITEMS.map((i) => i.name));
});

test('예시 한 번에 넣기: 같은 이름의 항목이 이미 있으면 다시 넣지 않는다', () => {
  let n = 0;
  let s = addItem(emptyState(), { name: '운동', type: 'check' }, 'mine');
  s = addSamples(s, () => `s${n++}`);
  assert.equal(s.items.length, 8);
  assert.equal(s.items.filter((i) => i.name === '운동').length, 1);
  assert.equal(addSamples(s, () => `t${n++}`).items.length, 8);
});

test('선택한 예시만 넣기: 고른 번호의 예시만 그 순서대로 들어간다', () => {
  let n = 0;
  const s = addSamples(emptyState(), () => `s${n++}`, [2, 0]);
  assert.deepEqual(s.items.map((i) => i.name), [SAMPLE_ITEMS[0].name, SAMPLE_ITEMS[2].name]);
});

test('선택한 예시만 넣기: 아무것도 고르지 않으면 바뀌지 않는다', () => {
  const before = emptyState();
  assert.deepEqual(addSamples(before, () => 'x', []), before);
});

test('선택한 예시만 넣기: 이미 있는 이름은 건너뛴다', () => {
  let n = 0;
  let s = addItem(emptyState(), { name: SAMPLE_ITEMS[1].name, type: 'check' }, 'mine');
  s = addSamples(s, () => `s${n++}`, [1, 3]);
  assert.deepEqual(s.items.map((i) => i.name), [SAMPLE_ITEMS[1].name, SAMPLE_ITEMS[3].name]);
});

test('선택한 예시만 넣기: 없는 번호는 무시한다', () => {
  let n = 0;
  const s = addSamples(emptyState(), () => `s${n++}`, [0, 99, -1]);
  assert.equal(s.items.length, 1);
});

// ---- 미션 수정 ----

const onceState = () => addMission(emptyState(), { kind: 'once', title: '이력서 초안', deadline: '2026-11-20' }, 'm');
const periodState = (type = 'check') => addMission(emptyState(), {
  kind: 'period', type, title: '공부', start: '2026-11-01', end: '2026-11-30',
  ...(type === 'number' ? { measure: 'count', unit: '권', goal: 20 } : {}),
}, 'm');

test('미션 수정: 한 번 끝내는 미션의 이름과 마감일', () => {
  const s = editMission(onceState(), 'm', { title: '이력서 완성', deadline: '2026-11-25' });
  assert.equal(s.missions[0].title, '이력서 완성');
  assert.equal(s.missions[0].deadline, '2026-11-25');
});

test('미션 수정: 기간 미션의 시작일·마감일', () => {
  const s = editMission(periodState(), 'm', { start: '2026-11-05', end: '2026-12-05' });
  assert.equal(s.missions[0].start, '2026-11-05');
  assert.equal(s.missions[0].end, '2026-12-05');
});

test('미션 수정: 시간형 미션은 목표(분)만 바꾸고 단위는 "분" 그대로', () => {
  const s0 = addMission(emptyState(), { kind: 'period', type: 'number', measure: 'time', goal: 600, title: '공부', start: '2026-11-01', end: '2026-11-30' }, 'm');
  const s = editMission(s0, 'm', { goal: 900, unit: '문제' });
  assert.equal(s.missions[0].goal, 900);
  assert.equal(s.missions[0].unit, '분');
});

test('미션 수정: 개수형 미션의 단위와 목표', () => {
  const s = editMission(periodState('number'), 'm', { unit: '문제', goal: '50' });
  assert.equal(s.missions[0].unit, '문제');
  assert.equal(s.missions[0].goal, 50);
});

test('미션 수정: 종류·방식·상태·기록·메모는 바뀌지 않는다', () => {
  let s = setMissionLog(periodState(), 'm', '2026-11-13', true, '2026-11-13');
  s = setMissionNote(s, 'm', '2026-11-13', '메모', '2026-11-13');
  s = editMission(s, 'm', { title: '새 이름', kind: 'once', type: 'number', status: 'done' });
  const m = s.missions[0];
  assert.equal(m.kind, 'period');
  assert.equal(m.type, 'check');
  assert.equal(m.status, 'active');
  assert.deepEqual(m.log, { '2026-11-13': true });
  assert.deepEqual(m.notes, { '2026-11-13': '메모' });
});

test('미션 수정: 잘못된 값은 거부한다', () => {
  assert.throws(() => editMission(onceState(), 'm', { title: '  ' }));
  assert.throws(() => editMission(onceState(), 'm', { deadline: '' }));
  assert.throws(() => editMission(periodState(), 'm', { start: '2026-12-10' })); // 마감일보다 늦음
  assert.throws(() => editMission(periodState('number'), 'm', { goal: 0 }));
});

test('미션 수정: 원래 상태는 바뀌지 않는다', () => {
  const before = onceState();
  editMission(before, 'm', { title: '바뀐 이름' });
  assert.equal(before.missions[0].title, '이력서 초안');
});

// ---- 지운 미션: 휴지통 ----
import { restoreMission, purgeMission } from '../src/store.js';

test('지운 미션은 되살릴 수 있다 (기록·메모 유지)', () => {
  let s = addMission(emptyState(), { kind: 'period', type: 'check', title: 'x', start: '2026-11-01', end: '2026-11-30' }, 'm');
  s = setMissionLog(s, 'm', TODAY, true, TODAY);
  s = deleteMission(s, 'm', TODAY);
  s = restoreMission(s, 'm');
  assert.equal('deletedAt' in s.missions[0], false);
  assert.deepEqual(s.missions[0].log, { [TODAY]: true });
});

test('영구 삭제는 지운 미션만 할 수 있다', () => {
  let s = addMission(emptyState(), { kind: 'once', title: 'x', deadline: '2026-11-20' }, 'm');
  assert.throws(() => purgeMission(s, 'm'));
  s = purgeMission(deleteMission(s, 'm', TODAY), 'm');
  assert.equal(s.missions.length, 0);
});

// ---- 시간형 / 개수형, 저장 버전 1 → 2 ----

test('숫자형 추가: 시간형은 목표를 분으로 저장하고 단위는 "분"', () => {
  const s = addItem(emptyState(), { name: '스터디', type: 'number', measure: 'time', goal: 90 }, 'a');
  assert.deepEqual(s.items[0], { id: 'a', name: '스터디', type: 'number', measure: 'time', unit: '분', goal: 90, archived: false });
});

test('숫자형 추가: 시간형 목표는 1분 이상의 정수 분', () => {
  assert.throws(() => addItem(emptyState(), { name: 'x', type: 'number', measure: 'time', goal: 0 }, 'a'));
  assert.throws(() => addItem(emptyState(), { name: 'x', type: 'number', measure: 'time', goal: 1.5 }, 'a'));
});

test('숫자형 추가: 개수형은 단위가 필요하다', () => {
  const s = addItem(emptyState(), { name: '단어', type: 'number', measure: 'count', unit: '개', goal: 20 }, 'a');
  assert.equal(s.items[0].measure, 'count');
  assert.equal(s.items[0].unit, '개');
});

test('미션 추가: 기간 시간형 미션은 목표를 분으로', () => {
  const s = addMission(emptyState(),
    { kind: 'period', type: 'number', measure: 'time', goal: 1200, title: '자격증', start: '2026-11-01', end: '2026-11-30' }, 'm');
  assert.equal(s.missions[0].measure, 'time');
  assert.equal(s.missions[0].unit, '분');
  assert.equal(s.missions[0].goal, 1200);
});

test('예시 항목: 시간 관련은 시간형, 나머지 숫자형은 개수형', () => {
  for (const s of SAMPLE_ITEMS.filter((x) => x.type === 'number')) {
    assert.ok(['time', 'count'].includes(s.measure), s.name);
  }
  assert.equal(SAMPLE_ITEMS.find((x) => x.name === '운동').measure, 'time');
  assert.equal(SAMPLE_ITEMS.find((x) => x.name === '영어 단어').measure, 'count');
});

test('버전 1 → 2: 단위가 "시간"인 숫자형은 시간형으로, 목표·기록을 분으로 바꾼다', () => {
  const v1 = {
    version: 1, lastBackup: null,
    items: [
      { id: 'a', name: '운동', type: 'number', unit: '분', goal: 30, archived: false },
      { id: 'b', name: '공부', type: 'number', unit: '시간', goal: 2, archived: false },
      { id: 'c', name: '단어', type: 'number', unit: '개', goal: 20, archived: false },
      { id: 'd', name: '공고', type: 'check', archived: false },
    ],
    records: { '2026-11-12': { a: 40, b: 1.5, c: 10, d: true } },
    missions: [
      { id: 'm', kind: 'period', type: 'number', unit: '시간', goal: 20, title: '자격증', start: '2026-11-01', end: '2026-11-30', status: 'active', log: { '2026-11-02': 3 }, notes: {} },
      { id: 'n', kind: 'once', title: '이력서', deadline: '2026-11-20', status: 'active', log: {}, notes: {} },
    ],
  };
  const s = migrate(v1);
  assert.equal(s.version, 3); // 1 → 2 → 3 차례로
  assert.deepEqual(s.items.map((i) => [i.id, i.measure, i.unit, i.goal]),
    [['a', 'time', '분', 30], ['b', 'time', '분', 120], ['c', 'count', '개', 20], ['d', undefined, undefined, undefined]]);
  assert.deepEqual(s.records['2026-11-12'], { a: 40, b: 90, c: 10, d: true });
  assert.equal(s.missions[0].measure, 'time');
  assert.equal(s.missions[0].goal, 1200);
  assert.deepEqual(s.missions[0].log, { '2026-11-02': 180 });
  assert.equal(s.missions[1].measure, undefined);
});

test('버전 1 → 2: 원래 데이터는 바뀌지 않는다', () => {
  const v1 = { version: 1, items: [{ id: 'b', name: '공부', type: 'number', unit: '시간', goal: 2, archived: false }], records: { '2026-11-12': { b: 1 } } };
  migrate(v1);
  assert.equal(v1.items[0].goal, 2);
  assert.equal(v1.records['2026-11-12'].b, 1);
});
