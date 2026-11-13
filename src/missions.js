// 미션 진행률과 상태
import { daysBetween, addDays, weekKeys, weekday } from './dates.js';

export const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];
const daysOf = (m) => m.days ?? ALL_DAYS;
const isWeekly = (m) => m.repeat === 'weekly';
const endOf = (m) => (m.kind === 'once' ? m.deadline : m.end);

// 고른 요일에 하는 날인가 (요일이 없으면 매일)
export const isScheduled = (m, day) => daysOf(m).includes(weekday(day));

// 진행률을 셀 날짜들: 기간 미션은 기간 안의 고른 요일, 매주 반복은 이번 주(월~일)의 고른 요일
function countedDays(m, today) {
  if (isWeekly(m)) return weekKeys(today).filter((d) => d >= m.start && isScheduled(m, d));
  const days = [];
  for (let d = m.start; d <= m.end; d = addDays(d, 1)) if (isScheduled(m, d)) days.push(d);
  return days;
}

// 숫자형 미션의 하루 몫: 기간 미션은 전체 목표 ÷ 고른 요일 수, 매주 반복은 목표 자체가 하루 목표
export function dailyShare(m) {
  if (isWeekly(m)) return m.goal;
  return m.goal / countedDays(m).length;
}

export function missionProgress(m, today) {
  if (m.kind === 'once') return m.status === 'done' ? 100 : 0;
  const days = countedDays(m, today);
  if (!days.length) return 0;
  const values = days.map((d) => m.log[d]);
  if (m.type === 'number') {
    // 하루에 몰아서 해도 완성처럼 보이지 않도록 하루 몫까지만 센다
    const share = dailyShare(m);
    const total = values.reduce((sum, v) => sum + (typeof v === 'number' ? Math.min(v, share) : 0), 0);
    const goal = isWeekly(m) ? share * days.length : m.goal;
    return Math.min(100, Math.round((total / goal) * 100));
  }
  return Math.round((values.filter((v) => v === true).length / days.length) * 100);
}

// 마감까지 남은 날. 매주 반복은 마감이 없어서 null
export function dday(m, today) {
  const end = endOf(m);
  return end ? daysBetween(today, end) : null;
}

// 'active' | 'overdue' | 'done' | 'stopped'
export function missionState(m, today) {
  if (m.status !== 'active') return m.status;
  const d = dday(m, today);
  return d !== null && d < 0 ? 'overdue' : 'active';
}

export function isLoggableToday(m, today) {
  if (m.kind !== 'period' || m.status !== 'active' || m.deletedAt) return false;
  if (today < m.start || (!isWeekly(m) && today > m.end)) return false;
  return isScheduled(m, today);
}

// 미션 카드의 그날 체크박스: 'on' | 'off' | 'disabled'
// 한 번 미션은 완료 여부, 기간 미션은 그날 기록(체크형: 체크, 숫자형: 0보다 큰 양)
export function missionCheck(m, day) {
  if (m.kind === 'once') {
    if (m.status === 'stopped' || m.deletedAt) return 'disabled';
    return m.status === 'done' ? 'on' : 'off';
  }
  if (!isLoggableToday(m, day)) return 'disabled';
  const v = m.log[day];
  const done = m.type === 'number' ? typeof v === 'number' && v > 0 : v === true;
  return done ? 'on' : 'off';
}

// "월·수·금", "매일", "평일", "주말"
export function scheduleText(m) {
  const d = [...daysOf(m)].sort();
  if (d.length === 7) return '매일';
  if (d.join() === '1,2,3,4,5') return '평일';
  if (d.join() === '0,6') return '주말';
  return [...d.filter((x) => x), ...d.filter((x) => !x)].map((x) => DAY_NAMES[x]).join('·'); // 월요일부터
}

// 미션 탭 필터: 'all' | 'daily' | 요일 번호(0~6). 요일 필터에는 그 요일에 하는 미션(매일 포함)
export function matchesFilter(m, filter) {
  if (filter === 'all') return true;
  if (m.kind !== 'period') return false;
  if (filter === 'daily') return daysOf(m).length === 7;
  return daysOf(m).includes(filter);
}

// 설정 화면 목록
export const completedMissions = (missions, today) =>
  missions.filter((m) => !m.deletedAt && m.status === 'done' && missionProgress(m, today) >= 100);

export const deletedMissions = (missions) =>
  missions.filter((m) => m.deletedAt).sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));

// 개수형 미션 체크박스를 누르면 채울 양: 하루 몫을 올림한 정수 (최소 1)
export function fillAmount(m) {
  return Math.max(1, Math.ceil(dailyShare(m) - 1e-9));
}

// 달력에서 고른 날 보기: 그날 일정이었던 기간 미션 (지금 상태와 상관없이, 지운 것만 뺀다)
export function isPlannedOn(m, day) {
  if (m.kind !== 'period' || m.deletedAt) return false;
  if (day < m.start || (!isWeekly(m) && day > m.end)) return false;
  return isScheduled(m, day);
}

// 완료한 날: 저장된 날(doneAt)이 없으면 마감일, 기간 미션은 끝나는 날(매주 반복은 시작일)로 본다
export function doneOn(m) {
  return m.doneAt ?? (m.kind === 'once' ? m.deadline : m.end ?? m.start);
}

// 미션 탭 "지난 미션": 최근 7일(오늘 포함) 안에 완료한 것은 바로, 그 밖의 완료·중단은 "더 보기"
export function splitPast(missions, today) {
  const past = missions.filter((m) => !m.deletedAt && (m.status === 'done' || m.status === 'stopped'));
  const isRecent = (m) => m.status === 'done' && daysBetween(doneOn(m), today) < 7;
  return { recent: past.filter(isRecent), older: past.filter((m) => !isRecent(m)) };
}
