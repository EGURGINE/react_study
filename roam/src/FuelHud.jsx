import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowRight, ChevronDown, Fuel, House, LockKeyhole, Package, Timer, UnlockKeyhole, X, Zap } from "lucide-react";
import { FUEL, getFuelEconomy } from "./fuelConfig.js";
import "./fuel.css";

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const amount = (value) => Math.floor(Math.max(0, Number(value) || 0)).toLocaleString("ko-KR");
const duration = (value) => Math.max(0, value).toLocaleString("ko-KR", { maximumFractionDigits: 1 });
const seconds = (until, now) => finite(until) ? Math.max(0, Math.ceil((until - now) / 1000)) : 0;
const clock = (value) => `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;

export default function FuelHud({
  fuel, playerId, bodyId, connected, nearTheft, onAction, onJoin, onDriveHome, tank: predictedTank,
}) {
  const [open, setOpen] = useState(false);
  const [holding, setHolding] = useState(false);
  const [error, setError] = useState("");
  const panelId = useId();
  const helpId = useId();
  const hud = useRef(null);
  const hold = useRef(null);
  const action = useRef(onAction);
  const seenSteal = useRef(false);
  const mounted = useRef(true);
  action.current = onAction;
  const anchor = useMemo(() => ({ server: finite(fuel?.serverNow) ? fuel.serverNow : 0, local: performance.now() }), [fuel?.serverNow]);
  const [serverNow, setServerNow] = useState(anchor.server);
  useEffect(() => {
    const tick = () => setServerNow(anchor.server + Math.max(0, performance.now() - anchor.local));
    tick();
    if (!connected) return;
    const interval = setInterval(tick, 100);
    return () => clearInterval(interval);
  }, [anchor, connected]);

  const me = fuel?.players?.find((player) => player.id === playerId);
  const garage = fuel?.garages?.find((item) => item.ownerId === playerId);
  const ready = Boolean(connected && me && finite(fuel?.serverNow));
  const tank = ready ? clamp(finite(predictedTank) ? predictedTank : Number(me.tank) || 0, 0, 100) : null;
  const consumption = Number(me?.consumptionRate) || getFuelEconomy(bodyId).consumptionRate;
  const boostSeconds = tank !== null && consumption > 0 ? tank / consumption : Number(me?.boostSeconds) || 0;
  const closedFor = seconds(garage?.closedUntil, serverNow);
  const productionIn = seconds(fuel?.nextProductionAt, serverNow);
  const production = Number(fuel?.productionPerMinute) || FUEL.production;
  const target = nearTheft && nearTheft.ownerId !== playerId ? nearTheft : null;
  const canSteal = Boolean(ready && target && !target.closed && target.stored > 0 && !me?.carrying && onAction);
  const stealing = me?.stealing;
  const stealSpan = stealing ? Math.max(1, stealing.endsAt - stealing.startedAt) : FUEL.stealMs;
  const progress = stealing ? clamp((serverNow - stealing.startedAt) / stealSpan, 0, 1) : 0;
  const stealRemaining = stealing ? seconds(stealing.endsAt, serverNow) : 0;
  const theftName = target?.nickname || fuel?.garages?.find((item) => item.ownerId === stealing?.targetId)?.nickname;
  const low = tank !== null && tank <= 20;

  const cancelHold = useCallback(() => {
    if (!hold.current) return;
    hold.current = null;
    seenSteal.current = false;
    if (mounted.current) setHolding(false);
    try { Promise.resolve(action.current?.("fuel:cancel")).catch(() => {}); } catch { /* A disconnected socket needs no further cancellation. */ }
  }, []);

  useEffect(() => {
    mounted.current = true;
    const releasePointer = () => { if (hold.current?.source === "pointer") cancelHold(); };
    const releaseKey = (event) => {
      if (["Space", "Enter"].includes(event.code) && hold.current?.source === "keyboard") cancelHold();
    };
    const hide = () => { if (document.hidden) cancelHold(); };
    window.addEventListener("pointerup", releasePointer);
    window.addEventListener("pointercancel", releasePointer);
    window.addEventListener("keyup", releaseKey);
    window.addEventListener("blur", cancelHold);
    document.addEventListener("visibilitychange", hide);
    return () => {
      mounted.current = false;
      cancelHold();
      window.removeEventListener("pointerup", releasePointer);
      window.removeEventListener("pointercancel", releasePointer);
      window.removeEventListener("keyup", releaseKey);
      window.removeEventListener("blur", cancelHold);
      document.removeEventListener("visibilitychange", hide);
    };
  }, [cancelHold]);
  useEffect(() => {
    if (!hold.current) return;
    if (!canSteal || hold.current.targetId !== target?.ownerId || !open) cancelHold();
    else if (stealing?.targetId === hold.current.targetId) seenSteal.current = true;
    else if (seenSteal.current) cancelHold();
  }, [canSteal, target?.ownerId, open, stealing, cancelHold]);
  useEffect(() => {
    if (!open) return;
    const outside = (event) => { if (!hud.current?.contains(event.target)) { cancelHold(); setOpen(false); } };
    const escape = (event) => { if (event.key === "Escape") { cancelHold(); setOpen(false); } };
    document.addEventListener("pointerdown", outside);
    window.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); window.removeEventListener("keydown", escape); };
  }, [open, cancelHold]);

  function startHold(source) {
    if (!canSteal || hold.current) return;
    const gesture = { source, targetId: target.ownerId };
    hold.current = gesture;
    seenSteal.current = false;
    setHolding(true); setError("");
    try {
      Promise.resolve(action.current?.("fuel:steal", { targetId: target.ownerId })).then((response) => {
        if (response?.ok === false && hold.current === gesture) {
          cancelHold();
          if (mounted.current) setError(response.message || "지금은 가져올 수 없어요. 잠시 뒤 다시 시도해 주세요.");
        }
      }).catch(() => {
        if (hold.current === gesture) { cancelHold(); if (mounted.current) setError("연결을 확인한 뒤 다시 시도해 주세요."); }
      });
    } catch { cancelHold(); setError("연결을 확인한 뒤 다시 시도해 주세요."); }
  }

  return (
    <aside ref={hud} className={`fuel-hud ${low ? "fuel-low" : ""}`} data-vehicle={bodyId} aria-label="연료와 개인 차고">
      <button className="fuel-pill" aria-expanded={open} aria-controls={panelId} onClick={() => { cancelHold(); setOpen((value) => !value); }}>
        <span className="fuel-pill-icon"><Fuel size={19} strokeWidth={1.65} /></span>
        <span className="fuel-pill-copy">
          <span>{!connected ? "연료 · 내 차고" : !ready ? "연료 확인 중" : <><strong>{amount(tank)}</strong><small> / 100</small><span className="fuel-pill-unit">연료</span></>}</span>
          <small>{!connected ? "온라인 입장 후 이용" : !ready ? "서버에서 불러오고 있어요" : me.carrying ? `연료 ${amount(me.carrying.amount)} 운반 중` : stealing ? "연료를 가져오는 중…" : `Shift 약 ${duration(boostSeconds)}초`}</small>
        </span>
        <ChevronDown size={14} className={open ? "is-open" : ""} />
        {tank !== null && <i className="fuel-pill-level" style={{ width: `${tank}%` }} aria-hidden="true" />}
      </button>

      {!open && ready && (target || stealing) && <div className="fuel-near-hint">
        <button onClick={() => setOpen(true)} aria-controls={panelId} aria-expanded={false}>
          <span>{theftName ? `${theftName}님의 차고` : "이웃 차고"}</span>
          <small>{stealing ? stealRemaining ? `가져오는 중 · ${stealRemaining}초` : "서버 확인 중…" : target.closed ? "문이 닫혀 있어요" : me.carrying ? "운반 중 · 내 차고로" : target.stored <= 0 ? "연료가 비어 있어요" : <><kbd>E</kbd> 3초 누르기 · 버튼 보기</>}</small>
        </button>
        {stealing && <div className="fuel-near-progress" role="progressbar" aria-label="연료 가져오기 진행률" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.floor(progress * 100)}><i style={{ width: `${progress * 100}%` }} /></div>}
      </div>}

      {open && <section id={panelId} className="fuel-panel" aria-label="연료와 내 차고 상세">
        <div className="fuel-panel-heading"><span><Fuel size={16} /> 연료와 내 차고</span><button aria-label="연료 패널 닫기" onClick={() => { cancelHold(); setOpen(false); }}><X size={16} /></button></div>
        {!connected ? <div className="fuel-offline"><p>온라인으로 입장하면 내 차고의 연료를 모으고 이웃과 함께 놀 수 있어요.</p><button onClick={onJoin}>닉네임으로 입장 <ArrowRight size={14} /></button></div> : !ready ? <p className="fuel-note" role="status">내 연료와 차고 정보를 확인하고 있어요.</p> : <>
          <div className="fuel-tank-heading"><span>내 차의 연료</span><strong>{amount(tank)}<small> / 100</small></strong></div>
          <div className="fuel-gauge" role="progressbar" aria-label="차량 연료" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.floor(tank)}><i style={{ width: `${tank}%` }} /></div>
          <div className="fuel-boost-info"><Zap size={13} /><span>Shift 가속 약 <strong>{duration(boostSeconds)}초</strong></span>{consumption > 0 && <small>초당 {consumption.toLocaleString("ko-KR", { maximumFractionDigits: 2 })} 소모</small>}</div>
          <p className="fuel-note">평소 주행과 가속 패드는 연료를 쓰지 않아요.</p>
          {low && <p className="fuel-low-note">{tank < 1 ? "가속 연료가 없어요. 내 차고에서 채워 주세요." : "연료가 얼마 남지 않았어요. 내 차고에 들러 보세요."}</p>}

          {garage && <div className="fuel-garage-card">
            <div className="fuel-garage-title"><span><House size={16} /> 내 차고</span><span className={closedFor ? "fuel-door-closed" : "fuel-door-open"}>{closedFor ? <LockKeyhole size={12} /> : <UnlockKeyhole size={12} />}{closedFor ? `문 닫힘 ${clock(closedFor)}` : "문 열림"}</span></div>
            <div className="fuel-stock"><strong>{amount(garage.stored)}</strong><span> / 200 보관 중</span></div>
            <div className="fuel-production"><Timer size={13} /><span>다음 생산 +{amount(production)}</span><strong>{productionIn ? clock(productionIn) : "생산 확인 중"}</strong></div>
            <p>문 버튼을 차로 밟기 · 주유 구역에서 자동 주유</p>
          </div>}
          {me.carrying && <div className="fuel-carrying" role="status"><Package size={17} /><span><strong>연료 {amount(me.carrying.amount)} 운반 중</strong><small>내 펌프에서 보관한 뒤 탱크에 채워요.</small></span></div>}
          <button className="fuel-home-button" disabled={!onDriveHome} onClick={() => { cancelHold(); onDriveHome?.(); setOpen(false); }}><House size={14} /> 내 차고로 운전하기 <ArrowRight size={14} /></button>
          {!onDriveHome && <p className="fuel-note">경기를 마치면 내 차고로 돌아갈 수 있어요.</p>}

          {target && <div className="fuel-theft">
            <div className="fuel-theft-title"><span>{target.nickname}님의 차고</span><strong>{amount(target.stored)} 연료</strong></div>
            <p id={helpId}>{target.closed ? "문이 닫혀 있어요. 열리면 다시 와 주세요." : me.carrying ? "운반 중인 연료를 먼저 내 차고로 가져가세요." : target.stored <= 0 ? "지금은 가져올 연료가 없어요." : "E 키나 아래 버튼을 3초 누르세요. 버튼에 초점을 두면 스페이스도 가능해요. 놓거나 멀어지면 취소돼요."}</p>
            <button className={`fuel-steal-button ${holding ? "is-holding" : ""}`} disabled={!canSteal} aria-describedby={helpId} aria-pressed={holding}
              onPointerDown={(event) => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture?.(event.pointerId); startHold("pointer"); }}
              onPointerUp={cancelHold} onPointerCancel={cancelHold} onPointerLeave={cancelHold} onLostPointerCapture={cancelHold} onBlur={cancelHold}
              onPointerMove={(event) => { if (hold.current?.source !== "pointer") return; const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) cancelHold(); }}
              onKeyDown={(event) => { if (!["Space", "Enter"].includes(event.code)) return; event.preventDefault(); event.stopPropagation(); if (!event.repeat) startHold("keyboard"); }}
              onKeyUp={(event) => { if (["Space", "Enter"].includes(event.code)) { event.preventDefault(); event.stopPropagation(); cancelHold(); } }}
              onClick={(event) => event.preventDefault()} onContextMenu={(event) => event.preventDefault()}>
              <i style={{ width: `${progress * 100}%` }} aria-hidden="true" /><span><Package size={15} />{stealing ? progress >= 1 ? "서버 확인 중…" : `가져오는 중 ${stealRemaining}초` : holding ? "가져오기 요청 중…" : "3초 눌러 연료 가져오기"}</span>
            </button>
            {(holding || stealing) && <div className="fuel-theft-progress" role="progressbar" aria-label="연료 가져오기 진행률" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.floor(progress * 100)} />}
          </div>}
          {error && <p className="fuel-error" role="alert">{error}</p>}
        </>}
      </section>}
    </aside>
  );
}

export { FuelHud };
