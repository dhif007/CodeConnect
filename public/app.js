let socket = null;
let currentCode = null;
let currentName = null;
let pendingCreated = null;

const $ = (id) => document.getElementById(id);
const views = ["home","create","created","join","chat","pricing"];

function show(id) {
  views.forEach(v => $(v).classList.toggle("active", v === id));
  window.scrollTo(0,0);
}
function showHome(){show("home")}
function showCreate(){show("create")}
function showJoin(){show("join")}
function showPricing(){show("pricing")}

function toast(text) {
  const t=$("toast"); t.textContent=text; t.classList.add("show");
  clearTimeout(window.__toast); window.__toast=setTimeout(()=>t.classList.remove("show"),2200);
}
function formatCode(el){
  let v=el.value.toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,9);
  el.value=v.match(/.{1,3}/g)?.join("-")||"";
}

function generateRoomQR(code){
  const canvas = $("qrCanvas");

  if(!canvas || typeof QRCode === "undefined"){
    console.error("QR Code library is not available.");
    return;
  }

  const inviteUrl =
    `${location.origin}/?join=${encodeURIComponent(code)}`;

  QRCode.toCanvas(
    canvas,
    inviteUrl,
    {
      width: 220,
      margin: 2,
      errorCorrectionLevel: "M"
    },
    (error)=>{
      if(error){
        console.error("QR generation failed:", error);
      }
    }
  );
}

async function createRoom(){
  const name=$("createName").value.trim();
  $("createError").textContent="";

  if(!name){
    $("createError").textContent="Please enter your name.";
    return;
  }

  try{
    const r=await fetch("/api/rooms",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({})
    });

    const data=await r.json();

    if(!r.ok){
      $("createError").textContent=data.error || "Could not create the room.";
      return;
    }

    if(!data.code){
      $("createError").textContent="Could not create the room.";
      return;
    }

    pendingCreated={code:data.code,name};

$("createdCode").textContent=data.code;
$("waitStatus").textContent="🟡 Waiting for someone to join...";

generateRoomQR(data.code);

show("created");

    connectSocket();

    socket.emit("join-room",{code:data.code,username:name},res=>{
      if(!res.ok){
        toast(res.error);
        return;
      }

      updatePeople(res.participants);
    });

  }catch(e){
    $("createError").textContent="Could not create the room.";
  }
}
function connectSocket(){
  if(socket) return;
  socket=io();
  socket.on("connect",()=>{$("connDot").style.color="#65e6a4";$("connText").textContent="Connected"});
  socket.on("disconnect",()=>{$("connDot").style.color="#ff6b7a";$("connText").textContent="Disconnected"});
  socket.on("message",addMessage);
  socket.on("system-message",m=>addSystem(m.text));
  socket.on("presence",({participants})=>{
    updatePeople(participants);
    if(pendingCreated && participants>1) $("waitStatus").textContent="🟢 Someone joined — you're connected!";
  });
  socket.on("typing",({username,isTyping})=>{
    $("typing").textContent=isTyping ? `${username} is typing...` : "";
  });
}
function updatePeople(n){$("people").textContent=n}
function enterCreatedChat(){
  if(!pendingCreated)return;
  currentCode=pendingCreated.code; currentName=pendingCreated.name;
  $("chatCode").textContent=currentCode;
  $("messages").innerHTML="";
  show("chat");
}
function joinRoom(){
  const name=$("joinName").value.trim();
  const code=$("joinCode").value.trim().toUpperCase();
  $("joinError").textContent="";
  if(!name){$("joinError").textContent="Please enter your name.";return}
  if(code.length!==11){$("joinError").textContent="Enter a valid XXX-XXX-XXX code.";return}
  currentCode=code; currentName=name;
  connectSocket();
  socket.emit("join-room",{code,username:name},res=>{
    if(!res.ok){$("joinError").textContent=res.error;return}
    $("chatCode").textContent=code;
    $("messages").innerHTML="";
    (res.messages||[]).forEach(addMessage);
    updatePeople(res.participants);
    show("chat");
  });
}
function addMessage(m){
  const wrap=document.createElement("div");
  wrap.className="msg"+(m.username===currentName?" mine":"");
  const bubble=document.createElement("div"); bubble.className="bubble";
  bubble.textContent=m.text;
  const meta=document.createElement("div"); meta.className="meta";
  meta.textContent=`${m.username} · ${new Date(m.timestamp).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}`;
  wrap.append(bubble,meta); $("messages").appendChild(wrap);
  $("messages").scrollTop=$("messages").scrollHeight;
}
function addSystem(text){
  const d=document.createElement("div");d.className="system";d.textContent=text;
  $("messages").appendChild(d);$("messages").scrollTop=$("messages").scrollHeight;
}
function sendMessage(e){
  e.preventDefault();
  const input=$("messageInput"), text=input.value.trim();
  if(!text||!socket)return;
  socket.emit("message",{text},res=>{if(!res.ok)toast(res.error)});
  input.value=""; socket.emit("typing",false); input.focus();
}
let typingTimer;
$("messageInput").addEventListener("input",()=>{
  if(!socket)return;
  socket.emit("typing",true);
  clearTimeout(typingTimer);
  typingTimer=setTimeout(()=>socket.emit("typing",false),800);
});
function leaveRoom(){
  if(socket)socket.emit("leave-room");
  currentCode=null; pendingCreated=null;
  showHome();
}
function copyCode(){
  const code=$("createdCode").textContent;
  navigator.clipboard?.writeText(code).then(()=>toast("Room code copied."));
}
async function shareRoom(){
  const code=$("createdCode").textContent;
  const url=`${location.origin}/?join=${encodeURIComponent(code)}`;
  if(navigator.share){await navigator.share({title:"Join my CodeConnect room",text:`Join my private room: ${code}`,url})}
  else {await navigator.clipboard.writeText(`${code}\n${url}`);toast("Invite copied.")}
}
function premiumDemo(){
  $("premiumNote").textContent="Premium checkout is scaffolded for the next step. Connect a payment gateway to activate real subscriptions.";
  toast("Premium checkout coming next.");
}
window.addEventListener("load",()=>{
  const params=new URLSearchParams(location.search);
  const join=params.get("join");
  if(join){showJoin();$("joinCode").value=join;formatCode($("joinCode"))}
});
