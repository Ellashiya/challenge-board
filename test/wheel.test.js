import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COPIES, wrapValue, middleIndex, glideTarget } from '../src/wheel.js';

// 휠은 값 목록을 COPIES(3)번 이어 붙여, 끝 다음에 다시 처음이 오게 한다
test('칸 번호를 값으로: 최대값 다음은 최소값', () => {
  assert.equal(wrapValue(59, 60), 59);
  assert.equal(wrapValue(60, 60), 0);   // 59분 바로 다음 칸은 0분
  assert.equal(wrapValue(61, 60), 1);
  assert.equal(wrapValue(-1, 60), 59);  // 0분 바로 앞 칸은 59분
  assert.equal(wrapValue(24 * 3 - 1, 24), 23);
});

test('같은 값의 가운데 묶음 칸 번호 (끝까지 가도 다시 가운데로 옮겨 계속 돌 수 있게)', () => {
  assert.equal(COPIES, 3);
  assert.equal(middleIndex(0, 60), 60);
  assert.equal(middleIndex(59, 60), 119);
  assert.equal(middleIndex(5, 24), 29);
});

test('반동: 멈춘 채 놓으면 가장 가까운 칸', () => {
  assert.equal(glideTarget(100, 0, 36), 108);  // 100px → 3번째 칸(108)
  assert.equal(glideTarget(80, 0, 36), 72);
});

test('반동: 빠르게 밀수록 더 멀리 간다 (속도 px/ms)', () => {
  const slow = glideTarget(360, 0.3, 36);
  const fast = glideTarget(360, 1.5, 36);
  assert.ok(fast > slow && slow > 360, `${slow}, ${fast}`);
  assert.equal(fast % 36, 0);               // 항상 칸에 맞춰 멈춘다
  assert.ok(glideTarget(360, -1.5, 36) < 360); // 반대 방향
});

test('반동: 아주 세게 밀어도 한 번에 너무 멀리 가지 않는다 (최대 30칸)', () => {
  assert.ok(glideTarget(0, 100, 36) <= 30 * 36);
  assert.ok(glideTarget(0, -100, 36) >= -30 * 36);
});
