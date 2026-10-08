import { useEffect, useState } from "react";
import {
  ArrowRight,
  CarFront,
  Check,
  CircleDot,
  Crown,
  Eye,
  Flag,
  LogOut,
  Play,
  Trophy,
  Users,
} from "lucide-react";
import { SOCCER, SOCCER_TEAMS } from "./soccerConfig.js";
import "./soccer.css";

const teamName = (team) => (team === "blue" ? "파랑" : "주황");
const resultReasons = {
  goals: `${SOCCER.winningScore}골을 먼저 넣었어요.`,
  team_empty: "한 팀의 참가자가 모두 나가 경기가 종료됐어요.",
  cancelled: "대기 중이던 경기가 취소됐어요.",
  timeout: "경기 시간이 끝나 종료됐어요.",
  server_restart: "서버가 다시 연결되어 경기가 종료됐어요.",
};

function useKickoff(soccer) {
  const [now, setNow] = useState(Date.now());
  const counting = soccer?.status === "countdown" || soccer?.status === "goal";
  useEffect(() => {
    if (!counting) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(timer);
  }, [counting, soccer?.startsAt]);
  return counting && Number.isFinite(soccer.startsAt)
    ? Math.max(0, Math.ceil((soccer.startsAt - now) / 1000))
    : 0;
}

function phaseLabel(soccer, kickoff) {
  if (soccer.status === "waiting") return "친구들을 기다리는 중";
  if (soccer.status === "countdown")
    return kickoff > 0 ? `${kickoff}초 뒤 킥오프` : "킥오프 준비 중";
  if (soccer.status === "goal")
    return `${teamName(soccer.goalTeam)} 팀 골! · 잠시 후 다시 시작해요`;
  return "경기 진행 중";
}

function Scoreboard({ scores = {}, players = [], compact = false }) {
  return (
    <span className={`soccer-scoreboard ${compact ? "compact" : ""}`}>
      <span className="soccer-score-team blue">
        <span className="soccer-team-label">
          <i />
          파랑
        </span>
        <strong>{scores.blue || 0}</strong>
        {!compact && (
          <small>
            {players.filter((player) => player.team === "blue").length}명
          </small>
        )}
      </span>
      <span className="soccer-score-divider" aria-hidden="true">
        :
      </span>
      <span className="soccer-score-team orange">
        <span className="soccer-team-label">
          <i />
          주황
        </span>
        <strong>{scores.orange || 0}</strong>
        {!compact && (
          <small>
            {players.filter((player) => player.team === "orange").length}명
          </small>
        )}
      </span>
    </span>
  );
}

function TeamRoster({
  team,
  soccer,
  playerId,
  member,
  waiting,
  blocked,
  full,
  busy,
  onAction,
}) {
  const players = soccer.players.filter((player) => player.team === team);
  const selected = member?.team === team;
  return (
    <section
      className={`soccer-team-card ${team}`}
      aria-label={`${teamName(team)} 팀`}
    >
      <header>
        <h3>
          <i />
          {teamName(team)} 팀
        </h3>
        <span>{players.length}명</span>
      </header>
      <ul aria-label={`${teamName(team)} 팀 참가자`}>
        {players.map((player) => (
          <li key={player.id}>
            <CarFront size={15} aria-hidden="true" />
            <strong title={player.nickname}>{player.nickname}</strong>
            {player.id === playerId && <em>나</em>}
            {player.id === soccer.hostId && (
              <Crown size={13} aria-label="방장" />
            )}
          </li>
        ))}
        {!players.length && (
          <li className="soccer-team-empty">첫 번째 팀원을 기다려요.</li>
        )}
      </ul>
      {waiting && (
        <button
          className="soccer-team-join"
          disabled={blocked || busy || selected || (!member && full)}
          onClick={() =>
            onAction(member ? "soccer:team" : "soccer:join", {
              soccerId: soccer.id,
              team,
            })
          }
        >
          {selected ? <Check size={14} /> : <ArrowRight size={14} />}
          {selected
            ? "내 팀"
            : !member && full
              ? "참가 인원 마감"
              : member
                ? `${teamName(team)} 팀으로 이동`
                : `${teamName(team)} 팀으로 참가`}
        </button>
      )}
    </section>
  );
}

export function SoccerPanel({ multiplayer, onJoin, onWatch }) {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const soccer = multiplayer.currentSoccer || multiplayer.soccer;
  const playerId = multiplayer.player?.id;
  const available = Boolean(multiplayer.connected && playerId);
  const busy = pending || multiplayer.gameBusy;
  const otherGame = Boolean(
    multiplayer.currentArena || multiplayer.currentRace,
  );
  const players = soccer?.players || [];
  const member = players.find((player) => player.id === playerId);
  const waiting = soccer?.status === "waiting";
  const isHost = member && soccer.hostId === playerId;
  const teamCounts = SOCCER_TEAMS.map(
    (team) => players.filter((player) => player.team === team).length,
  );
  const bothTeams = teamCounts.every((count) => count > 0);
  const full = players.length >= SOCCER.maxPlayers;
  const kickoff = useKickoff(soccer);
  const result = !soccer ? multiplayer.soccerResult : null;

  async function action(type, payload = {}) {
    if (!available || busy) return;
    setPending(true);
    setError("");
    try {
      const response = await multiplayer.gameAction(type, payload);
      if (!response?.ok)
        setError(
          response?.message || "요청을 처리하지 못했어요. 다시 시도해 주세요.",
        );
    } catch {
      setError("연결을 확인한 뒤 다시 시도해 주세요.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="soccer-panel game-panel">
      <div className="modal-eyebrow">
        <CircleDot size={15} /> OUR LITTLE CAR FOOTBALL
      </div>
      <h2 id="modal-title">공 하나, 함께 달리는 우리.</h2>
      <p className="modal-intro">
        차로 공을 밀어 상대 골대에 넣어요. 파랑 팀과 주황 팀, 먼저{" "}
        {SOCCER.winningScore}골을 넣으면 승리!
      </p>
      <div className="soccer-rules" aria-label="축구 경기 규칙">
        <span>
          <Flag size={13} /> 먼저 {SOCCER.winningScore}골
        </span>
        <span>
          <Users size={14} /> 총 {SOCCER.maxPlayers}명까지
        </span>
        <span>참가비 없이 함께</span>
      </div>
      {!available && (
        <div className="soccer-join-note">
          <span>닉네임으로 입장하고 함께 공을 굴려 봐요.</span>
          <button onClick={onJoin}>
            입장하기 <ArrowRight size={14} />
          </button>
        </div>
      )}
      {otherGame && (
        <p className="soccer-notice" role="status">
          참여 중인 다른 경기를 마치거나 나온 뒤 축구에 참가할 수 있어요.
        </p>
      )}

      {!soccer ? (
        <>
          {result && (
            <div className="soccer-result" role="status">
              <Trophy size={23} strokeWidth={1.4} />
              <div>
                <small>지난 경기</small>
                <strong>
                  {result.winnerTeam
                    ? `${teamName(result.winnerTeam)} 팀 승리`
                    : "경기 종료"}
                </strong>
                <p>
                  파랑 {result.scores?.blue || 0} : {result.scores?.orange || 0}{" "}
                  주황 ·{" "}
                  {resultReasons[result.reason] || "함께 달려 줘서 고마워요."}
                </p>
              </div>
            </div>
          )}
          <div className="soccer-empty">
            <div className="soccer-pitch-preview" aria-hidden="true">
              <i />
              <CircleDot size={24} strokeWidth={1.3} />
              <i />
            </div>
            <h3>우리끼리 한 판 어때요?</h3>
            <p>
              1 대 1도, 2 대 3도 좋아요.
              <br />각 팀에 한 명 이상 모이면 방장이 경기를 시작할 수 있어요.
            </p>
            <button
              className="primary-button"
              disabled={!available || otherGame || busy}
              onClick={() => action("soccer:create")}
            >
              <CircleDot size={16} />{" "}
              {pending ? "준비하는 중…" : "축구 경기 만들기"}
            </button>
            <small>새 경기의 방장은 파랑 팀으로 시작해요.</small>
          </div>
          <button
            className="soccer-preview"
            disabled={otherGame}
            onClick={onWatch}
          >
            <Eye size={14} /> 축구장 둘러보기
          </button>
        </>
      ) : (
        <>
          <div
            className={`soccer-match-state ${soccer.status === "goal" ? "is-goal" : ""}`}
          >
            <div className="soccer-match-heading">
              <span>{waiting ? "참가자 모집 중" : "우리들의 축구"}</span>
              <small>
                {players.length} / {SOCCER.maxPlayers}명
              </small>
            </div>
            <Scoreboard scores={soccer.scores} players={players} />
            <p role="status" aria-live="polite">
              {phaseLabel(soccer, kickoff)}
            </p>
          </div>
          <div className="soccer-teams">
            {SOCCER_TEAMS.map((team) => (
              <TeamRoster
                key={team}
                team={team}
                soccer={soccer}
                playerId={playerId}
                member={member}
                waiting={waiting}
                blocked={!available || otherGame}
                full={full}
                busy={busy}
                onAction={action}
              />
            ))}
          </div>
          <p className="soccer-team-balance">
            {bothTeams && teamCounts[0] !== teamCounts[1]
              ? `현재 ${teamCounts[0]} 대 ${teamCounts[1]}이에요. 인원이 달라도 이대로 경기할 수 있어요.`
              : waiting && !bothTeams
                ? "양 팀에 한 명 이상 있어야 시작할 수 있어요."
                : `현재 ${teamCounts[0]} 대 ${teamCounts[1]} · 모두 함께 달려요.`}
          </p>
          <div className="soccer-actions">
            {waiting && isHost && (
              <button
                className="primary-button"
                disabled={!available || !bothTeams || busy || otherGame}
                onClick={() => action("soccer:start", { soccerId: soccer.id })}
              >
                <Play size={15} /> 경기 시작
              </button>
            )}
            {waiting && member && !isHost && (
              <span className="soccer-host-wait">
                방장이 경기를 시작하면 함께 이동해요.
              </span>
            )}
            {!waiting && (
              <button
                className="primary-button"
                disabled={otherGame}
                onClick={onWatch}
              >
                <Eye size={15} /> {member ? "경기장으로 돌아가기" : "관전하기"}
              </button>
            )}
            {member && (
              <button
                className="soccer-leave"
                disabled={!available || busy}
                onClick={() => action("soccer:leave", { soccerId: soccer.id })}
              >
                <LogOut size={14} /> {waiting ? "대기방 나가기" : "경기 나가기"}
              </button>
            )}
          </div>
          {!waiting && !member && (
            <p className="soccer-footnote">
              진행 중인 경기는 관전할 수 있어요. 다음 경기를 함께 기다려요.
            </p>
          )}
        </>
      )}
      {error && (
        <p className="soccer-error" role="alert">
          {error}
        </p>
      )}
      <p className="soccer-footnote">
        팀은 대기 중에 자유롭게 바꿀 수 있어요. 친구들과 함께 가볍게 즐기는
        경기예요.
      </p>
    </section>
  );
}

export function SoccerHud({ soccer, player, open }) {
  const kickoff = useKickoff(soccer);
  if (!soccer) return null;
  const member = soccer.players.find((entry) => entry.id === player?.id);
  return (
    <aside className="soccer-hud" aria-label="차량 축구 경기 상태">
      <button
        onClick={open}
        aria-label={`축구 경기 열기, 파랑 ${soccer.scores.blue} 대 주황 ${soccer.scores.orange}`}
      >
        <span className="soccer-hud-heading">
          <CircleDot size={13} />{" "}
          {member ? `${teamName(member.team)} 팀으로 참가 중` : "축구 관전"}
        </span>
        <Scoreboard scores={soccer.scores} compact />
        <span className="soccer-hud-target">먼저 {SOCCER.winningScore}골</span>
      </button>
      <p role="status" aria-live="polite" aria-atomic="true">
        {phaseLabel(soccer, kickoff)}
      </p>
    </aside>
  );
}
