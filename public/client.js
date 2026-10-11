const socket = io();
const $ = (id) => document.getElementById(id);
const screens = ["nameScreen","lobbyScreen","roomScreen","depositScreen","historyScreen"];
let me = null, currentRoom = null, myHand = [], selectedCard = null, currentPhase = "lobby", deadline = null, tick = null;
let rows = { front: [], middle: [], back: [] };
const modeNames = { private:"PRIVATE ROOM", ace:"ACE ROOM", dealer:"DEALER ROOM", bot:"BOT ROOM" };

function showScreen(id) {
  screens.forEach(s => $(s).classList.toggle("active", s === id));
}
function toast(message) {
  const el = $("toast"); el.textContent = message; el.classList.add("show");
  clearTimeout(el._timer); el._timer = setTimeout(() => el.classList.remove("show"), 2800);
}
function credits(n) {
  $("creditCount").textContent = n;
  $("depositBalance").textContent = n;
}
function cardInfo(card) {
  const suit = card.slice(-1), rank = card.slice(0,-1);
  return { label: rank + ({S:"♠",H:"♥",D:"♦",C:"♣"}[suit]), red: suit==="H"||suit==="D" };
}
function renderRoom(room) {
  currentRoom = room;
  $("roomCodeLabel").textContent = room.code;
  $("roomModeLabel").textContent = modeNames[room.mode] || "PRIVATE ROOM";
  $("seatCount").textContent = `${room.players.length}/4`;
  $("playerList").innerHTML = room.players.map((p,i) => `
    <div class="player-row"><div class="avatar">${escapeHtml(p.name.slice(0,1).toUpperCase())}</div>
      <div class="player-meta"><strong>${escapeHtml(p.name)} ${p.id===me?.id?"(You)":""}</strong><small>${p.isBot?"Practice bot":`🪙 ${p.credits} credits`}</small></div>
      ${p.id===room.hostId?'<span class="host-tag">HOST</span>':""}
    </div>`).join("");
  $("startGame").classList.toggle("hidden", room.hostId !== me?.id || room.status==="playing" || room.status==="results");
  $("startGame").textContent = room.mode==="bot" ? "Start Practice Game" : "Start Game";
  $("gamePanel").classList.toggle("hidden", room.status==="lobby");
  if(room.status!=="lobby") $("phaseLabel").textContent = phaseText(room.phase);
}
function phaseText(phase) {
  return ({betting:"Betting phase",arranging:"Arrange your cards",results:"Round results"})[phase] || "Waiting";
}
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
function updateTimer() {
  clearInterval(tick);
  const run = () => {
    if (!deadline) { $("timerLabel").textContent = "--"; return; }
    const left = Math.max(0, Math.ceil((deadline-Date.now())/1000));
    $("timerLabel").textContent = `${left}s`;
    if(left<=0) clearInterval(tick);
  };
  run(); tick = setInterval(run, 300);
}
function renderHand() {
  const used = [...rows.front,...rows.middle,...rows.back];
  $("cardHand").innerHTML = myHand.map(card => {
    const info = cardInfo(card), isUsed = used.includes(card);
    return `<button class="playing-card ${info.red?"red":""} ${selectedCard===card?"selected":""} ${isUsed?"used":""}" data-card="${card}" ${isUsed?"disabled":""}>${info.label}</button>`;
  }).join("");
  ["front","middle","back"].forEach(row => {
    const limit = row==="front"?3:5;
    const container = $(row+"Slots");
    container.innerHTML = Array.from({length:limit},(_,i)=>{
      const card = rows[row][i];
      if(!card) return `<button class="slot" data-row="${row}">+</button>`;
      const info=cardInfo(card);
      return `<button class="slot filled ${info.red?"red":""}" data-remove="${card}" data-row="${row}">${info.label}</button>`;
    }).join("");
  });
  $("selectedCount").textContent = `${used.length}/13 placed`;
}
function startRound(data) {
  if(data.hands && me && data.hands[me.id]) myHand = data.hands[me.id];
  rows = {front:[],middle:[],back:[]}; selectedCard=null;
  currentPhase = data.phase || "betting"; deadline=data.deadline;
  $("gamePanel").classList.remove("hidden");
  $("handArea").classList.add("hidden"); $("resultsArea").classList.add("hidden");
  $("phaseLabel").textContent=phaseText(currentPhase); updateTimer();
  if(currentPhase==="betting") $("betInfo").textContent="Choose a virtual bet of 5, 10, or 15 credits. Betting closes in 12 seconds.";
}
function placeSelected(row) {
  if(!selectedCard) return toast("Tap a card first.");
  const limit = row==="front"?3:5;
  if(rows[row].length>=limit) return toast(`${row} is already full.`);
  rows[row].push(selectedCard); selectedCard=null; renderHand();
}
$("enterBtn").addEventListener("click",()=>{
  const name=$("playerName").value.trim();
  if(!name) return toast("Enter a player name first.");
  socket.emit("player:register",{name});
});
socket.on("player:ready",({player})=>{me=player;credits(player.credits);showScreen("lobbyScreen");toast(`Welcome, ${player.name}!`);});
document.querySelectorAll("[data-create]").forEach(btn=>btn.addEventListener("click",()=>{
  const mode=btn.dataset.create;
  if(mode==="private") { $("joinPanel").classList.remove("hidden"); $("roomCode").focus(); }
  else socket.emit("room:create",{mode});
}));
$("joinBtn").addEventListener("click",()=>{const code=$("roomCode").value.trim();if(!code)return toast("Enter a room code.");socket.emit("room:join",{code});});
socket.on("room:created",({room})=>{showScreen("roomScreen");renderRoom(room);toast(`Room ${room.code} created.`);});
socket.on("room:joined",({room})=>{showScreen("roomScreen");renderRoom(room);toast("You joined the room.");});
socket.on("room:update",room=>{if(currentRoom?.code===room.code || me?.id===room.hostId || room.players.some(p=>p.id===me?.id))renderRoom(room);});
$("copyCode").addEventListener("click",async()=>{try{await navigator.clipboard.writeText(currentRoom.code);toast("Room code copied.");}catch(e){toast("Room code: "+currentRoom.code);}});
$("startGame").addEventListener("click",()=>socket.emit("room:start"));
socket.on("round:started",data=>{if(data.room)renderRoom(data.room);startRound(data);});
socket.on("round:phase",data=>{currentPhase=data.phase;deadline=data.deadline;$("phaseLabel").textContent=phaseText(currentPhase);updateTimer();if(currentPhase==="arranging"){$("handArea").classList.remove("hidden");renderHand();}});
document.querySelectorAll("[data-bet]").forEach(btn=>btn.addEventListener("click",()=>{
  document.querySelectorAll("[data-bet]").forEach(b=>b.classList.remove("selected"));btn.classList.add("selected");
  socket.emit("round:bet",{bet:Number(btn.dataset.bet)});
}));
socket.on("round:bet-update",({bet,by})=>{$("betInfo").textContent=`Current table bet: ${bet} credits (chosen by ${by}).`;});
$("cardHand").addEventListener("click",e=>{
  const btn=e.target.closest("[data-card]");if(!btn)return;
  selectedCard=selectedCard===btn.dataset.card?null:btn.dataset.card;renderHand();
});
document.querySelector(".row-slots").addEventListener("click",e=>{
  const remove=e.target.closest("[data-remove]");
  if(remove){const row=remove.dataset.row;rows[row]=rows[row].filter(c=>c!==remove.dataset.remove);renderHand();return;}
  const slot=e.target.closest(".slot[data-row]");if(slot)placeSelected(slot.dataset.row);
});
$("autoArrange").addEventListener("click",()=>{
  rows={front:myHand.slice(0,3),middle:myHand.slice(3,8),back:myHand.slice(8,13)};selectedCard=null;renderHand();toast("Cards placed in deal order. Review before submitting.");
});
$("submitHand").addEventListener("click",()=>{
  const total=rows.front.length+rows.middle.length+rows.back.length;
  if(total!==13 || rows.front.length!==3 || rows.middle.length!==5 || rows.back.length!==5)return toast("Fill Front 3, Middle 5, and Back 5 cards.");
  socket.emit("round:submit",rows);
});
socket.on("round:submitted",()=>{toast("Hand submitted. Waiting for the other players.");$("submitHand").disabled=true;$("submitHand").textContent="Submitted";});
socket.on("round:results",data=>{
  currentPhase="results";deadline=null;updateTimer();$("phaseLabel").textContent="Round results";$("handArea").classList.add("hidden");$("resultsArea").classList.remove("hidden");
  const results=Object.values(data.results||{}).sort((a,b)=>b.delta-a.delta);
  $("resultsArea").innerHTML=`<h3 class="results-title">Round ${data.room.roundNumber} results</h3>`+results.map(r=>`<div class="result-item"><span>${escapeHtml(r.name)} ${r.foul?"· FOUL":""}</span><strong class="${r.delta>=0?"win":"loss"}">${r.delta>0?"+":""}${r.delta} credits</strong></div>`).join("")+
    `<p class="tiny-note">Scoring is a basic demo implementation. Verify house rules before using publicly.</p>`+
    `${data.room.hostId===me?.id?'<button id="nextRound" class="primary full">Next Round</button>': '<p class="tiny-note">Waiting for the host to start the next round.</p>'}`;
  const next=$("nextRound");if(next)next.addEventListener("click",()=>{ $("submitHand").disabled=false;$("submitHand").textContent="Submit hand";socket.emit("round:next");});
  if(data.room)renderRoom(data.room);
});
$("leaveRoom").addEventListener("click",()=>socket.emit("room:leave"));
socket.on("room:left",()=>{currentRoom=null;showScreen("lobbyScreen");});
$("depositOpen").addEventListener("click",()=>{socket.emit("wallet:history");showScreen("depositScreen");});
document.querySelectorAll("[data-credit]").forEach(btn=>btn.addEventListener("click",()=>socket.emit("wallet:deposit-demo",{amount:Number(btn.dataset.credit)})));
socket.on("wallet:update",data=>{credits(data.credits);toast(data.message);});
$("historyOpen").addEventListener("click",()=>{socket.emit("wallet:history");showScreen("historyScreen");});
socket.on("wallet:history-data",data=>{
  credits(data.credits);$("depositBalance").textContent=data.credits;
  $("historyList").innerHTML=data.history.length?data.history.map(item=>`<div class="history-item"><span>Round ${item.round} · ${escapeHtml(item.mode)}</span><strong class="${item.delta>=0?"win":"loss"}">${item.delta>0?"+":""}${item.delta}</strong></div>`).join(""):'<p class="muted">No rounds recorded yet. Play a round to see your results here.</p>';
});
document.querySelectorAll("[data-back]").forEach(btn=>btn.addEventListener("click",()=>showScreen("lobbyScreen")));
socket.on("app:error",({message})=>toast(message));
socket.on("connect",()=>{if(me)toast("Reconnected. Please refresh if your room state changed.");});
