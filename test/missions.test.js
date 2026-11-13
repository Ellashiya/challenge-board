import { test } from 'node:test';
import assert from 'node:assert/strict';
import { missionProgress, missionState, dday, isLoggableToday } from '../src/missions.js';

const once = { id: 'm1', kind: 'once', title: '이력서 초안', deadline: '2026-11-20', status: 'active', log: {} };
const periodCheck = {
  id: 'm2', kind: 'period', type: 'check', title: '매일 공고 보기',
  start: '2026-11-10', end: '2026-11-23', status: 'active',
  log: { '2026-11-10': true, '2026-11-11': true, '2026-11-12': false, '2026-11-13': true },
};
const periodNumber = {
  id: 'm3', kind: 'period', type: 'number', unit: '시간', goal: 20, title: '자격증 공부',
  start: '2026-11-01', end: '2026-11-30', status: 'active',
  log: { '2026-11-02': 3, '2026-11-05': 2 },
};

test('한 번 끝내는 미션: 완료 전 0%, 완료하면 100%', () => {
  assert.equal(missionProgress(once), 0);
  assert.equal(missionProgress({ ...once, status: 'done' }), 100);
});

test('기간 미션 체크형: 체크한 날 ÷ 전체 기간 일수', () => {
  // 11/10~11/23 = 14일, 체크 3일
  assert.equal(missionProgress(periodCheck), Math.round((3 / 14) * 100));
});

test('기간 미션 숫자형: 하루 몫(목표 ÷ 기간 일수)까지만 세서 ÷ 목표', () => {
  // 30일에 20시간 → 하루 몫 2/3시간. 3시간·2시간을 적어도 하루 2/3시간씩만 센다
  assert.equal(missionProgress(periodNumber), Math.round(((2 / 3) * 2 / 20) * 100));
});

test('기간 미션 숫자형: 하루에 몰아서 해도 완성처럼 보이지 않는다', () => {
  assert.equal(missionProgress({ ...periodNumber, log: { '2026-11-02': 30 } }), 3);
});

test('기간 미션 숫자형: 매일 하루 몫을 채우면 100%, 그 이상은 없다', () => {
  const log = {};
  for (let d = 1; d <= 30; d++) log[`2026-11-${String(d).padStart(2, '0')}`] = 5;
  assert.equal(missionProgress({ ...periodNumber, log }), 100);
});

test('마감일까지 남은 날 (D-day)', () => {
  assert.equal(dday(once, '2026-11-13'), 7);
  assert.equal(dday(periodCheck, '2026-11-13'), 10);
  assert.equal(dday(once, '2026-11-20'), 0);
});

test('마감이 지나고 진행 중이면 "기한 지남"이다', () => {
  assert.equal(missionState(once, '2026-11-20'), 'active');
  assert.equal(missionState(once, '2026-11-21'), 'overdue');
});

test('완료·중단한 미션은 날짜와 상관없이 그 상태다', () => {
  assert.equal(missionState({ ...once, status: 'done' }, '2026-12-31'), 'done');
  assert.equal(missionState({ ...once, status: 'stopped' }, '2026-11-13'), 'stopped');
});

test('오늘 기록할 수 있는 미션: 진행 중인 기간 미션이고 오늘이 기간 안', () => {
  assert.equal(isLoggableToday(periodCheck, '2026-11-13'), true);
  assert.equal(isLoggableToday(periodCheck, '2026-11-09'), false);
  assert.equal(isLoggableToday(periodCheck, '2026-11-24'), false);
  assert.equal(isLoggableToday(once, '2026-11-13'), false);
  assert.equal(isLoggableToday({ ...periodCheck, status: 'done' }, '2026-11-13'), false);
});

test('기간을 줄이면 기간 밖의 기록은 진행률에 세지 않는다', () => {
  // 11/10~11/12 (3일)로 줄임. 11/13 기록은 기간 밖
  const shortened = { ...periodCheck, end: '2026-11-12' };
  assert.equal(missionProgress(shortened), Math.round((2 / 3) * 100));
  const numberShort = { ...periodNumber, end: '2026-11-03' };
  assert.equal(missionProgress(numberShort), 15); // 11/02의 3시간만
});

// ---- 미션 카드의 오늘 체크박스 ----
import { missionCheck } from '../src/missions.js';

test('체크박스: 한 번 끝내는 미션은 완료 여부를 보여 준다', () => {
  assert.equal(missionCheck(once, '2026-11-13'), 'off');
  assert.equal(missionCheck({ ...once, status: 'done' }, '2026-11-13'), 'on');
  assert.equal(missionCheck({ ...once, status: 'stopped' }, '2026-11-13'), 'disabled');
});

test('체크박스: 기간 체크형은 그날 체크했는지 보여 준다', () => {
  assert.equal(missionCheck(periodCheck, '2026-11-13'), 'on');
  assert.equal(missionCheck(periodCheck, '2026-11-12'), 'off'); // false로 기록된 날
  assert.equal(missionCheck(periodCheck, '2026-11-14'), 'off'); // 기록 없는 날
});

test('체크박스: 기간 숫자형은 그날 0보다 큰 양을 적었으면 체크', () => {
  assert.equal(missionCheck(periodNumber, '2026-11-02'), 'on');
  assert.equal(missionCheck(periodNumber, '2026-11-03'), 'off');
  assert.equal(missionCheck({ ...periodNumber, log: { '2026-11-03': 0 } }, '2026-11-03'), 'off');
});

test('체크박스: 기간 밖이거나 진행 중이 아닌 기간 미션은 누를 수 없다', () => {
  assert.equal(missionCheck(periodCheck, '2026-11-09'), 'disabled');
  assert.equal(missionCheck(periodCheck, '2026-11-24'), 'disabled');
  assert.equal(missionCheck({ ...periodCheck, status: 'done' }, '2026-11-13'), 'disabled');
});

// ---- 하루 몫, 완료·지운 미션 목록 ----
import { dailyShare, completedMissions, deletedMissions } from '../src/missions.js';

test('하루 몫 = 기간 숫자형 목표 ÷ 기간 일수', () => {
  assert.equal(dailyShare(periodNumber), 20 / 30);
});

test('지운 미션은 오늘 기록할 수 없고 체크박스도 누를 수 없다', () => {
  const gone = { ...periodCheck, deletedAt: '2026-11-13' };
  assert.equal(isLoggableToday(gone, '2026-11-13'), false);
  assert.equal(missionCheck(gone, '2026-11-13'), 'disabled');
  assert.equal(missionCheck({ ...once, deletedAt: '2026-11-13' }, '2026-11-13'), 'disabled');
});

test('완료한 미션 목록: 상태가 완료이고 진행도 100%인 것만, 지운 것은 빼고', () => {
  const doneOnce = { ...once, id: 'a', status: 'done' };
  const doneButShort = { ...periodNumber, id: 'b', status: 'done' }; // 진행도 7%
  const goneDone = { ...once, id: 'c', status: 'done', deletedAt: '2026-11-13' };
  assert.deepEqual(completedMissions([doneOnce, doneButShort, goneDone, once]).map((m) => m.id), ['a']);
});

test('지운 미션 목록: 최근에 지운 것부터', () => {
  const a = { ...once, id: 'a', deletedAt: '2026-11-10' };
  const b = { ...once, id: 'b', deletedAt: '2026-11-12' };
  assert.deepEqual(deletedMissions([a, once, b]).map((m) => m.id), ['b', 'a']);
});
