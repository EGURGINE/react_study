import { useEffect, useState } from "react";
import {
  ArrowRight,
  CarFront,
  Check,
  Coins,
  Flag,
  Gift,
  LockKeyhole,
  Paintbrush,
  Sparkles,
  Wrench,
  Search,
  Heart,
  Leaf,
  Snowflake,
  Flame,
  Diamond,
  Zap,
  PartyPopper,
  Circle,
  Trophy,
  Users,
  Eye,
  Crown,
} from "lucide-react";
import { createSprayCanvas } from "./cosmeticsWorld.js";
import { getVehicleProfile } from "./vehicleDynamics.js";
import { getFuelEconomy } from "./fuelConfig.js";
import { ARENA } from "./arenaConfig.js";
import {
  CRATE_COST,
  DUPLICATE_REFUND,
  ITEMS,
  LAP_REWARD,
  RARITIES,
  STARTER_EQUIPPED,
  DUEL_LENGTH,
} from "./gameConfig.js";

const TYPES = [
  { id: "body", label: "차체", icon: CarFront },
  { id: "trail", label: "주행 이펙트", icon: Sparkles },
  { id: "spray", label: "스프레이", icon: Paintbrush },
];
const rarityOf = (item) =>
  RARITIES.find((rarity) => rarity.id === item.rarity) || RARITIES[0];
const number = (value = 0) => Number(value).toLocaleString("ko-KR");
const TRAIL_ICONS = {
  dust: Circle,
  bubbles: Circle,
  stars: Sparkles,
  rainbow: Sparkles,
  leaves: Leaf,
  sparks: Zap,
  hearts: Heart,
  snow: Snowflake,
  petals: Leaf,
  embers: Flame,
  diamonds: Diamond,
  confetti: PartyPopper,
};
const sprayPreviews = new Map();
function sprayPreview(item) {
  if (!sprayPreviews.has(item.id))
    sprayPreviews.set(item.id, createSprayCanvas(item).toDataURL("image/png"));
  return sprayPreviews.get(item.id);
}

const BODY_ART = {
  jeep: {
    body: "M18 39H39V23H79L88 39H103V53H18Z",
    glass: "M45 27H60V39H45ZM64 27H76L81 39H64Z",
  },
  buggy: {
    body: "M16 43L32 37H41L47 45H76L84 34L103 42V53H16Z",
    glass: "M50 38H63V44H50Z",
  },
  van: {
    body: "M20 22H83L102 39V54H17V29Z",
    glass: "M27 27H50V40H27ZM56 27H80L91 40H56Z",
  },
  sport: {
    body: "M17 45L37 38L48 25H72L87 39L105 45V54H17Z",
    glass: "M46 37L52 29H70L79 37Z",
  },
  pickup: {
    body: "M16 36H52V23H82L103 40V54H16Z",
    glass: "M58 28H78L91 39H58Z",
  },
  roadster: {
    body: "M16 45L24 36H43L48 42H72L78 33L104 44V54H16Z",
    glass: "M72 39L78 26L82 27L80 40Z",
  },
  rally: {
    body: "M16 38L34 33L42 23H78L91 40L103 43V54H16Z",
    glass: "M40 34L46 27H61V38H39ZM66 27H75L84 38H66Z",
  },
  muscle: {
    body: "M13 38L37 35L49 24H67L79 35H103L107 42V54H13Z",
    glass: "M44 35L52 27H66L73 35Z",
  },
  formula: {
    body: "M13 39H35L43 32H61L74 41L105 45V51H43L30 47H13Z",
    glass: "M44 32L50 26H60L65 35H46Z",
  },
  monster: {
    body: "M18 29H39V15H75L87 30H101V42H18Z",
    glass: "M44 20H58V31H44ZM63 20H73L81 31H63Z",
  },
  apex: {
    body: "M11 46L32 39L49 28H69L83 37L109 45L104 54H12Z",
    glass: "M43 38L52 31H68L79 38Z",
  },
  venom: {
    body: "M12 37L35 39L50 27H72L86 38L108 46L104 54H13Z",
    glass: "M44 38L54 30H70L79 38Z",
  },
  "aurora-gt": {
    body: "M12 47Q22 37 37 38Q46 20 67 24Q78 25 88 39Q102 40 108 48L104 54H13Z",
    glass: "M43 37Q50 26 65 27Q74 27 82 38Z",
  },
  solstice: {
    body: "M11 46L20 30H39L47 39H65L76 31L108 43L106 54H12Z",
    glass: "M65 39L72 25L77 25L75 37Z",
  },
  phantom: {
    body: "M12 46L31 40L48 24H72L87 36L109 44L105 54H12Z",
    glass: "M41 39L51 27H70L83 39Z",
  },
  motorbike: {
    body: "M16 34L39 34L47 40L61 30L75 29L92 22L103 31L81 40L70 51L48 48L39 40L18 39Z",
    glass: "M80 27L84 15H90L94 23Z",
  },
  wedge: {
    body: "M10 42L32 37L51 25H74L88 37L111 47L107 55H11Z",
    glass: "M42 37L54 28H72L82 37Z",
  },
  limousine: {
    body: "M9 40H24L37 22H75L87 38H111V55H9Z",
    glass: "M31 37L42 26H57V37ZM62 26H72L80 37H62Z",
  },
};

function CarArt({ item }) {
  const art = BODY_ART[item.style] || BODY_ART.jeep;
  const monster = item.style === "monster";
  const formula = item.style === "formula";
  const motorbike = item.style === "motorbike";
  const wheelRadius = monster
    ? 15
    : motorbike
      ? 13
      : formula
        ? 12
        : item.style === "wedge"
          ? 10
          : 11;
  const wheelY = monster ? 55 : 56;
  const wheelX =
    formula || motorbike || item.style === "limousine" ? [27, 92] : [33, 89];
  const mythic = item.rarity === "mythic";
  return (
    <svg
      viewBox="0 0 120 75"
      className={`item-car ${mythic ? "mythic" : ""}`}
      aria-hidden="true"
    >
      <ellipse cx="61" cy="68" rx="45" ry="4" fill="#6b7751" opacity=".12" />
      {monster && (
        <path
          d="M25 42L41 56L58 42L79 56L95 42"
          fill="none"
          stroke="#53655a"
          strokeWidth="4"
        />
      )}
      {wheelX.map((x) => (
        <g key={x}>
          <circle cx={x} cy={wheelY} r={wheelRadius} fill="#354a42" />
          <circle
            cx={x}
            cy={wheelY}
            r={monster ? 7 : 5}
            fill={mythic ? "#b4d4d9" : "#c9d1b7"}
          />
          {mythic && (
            <circle
              cx={x}
              cy={wheelY}
              r="7.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            />
          )}
        </g>
      ))}
      <path d={art.body} fill="currentColor" />
      <path d={art.glass} fill={mythic ? "#304c66" : "#6f9389"} />
      {!monster && !motorbike && (
        <path
          d="M18 51H104"
          stroke={mythic ? "#b8ecf0" : "#f4f1d9"}
          strokeWidth={mythic ? 2 : 3}
        />
      )}
      <path
        d={monster ? "M93 34H101" : motorbike ? "M95 28L101 30" : "M98 44H105"}
        stroke="#fff8d6"
        strokeWidth="3"
      />
      {item.style === "jeep" && (
        <path d="M16 30V45M41 21H80" stroke="#506b59" strokeWidth="4" />
      )}
      {item.style === "buggy" && (
        <path
          d="M34 40L41 22H76L85 36M44 23L71 43"
          fill="none"
          stroke="#53745e"
          strokeWidth="3"
        />
      )}
      {item.style === "van" && (
        <path d="M24 46H44M54 25V49" stroke="#f5efd6" strokeWidth="2" />
      )}
      {item.style === "pickup" && (
        <path d="M20 40H47M55 43V50" stroke="#638777" strokeWidth="3" />
      )}
      {item.style === "roadster" && (
        <path
          d="M47 35V42M62 35V42M21 39H35"
          stroke="#7c5e4b"
          strokeWidth="4"
        />
      )}
      {item.style === "rally" && (
        <g fill="#fff1ba" stroke="#5d745d" strokeWidth="2">
          <rect x="42" y="16" width="10" height="7" rx="1" />
          <rect x="57" y="16" width="10" height="7" rx="1" />
          <rect x="72" y="16" width="10" height="7" rx="1" />
        </g>
      )}
      {item.style === "muscle" && (
        <g>
          <path d="M14 42H107" stroke="#4e5451" strokeWidth="3" />
          <path d="M81 34V29H93V35" fill="#526057" />
          <path d="M18 35V30H35" fill="none" stroke="#536658" strokeWidth="3" />
        </g>
      )}
      {formula && (
        <g fill="#485753">
          <rect x="11" y="24" width="6" height="17" />
          <rect x="8" y="22" width="25" height="5" />
          <rect x="96" y="43" width="16" height="5" />
          <path d="M49 45H75V50H49Z" />
        </g>
      )}
      {monster && (
        <path d="M43 14H77M19 40H99" stroke="#f0e8ba" strokeWidth="3" />
      )}
      {item.style === "apex" && (
        <g>
          <path
            d="M18 45L43 47L53 41M78 43L96 40"
            fill="none"
            stroke="#28788b"
            strokeWidth="3"
          />
          <path
            d="M13 34H35L42 38"
            fill="none"
            stroke="#465d66"
            strokeWidth="3"
          />
          <path d="M92 47H106" stroke="#d9ffff" strokeWidth="2" />
        </g>
      )}
      {item.style === "venom" && (
        <g fill="#59434e">
          <path d="M10 24H36V28H16V39H12Z" />
          <path d="M50 42L74 40L65 49H49Z" />
          <path
            d="M88 38L95 41M94 38L101 41"
            fill="none"
            stroke="#ffe2d4"
            strokeWidth="2"
          />
        </g>
      )}
      {item.style === "aurora-gt" && (
        <g fill="none">
          <path
            d="M20 43Q42 47 57 43T101 45"
            stroke="#d4ddff"
            strokeWidth="2"
          />
          <path d="M24 48Q52 52 75 45" stroke="#7366ba" strokeWidth="2" />
        </g>
      )}
      {item.style === "solstice" && (
        <g>
          <path d="M22 34L38 39L27 46Z" fill="#786147" />
          <path d="M56 43L76 39L71 48H56Z" fill="#786147" />
          <path d="M83 38L102 43" stroke="#fff1b7" strokeWidth="3" />
        </g>
      )}
      {item.style === "phantom" && (
        <g fill="none">
          <path
            d="M16 43L41 45L54 39L80 43L104 42"
            stroke="#c8d7ec"
            strokeWidth="2"
          />
          <path d="M48 26L64 37L71 27" stroke="#829dbc" strokeWidth="1.5" />
          <path d="M20 31H38" stroke="#34465b" strokeWidth="4" />
        </g>
      )}
      {motorbike && (
        <g fill="none" strokeLinecap="round" strokeLinejoin="round">
          <path
            d="M27 56L47 42L58 54L72 37L92 56"
            stroke="#45575b"
            strokeWidth="4"
          />
          <path
            d="M86 34L95 55M68 27L78 22H86"
            stroke="#d6e5de"
            strokeWidth="2.5"
          />
          <path d="M23 33H42L47 37" stroke="#5c5250" strokeWidth="5" />
          <path d="M35 53H55" stroke="#c7d7ce" strokeWidth="4" />
        </g>
      )}
      {item.style === "wedge" && (
        <g>
          <path d="M45 42L69 40L59 49H42Z" fill="#3b5351" />
          <path
            d="M85 39L103 46M91 39L107 45"
            stroke="#f2ffe3"
            strokeWidth="1.6"
          />
          <path
            d="M12 39H31M14 49L25 45M78 51H107"
            stroke="#43544b"
            strokeWidth="3"
          />
        </g>
      )}
      {item.style === "limousine" && (
        <g fill="none">
          <path d="M38 23H74" stroke="#e7e2d5" strokeWidth="4" />
          <path d="M60 27V48M28 41H104" stroke="#d6dfdc" strokeWidth="1.3" />
          <path
            d="M106 39V52M109 39V52M40 42H48M64 42H72"
            stroke="#eef2e8"
            strokeWidth="2"
          />
          <path d="M88 37H111" stroke="#d9e2df" strokeWidth="2" />
        </g>
      )}
    </svg>
  );
}

function VehicleStats({ item, equippedId }) {
  if (item.type !== "body") return null;
  const profile = { ...getVehicleProfile(item), ...getFuelEconomy(item.id) };
  const baseline = { ...getVehicleProfile(equippedId), ...getFuelEconomy(equippedId) };
  const metrics = [
    { key: "topSpeed", label: "최고속도", scale: 5, digits: 1 },
    { key: "acceleration", label: "가속력", scale: 1, digits: 1 },
    { key: "steering", label: "핸들링", scale: 1, digits: 2 },
    { key: "mass", label: "충돌 버팀", scale: 1, digits: 2, suffix: "×" },
    { key: "efficiency", label: "연료 효율", scale: 1, digits: 2, suffix: "×" },
    { key: "boostSeconds", label: "만충 가속", scale: 1, digits: 1, suffix: "초" },
  ];
  return (
    <div className="vehicle-profile">
      <span className="vehicle-character">{profile.label}</span>
      <p className="vehicle-description">{profile.description}</p>
      <dl
        className="vehicle-stats"
        aria-label={`${item.name} 주행 성능, 장착 차와 비교`}
      >
        {metrics.map(({ key, label, scale, digits, suffix = "" }) => {
          const value = profile[key] * scale;
          const difference = Number(
            ((profile[key] - baseline[key]) * scale).toFixed(digits),
          );
          const format = (number) =>
            number.toLocaleString("ko-KR", { maximumFractionDigits: digits });
          return (
            <div key={key}>
              <dt>{label}</dt>
              <dd>
                <b>
                  {format(value)}
                  {suffix}
                </b>
                <span
                  className={`vehicle-stat-delta ${difference > 0 ? "higher" : difference < 0 ? "lower" : "same"}`}
                  aria-label={`장착 차 대비 ${difference > 0 ? "+" : ""}${format(difference)}`}
                >
                  {difference
                    ? `${difference > 0 ? "+" : ""}${format(difference)}`
                    : "—"}
                </span>
              </dd>
            </div>
          );
        })}
      </dl>
      <p className="vehicle-description">
        Shift 초당 {profile.consumptionRate.toLocaleString("ko-KR", { maximumFractionDigits: 2 })} 연료 · 평소 주행과 가속 패드는 무료
      </p>
    </div>
  );
}

export function Wallet({ coins = 0, onClick, compact = false }) {
  return (
    <button
      className={`game-wallet ${compact ? "compact" : ""}`}
      onClick={onClick}
      aria-label={`보유 코인 ${number(coins)}개, 정비소 열기`}
    >
      <Coins size={17} />
      <strong>{number(coins)}</strong>
      {!compact && <span>코인</span>}
    </button>
  );
}

export function ItemArt({ item, size = "" }) {
  const Icon =
    item.type === "trail"
      ? TRAIL_ICONS[item.style] || Sparkles
      : TYPES.find((type) => type.id === item.type)?.icon || Gift;
  return (
    <span
      className={`item-art ${item.type} ${size}`}
      style={{ "--item-color": item.color || "#87a078" }}
    >
      <i />
      {item.type === "body" ? (
        <CarArt item={item} />
      ) : item.type === "spray" ? (
        <img className="spray-preview" src={sprayPreview(item)} alt="" />
      ) : (
        <Icon size={size === "large" ? 52 : 34} strokeWidth={1.4} />
      )}
      {item.type === "trail" && item.style !== "none" && (
        <span className="item-art-stars">· ·</span>
      )}
    </span>
  );
}

function JoinNote({ onJoin }) {
  return (
    <div className="game-join-note">
      <span>닉네임으로 입장하면 코인을 모으고 내 차를 꾸밀 수 있어요.</span>
      <button onClick={onJoin}>
        입장하기 <ArrowRight size={14} />
      </button>
    </div>
  );
}

export function GaragePanel({ multiplayer, onJoin, onTrack }) {
  const [filter, setFilter] = useState("body");
  const [search, setSearch] = useState("");
  const [ownedOnly, setOwnedOnly] = useState(false);
  const [visibleCount, setVisibleCount] = useState(12);
  const [result, setResult] = useState(null);
  const [actionError, setActionError] = useState("");
  const [opening, setOpening] = useState(false);
  const profile = multiplayer.profile;
  const coins = profile?.coins || 0;
  const inventory = new Set(
    profile?.inventory || Object.values(STARTER_EQUIPPED),
  );
  const equipped = profile?.equipped || STARTER_EQUIPPED;
  const equippedBody =
    ITEMS.find((item) => item.id === equipped.body) ||
    ITEMS.find((item) => item.id === STARTER_EQUIPPED.body);
  const busy = multiplayer.gameBusy || opening;
  const available = Boolean(multiplayer.connected && profile);
  const bodyLocked = Boolean(
    multiplayer.currentArena ||
      multiplayer.currentRace ||
      multiplayer.currentSoccer,
  );
  const collection = ITEMS.filter(
    (item) =>
      item.type === filter &&
      (!ownedOnly || inventory.has(item.id)) &&
      `${item.name} ${rarityOf(item).label}`.includes(search.trim()),
  );
  const resultItem =
    result &&
    (typeof result.item === "string"
      ? ITEMS.find((item) => item.id === result.item)
      : result.item);

  async function openCrate() {
    if (!available || busy || coins < CRATE_COST) return;
    setOpening(true);
    setActionError("");
    setResult(null);
    try {
      const response = await multiplayer.gameAction("crate");
      if (response?.ok) setResult(response);
      else
        setActionError(
          response?.message ||
            "상자를 열지 못했어요. 잠시 후 다시 시도해 주세요.",
        );
    } finally {
      setOpening(false);
    }
  }

  async function equip(item) {
    setActionError("");
    const response = await multiplayer.gameAction("equip", { itemId: item.id });
    if (!response?.ok)
      setActionError(response?.message || "지금은 장착할 수 없어요.");
  }

  return (
    <div className="game-panel garage-panel">
      <div className="modal-eyebrow">
        <Wrench size={15} /> 02 / LITTLE CUSTOM SHOP
      </div>
      <div className="game-title-row">
        <h2 id="modal-title">
          내 취향을 싣는
          <br />
          정비소.
        </h2>
        <span className="garage-wallet">
          <Coins size={18} />
          <strong>{number(coins)}</strong>
          <small>보유 코인</small>
        </span>
      </div>
      <p className="modal-intro">
        차체부터 지나간 자리까지, 나다운 모습으로 꾸며요.
      </p>
      {!available && <JoinNote onJoin={onJoin} />}

      <section className="crate-section" aria-label="꾸미기 상자">
        <div
          className={`crate-illustration ${opening ? "opening" : ""}`}
          aria-hidden="true"
        >
          <Gift size={57} strokeWidth={1.25} />
          <span>?</span>
        </div>
        <div className="crate-copy">
          <small>A LITTLE SURPRISE</small>
          <h3>어떤 조각이 나올까요?</h3>
          <p>차체 · 주행 이펙트 · 스프레이 중 하나</p>
          <button
            className="primary-button"
            onClick={openCrate}
            disabled={!available || busy || coins < CRATE_COST}
          >
            <Gift size={16} />
            {opening ? "상자를 여는 중…" : "상자 열기"}
            <span>
              <Coins size={14} /> {CRATE_COST}
            </span>
          </button>
          {available && coins < CRATE_COST && (
            <button className="earn-coins-link" onClick={onTrack}>
              레일 한 바퀴에 {LAP_REWARD}코인, 달리러 가기{" "}
              <ArrowRight size={13} />
            </button>
          )}
        </div>
      </section>
      <div className="crate-odds" aria-label="등급별 상자 획득 확률">
        {RARITIES.map((rarity) => (
          <span key={rarity.id}>
            <i style={{ background: rarity.color }} />
            {rarity.label} <strong>{rarity.weight}%</strong>
          </span>
        ))}
      </div>
      <p className="crate-duplicate-note">
        이미 가진 아이템이 나오면 {DUPLICATE_REFUND}코인이 돌아와요.
      </p>
      {resultItem && (
        <section
          className={`crate-result rarity-${resultItem.rarity}`}
          key={result.item?.id || result.item}
          style={{ "--rarity-color": rarityOf(resultItem).color }}
          aria-live="polite"
        >
          <ItemArt item={resultItem} size="large" />
          <div>
            <small>
              {rarityOf(resultItem).label} ·{" "}
              {result.duplicate ? "다시 만난 아이템" : "새로운 아이템!"}
            </small>
            <h3>{resultItem.name}</h3>
            <p>
              {result.duplicate
                ? result.refund
                  ? `이미 갖고 있어 ${result.refund}코인을 돌려받았어요.`
                  : "이미 보유한 아이템이에요."
                : "내 컬렉션에 담았어요. 지금 장착해 볼까요?"}
            </p>
            {resultItem.type === "body" && (
              <VehicleStats item={resultItem} equippedId={equipped.body} />
            )}
            <button
              className="item-equip"
              disabled={busy || equipped[resultItem.type] === resultItem.id}
              onClick={() => equip(resultItem)}
            >
              {equipped[resultItem.type] === resultItem.id
                ? "장착 중"
                : "바로 장착"}
              <Check size={14} />
            </button>
          </div>
        </section>
      )}
      {actionError && (
        <p className="game-error" role="alert">
          {actionError}
        </p>
      )}

      <div className="collection-heading">
        <h3>나의 컬렉션</h3>
        <span>
          {inventory.size} / {ITEMS.length}개 보유
        </span>
      </div>
      <div className="inventory-tabs" role="group" aria-label="아이템 종류">
        {TYPES.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            aria-pressed={filter === id}
            onClick={() => {
              setFilter(id);
              setVisibleCount(12);
            }}
          >
            <Icon size={15} />
            {label}{" "}
            <small>{ITEMS.filter((item) => item.type === id).length}</small>
          </button>
        ))}
      </div>
      <div className="collection-tools">
        <label className="collection-search">
          <Search size={15} />
          <input
            aria-label="컬렉션 이름 또는 등급 검색"
            placeholder="이름이나 등급으로 찾기"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setVisibleCount(12);
            }}
          />
        </label>
        <label className="owned-filter">
          <input
            type="checkbox"
            checked={ownedOnly}
            onChange={(event) => {
              setOwnedOnly(event.target.checked);
              setVisibleCount(12);
            }}
          />
          보유한 것만
        </label>
      </div>
      {filter === "body" && (
        <p className="vehicle-comparison-note">
          <CarFront size={14} />
          <span>
            <strong>{equippedBody.name}</strong>와 비교 · ±는 장착 차와의
            차이예요.
            <br />
            최고속도는 게임 속도계 기준이며, 충돌 버팀이 높을수록 덜 밀려나요.
          </span>
        </p>
      )}
      <ul className="inventory-grid">
        {collection.slice(0, visibleCount).map((item) => {
          const owned = inventory.has(item.id);
          const selected = equipped[item.type] === item.id;
          const rarity = rarityOf(item);
          return (
            <li
              className={`inventory-item rarity-${item.rarity} ${item.type === "body" ? "is-vehicle" : ""} ${owned ? "owned" : "locked"} ${selected ? "equipped" : ""}`}
              key={item.id}
              style={{ "--rarity-color": rarity.color }}
            >
              <ItemArt item={item} />
              <small className="item-rarity">
                <i />
                {item.starter ? "기본" : rarity.label}
              </small>
              <strong>{item.name}</strong>
              {item.type === "body" && (
                <VehicleStats item={item} equippedId={equipped.body} />
              )}
              <button
                disabled={
                  !available ||
                  !owned ||
                  selected ||
                  busy ||
                  (item.type === "body" && bodyLocked)
                }
                onClick={() => equip(item)}
                aria-label={`${item.name} ${selected ? "장착 중" : owned ? "장착" : "미보유"}`}
              >
                {selected ? (
                  <>
                    <Check size={13} /> 장착 중
                  </>
                ) : owned ? (
                  item.type === "body" && bodyLocked ? (
                    "참가 중 변경 잠금"
                  ) : (
                    "장착하기"
                  )
                ) : (
                  <>
                    <LockKeyhole size={12} /> 미보유
                  </>
                )}
              </button>
              {import.meta.env.DEV && item.type === "body" && (
                <a
                  className="vehicle-test-drive"
                  href={`${import.meta.env.BASE_URL}?vehicle=${encodeURIComponent(item.id)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`새 창에서 ${item.name} 로컬 시승`}
                >
                  로컬 시승 <ArrowRight size={11} />
                </a>
              )}
            </li>
          );
        })}
      </ul>
      {!collection.length && (
        <p className="collection-empty">
          {ownedOnly
            ? "아직 이 종류의 아이템을 갖고 있지 않아요."
            : "조건에 맞는 아이템이 없어요."}
        </p>
      )}
      {collection.length > visibleCount && (
        <button
          className="collection-more"
          onClick={() => setVisibleCount((count) => count + 12)}
        >
          아이템 더 보기{" "}
          <span>
            {Math.min(visibleCount, collection.length)} / {collection.length}
          </span>
        </button>
      )}
      <p className="game-footnote">
        스프레이는 장착 후 <kbd>T</kbd> 키 또는 스프레이 버튼으로 남겨요.
        <br />
        코인은 아지트 안에서만 사용하는 놀이용 재화예요.
      </p>
    </div>
  );
}

function ArenaRoster({ arena, playerId }) {
  return (
    <ul className="arena-roster" aria-label="콜로세움 참가자">
      {(arena.players || []).map((player) => (
        <li
          key={player.id}
          className={player.alive === false ? "eliminated" : ""}
        >
          <CarFront size={16} aria-hidden="true" />
          <strong>
            {player.nickname}
            {player.id === playerId && <em>나</em>}
          </strong>
          {player.id === arena.hostId && <Crown size={13} aria-label="방장" />}
          <small>
            {arena.status === "waiting"
              ? "대기"
              : player.alive === false
                ? "탈락 · 관전"
                : "생존"}
          </small>
        </li>
      ))}
    </ul>
  );
}

export function ArenaPanel({
  multiplayer,
  onJoin,
  onTrack,
  onPreview,
  onResume,
}) {
  const [error, setError] = useState("");
  const current = multiplayer.currentArena;
  const rooms = (multiplayer.arenas || []).filter(
    (arena) => arena.id !== current?.id,
  );
  const coins = multiplayer.profile?.coins || 0;
  const available = Boolean(multiplayer.connected && multiplayer.profile);
  const busy = multiplayer.gameBusy;
  const isHost = current?.hostId === multiplayer.player?.id;
  const currentPlayers = current?.players || [];
  const isWaiting = current?.status === "waiting";
  const participant = currentPlayers.find(
    (player) => player.id === multiplayer.player?.id,
  );
  const spectator = current && !isWaiting && participant?.alive === false;
  const legacyBusy = Boolean(
    multiplayer.currentRace || multiplayer.currentSoccer,
  );
  const arenaInUse = (multiplayer.arenas || []).some(
    (arena) => arena.id !== current?.id && arena.status !== "waiting",
  );

  async function action(type, payload = {}) {
    setError("");
    const response = await multiplayer.gameAction(type, payload);
    if (!response?.ok)
      setError(
        response?.message || "경기를 준비하지 못했어요. 다시 시도해 주세요.",
      );
  }

  return (
    <div className="game-panel arena-panel">
      <div className="modal-eyebrow">
        <Trophy size={15} /> 03 / THE COLOSSEUM
      </div>
      <h2 id="modal-title">
        콜로세움.
        <br />
        마지막 한 대가 될 때까지.
      </h2>
      <p className="modal-intro">
        2명부터 10명까지, 각자 20코인을 걸고 한 경기장에서 만나요.
        <br />
        서로 부딪히고 장애물을 피하며 끝까지 버틴 한 대가 코인을 모두 받아요.
      </p>
      <ol className="race-flow" aria-label="콜로세움 경기 진행 순서">
        <li>
          <span>01</span>
          <strong>친구들과 모이기</strong>
          <small>20코인으로 참가 · 방장이 시작</small>
        </li>
        <li>
          <span>02</span>
          <strong>경기장 안에서 버티기</strong>
          <small>카운트다운 뒤 시작 · 밖으로 밀리면 탈락</small>
        </li>
        <li>
          <span>03</span>
          <strong>마지막 한 대의 승리</strong>
          <small>승자가 모든 코인 획득 · 종료 후 아지트 복귀</small>
        </li>
      </ol>
      <button
        className="arena-preview"
        onClick={current && !isWaiting ? onResume : onPreview}
      >
        <Eye size={16} />
        <span>
          {current && !isWaiting
            ? "경기 화면으로 돌아가기"
            : "콜로세움 먼저 둘러보기"}
        </span>
        <ArrowRight size={15} />
      </button>
      {!available && <JoinNote onJoin={onJoin} />}
      {current ? (
        <section className="active-race arena-current">
          <div className="arena-room-heading">
            <div>
              <span className="race-section-label">
                {isWaiting
                  ? "친구를 기다리는 중"
                  : spectator
                    ? "탈락 후 관전 중"
                    : current.status === "countdown"
                      ? "곧 시작해요"
                      : "마지막 한 대를 가리는 중"}
              </span>
              <h3>
                {isWaiting
                  ? "함께할 준비 됐나요?"
                  : spectator
                    ? "친구들의 대결을 지켜봐요"
                    : "끝까지 살아남아요"}
              </h3>
            </div>
            <span className="arena-pot">
              <Coins size={15} />
              <strong>{number(current.pot)}</strong>
            </span>
          </div>
          <ArenaRoster arena={current} playerId={multiplayer.player?.id} />
          {isWaiting ? (
            <>
              <p className="arena-room-note">
                {currentPlayers.length}/10명 · 각 {number(current.stake || 20)}
                코인 참가 중
              </p>
              {isHost ? (
                <button
                  className="primary-button arena-start"
                  disabled={
                    busy ||
                    arenaInUse ||
                    currentPlayers.length < ARENA.minPlayers
                  }
                  onClick={() => action("arena:start", { arenaId: current.id })}
                >
                  {arenaInUse
                    ? "진행 중인 경기를 기다려요"
                    : currentPlayers.length < 2
                      ? "친구 한 명이 더 필요해요"
                      : currentPlayers.length + "명으로 경기 시작"}
                  <Flag size={16} />
                </button>
              ) : (
                <p className="arena-room-note">
                  방장이 시작하면 모두 경기장으로 자동 이동해요.
                </p>
              )}
              <button
                className="race-cancel"
                disabled={busy}
                onClick={() => action("arena:leave", { arenaId: current.id })}
              >
                대기 나가기 · 20코인 돌려받기
              </button>
              {isHost && currentPlayers.length > 1 && (
                <small className="arena-host-note">
                  나가면 다음 친구가 방장을 이어받아요.
                </small>
              )}
            </>
          ) : (
            <>
              <button className="primary-button arena-start" onClick={onResume}>
                {spectator ? "관전 화면으로" : "경기로 돌아가기"}
                <ArrowRight size={16} />
              </button>
              {!spectator && (
                <button
                  className="race-cancel"
                  disabled={busy}
                  onClick={() => action("arena:leave", { arenaId: current.id })}
                >
                  기권하고 관전하기
                </button>
              )}
              <small className="arena-host-note">
                {spectator
                  ? "경기가 끝나면 아지트로 돌아가요. 그동안 친구들의 대결을 볼 수 있어요."
                  : "기권하면 탈락 후 관전으로 전환돼요. 연결이 끊겨도 기권으로 처리돼요."}
              </small>
            </>
          )}
        </section>
      ) : (
        <section className="arena-create">
          <div className="collection-heading">
            <h3>새 경기 열기</h3>
            <span>
              <Coins size={13} /> 보유 {number(coins)}
            </span>
          </div>
          <div className="arena-entry-details">
            <span>
              <Users size={15} /> 2–10명
            </span>
            <span>
              참가비 <strong>20코인</strong>
            </span>
            <span>
              최대 <strong>200코인</strong>
            </span>
          </div>
          <button
            className="primary-button race-create-button"
            disabled={!available || busy || coins < ARENA.stake || legacyBusy}
            onClick={() => action("arena:create")}
          >
            20코인으로 친구 기다리기 <ArrowRight size={16} />
          </button>
          {available && coins < 20 && (
            <p className="game-footnote">
              레일 한 바퀴를 돌면 참가할 코인을 모을 수 있어요.
            </p>
          )}
          {legacyBusy && (
            <p className="game-footnote">
              참가 중인 대결을 마친 뒤 새 경기를 열 수 있어요.
            </p>
          )}
        </section>
      )}
      <div className="collection-heading">
        <h3>친구들의 콜로세움</h3>
        <span>{rooms.length}개의 경기</span>
      </div>
      <div className="race-rooms arena-rooms">
        {!rooms.length ? (
          <div className="race-empty">
            <Trophy size={24} strokeWidth={1.4} />
            <p>
              아직 열린 경기가 없어요.
              <br />
              <span>방을 열고 수다창에서 친구를 불러 보세요.</span>
            </p>
          </div>
        ) : (
          rooms.map((arena) => {
            const waiting = arena.status === "waiting";
            const count = arena.players?.length || 0;
            const full = count >= ARENA.maxPlayers;
            return (
              <div className="race-room arena-room" key={arena.id}>
                <div>
                  <strong>{arena.hostNickname}님의 경기</strong>
                  <span>
                    {waiting
                      ? count + "/10명 대기"
                      : "진행 중 · " +
                        (arena.players || []).filter(
                          (player) => player.alive !== false,
                        ).length +
                        "대 생존"}{" "}
                    · 모인 코인 {number(arena.pot)}
                  </span>
                </div>
                {waiting ? (
                  <button
                    disabled={
                      !available ||
                      !!current ||
                      legacyBusy ||
                      busy ||
                      coins < ARENA.stake ||
                      full
                    }
                    onClick={() => action("arena:join", { arenaId: arena.id })}
                  >
                    {full
                      ? "인원 마감"
                      : coins < ARENA.stake && available
                        ? "코인 부족"
                        : "20코인 참가"}
                    <ArrowRight size={13} />
                  </button>
                ) : (
                  <button
                    disabled={!!current && !isWaiting}
                    onClick={onPreview}
                  >
                    <Eye size={14} /> 관전하기
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>
      {error && (
        <p className="game-error" role="alert">
          {error}
        </p>
      )}
      {(!current || isWaiting) && (
        <button className="rail-invite" onClick={onTrack}>
          <span className="rail-invite-icon">
            <Coins size={24} />
          </span>
          <span>
            <strong>순환 레일에서 코인 모으기</strong>
            <small>맵 아래 레일 한 바퀴 · +{LAP_REWARD}코인</small>
          </span>
          <ArrowRight size={18} />
        </button>
      )}
      <p className="game-footnote">
        대기 중 나가면 참가비를 돌려받아요. 시간 초과나 무승부면 모두 환급돼요.
        <br />
        코인은 아지트 안에서만 사용하는 놀이용 재화예요.
      </p>
    </div>
  );
}

export function ArenaHud({ arena, playerId, onOpen }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (!arena || arena.status === "waiting") return;
    const timer = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(timer);
  }, [arena?.id, arena?.status]);
  if (!arena) return null;
  const players = arena.players || [];
  const alive = players.filter((player) => player.alive !== false).length;
  const spectator =
    players.find((player) => player.id === playerId)?.alive === false;
  const startsAt =
    typeof arena.startsAt === "number"
      ? arena.startsAt
      : new Date(arena.startsAt).getTime();
  const expiresAt =
    typeof arena.expiresAt === "number"
      ? arena.expiresAt
      : new Date(arena.expiresAt).getTime();
  const countdown =
    arena.status === "countdown" && Number.isFinite(startsAt)
      ? Math.max(0, Math.ceil((startsAt - now) / 1000))
      : 0;
  const seconds = Number.isFinite(expiresAt)
    ? Math.max(0, Math.ceil((expiresAt - now) / 1000))
    : null;
  return (
    <aside
      className={"race-hud arena-hud" + (countdown ? " counting" : "")}
      aria-label="콜로세움 경기 상태"
    >
      <button className="arena-hud-summary" onClick={onOpen}>
        {spectator ? <Eye size={16} /> : <Trophy size={16} />}
        <strong>
          {arena.status === "waiting"
            ? "콜로세움 대기 중"
            : spectator
              ? "탈락 · 관전 중"
              : "마지막 한 대"}
        </strong>
        <span>
          {arena.status === "waiting"
            ? players.length + "/10명"
            : alive + "/" + players.length + "대 생존"}
        </span>
        <span className="arena-hud-pot">
          <Coins size={13} />
          {number(arena.pot)}
        </span>
      </button>
      {countdown > 0 ? (
        <>
          <strong aria-live="polite">{countdown}</strong>
          <small>경기장 밖으로 밀리지 않게 준비해요.</small>
        </>
      ) : (
        arena.status !== "waiting" && (
          <small>
            {spectator
              ? "친구들의 경기가 끝날 때까지 지켜봐요."
              : "밖으로 밀리면 탈락 · 마지막 생존자가 모두 획득"}
            {seconds !== null && (
              <span className="arena-hud-time">
                {" "}
                · {Math.floor(seconds / 60)}:
                {String(seconds % 60).padStart(2, "0")}
              </span>
            )}
          </small>
        )
      )}
    </aside>
  );
}

export function RacePanel({ multiplayer, onJoin, onTrack }) {
  const [stake, setStake] = useState(20);
  const [error, setError] = useState("");
  const current = multiplayer.currentRace;
  const waiting = (multiplayer.races || []).filter(
    (race) =>
      race.status === "waiting" &&
      race.hostId !== multiplayer.player?.id &&
      race.id !== current?.id,
  );
  const coins = multiplayer.profile?.coins || 0;
  const available = Boolean(multiplayer.connected && multiplayer.profile);
  const arenaBusy = Boolean(
    multiplayer.currentArena || multiplayer.currentSoccer,
  );
  async function action(type, payload) {
    setError("");
    const response = await multiplayer.gameAction(type, payload);
    if (!response?.ok)
      setError(
        response?.message || "대결을 준비하지 못했어요. 다시 시도해 주세요.",
      );
  }
  return (
    <div className="game-panel race-panel">
      <div className="modal-eyebrow">
        <Flag size={15} /> 03 / A FRIENDLY RACE
      </div>
      <h2 id="modal-title">
        같이 달릴래?
        <br />
        아지트 한 바퀴, 전속력.
      </h2>
      <p className="modal-intro">
        아지트 전체를 감싸는 약 {Math.round(DUEL_LENGTH)}m 코스에서 1대1로
        달려요.
        <br />
        매번 달라지는 점프패드·범퍼·가속패드를 지나 달려 보세요.
        <br />
        출발선을 한 바퀴 돌아 먼저 통과한 친구가 코인을 모두 받아요.
      </p>
      <ol className="race-flow" aria-label="외곽 코스 한 바퀴 대결 진행 순서">
        <li>
          <span>01</span>
          <strong>상대가 참가하면</strong>
          <small>두 차가 출발선으로 자동 이동</small>
        </li>
        <li>
          <span>02</span>
          <strong>카운트다운 후 출발</strong>
          <small>패드와 범퍼를 지나 한 바퀴 완주</small>
        </li>
        <li>
          <span>03</span>
          <strong>끝나면 다시 아지트로</strong>
          <small>보상 정산 후 자동으로 복귀</small>
        </li>
      </ol>
      {(!current || current.status === "waiting") && !arenaBusy && (
        <button className="rail-invite" onClick={onTrack}>
          <span className="rail-invite-icon">
            <Coins size={24} />
          </span>
          <span>
            <strong>순환 레일에서 코인 모으기</strong>
            <small>맵 아래 레일을 한 바퀴 돌 때마다 +{LAP_REWARD}코인</small>
          </span>
          <ArrowRight size={18} />
        </button>
      )}
      {!available && <JoinNote onJoin={onJoin} />}
      {current ? (
        <section className="active-race">
          <span className="race-section-label">
            {current.status === "waiting"
              ? "친구를 기다리는 중"
              : "대결 진행 중"}
          </span>
          <div className="race-versus">
            <strong>{current.hostNickname}</strong>
            <span>VS</span>
            <strong>{current.guestNickname || "누가 함께할까요?"}</strong>
          </div>
          <p>
            각 {number(current.stake)}코인 · 승리 보상{" "}
            <b>{number(current.stake * 2)}코인</b>
          </p>
          {current.status === "waiting" ? (
            <>
              <small>
                친구가 참가하면 외곽 코스의 출발선으로 함께 이동해요.
              </small>
              <button
                className="race-cancel"
                onClick={() => action("race:cancel")}
                disabled={multiplayer.gameBusy}
              >
                대기 취소 · 판돈 돌려받기
              </button>
            </>
          ) : (
            <button className="primary-button" onClick={onTrack}>
              대결로 돌아가기 <Flag size={16} />
            </button>
          )}
        </section>
      ) : (
        <section className="race-create">
          <div className="collection-heading">
            <h3>대결 열기</h3>
            <span>
              <Coins size={13} /> 보유 {number(coins)}
            </span>
          </div>
          <fieldset className="stake-options">
            <legend>한 사람당 걸 코인</legend>
            {[20, 100, 200].map((value) => (
              <button
                type="button"
                key={value}
                aria-pressed={stake === value}
                onClick={() => setStake(value)}
              >
                <Coins size={15} />
                {value}
              </button>
            ))}
          </fieldset>
          <div className="race-pot">
            <span>1대1 · 약 {Math.round(DUEL_LENGTH)}m 한 바퀴</span>
            <span>
              승자에게 <strong>{number(stake * 2)}코인</strong>
            </span>
          </div>
          <button
            className="primary-button race-create-button"
            disabled={
              !available || multiplayer.gameBusy || coins < stake || arenaBusy
            }
            onClick={() => action("race:create", { stake })}
          >
            이 조건으로 친구 기다리기 <ArrowRight size={16} />
          </button>
          {available && coins < stake && (
            <p className="game-footnote">
              순환 레일에서 {number(stake - coins)}코인을 더 모으면 대결을 열 수
              있어요.
            </p>
          )}
          {arenaBusy && (
            <p className="game-footnote">
              참가 중인 경기를 마친 뒤 레이싱을 시작할 수 있어요.
            </p>
          )}
        </section>
      )}
      <div className="collection-heading">
        <h3>함께 달릴 친구</h3>
        <span>{waiting.length}개의 대기 중인 대결</span>
      </div>
      <div className="race-rooms">
        {!waiting.length ? (
          <div className="race-empty">
            <Flag size={22} strokeWidth={1.4} />
            <p>
              아직 기다리는 친구가 없어요.
              <br />
              <span>먼저 대결을 열고 수다창에서 초대해 보세요.</span>
            </p>
          </div>
        ) : (
          waiting.map((race) => (
            <div className="race-room" key={race.id}>
              <div>
                <strong>{race.hostNickname}</strong>
                <span>
                  각 {number(race.stake)}코인 · 승리 보상{" "}
                  {number(race.stake * 2)}코인
                </span>
              </div>
              <button
                disabled={
                  !available ||
                  !!current ||
                  arenaBusy ||
                  multiplayer.gameBusy ||
                  coins < race.stake
                }
                onClick={() => action("race:join", { raceId: race.id })}
              >
                {coins < race.stake ? "코인 부족" : "대결 참가"}
                <ArrowRight size={13} />
              </button>
            </div>
          ))
        )}
      </div>
      {error && (
        <p className="game-error" role="alert">
          {error}
        </p>
      )}
      <p className="game-footnote">
        대기 중 취소하면 코인이 돌아와요. 출발한 뒤 나가면 기권이에요.
        <br />
        코인은 아지트 안에서만 사용하는 놀이용 재화예요.
      </p>
    </div>
  );
}

export function RaceHud({ race, onOpen }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!race) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(timer);
  }, [race?.id, race?.status]);
  if (!race) return null;
  const startsAt =
    typeof race.startsAt === "number"
      ? race.startsAt
      : new Date(race.startsAt).getTime();
  const remaining = Number.isFinite(startsAt)
    ? Math.max(0, Math.ceil((startsAt - now) / 1000))
    : 0;
  const seconds = Number.isFinite(startsAt)
    ? Math.max(0, (now - startsAt) / 1000).toFixed(1)
    : "0.0";
  return (
    <div
      className={
        "race-hud " +
        (race.status === "countdown" && remaining ? "counting" : "")
      }
      role="status"
    >
      {race.status === "waiting" ? (
        <button onClick={onOpen}>
          <Flag size={16} /> 대결 상대를 기다려요{" "}
          <span>{number(race.stake)}코인</span>
        </button>
      ) : (
        <>
          <div className="race-hud-caption">
            <Flag size={14} />
            {race.hostNickname} {Math.round((race.hostProgress || 0) * 100)}%
            <span>vs</span>
            {race.guestNickname} {Math.round((race.guestProgress || 0) * 100)}%
          </div>
          <strong>
            {remaining ? remaining : "1바퀴 대결 · " + seconds + "s"}
          </strong>
          <small>
            {remaining
              ? "아지트 둘레 한 바퀴, 출발을 준비하세요!"
              : "먼저 한 바퀴를 완주하면 " + number(race.stake * 2) + "코인"}
          </small>
          {!remaining && (
            <div
              className="race-hud-progress"
              aria-label="두 차량의 외곽 코스 한 바퀴 진행률"
            >
              <span
                title={
                  race.hostNickname +
                  ": " +
                  Math.round((race.hostProgress || 0) * 100) +
                  "%"
                }
              >
                <i
                  style={{
                    width:
                      Math.min(
                        100,
                        Math.max(0, (race.hostProgress || 0) * 100),
                      ) + "%",
                  }}
                />
              </span>
              <span
                title={
                  race.guestNickname +
                  ": " +
                  Math.round((race.guestProgress || 0) * 100) +
                  "%"
                }
              >
                <i
                  style={{
                    width:
                      Math.min(
                        100,
                        Math.max(0, (race.guestProgress || 0) * 100),
                      ) + "%",
                  }}
                />
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
