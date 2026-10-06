import * as THREE from 'three';

export const ZONES = [
  { id: 'work', title: 'Selected work', subtitle: 'Ideas made real', x: 1, z: -7, color: '#a9bec4' },
  { id: 'about', title: 'A little about me', subtitle: 'The person behind the wheel', x: -8, z: -1, color: '#dba68b' },
  { id: 'play', title: 'The playground', subtitle: 'Follow your curiosity', x: 8, z: 4, color: '#b7ba90' },
];
const START = { x: 1.3, z: 7.8, heading: -Math.PI / 2.4 };

export function createWorld(host, callbacks) {
  const scene = new THREE.Scene();
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.7));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.setClearColor(0x000000, 0);
  host.appendChild(renderer.domElement);
  renderer.domElement.tabIndex = 0;
  renderer.domElement.setAttribute('aria-label', 'Interactive island. Drive with the arrow keys or W A S D.');
  const camera = new THREE.OrthographicCamera(-25, 25, 15, -15, 0.1, 160);
  const target = new THREE.Vector3(-3.4, 0, 0);
  const cameraOffset = new THREE.Vector3(24, 29, 32);
  const materials = new Map();
  function mat(color, extra = {}) {
    if (Object.keys(extra).length) return new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...extra });
    if (!materials.has(color)) materials.set(color, new THREE.MeshStandardMaterial({ color, roughness: 0.88 }));
    return materials.get(color);
  }
  function mesh(geometry, color, parent = scene, x = 0, y = 0, z = 0) {
    const m = new THREE.Mesh(geometry, typeof color === 'string' || typeof color === 'number' ? mat(color) : color);
    m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
  }
  function box(w, h, d, color, parent = scene, x = 0, y = 0, z = 0) { return mesh(new THREE.BoxGeometry(w, h, d), color, parent, x, y, z); }
  function cylinder(r1, r2, height, color, parent = scene, x = 0, y = 0, z = 0, segments = 32) { return mesh(new THREE.CylinderGeometry(r1, r2, height, segments), color, parent, x, y, z); }
  function group(x, y, z, rotation = 0) { const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = rotation; scene.add(g); return g; }
  function signTexture(text, bg, fg, sub = '') {
    const c = document.createElement('canvas'); c.width = 768; c.height = 384;
    const ctx = c.getContext('2d');
    if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, 768, 384); }
    ctx.fillStyle = fg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '900 110px Arial';
    const lines = text.split('\n'); lines.forEach((line, i) => ctx.fillText(line, 384, (sub ? 154 : 192) + (i - (lines.length - 1) / 2) * 125));
    if (sub) { ctx.font = '400 27px Arial'; ctx.fillText(sub, 384, 266); }
    const texture = new THREE.CanvasTexture(c); texture.colorSpace = THREE.SRGBColorSpace; return texture;
  }
  function planeLabel(text, x, z, w, h, color) {
    const m = new THREE.MeshBasicMaterial({ map: signTexture(text, null, color), transparent: true, depthWrite: false });
    const p = mesh(new THREE.PlaneGeometry(w, h), m, scene, x, 0.05, z); p.rotation.x = -Math.PI / 2; p.receiveShadow = false; return p;
  }
  scene.add(new THREE.AmbientLight(0xfff5e3, 1.4));
  const sun = new THREE.DirectionalLight(0xfff7dc, 3.2); sun.position.set(-15, 28, 12); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -24, right: 24, top: 24, bottom: -24, near: 0.5, far: 80 });
  sun.shadow.normalBias = 0.03; sun.shadow.bias = -0.0001; sun.shadow.radius = 5; scene.add(sun);
  scene.add(new THREE.HemisphereLight(0xc8e8ec, 0xc8a678, 1.1));

  // Everything is real geometry: a little model you can drive around.
  cylinder(14.2, 13.6, 1.3, '#d6c39c', scene, 0, -0.82, 0, 96);
  cylinder(14.2, 14.2, 0.32, '#e8dbbc', scene, 0, -0.18, 0, 96);
  const backdrop = mesh(new THREE.PlaneGeometry(200, 200), new THREE.ShadowMaterial({ opacity: 0.105 }), scene, 0, -1.51, 0);
  backdrop.rotation.x = -Math.PI / 2; backdrop.castShadow = false;
  const road = mesh(new THREE.RingGeometry(9.65, 12.05, 128), '#f6ecd6', scene, 0, 0.005, 0); road.rotation.x = -Math.PI / 2; road.castShadow = false;
  const outer = mesh(new THREE.RingGeometry(12.08, 12.15, 128), '#d8c7a5', scene, 0, 0.012, 0); outer.rotation.x = -Math.PI / 2;
  for (let i = 0; i < 52; i++) {
    const a = i / 52 * Math.PI * 2;
    const dash = box(0.075, 0.015, 0.47, '#c7bfa6', scene, Math.sin(a) * 10.85, 0.025, Math.cos(a) * 10.85); dash.rotation.y = a + Math.PI / 2;
  }
  const path1 = box(2.15, 0.024, 9.3, '#f4e8cd', scene, 0.3, 0.012, -4.4); path1.rotation.y = -0.06;
  const path2 = box(14, 0.023, 1.9, '#f4e8cd', scene, -1.2, 0.014, 1.35); path2.rotation.y = -0.25;
  planeLabel('HELLO,\nWORLD.', -1, 3.5, 8.8, 4.4, '#527259');
  planeLabel('TAKE THE SCENIC ROUTE', -0.5, 6.1, 6, 0.72, '#aa9873');

  const colliders = [];
  function tree(x, z, s = 1, kind = 0) {
    const t = group(x, 0, z, x * 3);
    cylinder(0.13 * s, 0.18 * s, 1.4 * s, '#917250', t, 0, 0.7 * s, 0, 6);
    if (kind) {
      mesh(new THREE.IcosahedronGeometry(0.9 * s, 1), '#728b59', t, 0, 1.7 * s, 0);
      mesh(new THREE.IcosahedronGeometry(0.65 * s, 0), '#8d9c68', t, 0.3 * s, 2.3 * s, 0);
    } else {
      cylinder(0, 1.0 * s, 1.8 * s, '#536d4e', t, 0, 1.6 * s, 0, 6);
      cylinder(0, 0.8 * s, 1.7 * s, '#647d55', t, 0, 2.25 * s, 0, 6);
      cylinder(0, 0.57 * s, 1.5 * s, '#809465', t, 0, 2.87 * s, 0, 6);
    }
    colliders.push({ x, z, r: 0.5 * s });
  }
  [[-11, -6, 1.1], [-10,-7.6,0.85],[-8.9,-9.2,1.2],[-6.7,-11.2,0.9],[-4.5,-12,1.1],[-12,0.8,0.9],[-11.4,3,1.15],[-9.5,7,0.8],[5,-11.5,1],[7,-10.2,1.2],[9.2,-8.5,0.82],[11.5,-5.3,1],[12,-2.5,0.9],[10,7.9,0.75],[-5,10.9,0.8]].forEach(([x,z,s], i) => tree(x,z,s,i % 5 === 0));
  for (let i=0; i<38; i++) {
    const a=i*2.399; const r=12.6+(Math.sin(i*72)*0.5); const x=Math.cos(a)*r,z=Math.sin(a)*r;
    const rock = mesh(new THREE.DodecahedronGeometry(0.13+((i%4)/18),0), i%2 ? '#c3bc9f':'#a9ad8d', scene,x,0.1,z); rock.scale.y=0.65;
    if(i%3===0) { const tuft=group(x+0.3,0,z+0.3); for(let j=0;j<3;j++){const blade=box(0.05,0.3+j*.06,0.07,'#9ca474',tuft,j*.09,.13,0);blade.rotation.z=(j-1)*.3;} }
  }

  // A miniature gallery with a sculptural poster and three plinths.
  const gallery = group(1, 0, -7, -0.08);
  box(6.3,0.18,4.1,'#c4ccc5',gallery,0,.08,0);
  box(4.6,2.9,0.22,'#315c50',gallery,0,1.6,-1.25);
  const poster = mesh(new THREE.PlaneGeometry(4.25,2.5), new THREE.MeshStandardMaterial({ map: signTexture('MAKE\nSOMETHING.', '#ced9b3', '#315442'), roughness:1 }),gallery,0,1.6,-1.12);
  for (const x of [-1.7,1.7]) box(.16,1.4,.16,'#355449',gallery,x,.7,-1.2);
  for (let i=0;i<3;i++) {
    box(1.2,0.62,1.2,'#f4eee0',gallery,(i-1)*1.65,.48,1);
    const shape = i===0 ? new THREE.TorusKnotGeometry(.35,.12,50,8) : i===1 ? new THREE.IcosahedronGeometry(.46,0):new THREE.TorusGeometry(.37,.12,8,24);
    const m=mesh(shape,['#b47554','#7794a1','#b8b95f'][i],gallery,(i-1)*1.65,1.28,1); m.rotation.set(.2,.4,.3);
  }
  colliders.push({x:1,z:-7.6,r:2.4});

  // A tiny studio with a pitched terracotta roof, windows, and a bench.
  const cabin=group(-8,0,-1,0.16);
  box(4.9,.18,4.3,'#d5c09c',cabin,0,.08,0);
  box(3.1,2.05,2.7,'#f0e2c4',cabin,0,1.15,-.3);
  const roofGeo=new THREE.BufferGeometry();
  const verts=new Float32Array([-1.85,0,-1.7, 1.85,0,-1.7, 0,1.2,-1.7, -1.85,0,1.7, 0,1.2,1.7, 1.85,0,1.7, -1.85,0,-1.7, 0,1.2,-1.7, 0,1.2,1.7, -1.85,0,-1.7, 0,1.2,1.7, -1.85,0,1.7, 1.85,0,-1.7, 1.85,0,1.7, 0,1.2,1.7, 1.85,0,-1.7, 0,1.2,1.7, 0,1.2,-1.7]);
  roofGeo.setAttribute('position',new THREE.BufferAttribute(verts,3));roofGeo.computeVertexNormals();
  mesh(roofGeo,mat('#b77556',{side:THREE.DoubleSide}),cabin,0,2.2,-.3);
  box(.58,1.36,.08,'#486c59',cabin,.62,.85,1.08);
  box(.72,.78,.1,'#50777b',cabin,-.62,1.28,1.08);
  box(.77,.06,.15,'#faf1d9',cabin,-.62,1.28,1.14);box(.06,.83,.15,'#faf1d9',cabin,-.62,1.28,1.14);
  cylinder(.04,.04,.08,'#d9b15d',cabin,.78,.84,1.15,8).rotation.x=Math.PI/2;
  box(.48,1.3,.5,'#f1dcc1',cabin,.85,2.55,-.7);
  for(let i=0;i<3;i++)box(1.6,.08,.13,'#a17650',cabin,2,.68,1+i*.2);
  for(const x of [1.4,2.6])box(.09,.6,.6,'#546a56',cabin,x,.3,1.2);
  colliders.push({x:-8,z:-1.3,r:1.9});
  tree(-5.4,-2.8,.8,1);

  const play=group(8,0,4,-.1);
  cylinder(2.7,2.7,.1,'#c2c79a',play,0,.03,0,48);
  cylinder(1.1,1.1,.28,'#536d54',play,.1,.22,0,32);
  cylinder(1,1,.05,'#354c47',play,.1,.39,0,32);
  const tring=mesh(new THREE.TorusGeometry(1.02,.1,8,48),'#e7dcb9',play,.1,.42,0);tring.rotation.x=Math.PI/2;
  const balls=[];
  [[-1.7,.5,.72,'#d88662'],[1.6,.5,1,'#e1c269'],[.8,.38,-1.9,'#8bacc0']].forEach(([x,y,z,c])=>balls.push(mesh(new THREE.IcosahedronGeometry(y,1),c,play,x,y,z)));
  const arch=group(8,0,1.4);
  for(const x of [-1.1,1.1])cylinder(.1,.1,2.1,'#b86d55',arch,x,1,0,8);
  const archtop=mesh(new THREE.TorusGeometry(1.1,.1,8,32,Math.PI),'#b86d55',arch,0,2,0);
  const flag=box(.8,.4,.05,'#d9a356',arch,0,2.8,0); flag.rotation.z=.1;

  // Quiet details reward taking the long way around.
  const windmill=group(5,0,-2.1);
  cylinder(.12,.3,3,'#f2e9d7',windmill,0,1.5,0,8);
  const blades=new THREE.Group();blades.position.set(0,3,.17);windmill.add(blades);
  cylinder(.18,.18,.3,'#8d9b86',blades,0,0,0,10).rotation.x=Math.PI/2;
  for(let i=0;i<3;i++){const arm=box(.17,1.6,.07,'#f5eee0',blades,0,0,0);arm.geometry.translate(0,.7,0);arm.rotation.z=i*Math.PI*2/3;}
  const fence=group(-4,0,9.2,-.35);
  for(let i=0;i<5;i++)box(.13,.65,.13,'#9d8056',fence,i*.62,.33,0);
  box(2.65,.12,.1,'#ae8b5b',fence,1.2,.49,0);
  function cone(x,z) {const g=group(x,0,z);box(.5,.07,.5,'#f1e9d5',g,0,.04,0);cylinder(.055,.19,.53,'#ce8455',g,0,.33,0,10);cylinder(.11,.14,.12,'#fff2da',g,0,.32,0,10);}
  cone(3.3,7.1);cone(3.9,7.7);cone(4.5,8.3);
  const finish=box(1.9,.023,.55,'#e4dbc4',scene,0,.025,10.8);
  for(let x=0;x<6;x++)for(let z=0;z<2;z++)if((x+z)%2===0)box(.3,.024,.25,'#8f9880',scene,-.75+x*.3,.043,10.66+z*.26);

  const car=group(START.x,0,START.z,START.heading);
  const carBody=new THREE.Group();car.add(carBody);
  box(1.13,.28,1.9,'#91ae80',carBody,0,.49,0);
  box(1.05,.27,.72,'#abc692',carBody,0,.7,.56);
  box(1.05,.15,.45,'#aac98c',carBody,0,.72,-.7);
  box(.93,.59,.82,'#bfd1a2',carBody,0,.96,-.1);
  box(.85,.38,.045,'#486c65',carBody,0,1.02,.335);
  box(.85,.36,.045,'#496b61',carBody,0,1.02,-.535);
  for(const x of [-.483,.483])box(.025,.38,.64,'#557972',carBody,x,1.01,-.1);
  box(1.05,.12,.98,'#cfdbac',carBody,0,1.29,-.11);
  for(const x of [-.42,.42]){box(.2,.15,.05,'#fff0bd',carBody,x,.6,.978);box(.18,.12,.05,'#b96845',carBody,x,.56,-.978);}
  box(1.15,.14,.16,'#354e45',carBody,0,.35,1);box(1.15,.14,.16,'#354e45',carBody,0,.35,-1);
  box(.42,.13,.06,'#395348',carBody,0,.55,.99);
  const wheels=[];
  for(const x of [-.59,.59])for(const z of [-.64,.64]){
    const pivot=new THREE.Group();pivot.position.set(x,.31,z);car.add(pivot);
    const tire=cylinder(.32,.32,.24,'#36463f',pivot,0,0,0,14);tire.rotation.z=Math.PI/2;
    const hub=cylinder(.17,.17,.253,'#cfceb9',pivot,0,0,0,12);hub.rotation.z=Math.PI/2;wheels.push({pivot,tire,hub,front:z>0});
  }
  const spare=cylinder(.29,.29,.2,'#36463f',carBody,0,.83,-1.02,14);spare.rotation.x=Math.PI/2;
  const aerial=cylinder(.013,.013,.61,'#385648',carBody,.39,1.58,-.44,5);
  const pennant=mesh(new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,.35,-.1,0,0,-.2,0],3)),mat('#f4cd65',{side:THREE.DoubleSide}),carBody,.39,1.86,-.44);
  const dust=[]; const dustGeo=new THREE.IcosahedronGeometry(.14,0);
  for(let i=0;i<20;i++){const m=mesh(dustGeo,mat('#e1cfaa',{transparent:true,opacity:0}),scene);m.visible=false;dust.push({m,life:0});}
  const bodyMeshes=[];car.traverse(o=>{if(o.isMesh&&['91ae80','abc692','aac98c','bfd1a2','cfdbac'].includes(o.material.color?.getHexString())){o.userData.isBody=true;o.material=o.material.clone();bodyMeshes.push(o);}});
  const remoteCars=new Map();
  function updatePeers(peers){const ids=new Set(peers.map(p=>p.id));for(const [id,p] of remoteCars){if(!ids.has(id)){scene.remove(p.model);for(const m of p.ownedMaterials)m.dispose();remoteCars.delete(id);}}
    for(const peer of peers){let p=remoteCars.get(peer.id);if(!p){const model=car.clone(true);const ownedMaterials=[];model.traverse(o=>{if(o.isMesh&&o.userData.isBody){o.material=o.material.clone();o.material.color.set(peer.color).lerp(new THREE.Color('#ffffff'),.16);ownedMaterials.push(o.material);}});model.position.set(peer.x,0,peer.z);scene.add(model);p={model,ownedMaterials,...peer};remoteCars.set(peer.id,p);}else Object.assign(p,peer);}
  }
  const keys=new Set(); let speed=0,heading=START.heading,paused=false,frameId,prev=0,elapsed=0,lastUi=0,dustIndex=0,boost=false,near=null,driveTime=0,hasMoved=false,jump=0,jumpVelocity=0;
  let mobile={throttle:0,steer:0,brake:false};let audioContext=null,osc=null,gain=null,sound=false;
  let disposed=false;let debugCollisions=0;const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  const vec=new THREE.Vector3();let width=1,height=1;
  function resize(){width=host.clientWidth;height=host.clientHeight;renderer.setSize(width,height);const aspect=width/height;const size=aspect<1.2?42/aspect:27;camera.left=-size*aspect/2;camera.right=size*aspect/2;camera.top=size/2;camera.bottom=-size/2;camera.updateProjectionMatrix();}
  const ro=new ResizeObserver(resize);ro.observe(host);resize();
  function clearInput(){keys.clear();mobile={throttle:0,steer:0,brake:false};}
  function keydown(e){if(paused||e.target instanceof HTMLElement&&e.target.closest('input,textarea,select,[contenteditable="true"]'))return;if(['Enter','Space'].includes(e.code)&&e.target instanceof HTMLElement&&e.target.closest('button'))return;const accepted=['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','KeyW','KeyA','KeyS','KeyD','Space','ShiftLeft','ShiftRight','KeyR','KeyE','Enter'];if(accepted.includes(e.code)){e.preventDefault();keys.add(e.code);}if(e.repeat)return;if(e.code==='KeyR')reset();if((e.code==='KeyE'||e.code==='Enter')&&near)callbacks.onInteract(near);}
  function keyup(e){keys.delete(e.code);}
  window.addEventListener('keydown',keydown);window.addEventListener('keyup',keyup);window.addEventListener('blur',clearInput);document.addEventListener('visibilitychange',clearInput);
  function reset(){car.position.set(START.x,0,START.z);heading=START.heading;speed=0;jump=0;jumpVelocity=0;clearInput();callbacks.onReset?.();}
  function soundOn(enabled){sound=enabled;if(enabled){try{audioContext??=new AudioContext();audioContext.resume();if(!osc){osc=audioContext.createOscillator();gain=audioContext.createGain();osc.type='sine';gain.gain.value=.015;osc.connect(gain);gain.connect(audioContext.destination);osc.start();}}catch{sound=false;}}if(gain)gain.gain.setTargetAtTime(enabled?.018:0,audioContext.currentTime,.2);}
  function project(x,y,z){vec.set(x,y,z).project(camera);return {x:(vec.x+1)/2*width,y:(1-vec.y)/2*height};}
  function step(time){
    if(disposed)return;frameId=requestAnimationFrame(step);const dt=Math.min((time-prev)/1000||.016,0.04);prev=time;elapsed+=dt;
    const active=!paused&&!document.hidden;
    const throttle=active?((keys.has('ArrowUp')||keys.has('KeyW')?1:0)-(keys.has('ArrowDown')||keys.has('KeyS')?1:0)||mobile.throttle):0;
    const steer=active?((keys.has('ArrowLeft')||keys.has('KeyA')?1:0)-(keys.has('ArrowRight')||keys.has('KeyD')?1:0)||mobile.steer):0;
    const brake=keys.has('Space')||mobile.brake;boost=active&&(keys.has('ShiftLeft')||keys.has('ShiftRight'));
    if(active){
      speed+=throttle*(boost?14:9)*dt;speed*=Math.exp(-(brake?9:throttle?1.1:2.0)*dt);speed=THREE.MathUtils.clamp(speed,-3.6,boost?10:6.8);
      if(Math.abs(speed)<.015)speed=0;
      heading+=steer*speed*.72*dt;
      car.position.x+=Math.sin(heading)*speed*dt;car.position.z+=Math.cos(heading)*speed*dt;
      const length=Math.hypot(car.position.x,car.position.z);if(length>13.35){car.position.x*=13.35/length;car.position.z*=13.35/length;speed*=-.22;}
      for(const c of colliders){const dx=car.position.x-c.x,dz=car.position.z-c.z,d=Math.hypot(dx,dz);if(d<c.r+.58&&d>.001){const push=(c.r+.58-d)/d;car.position.x+=dx*push;car.position.z+=dz*push;speed*=-.22;debugCollisions++;}}
      if(Math.abs(speed)>.3){driveTime+=dt;if(!hasMoved){hasMoved=true;callbacks.onMove?.();}}
      for(const p of remoteCars.values()){const dx=car.position.x-p.model.position.x,dz=car.position.z-p.model.position.z,d=Math.hypot(dx,dz);if(d<1.18&&d>.01){car.position.x+=dx/d*(1.18-d)*.6;car.position.z+=dz/d*(1.18-d)*.6;speed*=.93;}}
      const edge=Math.hypot(car.position.x,car.position.z);if(edge>13.35){car.position.x*=13.35/edge;car.position.z*=13.35/edge;}
      const onTrampoline=Math.hypot(car.position.x-8.1,car.position.z-4)<1.1;
      if(onTrampoline&&jump===0)jumpVelocity=5;
      jumpVelocity-=12*dt;jump=Math.max(0,jump+jumpVelocity*dt);if(jump===0)jumpVelocity=0;
      if(Math.abs(speed)>2&&elapsed%0.1<dt){const p=dust[dustIndex++%dust.length];p.life=1;p.m.position.set(car.position.x-Math.sin(heading),.12,car.position.z-Math.cos(heading));p.m.visible=true;}
    }else speed*=Math.exp(-8*dt);
    car.position.y=jump;car.rotation.y=heading;carBody.rotation.z=THREE.MathUtils.lerp(carBody.rotation.z,steer*speed*.015,.1);carBody.position.y=reduced?0:Math.sin(elapsed*18)*Math.abs(speed)*.003;
    wheels.forEach(w=>{w.pivot.rotation.y=w.front?steer*.3:0;w.tire.rotation.x+=speed*dt*2;w.hub.rotation.x+=speed*dt*2;});
    if(!reduced){blades.rotation.z=elapsed*.32;balls.forEach((b,i)=>b.position.y=.5+Math.sin(elapsed*1.3+i)*.08);pennant.rotation.y=Math.sin(elapsed*3)*.15;}
    dust.forEach(p=>{if(p.life>0){p.life-=dt*1.4;p.m.material.opacity=p.life*.28;p.m.position.y+=dt*.2;p.m.scale.setScalar(1+(1-p.life)*2);if(p.life<=0)p.m.visible=false;}});
    const aspect=width/height;
    const tx=aspect<.8?-1:-3.4;
    target.lerp(new THREE.Vector3(tx+car.position.x*.1,0,car.position.z*.08),1-Math.exp(-2*dt));
    camera.position.copy(target).add(cameraOffset);camera.lookAt(target);camera.updateMatrixWorld();
    if(audioContext&&osc){osc.frequency.setTargetAtTime(55+Math.abs(speed)*14,audioContext.currentTime,.15);gain.gain.setTargetAtTime(sound&&active?.012+Math.abs(speed)*.002:0,audioContext.currentTime,.1);}
    for(const p of remoteCars.values()){p.model.position.lerp(new THREE.Vector3(p.x,0,p.z),1-Math.exp(-13*dt));const delta=Math.atan2(Math.sin(p.heading-p.model.rotation.y),Math.cos(p.heading-p.model.rotation.y));p.model.rotation.y+=delta*(1-Math.exp(-13*dt));}
    renderer.render(scene,camera);
    if(time-lastUi>60){lastUi=time;near=ZONES.find(zone=>Math.hypot(car.position.x-zone.x,car.position.z-zone.z)<3.8)?.id??null;
      callbacks.onFrame({x:car.position.x,z:car.position.z,speed:Math.round(Math.abs(speed)*5),heading,near,driveTime,labels:ZONES.map(zone=>({...zone,...project(zone.x,3.9,zone.z)})),peers:[...remoteCars.values()].map(p=>({id:p.id,nickname:p.nickname,color:p.color,...project(p.model.position.x,2.1,p.model.position.z)})),car:project(car.position.x,1.9+jump,car.position.z)});
    }
  }
  frameId=requestAnimationFrame(step);
  return {
    reset,
    setPaused(value){paused=value;clearInput();},
    setMobile(value){mobile={...mobile,...value};},
    setSound:soundOn,
    setPeers:updatePeers,
    setIdentity(player){if(player){car.position.set(player.x,0,player.z);heading=player.heading;speed=0;bodyMeshes.forEach(o=>o.material.color.set(player.color).lerp(new THREE.Color('#ffffff'),.16));}else bodyMeshes.forEach(o=>o.material.color.set('#a5bf90'));},
    setPosition(player){car.position.set(player.x,0,player.z);heading=player.heading;speed=0;clearInput();},
    goTo(id){const zone=ZONES.find(z=>z.id===id);if(!zone)return;car.position.set(zone.x,0,zone.z+3.3);heading=Math.PI;speed=0;},
    dispose(){disposed=true;cancelAnimationFrame(frameId);ro.disconnect();window.removeEventListener('keydown',keydown);window.removeEventListener('keyup',keyup);window.removeEventListener('blur',clearInput);document.removeEventListener('visibilitychange',clearInput);audioContext?.close();const textures=new Set(),geometries=new Set(),mats=new Set();scene.traverse(o=>{if(o.geometry)geometries.add(o.geometry);if(o.material){for(const m of Array.isArray(o.material)?o.material:[o.material]){mats.add(m);if(m.map)textures.add(m.map);}}});geometries.forEach(g=>g.dispose());textures.forEach(t=>t.dispose());mats.forEach(m=>m.dispose());renderer.dispose();renderer.domElement.remove();}
  };
}
