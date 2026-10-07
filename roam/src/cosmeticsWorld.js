import * as THREE from "three";
import { ITEM_BY_ID, STARTER_EQUIPPED, isDriveable } from "./gameConfig.js";
import { BODY_STYLES } from "./cosmeticsCatalog.js";
import { buildCarShell, CAR_WHEELS } from "./carModels.js";

/** Independent shells share the world's wheel pivots and lamp emitters. */
export function installCarBodies(carBody) {
  const jeep = new THREE.Group();
  jeep.name = "body-jeep";
  for (const child of [...carBody.children]) jeep.add(child);
  carBody.add(jeep);
  // Tag only the four existing wheel assemblies; their transforms and tags
  // survive car.clone(true), while the world retains its steering references.
  for (const child of carBody.parent?.children || []) {
    if (child === carBody || child.children.length !== 2) continue;
    if (
      !child.children.every(
        (part) => part.geometry?.type === "CylinderGeometry",
      )
    )
      continue;
    child.userData.carWheel = {
      side: Math.sign(child.position.x),
      axle: Math.sign(child.position.z),
    };
  }
  for (const style of BODY_STYLES.filter((style) => style !== "jeep")) {
    const shell = new THREE.Group();
    shell.name = "body-" + style;
    shell.visible = false;
    carBody.add(shell);
    buildCarShell(shell, style);
  }
}

export function applyCarCosmetics(
  model,
  equipped = STARTER_EQUIPPED,
  fallbackColor = "#a5bf90",
) {
  const selected = { ...STARTER_EQUIPPED };
  for (const type of ["body", "trail", "spray"]) {
    if (ITEM_BY_ID.get(equipped?.[type])?.type === type)
      selected[type] = equipped[type];
  }
  const body = ITEM_BY_ID.get(selected.body);
  for (const style of BODY_STYLES) {
    const shell = model.getObjectByName(`body-${style}`);
    if (shell) shell.visible = style === body.style;
  }
  model.traverse((object) => {
    if (object.isMesh && object.userData.isBody)
      object.material.color.set(body.color || fallbackColor);
    if (object.userData.carWheel) {
      const [spread, axle, radius, width] =
        CAR_WHEELS[body.style] || CAR_WHEELS.jeep;
      object.position.set(
        object.userData.carWheel.side * spread,
        radius - 0.01,
        object.userData.carWheel.axle * axle,
      );
      object.scale.set(width / 0.24, radius / 0.32, radius / 0.32);
    }
  });
  model.userData.cosmetics = selected;
}

function drawExtraSpray(ctx, item) {
  const circle = (x, y, radius) => {
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  };
  const line = (points) => {
    ctx.beginPath();
    points.forEach(([x, y], index) =>
      index ? ctx.lineTo(x, y) : ctx.moveTo(x, y),
    );
    ctx.stroke();
  };
  const polygon = (points) => {
    ctx.beginPath();
    points.forEach(([x, y], index) =>
      index ? ctx.lineTo(x, y) : ctx.moveTo(x, y),
    );
    ctx.closePath();
    ctx.fill();
  };
  const style = item.style;
  if (style === "star" || style === "sun") {
    if (style === "star")
      polygon(
        Array.from({ length: 10 }, (_, i) => {
          const angle = -Math.PI / 2 + (i * Math.PI) / 5,
            r = i % 2 ? 34 : 81;
          return [Math.cos(angle) * r, Math.sin(angle) * r];
        }),
      );
    else {
      circle(0, 0, 43);
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        line([
          [Math.cos(a) * 62, Math.sin(a) * 62],
          [Math.cos(a) * 82, Math.sin(a) * 82],
        ]);
      }
    }
  } else if (style === "moon") {
    circle(0, 0, 76);
    ctx.fillStyle = "#fff4d6";
    circle(29, -26, 65);
    ctx.fillStyle = item.color;
    circle(57, 38, 7);
    circle(-51, -55, 5);
  } else if (style === "leaf") {
    ctx.beginPath();
    ctx.moveTo(-61, 70);
    ctx.bezierCurveTo(-99, -3, -17, -89, 69, -72);
    ctx.bezierCurveTo(76, 21, 15, 76, -61, 70);
    ctx.fill();
    ctx.strokeStyle = "#fff4d6";
    ctx.lineWidth = 8;
    line([
      [-56, 62],
      [47, -47],
    ]);
    line([
      [-18, 20],
      [-45, -12],
    ]);
    line([
      [9, -8],
      [38, 7],
    ]);
  } else if (style === "paw") {
    ctx.beginPath();
    ctx.ellipse(0, 33, 49, 42, 0, 0, Math.PI * 2);
    ctx.fill();
    for (const [x, y] of [
      [-62, -21],
      [-24, -51],
      [24, -51],
      [62, -21],
    ]) {
      ctx.beginPath();
      ctx.ellipse(x, y, 18, 25, x / 150, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (style === "coffee") {
    ctx.beginPath();
    ctx.roundRect(-61, -18, 106, 84, [5, 5, 29, 29]);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(49, 11, 29, -Math.PI / 2, Math.PI / 2);
    ctx.stroke();
    line([
      [-71, 79],
      [61, 79],
    ]);
    for (const x of [-31, 0, 29])
      line([
        [x, -42],
        [x - 6, -59],
        [x + 2, -78],
      ]);
  } else if (style === "music") {
    ctx.lineWidth = 16;
    line([
      [-32, 45],
      [-32, -48],
      [53, -70],
      [53, 23],
    ]);
    line([
      [-32, -21],
      [53, -44],
    ]);
    ctx.beginPath();
    ctx.ellipse(-47, 51, 26, 19, -0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(38, 30, 26, 19, -0.4, 0, Math.PI * 2);
    ctx.fill();
  } else if (style === "peace") {
    ctx.lineWidth = 11;
    ctx.beginPath();
    ctx.arc(0, 0, 76, 0, Math.PI * 2);
    ctx.stroke();
    line([
      [0, -72],
      [0, 72],
    ]);
    line([
      [-52, 54],
      [0, 0],
      [52, 54],
    ]);
  } else if (style === "rocket") {
    ctx.save();
    ctx.rotate(0.5);
    ctx.beginPath();
    ctx.moveTo(0, -89);
    ctx.bezierCurveTo(57, -35, 40, 24, 26, 51);
    ctx.lineTo(-26, 51);
    ctx.bezierCurveTo(-40, 24, -57, -35, 0, -89);
    ctx.fill();
    polygon([
      [-27, 15],
      [-63, 58],
      [-25, 47],
    ]);
    polygon([
      [27, 15],
      [63, 58],
      [25, 47],
    ]);
    polygon([
      [-18, 60],
      [0, 94],
      [18, 60],
    ]);
    ctx.fillStyle = "#fff4d6";
    circle(0, -16, 19);
    ctx.restore();
  } else if (style === "cloud") {
    circle(-46, 16, 34);
    circle(-5, -10, 47);
    circle(43, 12, 38);
    ctx.fillRect(-47, 11, 92, 41);
  } else if (style === "clover") {
    for (const [x, y] of [
      [-29, -31],
      [29, -31],
      [-29, 27],
      [29, 27],
    ])
      circle(x, y, 34);
    line([
      [0, 18],
      [12, 77],
    ]);
  } else if (style === "diamond") {
    polygon([
      [-80, -25],
      [-45, -68],
      [45, -68],
      [80, -25],
      [0, 83],
    ]);
    ctx.strokeStyle = "#fff4d6";
    ctx.lineWidth = 7;
    line([
      [-72, -25],
      [72, -25],
    ]);
    line([
      [-39, -60],
      [-23, -25],
      [0, 73],
      [23, -25],
      [39, -60],
    ]);
  } else if (style === "flag") {
    line([
      [-54, -81],
      [-54, 81],
    ]);
    polygon([
      [-48, -77],
      [71, -77],
      [44, -30],
      [71, 16],
      [-48, 16],
    ]);
  } else if (style === "planet") {
    circle(0, 0, 56);
    ctx.lineWidth = 11;
    ctx.beginPath();
    ctx.ellipse(0, 0, 96, 28, -0.45, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#fff4d6";
    circle(-20, -21, 10);
  } else return false;
  return true;
}

export function createSprayCanvas(item) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext("2d");
  ctx.translate(128, 128);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.fillStyle = "#fff4d6";
  ctx.globalAlpha = 0.86;
  ctx.beginPath();
  ctx.ellipse(0, 0, 103, 98, -0.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = item.color;
  ctx.strokeStyle = item.color;
  ctx.lineWidth = 13;
  const poly = (points) => {
    ctx.beginPath();
    points.forEach(([x, y], index) =>
      index ? ctx.lineTo(x, y) : ctx.moveTo(x, y),
    );
    ctx.closePath();
    ctx.fill();
  };
  if (item.style === "heart") {
    ctx.beginPath();
    ctx.moveTo(0, 71);
    ctx.bezierCurveTo(-132, -2, -67, -100, 0, -40);
    ctx.bezierCurveTo(67, -100, 132, -2, 0, 71);
    ctx.fill();
  } else if (item.style === "lightning") {
    poly([
      [8, -86],
      [-58, 17],
      [-9, 10],
      [-24, 86],
      [65, -30],
      [15, -20],
      [38, -86],
    ]);
  } else if (item.style === "crown") {
    poly([
      [-80, -43],
      [-49, 54],
      [48, 54],
      [80, -43],
      [35, -10],
      [0, -75],
      [-34, -10],
    ]);
    ctx.fillStyle = "#fff4d6";
    for (const x of [-36, 0, 36]) {
      ctx.beginPath();
      ctx.arc(x, 30, 7, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (item.style === "flower") {
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3;
      ctx.beginPath();
      ctx.ellipse(
        Math.cos(a) * 39,
        Math.sin(a) * 39,
        31,
        29,
        a,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    ctx.fillStyle = "#e8c65f";
    ctx.beginPath();
    ctx.arc(0, 0, 28, 0, Math.PI * 2);
    ctx.fill();
  } else if (item.style === "smile") {
    ctx.beginPath();
    ctx.arc(0, 0, 75, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#42614c";
    ctx.strokeStyle = "#42614c";
    ctx.lineWidth = 9;
    for (const x of [-27, 27]) {
      ctx.beginPath();
      ctx.arc(x, -20, 8, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(0, 6, 38, 0.12, Math.PI - 0.12);
    ctx.stroke();
  } else if (!drawExtraSpray(ctx, item)) {
    ctx.save();
    ctx.rotate(-0.25);
    ctx.beginPath();
    ctx.roundRect(-39, -14, 77, 87, 28);
    ctx.fill();
    for (const [x, y] of [
      [-30, -58],
      [-9, -77],
      [13, -80],
      [34, -64],
    ]) {
      ctx.beginPath();
      ctx.moveTo(x, 6);
      ctx.lineTo(x, y);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(-28, 37);
    ctx.lineTo(-69, -1);
    ctx.stroke();
    ctx.restore();
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.arc(28, -34, 67, -0.75, 0.2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(30, -35, 85, -0.65, 0.13);
    ctx.stroke();
  }
  return canvas;
}

export function sprayTexture(item) {
  const texture = new THREE.CanvasTexture(createSprayCanvas(item));
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createCosmeticsEffects(scene) {
  const root = new THREE.Group();
  root.name = "cosmetic-effects";
  scene.add(root);
  const star = new THREE.Shape();
  for (let index = 0; index < 10; index++) {
    const angle = -Math.PI / 2 + (index * Math.PI) / 5;
    const radius = index % 2 ? 0.062 : 0.155;
    if (index) star.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
    else star.moveTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
  }
  star.closePath();
  const heart = new THREE.Shape();
  heart.moveTo(0, -0.17);
  heart.bezierCurveTo(-0.27, 0.01, -0.16, 0.24, 0, 0.1);
  heart.bezierCurveTo(0.16, 0.24, 0.27, 0.01, 0, -0.17);
  const leaf = new THREE.Shape();
  leaf.moveTo(-0.14, -0.16);
  leaf.bezierCurveTo(-0.24, 0.05, -0.02, 0.24, 0.15, 0.16);
  leaf.bezierCurveTo(0.24, -0.05, 0.02, -0.24, -0.14, -0.16);
  const snow = new THREE.Shape();
  for (let i = 0; i < 12; i++) {
    const a = (i * Math.PI) / 6,
      r = i % 2 ? 0.055 : 0.17;
    if (i) snow.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    else snow.moveTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  snow.closePath();
  const geometries = {
    dust: new THREE.IcosahedronGeometry(0.11, 0),
    bubbles: new THREE.SphereGeometry(0.115, 8, 6),
    stars: new THREE.ExtrudeGeometry(star, {
      depth: 0.025,
      bevelEnabled: false,
    }),
    rainbow: new THREE.BoxGeometry(0.15, 0.06, 0.25),
    leaves: new THREE.ShapeGeometry(leaf),
    sparks: new THREE.ConeGeometry(0.055, 0.27, 5),
    hearts: new THREE.ExtrudeGeometry(heart, {
      depth: 0.028,
      bevelEnabled: false,
    }),
    snow: new THREE.ShapeGeometry(snow),
    petals: new THREE.SphereGeometry(0.14, 7, 5).scale(0.65, 1, 0.22),
    embers: new THREE.IcosahedronGeometry(0.09, 0),
    diamonds: new THREE.OctahedronGeometry(0.17, 0),
    confetti: new THREE.BoxGeometry(0.14, 0.035, 0.1),
  };
  const particles = Array.from({ length: 160 }, () => {
    const material = new THREE.MeshStandardMaterial({
      color: "#ffffff",
      roughness: 0.75,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometries.dust, material);
    mesh.visible = false;
    root.add(mesh);
    return {
      mesh,
      life: 0,
      duration: 1,
      rise: 0,
      spin: 0,
      scale: 1,
      opacity: 1,
    };
  });
  let cursor = 0;
  const lastTrail = new WeakMap();
  const stickers = [];
  function removeSticker(sticker) {
    root.remove(sticker.mesh);
    sticker.mesh.geometry.dispose();
    sticker.mesh.material.map.dispose();
    sticker.mesh.material.dispose();
  }
  return {
    trail(model, speed, dt, elapsed) {
      const item = ITEM_BY_ID.get(model.userData.cosmetics?.trail);
      if (
        !item ||
        item.type !== "trail" ||
        item.style === "none" ||
        Math.abs(speed) < 0.6
      )
        return;
      const since = (lastTrail.get(model) || 0) + dt;
      if (since < 0.065) {
        lastTrail.set(model, since);
        return;
      }
      lastTrail.set(model, 0);
      for (const side of [-1, 1]) {
        const particle = particles[cursor++ % particles.length];
        const heading = model.rotation.y + (speed < 0 ? Math.PI : 0);
        particle.mesh.geometry = geometries[item.style] || geometries.dust;
        particle.mesh.position.set(
          model.position.x -
            Math.sin(heading) * 0.94 +
            Math.cos(heading) * side * 0.4,
          0.18 + model.position.y,
          model.position.z -
            Math.cos(heading) * 0.94 -
            Math.sin(heading) * side * 0.4,
        );
        particle.mesh.material.color.set(item.color);
        if (item.style === "rainbow" || item.id === "trail-festival")
          particle.mesh.material.color.setHSL(
            (elapsed * 0.22 + (cursor % 7) / 7) % 1,
            0.7,
            0.64,
          );
        particle.opacity = item.style === "bubbles" ? 0.48 : 0.77;
        particle.mesh.material.emissive.copy(particle.mesh.material.color);
        particle.mesh.material.emissiveIntensity = [
          "embers",
          "sparks",
        ].includes(item.style)
          ? 1.6
          : ["stars", "diamonds", "snow"].includes(item.style)
            ? 0.45
            : 0.03;
        particle.mesh.visible = true;
        particle.duration = ["bubbles", "hearts", "snow", "petals"].includes(
          item.style,
        )
          ? 1.4
          : item.style === "sparks"
            ? 0.58
            : 0.92;
        particle.life = particle.duration;
        particle.scale = 0.8 + Math.random() * 0.6;
        particle.rise = ["bubbles", "hearts", "embers"].includes(item.style)
          ? 0.8
          : ["snow", "petals", "leaves"].includes(item.style)
            ? 0.36
            : 0.2;
        particle.spin = (Math.random() - 0.5) * 5;
        particle.mesh.rotation.set(
          Math.random() * 2,
          heading,
          Math.random() * 2,
        );
      }
    },
    spray(event, elapsed) {
      const item = ITEM_BY_ID.get(event?.itemId);
      if (!item || item.type !== "spray" || !isDriveable(event.x, event.z))
        return false;
      if (stickers.length >= 40) removeSticker(stickers.shift());
      const material = new THREE.MeshStandardMaterial({
        map: sprayTexture(item),
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        side: THREE.DoubleSide,
        roughness: 1,
      });
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(2.05, 2.05),
        material,
      );
      mesh.position.set(event.x, 0.082, event.z);
      mesh.rotation.set(
        -Math.PI / 2,
        0,
        (event.heading || 0) + (Math.random() - 0.5) * 0.25,
      );
      root.add(mesh);
      stickers.push({ mesh, born: elapsed });
      return true;
    },
    update(dt, elapsed) {
      for (const particle of particles) {
        if (particle.life <= 0) continue;
        particle.life -= dt;
        const fraction = Math.max(0, particle.life / particle.duration);
        particle.mesh.visible = fraction > 0;
        particle.mesh.material.opacity = fraction * particle.opacity;
        particle.mesh.position.y += dt * particle.rise;
        particle.mesh.rotation.z += particle.spin * dt;
        particle.mesh.scale.setScalar(particle.scale * (0.6 + fraction * 0.65));
      }
      for (let index = stickers.length - 1; index >= 0; index--) {
        const age = elapsed - stickers[index].born;
        if (age >= 30) {
          removeSticker(stickers[index]);
          stickers.splice(index, 1);
        } else
          stickers[index].mesh.material.opacity = Math.min(0.9, (30 - age) / 6);
      }
    },
    dispose() {
      for (const sticker of stickers) removeSticker(sticker);
      stickers.length = 0;
      for (const geometry of Object.values(geometries)) geometry.dispose();
    },
  };
}
