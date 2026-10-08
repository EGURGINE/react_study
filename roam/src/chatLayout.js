export const CHAT_LAYOUT_KEY = "roam-chat-layout-v1";
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function validChatLayout(value) {
  return (
    value &&
    ["x", "y", "width", "height"].every(
      (key) => typeof value[key] === "number" && Number.isFinite(value[key]),
    ) &&
    value.width > 0 &&
    value.height > 0
  );
}

export function fitChatLayout(layout, bounds) {
  const availableWidth = Math.max(1, bounds.right - bounds.left);
  const availableHeight = Math.max(1, bounds.bottom - bounds.top);
  const width = clamp(
    layout.width,
    Math.min(280, availableWidth),
    Math.min(960, availableWidth),
  );
  const height = clamp(
    layout.height,
    Math.min(250, availableHeight),
    availableHeight,
  );
  return {
    x: clamp(layout.x, bounds.left, bounds.right - width),
    y: clamp(layout.y, bounds.top, bounds.bottom - height),
    width,
    height,
  };
}

export function defaultChatLayout(bounds, mobile = false) {
  return fitChatLayout(
    {
      x: mobile ? bounds.right - 332 : bounds.left + 34,
      y: bounds.bottom - (mobile ? 550 : 370),
      width: 322,
      height: 340,
    },
    bounds,
  );
}

export function changeChatLayout(start, dx, dy, mode, bounds) {
  if (mode === "move") {
    return fitChatLayout(
      { ...start, x: start.x + dx, y: start.y + dy },
      bounds,
    );
  }
  // Resizing keeps the top-left corner fixed, even at the viewport edge.
  return fitChatLayout(
    {
      ...start,
      width: Math.min(start.width + dx, bounds.right - start.x),
      height: Math.min(start.height + dy, bounds.bottom - start.y),
    },
    bounds,
  );
}
