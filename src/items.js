// 매일 항목 집계
import { addDays, weekKeys } from './dates.js';
import { isLoggableToday, missionCheck } from './missions.js';

export function isDone(item, value) {
  if (item.type === 'number') return typeof value === 'number' && value >= item.goal;
  return value === true;
}

const activeItems = (state) => state.items.filter((i) => !i.archived);
const valueOn = (records, key, id) => records[key]?.[id];

// 매일 할 일 + 그날 기록할 수 있는 기간 미션(홈 "오늘의 미션")을 함께 센다.
// 미션 달성 기준은 미션 카드 체크박스와 같다 (체크형: 체크, 숫자형: 0보다 큰 양).
export function todayProgress(state, today) {
  const items = activeItems(state);
  const missions = (state.missions ?? []).filter((m) => isLoggableToday(m, today));
  const done = items.filter((i) => isDone(i, valueOn(state.records, today, i.id))).length +
    missions.filter((m) => missionCheck(m, today) === 'on').length;
  return { done, total: items.length + missions.length };
}

export function weekSummary(state, today) {
  const week = weekKeys(today);
  return activeItems(state).map((item) => {
    const values = week.map((k) => valueOn(state.records, k, item.id));
    const doneDays = values.filter((v) => isDone(item, v)).length;
    if (item.type !== 'number') return { id: item.id, name: item.name, type: item.type, doneDays };
    // 진행도(total)는 하루 목표까지만 센다. 실제로 한 양은 rawTotal
    const nums = values.map((v) => (typeof v === 'number' ? v : 0));
    const total = nums.reduce((sum, v) => sum + Math.min(v, item.goal), 0);
    const rawTotal = nums.reduce((sum, v) => sum + v, 0);
    return {
      id: item.id, name: item.name, type: item.type, unit: item.unit,
      doneDays, total, rawTotal, weekGoal: item.goal * 7,
    };
  });
}

// 오늘 했으면 오늘부터, 아직 안 했으면 어제부터 거꾸로 센다
export function streak(item, records, today) {
  let key = isDone(item, valueOn(records, today, item.id)) ? today : addDays(today, -1);
  let count = 0;
  while (isDone(item, valueOn(records, key, item.id))) {
    count++;
    key = addDays(key, -1);
  }
  return count;
}
