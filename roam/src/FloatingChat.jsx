import { useLayoutEffect, useRef, useState } from "react";
import { GripVertical, RotateCcw, X } from "lucide-react";
import {
  CHAT_LAYOUT_KEY,
  changeChatLayout,
  defaultChatLayout,
  fitChatLayout,
  validChatLayout,
} from "./chatLayout.js";
import "./floatingChat.css";

function readLayout() {
  try {
    const saved = JSON.parse(localStorage.getItem(CHAT_LAYOUT_KEY));
    return validChatLayout(saved) ? saved : null;
  } catch {
    return null;
  }
}

function remember(layout) {
  try {
    localStorage.setItem(CHAT_LAYOUT_KEY, JSON.stringify(layout));
  } catch {
    // Moving the window still works when browser storage is unavailable.
  }
}

function contentBounds(panel) {
  const parent = panel.parentElement;
  const outer = parent.getBoundingClientRect();
  const header = parent
    .querySelector(":scope > header")
    ?.getBoundingClientRect();
  const footer = parent
    .querySelector(":scope > footer")
    ?.getBoundingClientRect();
  const viewport = window.visualViewport;
  const visibleTop = viewport?.offsetTop || 0;
  const visibleBottom = visibleTop + (viewport?.height || window.innerHeight);
  const visibleLeft = viewport?.offsetLeft || 0;
  const visibleRight = visibleLeft + (viewport?.width || window.innerWidth);
  const left = Math.max(0, visibleLeft - outer.left) + 10;
  const right = Math.max(
    left + 1,
    Math.min(outer.width, visibleRight - outer.left) - 10,
  );
  const top =
    Math.max(visibleTop - outer.top, header ? header.bottom - outer.top : 0) +
    10;
  const bottom = Math.max(
    top + 1,
    Math.min(
      outer.height,
      visibleBottom - outer.top,
      footer ? footer.top - outer.top : Infinity,
    ) - 10,
  );
  return { left, right, top, bottom };
}

export function FloatingChat({ children, onClose }) {
  const panel = useRef(null);
  const current = useRef(null);
  const saved = useRef(undefined);
  if (saved.current === undefined) saved.current = readLayout();
  const gesture = useRef(null);
  const [layout, setLayout] = useState(null);
  const [active, setActive] = useState(null);

  function apply(next) {
    current.current = next;
    setLayout((previous) =>
      previous && Object.keys(next).every((key) => previous[key] === next[key])
        ? previous
        : next,
    );
  }

  useLayoutEffect(() => {
    const node = panel.current;
    const update = () => {
      const bounds = contentBounds(node);
      // Fit the preference temporarily: a mobile keyboard or viewport resize
      // must not overwrite the user's chosen size and position.
      apply(
        fitChatLayout(
          (gesture.current ? current.current : saved.current) ||
            defaultChatLayout(bounds, window.innerWidth <= 760),
          bounds,
        ),
      );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node.parentElement);
    for (const edge of node.parentElement.querySelectorAll(
      ":scope > header, :scope > footer",
    ))
      observer.observe(edge);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update);
    window.visualViewport?.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update);
      window.visualViewport?.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("scroll", update);
    };
  }, []);

  function start(event, mode) {
    if (
      event.button !== 0 ||
      !event.isPrimary ||
      !current.current ||
      gesture.current
    )
      return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      start: current.current,
      mode,
    };
    setActive(mode);
  }

  function move(event) {
    const drag = gesture.current;
    if (!drag || drag.id !== event.pointerId) return;
    apply(
      changeChatLayout(
        drag.start,
        event.clientX - drag.x,
        event.clientY - drag.y,
        drag.mode,
        contentBounds(panel.current),
      ),
    );
  }

  function finish(event, cancelled = false) {
    const drag = gesture.current;
    if (!drag || drag.id !== event.pointerId) return;
    gesture.current = null;
    setActive(null);
    if (cancelled)
      apply(fitChatLayout(drag.start, contentBounds(panel.current)));
    else {
      saved.current = current.current;
      remember(current.current);
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function reset() {
    const next = defaultChatLayout(
      contentBounds(panel.current),
      window.innerWidth <= 760,
    );
    saved.current = null;
    apply(next);
    try {
      localStorage.removeItem(CHAT_LAYOUT_KEY);
    } catch {
      /* Optional preference. */
    }
  }

  function keyboard(event, mode) {
    if (event.key === "Home") {
      event.preventDefault();
      reset();
      return;
    }
    const delta = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    }[event.key];
    if (!delta || !current.current) return;
    event.preventDefault();
    const step = event.shiftKey ? 30 : 10;
    const next = changeChatLayout(
      current.current,
      delta[0] * step,
      delta[1] * step,
      mode,
      contentBounds(panel.current),
    );
    apply(next);
    saved.current = next;
    remember(next);
  }

  const pointerEvents = {
    onPointerMove: move,
    onPointerUp: (event) => finish(event),
    onPointerCancel: (event) => finish(event, true),
    onLostPointerCapture: (event) => finish(event),
  };

  return (
    <section
      ref={panel}
      className={`chat-panel hangout-chat floating-chat${active ? ` is-${active}` : ""}`}
      aria-label="모두의 대화"
      style={
        layout
          ? {
              left: layout.x,
              top: layout.y,
              width: layout.width,
              height: layout.height,
              right: "auto",
              bottom: "auto",
            }
          : undefined
      }
      onKeyDown={(event) => event.stopPropagation()}
    >
      <div className="chat-header">
        <button
          type="button"
          className="chat-drag-handle"
          aria-label="채팅창 이동"
          title="드래그해서 이동 · 방향키로 미세 조절"
          onPointerDown={(event) => start(event, "move")}
          onKeyDown={(event) => keyboard(event, "move")}
          {...pointerEvents}
        >
          <GripVertical size={14} aria-hidden="true" />
          <span className="chat-heading">
            <strong>
              우리들의 수다 <span className="chat-spark">✳</span>
            </strong>
            <span>별일 없는 이야기도 환영이에요.</span>
          </span>
        </button>
        <button
          type="button"
          className="bare-icon chat-reset"
          onClick={reset}
          aria-label="채팅창 위치와 크기 초기화"
          title="기본 위치와 크기로"
        >
          <RotateCcw size={13} />
        </button>
        <button
          type="button"
          className="bare-icon"
          onClick={onClose}
          aria-label="채팅 닫기"
        >
          <X size={18} />
        </button>
      </div>
      {children}
      <button
        type="button"
        className="chat-resize-handle"
        aria-label="채팅창 크기 조절"
        title="드래그해서 크기 조절 · 방향키로 미세 조절"
        onPointerDown={(event) => start(event, "resize")}
        onKeyDown={(event) => keyboard(event, "resize")}
        {...pointerEvents}
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 15 15"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M4 12 12 4M8 12l4-4"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </section>
  );
}
