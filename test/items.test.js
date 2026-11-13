import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isDone, todayProgress, weekSummary, streak } from '../src/items.js';

const check = { id: 'a', name: '공고 확인', type: 'check', archived: false };
const run = { id: 'b', name: '운동', type: 'number', unit: '분', goal: 30, archived: false };
const old = { id: 'c', name: '보관한 항목', type: 'check', archived: true };

test('체크형은 체크하면 달성이다', () => {
  assert.equal(isDone(check, true), true);
  assert.equal(isDone(check, false), false);
  assert.equal(isDone(check, undefined), false);
});

test('숫자형은 하루 목표 이상이면 달성이다', () => {
  assert.equal(isDone(run, 30), true);
  assert.equal(isDone(run, 40), true);
  assert.equal(isDone(run, 29), false);
  assert.equal(isDone(run, undefined), false);
});

test('오늘 달성률은 보관하지 않은 항목만 센다', () => {
  const state = {
    items: [check, run, old],
    records: { '2026-11-13': { a: true, b: 10, c: true } },
  };
  assert.deepEqual(todayProgress(state, '2026-11-13'), { done: 1, total: 2 });
});

test('기록이 없는 날의 달성률은 0이다', () => {
  const state = { items: [check, run], records: {} };
  assert.deepEqual(todayProgress(state, '2026-11-13'), { done: 0, total: 2 });
});

test('이번 주 요약: 체크형은 달성 일수, 숫자형은 하루 목표까지만 센 총량과 주간 목표', () => {
  const state = {
    items: [check, run, old],
    records: {
      '2026-11-08': { a: true, b: 100 }, // 지난주 일요일: 빼야 함
      '2026-11-09': { a: true, b: 30 },
      '2026-11-10': { b: 20 },
      '2026-11-13': { a: true, b: 50 },
    },
  };
  const summary = weekSummary(state, '2026-11-13');
  assert.equal(summary.length, 2);
  assert.deepEqual(summary[0], { id: 'a', name: '공고 확인', type: 'check', doneDays: 2 });
  assert.deepEqual(summary[1], {
    id: 'b', name: '운동', type: 'number', unit: '분', doneDays: 2, total: 80, rawTotal: 100, weekGoal: 210,
  });
});

test('연속 달성일: 오늘 했으면 오늘부터 거꾸로 센다', () => {
  const records = {
    '2026-11-11': { a: true },
    '2026-11-12': { a: true },
    '2026-11-13': { a: true },
  };
  assert.equal(streak(check, records, '2026-11-13'), 3);
});

test('연속 달성일: 오늘 아직 안 했으면 어제까지 센다', () => {
  const records = { '2026-11-11': { a: true }, '2026-11-12': { a: true } };
  assert.equal(streak(check, records, '2026-11-13'), 2);
});

test('연속 달성일: 하루 빠지면 0부터 다시 센다', () => {
  const records = { '2026-11-10': { a: true }, '2026-11-12': { a: true }, '2026-11-13': { a: true } };
  assert.equal(streak(check, records, '2026-11-13'), 2);
});

test('연속 달성일: 어제도 오늘도 안 했으면 0이다', () => {
  const records = { '2026-11-10': { a: true } };
  assert.equal(streak(check, records, '2026-11-13'), 0);
});

test('연속 달성일: 숫자형은 목표를 채운 날만 이어진다', () => {
  const records = { '2026-11-12': { b: 30 }, '2026-11-13': { b: 10 } };
  assert.equal(streak(run, records, '2026-11-13'), 1);
});

// ---- 오늘 달성률에 오늘의 미션도 센다 (버그: 매일 할 일이 없으면 미션을 체크해도 0/0) ----

const mCheck = {
  id: 'm1', kind: 'period', type: 'check', title: '공고 보기',
  start: '2026-11-10', end: '2026-11-20', status: 'active', log: {}, notes: {},
};
const mNumber = {
  id: 'm2', kind: 'period', type: 'number', unit: '시간', goal: 20, title: '자격증',
  start: '2026-11-01', end: '2026-11-30', status: 'active', log: {}, notes: {},
};
const mOnce = { id: 'm3', kind: 'once', title: '이력서', deadline: '2026-11-20', status: 'active', log: {}, notes: {} };

test('오늘 달성률: 매일 할 일이 없어도 오늘의 미션을 센다', () => {
  const state = { items: [], records: {}, missions: [mCheck, mNumber] };
  assert.deepEqual(todayProgress(state, '2026-11-13'), { done: 0, total: 2 });
});

test('오늘 달성률: 체크한 미션, 0보다 큰 양을 적은 숫자형 미션은 달성', () => {
  const state = {
    items: [], records: {},
    missions: [{ ...mCheck, log: { '2026-11-13': true } }, { ...mNumber, log: { '2026-11-13': 1.5 } }],
  };
  assert.deepEqual(todayProgress(state, '2026-11-13'), { done: 2, total: 2 });
});

test('오늘 달성률: 매일 할 일과 미션을 함께 센다', () => {
  const state = {
    items: [check, run], records: { '2026-11-13': { a: true } },
    missions: [{ ...mCheck, log: { '2026-11-13': true } }, mNumber],
  };
  assert.deepEqual(todayProgress(state, '2026-11-13'), { done: 2, total: 4 });
});

test('오늘 달성률: 한 번 끝내는 미션, 기간 밖·끝난 미션은 세지 않는다', () => {
  const state = {
    items: [], records: {},
    missions: [mOnce, { ...mCheck, start: '2026-11-14' }, { ...mNumber, status: 'done' }],
  };
  assert.deepEqual(todayProgress(state, '2026-11-13'), { done: 0, total: 0 });
});

test('오늘 달성률: 미션 목록이 없는 옛 데이터도 그대로 센다', () => {
  const state = { items: [check], records: { '2026-11-13': { a: true } } };
  assert.deepEqual(todayProgress(state, '2026-11-13'), { done: 1, total: 1 });
});

test('이번 주 요약: 하루에 몰아서 해도 주간 진행도가 차지 않는다', () => {
  const state = { items: [run], records: { '2026-11-09': { b: 300 } } };
  const [r] = weekSummary(state, '2026-11-13');
  assert.equal(r.total, 30);
  assert.equal(r.rawTotal, 300);
});

test('오늘 달성률: 지운 미션은 세지 않는다', () => {
  const state = { items: [], records: {}, missions: [{ ...mCheck, deletedAt: '2026-11-13' }] };
  assert.deepEqual(todayProgress(state, '2026-11-13'), { done: 0, total: 0 });
});
