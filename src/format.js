// 시간형 숫자(분)를 사람이 읽는 글자로

export function formatMinutes(min) {
  if (typeof min !== 'number') return '';
  const total = Math.round(min);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (!h) return `${m}분`;
  return m ? `${h}시간 ${m}분` : `${h}시간`;
}

// 휠 선택기용
export function splitMinutes(min) {
  const total = typeof min === 'number' ? Math.round(min) : 0;
  return { h: Math.floor(total / 60), m: total % 60 };
}
