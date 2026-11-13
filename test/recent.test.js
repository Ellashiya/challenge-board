import { test } from 'node:test';
import assert from 'node:assert/strict';
import { doneOn, splitPast } from '../src/missions.js';
import { emptyState, addMission, setMissionStatus } from '../src/store.js';

const T = '2026-11-13';
const once = (id, extra) => ({ id, kind: 'once', title: id, deadline: '2026-11-10', status: 'done', log: {}, notes: {}, ...extra });

test('완료를 누르면 그날을 저장하고, 다시 진행하면 지운다', () => {
  let s = addMission(emptyState(), { kind: 'once', title: 'x', deadline: '2026-11-20' }, 'm');
  s = setMissionStatus(s, 'm', 'done', T);
  assert.equal(s.missions[0].doneAt, T);
  s = setMissionStatus(s, 'm', 'active', T);
  assert.equal('doneAt' in s.missions[0], false);
});

test('완료한 날: 저장된 날이 없으면 마감일(기간 미션은 끝나는 날)로 본다', () => {
  assert.equal(doneOn(once('a', { doneAt: '2026-11-12' })), '2026-11-12');
  assert.equal(doneOn(once('b')), '2026-11-10');
  assert.equal(doneOn({ id: 'p', kind: 'period', start: '2026-11-01', end: '2026-11-09', status: 'done', log: {} }), '2026-11-09');
  assert.equal(doneOn({ id: 'w', kind: 'period', repeat: 'weekly', start: '2026-11-01', end: null, status: 'done', log: {} }), '2026-11-01');
});

test('지난 미션 나누기: 최근 7일 안에 완료한 것만 바로 보이고, 나머지는 "더 보기"', () => {
  const missions = [
    once('today', { doneAt: '2026-11-13' }),
    once('six', { doneAt: '2026-11-07' }),   // 6일 전: 보임
    once('seven', { doneAt: '2026-11-06' }), // 7일 전: 더 보기
    once('early', { deadline: '2026-11-30' }), // 날짜 없이 마감 전에 완료: 보임
    once('stop', { status: 'stopped' }),     // 중단: 더 보기
    once('gone', { doneAt: '2026-11-13', deletedAt: '2026-11-13' }), // 지운 것: 없음
    { ...once('live'), status: 'active' },   // 진행 중: 없음
  ];
  const { recent, older } = splitPast(missions, T);
  assert.deepEqual(recent.map((m) => m.id), ['today', 'six', 'early']);
  assert.deepEqual(older.map((m) => m.id), ['seven', 'stop']);
});
