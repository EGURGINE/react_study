import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Volume2, VolumeX, RotateCcw, X, Plus, Compass, MapPin, MessageCircle, Send, Users, CircleHelp, Sparkles, Leaf, Check, LogOut, Hand } from 'lucide-react';
import { createWorld, ZONES } from './world.js';
import { useMultiplayer } from './multiplayer.js';

const projects = [
  { name: 'A slower kind of internet.', type: 'DIGITAL EXPERIENCE', number: '01', title: 'Still Studio', description: 'An independent design studio, brought to life through quiet typography, thoughtful motion, and room to breathe.', stack: 'React · Creative development · Art direction', color: 'sage' },
  { name: 'Small steps. New perspectives.', type: 'INTERACTIVE WEB', number: '02', title: 'Outside the Lines', description: 'A collection of playful browser experiments exploring the meeting point of everyday objects and unexpected interactions.', stack: 'Three.js · Interaction design · WebGL', color: 'blue' },
  { name: 'A good place to get lost.', type: 'CREATIVE CODING', number: '03', title: 'Little Worlds', description: 'Tiny landscapes made for wandering. A study in procedural worlds, friendly physics, and the joy of exploring without a destination.', stack: 'Procedural design · Three.js · Sound', color: 'orange' },
];

function Modal({ section, onClose, children }) {
  const ref = useRef();
  useEffect(() => { const dialog = ref.current; if (section) dialog.showModal(); else dialog.close(); }, [section]);
  return <dialog ref={ref} className={`modal ${section === 'join' ? 'join-modal' : ''}`} onCancel={onClose} onClick={e => { if(e.target === ref.current) onClose(); }} aria-labelledby="modal-title">
    <button className="icon-button modal-close" aria-label="Close panel" onClick={onClose}><X size={20}/></button>{children}
  </dialog>;
}

function MiniMap({ state, onSelect, large = false, peers = [] }) {
  return <div className={`minimap ${large ? 'large-map' : ''}`}>
    <svg viewBox="0 0 200 150" aria-label="Island map with your location">
      <ellipse cx="100" cy="75" rx="82" ry="60" fill="#e8dfc8"/>
      <ellipse cx="100" cy="75" rx="64" ry="46" fill="none" stroke="#f9f6ed" strokeWidth="11"/>
      <ellipse cx="100" cy="75" rx="64" ry="46" fill="none" stroke="#c7bea7" strokeWidth="1" strokeDasharray="3 5"/>
      <path d="M100 32V77L54 81M100 77L139 93" stroke="#f9f6ed" strokeWidth="8" fill="none"/>
      <rect x="48" y="64" width="21" height="14" rx="3" fill="#ba8b72"/><rect x="98" y="42" width="24" height="14" rx="2" fill="#8faaa8"/><circle cx="145" cy="91" r="12" fill="#b2be8b"/>
      {peers.map(p => <circle key={p.id} cx={100+p.x*5.35} cy={75+p.z*3.9} r="3.5" fill={p.color}/>)}
      <g transform={`translate(${100+(state.x||0)*5.35},${75+(state.z||0)*3.9}) rotate(${-(state.heading||0)*180/Math.PI})`}><circle r="8" fill="#f9fff2" opacity=".75"/><path d="M0 5L-4-4L0-2L4-4Z" fill="#315e47"/></g>
    </svg>
    {large && ZONES.map(z => <button key={z.id} className="map-destination" onClick={() => onSelect(z.id)}><span style={{background:z.color}}/><span>{z.title}</span><MapPin size={16}/></button>)}
  </div>;
}

function TouchButton({ name, icon: Icon, field, value, world }) {
  const release=()=>world.current?.setMobile({[field]:0});
  return <button aria-label={name} onPointerDown={e=>{e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);world.current?.setMobile({[field]:value});}} onPointerUp={release} onPointerCancel={release} onLostPointerCapture={release}><Icon size={23}/></button>;
}

export default function App() {
  const canvasRef=useRef(null),world=useRef(null),stateRef=useRef({x:1.3,z:7.8,heading:-Math.PI/2.4});
  const [state,setState]=useState({...stateRef.current,speed:0,labels:[],driveTime:0});
  const [section,setSection]=useState(null),[visited,setVisited]=useState(new Set()),[muted,setMuted]=useState(true),[moved,setMoved]=useState(false),[ready,setReady]=useState(false),[error,setError]=useState(false);
  const [selectedProject,setSelectedProject]=useState(null),[chatOpen,setChatOpen]=useState(false),[draft,setDraft]=useState(''),[nickname,setNickname]=useState(''),[toast,setToast]=useState('');
  const chatEnd=useRef(null),toastTimer=useRef();
  const notify=useCallback(text=>{setToast(text);clearTimeout(toastTimer.current);toastTimer.current=setTimeout(()=>setToast(''),4000);},[]);
  const open=useCallback(id=>{setSection(id);setSelectedProject(null);if(ZONES.some(z=>z.id===id))setVisited(v=>new Set([...v,id]));},[]);
  const multiplayer=useMultiplayer(stateRef,notify);
  useEffect(()=>{
    try{world.current=createWorld(canvasRef.current,{onFrame:s=>{stateRef.current=s;setState(s);},onInteract:open,onMove:()=>setMoved(true),onReset:()=>multiplayer.teleport('start')});setReady(true);}catch(e){console.error(e);setError(true);}
    return()=>{world.current?.dispose();world.current=null;clearTimeout(toastTimer.current);};
  },[open]);
  useEffect(()=>{world.current?.setPaused(Boolean(section));},[section]);
  useEffect(()=>{world.current?.setPeers(multiplayer.peers);},[multiplayer.peers]);
  useEffect(()=>{world.current?.setIdentity(multiplayer.player);},[multiplayer.player]);
  useEffect(()=>{if(multiplayer.correction)world.current?.setPosition(multiplayer.correction);},[multiplayer.correction]);
  useEffect(()=>{if(!multiplayer.honk)return;const who=multiplayer.honk.id===multiplayer.player?.id?'You':multiplayer.peers.find(p=>p.id===multiplayer.honk.id)?.nickname;if(who)notify(`${who} says hello! 👋`);},[multiplayer.honk]);
  useEffect(()=>{chatEnd.current?.scrollIntoView({behavior:'smooth',block:'nearest'});},[multiplayer.messages,chatOpen]);
  useEffect(()=>{if(ready&&!sessionStorage.getItem('roam-entry-seen')){setSection('join');sessionStorage.setItem('roam-entry-seen','1');}},[ready]);
  async function join(e){e.preventDefault();if(await multiplayer.join(nickname)){setSection(null);setChatOpen(true);}}
  async function send(e){e.preventDefault();if(!draft.trim())return;if(await multiplayer.send(draft)){setDraft('');}}
  function reset(){world.current?.reset();}
  function visit(id){world.current?.goTo(id);multiplayer.teleport(id);setSection(null);notify(id==='play'?'Drive onto the round trampoline. A little airtime awaits!':'You’re here. Press E to take a look around.');}
  const close=()=>setSection(null);
  const nearZone=ZONES.find(z=>z.id===state.near);

  return <main className="app">
    <div className="world-gradient"/>
    <div ref={canvasRef} className="world-canvas"/>
    <header className="header">
      <button className="wordmark" onClick={()=>{reset();setSection(null);}} aria-label="roam home">roam<span>.</span><i>CREATIVE DEVELOPER</i></button>
      <nav aria-label="Main navigation"><button onClick={()=>open('work')}>Work <span>03</span></button><button onClick={()=>open('about')}>About</button><button onClick={()=>open('play')}>Playground <Sparkles size={13}/></button></nav>
      <div className="header-right"><span className="availability"><span/>Open to possibilities</span><button className="icon-button sound-button" onClick={()=>{world.current?.setSound(muted);setMuted(!muted);}} aria-label={muted?'Turn sound on':'Turn sound off'}>{muted?<VolumeX size={18}/>:<Volume2 size={18}/>}</button></div>
    </header>

    <section className={`intro ${moved?'has-moved':''}`} aria-label="Welcome">
      <div className="eyebrow"><span className="little-line"/> A SMALL WORLD, MADE WITH CARE</div>
      <h1>Good things<br/>happen <em>off-road.</em></h1>
      <p>A few ideas. A little curiosity.<br/>And a whole world to explore.</p>
      <div className="intro-note"><span className="drawn-star">✳</span> Go on, take the wheel.</div>
    </section>

    <div className="world-labels" aria-label="Places to explore">
      {state.labels.map((label,i)=><button key={label.id} className={`world-label ${state.near===label.id?'near':''}`} style={{left:label.x,top:label.y}} onClick={()=>open(label.id)}><span className="label-number">0{i+1}</span><span>{label.title}</span>{visited.has(label.id)?<Check size={13}/>:<Plus size={13}/>}<i/></button>)}
      {state.peers?.map(p=><span key={p.id} className="peer-label" style={{left:p.x,top:p.y,borderColor:p.color}}>{p.nickname}</span>)}
    </div>
    {!moved&&ready&&!section&&state.car&&<div className="you-label" style={{left:state.car.x,top:state.car.y}}>THIS IS YOU<span>↓</span></div>}
    {error&&<div className="graphics-error"><Leaf/><h2>Your next idea is around the corner.</h2><p>3D isn’t available in this browser. You can still explore all the work.</p><button className="primary-button" onClick={()=>open('work')}>Explore the projects</button></div>}

    <div className="top-right-tools">{multiplayer.player&&<button className="wave-button icon-button" aria-label="Wave to everyone" title="Say hello to everyone" onClick={multiplayer.honkNow}><Hand size={16}/></button>}<button className="room-status" onClick={()=>multiplayer.player?setChatOpen(!chatOpen):open('join')}><Users size={15}/><span>{multiplayer.player ? `${multiplayer.peers.length+1} / 10 online`:'Join the world'}</span><span className={`status-light ${multiplayer.connected?'online':''}`}/></button></div>
    <div className="compass"><span>N</span><Compass size={33} strokeWidth={1}/></div>
    <aside className="drive-guide">
      <div className="guide-title"><span className="tiny-car">▰</span><strong>The best way is your way.</strong><button className="bare-icon" onClick={()=>open('help')} aria-label="Driving help"><CircleHelp size={16}/></button></div>
      <div className="guide-controls"><div className="arrow-keys"><kbd className="up"><ArrowUp size={12}/></kbd><kbd><ArrowLeft size={12}/></kbd><kbd><ArrowDown size={12}/></kbd><kbd><ArrowRight size={12}/></kbd></div><span>Drive around<br/><small>W A S D works, too</small></span><div className="guide-divider"/><div className="key-pair"><kbd>shift</kbd><span>Boost</span></div><div className="key-pair"><kbd>space</kbd><span>Brake</span></div></div>
      <div className="guide-bottom"><span><i/>{String(visited.size).padStart(2,'0')} / 03 places discovered</span><button onClick={()=>{reset();notify('Back on the road. Happy exploring!');}}><RotateCcw size={13}/>Start again</button></div>
    </aside>
    <aside className="map-card"><div className="map-heading"><span>YOUR LITTLE WORLD</span><button className="bare-icon" onClick={()=>open('map')} aria-label="Open island map"><Plus size={16}/></button></div><button className="map-open" aria-label="Explore island map" onClick={()=>open('map')}><MiniMap state={state} peers={multiplayer.peers}/></button><div className="map-caption"><span><i/>You are here</span><span>TAKE YOUR TIME</span></div></aside>
    <div className="interaction-prompt">{nearZone&&!section?<button onClick={()=>open(nearZone.id)}><kbd>E</kbd>Explore {nearZone.id==='work'?'the gallery':nearZone.id==='about'?'the studio':'the playground'}</button>:<span><MapPin size={13}/> NO WRONG TURNS HERE</span>}</div>
    <div className="touch-controls"><div><TouchButton name="Steer left" icon={ArrowLeft} field="steer" value={1} world={world}/><TouchButton name="Steer right" icon={ArrowRight} field="steer" value={-1} world={world}/></div><div><TouchButton name="Reverse" icon={ArrowDown} field="throttle" value={-1} world={world}/><TouchButton name="Accelerate" icon={ArrowUp} field="throttle" value={1} world={world}/></div></div>
    <footer><span>© {new Date().getFullYear()} roam.</span><span className="footer-center">A little less scrolling. A little more exploring.</span><button onClick={()=>open('about')}>Built with curiosity <span>✳</span></button></footer>

    <button className={`chat-toggle ${chatOpen?'active':''}`} onClick={()=>multiplayer.player?setChatOpen(!chatOpen):open('join')} aria-label="Open chat"><MessageCircle size={20}/>{multiplayer.player&&<span>{multiplayer.peers.length+1}</span>}</button>
    {chatOpen&&multiplayer.player&&<section className="chat-panel" aria-label="Island chat"><div className="chat-header"><div><strong>Campfire chat</strong><span>{multiplayer.connected?'Same island. Good company.':'Reconnecting to the island…'}</span></div><button className="bare-icon" onClick={()=>setChatOpen(false)} aria-label="Close chat"><X size={18}/></button></div><div className="chat-people"><span className="status-light online"/>{multiplayer.peers.length+1} explorers online<button onClick={()=>{multiplayer.leave();setChatOpen(false);}} title="Leave multiplayer" aria-label="Leave multiplayer"><LogOut size={14}/></button></div><div className="chat-messages" role="log" aria-live="polite">{multiplayer.messages.length===0&&<p className="chat-empty">You’re in good company.<br/>Say hello to the island.</p>}{multiplayer.messages.map(m=><div className={`chat-message ${m.playerId===multiplayer.player.id?'mine':''}`} key={m.id}><div><span style={{color:m.color}}>{m.nickname}</span><time>{new Date(m.createdAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</time></div><p>{m.text}</p></div>)}<div ref={chatEnd}/></div><form onSubmit={send} className="chat-form"><input aria-label="Chat message" placeholder="Say something nice…" maxLength={280} value={draft} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>e.stopPropagation()}/><button aria-label="Send message" disabled={!draft.trim()||!multiplayer.connected}><Send size={17}/></button></form></section>}
    {toast&&<div className="toast" role="status">{toast}</div>}

    <Modal section={section} onClose={close}>
      {section==='join'&&<><div className="modal-eyebrow"><Users size={15}/> A LITTLE BETTER TOGETHER</div><div className="join-symbol"><Leaf size={34} strokeWidth={1.4}/></div><h2 id="modal-title">Every explorer<br/>needs a name.</h2><p className="modal-intro">Meet other curious minds, take a drive, and say hello. There’s room for 10 on this little island.</p><form onSubmit={join}><label className="form-label" htmlFor="nickname">YOUR NICKNAME</label><input id="nickname" className="nickname-input" placeholder="What should we call you?" maxLength={18} minLength={2} value={nickname} onChange={e=>setNickname(e.target.value)} autoComplete="nickname" autoFocus required/>{multiplayer.error&&<p className="form-error" role="alert">{multiplayer.error}</p>}<button className="primary-button join-button" disabled={multiplayer.joining||nickname.trim().length<2}>{multiplayer.joining?'Finding you a parking spot…':'Let’s explore'}<Leaf size={16}/></button></form><button className="solo-button" onClick={close}>Just wandering? Explore on your own</button></>}
      {section==='work'&&<><div className="modal-eyebrow">01 / THE GALLERY</div><h2 id="modal-title">Ideas, out in<br/><em>the wild.</em></h2><p className="modal-intro">A few things built with equal parts intention and curiosity.</p><div className="projects">{projects.map(p=><button key={p.number} className={`project-card ${p.color} ${selectedProject===p.number?'expanded':''}`} onClick={()=>setSelectedProject(selectedProject===p.number?null:p.number)}><div className="project-top"><span>{p.type}</span><span>{p.number}</span></div><h3>{p.title}</h3><p>{p.name}</p><div className="project-bottom"><span>Explore the idea</span><Plus size={18}/></div>{selectedProject===p.number&&<div className="project-details"><p>{p.description}</p><small>{p.stack}</small></div>}</button>)}</div></>}
      {section==='about'&&<><div className="modal-eyebrow">02 / THE LITTLE STUDIO</div><h2 id="modal-title">A curious mind.<br/><em>A hands-on heart.</em></h2><p className="modal-intro">I’m a creative developer exploring the space between design, technology, and play.</p><div className="about-copy"><p>I turn thoughtful ideas into things you can touch, click, and get a little lost in. Sometimes that means a website. Sometimes it means a tiny car on a very tiny island.</p><p>I like quiet details, unexpected interactions, and work that makes someone pause for a moment and smile.</p></div><div className="skill-tags"><span>Creative development</span><span>3D & WebGL</span><span>Interaction design</span><span>Thoughtful details</span></div><div className="about-note"><Leaf size={22}/><p>Made with care.<br/><span>And a healthy amount of “what if?”</span></p></div></>}
      {section==='play'&&<><div className="modal-eyebrow">03 / THE PLAYGROUND</div><h2 id="modal-title">Make a little<br/><em>happy detour.</em></h2><p className="modal-intro">No scores to chase. No finish line to cross. Just a few things to try.</p><div className="play-options"><button onClick={()=>visit('play')}><span className="play-icon"><ArrowUp/></span><div><h3>Catch a little air</h3><p>Find the round trampoline and drive right onto it.</p></div><Plus size={20}/></button><button onClick={()=>{reset();close();notify('Hold Shift as you drive for a little extra speed.');}}><span className="play-icon"><Compass/></span><div><h3>Take the scenic route</h3><p>Follow the ring road. Hold Shift for a little boost.</p></div><Plus size={20}/></button><button onClick={()=>open('join')}><span className="play-icon"><Users/></span><div><h3>Bring some company</h3><p>Share the island with up to nine other explorers.</p></div><Plus size={20}/></button></div></>}
      {section==='map'&&<><div className="modal-eyebrow">A BIRD’S-EYE VIEW</div><h2 id="modal-title">Where to next?</h2><p className="modal-intro">Pick a little corner of the world to visit.</p><MiniMap state={state} peers={multiplayer.peers} onSelect={visit} large/></>}
      {section==='help'&&<><div className="modal-eyebrow">A QUICK FIELD GUIDE</div><h2 id="modal-title">You’ve got<br/><em>the wheel.</em></h2><div className="help-rows"><p><span>Drive forward & reverse</span><kbd>W / S</kbd><kbd>↑ / ↓</kbd></p><p><span>Turn left & right</span><kbd>A / D</kbd><kbd>← / →</kbd></p><p><span>A little extra speed</span><kbd>SHIFT</kbd></p><p><span>Take a brake</span><kbd>SPACE</kbd></p><p><span>Explore a nearby place</span><kbd>E</kbd><kbd>ENTER</kbd></p><p><span>Back to the starting point</span><kbd>R</kbd></p></div><p className="modal-intro">You can also click the signs, use the menu, or pick a destination on the map. On touchscreens, use the on-screen driving buttons.</p></>}
    </Modal>
  </main>;
}

