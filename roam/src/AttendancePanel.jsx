import { useState } from "react";
import {
  ArrowRight,
  CalendarCheck,
  Check,
  Coins,
  Gift,
  RotateCcw,
} from "lucide-react";
import { getAttendanceReward } from "./attendanceConfig.js";
import { DUPLICATE_REFUND, ITEM_BY_ID, RARITIES } from "./gameConfig.js";
import { ItemArt } from "./GamePanels.jsx";
import "./attendance.css";

const number = (value = 0) => value.toLocaleString("ko-KR");
const rewardLabel = (reward) =>
  reward.kind === "coins"
    ? `${number(reward.coins)} 코인`
    : reward.minRarity === "mythic"
      ? "신화 차량 1종"
      : "에픽 이상 차량 1종";

function RewardSymbol({ reward, size = 26 }) {
  return reward.kind === "coins" ? (
    <Coins size={size} strokeWidth={1.35} />
  ) : (
    <Gift size={size} strokeWidth={1.35} />
  );
}

export function AttendanceButton({ attendance, connected, onClick }) {
  const available = Boolean(connected && attendance?.available);
  return (
    <button
      className="attendance-button"
      onClick={onClick}
      aria-label={
        available ? "출석 보상, 오늘 받을 보상이 있어요" : "출석 보상 열기"
      }
      title="출석 보상"
    >
      <CalendarCheck size={17} />
      <span>출석</span>
      {available && <i aria-hidden="true" />}
    </button>
  );
}

export function AttendancePanel({ multiplayer, onJoin, onGarage }) {
  const [claiming, setClaiming] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const attendance = multiplayer.profile?.attendance;
  const connected = Boolean(multiplayer.connected);
  const ready = connected && Boolean(attendance);
  const busy = claiming || multiplayer.gameBusy;
  const cycle = attendance?.cycle || 1;
  const day = attendance?.day || 1;
  const claimedToday = Boolean(attendance?.claimedToday);
  const reward =
    attendance?.reward || getAttendanceReward((cycle - 1) * 7 + day);
  const receipt = claimedToday ? attendance.lastClaim : null;
  const item = receipt?.itemId ? ITEM_BY_ID.get(receipt.itemId) : null;
  const rarity = item && RARITIES.find((entry) => entry.id === item.rarity);

  async function claim() {
    if (!ready || busy || !attendance.available) return;
    setClaiming(true);
    setError("");
    try {
      const response = await multiplayer.gameAction("attendance:claim");
      if (!response?.ok) {
        setError(
          response?.message || "보상을 받지 못했어요. 다시 시도해 주세요.",
        );
      }
    } catch {
      setError("연결을 확인한 뒤 다시 시도해 주세요.");
    } finally {
      setClaiming(false);
    }
  }

  async function refresh() {
    if (refreshing || !connected) return;
    setRefreshing(true);
    setError("");
    try {
      const response = await multiplayer.refreshAttendance(true);
      if (!response?.ok) {
        setError(
          response?.message ||
            "출석 정보를 불러오지 못했어요. 다시 시도해 주세요.",
        );
      }
    } catch {
      setError("연결을 확인한 뒤 다시 시도해 주세요.");
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <section className="attendance-panel">
      <div className="modal-eyebrow">
        <CalendarCheck size={15} /> A LITTLE EVERY DAY
      </div>
      <h2 id="modal-title">오늘도, 반가워요.</h2>
      <p className="modal-intro">
        아지트에 들른 날마다 작은 선물 하나. 일곱 번의 만남을 모아 보세요.
      </p>

      {!connected && (
        <div className="attendance-join">
          <span>온라인으로 입장하면 내 출석을 이어갈 수 있어요.</span>
          <button onClick={onJoin}>
            닉네임으로 입장 <ArrowRight size={14} />
          </button>
        </div>
      )}
      {connected && !ready && (
        <div className="attendance-refresh" role="status">
          <span>출석 정보를 확인하고 있어요.</span>
          <button onClick={refresh} disabled={refreshing}>
            <RotateCcw size={13} /> {refreshing ? "불러오는 중…" : "다시 확인"}
          </button>
        </div>
      )}
      <div className="attendance-cycle">
        <span>
          {cycle === 1 ? "첫 번째 일주일" : `${number(cycle)}번째 일주일`}
        </span>
        <small>
          {ready
            ? `총 ${number(attendance.claimedDays)}일 출석`
            : "보상 미리 보기"}
        </small>
      </div>

      <ol
        className="attendance-days"
        aria-label={`${cycle}번째 주기의 출석 보상`}
      >
        {Array.from({ length: 7 }, (_, index) => {
          const slot = index + 1;
          const slotReward = getAttendanceReward((cycle - 1) * 7 + slot);
          const received =
            ready && (slot < day || (slot === day && claimedToday));
          const today = ready && slot === day;
          const state = received
            ? "수령 완료"
            : today
              ? "오늘의 보상"
              : "수령 예정";
          return (
            <li
              key={slot}
              className={`${today ? "is-today" : ""} ${received ? "is-received" : ""} ${slotReward.kind === "vehicle" ? "has-vehicle" : ""}`}
              aria-label={`${slot}일차, ${rewardLabel(slotReward)}, ${state}`}
              aria-current={today ? "step" : undefined}
            >
              <small>{slot}일차</small>
              <div className="attendance-day-icon" aria-hidden="true">
                <RewardSymbol reward={slotReward} />
                {received && <Check className="attendance-check" size={12} />}
              </div>
              {slotReward.kind === "coins" ? (
                <strong>
                  {number(slotReward.coins)} <span>코인</span>
                </strong>
              ) : (
                <strong>
                  {slotReward.minRarity === "mythic" ? "신화" : "에픽 이상"}
                  <span>차량 1종</span>
                </strong>
              )}
              <em>
                {received ? "받았어요" : today ? "오늘" : ready ? "예정" : ""}
              </em>
            </li>
          );
        })}
      </ol>

      <div
        className="attendance-current"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        <div className="attendance-current-art" aria-hidden="true">
          {item ? (
            <ItemArt item={item} size="large" />
          ) : (
            <RewardSymbol reward={reward} size={37} />
          )}
        </div>
        <div>
          <small>
            {claimedToday ? "오늘의 보상을 받았어요" : `${day}일차 보상`}
          </small>
          <h3>{item ? item.name : rewardLabel(reward)}</h3>
          {item ? (
            <p>
              <span
                className="attendance-rarity"
                style={{ "--attendance-rarity": rarity?.color }}
              >
                {rarity?.label || "차량"}
              </span>
              {receipt.duplicate
                ? ` 이미 모두 보유해 ${number(receipt.refund || DUPLICATE_REFUND)}코인을 받았어요.`
                : " 내 컬렉션에 담았어요."}
            </p>
          ) : (
            <p>
              {claimedToday
                ? "내일도 이곳에서 만나요."
                : reward.kind === "vehicle"
                  ? "아직 없는 차량을 먼저, 무작위로 선물해 드려요."
                  : "정비소에서 나만의 컬렉션을 모아 보세요."}
            </p>
          )}
        </div>
      </div>

      {error && (
        <p className="attendance-error" role="alert">
          {error}
        </p>
      )}
      <div className="attendance-actions">
        <button
          className="primary-button attendance-claim"
          onClick={claim}
          disabled={!ready || !attendance?.available || busy}
        >
          {claimedToday ? (
            <Check size={17} />
          ) : error ? (
            <RotateCcw size={16} />
          ) : (
            <Gift size={17} />
          )}
          {claiming
            ? "선물을 받는 중…"
            : claimedToday
              ? "오늘 출석 완료"
              : connected && !ready
                ? "출석 정보를 불러오는 중…"
                : error
                  ? "다시 받기"
                  : "오늘의 보상 받기"}
        </button>
        {receipt && (
          <button className="attendance-garage" onClick={onGarage}>
            정비소로 가기 <ArrowRight size={14} />
          </button>
        )}
      </div>
      <div className="attendance-notes">
        <p>
          한국 시간 자정에 다음 출석이 열려요. 하루를 쉬어도 순서는 이어져요.
        </p>
        <p>7일마다 반복되며, 두 번째 주기부터 1일차 보상은 100코인이에요.</p>
        <p>
          해당 등급의 차량을 모두 가지고 있다면 {DUPLICATE_REFUND}코인을 받아요.
        </p>
      </div>
    </section>
  );
}
