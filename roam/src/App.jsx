import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Volume2,
  VolumeX,
  RotateCcw,
  X,
  Plus,
  Compass,
  MapPin,
  MessageCircle,
  Send,
  Users,
  CircleHelp,
  Leaf,
  LogOut,
  Hand,
  ImagePlus,
  MousePointer2,
  Camera,
  Trash2,
} from "lucide-react";
import { createWorld, ZONES } from "./world.js";
import { useMultiplayer } from "./multiplayer.js";
import { preparePhoto } from "./photos.js";

const FUN_SPOTS = [
  {
    id: "campfire",
    title: "불멍 캠핑장",
    detail: "텐트와 전구 아래에서 쉬어요",
    x: -2,
    z: -14,
  },
  {
    id: "crates",
    title: "팡! 터지는 상자",
    detail: "달려가서 살짝 부딪혀 봐요",
    x: -15,
    z: 4,
  },
  {
    id: "boost",
    title: "쌩쌩 부스트",
    detail: "초록 발판을 밟고 가속해요",
    x: 16,
    z: 0,
  },
  {
    id: "bumper",
    title: "통통 범퍼",
    detail: "부딪히면 튕겨 나가요",
    x: -8,
    z: 16,
  },
  {
    id: "jump",
    title: "콩콩 점프패드",
    detail: "파란 발판에서 높이 뛰어요",
    x: 14,
    z: 11,
  },
];

function Modal({ section, onClose, children }) {
  const ref = useRef();
  useEffect(() => {
    if (section) ref.current.showModal();
    else ref.current.close();
  }, [section]);
  return (
    <dialog
      ref={ref}
      className={`modal ${section === "join" ? "join-modal" : ""} ${section === "photo" ? "photo-modal" : ""}`}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      aria-labelledby="modal-title"
    >
      <button
        className="icon-button modal-close"
        aria-label="닫기"
        onClick={onClose}
      >
        <X size={20} />
      </button>
      {children}
    </dialog>
  );
}

function MiniMap({ state, onSelect, large = false, peers = [] }) {
  return (
    <div className={`minimap ${large ? "large-map" : ""}`}>
      <svg viewBox="0 0 200 150" aria-label="우리 아지트 지도와 자동차 위치">
        <ellipse cx="100" cy="75" rx="82" ry="60" fill="#e8dfc8" />
        <ellipse
          cx="100"
          cy="75"
          rx="64"
          ry="46"
          fill="none"
          stroke="#f9f6ed"
          strokeWidth="11"
        />
        <ellipse
          cx="100"
          cy="75"
          rx="64"
          ry="46"
          fill="none"
          stroke="#c7bea7"
          strokeWidth="1"
          strokeDasharray="3 5"
        />
        <path
          d="M100 32V77L54 81M100 77L139 93"
          stroke="#f9f6ed"
          strokeWidth="8"
          fill="none"
        />
        <rect x="48" y="64" width="21" height="14" rx="3" fill="#ba8b72" />
        <rect x="98" y="42" width="24" height="14" rx="2" fill="#8faaa8" />
        <circle cx="145" cy="91" r="12" fill="#b2be8b" />
        <circle cx="94" cy="35" r="5" fill="#d7945f" />
        <rect x="155" y="72" width="8" height="6" rx="2" fill="#aec36a" />
        <circle cx="145" cy="103" r="5" fill="#85adb5" />
        <circle cx="63" cy="111" r="5" fill="#d79782" />
        {peers.map((p) => (
          <circle
            key={p.id}
            cx={100 + p.x * 3.45}
            cy={75 + p.z * 2.5}
            r="3"
            fill={p.color}
          />
        ))}
        <g
          transform={`translate(${100 + (state.x || 0) * 3.45},${75 + (state.z || 0) * 2.5}) rotate(${(-(state.heading || 0) * 180) / Math.PI})`}
        >
          <circle r="7" fill="#f9fff2" opacity=".75" />
          <path d="M0 5L-4-4L0-2L4-4Z" fill="#315e47" />
        </g>
      </svg>
      {large &&
        ZONES.map((z) => (
          <button
            key={z.id}
            className="map-destination"
            onClick={() => onSelect(z.id)}
          >
            <span style={{ background: z.color }} />
            <span>{z.title}</span>
            <MapPin size={16} />
          </button>
        ))}
    </div>
  );
}

function TouchButton({ name, icon: Icon, field, value, world }) {
  const release = () => world.current?.setMobile({ [field]: 0 });
  return (
    <button
      aria-label={name}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        world.current?.setMobile({ [field]: value });
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
    >
      <Icon size={23} />
    </button>
  );
}

export default function App() {
  const canvasRef = useRef(null),
    world = useRef(null),
    fileInput = useRef(null);
  const stateRef = useRef({ x: 1.3, z: 7.8, heading: -Math.PI / 2.4 });
  const overlayNodes = useRef(new Map());
  const overlayPositions = useRef(new Map());
  // World anchors follow the renderer directly; React only updates HUD content.
  function anchorRef(id) {
    return (node) => {
      if (!node) {
        overlayNodes.current.delete(id);
        return;
      }
      overlayNodes.current.set(id, node);
      const point = overlayPositions.current.get(id);
      node.style.visibility = point ? "visible" : "hidden";
      if (point) node.style.translate = `${point.x}px ${point.y}px`;
    };
  }
  const [state, setState] = useState({
    ...stateRef.current,
    speed: 0,
    labels: [],
    driveTime: 0,
  });
  const [section, setSection] = useState(null),
    [muted, setMuted] = useState(true),
    [moved, setMoved] = useState(false),
    [ready, setReady] = useState(false),
    [error, setError] = useState(false);
  const [chatOpen, setChatOpen] = useState(() => window.innerWidth > 760),
    [draft, setDraft] = useState(""),
    [nickname, setNickname] = useState(""),
    [toast, setToast] = useState("");
  const [photoView, setPhotoView] = useState(null),
    [preparing, setPreparing] = useState(false);
  const chatEnd = useRef(null),
    toastTimer = useRef();
  const notify = useCallback((text) => {
    setToast(text);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 4000);
  }, []);
  const open = useCallback((id) => setSection(id), []);
  const receiveInteraction = useCallback(
    (event) => world.current?.applyInteraction(event),
    [],
  );
  const multiplayer = useMultiplayer(stateRef, notify, receiveInteraction);

  useEffect(() => {
    try {
      world.current = createWorld(canvasRef.current, {
        onRender: (s) => {
          stateRef.current = s;
          const positions = overlayPositions.current;
          positions.clear();
          positions.set("self", s.car);
          for (const label of s.labels)
            positions.set(`zone:${label.id}`, label);
          for (const peer of s.peers) positions.set(`peer:${peer.id}`, peer);
          for (const [id, node] of overlayNodes.current) {
            const point = positions.get(id);
            node.style.visibility = point ? "visible" : "hidden";
            if (point) node.style.translate = `${point.x}px ${point.y}px`;
          }
        },
        onFrame: setState,
        onInteract: open,
        onMove: () => setMoved(true),
        onReset: () => multiplayer.teleport("start"),
        onNavigationError: () =>
          notify("길이 막혀 있어요. 조금 옆을 찍어 주세요."),
        onInteraction: (event) => multiplayer.emitInteraction(event),
      });
      setReady(true);
    } catch (e) {
      console.error(e);
      setError(true);
    }
    return () => {
      world.current?.dispose();
      world.current = null;
      clearTimeout(toastTimer.current);
    };
  }, [open, notify, multiplayer.teleport]);
  useEffect(() => {
    world.current?.setPaused(
      Boolean(section) ||
        multiplayer.traveling ||
        preparing ||
        multiplayer.uploading,
    );
  }, [section, multiplayer.traveling, preparing, multiplayer.uploading]);
  useEffect(() => {
    world.current?.setPeers(multiplayer.peers);
  }, [multiplayer.peers]);
  useEffect(() => {
    world.current?.setIdentity(multiplayer.player);
  }, [multiplayer.player]);
  useEffect(() => {
    if (multiplayer.correction)
      world.current?.setPosition(multiplayer.correction);
  }, [multiplayer.correction]);
  useEffect(() => {
    if (!multiplayer.honk) return;
    const who =
      multiplayer.honk.id === multiplayer.player?.id
        ? "내가"
        : multiplayer.peers.find((p) => p.id === multiplayer.honk.id)?.nickname;
    if (who) notify(`${who} 손을 흔들었어요! 👋`);
  }, [multiplayer.honk]);
  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [multiplayer.messages, chatOpen]);
  useEffect(() => {
    if (
      section === "photo" &&
      photoView &&
      !multiplayer.photos[photoView.playerId]
    )
      setSection(null);
  }, [multiplayer.photos, section, photoView]);
  useEffect(() => {
    if (ready && !sessionStorage.getItem("roam-entry-seen")) {
      setSection("join");
      sessionStorage.setItem("roam-entry-seen", "1");
    }
  }, [ready]);

  const close = () => {
    if (section === "join") multiplayer.cancelJoin();
    setSection(null);
  };
  async function join(e) {
    e.preventDefault();
    if (await multiplayer.join(nickname)) {
      setSection(null);
      setChatOpen(true);
    }
  }
  async function send(e) {
    e.preventDefault();
    const submitted = draft;
    if (!submitted.trim()) return;
    if (await multiplayer.send(submitted))
      setDraft((current) => (current === submitted ? "" : current));
  }
  function reset() {
    world.current?.reset();
  }
  function visit(id) {
    const spot = FUN_SPOTS.find((s) => s.id === id);
    if (spot) world.current?.driveTo(spot);
    else if (!multiplayer.teleport(id)) world.current?.goTo(id);
    setSection(null);
  }
  function choosePhoto() {
    if (!multiplayer.player) {
      open("join");
      notify("닉네임을 정하고 들어오면 사진을 함께 볼 수 있어요.");
      return;
    }
    fileInput.current?.click();
  }
  async function uploadPhoto(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setPreparing(true);
    try {
      const src = await preparePhoto(file);
      if (await multiplayer.sharePhoto(src)) {
        close();
        notify("사진이 자동차 위에 올라갔어요. 친구들도 볼 수 있어요!");
      }
    } catch (e) {
      notify(e.message || "이 사진을 열 수 없어요. 다른 사진을 선택해 주세요.");
    } finally {
      setPreparing(false);
    }
  }
  function showPhoto(photo) {
    setPhotoView(photo);
    open("photo");
  }
  const ownPhoto =
    multiplayer.player && multiplayer.photos[multiplayer.player.id];
  const nearZone = ZONES.find((z) => z.id === state.near);
  const photoBusy = preparing || multiplayer.uploading;
  const photoCards = [
    ...multiplayer.peers
      .filter((p) => multiplayer.photos[p.id])
      .map((p) => ({ ...p, photo: multiplayer.photos[p.id] })),
    ...(ownPhoto
      ? [
          {
            id: multiplayer.player.id,
            nickname: multiplayer.player.nickname,
            photo: ownPhoto,
            own: true,
          },
        ]
      : []),
  ];

  return (
    <main className="app social-app">
      <div className="world-gradient" />
      <div ref={canvasRef} className="world-canvas" />
      <input
        ref={fileInput}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={uploadPhoto}
        hidden
        aria-label="공유할 사진 선택"
      />
      <header className="header">
        <button
          className="wordmark"
          onClick={() => {
            reset();
            close();
          }}
          aria-label="시작 위치로"
        >
          roam<span>.</span>
          <i>
            OUR LITTLE
            <br />
            HANGOUT
          </i>
        </button>
        <nav aria-label="아지트 메뉴">
          <button onClick={() => setChatOpen(!chatOpen)}>
            <MessageCircle size={14} />
            같이 이야기해요
          </button>
          <button onClick={choosePhoto} disabled={photoBusy}>
            <ImagePlus size={14} />
            {photoBusy ? "사진 올리는 중…" : "사진 올리기"}
          </button>
          <button onClick={() => open("help")}>
            <CircleHelp size={14} />
            이용 안내
          </button>
        </nav>
        <div className="header-right">
          <span className="availability">잠깐 들러도 좋아요</span>
          <button
            className="icon-button sound-button"
            onClick={() => {
              world.current?.setSound(muted);
              setMuted(!muted);
            }}
            aria-label={muted ? "소리 켜기" : "소리 끄기"}
          >
            {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>
        </div>
      </header>
      <section
        className={`intro ${moved ? "has-moved" : ""}`}
        aria-label="우리들의 아지트"
      >
        <div className="eyebrow">
          <span className="little-line" /> GOOD COMPANY. NO DESTINATION.
        </div>
        <h1>
          작은 세상,
          <br />
          <em>함께라서 좋아.</em>
        </h1>
        <p>
          차를 타고 만나고, 사진과 이야기를 나눠요.
          <br />
          오늘도 우리, 여기서 만나요.
        </p>
        <div className="intro-note">
          <MousePointer2 size={17} /> 우클릭으로 가고 싶은 곳을 콕!
        </div>
      </section>
      <div className="world-labels" aria-label="함께 놀 곳">
        {ZONES.map((label, i) => (
          <button
            key={label.id}
            ref={anchorRef(`zone:${label.id}`)}
            className={`world-anchor world-label ${state.near === label.id ? "near" : ""}`}
            onClick={() => open(label.id)}
          >
            <span className="label-number">0{i + 1}</span>
            <span>{label.title}</span>
            <Plus size={13} />
            <i />
          </button>
        ))}
        {multiplayer.peers
          .filter((p) => !multiplayer.photos[p.id])
          .map((p) => (
            <span
              key={p.id}
              ref={anchorRef(`peer:${p.id}`)}
              className="world-anchor peer-label"
              style={{ borderColor: p.color }}
            >
              {p.nickname}
            </span>
          ))}
        {photoCards.map((p) => (
          <button
            key={p.id}
            ref={anchorRef(p.own ? "self" : `peer:${p.id}`)}
            className={`world-anchor car-photo ${p.own ? "own-photo" : ""}`}
            onClick={() => showPhoto(p.photo)}
            aria-label={`${p.nickname}님의 사진 크게 보기`}
          >
            <img src={p.photo.src} alt={`${p.nickname}님이 공유한 사진`} />
            <span>
              {p.own ? "나의 오늘" : p.nickname}
              <Camera size={9} />
            </span>
            <i />
          </button>
        ))}
        {!moved && !ownPhoto && (
          <span ref={anchorRef("self")} className="world-anchor self-label">
            {multiplayer.player?.nickname || "이 차가 나예요"}
            <span>↓</span>
          </span>
        )}
      </div>
      {error && (
        <div className="graphics-error">
          <Leaf />
          <h2>이야기는 계속할 수 있어요.</h2>
          <p>
            이 브라우저에서는 3D 화면을 열 수 없어요. 채팅과 사진 공유는 사용할
            수 있습니다.
          </p>
          <button className="primary-button" onClick={() => open("join")}>
            대화에 참여하기
          </button>
        </div>
      )}
      <div className="top-right-tools">
        {multiplayer.player && (
          <button
            className="wave-button icon-button"
            aria-label="모두에게 인사하기"
            title="손 흔들기"
            onClick={multiplayer.honkNow}
          >
            <Hand size={16} />
          </button>
        )}
        <button
          className="room-status"
          onClick={() =>
            multiplayer.player ? setChatOpen(!chatOpen) : open("join")
          }
        >
          <Users size={15} />
          <span>
            {multiplayer.player
              ? `${multiplayer.peers.length + 1} / 10 함께하는 중`
              : "닉네임으로 입장"}
          </span>
          <span
            className={`status-light ${multiplayer.connected ? "online" : ""}`}
          />
        </button>
      </div>
      <div className="compass">
        <span>N</span>
        <Compass size={33} strokeWidth={1} />
      </div>

      {chatOpen && (
        <section className="chat-panel hangout-chat" aria-label="모두의 대화">
          <div className="chat-header">
            <div>
              <strong>
                우리들의 수다 <span className="chat-spark">✳</span>
              </strong>
              <span>별일 없는 이야기도 환영이에요.</span>
            </div>
            <button
              className="bare-icon"
              onClick={() => setChatOpen(false)}
              aria-label="채팅 닫기"
            >
              <X size={18} />
            </button>
          </div>
          <div className="chat-people">
            <span
              className={`status-light ${multiplayer.connected ? "online" : ""}`}
            />
            {multiplayer.player
              ? `${multiplayer.peers.length + 1}명이 함께 있어요`
              : "친구들과 같은 공간에서 만나요"}
            {multiplayer.player && (
              <button
                onClick={() => multiplayer.leave()}
                title="아지트 나가기"
                aria-label="아지트 나가기"
              >
                <LogOut size={14} />
              </button>
            )}
          </div>
          <div className="chat-messages" role="log" aria-live="polite">
            {!multiplayer.player ? (
              <div className="chat-welcome">
                <MessageCircle size={23} strokeWidth={1.3} />
                <p>여기 앉아서, 잠깐 수다 어때요?</p>
                <button onClick={() => open("join")}>
                  닉네임 정하고 함께하기
                </button>
              </div>
            ) : multiplayer.messages.length === 0 ? (
              <p className="chat-empty">
                먼저 인사를 건네 보세요.
                <br />
                “안녕!”이면 충분해요.
              </p>
            ) : (
              multiplayer.messages.map((m) => (
                <div
                  className={`chat-message ${m.playerId === multiplayer.player.id ? "mine" : ""}`}
                  key={m.id}
                >
                  <div>
                    <span style={{ color: m.color }}>{m.nickname}</span>
                    <time>
                      {new Date(m.createdAt).toLocaleTimeString("ko-KR", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </time>
                  </div>
                  <p>{m.text}</p>
                </div>
              ))
            )}
            <div ref={chatEnd} />
          </div>
          <form onSubmit={send} className="chat-form">
            <button
              type="button"
              className="chat-photo-button"
              aria-label="채팅에서 사진 올리기"
              title="내 차 위에 사진 올리기"
              onClick={choosePhoto}
              disabled={photoBusy}
            >
              <ImagePlus size={19} />
            </button>
            <input
              aria-label="채팅 메시지"
              placeholder={
                multiplayer.player
                  ? "무슨 이야기든 좋아요…"
                  : "입장 후 이야기를 나눠요"
              }
              maxLength={280}
              value={draft}
              disabled={!multiplayer.player}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
            />
            <button
              aria-label="메시지 보내기"
              disabled={!draft.trim() || !multiplayer.connected}
            >
              <Send size={17} />
            </button>
          </form>
        </section>
      )}

      <aside className="map-card">
        <div className="map-heading">
          <span>OUR LITTLE WORLD</span>
          <button
            className="bare-icon"
            onClick={() => open("map")}
            aria-label="아지트 지도 열기"
          >
            <Plus size={16} />
          </button>
        </div>
        <button
          className="map-open"
          aria-label="지도에서 이동하기"
          onClick={() => open("map")}
        >
          <MiniMap state={state} peers={multiplayer.peers} />
        </button>
        <div className="map-caption">
          <span>
            <i />
            나는 여기
          </span>
          <span>TAKE YOUR TIME</span>
        </div>
      </aside>
      <div className="social-controls">
        <span>
          <MousePointer2 size={13} />
          우클릭 이동
        </span>
        <span>
          <kbd>W A S D</kbd>직접 운전
        </span>
        <button
          onClick={() => {
            reset();
            notify("처음 만났던 자리로 돌아가요.");
          }}
          title="시작 위치로"
          aria-label="시작 위치로 돌아가기"
        >
          <RotateCcw size={14} />
        </button>
        <button onClick={() => open("help")} aria-label="조작 방법">
          <CircleHelp size={14} />
        </button>
      </div>
      {nearZone && !section && (
        <div className="interaction-prompt">
          <button onClick={() => open(nearZone.id)}>
            <kbd>E</kbd>
            {nearZone.title} 둘러보기
          </button>
        </div>
      )}
      <div className="touch-controls">
        <div>
          <TouchButton
            name="왼쪽으로 조향"
            icon={ArrowLeft}
            field="steer"
            value={1}
            world={world}
          />
          <TouchButton
            name="오른쪽으로 조향"
            icon={ArrowRight}
            field="steer"
            value={-1}
            world={world}
          />
        </div>
        <div>
          <TouchButton
            name="후진"
            icon={ArrowDown}
            field="throttle"
            value={-1}
            world={world}
          />
          <TouchButton
            name="전진"
            icon={ArrowUp}
            field="throttle"
            value={1}
            world={world}
          />
        </div>
      </div>
      <button
        className={`chat-toggle ${chatOpen ? "active" : ""}`}
        onClick={() => setChatOpen(!chatOpen)}
        aria-label="채팅 열기"
      >
        <MessageCircle size={20} />
        {multiplayer.player && <span>{multiplayer.peers.length + 1}</span>}
      </button>
      <button
        className="upload-fab"
        onClick={choosePhoto}
        disabled={photoBusy}
        aria-label="내 자동차 위에 사진 올리기"
        title="사진 올리기"
      >
        <ImagePlus size={20} />
      </button>
      <footer>
        <span>roam. · 우리들의 작은 아지트</span>
        <span className="footer-center">어디로 가든, 함께라면.</span>
        <span>
          가볍게 들러요 <span>✳</span>
        </span>
      </footer>
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}

      <Modal section={section} onClose={close}>
        {section === "join" && (
          <>
            <div className="modal-eyebrow">
              <Users size={15} /> A LITTLE BETTER TOGETHER
            </div>
            <div className="join-symbol">
              <Leaf size={34} strokeWidth={1.4} />
            </div>
            <h2 id="modal-title">
              {multiplayer.configured ? (
                <>
                  어떤 이름으로
                  <br />
                  만날까요?
                </>
              ) : (
                <>
                  함께할 공간을
                  <br />
                  준비하고 있어요.
                </>
              )}
            </h2>
            <p className="modal-intro">
              {multiplayer.configured ? (
                <>
                  최대 10명이 함께 머무는 작은 아지트예요.
                  <br />
                  이름을 정하고, 편하게 놀다 가세요.
                </>
              ) : (
                <>
                  멀티플레이 서버가 아직 연결되지 않았어요.
                  <br />
                  지금은 혼자 아지트를 둘러볼 수 있어요.
                </>
              )}
            </p>
            {multiplayer.configured && (
              <form onSubmit={join}>
                <label className="form-label" htmlFor="nickname">
                  나를 부를 이름
                </label>
                <input
                  id="nickname"
                  className="nickname-input"
                  placeholder="닉네임을 알려 주세요"
                  maxLength={18}
                  minLength={2}
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  autoComplete="nickname"
                  autoFocus
                  required
                />
                {multiplayer.error && (
                  <p className="form-error" role="alert">
                    {multiplayer.error}
                  </p>
                )}
                <button
                  className="primary-button join-button"
                  disabled={multiplayer.joining || nickname.trim().length < 2}
                >
                  {multiplayer.joining
                    ? "자리를 찾고 있어요…"
                    : "같이 놀러 가기"}
                  <Leaf size={16} />
                </button>
              </form>
            )}
            <button
              className={
                multiplayer.configured
                  ? "solo-button"
                  : "primary-button join-button"
              }
              onClick={close}
            >
              먼저 혼자 둘러볼게요
            </button>
          </>
        )}
        {section === "work" && (
          <>
            <div className="modal-eyebrow">01 / PHOTO SPOT</div>
            <h2 id="modal-title">
              오늘의 한 장,
              <br />
              같이 볼래요?
            </h2>
            <p className="modal-intro">
              좋아하는 풍경, 귀여운 고양이, 오늘 먹은 점심.
              <br />
              사진을 올리면 내 자동차 위에 함께 떠요.
            </p>
            {ownPhoto ? (
              <button
                className="my-photo-preview"
                onClick={() => showPhoto(ownPhoto)}
              >
                <img src={ownPhoto.src} alt="내가 공유 중인 사진" />
              </button>
            ) : (
              <div className="photo-empty">
                <Camera size={43} strokeWidth={1} />
                <span>어떤 순간을 나누고 싶나요?</span>
              </div>
            )}
            <div className="photo-actions">
              <button
                className="primary-button"
                onClick={choosePhoto}
                disabled={photoBusy}
              >
                <ImagePlus size={17} />
                {photoBusy
                  ? "사진 올리는 중…"
                  : ownPhoto
                    ? "다른 사진 올리기"
                    : "사진 올리기"}
              </button>
              {ownPhoto && (
                <button
                  className="remove-photo"
                  disabled={photoBusy}
                  onClick={() => multiplayer.sharePhoto(null)}
                >
                  <Trash2 size={16} />
                  사진 내리기
                </button>
              )}
            </div>
            <p className="photo-note">
              JPG · PNG · WebP, 최대 12MB
              <br />
              사진은 함께 접속한 사람들에게만 보여요. 아지트를 나가면
              내려갑니다.
            </p>
          </>
        )}
        {section === "about" && (
          <>
            <div className="modal-eyebrow">02 / A PLACE TO STAY</div>
            <h2 id="modal-title">
              아무 얘기나,
              <br />
              천천히 해요.
            </h2>
            <p className="modal-intro">
              특별한 이유가 없어도 괜찮아요.
              <br />
              좋아하는 사진 한 장과 오늘의 이야기를 가져오세요.
            </p>
            <div className="hangout-tips">
              <p>
                <MessageCircle size={20} />
                <span>
                  <strong>안녕, 처음 만나요.</strong>수다창에서 모두와 이야기를
                  나눠요.
                </span>
              </p>
              <p>
                <Camera size={20} />
                <span>
                  <strong>사진이 대화의 시작이 돼요.</strong>자동차 위의 사진을
                  누르면 크게 볼 수 있어요.
                </span>
              </p>
              <p>
                <Hand size={20} />
                <span>
                  <strong>반가운 마음을 전해요.</strong>손 모양 버튼으로
                  모두에게 인사를 건네요.
                </span>
              </p>
            </div>
            <button
              className="primary-button"
              onClick={() => {
                close();
                setChatOpen(true);
              }}
            >
              수다 나누러 가기
            </button>
          </>
        )}
        {section === "play" && (
          <>
            <div className="modal-eyebrow">03 / A HAPPY DETOUR</div>
            <h2 id="modal-title">
              가끔은,
              <br />
              딴짓도 좋아요.
            </h2>
            <p className="modal-intro">
              친구가 올 때까지 한 바퀴 돌거나, 같이 콩콩 뛰어봐요.
            </p>
            <div className="play-options">
              <button onClick={() => visit("play")}>
                <span className="play-icon">
                  <ArrowUp />
                </span>
                <div>
                  <h3>트램펄린에서 콩콩</h3>
                  <p>동그란 트램펄린 위로 차를 몰아보세요.</p>
                </div>
                <Plus size={20} />
              </button>
              <button
                onClick={() => {
                  reset();
                  close();
                }}
              >
                <span className="play-icon">
                  <Compass />
                </span>
                <div>
                  <h3>아지트 한 바퀴</h3>
                  <p>우클릭으로 목적지를 찍거나, Shift를 누르고 달려요.</p>
                </div>
                <Plus size={20} />
              </button>
            </div>
          </>
        )}
        {section === "map" && (
          <>
            <div className="modal-eyebrow">OUR LITTLE WORLD</div>
            <h2 id="modal-title">어디서 만날까요?</h2>
            <p className="modal-intro">
              한 장소를 골라 바로 이동할 수도 있어요.
            </p>
            <MiniMap
              state={state}
              peers={multiplayer.peers}
              onSelect={visit}
              large
            />
            <div className="fun-spots">
              {FUN_SPOTS.map((spot) => (
                <button key={spot.id} onClick={() => visit(spot.id)}>
                  <span>
                    <strong>{spot.title}</strong>
                    <small>{spot.detail}</small>
                  </span>
                  <MapPin size={16} />
                </button>
              ))}
            </div>
          </>
        )}
        {section === "help" && (
          <>
            <div className="modal-eyebrow">처음 왔나요? 반가워요.</div>
            <h2 id="modal-title">같이 노는 방법.</h2>
            <div className="help-rows">
              <p>
                <span>원하는 곳으로 자동 이동 · 휠로 확대/축소</span>
                <kbd>마우스 우클릭</kbd>
              </p>
              <p>
                <span>직접 운전 · 자동 이동 취소</span>
                <kbd>W A S D</kbd>
                <kbd>방향키</kbd>
              </p>
              <p>
                <span>조금 더 빠르게</span>
                <kbd>SHIFT</kbd>
              </p>
              <p>
                <span>잠깐 멈추기</span>
                <kbd>SPACE</kbd>
              </p>
              <p>
                <span>가까운 장소 둘러보기</span>
                <kbd>E</kbd>
              </p>
              <p>
                <span>시작 위치로 돌아가기</span>
                <kbd>R</kbd>
              </p>
            </div>
            <div className="help-photo">
              <ImagePlus size={21} />
              <p>
                <strong>사진 올리기</strong>로 내 차 위에 사진을 띄워요.
                <br />
                다른 사람의 사진을 누르면 크게 볼 수 있어요.
              </p>
            </div>
            <p className="modal-intro">
              휴대폰에서는 아래쪽 방향 버튼으로 운전할 수 있어요. 서로 기분 좋은
              이야기를 나눠주세요.
            </p>
          </>
        )}
        {section === "photo" && photoView && (
          <>
            <div className="modal-eyebrow">
              <Camera size={14} />
              {photoView.nickname}님의 오늘
            </div>
            <h2 id="modal-title" className="sr-only">
              {photoView.nickname}님이 공유한 사진
            </h2>
            <img
              className="full-photo"
              src={photoView.src}
              alt={`${photoView.nickname}님이 공유한 사진`}
            />
            <div className="photo-lightbox-footer">
              <span>이 순간을 함께 보고 있어요.</span>
              {photoView.playerId === multiplayer.player?.id && (
                <button
                  className="remove-photo"
                  onClick={async () => {
                    if (await multiplayer.sharePhoto(null)) close();
                  }}
                >
                  <Trash2 size={15} />
                  사진 내리기
                </button>
              )}
            </div>
          </>
        )}
      </Modal>
    </main>
  );
}
