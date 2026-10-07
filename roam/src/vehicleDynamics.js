import { ITEMS } from "./cosmeticsCatalog.js";

// Shape, not paint or rarity, determines handling. Used by both client and
// server; an unknown/spray/trail ID never supplies its own physics values.
const rows = [
  [
    "jeep",
    "지프 · 균형형",
    "가속과 코너링이 균형 잡힌 기본형",
    6.8,
    13,
    9,
    1,
    1,
    1,
    1,
  ],
  [
    "buggy",
    "버기 · 경량형",
    "민첩하게 꺾이지만 충돌에는 쉽게 밀려요",
    7.1,
    13.6,
    10.5,
    1.16,
    0.96,
    0.76,
    1.22,
  ],
  [
    "van",
    "밴 · 묵직한 안정형",
    "출발은 느려도 차체가 무거워 잘 버텨요",
    5.9,
    11.7,
    7.4,
    0.8,
    1.15,
    1.55,
    0.78,
  ],
  [
    "sport",
    "스포츠 · 속도형",
    "빠른 직선 주행, 가벼운 차체로 충돌 주의",
    8.1,
    15,
    10.6,
    0.96,
    1.12,
    0.87,
    1.12,
  ],
  [
    "pickup",
    "픽업 · 중량형",
    "넓은 회전과 강한 충돌 버팀",
    6.3,
    12.4,
    8.2,
    0.88,
    1.06,
    1.4,
    0.84,
  ],
  [
    "roadster",
    "로드스터 · 민첩형",
    "빠른 출발과 가벼운 핸들링",
    7.6,
    14.1,
    11,
    1.12,
    1.05,
    0.8,
    1.18,
  ],
  [
    "rally",
    "랠리 · 접지형",
    "빠르게 방향을 잡고 충돌 뒤에도 안정적",
    7.4,
    14,
    10.1,
    1.06,
    1.3,
    1.12,
    0.9,
  ],
  [
    "muscle",
    "머슬 · 직선형",
    "직선은 강력하지만 방향 전환은 느긋하게",
    8.3,
    15.3,
    9.8,
    0.82,
    0.78,
    1.25,
    0.92,
  ],
  [
    "formula",
    "포뮬러 · 코너형",
    "정밀한 코너링, 가벼워 충돌에는 취약해요",
    8.4,
    15.4,
    11.8,
    1.2,
    1.35,
    0.7,
    1.28,
  ],
  [
    "monster",
    "크롤러 · 최중량형",
    "느리지만 가장 무거워 몸싸움에 강해요",
    5.6,
    11.4,
    7.1,
    0.74,
    0.88,
    1.8,
    0.68,
  ],
  [
    "apex",
    "아펙스 · 트랙 특화",
    "접지와 가속이 뛰어난 와이드 GT",
    9,
    16.1,
    12.4,
    1.12,
    1.32,
    0.88,
    1.1,
  ],
  [
    "venom",
    "베놈 · 최고속 특화",
    "가장 빠른 직선, 코너에서는 감속이 필요해요",
    9.4,
    16.6,
    12,
    0.84,
    0.84,
    0.83,
    1.22,
  ],
  [
    "aurora-gt",
    "오로라 · 안정 특화",
    "안정적인 접지와 무게를 갖춘 그랜드 투어러",
    8.7,
    15.8,
    11.8,
    1.04,
    1.28,
    1.18,
    0.88,
  ],
  [
    "solstice",
    "솔스티스 · 가속 특화",
    "가장 경쾌한 출발, 가벼운 오픈 스포츠카",
    8.8,
    16,
    13,
    1.18,
    1.12,
    0.72,
    1.26,
  ],
  [
    "phantom",
    "팬텀 · 고속 안정형",
    "차분한 조향과 묵직한 고속 주행",
    9.2,
    16.3,
    11.5,
    0.94,
    1.2,
    1.08,
    0.94,
  ],
];
export const VEHICLE_PROFILES = Object.freeze(
  Object.fromEntries(
    rows.map(
      ([
        style,
        label,
        description,
        topSpeed,
        boostSpeed,
        acceleration,
        steering,
        grip,
        mass,
        bounce,
      ]) => [
        style,
        Object.freeze({
          style,
          label,
          description,
          topSpeed,
          boostSpeed,
          acceleration,
          steering,
          grip,
          mass,
          bounce,
        }),
      ],
    ),
  ),
);
const bodies = new Map(
  ITEMS.filter((item) => item.type === "body").map((item) => [item.id, item]),
);
export function getVehicleProfile(body) {
  const item = bodies.get(typeof body === "string" ? body : body?.id);
  return VEHICLE_PROFILES[item?.style] || VEHICLE_PROFILES.jeep;
}

/** Analytic acceleration/drag keeps the feel stable at different frame rates. */
export function advanceDriveSpeed(
  speed,
  { throttle = 0, brake = false, boost = false, boostedByPad = false },
  dt,
  profile,
) {
  if (!Number.isFinite(dt) || dt <= 0) return speed;
  const input = Math.max(-1, Math.min(1, throttle));
  const drag = brake
    ? 9 * profile.grip
    : boostedByPad
      ? 0.3
      : input
        ? boost
          ? 0.85
          : 1.1
        : 2 * profile.grip;
  const acceleration = brake
    ? 0
    : input * profile.acceleration * (boost ? 1.65 : 1);
  const decay = Math.exp(-drag * dt);
  const next = speed * decay + (acceleration / drag) * (1 - decay);
  const limit = boost ? profile.boostSpeed : profile.topSpeed;
  const bounded = Math.max(
    -Math.min(5, profile.topSpeed * 0.65),
    Math.min(limit, next),
  );
  return Math.abs(bounded) < 0.015 ? 0 : bounded;
}

export function smoothSteering(current, target, dt, profile) {
  return current + (target - current) * (1 - Math.exp(-12 * profile.grip * dt));
}

export function obstacleResponse(speed, jumpVelocity, profile) {
  return {
    speed: speed * profile.bounce,
    jumpVelocity: jumpVelocity * Math.sqrt(profile.bounce),
  };
}
