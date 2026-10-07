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
} from "lucide-react";
import { createSprayCanvas } from "./cosmeticsWorld.js";
import {
  CRATE_COST,
  DUPLICATE_REFUND,
  ITEMS,
  LAP_REWARD,
  RARITIES,
  STARTER_EQUIPPED,
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

export function Wallet({ coins = 0, onClick, compact = false }) {
  return (
    <button
      className={`game-wallet ${compact ? "compact" : ""}`}
      onClick={onClick}
      aria-label={`보유 코인 ${number(coins)}개, 차고지 열기`}
    >
      <Coins size={17} />
      <strong>{number(coins)}</strong>
      {!compact && <span>코인</span>}
    </button>
  );
}

function ItemArt({ item, size = "" }) {
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
        <svg viewBox="0 0 120 75" className="item-car" aria-hidden="true">
          <ellipse
            cx="61"
            cy="66"
            rx="42"
            ry="5"
            fill="#6b7751"
            opacity=".12"
          />
          <circle cx="33" cy="56" r="11" fill="#40523e" />
          <circle cx="33" cy="56" r="5" fill="#c9d1b7" />
          <circle cx="89" cy="56" r="11" fill="#40523e" />
          <circle cx="89" cy="56" r="5" fill="#c9d1b7" />
          <path
            d={
              ["sport", "roadster"].includes(item.style)
                ? "M18 44L37 38L47 25H73L86 38L104 44V54H18Z"
                : item.style === "pickup"
                  ? "M17 36H52V23H82L103 40V54H17Z"
                  : item.style === "van"
                    ? "M20 23H83L102 39V54H17V29Z"
                    : "M18 39H39V23H79L88 39H103V53H18Z"
            }
            fill="currentColor"
          />
          <path
            d={
              ["sport", "roadster"].includes(item.style)
                ? "M45 37L51 28H71L78 37Z"
                : item.style === "pickup"
                  ? "M58 28H78L91 39H58Z"
                  : item.style === "van"
                    ? "M27 28H50V40H27ZM56 28H80L91 40H56Z"
                    : "M45 27H60V39H45ZM64 27H76L81 39H64Z"
            }
            fill="#6f9389"
          />
          <path d="M18 51H104" stroke="#f4f1d9" strokeWidth="4" />
          <rect x="97" y="42" width="8" height="5" rx="1" fill="#fff8d6" />
          {item.style === "buggy" && (
            <path d="M39 22H81" stroke="#55745b" strokeWidth="4" />
          )}
          {item.style === "roadster" && (
            <path d="M39 27H66V38H39Z" fill="#f8f5e9" />
          )}
          {item.style === "pickup" && (
            <path d="M20 40H47" stroke="#638777" strokeWidth="4" />
          )}
          {item.style === "rally" && (
            <g fill="#fff1ba" stroke="#5d745d" strokeWidth="2">
              <rect x="45" y="15" width="11" height="8" rx="1" />
              <rect x="59" y="15" width="11" height="8" rx="1" />
              <rect x="73" y="15" width="11" height="8" rx="1" />
            </g>
          )}
        </svg>
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
  const busy = multiplayer.gameBusy || opening;
  const available = Boolean(multiplayer.connected && profile);
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
        <Wrench size={15} /> 02 / MY LITTLE GARAGE
      </div>
      <div className="game-title-row">
        <h2 id="modal-title">
          내 취향을 싣는
          <br />
          차고지.
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
          className="crate-result"
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
      <ul className="inventory-grid">
        {collection.slice(0, visibleCount).map((item) => {
          const owned = inventory.has(item.id);
          const selected = equipped[item.type] === item.id;
          const rarity = rarityOf(item);
          return (
            <li
              className={`inventory-item ${owned ? "owned" : "locked"} ${selected ? "equipped" : ""}`}
              key={item.id}
              style={{ "--rarity-color": rarity.color }}
            >
              <ItemArt item={item} />
              <small className="item-rarity">
                <i />
                {item.starter ? "기본" : rarity.label}
              </small>
              <strong>{item.name}</strong>
              <button
                disabled={!available || !owned || selected || busy}
                onClick={() => equip(item)}
                aria-label={`${item.name} ${selected ? "장착 중" : owned ? "장착" : "미보유"}`}
              >
                {selected ? (
                  <>
                    <Check size={13} /> 장착 중
                  </>
                ) : owned ? (
                  "장착하기"
                ) : (
                  <>
                    <LockKeyhole size={12} /> 미보유
                  </>
                )}
              </button>
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
        결승선까지, 전속력.
      </h2>
      <p className="modal-intro">
        맵 왼쪽 전용 직선 코스에서 1대1로 달려요.
        <br />
        매번 달라지는 점프패드와 범퍼를 넘거나 피해 보세요.
        <br />
        같은 조건의 두 레인, 먼저 완주한 친구가 코인을 모두 받아요.
      </p>
      <ol className="race-flow" aria-label="직선 대결 진행 순서">
        <li>
          <span>01</span>
          <strong>상대가 참가하면</strong>
          <small>두 차가 출발선으로 자동 이동</small>
        </li>
        <li>
          <span>02</span>
          <strong>카운트다운 후 출발</strong>
          <small>점프패드와 범퍼를 지나 결승선까지</small>
        </li>
        <li>
          <span>03</span>
          <strong>끝나면 다시 아지트로</strong>
          <small>보상 정산 후 자동으로 복귀</small>
        </li>
      </ol>
      {(!current || current.status === "waiting") && (
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
                친구가 참가하면 왼쪽 직선 코스의 출발선으로 함께 이동해요.
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
            <span>1대1 · 직선 코스</span>
            <span>
              승자에게 <strong>{number(stake * 2)}코인</strong>
            </span>
          </div>
          <button
            className="primary-button race-create-button"
            disabled={!available || multiplayer.gameBusy || coins < stake}
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
      className={`race-hud ${race.status === "countdown" && remaining ? "counting" : ""}`}
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
            {race.hostNickname} <span>vs</span> {race.guestNickname}
          </div>
          <strong>{remaining ? remaining : `직선 대결 · ${seconds}s`}</strong>
          <small>
            {remaining
              ? "왼쪽 코스에서 출발을 준비하세요!"
              : `결승선에 먼저 도착하면 ${number(race.stake * 2)}코인`}
          </small>
          {!remaining && (
            <div
              className="race-hud-progress"
              aria-label="두 차량의 직선 코스 진행률"
            >
              <span
                title={`${race.hostNickname}: ${Math.round((race.hostProgress || 0) * 100)}%`}
              >
                <i
                  style={{
                    width: `${Math.min(100, Math.max(0, (race.hostProgress || 0) * 100))}%`,
                  }}
                />
              </span>
              <span
                title={`${race.guestNickname}: ${Math.round((race.guestProgress || 0) * 100)}%`}
              >
                <i
                  style={{
                    width: `${Math.min(100, Math.max(0, (race.guestProgress || 0) * 100))}%`,
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
