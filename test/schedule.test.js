import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weekday } from '../src/dates.js';
import {
  isScheduled, isLoggableToday, missionProgress, dailyShare, dday, missionState, matchesFilter, scheduleText,
} from '../src/missions.js';
import { emptyState, addMission, editMission, migrate } from '../src/store.js';

// 요일 번호: 0=일 1=월 … 6=토 (자바스크립트 Date와 같음)
const MWF = [1, 3, 5];
const ALL = [0, 1, 2, 3, 4, 5, 6];

test('요일 번호 (2026-11-13은 금요일)', () => {
  assert.equal(weekday('2026-11-13'), 5);
  assert.equal(weekday('2026-11-15'), 0);
});

// 2주 동안(11/09 월 ~ 11/22 일) 월·수·금 = 6일
const mwfCheck = {
  id: 'a', kind: 'period', repeat: 'period', type: 'check', days: MWF, title: '면접 연습',
  start: '2026-11-09', end: '2026-11-22', status: 'active', log: {}, notes: {},
};

test('고른 요일에만 하는 날이다', () => {
  assert.equal(isScheduled(mwfCheck, '2026-11-13'), true);  // 금
  assert.equal(isScheduled(mwfCheck, '2026-11-14'), false); // 토
  assert.equal(isScheduled({ ...mwfCheck, days: undefined }, '2026-11-14'), true); // 요일이 없으면 매일
});

test('오늘의 미션에는 고른 요일에만 나온다', () => {
  assert.equal(isLoggableToday(mwfCheck, '2026-11-13'), true);
  assert.equal(isLoggableToday(mwfCheck, '2026-11-14'), false);
});

test('기간 체크형 진행률: 고른 요일 수로 나눈다 (2주 월·수·금 = 6일)', () => {
  const log = { '2026-11-09': true, '2026-11-11': true, '2026-11-13': true, '2026-11-14': true }; // 토요일 기록은 세지 않음
  assert.equal(missionProgress({ ...mwfCheck, log }), 50);
});

test('기간 숫자형 하루 몫: 목표 ÷ 고른 요일 수', () => {
  const m = { ...mwfCheck, type: 'number', measure: 'time', unit: '분', goal: 600 };
  assert.equal(dailyShare(m), 100);
  assert.equal(missionProgress({ ...m, log: { '2026-11-09': 300, '2026-11-11': 100 } }), Math.round((200 / 600) * 100));
});

// 매주 반복: 마감 없음, 진행률은 이번 주(월~일) 기준, 숫자형 목표는 하루 목표
const weeklyCheck = {
  id: 'w', kind: 'period', repeat: 'weekly', type: 'check', days: MWF, title: '이력서 점검',
  start: '2026-11-01', end: null, status: 'active', log: {}, notes: {},
};

test('매주 반복: 시작일 뒤 고른 요일이면 언제든 기록할 수 있다', () => {
  assert.equal(isLoggableToday(weeklyCheck, '2026-11-13'), true);
  assert.equal(isLoggableToday(weeklyCheck, '2027-03-05'), true);  // 금
  assert.equal(isLoggableToday(weeklyCheck, '2026-10-30'), false); // 시작 전
});

test('매주 반복 체크형 진행률: 이번 주 고른 요일 중 한 날', () => {
  const log = { '2026-11-06': true, '2026-11-09': true, '2026-11-13': true }; // 지난주 금요일은 세지 않음
  assert.equal(missionProgress({ ...weeklyCheck, log }, '2026-11-13'), Math.round((2 / 3) * 100));
});

test('매주 반복 숫자형: 하루 목표까지만 세서 이번 주 진행률', () => {
  const m = { ...weeklyCheck, type: 'number', measure: 'time', unit: '분', goal: 30 };
  assert.equal(dailyShare(m), 30);
  const log = { '2026-11-09': 30, '2026-11-11': 90, '2026-11-14': 30 }; // 수요일 초과분, 토요일(안 고른 날)은 빼고
  assert.equal(missionProgress({ ...m, log }, '2026-11-13'), Math.round((60 / 90) * 100));
});

test('매주 반복은 마감이 없어서 D-day도 기한 지남도 없다', () => {
  assert.equal(dday(weeklyCheck, '2026-11-13'), null);
  assert.equal(missionState(weeklyCheck, '2027-01-01'), 'active');
});

test('일정 글자', () => {
  assert.equal(scheduleText(mwfCheck), '월·수·금');
  assert.equal(scheduleText({ ...mwfCheck, days: ALL }), '매일');
  assert.equal(scheduleText({ ...mwfCheck, days: [1, 2, 3, 4, 5] }), '평일');
  assert.equal(scheduleText({ ...mwfCheck, days: [0, 6] }), '주말');
});

test('필터: 전체 / 매일 / 요일 (한 번 끝내는 미션은 전체에만)', () => {
  const daily = { ...mwfCheck, id: 'd', days: ALL };
  const once = { id: 'o', kind: 'once', title: 'x', deadline: '2026-11-20', status: 'active', log: {}, notes: {} };
  const ids = (f) => [mwfCheck, daily, weeklyCheck, once].filter((m) => matchesFilter(m, f)).map((m) => m.id);
  assert.deepEqual(ids('all'), ['a', 'd', 'w', 'o']);
  assert.deepEqual(ids('daily'), ['d']);
  assert.deepEqual(ids(5), ['a', 'd', 'w']); // 금요일에 하는 미션 (매일 포함)
  assert.deepEqual(ids(2), ['d']);           // 화요일
});

test('미션 추가: 요일과 반복을 저장한다', () => {
  const s = addMission(emptyState(), { kind: 'period', type: 'check', repeat: 'weekly', days: [5, 1, 3], title: '점검', start: '2026-11-13' }, 'm');
  assert.deepEqual(s.missions[0].days, [1, 3, 5]); // 정렬
  assert.equal(s.missions[0].repeat, 'weekly');
  assert.equal(s.missions[0].end, null);
});

test('미션 추가: 요일을 하나도 안 고르면 거부, 안 주면 매일', () => {
  assert.throws(() => addMission(emptyState(), { kind: 'period', type: 'check', days: [], title: 'x', start: '2026-11-01', end: '2026-11-30' }, 'm'));
  const s = addMission(emptyState(), { kind: 'period', type: 'check', title: 'x', start: '2026-11-01', end: '2026-11-30' }, 'm');
  assert.deepEqual(s.missions[0].days, ALL);
  assert.equal(s.missions[0].repeat, 'period');
});

test('미션 수정: 요일을 바꿀 수 있다', () => {
  let s = addMission(emptyState(), { kind: 'period', type: 'check', title: 'x', start: '2026-11-01', end: '2026-11-30' }, 'm');
  s = editMission(s, 'm', { days: [2, 4] });
  assert.deepEqual(s.missions[0].days, [2, 4]);
  assert.throws(() => editMission(s, 'm', { days: [] }));
});

test('버전 2 → 3: 기간 미션은 매일 · 기간 동안으로', () => {
  const v2 = {
    version: 2, items: [], records: {}, lastBackup: null,
    missions: [
      { id: 'p', kind: 'period', type: 'check', title: 'x', start: '2026-11-01', end: '2026-11-30', status: 'active', log: {}, notes: {} },
      { id: 'o', kind: 'once', title: 'y', deadline: '2026-11-20', status: 'active', log: {}, notes: {} },
    ],
  };
  const s = migrate(v2);
  assert.equal(s.version, 3);
  assert.deepEqual(s.missions[0].days, ALL);
  assert.equal(s.missions[0].repeat, 'period');
  assert.equal(s.missions[1].days, undefined);
  assert.equal(v2.missions[0].days, undefined); // 원래 데이터는 그대로
});

// ---- 개수형 체크박스: 누르면 하루 몫을 채운다 ----
import { fillAmount } from '../src/missions.js';

test('체크로 채울 양: 기간 개수형은 하루 몫을 올림한 정수', () => {
  const m = { ...mwfCheck, type: 'number', measure: 'count', unit: '문제', goal: 20 }; // 6일 → 하루 3.33
  assert.equal(fillAmount(m), 4);
});

test('체크로 채울 양: 매주 반복 개수형은 하루 목표 그대로', () => {
  const m = { ...weeklyCheck, type: 'number', measure: 'count', unit: '개', goal: 15 };
  assert.equal(fillAmount(m), 15);
});

test('체크로 채울 양: 최소 1', () => {
  const m = { ...mwfCheck, type: 'number', measure: 'count', unit: '권', goal: 1 };
  assert.equal(fillAmount(m), 1);
});

// ---- 달력에서 고른 날 보기: 그날 일정이었던 미션 (상태와 상관없이) ----
import { isPlannedOn } from '../src/missions.js';

test('그날 일정: 기간 안의 고른 요일이면 완료·중단한 미션도 보인다 (지난 기록 보기)', () => {
  assert.equal(isPlannedOn(mwfCheck, '2026-11-11'), true);                       // 수
  assert.equal(isPlannedOn({ ...mwfCheck, status: 'done' }, '2026-11-11'), true);
  assert.equal(isPlannedOn({ ...mwfCheck, status: 'stopped' }, '2026-11-11'), true);
  assert.equal(isPlannedOn(mwfCheck, '2026-11-12'), false);                      // 목: 안 고른 요일
  assert.equal(isPlannedOn(mwfCheck, '2026-11-25'), false);                      // 기간 밖
});

test('그날 일정: 매주 반복은 시작일 뒤 고른 요일이면 앞날도 보인다 (다음 날 미리 보기)', () => {
  assert.equal(isPlannedOn(weeklyCheck, '2026-12-04'), true);  // 금
  assert.equal(isPlannedOn(weeklyCheck, '2026-10-30'), false); // 시작 전
});

test('그날 일정: 지운 미션과 한 번 끝내는 미션은 안 보인다', () => {
  assert.equal(isPlannedOn({ ...mwfCheck, deletedAt: '2026-11-13' }, '2026-11-11'), false);
  assert.equal(isPlannedOn({ id: 'o', kind: 'once', title: 'x', deadline: '2026-11-20', status: 'active', log: {}, notes: {} }, '2026-11-11'), false);
});
