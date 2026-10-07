import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
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
  Paintbrush,
  Flag,
  Sun,
  Moon,
  Sunrise,
  Sunset,
  Trophy,
  History,
  Eye,
} from "lucide-react";
import { createWorld, ZONES } from "./world.js";
import { useMultiplayer } from "./multiplayer.js";
import { preparePhoto } from "./photos.js";
import { useGallery } from "./gallery.js";
import { useArenaHonors } from "./arenaHonors.js";
import { ArenaChampion, ArenaHonorsPanel } from "./ArenaHonors.jsx";
import {
  GaragePanel,
  ArenaPanel,
  ArenaHud,
  RacePanel,
  RaceHud,
  Wallet,
} from "./GamePanels.jsx";
import { LAP_REWARD, DUEL_TRACK, duelPoint, ITEM_BY_ID } from "./gameConfig.js";
import { ARENA } from "./arenaConfig.js";
import "./game.css";
import "./lighting.css";

const TIME_CONTROL_KEY = "roam-time-control-v1";
function initialTimeControl() {
  if (import.meta.env.DEV) {
    const preview = new URLSearchParams(window.location.search).get("time");
    const time = { day: 0, sunset: 150, night: 300 }[preview];
    if (typeof time === "number") return { automatic: false, time };
  }
  try {
    const saved = JSON.parse(localStorage.getItem(TIME_CONTROL_KEY));
    if (
      typeof saved?.automatic === "boolean" &&
      typeof saved.time === "number" &&
      Number.isFinite(saved.time) &&
      saved.time >= 0 &&
      saved.time <= 300
    )
      return { automatic: saved.automatic, time: saved.time };
  } catch {
    // A blocked or invalid preference falls back to the normal island clock.
  }
  return { automatic: true, time: 0 };
}

const photoDate = (value) =>
  new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(value));

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
  const galleryScroll = useRef(0);
  const previousSection = useRef(null);
  useLayoutEffect(() => {
    if (section === "work") {
      ref.current.scrollTop =
        previousSection.current === "photo" ? galleryScroll.current : 0;
    } else if (section === "photo" || section === "honors") {
      ref.current.scrollTop = 0;
    }
    previousSection.current = section;
  }, [section]);
  useEffect(() => {
    if (section) ref.current.showModal();
    else ref.current.close();
  }, [section]);
  return (
    <dialog
      ref={ref}
      className={`modal ${section === "join" ? "join-modal" : ""} ${section === "photo" ? "photo-modal" : ""} ${section === "work" ? "gallery-modal" : ""} ${section === "about" || section === "play" ? "game-modal" : ""}`}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      aria-labelledby="modal-title"
      onScroll={(event) => {
        if (section === "work")
          galleryScroll.current = event.currentTarget.scrollTop;
      }}
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

const mapPoint = ({ x, z }) => ({ x: 100 + x * 3.45, y: 75 + z * 2.5 });
const mapCircuit = (offset) =>
  Array.from({ length: 160 }, (_, index) =>
    mapPoint(duelPoint(index / 160, offset)),
  );
const mapPath = (points) =>
  points
    .map(
      (point, index) =>
        `${index ? "L" : "M"}${point.x.toFixed(2)} ${point.y.toFixed(2)}`,
    )
    .join(" ") + "Z";
const circuitOuter = mapCircuit(DUEL_TRACK.halfWidth);
const circuitInner = mapCircuit(-DUEL_TRACK.halfWidth);
const circuitStart = [
  mapPoint(duelPoint(0, -DUEL_TRACK.halfWidth)),
  mapPoint(duelPoint(0, DUEL_TRACK.halfWidth)),
];
const arenaMapCenter = mapPoint({ x: ARENA.cx, z: ARENA.cz });
const circuitBoundary = {
  left:
    Math.min(
      ...circuitOuter.map((point) => point.x),
      arenaMapCenter.x - ARENA.maxRadius * 3.45,
    ) - 10,
  top:
    Math.min(
      ...circuitOuter.map((point) => point.y),
      arenaMapCenter.y - ARENA.maxRadius * 2.5,
    ) - 10,
  right: Math.max(...circuitOuter.map((point) => point.x)) + 10,
  bottom: Math.max(...circuitOuter.map((point) => point.y)) + 10,
};
const mapViewBox = `${circuitBoundary.left} ${circuitBoundary.top} ${circuitBoundary.right - circuitBoundary.left} ${circuitBoundary.bottom - circuitBoundary.top}`;
const circuitOutlinePath = `${mapPath(circuitOuter)} ${mapPath(circuitInner)}`;
const circuitCenterPath = mapPath(mapCircuit(0));
const circuitStartPath = `M${circuitStart[0].x} ${circuitStart[0].y}L${circuitStart[1].x} ${circuitStart[1].y}`;

function MiniMap({ state, onSelect, large = false, peers = [], arena = null }) {
  const arenaRadius = arena?.radius || ARENA.minRadius;
  return (
    <div className={`minimap ${large ? "large-map" : ""}`}>
      <svg
        viewBox={mapViewBox}
        aria-label="우리 아지트와 아래 순환 레일, 왼쪽 위 콜로세움과 자동차 위치"
      >
        <ellipse
          cx={arenaMapCenter.x}
          cy={arenaMapCenter.y}
          rx={arenaRadius * 3.45}
          ry={arenaRadius * 2.5}
          fill="#dfccb0"
          stroke="#ab8d70"
          strokeWidth="3"
        />
        <ellipse
          cx={arenaMapCenter.x}
          cy={arenaMapCenter.y}
          rx={(arenaRadius - 1.5) * 3.45}
          ry={(arenaRadius - 1.5) * 2.5}
          fill="none"
          stroke="#f9efda"
          strokeWidth="1.5"
          strokeDasharray="5 4"
        />
        <text
          x={arenaMapCenter.x}
          y={arenaMapCenter.y + 3}
          fill="#79634f"
          fontSize="9"
          textAnchor="middle"
        >
          콜로세움
        </text>
        <path
          d={circuitOutlinePath}
          fillRule="evenodd"
          fill="#b6c1a6"
          stroke="#9aa98c"
          strokeWidth="0.7"
        />
        <path
          d={circuitCenterPath}
          fill="none"
          stroke="#e5eddb"
          strokeWidth="1"
          strokeDasharray="4 4"
        />
        <path d={circuitStartPath} stroke="#f8f8ed" strokeWidth="4" />
        <path
          d={circuitStartPath}
          stroke="#435b53"
          strokeWidth="4"
          strokeDasharray="3 3"
        />
        <path d="M100 120V149" fill="none" stroke="#e0d8bf" strokeWidth="15" />
        <path
          d="M58.6 147.5H141.4A17.25 12.5 0 0 1 141.4 172.5H58.6A17.25 12.5 0 0 1 58.6 147.5Z"
          fill="none"
          stroke="#b3b99d"
          strokeWidth="12"
        />
        <path
          d="M58.6 147.5H141.4A17.25 12.5 0 0 1 141.4 172.5H58.6A17.25 12.5 0 0 1 58.6 147.5Z"
          fill="none"
          stroke="#f3f3df"
          strokeWidth="1"
          strokeDasharray="3 5"
        />
        <path d="M100 142V153" stroke="#667f52" strokeWidth="2" />
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
            cx={mapPoint(p).x}
            cy={mapPoint(p).y}
            r="3"
            fill={p.color}
          />
        ))}
        <g
          transform={`translate(${mapPoint({ x: state.x || 0, z: state.z || 0 }).x},${mapPoint({ x: state.x || 0, z: state.z || 0 }).y}) rotate(${(-(state.heading || 0) * 180) / Math.PI})`}
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
      {large && !ZONES.some((zone) => zone.id === "arena") && (
        <button className="map-destination" onClick={() => onSelect("arena")}>
          <span style={{ background: "#ab8d70" }} />
          <span>콜로세움 둘러보기</span>
          <MapPin size={16} />
        </button>
      )}
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
  const [playMode, setPlayMode] = useState("arena");
  const [chatOpen, setChatOpen] = useState(() => window.innerWidth > 760),
    [draft, setDraft] = useState(""),
    [nickname, setNickname] = useState(""),
    [toast, setToast] = useState("");
  const [photoView, setPhotoView] = useState(null),
    [preparing, setPreparing] = useState(false);
  const [timeControl, setTimeControl] = useState(initialTimeControl);
  const [previewVehicle] = useState(() => {
    if (!import.meta.env.DEV) return null;
    const item = ITEM_BY_ID.get(
      new URLSearchParams(window.location.search).get("vehicle"),
    );
    return item?.type === "body" ? item : null;
  });
  const changeTimeControl = (automatic, time) => {
    const next = {
      automatic,
      time: Math.max(0, Math.min(300, Math.round(time))),
    };
    setTimeControl(next);
    try {
      localStorage.setItem(TIME_CONTROL_KEY, JSON.stringify(next));
    } catch {
      // The current tab still follows the selected time when storage is blocked.
    }
  };
  const chatEnd = useRef(null),
    toastTimer = useRef(),
    railAfterJoin = useRef(false);
  const notify = useCallback((text) => {
    setToast(text);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 4000);
  }, []);
  const open = useCallback(
    (id) => setSection(id === "track" ? "play" : id),
    [],
  );
  const receiveInteraction = useCallback(
    (event) => world.current?.applyInteraction(event),
    [],
  );
  const receiveGameEvent = useCallback((event) => {
    if (event.type === "spray") world.current?.applySpray(event.spray);
    if (event.type === "arena:finish" && event.result?.winnerId)
      world.current?.celebrateArena("winner", event.result.arenaId);
  }, []);
  const multiplayer = useMultiplayer(
    stateRef,
    notify,
    receiveInteraction,
    receiveGameEvent,
  );
  const arenaDisplay =
    multiplayer.arenas.find((arena) => arena.status !== "waiting") ||
    multiplayer.currentArena ||
    multiplayer.arenas[0] ||
    null;
  const arenaHonors = useArenaHonors({
    ready,
    open: section === "honors",
    live: multiplayer.arenaHonors,
  });
  const spectatingBlocked =
    ["countdown", "running"].includes(multiplayer.currentArena?.status) ||
    Boolean(multiplayer.currentRace);
  const arenaSpectating = Boolean(state.arenaSpectating) && !spectatingBlocked;
  const gallery = useGallery(
    section === "work" || (section === "photo" && photoView?.archived),
    multiplayer.galleryVersion,
  );

  useEffect(() => {
    try {
      world.current = createWorld(canvasRef.current, {
        onRender: (s) => {
          stateRef.current = s;
          const positions = overlayPositions.current;
          positions.clear();
          positions.set("self", s.car);
          positions.set("arena", s.arenaMarker);
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
        onSpray: () => multiplayer.sprayNow(),
      });
      world.current.setTimeControl(timeControl);
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
    if (ready) world.current?.setTimeControl(timeControl);
  }, [ready, timeControl.automatic, timeControl.time]);
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
    world.current?.setCosmetics(multiplayer.profile?.equipped);
  }, [multiplayer.profile?.equipped]);
  useEffect(() => {
    world.current?.setRace(multiplayer.currentRace);
    if (
      multiplayer.currentRace?.status === "countdown" ||
      multiplayer.currentRace?.status === "racing"
    )
      setSection(null);
  }, [multiplayer.currentRace?.id, multiplayer.currentRace?.status]);
  useEffect(() => {
    if (multiplayer.currentRace) setPlayMode("race");
    else if (multiplayer.currentArena) setPlayMode("arena");
  }, [multiplayer.currentRace?.id, multiplayer.currentArena?.id]);
  useEffect(() => {
    if (ready) world.current?.setArena(multiplayer.currentArena);
  }, [ready, multiplayer.currentArena]);
  useEffect(() => {
    if (ready) world.current?.setArenaDisplay(arenaDisplay);
  }, [ready, arenaDisplay]);
  useEffect(() => {
    if (spectatingBlocked) world.current?.setArenaSpectating(false);
  }, [spectatingBlocked]);
  useEffect(() => {
    if (["countdown", "running"].includes(multiplayer.currentArena?.status))
      setSection(null);
  }, [multiplayer.currentArena?.id, multiplayer.currentArena?.status]);
  useEffect(() => {
    const result = multiplayer.arenaResult;
    if (!result) return;
    if (!result.winnerId)
      notify(
        result.reason === "timeout"
          ? "제한 시간이 끝났어요. 참가비를 돌려받고 아지트로 돌아가요."
          : result.reason === "server_restart"
            ? "경기가 종료되어 참가비를 돌려받았어요."
            : "승자 없이 경기가 끝났어요. 참가비는 모두에게 돌아가요.",
      );
    else if (result.winnerId === multiplayer.player?.id)
      notify(
        `마지막 한 대로 살아남았어요! ${result.pot}코인을 받고 아지트로 돌아가요. 🏆`,
      );
    else
      notify(
        `${result.winnerNickname}님이 마지막까지 살아남았어요. 다음 경기에서 다시 만나요!`,
      );
  }, [multiplayer.arenaResult]);
  useEffect(() => {
    const result = multiplayer.raceResult;
    if (!result) return;
    if (!result.winnerId)
      notify("대결이 종료되었어요. 판돈은 참가자에게 돌아가요.");
    else if (result.winnerId === multiplayer.player?.id)
      notify(
        `${result.reason === "forfeit" ? "상대의 기권으로 승리했어요!" : "결승선에 먼저 도착했어요!"} ${result.pot}코인을 받고 아지트로 돌아가요. 🏁`,
      );
    else
      notify(
        `${result.winnerNickname}님이 승리했어요. 아지트로 돌아가 다음 대결을 준비해요!`,
      );
  }, [multiplayer.raceResult]);
  useEffect(() => {
    if (multiplayer.latestLap) {
      notify(`한 바퀴 완주! +${LAP_REWARD}코인을 모았어요. 🪙`);
      world.current?.rewardLap();
    }
  }, [multiplayer.latestLap]);
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
      !photoView.archived &&
      !multiplayer.photos[photoView.playerId]
    )
      setSection(null);
  }, [multiplayer.photos, section, photoView]);
  useEffect(() => {
    if (previewVehicle) return;
    if (ready && !sessionStorage.getItem("roam-entry-seen")) {
      setSection("join");
      sessionStorage.setItem("roam-entry-seen", "1");
    }
  }, [ready, previewVehicle]);

  const close = () => {
    if (section === "join") {
      multiplayer.cancelJoin();
      railAfterJoin.current = false;
    }
    if (section === "photo" && photoView?.archived) {
      setSection("work");
      return;
    }
    setSection(null);
  };
  async function join(e) {
    e.preventDefault();
    if (await multiplayer.join(nickname)) {
      setSection(null);
      setChatOpen(true);
      if (railAfterJoin.current) {
        railAfterJoin.current = false;
        multiplayer.teleport("track");
      }
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
    const destination = id;
    if (destination === "arena") {
      if (spectatingBlocked) {
        notify("참가 중인 경기가 끝난 뒤 관전할 수 있어요.");
        return;
      }
      world.current?.goTo("arena");
      setSection(null);
      return;
    }
    if (destination === "track" && !multiplayer.connected) {
      railAfterJoin.current = true;
      open("join");
      notify("코인은 닉네임으로 입장한 뒤부터 모을 수 있어요.");
      return;
    }
    const spot = FUN_SPOTS.find((s) => s.id === id);
    if (spot) world.current?.driveTo(spot);
    else if (!multiplayer.teleport(destination))
      world.current?.goTo(destination);
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
        setSection((current) =>
          current === section && current !== "work" ? null : current,
        );
        notify("사진을 갤러리에 남겼어요. 자동차 위에서도 보여요!");
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
  const lighting = state.lighting;
  const lightingPhase = lighting?.phase || "day";
  const lightingLabel = lighting?.label || "낮";
  const progress = Number.isFinite(lighting?.progress) ? lighting.progress : 0;
  const sliderTime = timeControl.automatic
    ? Math.round(
        Math.max(
          0,
          Math.min(300, (progress <= 0.5 ? progress : 1 - progress) * 600),
        ),
      )
    : timeControl.time;
  const timeDescription = timeControl.automatic
    ? "5분에 걸쳐 밤으로, 다음 5분에 걸쳐 다시 낮으로 변해요. 한 주기는 10분이에요."
    : `${lightingLabel}의 시간으로 고정했어요. 자동을 켜면 선택한 시간부터 다시 흘러가요.`;
  const TimeIcon =
    { day: Sun, sunset: Sunset, night: Moon, dawn: Sunrise }[lightingPhase] ||
    Sun;
  const lightingStyle = {
    "--night": lighting?.night || 0,
    "--sky-color": lighting?.skyColor || "#83a6f5",
    "--sky-mid": lighting?.skyMidColor || "#2698a5",
    "--sky-bottom": lighting?.skyBottomColor || "#155f73",
    "--ui-footer-ink": lighting?.ui?.footerInk || "#e8e7d3",
    "--ui-footer-muted": lighting?.ui?.footerMuted || "#d5e5e8",
    "--ui-panel": lighting?.ui?.panel || "#f7f7ef",
    "--ui-ink": lighting?.ui?.ink || "#3c523d",
    "--ui-muted": lighting?.ui?.muted || "#89917c",
    "--ui-border": lighting?.ui?.border || "#dfe5d3",
    "--ui-accent": lighting?.ui?.accent || "#3d6043",
    "--ui-on-accent": lighting?.ui?.onAccent || "#ffffff",
    "--ui-scene-ink": lighting?.ui?.sceneInk || "#354839",
    "--ui-scene-muted": lighting?.ui?.sceneMuted || "#67735f",
    "--ui-scene-accent": lighting?.ui?.sceneAccent || "#3d6043",
    "--ui-danger": lighting?.ui?.danger || "#a6644e",
  };
  const testDrive = !multiplayer.player ? previewVehicle : null;
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
    <main
      className="app social-app"
      data-time-of-day={lightingPhase}
      style={lightingStyle}
    >
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
          <Wallet
            coins={multiplayer.profile?.coins || 0}
            onClick={() => open("about")}
          />
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
          <div
            className="time-control"
            role="group"
            aria-label="아지트 시간 설정"
          >
            <div
              className="time-pill"
              title={`${lightingLabel} · 해와 달을 끌어 시간을 조절해요`}
              style={{
                "--time-progress": sliderTime / 300,
                "--time-dusk": `${Math.min(1, sliderTime / 150) * 100}%`,
                "--time-night": Math.max(0, (sliderTime - 150) / 150),
                "--time-night-blend": `${Math.max(0, (sliderTime - 150) / 150) * 100}%`,
              }}
            >
              <span className="time-pill-night" aria-hidden="true" />
              <span className="time-pill-halo" aria-hidden="true" />
              <svg
                className="time-pill-clouds"
                viewBox="0 0 184 52"
                aria-hidden="true"
              >
                <path
                  opacity=".52"
                  d="M78 52V43a10 10 0 0 1 15-9 14 14 0 0 1 26-3 10 10 0 0 1 16 5 18 18 0 0 1 34-9 12 12 0 0 1 17 7v18Z"
                />
                <path d="M107 52V46a10 10 0 0 1 17-7 11 11 0 0 1 21-2 14 14 0 0 1 24-6 10 10 0 0 1 18 4v17Z" />
                <path
                  opacity=".7"
                  d="M90 20a5 5 0 0 1 8-4 7 7 0 0 1 13-2 5 5 0 0 1 7 6Z"
                />
              </svg>
              <svg
                className="time-pill-stars"
                viewBox="0 0 184 52"
                aria-hidden="true"
              >
                <path d="m25 11 1.5 4 4 1.5-4 1.5-1.5 4-1.5-4-4-1.5 4-1.5Zm43 16 1.2 3.2 3.2 1.2-3.2 1.2-1.2 3.2-1.2-3.2-3.2-1.2 3.2-1.2Zm29-17 1 2.8 2.8 1-2.8 1-1 2.8-1-2.8-2.8-1 2.8-1Z" />
                <circle cx="47" cy="10" r="1.15" />
                <circle cx="42" cy="37" r="1.5" />
                <circle cx="81" cy="13" r=".9" />
                <circle cx="106" cy="38" r="1.1" />
                <circle cx="15" cy="34" r=".85" />
                <circle cx="116" cy="24" r=".9" />
              </svg>
              <span className="time-pill-disc" aria-hidden="true">
                <span className="time-pill-craters">
                  <i />
                  <i />
                  <i />
                </span>
              </span>
              <input
                className="time-pill-input"
                type="range"
                min="0"
                max="300"
                step="1"
                value={sliderTime}
                onChange={(event) =>
                  changeTimeControl(false, Number(event.target.value))
                }
                aria-label="아지트 시간 조절"
                aria-valuetext={`${lightingLabel} · ${timeControl.automatic ? "자동 진행 중" : "시간 고정"}`}
              />
            </div>
            <button
              type="button"
              className="time-auto"
              aria-pressed={timeControl.automatic}
              title={
                timeControl.automatic
                  ? "현재 시간에 멈추기"
                  : "선택한 시간부터 자동으로 흐르기"
              }
              onClick={() =>
                changeTimeControl(!timeControl.automatic, sliderTime)
              }
            >
              Auto
            </button>
          </div>
        </div>
      </header>
      <ArenaHud
        arena={multiplayer.currentArena}
        playerId={multiplayer.player?.id}
        onOpen={() => {
          setPlayMode("arena");
          open("play");
        }}
      />
      {!multiplayer.currentArena && (
        <RaceHud
          race={multiplayer.currentRace}
          onOpen={() => {
            setPlayMode("race");
            open("play");
          }}
        />
      )}
      {!multiplayer.currentRace && !multiplayer.currentArena && (
        <button
          className={`rail-status ${moved ? "has-moved" : ""} ${state.track?.onTrack ? "on-track" : ""}`}
          onClick={() =>
            !multiplayer.connected || !state.track?.onTrack
              ? visit("track")
              : open("play")
          }
        >
          <Flag size={16} />
          <span>
            <strong>
              {state.track?.onTrack && multiplayer.connected
                ? `완주 진행 ${Math.round(multiplayer.lapProgress.progress * 100)}%`
                : "레일 한 바퀴 달리기"}
            </strong>
            <small>
              {multiplayer.connected
                ? `한 바퀴 완주 · +${LAP_REWARD}코인`
                : "닉네임 입장 후 코인 적립"}
            </small>
          </span>
          {state.track?.onTrack && multiplayer.connected && (
            <span
              className="rail-status-progress"
              aria-hidden="true"
              style={{
                "--progress": `${Math.round(multiplayer.lapProgress.progress * 100)}%`,
              }}
            />
          )}
        </button>
      )}
      <div className="world-labels" aria-label="함께 놀 곳">
        {!spectatingBlocked && !arenaSpectating && (
          <ArenaChampion
            latest={arenaHonors.honors.latest}
            anchorRef={anchorRef("arena")}
            onWatch={() => world.current?.setArenaSpectating(true)}
            onHistory={() => open("honors")}
          />
        )}
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
          <MiniMap
            state={state}
            peers={multiplayer.peers}
            arena={arenaDisplay}
          />
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
          className="spray-control"
          onClick={() =>
            multiplayer.player ? multiplayer.sprayNow() : open("join")
          }
          aria-label="장착한 스프레이 뿌리기"
        >
          <kbd>T</kbd> 스프레이
        </button>
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
      {arenaSpectating && (
        <div className="arena-spectator-actions">
          <button
            className="arena-spectator-exit"
            onClick={() => world.current?.setArenaSpectating(false)}
            aria-label="콜로세움 관전을 끝내고 내 자동차 보기"
          >
            <Eye size={16} />
            <span>관전 끝내기</span>
            <X size={14} />
          </button>
          <button
            className="arena-spectator-history"
            onClick={() => open("honors")}
          >
            <History size={14} /> 역대 우승
          </button>
        </div>
      )}
      {nearZone && !section && !arenaSpectating && (
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
      <button
        className="mobile-spray"
        onClick={() =>
          multiplayer.player ? multiplayer.sprayNow() : open("join")
        }
        aria-label="장착한 스프레이 뿌리기"
      >
        <Paintbrush size={19} />
      </button>
      {testDrive?.type === "body" && (
        <aside className="local-drive-banner" aria-label="로컬 차량 시승">
          <strong>{testDrive.name}</strong> 혼자 시승 중
          <a href={import.meta.env.BASE_URL}>시승 종료</a>
        </aside>
      )}
      <footer>
        <span>roam. · 우리들의 작은 아지트</span>
        <span
          className="daytime-indicator"
          title={timeDescription}
          aria-label={`아지트의 시간: ${lightingLabel}. ${timeDescription}`}
        >
          <TimeIcon size={14} strokeWidth={1.6} />
          <span>{lightingLabel}</span>
          <small>
            {timeControl.automatic
              ? "천천히 흐르는 아지트의 시간"
              : "내 화면의 시간 고정"}
          </small>
        </span>
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
            <div className="modal-eyebrow">
              <Camera size={15} /> 01 / OUR PHOTO ALBUM
            </div>
            <h2 id="modal-title">
              오늘의 한 장,
              <br />
              우리의 사진첩.
            </h2>
            <p className="modal-intro">
              좋아하는 풍경, 귀여운 고양이, 오늘 먹은 점심.
              <br />
              함께 올린 순간들은 아지트를 나가도 여기 남아요.
            </p>
            <div className="gallery-toolbar">
              <button
                className="primary-button"
                onClick={choosePhoto}
                disabled={photoBusy}
              >
                <ImagePlus size={17} />
                {photoBusy ? "사진 올리는 중…" : "사진 남기기"}
              </button>
              <span>JPG · PNG · WebP / 최대 12MB</span>
            </div>
            <div className="gallery-heading">
              <span>함께 모은 순간들</span>
              <div>
                <small>최신순</small>
                {gallery.configured && (
                  <button
                    onClick={gallery.refresh}
                    disabled={gallery.loading}
                    aria-label="사진첩 새로고침"
                  >
                    <RotateCcw size={13} /> 새로고침
                  </button>
                )}
              </div>
            </div>
            {gallery.items.length > 0 && (
              <ul className="gallery-grid" aria-label="함께 올린 사진 목록">
                {gallery.items.map((photo) => (
                  <li key={photo.id}>
                    <button
                      className="gallery-card"
                      onClick={() => showPhoto({ ...photo, archived: true })}
                      aria-label={`${photo.nickname}님의 ${photoDate(photo.createdAt)} 사진 크게 보기`}
                    >
                      <img
                        src={photo.src}
                        alt={`${photo.nickname}님이 남긴 사진`}
                        loading="lazy"
                        decoding="async"
                      />
                      <span className="gallery-caption">
                        <strong>{photo.nickname}</strong>
                        <time dateTime={photo.createdAt}>
                          {photoDate(photo.createdAt)}
                        </time>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {!gallery.items.length && !gallery.loading && !gallery.error && (
              <div className="photo-empty gallery-empty">
                <Camera size={37} strokeWidth={1} />
                <span>우리의 첫 번째 사진을 기다리고 있어요.</span>
                <small>오늘의 순간 하나를 남겨 주세요.</small>
              </div>
            )}
            {gallery.error && (
              <div className="gallery-error" role="alert">
                <p>{gallery.error}</p>
                {gallery.configured && (
                  <button onClick={gallery.refresh}>다시 불러오기</button>
                )}
              </div>
            )}
            {gallery.loading && (
              <p className="gallery-loading" role="status">
                사진을 불러오고 있어요…
              </p>
            )}
            {gallery.nextCursor && (
              <button
                className="gallery-more"
                onClick={gallery.loadMore}
                disabled={gallery.loading}
              >
                이전 사진 더 보기 <ArrowDown size={14} />
              </button>
            )}
            <div className="gallery-car-note">
              {ownPhoto && (
                <>
                  <button
                    className="gallery-current"
                    onClick={() => showPhoto(ownPhoto)}
                    aria-label="내 차 위 사진 크게 보기"
                  >
                    <img src={ownPhoto.src} alt="내 차 위에 띄운 사진" />
                  </button>
                  <button
                    className="remove-photo"
                    disabled={photoBusy}
                    onClick={() => multiplayer.sharePhoto(null)}
                  >
                    <Trash2 size={14} /> 차에서 내리기
                  </button>
                </>
              )}
              <p>차 위에서는 내려도, 사진첩에는 그대로 남아요.</p>
            </div>
          </>
        )}
        {section === "about" && (
          <GaragePanel
            multiplayer={multiplayer}
            onJoin={() => open("join")}
            onTrack={() => visit("track")}
          />
        )}
        {section === "honors" && <ArenaHonorsPanel record={arenaHonors} />}
        {section === "play" && (
          <>
            <button className="play-honors-link" onClick={() => open("honors")}>
              <Trophy size={13} /> 역대 우승 보기
            </button>
            <div
              className="play-mode-tabs"
              role="tablist"
              aria-label="같이 놀 게임 선택"
              onKeyDown={(event) => {
                if (
                  !["ArrowLeft", "ArrowRight", "Home", "End"].includes(
                    event.key,
                  )
                )
                  return;
                event.preventDefault();
                const next =
                  event.key === "Home"
                    ? "arena"
                    : event.key === "End"
                      ? "race"
                      : playMode === "arena"
                        ? "race"
                        : "arena";
                setPlayMode(next);
                event.currentTarget.querySelector(`#play-tab-${next}`)?.focus();
              }}
            >
              <button
                id="play-tab-arena"
                role="tab"
                tabIndex={playMode === "arena" ? 0 : -1}
                aria-selected={playMode === "arena"}
                aria-controls="play-mode-panel"
                onClick={() => setPlayMode("arena")}
              >
                <Trophy size={16} /> 콜로세움
              </button>
              <button
                id="play-tab-race"
                role="tab"
                tabIndex={playMode === "race" ? 0 : -1}
                aria-selected={playMode === "race"}
                aria-controls="play-mode-panel"
                onClick={() => setPlayMode("race")}
              >
                <Flag size={16} /> 1대1 레이싱
              </button>
            </div>
            <div
              id="play-mode-panel"
              role="tabpanel"
              aria-labelledby={`play-tab-${playMode}`}
            >
              {playMode === "arena" ? (
                <ArenaPanel
                  multiplayer={multiplayer}
                  onJoin={() => open("join")}
                  onTrack={() => visit("track")}
                  onPreview={() => visit("arena")}
                  onResume={close}
                />
              ) : (
                <RacePanel
                  multiplayer={multiplayer}
                  onJoin={() => open("join")}
                  onTrack={() =>
                    multiplayer.currentRace &&
                    multiplayer.currentRace.status !== "waiting"
                      ? close()
                      : visit("track")
                  }
                />
              )}
            </div>
          </>
        )}
        {section === "map" && (
          <>
            <div className="modal-eyebrow">OUR LITTLE WORLD</div>
            <h2 id="modal-title">어디서 만날까요?</h2>
            <p className="modal-intro">
              만나고 싶은 장소를 골라 이동해요. 왼쪽 위 콜로세움은 참가하지
              않고도 먼저 둘러볼 수 있어요.
            </p>
            <MiniMap
              state={state}
              peers={multiplayer.peers}
              arena={arenaDisplay}
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
                <span>장착한 스프레이 남기기</span>
                <kbd>T</kbd>
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
            <div className="help-photo">
              <Flag size={21} />
              <p>
                맵 아래 레일을 한 바퀴 돌면 <strong>{LAP_REWARD}코인</strong>을
                받아요.
                <br />
                차고지에서 100코인으로 상자를 열어요. 같이 놀자에서는 각
                20코인을 걸고 2–10명이 콜로세움에서 만나요. 마지막까지 경기장에
                남은 한 대가 모인 코인을 모두 받아요. 1대1 레이싱 탭에서는 외곽
                코스 한 바퀴 대결도 즐길 수 있어요.
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
              <span>
                {photoView.archived
                  ? photoDate(photoView.createdAt)
                  : "차에서 내려도 사진첩에는 남아요."}
              </span>
              {photoView.archived && (
                <button className="remove-photo" onClick={() => open("work")}>
                  <ArrowLeft size={15} /> 사진첩으로
                </button>
              )}
              {!photoView.archived &&
                multiplayer.player &&
                photoView.playerId === multiplayer.player.id && (
                  <button
                    className="remove-photo"
                    onClick={async () => {
                      if (await multiplayer.sharePhoto(null)) close();
                    }}
                  >
                    <Trash2 size={15} />
                    차에서 내리기
                  </button>
                )}
            </div>
          </>
        )}
      </Modal>
    </main>
  );
}
