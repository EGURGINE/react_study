import { useCallback, useEffect, useRef, useState } from 'react';

export function useMultiplayer(position, notify) {
  const [player,setPlayer]=useState(null),[peers,setPeers]=useState([]),[messages,setMessages]=useState([]),[connected,setConnected]=useState(false),[joining,setJoining]=useState(false),[error,setError]=useState(''),[honk,setHonk]=useState(null),[correction,setCorrection]=useState(null);
  const socket=useRef(null),identity=useRef(null),pending=useRef(null),mounted=useRef(true),joinTimer=useRef(null),pendingSend=useRef(null),sendTimer=useRef(null);
  const join=useCallback(nickname=>new Promise(resolve=>{
    pending.current?.(false);clearTimeout(joinTimer.current);
    if(socket.current)socket.current.close();
    identity.current=null;setPlayer(null);setConnected(false);setPeers([]);
    const base=import.meta.env.VITE_MULTIPLAYER_URL;
    const url=base||(import.meta.env.DEV?`${location.protocol==='https:'?'wss:':'ws:'}//${location.host}/socket`:null);
    if(!url){setError('The shared island is not connected yet. You can still explore on your own.');resolve(false);return;}
    setJoining(true);setError('');pending.current=resolve;
    let ws;try{ws=new WebSocket(url);}catch{setJoining(false);setError('The multiplayer address is unavailable.');resolve(false);return;}socket.current=ws;
    const finish=ok=>{clearTimeout(joinTimer.current);setJoining(false);pending.current?.(ok);pending.current=null;};
    joinTimer.current=setTimeout(()=>{setError('The island is taking a little longer to wake up. Please try again.');finish(false);ws.close();},18000);
    ws.onopen=()=>ws.send(JSON.stringify({type:'join',nickname:nickname.trim()}));
    ws.onmessage=event=>{
      if(!mounted.current||socket.current!==ws)return;
      let data;try{data=JSON.parse(event.data);}catch{return;}
      if(data.type==='welcome'){identity.current=data.player;setPlayer(data.player);setPeers((data.players||[]).filter(p=>p.id!==data.player.id));setMessages(data.messages||[]);setConnected(true);setError('');finish(true);notify(`Welcome, ${data.player.nickname}. Make yourself at home.`);}
      if(data.type==='state')setPeers(data.players.filter(p=>p.id!==identity.current?.id));
      if(data.type==='chat'){setMessages(ms=>[...ms,data.message].slice(-100));if(data.message.playerId===identity.current?.id){clearTimeout(sendTimer.current);pendingSend.current?.(true);pendingSend.current=null;}}
      if(data.type==='honk')setHonk({id:data.id,at:Date.now()});
      if(data.type==='teleport')setCorrection({...data.player,at:Date.now()});
      if(data.type==='error'){if(!identity.current){setError(data.message);finish(false);}else{clearTimeout(sendTimer.current);pendingSend.current?.(false);pendingSend.current=null;notify(data.message);}}
    };
    ws.onerror=()=>{if(socket.current===ws){setError('The shared island is unavailable right now. Try again in a moment.');finish(false);}};
    ws.onclose=()=>{if(socket.current!==ws||!mounted.current)return;finish(false);clearTimeout(sendTimer.current);pendingSend.current?.(false);pendingSend.current=null;const wasJoined=Boolean(identity.current);identity.current=null;setPlayer(null);setPeers([]);setConnected(false);if(wasJoined)notify('You’ve left the shared island. Join again whenever you like.');};
  }),[notify]);
  const send=useCallback(text=>new Promise(resolve=>{if(socket.current?.readyState!==WebSocket.OPEN||!identity.current||pendingSend.current){resolve(false);return;}pendingSend.current=resolve;sendTimer.current=setTimeout(()=>{pendingSend.current?.(false);pendingSend.current=null;notify('Your message was not confirmed. Please try again.');},5000);socket.current.send(JSON.stringify({type:'chat',text}));}),[notify]);
  const honkNow=useCallback(()=>{if(socket.current?.readyState===WebSocket.OPEN&&identity.current)socket.current.send(JSON.stringify({type:'honk'}));},[]);
  const leave=useCallback(()=>{socket.current?.close();identity.current=null;setPlayer(null);setPeers([]);setConnected(false);},[]);
  const teleport=useCallback(destination=>{if(socket.current?.readyState===WebSocket.OPEN&&identity.current)socket.current.send(JSON.stringify({type:'teleport',destination}));},[]);
  useEffect(()=>{mounted.current=true;const interval=setInterval(()=>{const ws=socket.current;if(ws?.readyState===WebSocket.OPEN&&identity.current){const p=position.current;ws.send(JSON.stringify({type:'move',x:p.x,z:p.z,heading:p.heading}));}},80);return()=>{mounted.current=false;clearInterval(interval);clearTimeout(joinTimer.current);clearTimeout(sendTimer.current);socket.current?.close();pending.current?.(false);pendingSend.current?.(false);};},[position]);
  return {player,peers,messages,connected,joining,error,join,send,leave,honk,honkNow,teleport,correction};
}
