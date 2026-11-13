// 날짜 계산. 날짜는 모두 'YYYY-MM-DD' 문자열(기기 시계 기준)로 다룬다.

const pad = (n) => String(n).padStart(2, '0');
const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

export function toKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function fromKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(key, n) {
  const date = fromKey(key);
  date.setDate(date.getDate() + n);
  return toKey(date);
}

export function daysBetween(from, to) {
  return Math.round((fromKey(to) - fromKey(from)) / 86400000);
}

// 월요일 시작 한 주
export function weekKeys(key) {
  const offset = (fromKey(key).getDay() + 6) % 7; // 월=0 … 일=6
  const monday = addDays(key, -offset);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

export function formatKo(key) {
  return `${key} (${DAY_NAMES[fromKey(key).getDay()]})`;
}

// 오늘과 어제만 기록할 수 있다
export function canEdit(key, today) {
  const diff = daysBetween(key, today);
  return diff === 0 || diff === 1;
}

// 요일 번호: 0=일 1=월 … 6=토
export function weekday(key) {
  return fromKey(key).getDay();
}
