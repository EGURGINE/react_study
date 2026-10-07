import { Crown, Eye, History, RotateCcw, Trophy } from "lucide-react";
import "./arenaHonors.css";

const number = (value) => value.toLocaleString("ko-KR");
const date = (value) =>
  new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));

export function ArenaChampion({ latest, anchorRef, onWatch, onHistory }) {
  return (
    <aside
      ref={anchorRef}
      className={`world-anchor world-label arena-spectate-label arena-champion ${latest ? "has-champion" : ""}`}
      aria-label="콜로세움 최근 우승자"
    >
      {latest && (
        <div className="arena-champion-name">
          <small>
            <Crown size={12} /> 최근 챔피언
          </small>
          <strong title={latest.nickname}>{latest.nickname}</strong>
        </div>
      )}
      <div className="arena-champion-actions">
        <button
          onClick={onWatch}
          title="자동차는 그대로 두고 콜로세움을 둘러봐요"
        >
          <Eye size={13} /> 관전하기
        </button>
        <button onClick={onHistory}>
          <History size={12} /> 역대 우승
        </button>
      </div>
      <i />
    </aside>
  );
}

export function ArenaHonorsPanel({ record }) {
  const { honors, loaded, loading, error, configured, refresh } = record;
  const empty =
    loaded && !honors.latest && !honors.leaders.length && !honors.recent.length;
  return (
    <section className="arena-honors-panel">
      <div className="modal-eyebrow">
        <Trophy size={15} /> COLOSSEUM HALL OF FAME
      </div>
      <h2 id="modal-title">마지막까지 남은 이름들.</h2>
      <p className="modal-intro">
        콜로세움의 챔피언들을 만나 보세요. 우승할 때마다 기록이 쌓여요.
      </p>
      {honors.latest && (
        <div className="honors-latest">
          <Crown size={25} strokeWidth={1.4} />
          <div>
            <small>최근 챔피언</small>
            <strong>{honors.latest.nickname}</strong>
            <time dateTime={new Date(honors.latest.wonAt).toISOString()}>
              {date(honors.latest.wonAt)}
            </time>
          </div>
          <span>
            {number(honors.latest.pot)}
            <small>획득 코인</small>
          </span>
        </div>
      )}
      <div className="honors-heading">
        <span>
          {loaded ? `지금까지 ${number(honors.total)}번의 우승` : "우승 기록"}
        </span>
        {configured && (
          <button
            onClick={refresh}
            disabled={loading}
            aria-label="우승 기록 새로고침"
          >
            <RotateCcw size={13} /> {loading ? "불러오는 중" : "새로고침"}
          </button>
        )}
      </div>
      {error && (
        <div className="honors-error" role="status">
          <p>{error}</p>
          {configured && (
            <button onClick={refresh} disabled={loading}>
              다시 시도
            </button>
          )}
        </div>
      )}
      {!loaded && loading && (
        <p className="honors-loading" role="status">
          챔피언들의 기록을 불러오고 있어요.
        </p>
      )}
      {empty && !error && (
        <div className="honors-empty">
          <Trophy size={34} strokeWidth={1.1} />
          <h3>첫 우승자를 기다리고 있어요.</h3>
          <p>
            다음 경기의 우승부터 자동으로 기록돼요.
            <br />
            이곳에 가장 먼저 이름을 남겨 보세요.
          </p>
        </div>
      )}
      {!!honors.leaders.length && (
        <section className="honors-ranking">
          <h3>우승 순위</h3>
          <ol aria-label="닉네임별 우승 횟수">
            {honors.leaders.map((leader, index) => (
              <li key={`${leader.nickname}:${leader.lastWonAt}:${index}`}>
                <span className="honors-rank">{index + 1}</span>
                <strong>{leader.nickname}</strong>
                <span className="honors-wins">
                  {number(leader.wins)}
                  <small>승</small>
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}
      {!!honors.recent.length && (
        <section className="honors-recent">
          <div className="honors-heading">
            <h3>최근 우승</h3>
            <span>최신 {honors.recent.length}경기</span>
          </div>
          <ol aria-label="최근 경기 우승 기록">
            {honors.recent.map((winner) => (
              <li key={winner.arenaId}>
                <Trophy size={14} />
                <div>
                  <strong>{winner.nickname}</strong>
                  <time dateTime={new Date(winner.wonAt).toISOString()}>
                    {date(winner.wonAt)} · {winner.players}명 참가
                  </time>
                </div>
                <span>
                  +{number(winner.pot)}
                  <small>코인</small>
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </section>
  );
}
