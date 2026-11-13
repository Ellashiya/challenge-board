import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatMinutes, splitMinutes } from '../src/format.js';

test('분을 "1시간 25분" 형식으로 보여 준다', () => {
  assert.equal(formatMinutes(85), '1시간 25분');
  assert.equal(formatMinutes(45), '45분');
  assert.equal(formatMinutes(120), '2시간');
  assert.equal(formatMinutes(0), '0분');
});

test('분이 소수면 반올림해서 보여 준다 (하루 몫 등)', () => {
  assert.equal(formatMinutes(54.5), '55분');
  assert.equal(formatMinutes(59.6), '1시간');
});

test('기록이 없으면 빈 글자', () => {
  assert.equal(formatMinutes(undefined), '');
});

test('분을 휠 선택기용 시·분으로 나눈다', () => {
  assert.deepEqual(splitMinutes(85), { h: 1, m: 25 });
  assert.deepEqual(splitMinutes(0), { h: 0, m: 0 });
  assert.deepEqual(splitMinutes(undefined), { h: 0, m: 0 });
});
