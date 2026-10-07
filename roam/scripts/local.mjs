import { createServer } from "vite";
import { createGameServer } from "../server/index.js";
import { fileURLToPath } from "node:url";

// Local previews never share a port, gallery, or wallet database with host:pc.
const root = fileURLToPath(new URL("..", import.meta.url));
const server = createGameServer({
  galleryDirectory: fileURLToPath(
    new URL("../data/local/gallery", import.meta.url),
  ),
  playersDirectory: fileURLToPath(
    new URL("../data/local/players", import.meta.url),
  ),
});
let vite;
let stopping = false;
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  await vite?.close();
  await new Promise((resolve) => server.close(resolve));
  process.exitCode = code;
}
try {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(3002, "127.0.0.1", resolve);
  });
  process.env.VITE_MULTIPLAYER_URL = "";
  vite = await createServer({
    root,
    server: {
      host: "127.0.0.1",
      port: 5174,
      strictPort: true,
      proxy: {
        "/gallery": { target: "http://127.0.0.1:3002" },
        "/socket": {
          target: "ws://127.0.0.1:3002",
          ws: true,
          rewrite: () => "/ws",
        },
      },
    },
  });
  await vite.listen();
  console.log("\n로컬 테스트: http://localhost:5174");
  console.log("테스트 사진과 차고지: roam/data/local/ (운영 데이터와 별도)");
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, () => {
      void stop();
    });
} catch (error) {
  console.error(error.message);
  await stop(1);
}
