// 휠 선택기 계산: 끝 다음에 다시 처음이 오는 순환, 끌기 속도에 따른 반동

// 값 목록을 이만큼 이어 붙여 보여 준다. 가운데 묶음에 머물도록 멈출 때마다 옮긴다
export const COPIES = 3;

export const wrapValue = (index, count) => ((index % count) + count) % count;

export const middleIndex = (value, count) => count + wrapValue(value, count);

// 놓을 때의 속도(px/ms, +는 아래로 굴림)만큼 더 미끄러진 뒤 가장 가까운 칸에 멈출 위치(px)
const GLIDE_MS = 320;   // 속도 1px/ms면 320px 더 간다 (프레임마다 0.95씩 줄어드는 감속과 같은 거리)
const MAX_ROWS = 30;
export function glideTarget(top, velocity, row) {
  const extra = Math.max(-MAX_ROWS * row, Math.min(MAX_ROWS * row, velocity * GLIDE_MS));
  return Math.round((top + extra) / row) * row;
}
