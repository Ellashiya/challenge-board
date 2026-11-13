import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toKey, addDays, daysBetween, weekKeys, formatKo, canEdit } from '../src/dates.js';

test('날짜를 YYYY-MM-DD로 바꾼다 (한 자리는 0을 붙임)', () => {
  assert.equal(toKey(new Date(2026, 0, 5)), '2026-01-05');
});

test('자정에 다음 날로 넘어간다', () => {
  assert.equal(toKey(new Date(2026, 10, 13, 23, 59)), '2026-11-13');
  assert.equal(toKey(new Date(2026, 10, 14, 0, 0)), '2026-11-14');
});

test('날짜를 더하고 뺀다 (달·해 넘김 포함)', () => {
  assert.equal(addDays('2026-11-30', 1), '2026-12-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
});

test('두 날짜 사이 일수를 센다', () => {
  assert.equal(daysBetween('2026-11-13', '2026-11-20'), 7);
  assert.equal(daysBetween('2026-11-13', '2026-11-13'), 0);
  assert.equal(daysBetween('2026-11-13', '2026-11-10'), -3);
});

test('한 주는 월요일부터 일요일까지다', () => {
  const week = weekKeys('2026-11-13'); // 금요일
  assert.equal(week.length, 7);
  assert.equal(week[0], '2026-11-09'); // 월
  assert.equal(week[6], '2026-11-15'); // 일
});

test('일요일은 그 주의 마지막 날이다', () => {
  assert.equal(weekKeys('2026-11-15')[0], '2026-11-09');
});

test('월요일은 새 주의 첫날이다', () => {
  assert.equal(weekKeys('2026-11-16')[0], '2026-11-16');
});

test('날짜를 "2026-11-13 (금)" 형식으로 보여 준다', () => {
  assert.equal(formatKo('2026-11-13'), '2026-11-13 (금)');
});

test('오늘과 어제만 기록할 수 있다', () => {
  assert.equal(canEdit('2026-11-13', '2026-11-13'), true);
  assert.equal(canEdit('2026-11-12', '2026-11-13'), true);
  assert.equal(canEdit('2026-11-11', '2026-11-13'), false);
  assert.equal(canEdit('2026-11-14', '2026-11-13'), false);
});
