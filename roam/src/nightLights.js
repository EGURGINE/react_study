import * as THREE from "three";

/** Emissive accents stay scene-owned; only three fill lights and one headlight
 * illuminate surfaces. The world disposes the meshes/materials in its final
 * scene traversal after calling this module's dispose(). */
export function createNightLights(scene, car) {
  const root = new THREE.Group();
  root.name = "night-light-accents";
  scene.add(root);
  const luminous = [];
  const pointLights = [];
  let disposed = false;

  function glow(dayColor, nightColor, peak = 3.4, dayIntensity = 0.025) {
    const material = new THREE.MeshStandardMaterial({
      color: dayColor,
      emissive: nightColor,
      emissiveIntensity: dayIntensity,
      roughness: 0.48,
    });
    luminous.push({ material, peak, dayIntensity });
    return material;
  }
  const poleMaterial = new THREE.MeshStandardMaterial({
    color: "#728577",
    roughness: 0.86,
  });
  const baseMaterial = new THREE.MeshStandardMaterial({
    color: "#c9c8a7",
    roughness: 0.92,
  });
  const warmBulb = glow("#fff0cf", "#ffe3a7", 3.2, 0.12);
  const photoTube = glow("#c5dfd0", "#89eaff", 3.2);
  const garageTube = glow("#d3c4d2", "#cc9fff", 4.1);
  const littleStar = glow("#ecdb9e", "#ffdc93", 3.6);

  function mesh(geometry, material, parent = root, x = 0, y = 0, z = 0) {
    const result = new THREE.Mesh(geometry, material);
    result.position.set(x, y, z);
    result.castShadow = false;
    result.receiveShadow = true;
    parent.add(result);
    return result;
  }
  function box(w, h, d, material, parent = root, x = 0, y = 0, z = 0) {
    return mesh(new THREE.BoxGeometry(w, h, d), material, parent, x, y, z);
  }
  function group(x, y, z, rotation = 0) {
    const result = new THREE.Group();
    result.position.set(x, y, z);
    result.rotation.y = rotation;
    root.add(result);
    return result;
  }
  function frame(parent, width, height, material, x, y, z, thickness = 0.047) {
    for (const side of [-1, 1]) {
      box(
        width,
        thickness,
        thickness,
        material,
        parent,
        x,
        y + (side * height) / 2,
        z,
      );
      box(
        thickness,
        height,
        thickness,
        material,
        parent,
        x + (side * width) / 2,
        y,
        z,
      );
    }
  }
  function textSign(parent, text, material, x, y, z, width, height) {
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 192;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "900 120px Arial";
    ctx.fillText(text, 512, 103, 970);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const signMaterial = material.clone();
    signMaterial.map = texture;
    signMaterial.emissiveMap = texture;
    signMaterial.transparent = true;
    signMaterial.depthWrite = false;
    const settings = luminous.find((entry) => entry.material === material);
    luminous.push({ ...settings, material: signMaterial });
    return mesh(
      new THREE.PlaneGeometry(width, height),
      signMaterial,
      parent,
      x,
      y,
      z,
    );
  }

  // These frames sit just in front of the existing gallery poster and cabin.
  const gallery = group(1, 0, -7, -0.08);
  frame(gallery, 4.45, 2.72, photoTube, 0, 1.6, -1.075);
  textSign(gallery, "PHOTO CLUB", photoTube, 0, 3.35, -1.055, 3.5, 0.5);
  const cameraIcon = new THREE.Group();
  cameraIcon.position.set(2.58, 2.87, -1.04);
  gallery.add(cameraIcon);
  frame(cameraIcon, 0.56, 0.38, littleStar, 0, 0, 0, 0.035);
  box(0.2, 0.075, 0.035, littleStar, cameraIcon, -0.08, 0.235, 0);
  mesh(
    new THREE.TorusGeometry(0.115, 0.024, 6, 20),
    littleStar,
    cameraIcon,
    0.04,
    0,
    0.01,
  );

  const garage = group(-8, 0, -1, 0.16);
  frame(garage, 2.44, 0.39, garageTube, 0, 1.96, 1.21);
  textSign(garage, "GARAGE", garageTube, 0, 1.96, 1.245, 1.92, 0.29);
  frame(garage, 0.87, 0.93, garageTube, -0.62, 1.28, 1.175, 0.034);
  frame(garage, 0.67, 1.44, photoTube, 0.62, 0.83, 1.175, 0.026);
  // A small star by the bench gives the cabin a recognizable night landmark.
  const star = new THREE.Shape();
  for (let index = 0; index < 10; index++) {
    const angle = -Math.PI / 2 + (index * Math.PI) / 5;
    const radius = index % 2 ? 0.11 : 0.27;
    if (index) star.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
    else star.moveTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
  }
  star.closePath();
  mesh(new THREE.ShapeGeometry(star), littleStar, garage, 1.93, 1.53, 1.46);

  const lampPositions = [
    [-15, 11, true],
    [15, 7, true],
    [-16, -7, false],
    [12, -13, true],
  ];
  const bulbGeometry = new THREE.IcosahedronGeometry(0.165, 1);
  for (const [x, z, illuminate] of lampPositions) {
    const lamp = group(x, 0, z);
    mesh(
      new THREE.CylinderGeometry(0.062, 0.085, 2.65, 8),
      poleMaterial,
      lamp,
      0,
      1.32,
      0,
    );
    mesh(
      new THREE.CylinderGeometry(0.23, 0.28, 0.13, 8),
      baseMaterial,
      lamp,
      0,
      0.07,
      0,
    );
    box(0.61, 0.075, 0.075, poleMaterial, lamp, 0.22, 2.6, 0);
    mesh(
      new THREE.CylinderGeometry(0.13, 0.29, 0.16, 10),
      poleMaterial,
      lamp,
      0.48,
      2.56,
      0,
    );
    mesh(bulbGeometry, warmBulb, lamp, 0.48, 2.395, 0);
    const cap = mesh(
      new THREE.TorusGeometry(0.21, 0.024, 5, 16),
      warmBulb,
      lamp,
      0.48,
      2.37,
      0,
    );
    cap.rotation.x = Math.PI / 2;
    if (illuminate) {
      const light = new THREE.PointLight("#ffd6a4", 0, 6.5, 2);
      light.position.set(0.48, 2.32, 0);
      light.castShadow = false;
      lamp.add(light);
      pointLights.push(light);
    }
  }

  // Only the glowing geometry belongs to the car, so peer car.clone(true)
  // inherits lamp visuals without duplicating expensive SpotLights.
  const carLamps = new THREE.Group();
  carLamps.name = "vehicle-night-emitters";
  // Follow the same suspension/steering tilt as the body. A sibling lamp can
  // slip into its housing each bounce and make its bloom appear to flash.
  (
    car.getObjectByName("car-body") ||
    car.getObjectByName("car-visual") ||
    car
  ).add(carLamps);
  const headlightMaterial = glow("#fff0bf", "#fff0c7", 4, 0.08);
  const rearMaterial = glow("#db897c", "#ff7991", 4.7, 0.01);
  for (const side of [-1, 1]) {
    box(
      0.232,
      0.162,
      0.04,
      headlightMaterial,
      carLamps,
      side * 0.425,
      0.605,
      1.11,
    );
    box(0.198, 0.128, 0.04, rearMaterial, carLamps, side * 0.425, 0.58, -1.11);
  }
  const headlight = new THREE.SpotLight(
    "#fff0cc",
    0,
    13,
    Math.PI / 5,
    0.72,
    1.5,
  );
  headlight.castShadow = false;
  headlight.name = "local-car-headlight";
  const headlightTarget = new THREE.Object3D();
  headlightTarget.name = "local-car-headlight-target";
  headlight.target = headlightTarget;
  root.add(headlight, headlightTarget);

  function update(nightFactor, elapsed = 0) {
    if (disposed) return;
    const night = Number.isFinite(nightFactor)
      ? THREE.MathUtils.clamp(nightFactor, 0, 1)
      : 0;
    const amount = Math.pow(night, 0.85);
    for (const entry of luminous)
      entry.material.emissiveIntensity =
        entry.dayIntensity + amount * (entry.peak - entry.dayIntensity);
    for (const light of pointLights) {
      light.intensity = amount * 11;
      light.visible = night > 0.015;
    }
    headlight.intensity = amount * 27;
    headlight.visible = night > 0.015;
    const forwardX = Math.sin(car.rotation.y),
      forwardZ = Math.cos(car.rotation.y);
    headlight.position.set(
      car.position.x + forwardX,
      car.position.y + 0.74,
      car.position.z + forwardZ,
    );
    headlightTarget.position.set(
      car.position.x + forwardX * 6,
      0.045,
      car.position.z + forwardZ * 6,
    );
    // A restrained flicker belongs only to the hand-painted star ornament.
    littleStar.emissiveIntensity *=
      1 +
      amount * Math.sin((Number.isFinite(elapsed) ? elapsed : 0) * 1.5) * 0.035;
  }
  update(0, 0);
  return {
    update,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const light of pointLights) {
        light.intensity = 0;
        light.removeFromParent();
      }
      headlight.intensity = 0;
      headlight.removeFromParent();
      headlightTarget.removeFromParent();
      // Keep the emitter meshes attached for the owner's unique-resource
      // disposal pass; removing them here would hide their GPU resources.
    },
  };
}
