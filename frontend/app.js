const $=s=>document.querySelector(s),esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const ss=sessionStorage; // session storage: login page appears every time the app is opened fresh
// Admin "view as user" (read-only): the admin page opens  /#view=<token>&roll=<roll>[&ds=<id>]
if(location.hash.startsWith("#view=")){const q=new URLSearchParams(location.hash.slice(1));
 ["pcs_token","pcs_roll","pcs_view","pcs_ds"].forEach(k=>ss.removeItem(k));ss.setItem("pcs_token",q.get("view"));ss.setItem("pcs_roll",q.get("roll")||"");ss.setItem("pcs_view","1");
 if(q.get("ds"))window.VGO=+q.get("ds");if(q.get("pred"))window.VPRED=+q.get("pred");history.replaceState(null,"",location.pathname)}
const VIEW=ss.getItem("pcs_view")==="1"; // true = an admin is looking at a user's account: nothing can be trained, screened, uploaded, deleted or changed
if(VIEW)document.body.classList.add("view");
const S={token:ss.getItem("pcs_token"),roll:ss.getItem("pcs_roll"),ds:null,page:"dashboard",filter:"all",q:"",sel:null,model:"SVR",temp:"",file:null};
const ic=p=>`<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
const ICON={dashboard:ic('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>'),training:ic('<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>'),performance:ic('<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/>'),results:ic('<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>'),export:ic('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>')};
ICON.predict=ic('<path d="M9 3h6"/><path d="M10 3v6.5L4.5 19a1.5 1.5 0 0 0 1.3 2.2h12.4a1.5 1.5 0 0 0 1.3-2.2L14 9.5V3"/><path d="M7.5 15h9"/>');
const fmt=(v,d=3)=>v==null?"—":(typeof v==="number"?(Math.abs(v)<1e-3&&v!==0||Math.abs(v)>1e5?v.toExponential(2):+v.toFixed(d)):esc(v));
const badge=v=>`<span class="badge ${String(v).replace(/ /g,"")}"${v==="NOT AVAILABLE"?' title="Could not be evaluated"':""}>${v==="NOT AVAILABLE"?"N/A":v==="INCOMPLETE"?"NOT EVALUABLE":v==="NOT REACHED"?"—":v}</span>`;
const lvl={CHEAP:"Cheap",MODERATE:"Moderate",EXPENSIVE:"Expensive"};
const usd=v=>v==null?"—":"$"+(v>=100?Math.round(v).toLocaleString():v>=10?v.toFixed(1):v.toFixed(2))+"/kg";
const toast=m=>{const t=$("#toast");t.textContent=m;t.style.display="block";setTimeout(()=>t.style.display="none",4000)};
async function api(p,o={}){o.headers={...(o.headers||{}),Authorization:"Bearer "+S.token};if(o.json){o.headers["Content-Type"]="application/json";o.body=JSON.stringify(o.json);o.method=o.method||"POST"}
 let r;try{r=await fetch("/api"+p,o)}catch(e){throw new Error("Cannot reach the server (API failure). Is the backend still running?")}
 if(r.status===401&&p!=="/login"&&p!=="/admin/login"){logout();throw new Error("Session expired – please log in again.")}
 if(!(r.headers.get("content-type")||"").includes("json"))return r;const j=await r.json();if(!r.ok)throw new Error(j.error||"Request failed");return j}
async function busy(msgs,fn){const b=$("#busy");b.classList.remove("hidden");let i=0;$("#busymsg").textContent=msgs[0];const t=setInterval(()=>$("#busymsg").textContent=msgs[Math.min(++i,msgs.length-1)],1800);
 try{return await fn()}finally{clearInterval(t);b.classList.add("hidden")}}

// ---------- Training flowchart: shows what the server is REALLY doing, top to bottom, as each step starts ----------
async function flow(title,fn){
 const rid=Date.now().toString(36)+Math.random().toString(36).slice(2,8);
 const el=document.createElement("div");el.id="flow";
 el.innerHTML=`<div class="fl-card"><div class="fl-head"><div class="fl-t">${esc(title)}</div><div class="fl-time" id="fl_time">0:00</div></div><div class="fl-body" id="fl_body"></div><div class="fl-foot">Training runs on the server – large datasets can take a few minutes.</div></div>`;
 document.body.appendChild(el);
 const body=el.querySelector("#fl_body"),t0=Date.now();let since=0,last=null,run=true;
 const clock=setInterval(()=>{const s=Math.floor((Date.now()-t0)/1000);$("#fl_time").textContent=Math.floor(s/60)+":"+String(s%60).padStart(2,"0")},500);
 const add=(m,d,fin)=>{if(last)last.classList.remove("act");
  if(last)body.insertAdjacentHTML("beforeend",'<div class="fl-arr"><svg viewBox="0 0 10 12" width="10" height="12"><path d="M5 0v9M1.5 6L5 10l3.5-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></div>');
  const n=document.createElement("div");n.className="fl-node"+(fin?" fin":" act");
  n.innerHTML=`<b>${esc(m)}</b>${d?`<small>${esc(d)}</small>`:""}${fin?"":'<span class="fl-dots"><i></i><i></i><i></i></span>'}`;
  body.appendChild(n);last=n;requestAnimationFrame(()=>{n.classList.add("show");body.scrollTo({top:body.scrollHeight,behavior:"smooth"})})};
 const poll=async()=>{try{const j=await api(`/datasets/${S.ds.id}/progress?rid=${rid}&since=${since}`);if(j&&j.events){since=j.n;j.events.forEach(e=>add(e.m,e.d))}}catch(e){}};
 const loop=(async()=>{while(run){await poll();await sleep(700)}})();
 try{const r=await fn(rid);run=false;await loop;await poll();last&&last.classList.remove("act");add("Training complete","models saved",true);await sleep(1100);return r}
 finally{run=false;clearInterval(clock);el.remove()}}

async function dl(path,name){await busy(["Preparing Excel..."],async()=>{const r=await api(path);if(r.blob){const u=URL.createObjectURL(await r.blob()),a=document.createElement("a");a.href=u;a.download=name;a.click()}})}
function logout(){if(VIEW){["pcs_token","pcs_roll","pcs_view","pcs_ds"].forEach(k=>ss.removeItem(k));window.close();setTimeout(()=>location.replace("/admin"),150);return}
 if(S.token)fetch("/api/logout",{method:"POST",headers:{Authorization:"Bearer "+S.token},keepalive:true}).catch(()=>{});ss.clear();S.token=null;S.ds=null;S.sel=null;setRole("user");setReg(false);show()}
$("#logout").onclick=logout;$("#mx").onclick=()=>closeModal();
let ROLE="user",REG=false;
function setModeBadge(t){const b=$("#modeBadge");if(b)b.textContent=t;}

function setReg(r){
  REG=!!r;
  const lbtn=$("#lbtn"), regq=$("#regq"), regt=$("#regt"), pw=$("#pw"), lerr=$("#lerr"), lf=$("#lf");
  const sub=lf?lf.querySelector(".muted"):null;
  if(lerr){
    lerr.textContent="";
    lerr.className="err";
    lerr.style.color="";
  }
  if(ROLE==="admin") return;
  setModeBadge(REG?"Register":"Login");

  if(REG){
    if(lbtn){
      lbtn.textContent="Create account";
      lbtn.classList.remove("admin-btn");
      lbtn.disabled=false;
    }
    if(regq) regq.textContent="Already registered?";
    if(regt) regt.textContent="Log in";
    if(pw) pw.autocomplete="new-password";
    if(sub) sub.textContent="Screening Cathodes for Optimal Perovskite Efficiency";
  } else {
    if(lbtn){
      lbtn.textContent="Log in";
      lbtn.classList.remove("admin-btn");
      lbtn.disabled=false;
    }
    if(regq) regq.textContent="New user?";
    if(regt) regt.textContent="Create account";
    if(pw) pw.autocomplete="current-password";
    if(sub) sub.textContent="Screening Cathodes for Optimal Perovskite Efficiency";
  }
}
const setMode=m=>setReg(m==="register");
window.setReg=setReg;
window.setMode=setMode;

function setRole(r){
  ROLE=r;
  const a=ROLE==="admin";
  REG=false;
  const lf=$("#lf");
  const h1=lf?lf.querySelector("h1"):null;
  const sub=lf?lf.querySelector(".muted"):null;
  const l1t=$("#l1t"),roll=$("#roll"),pw=$("#pw"),lbtn=$("#lbtn"),regw=$("#regw"),lerr=$("#lerr");
  if(lerr){ lerr.textContent=""; lerr.className="err"; lerr.style.color=""; }
  if(pw){ pw.value=""; pw.autocomplete="current-password"; }

  setModeBadge(a?"Admin Login":"Login");
  if(a){
    if(h1) h1.innerHTML='SCOPE <span class="role-badge admin">ADMIN</span>';
    if(sub) sub.textContent="Sign in with administrator credentials";
    if(l1t) l1t.textContent="Admin Username";
    if(roll){ roll.placeholder="Enter admin username"; roll.value=""; }
    if(lbtn){ lbtn.textContent="Sign in as Admin"; lbtn.classList.add("admin-btn"); lbtn.disabled=false; }
    if(regw){
      regw.style.display="";
      regw.innerHTML='<a href="#" id="swUser" class="role-sw">← Back to User Login</a>';
    }
    document.querySelectorAll(".admin-lock-btn").forEach(b=>b.classList.add("active"));
  } else {
    if(h1) h1.textContent="SCOPE";
    if(sub) sub.textContent="Screening Cathodes for Optimal Perovskite Efficiency";
    if(l1t) l1t.textContent="Username";
    if(roll){ roll.placeholder="Enter your username"; roll.value=""; }
    if(lbtn){ lbtn.textContent="Log in"; lbtn.classList.remove("admin-btn"); lbtn.disabled=false; }
    if(regw){
      regw.style.display="";
      regw.innerHTML='<span id="regq">New user?</span> <a href="#" id="regt">Create account</a>';
    }
    document.querySelectorAll(".admin-lock-btn").forEach(b=>b.classList.remove("active"));
  }
}
window.setRole=setRole;

// Event delegation on regw ensures switches always work cleanly
const regwEl=$("#regw");
if(regwEl){
  regwEl.onclick=e=>{
    const t=e.target;
    if(!t) return;
    if(t.id==="swUser"||t.closest("#swUser")){
      e.preventDefault();
      setRole("user");
      setReg(false);
    } else if(t.id==="toLogin"||t.closest("#toLogin")){
      e.preventDefault();
      setReg(false);
    } else if(t.id==="toReg"||t.closest("#toReg")){
      e.preventDefault();
      setReg(true);
    } else if(t.id==="regt"||t.closest("#regt")){
      e.preventDefault();
      setReg(!REG);
    }
  };
}

document.querySelectorAll(".admin-lock-btn").forEach(btn=>{
  btn.onclick=e=>{
    e.preventDefault();
    if(!$("#login").classList.contains("hidden")){
      setRole(ROLE==="admin"?"user":"admin");
      window.scrollTo({top:0,behavior:"smooth"});
      setTimeout(()=>{const r=$("#roll");if(r)r.focus();},300);
    } else {
      location.href="/admin";
    }
  };
});

$("#lf").onsubmit=async e=>{
  e.preventDefault();
  const lerr=$("#lerr");
  if(lerr){ lerr.textContent=""; lerr.className="err"; lerr.style.color=""; }
  const uname=$("#roll").value.trim();
  const pwd=$("#pw").value;

  try{
    if(ROLE==="admin"){
      const j=await api("/admin/login",{json:{username:uname,password:pwd}});
      ss.clear();
      ss.setItem("pcs_admin_token",j.token);
      $("#pw").value="";
      location.href="/admin";
      return;
    }
    if(REG){
      // 1. Client-side input validation for Create Account
      if(!uname){
        if(lerr) lerr.textContent="Please enter a username.";
        $("#roll").focus();
        return;
      }
      if(uname.length<3||uname.length>30||!/^[A-Za-z0-9._@-]{3,30}$/.test(uname)){
        if(lerr) lerr.textContent="Username must be 3–30 characters: letters, digits, . _ @ - (no spaces).";
        $("#roll").focus();
        return;
      }
      if(!pwd){
        if(lerr) lerr.textContent="Please enter a password.";
        $("#pw").focus();
        return;
      }

      // 2. Register new user account
      const b=$("#lbtn");
      if(b){ b.disabled=true; b.textContent="Creating account…"; }
      try{
        await api("/register",{json:{username:uname,password:pwd}});
      }catch(err){
        if(b){ b.disabled=false; b.textContent="Create account"; }
        if(lerr) lerr.textContent=err.message;
        return;
      }

      // 3. Switch cleanly to Login view and show registration confirmation message
      if(b){ b.disabled=false; }
      setReg(false);
      $("#roll").value=uname;
      $("#pw").value=pwd;

      if(lerr){
        lerr.className="err ok";
        lerr.style.color="#2fd6d0";
        lerr.textContent="Account created successfully! Please click Log in.";
      }
      toast("Account created successfully! Please click Log in.");
      return;
    }

    // Normal User Login - validates credentials, never triggers duplicate username error
    const j=await api("/login",{json:{username:uname,password:pwd}});
    S.token=j.token;
    S.roll=j.roll_number;
    ss.setItem("pcs_token",j.token);
    ss.setItem("pcs_roll",j.roll_number);
    $("#pw").value="";
    show();
  }catch(x){
    if(lerr){
      lerr.className="err";
      lerr.style.color="";
      lerr.textContent=x.message;
    }
  }
};
async function show(){
  const ok=!!S.token;
  $("#login").classList.toggle("hidden",ok);
  $("#app").classList.toggle("hidden",!ok);
  const lgLock=$("#lgAdminLock");
  if(lgLock) lgLock.style.display=ok?"none":"";
  if(!ok)return;
  $("#who").textContent=(VIEW?"Admin view · ":"")+"Username: "+S.roll;
  if(VIEW){$("#logout").textContent="Close";if(!$("#vb")){const b=document.createElement("div");b.id="vb";b.textContent="Admin view · read-only";document.body.appendChild(b)}}
  if(window.VGO){const id=window.VGO;window.VGO=null;try{return await openDs(id)}catch(e){}}
  const id=ss.getItem("pcs_ds");if(id&&!S.ds){try{S.ds=await api("/datasets/"+id)}catch(e){ss.removeItem("pcs_ds")}}go(S.page||"dashboard");
  if(window.VPRED){const pid=window.VPRED;window.VPRED=null;   // admin clicked "View" on a prediction: open that user's saved summary page (same popup the user gets)
   try{const list=await api("/my-predictions");window._pp=list;const i=list.findIndex(p=>p.id===pid);if(i>=0)ppDetail(i);else toast("That prediction could not be found.")}catch(e){toast(e.message)}}}
const backTo=()=>S.page==="performance"?(S.ds&&S.ds.summary?"results":"training"):"dashboard";
const allowed=p=>!S.ds||p==="dashboard"||p==="training"||(p==="performance"?!!S.ds.train:(S.ds.status==="screened"&&!!S.ds.summary));
function go(p){if(!allowed(p))p=S.ds.train?"performance":"training";S.page=p;
 $("#bar").innerHTML=p==="dashboard"?"":`<button class="btn sec sm" onclick="go(backTo())">← Back</button><span class="muted small bar-file" onclick="openFile(${S.ds.id})" title="Open this dataset in Excel">${esc(S.ds.filename)}</span>`;
 $("#main").innerHTML="";window.scrollTo(0,0);Promise.resolve(P[p]()).catch(e=>{$("#main").innerHTML=`<div class="note bad">${esc(e.message)}</div>`})}
async function openDs(id,page){S.ds=await api("/datasets/"+id);ss.setItem("pcs_ds",id);S.filter="all";S.q="";S.sel=null;go(page||(S.ds.status==="screened"?"results":"training"))}
const need=()=>S.ds?"":`<div class="card">No dataset open. Go to the <a href="#" onclick="go('dashboard');return false">Dashboard</a> and click OPEN on a dataset.</div>`;
const stat=(v,l,c="")=>`<div class="stat ${c}"><b>${v}</b><span>${l}</span></div>`;
const P={};
S.mode="upload";   // dashboard slider: "upload" = Upload Dataset (+ history), "predict" = Predict Single Cathode
P.dashboard=async()=>{const d=await api("/dashboard");S.dash=d;
 $("#main").innerHTML=`<h2>Welcome ${esc(d.roll_number)}</h2>
 <div class="mt" id="mt" data-mode="${S.mode}" role="tablist"><span class="mt-pill"></span><button type="button" data-m="upload" role="tab" class="${S.mode==="upload"?"on":""}">UPLOAD DATASET</button><button type="button" data-m="predict" role="tab" class="${S.mode==="predict"?"on":""}">PREDICT SINGLE CATHODE</button></div>
 <div id="dmode"></div>`;
 document.querySelectorAll("#mt button").forEach(b=>b.onclick=()=>setDashMode(b.dataset.m));
 dashMode()};
window.setDashMode=m=>{S.mode=m;$("#mt").dataset.mode=m;document.querySelectorAll("#mt button").forEach(x=>x.classList.toggle("on",x.dataset.m===m));dashMode()};
function dashMode(){const d=S.dash,el=$("#dmode");if(!el)return;
 if(S.mode==="predict")return predictMode(d,el);
 const card=x=>`<div class="ds ${S.ds&&S.ds.id===x.id?"cur":""}"><div><b class="dsname" onclick="openDs(${x.id})">${esc(x.filename)}</b><br>${x.temperature!=null?`<span class="small"><b class="ds-temp">${+(+x.temperature).toFixed(2)} °C</b></span><br>`:""}${x.status==="screened"?`Num of cathodes passed: <b>${x.pass}</b>`:`<span class="badge NA">${x.status}</span> not screened yet`}</div>
  <div><button class="btn sm" onclick="openDs(${x.id})">OPEN</button> <button class="btn sm sec" ${x.status!=="screened"?"disabled":""} onclick="openDs(${x.id},'results')">RESULTS</button> ${VIEW?"":`<button class="btn sm sec" onclick="delDs(${x.id})">Delete</button>`}</div></div>`;
 el.innerHTML=`${VIEW?"":`<div class="scr-grid"><div class="drop" id="dz"><b style="font-size:18px"><svg class="cloud" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 8.5a4.75 4.75 0 0 1-.5 9.5"/><path d="M12 12v8m0-8l-3 3m3-3l3 3"/></svg>Upload New Dataset</b><br><span class="muted" id="dzt"></span><input type="file" id="fi" accept=".csv,.xlsx,.xls" class="hidden"></div>
  <div class="temp-box"><label class="fld"><span class="fl-k">Temperature</span><span class="fl-l">Operating temperature (&deg;C)</span><input type="number" step="any" id="st_t" placeholder="e.g. 700" value="${esc(S.temp)}"></label></div></div>
  <div class="scr-act"><button type="button" class="btn" id="scrbtn" onclick="runScreenBatch()">Screen</button> <button type="button" class="btn sec" id="cncbtn" onclick="cancelDataset()">Cancel</button></div>`}
  <h3 style="margin-top:18px">${VIEW?"DATASET HISTORY":"MY DATASET HISTORY"}</h3>${d.datasets.map(card).join("")||'<p class="muted">No datasets uploaded yet.</p>'}`;
 const dz=$("#dz"),fi=$("#fi");if(dz){setFile(S.file);dz.onclick=()=>{fi.value="";fi.click()};dz.ondragover=e=>{e.preventDefault();dz.classList.add("over")};dz.ondragleave=()=>dz.classList.remove("over");dz.ondrop=e=>{e.preventDefault();dz.classList.remove("over");setFile(e.dataTransfer.files[0])};fi.onchange=()=>setFile(fi.files[0]);
  const t=$("#st_t");t.oninput=()=>S.temp=t.value;t.onkeydown=e=>{if(e.key==="Enter")runScreenBatch()}}}
function predictMode(d,el){
 if(VIEW){el.innerHTML=`<div id="pmount"></div>`;return P.predictHistory()}   // admin view: show the user's past predictions, never the "no trained models" message
 const ready=d.datasets.filter(x=>x.trained&&(x.status==="trained"||x.status==="screened"));
 (VIEW?Promise.resolve({available:false}):api("/shared").catch(()=>({available:false}))).then(sh=>{
  if(!ready.length&&!sh.available){el.innerHTML=`<div class="card">No trained models yet. Switch to <a href="#" onclick="setDashMode('upload');return false">Upload Dataset</a> and upload a dataset once &ndash; the SVR is trained and saved automatically, then you can predict single cathodes.</div>`;return}
  const opts=[...(sh.available?[{v:"shared",t:"Built-in trained models (SVR) – no upload needed"}]:[]),...ready.map(x=>({v:x.id,t:`${x.filename} · ${x.upload_date}`}))];
  const cur=String(S.ds&&S.ds.shared?"shared":S.ds&&S.ds.train&&ready.some(x=>x.id===S.ds.id)?S.ds.id:opts[0].v);
  el.innerHTML=`<div id="pmount"></div>`;
  const load=async v=>{try{if(v==="shared"){S.ds=sh}else{const id=+v;if(!S.ds||S.ds.shared||S.ds.id!==id||!S.ds.train){S.ds=await api("/datasets/"+id);ss.setItem("pcs_ds",id)}}await P.predict()}catch(e){toast(e.message)}};
  load(cur)})}
window.delDs=async id=>{if(confirm("Delete this dataset and all its results?")){await api("/datasets/"+id,{method:"DELETE"});if(S.ds&&S.ds.id===id){S.ds=null;ss.removeItem("pcs_ds")}go("dashboard")}};
window.setFile=f=>{S.file=f||null;const cb=$("#cncbtn");if(cb)cb.classList.toggle("hidden",!S.file);const t=$("#dzt");if(!t)return;
 t.innerHTML=S.file?`<b>${esc(S.file.name)}</b> · ${(S.file.size/1024).toFixed(S.file.size<10240?1:0)} KB &ndash; click to change`:"Drop a CSV / Excel file here or click to browse"};
// Cancel: forget the chosen dataset and the typed temperature (the file stays selected after Screen / Back so the temperature can be changed and re-screened)
window.cancelDataset=()=>{S.temp="";const fi=$("#fi");if(fi)fi.value="";const t=$("#st_t");if(t)t.value="";setFile(null)};
// one step: dataset + temperature -> every cathode screened with the Predict-page logic -> Screening Results
window.runScreenBatch=async()=>{
 const t=($("#st_t")?.value||"").trim();S.temp=t;
 if(!S.file)return toast("Choose a dataset file first.");
 if(t===""||!isFinite(+t)||+t+273.15<=0)return toast("Enter the temperature (°C) – it is converted to 1000/T.");
 const fd=new FormData();fd.append("file",S.file);fd.append("temperature",t);const b=$("#scrbtn");if(b)b.disabled=true;
 try{const j=await busy(["Reading the dataset...","Recognising formulas and calculating descriptors...","Predicting material properties...","Predicting TEC, Ehull and log10(k*)...","Applying the TEC / log10(k*) / Ehull filters..."],()=>api("/screening/run",{method:"POST",body:fd}));
  if(j.duplicate)toast("This dataset was already screened at "+t+" °C – results refreshed.");
  const rm=(j.duplicates_removed||0)+(j.empty_rows_removed||0);if(rm)toast(`Cleaned automatically: ${j.duplicates_removed||0} repeated row(s)/cathode(s) and ${j.empty_rows_removed||0} empty row(s) removed – ${j.total} of ${j.raw_rows} rows screened.`);await openDs(j.id,"results")}
 catch(e){toast(e.message)}finally{const b2=$("#scrbtn");if(b2)b2.disabled=false}};
const selc=(id,cols,val)=>`<select id="${id}"><option value="">— choose column —</option>${cols.map(c=>`<option ${c===val?"selected":""}>${esc(c)}</option>`).join("")}</select>`;
const mstat=e=>e.usable?'<span class="ok">Available</span>':`<span class="na">Not available</span> <span class="small muted">${e.present?"("+esc(e.reason)+")":""}</span>`;
window.setMap=async(key,col)=>{try{const j=await api(`/datasets/${S.ds.id}/mapping`,{json:{descriptors:{[key]:col}}});S.ds.analysis.descriptors=j.descriptors;S.ds.analysis.mapping=j.mapping;const e=j.descriptors.find(x=>x.key===key);$("#ms_"+key).innerHTML=mstat(e);toast("Mapping updated")}catch(err){toast(err.message)}};
P.training=()=>{if(!S.ds)return $("#main").innerHTML=need();const a=S.ds.analysis,m=S.ds.train?.mapping||a.mapping,miss=Object.entries(a.missing),inv=Object.entries(a.invalid_numeric),d=a.descriptors;
 const pick=(l,id)=>`<tr><td>${l}</td><td>${selc(id,a.columns,null)} <span class="na">Not detected – choose it</span></td></tr>`;
 const need_map=!m.formula||!m.target;
 $("#main").innerHTML=`<h2>Dataset Analysis</h2><div class="grid g4">${stat(esc(S.ds.filename).slice(0,22),"File")}${stat(a.rows,"Cathodes (rows)")}${stat(a.n_columns,"Columns")}</div>
 ${!m.ehull?'<div class="note bad">Ehull column is <b>not available</b> in this dataset.</div>':""}
 ${need_map&&!VIEW?`<div class="card"><h3>Select the missing columns</h3><table>${!m.formula?pick("Chemical formula","m_f"):""}${!m.target?pick("Target log10(k*)","m_t"):""}</table></div>`:""}
 <div class="card"><details id="mapdet"${S.mapOpen?" open":""} ontoggle="S.mapOpen=this.open"><summary><h3 style="display:inline">Mapping of features</h3></summary>
 <p class="muted small" style="margin:8px 0">If a descriptor is mapped to the wrong column, pick the correct one from your dataset's columns.</p>
 <div class="tw"><table><thead><tr><th>Paper descriptor</th><th>Group</th><th>Unit</th><th>Dataset column</th><th>Status</th></tr></thead><tbody>${d.map(e=>`<tr><td>${esc(e.label)}</td><td>${e.group}</td><td>${esc(UNITS.unit(e.key))}</td><td>${selc("",a.columns,e.column).replace('<select id="">',`<select ${VIEW?"disabled":""} onchange="setMap('${e.key}',this.value)">`).replace("— choose column —","— not mapped —")}</td><td id="ms_${e.key}">${mstat(e)}</td></tr>`).join("")}</tbody></table></div></details></div>
 ${miss.length?`<div class="card"><h3>Missing values</h3>${miss.map(([c,n])=>`${esc(c)}: ${n}`).join(" · ")}</div>`:""}
 ${inv.length?`<div class="card"><h3>Invalid numerical values</h3>${inv.map(([c,n])=>`${esc(c)}: ${n} non-numeric entries treated as missing`).join("<br>")}</div>`:""}
 ${VIEW?"":`<div class="card"><button class="btn train-big" onclick="runTrain()">Train dataset</button></div>`}`};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
window.openFile=async id=>{try{const j=VIEW?null:await api(`/datasets/${id}/open`,{method:"POST"});if(j&&j.opened){toast("Opening the dataset in Excel…");return}
  const r=await fetch(`/api/datasets/${id}/file`,{headers:{Authorization:"Bearer "+S.token}});if(!r.ok)throw new Error("Could not open the dataset file.");
  const b=await r.blob(),a=document.createElement("a");a.href=URL.createObjectURL(b);a.download=S.ds&&S.ds.id===id?S.ds.filename:"dataset";document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),4000);toast("Dataset downloaded – open it with Excel.")}
 catch(e){toast(e.message)}};
window.runTrain=async()=>{const v=id=>$("#"+id)?.value||null;const mp={formula:v("m_f"),target:v("m_t")};
 try{await flow("Training SVR, then screening",async rid=>{await api(`/datasets/${S.ds.id}/train`,{json:{mapping:mp,rid}});
   await api(`/datasets/${S.ds.id}/screen`,{json:{model:"SVR",both:true}})});S.model="SVR";await openDs(S.ds.id,"results")}
 catch(e){toast(e.message);go("training");$("#main").insertAdjacentHTML("afterbegin",`<div class="note bad">${esc(e.message)}</div>`)}};
window.runScreen=async(m)=>{m=m||"SVR";
 try{await busy(["Predicting cathodes...","Applying screening criteria...","Generating results..."],()=>api(`/datasets/${S.ds.id}/screen`,{json:{model:m}}));await openDs(S.ds.id,"results")}
 catch(e){toast(e.message)}};
function parity(p){
 const W=380,pad=40,all=p.y.concat(p.pred,p.y_train||[],p.pred_train||[]),lo=Math.min(...all),hi=Math.max(...all),sc=v=>pad+(v-lo)/(hi-lo)*(W-2*pad),tk=[0,1,2,3,4].map(i=>lo+(hi-lo)*i/4);
 const grid=tk.map(v=>`<line x1="${sc(v)}" x2="${sc(v)}" y1="${pad-10}" y2="${W-pad}" stroke="#eef2f6"/><line y1="${W-sc(v)}" y2="${W-sc(v)}" x1="${pad}" x2="${W-pad+10}" stroke="#eef2f6"/><text x="${sc(v)}" y="${W-pad+16}" text-anchor="middle" font-size="10" fill="#64748b">${v.toFixed(1)}</text><text x="${pad-6}" y="${W-sc(v)+3}" text-anchor="end" font-size="10" fill="#64748b">${v.toFixed(1)}</text>`).join("");
 const dots=(ys,ps,c,o,r)=>(ys||[]).map((y,i)=>`<circle cx="${sc(y)}" cy="${W-sc(ps[i])}" r="${r}" fill="${c}" opacity="${o}"/>`).join("");
 return `<svg viewBox="0 0 ${W} ${W}" style="width:100%;max-width:${W}px;background:#fff;border:1px solid var(--line);border-radius:10px">${grid}<line x1="${sc(lo)}" y1="${W-sc(lo)}" x2="${sc(hi)}" y2="${W-sc(hi)}" stroke="#c1121f" stroke-dasharray="5 4"/>${dots(p.y_train,p.pred_train,"#9db4c4",.55,3)}${dots(p.y,p.pred,"#0f8b8d",.9,4.5)}<text x="${W/2}" y="${W-6}" text-anchor="middle" font-size="11" fill="#0f2a43">experimental log10(k*) (${UNITS.LOGK})</text><text x="11" y="${W/2}" font-size="11" fill="#0f2a43" transform="rotate(-90 11 ${W/2})" text-anchor="middle">predicted log10(k*) (${UNITS.LOGK})</text></svg>
 <div class="lg"><span><i style="background:#0f8b8d"></i>Test set (40%, unseen)</span><span><i style="background:#9db4c4"></i>Training set (60%)</span></div>`}

// ---------- correlation & covariance ----------
const relWord=r=>{const a=Math.abs(r);return a>=.8?"very strong":a>=.6?"strong":a>=.4?"moderate":a>=.2?"weak":"very weak"};
const relDir=r=>Math.abs(r)<.2?"no clear link":r>0?"rise together":"one rises, the other falls";
const relNum=v=>v==null?"—":(Math.abs(v)>=100?v.toFixed(0):Math.abs(v)>=10?v.toFixed(1):v.toFixed(2));
function relMatrix(st,mode){
 const M=mode==="corr"?st.corr:st.cov,C=st.corr,nm=st.names,n=nm.length;
 // colour always shows direction + strength (from the correlation) so the two tabs read the same way; the printed number is the correlation or the covariance
 const cell=(v,i,j)=>{if(v==null)return '<td class="mx-n">—</td>';const r=C[i][j],a=r==null?0:Math.min(1,Math.abs(r)),
   bg=i===j?"rgba(100,116,139,.16)":(r>=0?`rgba(37,99,235,${(.08+.82*a).toFixed(2)})`:`rgba(220,38,38,${(.08+.82*a).toFixed(2)})`);
  const tip=i===j?`${nm[i]}: ${mode==="corr"?"compared with itself, always 1":"variance (spread) = "+v}`:`${nm[i]} and ${nm[j]}: ${mode==="corr"?"correlation "+v:"covariance "+v+" (correlation "+(r==null?"–":r.toFixed(2))+")"} – ${r==null?"":relWord(r)+", "+relDir(r)}`;
  return `<td style="background:${bg};color:${i!==j&&a>.55?"#fff":"#0f2a43"}" title="${esc(tip)}">${mode==="corr"?v.toFixed(2):relNum(v)}</td>`};
 return `<div class="mx-wrap"><table class="mx"><thead><tr><th></th>${nm.map((c,j)=>`<th class="${j===n-1?"mx-t":""}" title="${esc(j===n-1?c+" ("+UNITS.LOGK+")":UNITS.label(c))}"><span>${esc(c)}</span></th>`).join("")}</tr></thead><tbody>${M.map((row,i)=>`<tr><th class="mx-r ${i===n-1?"mx-t":""}" title="${esc(i===n-1?nm[i]+" ("+UNITS.LOGK+")":UNITS.label(nm[i]))}">${esc(nm[i])}</th>${row.map((v,j)=>cell(v,i,j)).join("")}</tr>`).join("")}</tbody></table></div>`}
function relPairs(st,mode){
 const n=st.names.length,ti=n-1,pairs=[],tgt=[];
 for(let i=0;i<ti;i++){const r=st.corr[i][ti];if(r!=null)tgt.push({a:st.names[i],b:st.target,r,c:st.cov[i][ti]});for(let j=i+1;j<ti;j++){const r2=st.corr[i][j];if(r2!=null)pairs.push({a:st.names[i],b:st.names[j],r:r2,c:st.cov[i][j]})}}
 const top=(L,k)=>L.sort((x,y)=>Math.abs(y.r)-Math.abs(x.r)).slice(0,k);
 const row=p=>`<li><b>${esc(UNITS.label(p.a))}</b> &amp; <b>${esc(UNITS.label(p.b))}</b> <span class="rv2 ${p.r>=0?"pos":"neg"}">${mode==="corr"?(p.r>0?"+":"")+p.r.toFixed(2):relNum(p.c)}</span></li>`;
 return `<div class="relgrid"><div><h4>Descriptors that move most closely together</h4><ul class="rl">${top(pairs,6).map(row).join("")}</ul></div><div><h4>Descriptors most linked to ${esc(st.target)} (${UNITS.LOGK})</h4><ul class="rl">${top(tgt,6).map(row).join("")}</ul></div></div>`}
function relView(st,mode){

 return `  <div class="rlegend"><span><i style="background:rgba(37,99,235,.85)"></i>Positive</span><span><i style="background:rgba(220,38,38,.85)"></i>Negative</span></div>
  ${relPairs(st,mode)}<h4 style="margin:16px 0 4px">Full table</h4>${relMatrix(st,mode)}`}
window.setRel=m=>{const st=S.relSt||S.ds.train.stats;$("#relbox").innerHTML=relView(st,m);["corr","cov"].forEach(k=>$("#rt_"+k).classList.toggle("on",k===m))};
function relCard(t){
 const st=t.stats;S.relSt=st;
 if(!st)return '<div class="card"><h3>Correlation &amp; covariance</h3><div class="note">Re-train to see the correlation and covariance matrices.</div></div>';
 return `<div class="card"><div class="card-h"><div><h3>Correlation &amp; covariance</h3></div><div class="rtabs"><button class="rtab on" id="rt_corr" onclick="setRel('corr')">Correlation</button><button class="rtab" id="rt_cov" onclick="setRel('cov')">Covariance</button></div></div>
  <div id="relbox">${relView(st,"corr")}</div></div>`}

// Model view. User side: 4 stat cards + graphs + "Screen using ..." button. Admin read-only view: also features, model table, correlation & covariance.
function modelView(m){
 const t=S.ds.train;
 const src=t,mm=(t.comparison.find(x=>x.model==="SVR")||t.comparison[0]),feats=src.features,nm=m;
 const stats=`<div class="grid g4">${stat((src.n_train??t.n_train)+" / "+(src.n_test??t.n_test),"Train / test rows (60:40 by composition)")}${stat(feats.length,"Features used (selected)")}${stat(fmt(mm.R2),"Test R²","p")}${stat(fmt(mm.MAE),"Test MAE ("+UNITS.LOGK+")")}</div>`;
 let extra="";
 if(VIEW){
  const fs=t.feature_selection,tot=fs?fs.n_candidates:feats.length;
  const cmpRows=[...t.comparison.filter(x=>x.model==="SVR").map(x=>({...x,key:"SVR",name:"SVR"}))];
  extra=`<div class="card" style="margin-top:16px"><h3>Selected features <span class="pill">${feats.length} of ${tot}</span></h3><div>${feats.map(c=>`<span class="pill">${esc(c)}</span>`).join("")}</div></div>
  <div class="card"><h3>Model comparison</h3><div class="tw"><table><thead><tr><th>Model</th><th>Test R²</th><th>Test R² (avg of repeated splits)</th><th>Test MAE (${UNITS.LOGK})</th><th>Train R²</th><th>Grouped-CV R² (train part)</th><th>Tuning</th><th>Best params</th></tr></thead><tbody>${cmpRows.map(r=>`<tr class="${r.key===m?"hl":""}"><td><b>${esc(r.name)}</b> ${r.key===m?'<span class="badge PASS">selected model</span>':""}</td><td><b>${fmt(r.R2)}</b></td><td>${r.R2_avg!=null?fmt(r.R2_avg)+" ± "+fmt(r.R2_avg_std,2)+' <span class="small">('+r.n_splits+" splits)</span>":"–"}</td><td>${fmt(r.MAE)}</td><td>${fmt(r.train_R2)}</td><td>${fmt(r.cv_R2)} ± ${fmt(r.cv_R2_std,2)}</td><td class="small">${esc(r.search)}</td><td class="small">${esc(JSON.stringify(r.params))}</td></tr>`).join("")}</tbody></table></div>
</div>
  ${relCard(src)}`}
 return `<h2>Model Training</h2>${stats}${extra}
  <div class="gr"><div class="card"><h3>${nm}: predicted vs experimental</h3>${parity(src.parity)}</div>${VIEW?"":`<div class="card gr-act"><button class="btn" onclick="runScreen('${m}')">Screen using ${nm}</button></div>`}</div>`}
P.performance=()=>{if(!S.ds)return $("#main").innerHTML=need();const t=S.ds.train;if(!t)return $("#main").innerHTML='<div class="note">Train the models first (Dataset Analysis page).</div>';
 if(t.n_test==null||t.n_groups==null)return $("#main").innerHTML='<div class="note">Re-train this dataset on the Dataset Analysis page.</div>';
 $("#main").innerHTML=modelView("SVR")};
// ---- Screening Results tab ----

// ---------- Cost filter helpers ----------
const mn2=v=>(+v).toFixed(2).replace("-","−");
const ruleText=(x,s)=>{const L=s.limits||{},B=L.tec!=null;
 if(x.key==="tec")return`predicted TEC ≤ ${L.tec??15} ${UNITS.TEC}`;
 if(x.key==="orr")return`predicted log10(k*) ≥ ${mn2(L.orr??-6.4)} ${UNITS.LOGK}`;
 if(x.key==="ehull")return`${B?"predicted ":""}Ehull ≤ ${L.ehull??57} ${UNITS.EH}`;
 if(x.key==="ad")return"Mahalanobis distance ≤ AD threshold";
 return x.rule||""};
const funnelHtml=s=>{const f=s.funnel;if(!f||!f.length)return"";const top=Math.max(1,f[0].entered);
 return`<div class="card funnel">${f.map((x,i)=>{const w=x.passed?Math.max(1.5,100*x.passed/top):0;
  return`<div class="fn-row"><div class="fn-l"><b>${esc(x.label)}</b><small>${esc(ruleText(x,s))}</small></div><div class="fn-bar"><i style="width:${w.toFixed(1)}%"></i></div><div class="fn-n"><b>${x.passed}</b></div></div>`}).join("")}</div>`};
const costArgs=(res,idx,ci)=>{ci=ci||{};
 if(res==="NOT AVAILABLE"&&idx==null)return["not available","",esc(ci.reason||ci.note||"No price available"),null];
 const mar=ci.rank?`rank ${ci.rank} of ${ci.n_priced}`:"";
 return[`≈ ${usd(idx)}${lvl[res]?" · "+lvl[res]:""}`,"",mar||(res==="NOT AVAILABLE"&&ci.note?esc(ci.note):""),null]};
const costTable=ci=>{if(!ci||!ci.parts||!ci.parts.length)return ci&&ci.missing&&ci.missing.length?`<h3 style="margin-top:16px">Cost breakdown</h3><div class="note">No price for <b>${ci.missing.map(esc).join(", ")}</b>.</div>`:"";
 return`<h3 style="margin-top:16px">Cost breakdown</h3>
  <div class="tw"><table class="cbt"><thead><tr><th>Element</th><th>Stoich.</th><th>Precursor</th><th>Moles needed <small>(mol)</small></th><th>Mass needed <small>(g)</small></th><th>Price <small>(USD/kg)</small></th><th>Cost (USD)</th><th>Share</th></tr></thead><tbody>${ci.parts.map(p=>`<tr><td><b>${esc(p.element)}</b></td><td>${fmt(p.n,3)}</td><td>${esc(p.precursor)}${p.excess_pct?` <small class="muted">(+${p.excess_pct} % excess)</small>`:""}${p.source==="admin"?' <small class="muted">(admin price)</small>':""}</td><td>${fmt(p.mol_precursor,4)}</td><td>${fmt(p.mass_g,4)}</td><td>${fmt(p.norm_price_kg,4)}</td><td>${fmt(p.cost,4)}</td><td>${fmt(p.share*100,1)} %</td></tr>`).join("")}</tbody><tfoot><tr><td colspan="6"><b>Total per mole of cathode</b></td><td colspan="2"><b>$${fmt(ci.cost_per_mol,4)}</b></td></tr><tr><td colspan="6"><b>Estimated cost per kg of cathode</b></td><td colspan="2"><b>${usd(ci.index)}</b></td></tr></tfoot></table></div>`};

// ---------- Best in category (among the PASS cathodes) ----------
const bestHtml=b=>{if(!b)return"";
 const cards=b.categories.map(c=>{
  if(!c.available)return`<div class="bc off"><div class="bc-t">${esc(c.title)}</div><div class="bc-f">—</div></div>`;
  const w=c.winner,tie=c.ties&&c.ties.length;
  const vals=[["Ehull",w.ehull==null?"—":fmt(w.ehull,2)+" meV/atom"],["Est. cost",w.cost==null?"—":usd(w.cost)],["log10(k*)",fmt(w.log_k,2)+" "+UNITS.LOGK]];
  if(c.key==="balanced")vals.push(["Rank-sum",w.rank_sum+" ("+Object.entries(w.ranks).map(([k,v])=>k+" #"+v).join(", ")+")"]);
  return`<div class="bc click" onclick="detail(${w.id})"><div class="bc-t">${esc(c.title)}</div><div class="bc-f">${esc(w.formula)}${tie?` <span class="badge MODERATE" title="${esc(c.ties.join(", "))}">tie +${c.ties.length}</span>`:""}</div>
   <dl class="bc-v">${vals.map(v=>`<dt>${v[0]}</dt><dd>${v[1]}</dd>`).join("")}</dl></div>`}).join("");
 return`<div class="sec-t">Best in category <span class="muted" style="text-transform:none;letter-spacing:0;font-weight:400">· among the ${b.n_pass} PASS cathode${b.n_pass===1?"":"s"}</span></div>
  <div class="grid g4c">${cards}</div>`};

// ---------- Criteria card ----------
// ---------- Rankings list ----------


const isBatch=s=>!!(s&&s.limits&&s.limits.tec!=null);
const costText=v=>lvl[v]||(v==="NOT AVAILABLE"?"—":esc(v||"—"));
const costCell=x=>x.cost!=null?`<b>${usd(x.cost)}</b>${lvl[x.cost_result]?` <small class="muted">· ${lvl[x.cost_result]}</small>`:""}`:costText(x.cost_result);
P.results=async()=>{
  S.filter="all";
  if(!S.ds)return $("#main").innerHTML=need();
  const s=S.ds.summary;
  if(!s)return $("#main").innerHTML='<div class="note">Not screened yet – open <a href="#" onclick="go(\'performance\');return false">Model Training</a>.</div>';
  const B=isBatch(s);
  const opts=B?[["all","All cathodes"],["pass","PASS"],["fail","FAIL"],["incomplete","Not evaluable"],["failed_tec",`Failed TEC (> ${(s.limits||{}).tec??15} ${UNITS.TEC})`],["failed_orr",`Failed log10(k*) (< ${mn2((s.limits||{}).orr??-6.4)} ${UNITS.LOGK})`],["failed_ehull",`Failed Ehull (> ${(s.limits||{}).ehull??57} ${UNITS.EH})`]]:[["all","Results of all cathodes"],["test","Results of test cathodes (40%)"],["train","Results of training cathodes (60%)"]];
  $("#main").innerHTML=`<div class="ph"><div><h2>Screening Results</h2></div>${S.ds.train?`<button class="btn sec sm" onclick="S.model=S.ds.summary.model;go('performance')">Model details</button>`:""}</div>
   <div class="grid g4">${stat(s.total,"Total cathodes")}${stat(s.PASS,"PASS","p")}${stat(s.FAIL,"FAIL","f")}${s.INCOMPLETE?stat(s.INCOMPLETE,"Not evaluable","n"):""}${stat(s.pass_pct+"%","Pass rate")}</div>
   ${!B&&!s.ehull_available?'<div class="note bad">Ehull is <span class="na">not available</span> in this dataset.</div>':""}
   <div class="sec-t">Screening funnel</div>${funnelHtml(s)}
   <div id="best"></div>
   <div class="sec-t">Cathode ranking</div>
   <div class="card flush">
        <div class="tool"><input id="q" placeholder="Search formula…" value="${esc(S.q)}"><select id="rf" style="max-width:360px;margin:0">${opts.map(o=>`<option value="${o[0]}">${o[1]}</option>`).join("")}</select></div>
    <div class="tw"><table><thead>${B?'<tr><th>Rank</th><th>Cathode / Formula</th><th>TEC <small>(×10⁻⁶ K⁻¹)</small></th><th>log10(k*) <small>('+UNITS.LOGK+')</small></th><th>Ehull <small>(meV/atom)</small></th><th>Cost</th><th>Final</th></tr>':'<tr><th>Rank</th><th>Cathode / Formula</th><th>Predicted log10(k*) <small>('+UNITS.LOGK+')</small></th><th>Cost level</th><th>Final</th></tr>'}</thead><tbody id="tb"></tbody></table></div>
    <p class="small muted" id="cnt" style="padding:10px 20px;margin:0"></p>
   </div>
`;
  $("#rf").onchange=e=>{S.filter=e.target.value;loadRes()};
  let tm;$("#q").oninput=e=>{S.q=e.target.value;clearTimeout(tm);tm=setTimeout(loadRes,250)};
  loadRes();loadBest();
  $("#main").insertAdjacentHTML("beforeend",exportCard());
};
async function loadBest(){try{const b=await api(`/datasets/${S.ds.id}/best`);const el=$("#best");if(el)el.innerHTML=bestHtml(b)}catch(e){}}
async function loadRes(){
  const r=await api(`/datasets/${S.ds.id}/results?filter=${S.filter}&q=${encodeURIComponent(S.q)}`),B=isBatch(S.ds.summary);
  document.querySelectorAll(".chip").forEach(c=>c.classList.toggle("on",c.dataset.k===S.filter));
  const bad=(res,v,d)=>`<td class="${res==="FAIL"?"vf":""}">${fmt(v,d)}</td>`;
  $("#tb").innerHTML=r.map(x=>`<tr class="click t-${x.tier}${x.id===S.selId?" sel":""}" data-id="${x.id}" tabindex="0" onclick="detail(${x.id})" onkeydown="if(event.key==='Enter')detail(${x.id})"><td><b>#${x.rank}</b></td><td><a class="flink">${esc(x.formula)}</a></td>${B?`${bad(x.tec_result,x.tec,2)}${bad(x.orr_result,x.predicted_log_kstar,2)}${bad(x.ehull_result,x.ehull,1)}<td>${costCell(x)}</td>`:`<td>${fmt(x.predicted_log_kstar,2)}</td><td>${costCell(x)}</td>`}<td>${badge(x.final_result)}</td></tr>`).join("");
  $("#cnt").textContent=r.length+" cathodes shown";
}

const dhtml=x=>{
 if(x.detail&&x.detail.thresholds&&x.detail.thresholds.tec!=null)return dhtmlB(x);
 const d=x.detail,ci=d.cost||{},t=d.thresholds,f=x.final_result,p=x.orr_value,e=x.ehull,k=x.predicted_kstar,
  orrM=p-t.orr,ehM=e==null?null:t.ehull-e,adR=x.mahalanobis_distance/t.ad,dist=fmt(x.mahalanobis_distance,2),fails=[];
 if(x.ad_result==="FAIL")fails.push("Applicability domain");
 if(x.ehull_result==="FAIL")fails.push("Ehull");
 if(x.orr_result==="FAIL")fails.push("ORR activity");
 const expl=f==="FAIL"?`<div class="expl bad">Failed: ${fails.join(", ")}</div>`:f==="INCOMPLETE"&&d.not_available.length?`<div class="expl">${d.not_available.map(esc).join(" ")}</div>`:"";
 const chk=(ti,res,val,req,margin,pct)=>`<div class="chk ${String(res).replace(/ /g,"")}"><div class="t"><span>${ti}</span>${badge(res)}</div><div class="v">${val}</div>${req?`<div class="r">Requirement: ${req}</div>`:""}${margin?`<div class="r">${margin}</div>`:""}${pct!=null?`<div class="gauge"><i style="width:${Math.min(100,pct)}%;background:${res==="PASS"?"var(--pass)":"var(--fail)"}"></i></div>`:""}</div>`;
 return `<div class="dh"><div><h2>${esc(x.formula)}</h2><div class="sub">Screening result</div></div><div class="verdict ${f}">${f==="INCOMPLETE"?"NOT EVALUABLE":f}</div></div>
 ${expl}
 <h3>Screening values</h3><div class="checks">${chk("Applicability domain",x.ad_result,x.applicability_domain+" · distance "+dist,`distance ≤ ${fmt(t.ad,2)}`,"",Math.min(100,adR*100))}${chk("Ehull (stability)",x.ehull_result,e==null?"—":fmt(e,1)+" meV/atom",`≤ ${t.ehull} meV/atom`,e==null?"Not available in dataset":(ehM>=0?`${fmt(ehM,1)} meV/atom below the limit`:`${fmt(-ehM,1)} meV/atom above the limit`),e==null?null:e/t.ehull*100)}${chk("ORR activity",x.orr_result,"log10(k*) "+fmt(p,2)+" "+UNITS.LOGK,`≥ ${t.orr} ${UNITS.LOGK} (LSC benchmark)`,(orrM>=0?`${fmt(orrM,2)} ${UNITS.LOGK} above the benchmark`:`${fmt(-orrM,2)} ${UNITS.LOGK} below the benchmark`)+` · k* = ${fmt(k)} cm/s`,Math.max(0,Math.min(100,100+orrM*50)))}${chk("Estimated cost (precursors)",x.cost_result,...costArgs(x.cost_result,x.cost,ci))}</div>${costTable(ci)}`};
const SRCL={formula:"calculated from formula",dataset:"from dataset",predicted:"predicted (SVR)",temperature:"from temperature"};
const dhtmlB=x=>{
 const d=x.detail,ci=d.cost||{},t=d.thresholds,f=x.final_result,e=x.ehull,tc=x.tec,p=x.orr_value,k=x.predicted_kstar,fails=[];
 if(x.tec_result==="FAIL")fails.push("TEC");if(x.orr_result==="FAIL")fails.push("log10(k*)");if(x.ehull_result==="FAIL")fails.push("Ehull");
 const expl=f==="FAIL"?`<div class="expl bad">Failed: ${fails.join(", ")}</div>`:f==="INCOMPLETE"&&d.not_available.length?`<div class="expl">${d.not_available.map(esc).join(" ")}</div>`:"";
 const chk=(ti,res,val,req,margin,pct)=>`<div class="chk ${String(res).replace(/ /g,"")}"><div class="t"><span>${ti}</span>${badge(res)}</div><div class="v">${val}</div>${req?`<div class="r">${req}</div>`:""}${margin?`<div class="r">${margin}</div>`:""}${pct!=null?`<div class="gauge"><i style="width:${Math.min(100,pct)}%;background:${res==="PASS"?"var(--pass)":res==="FAIL"?"var(--fail)":"#9fb3c8"}"></i></div>`:""}</div>`;
 const side=(v,lim,u)=>v==null?"":v<=lim?`${fmt(lim-v,2)} ${u} below the limit`:`${fmt(v-lim,2)} ${u} above the limit`;
 const orrM=p==null?null:p-t.orr;
 const feats=d.features||{},src=d.sources||{},nm=Object.fromEntries(DESC_UI.map(r=>[r[0],r[2]]));
 const inputs=Object.keys(feats).length?`<details class="inp"><summary>Model inputs (${Object.keys(feats).length}) &ndash; where each value came from · ${+(+d.temperature_c).toFixed(2)} °C</summary><div class="tw"><table class="cbt"><thead><tr><th>Input</th><th>Value</th><th>Unit</th><th>Source</th></tr></thead><tbody>${Object.keys(feats).map(c=>`<tr><td>${esc(nm[c]||c)} <small class="muted">${esc(c)}</small></td><td>${fmt(feats[c],4)}</td><td>${esc(UNITS.unit(c))}</td><td><span class="src ${esc(src[c]||"")}">${esc(SRCL[src[c]]||"")}</span></td></tr>`).join("")}</tbody></table></div></details>`:"";
 const notes=(d.notes||[]).length?`<div class="small muted" style="margin:10px 0">${d.notes.map(n=>esc(n.t)).join("<br>")}</div>`:"";
 return `<div class="dh"><div><h2>${esc(x.formula)}</h2><div class="sub">Screening result at ${+(+d.temperature_c).toFixed(2)} °C</div></div><div class="verdict ${f}">${f==="INCOMPLETE"?"NOT EVALUABLE":f}</div></div>
 ${expl}
 <h3>Filters <small class="muted" style="text-transform:none;letter-spacing:0">&ndash; these decide PASS / FAIL</small></h3><div class="checks">${chk("Thermal expansion (TEC)",x.tec_result,tc==null?"—":fmt(tc,2)+" ×10<sup>-6</sup> K<sup>-1</sup>",`predicted ≤ ${t.tec} ×10<sup>-6</sup> K<sup>-1</sup>`,side(tc,t.tec,UNITS.TEC),tc==null?null:tc/t.tec*100)}${chk("Activity, log10(k*)",x.orr_result,p==null?"—":"log10(k*) "+fmt(p,2)+" "+UNITS.LOGK,`predicted ≥ ${t.orr} ${UNITS.LOGK} (LSC benchmark)`,p==null?"":(orrM>=0?`${fmt(orrM,2)} ${UNITS.LOGK} above the benchmark`:`${fmt(-orrM,2)} ${UNITS.LOGK} below the benchmark`)+` · k* = ${fmt(k)} cm/s`,p==null?null:Math.max(0,Math.min(100,100+orrM*50)))}${chk("Stability, Ehull",x.ehull_result,e==null?"—":fmt(e,1)+" meV/atom",`predicted ≤ ${t.ehull} meV/atom`,side(e,t.ehull,UNITS.EH),e==null?null:e/t.ehull*100)}</div>
 <h3 style="margin-top:18px">For information <small class="muted" style="text-transform:none;letter-spacing:0">&ndash; do not change PASS / FAIL</small></h3><div class="checks">${chk("Applicability domain","INFO",x.applicability_domain?(x.applicability_domain==="INSIDE"?"Inside":"Outside")+" · distance "+fmt(x.mahalanobis_distance,2):"—",`distance ≤ ${fmt(t.ad,2)}`,"",null)}${chk("Estimated cost (precursors)","",...costArgs(x.cost_result,x.cost,ci))}</div>
 ${notes}${inputs}${costTable(ci)}`};
/* ================= 3D crystal-structure viewer (3Dmol.js) =================
   Click a cathode -> detail modal opens with a pseudo-cubic ABO3 cell built from the formula.
   3Dmol.js is loaded on first use: /3Dmol-min.js (put a local copy next to index.html to work offline), else the 3dmol.org / jsDelivr CDN. */
const V3={lib:null,el:null,viewer:null,tok:0,spin:true,cur:null};
const V3_SRC=["/3Dmol-min.js","https://3Dmol.org/build/3Dmol-min.js","https://cdn.jsdelivr.net/npm/3dmol/build/3Dmol-min.js"];
const V3_CLR={A:["#2f6bff","#6a4cf0","#00a6d6","#5b8def","#8a7bff"],B:["#0f9d94","#22b573","#0b7285","#6fd3a5","#3aa6a0"],O:"#e5484d"};
const V3_RAD={A:.62,B:.42,O:.34};
const V3_A_DEF=new Set("Li Na K Rb Cs Ca Sr Ba La Nd Pm Sm Eu Gd Dy Ho Er Tm Yb Lu Bi Pb".split(" "));   // always A-site
const V3_AMB=new Set("Y Sc Ce Pr Tb".split(" "));                                                       // A or B depending on position

const v3Spin=t=>`<div class="v3-load"><i class="v3-ring"></i><span>${t}</span></div>`;
function v3Load(){
 if(window.$3Dmol)return Promise.resolve();
 if(V3.lib)return V3.lib;
 V3.lib=(async()=>{
  for(const src of V3_SRC){
   try{await new Promise((ok,no)=>{const s=document.createElement("script");s.src=src;s.async=true;s.onload=ok;s.onerror=()=>{s.remove();no()};document.head.appendChild(s)});
       if(window.$3Dmol)return}catch(_){}
  }
  V3.lib=null;throw new Error("3Dmol.js could not be loaded");
 })();
 return V3.lib;
}

/* formula -> {A:[{el,f}],B:[{el,f}],ox}   (f = fraction of that site, each site sums to 1) */
function v3Parse(formula){
 const f=String(formula||"").replace(/[\u2080-\u2089]/g,c=>String(c.charCodeAt(0)-0x2080)).replace(/\s+/g,"").split(/[-±+δ]/)[0];
 if(!/^(?:[A-Z][a-z]?\d*\.?\d*)+$/.test(f))return null;
 const metals=[];let ox=0;
 for(const m of f.matchAll(/([A-Z][a-z]?)(\d*\.?\d*)/g)){
  const n=(m[2]===""||m[2]===".")?1:parseFloat(m[2]);
  if(m[1]==="O")ox+=n;else if(n>0){const e=metals.find(t=>t.el===m[1]);if(e)e.n+=n;else metals.push({el:m[1],n})}
 }
 if(metals.length<2)return null;
 let A=null,B=null;
 // 1) normal ABO3 formulas: the metals written first add up to 1 (A-site), the rest add up to 1 (B-site)
 let s=0;
 for(let i=0;i<metals.length-1;i++){
  s+=metals[i].n;
  if(Math.abs(s-1)<.02){
   const rest=metals.slice(i+1),sr=rest.reduce((a,t)=>a+t.n,0);
   if(Math.abs(sr-1)<.02&&!rest.some(t=>V3_A_DEF.has(t.el))){A=metals.slice(0,i+1);B=rest}
   break;
  }
  if(s>1.02)break;
 }
 // 2) anything else (double perovskites, non-unit totals): classify by element
 if(!A){
  A=[];B=[];let sumA=0,seenB=false;
  for(const t of metals){
   let toA=V3_A_DEF.has(t.el);
   if(!toA&&V3_AMB.has(t.el))toA=!seenB&&sumA+t.n<=1.0001;
   if(toA){A.push(t);sumA+=t.n}else{B.push(t);seenB=true}
  }
 }
 if(!A.length||!B.length)return null;
 const sa=A.reduce((a,t)=>a+t.n,0),sb=B.reduce((a,t)=>a+t.n,0);
 return{A:A.map(t=>({el:t.el,f:t.n/sa})),B:B.map(t=>({el:t.el,f:t.n/sb})),ox:ox?ox/sb:3};
}
/* largest-remainder allocation of N sites between the elements of one site (every element gets >=1 site) */
function v3Alloc(items,N){
 const raw=items.map(t=>t.f*N),cnt=raw.map(Math.floor);
 let left=N-cnt.reduce((a,b)=>a+b,0);
 items.map((_,i)=>i).sort((i,j)=>(raw[j]-cnt[j])-(raw[i]-cnt[i])).slice(0,left).forEach(i=>cnt[i]++);
 cnt.forEach((c,i)=>{if(c===0){const m=cnt.indexOf(Math.max(...cnt));cnt[m]--;cnt[i]=1}});
 const out=[];cnt.forEach((c,i)=>{for(let k=0;k<c;k++)out.push(items[i].el)});
 return{out,cnt};
}
function v3Hash(s){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}return h>>>0}
function v3Rng(seed){let a=seed>>>0;return()=>{a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
function v3Shuffle(a,r){for(let i=a.length-1;i>0;i--){const j=Math.floor(r()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}
/* smallest cubic supercell (1,2,3 cells per edge) whose site counts reproduce the formula fractions within 3 % */
function v3PickN(p){
 let best=1,bestE=9;
 for(const n of [1,2,3]){
  const N=n*n*n,e=Math.max(...[p.A,p.B].map(it=>{const{cnt}=v3Alloc(it,N);return Math.max(...cnt.map((c,i)=>Math.abs(c/N-it[i].f)))}));
  if(e<=.03)return n;
  if(e<bestE){bestE=e;best=n}
 }
 return best;
}
/* pseudo-cubic perovskite supercell as an .xyz string: A at cell corners, B at cell centres, O at edge midpoints of the B sub-lattice (octahedra complete) */
function v3Build(p,formula){
 const a=3.9,n=v3PickN(p),N=n*n*n,r=v3Rng(v3Hash(formula));
 const aa=v3Alloc(p.A,N),bb=v3Alloc(p.B,N);
 const sA=v3Shuffle(aa.out.slice(),r),sB=v3Shuffle(bb.out.slice(),r);
 const idx=(i,j,k)=>((i%n)*n+(j%n))*n+(k%n),atoms=[];
 const put=(el,role,x,y,z)=>atoms.push({el,role,x:x*a,y:y*a,z:z*a});
 for(let i=0;i<=n;i++)for(let j=0;j<=n;j++)for(let k=0;k<=n;k++)put(sA[idx(i,j,k)],"A",i,j,k);          // boundary A atoms are periodic images, so octahedra/cube edges look complete
 for(let i=0;i<n;i++)for(let j=0;j<n;j++)for(let k=0;k<n;k++)put(sB[idx(i,j,k)],"B",i+.5,j+.5,k+.5);
 for(let i=0;i<n;i++)for(let j=0;j<n;j++)for(let k=0;k<=n;k++)put("O","O",i+.5,j+.5,k);
 for(let i=0;i<n;i++)for(let k=0;k<n;k++)for(let j=0;j<=n;j++)put("O","O",i+.5,j,k+.5);
 for(let j=0;j<n;j++)for(let k=0;k<n;k++)for(let i=0;i<=n;i++)put("O","O",i,j+.5,k+.5);
 const xyz=atoms.length+"\n"+formula+" - pseudo-cubic ABO3, "+n+"x"+n+"x"+n+" supercell, a = "+a+" A (schematic)\n"+atoms.map(t=>t.el+" "+t.x.toFixed(4)+" "+t.y.toFixed(4)+" "+t.z.toFixed(4)).join("\n");
 return{xyz,atoms,n,a,N,cntA:aa.cnt,cntB:bb.cnt};
}
function v3Colors(p){const c={};p.A.forEach((t,i)=>c[t.el]=V3_CLR.A[i%V3_CLR.A.length]);p.B.forEach((t,i)=>c[t.el]=V3_CLR.B[i%V3_CLR.B.length]);c.O=V3_CLR.O;return c}

/* left-hand panel: viewer slot, buttons, legend, key properties */
function v3Panel(x){
 const p=v3Parse(x.formula),o=(x.detail&&x.detail.original)||{};
 const pick=re=>{const k=Object.keys(o).find(k=>re.test(k.replace(/[^a-z]/gi,"")));const v=k==null?NaN:parseFloat(o[k]);return Number.isFinite(v)?v:null};
 const logk=x.orr_value!=null?x.orr_value:x.predicted_log_kstar;
 const rows=[["Rank","#"+(x.rank??"—")],["Predicted log10(k*)",fmt(logk,2)+" "+UNITS.LOGK],["Predicted k*",fmt(x.predicted_kstar)+" cm/s"],["Ehull",x.ehull==null?"—":fmt(x.ehull,1)+" meV/atom"],["Est. precursor cost",usd(x.cost)+(lvl[x.cost_result]?" · "+lvl[x.cost_result]:"")]];
 [["TEC",/^tec$/i,UNITS.TEC],["O p-band center",/^opband/i,"eV"],["Band gap",/^(gap|bandgap)$/i,"eV"],["Work function",/^workfunction$/i,"eV"],["O-vacancy energy",/^(oxidevacancy|ovacancy)/i,"eV"]].forEach(([n,re,u])=>{const v=pick(re);if(v!=null)rows.push([n,fmt(v,3)+" "+u])});
 rows.push(["Final result",badge(x.final_result)]);
 let leg="",note="";
 if(p){
  const col=v3Colors(p),st=v3Build(p,x.formula);
  const li=(el,role,sub)=>`<div class="v3-li"><i style="background:${col[el]}"></i><b>${esc(el)}</b><span>${role}</span><em>${sub}</em></div>`;
  leg=p.A.map(t=>li(t.el,"A-site",Math.round(t.f*100)+"%")).join("")+p.B.map(t=>li(t.el,"B-site",Math.round(t.f*100)+"%")).join("")+li("O","Oxygen",(Math.abs(p.ox-3)<.05?"3":fmt(p.ox,2))+" per ABO₃");
  note=`${st.n}×${st.n}×${st.n} pseudo-cubic supercell (a = ${st.a} Å, ${st.N} A / ${st.N} B / ${3*st.N} O sites). Mixed sites are filled in proportion to the formula; the layout is illustrative, not a relaxed structure.`+(Math.abs(p.ox-3)>.05?` The formula has O${fmt(p.ox,2)} per ABO₃; the cell is drawn fully oxygenated.`:"");
 }else leg='<div class="v3-li"><span>Could not read the formula as ABO₃.</span></div>';
 return`<div class="v3"><div class="v3-h">Crystal structure<small>Pseudo-cubic ABO₃ unit cell · drag to rotate, scroll to zoom</small></div>
  <div class="v3-slot" id="v3slot"><div class="v3-msg">${v3Spin("Loading 3D viewer…")}</div></div>
  <div class="v3-bar"><button class="btn sec sm" id="v3spin">Pause</button><button class="btn sec sm" id="v3reset">Reset view</button><button class="btn sec sm" id="v3dl">Download .xyz</button></div>
  <div class="v3-leg">${leg}</div>${note?`<p class="v3-note">${note}</p>`:""}
  <table class="v3-props">${rows.map(r=>`<tr><td>${r[0]}</td><td>${r[1]}</td></tr>`).join("")}</table></div>`;
}

/* ---- built-in 3D renderer (Canvas 2D): used whenever 3Dmol.js or WebGL is unavailable, so every structure still draws ---- */
function v3Shade(hex,k){const n=parseInt(hex.slice(1),16),f=c=>Math.max(0,Math.min(255,Math.round(k>=0?c+(255-c)*k:c*(1+k))));return`rgb(${f(n>>16&255)},${f(n>>8&255)},${f(n&255)})`}
function v3Fallback(slot,st,col){
 slot.innerHTML="";
 const cv=document.createElement("canvas");cv.style.cssText="position:absolute;inset:0;width:100%;height:100%;display:block;cursor:grab;touch-action:none";slot.appendChild(cv);
 const ctx=cv.getContext("2d");if(!ctx)throw new Error("canvas unsupported");
 const L=st.n*st.a,c=L/2,A=st.atoms.map(t=>({el:t.el,r:t.role,x:t.x-c,y:t.y-c,z:t.z-c}));
 const bonds=[];A.forEach((b,i)=>{if(b.r!=="B")return;A.forEach((o,j)=>{if(o.r==="O"&&Math.hypot(b.x-o.x,b.y-o.y,b.z-o.z)<st.a/2+.1)bonds.push([i,j])})});
 const cs=[-c,c],corners=[];cs.forEach(x=>cs.forEach(y=>cs.forEach(z=>corners.push([x,y,z]))));
 const edges=[];corners.forEach((p,i)=>corners.forEach((q,j)=>{if(i<j&&(p[0]!==q[0])+(p[1]!==q[1])+(p[2]!==q[2])===1)edges.push([p,q])}));
 const RAD={A:V3_RAD.A,B:V3_RAD.B,O:V3_RAD.O};
 const S={ry:.7,rx:-.4,zoom:1,spin:!(window.matchMedia&&matchMedia("(prefers-reduced-motion: reduce)").matches),drag:false,lx:0,ly:0,w:0,h:0};
 const proj=(x,y,z,sc)=>{const cy=Math.cos(S.ry),sy=Math.sin(S.ry),cx=Math.cos(S.rx),sx=Math.sin(S.rx);
  const x1=x*cy+z*sy,z1=-x*sy+z*cy,y2=y*cx-z1*sx,z2=y*sx+z1*cx,k=(L*3)/(L*3-z2);
  return{X:S.w/2+x1*sc*k,Y:S.h/2-y2*sc*k,Z:z2,k}};
 function draw(){
  const w=slot.clientWidth,h=slot.clientHeight,d=window.devicePixelRatio||1;if(!w||!h)return;
  if(S.w!==w||S.h!==h){S.w=w;S.h=h;cv.width=Math.round(w*d);cv.height=Math.round(h*d)}
  ctx.setTransform(d,0,0,d,0,0);ctx.clearRect(0,0,w,h);ctx.fillStyle="#f3f8fe";ctx.fillRect(0,0,w,h);
  const sc=Math.min(w,h)/(L*1.75)*S.zoom,items=[];
  edges.forEach(([p,q])=>{const a=proj(p[0],p[1],p[2],sc),b=proj(q[0],q[1],q[2],sc);items.push({z:(a.Z+b.Z)/2-1e3,line:[a,b],w:1,c:"#9db2c8"})});
  bonds.forEach(([i,j])=>{const a=proj(A[i].x,A[i].y,A[i].z,sc),b=proj(A[j].x,A[j].y,A[j].z,sc);items.push({z:(a.Z+b.Z)/2-.01,line:[a,b],w:Math.max(1.5,.09*2*sc*a.k),c:"#7f93aa"})});
  A.forEach(t=>{const q=proj(t.x,t.y,t.z,sc);items.push({z:q.Z,at:t,q,r:RAD[t.r]*sc*q.k*1.05})});
  items.sort((u,v)=>u.z-v.z);
  items.forEach(it=>{
   if(it.line){ctx.beginPath();ctx.moveTo(it.line[0].X,it.line[0].Y);ctx.lineTo(it.line[1].X,it.line[1].Y);ctx.strokeStyle=it.c;ctx.lineWidth=it.w;ctx.lineCap="round";ctx.stroke();return}
   const{X,Y}=it.q,r=it.r,base=col[it.at.el]||"#888",g=ctx.createRadialGradient(X-r*.35,Y-r*.35,r*.1,X,Y,r);
   g.addColorStop(0,v3Shade(base,.55));g.addColorStop(.55,base);g.addColorStop(1,v3Shade(base,-.35));
   ctx.beginPath();ctx.arc(X,Y,r,0,6.2832);ctx.fillStyle=g;ctx.fill()});
 }
 let raf=0,last=0;
 const tick=t=>{if(!cv.isConnected){cancelAnimationFrame(raf);return}
  if(S.spin&&!S.drag){S.ry+=(t-last)*.0004*1.0}last=t;draw();raf=requestAnimationFrame(tick)};
 raf=requestAnimationFrame(t=>{last=t;tick(t)});
 cv.addEventListener("pointerdown",e=>{S.drag=true;S.lx=e.clientX;S.ly=e.clientY;cv.style.cursor="grabbing";try{cv.setPointerCapture(e.pointerId)}catch(_){}});
 cv.addEventListener("pointermove",e=>{if(!S.drag)return;S.ry+=(e.clientX-S.lx)*.01;S.rx=Math.max(-1.5,Math.min(1.5,S.rx+(e.clientY-S.ly)*.01));S.lx=e.clientX;S.ly=e.clientY});
 const up=()=>{S.drag=false;cv.style.cursor="grab"};cv.addEventListener("pointerup",up);cv.addEventListener("pointercancel",up);
 cv.addEventListener("wheel",e=>{e.preventDefault();S.zoom=Math.max(.4,Math.min(3,S.zoom*(e.deltaY<0?1.1:.9)))},{passive:false});
 return{spin(on){S.spin=on},reset(){S.ry=.7;S.rx=-.4;S.zoom=1},get on(){return S.spin}};
}
async function v3Mount(x){
 const slot=document.getElementById("v3slot");if(!slot)return;
 const tok=++V3.tok,msg=t=>{if(tok===V3.tok&&document.getElementById("v3slot")===slot)slot.innerHTML=`<div class="v3-msg">${t}</div>`};
 const p=v3Parse(x.formula);
 if(!p)return msg("A 3D cell could not be built for this formula.");
 const st=v3Build(p,x.formula),col=v3Colors(p),role={};
 p.A.forEach(t=>role[t.el]="A-site");p.B.forEach(t=>role[t.el]="B-site");role.O="Oxygen";
 V3.cur={xyz:st.xyz,name:x.formula};
 const dl=document.getElementById("v3dl");
 if(dl)dl.onclick=()=>{const u=URL.createObjectURL(new Blob([st.xyz],{type:"chemical/x-xyz"})),a=document.createElement("a");a.href=u;a.download=x.formula.replace(/[^\w.-]/g,"_")+".xyz";document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),1000)};
 const wire=ctl=>{const sp=document.getElementById("v3spin"),rs=document.getElementById("v3reset");
  if(sp){sp.textContent=ctl.on?"Pause":"Spin";sp.onclick=()=>{ctl.spin(!ctl.on);sp.textContent=ctl.on?"Pause":"Spin"}}
  if(rs)rs.onclick=()=>ctl.reset()};
 const fb=()=>{if(tok!==V3.tok||document.getElementById("v3slot")!==slot)return;
  try{wire(v3Fallback(slot,st,col))}catch(e){console.error(e);msg("This structure could not be drawn here. You can still download the .xyz file.")}};
 let libOk=true;try{await v3Load()}catch(e){libOk=false}
 if(!libOk)return fb();
 if(tok!==V3.tok||document.getElementById("v3slot")!==slot)return;
 try{
  try{if(V3.viewer){V3.viewer.spin(false);V3.viewer.clear()}}catch(_){}
  V3.el=document.createElement("div");V3.el.id="v3d";V3.viewer=null;
  slot.innerHTML="";slot.appendChild(V3.el);
  V3.viewer=$3Dmol.createViewer(V3.el,{backgroundColor:"#f3f8fe",antialias:true});
  const v=V3.viewer;
  v.spin(false);v.clear();v.resize();
  v.addModel(st.xyz,"xyz");
  Object.keys(col).forEach(el=>v.setStyle({elem:el},{sphere:{radius:V3_RAD[el==="O"?"O":role[el]==="A-site"?"A":"B"],color:col[el]}}));
  const L=st.n*st.a,bond=(s,e,r,c)=>v.addCylinder({start:{x:s[0],y:s[1],z:s[2]},end:{x:e[0],y:e[1],z:e[2]},radius:r,color:c,fromCap:true,toCap:true});
  const Bs=st.atoms.filter(t=>t.role==="B"),Os=st.atoms.filter(t=>t.role==="O");
  Bs.forEach(b=>Os.forEach(o=>{if(Math.hypot(b.x-o.x,b.y-o.y,b.z-o.z)<st.a/2+.1)bond([b.x,b.y,b.z],[o.x,o.y,o.z],.09,"#7f93aa")}));   // B-O octahedra
  [[0,0],[L,0],[0,L],[L,L]].forEach(([u,w])=>{bond([u,w,0],[u,w,L],.03,"#9db2c8");bond([u,0,w],[u,L,w],.03,"#9db2c8");bond([0,u,w],[L,u,w],.03,"#9db2c8")});   // cell edges
  try{v.setHoverable({},true,(at,vw)=>{if(!at.label)at.label=vw.addLabel(at.elem+" · "+(role[at.elem]||""),{position:at,backgroundColor:"#0f2a43",backgroundOpacity:.88,fontColor:"white",fontSize:12,borderThickness:0})},(at,vw)=>{if(at.label){vw.removeLabel(at.label);delete at.label}})}catch(_){}
  v.zoomTo();v.render();
  const reduce=window.matchMedia&&matchMedia("(prefers-reduced-motion: reduce)").matches;
  V3.spin=!reduce;const sp=document.getElementById("v3spin");
  if(V3.spin)v.spin("y",.6);if(sp)sp.textContent=V3.spin?"Pause":"Spin";
  if(sp)sp.onclick=()=>{V3.spin=!V3.spin;if(V3.spin)v.spin("y",.6);else v.spin(false);sp.textContent=V3.spin?"Pause":"Spin"};
  const rs=document.getElementById("v3reset");if(rs)rs.onclick=()=>{v.zoomTo();v.render()};
 }catch(e){console.error(e);V3.viewer=null;fb()}
}
function closeModal(){
 $("#modal").classList.add("hidden");$(".mbox").classList.remove("wide");
 try{if(V3.viewer)V3.viewer.spin(false)}catch(_){}
 const live=document.getElementById("v3slot-live");   // bring back the live result's 3D view after a past prediction was viewed
 if(live){live.id="v3slot";$("#mbody").innerHTML="";if(window._liveF)v3Mount({formula:window._liveF})}
}
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!$("#modal").classList.contains("hidden"))closeModal()});
$("#modal").addEventListener("mousedown",e=>{if(e.target===$("#modal"))closeModal()});
function markSel(){document.querySelectorAll("#tb tr").forEach(r=>r.classList.toggle("sel",+r.dataset.id===S.selId))}
window.detail=async id=>{
 S.selId=id;markSel();                                              // 1) highlight the selected cathode row
 v3Load().catch(()=>{});                                            // start fetching the 3D library right away
 const x=await api(`/datasets/${S.ds.id}/results/${id}`);S.sel=x;
 const batch=x.detail&&x.detail.thresholds&&x.detail.thresholds.tec!=null;
 if(batch){                                                         // 2) same card as the Predict Single Cathode page
  const d=x.detail,o={formula:x.formula,final:x.final_result,pred_log:x.orr_value!=null?x.orr_value:x.predicted_log_kstar,pred_k:x.predicted_kstar,
   orr_result:x.orr_result,ehull:x.ehull,ehull_result:x.ehull_result,tec:x.tec,tec_result:x.tec_result,cost:x.cost,cost_result:x.cost_result,cost_info:d.cost||{},
   ad:x.applicability_domain,dist:x.mahalanobis_distance,ad_result:x.ad_result,thresholds:d.thresholds,not_available:d.not_available||[],full:true};
  const t=d.temperature_c!=null?+(+d.temperature_c).toFixed(2):null;
  $("#mbody").innerHTML=`<div class="rsmod"><div class="rsmod-bar"><span class="rsmod-rank">Rank <b>#${x.rank??"—"}</b></span>${t!=null?`<span class="rsmod-temp">Screened at <b>${t} °C</b></span>`:""}</div>${predHtml(o)}${screenInputs(d)}</div>`;
  $(".mbox").classList.remove("wide");
 }else{                                                             // older train-on-upload results keep the previous layout
  $("#mbody").innerHTML=`<div class="dmod">${v3Panel(x)}<div class="dmain">${dhtml(x)}</div></div>`;
  $(".mbox").classList.add("wide");
 }
 $("#modal").classList.remove("hidden");
 v3Mount(x);                                                        // 3) build .xyz from the formula and render with 3Dmol.js
};
// collapsible "where did each model input come from" table (shown under the Predict-style card)
const screenInputs=d=>{
 const feats=d.features||{},src=d.sources||{},nm=Object.fromEntries(DESC_UI.map(r=>[r[0],r[2]])),n=Object.keys(feats).length;
 const notes=(d.notes||[]).length?`<div class="small muted" style="margin:10px 0">${d.notes.map(n=>esc(n.t)).join("<br>")}</div>`:"";
 if(!n)return notes;
 return`${notes}<details class="inp"><summary>Model inputs (${n}) &ndash; where each value came from · ${+(+d.temperature_c).toFixed(2)} °C</summary><div class="tw"><table class="cbt"><thead><tr><th>Input</th><th>Value</th><th>Unit</th><th>Source</th></tr></thead><tbody>${Object.keys(feats).map(c=>`<tr><td>${esc(nm[c]||c)} <small class="muted">${esc(c)}</small></td><td>${fmt(feats[c],4)}</td><td>${esc(UNITS.unit(c))}</td><td><span class="src ${esc(src[c]||"")}">${esc(SRCL[src[c]]||"")}</span></td></tr>`).join("")}</tbody></table></div></details>`};
// ---------- Predict a single cathode: result panel (matches the LaCoO3 dashboard mock-up) ----------
const RI=p=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const RIC={
 trend:RI('<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>'),
 shield:RI('<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>'),
 therm:RI('<path d="M14 14.8V5a2 2 0 0 0-4 0v9.8a4 4 0 1 0 4 0z"/>'),
 coins:RI('<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6"/><path d="M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"/>'),
 cube:RI('<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/>'),
 bars:RI('<path d="M5 20v-6M12 20V5M19 20v-9"/>'),
 x:RI('<path d="M6 6l12 12M18 6L6 18"/>'),
 ok:RI('<path d="M5 12.5l4.5 4.5L19 7"/>'),
 info:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="currentColor"/><path d="M12 11v6" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="7.3" r="1.3" fill="#fff"/></svg>'};
const subF=s=>esc(s).replace(/(\d+(?:\.\d+)?)/g,"<sub>$1</sub>");
const rsPill=r=>r==="PASS"?`<span class="rs-st PASS">${RIC.ok}PASS</span>`:r==="FAIL"?`<span class="rs-st FAIL">${RIC.x}FAIL</span>`:r==="INCOMPLETE"||r==="NOT AVAILABLE"?`<span class="rs-st NA">N/A</span>`:"";
const rsMetric=(ico,name,res,val,req)=>`<div class="rs-m ${res}"><div class="rs-ic">${RIC[ico]}</div><div class="rs-mt"><b>${name}</b><small>${req}</small></div><div class="rs-mv">${val}</div>${rsPill(res)}</div>`;
const rsInfo=(ico,name,sub,val,note)=>`<div class="rs-i"><span class="rs-ii">${RIC.info}</span><div class="rs-ic round">${RIC[ico]}</div><div class="rs-mt"><b>${name}</b><small>${sub}</small></div><div class="rs-iv">${val}${note?`<small>• ${note}</small>`:""}</div></div>`;
const predCostTable=ci=>{
 if(!ci||!ci.parts||!ci.parts.length)return ci&&ci.missing&&ci.missing.length?`<div class="rs-box"><div class="rs-sec"><span>${RIC.bars}</span>Cost breakdown</div><div class="note">No price for <b>${ci.missing.map(esc).join(", ")}</b>.</div></div>`:"";
 return`<div class="rs-box"><div class="rs-sec"><span>${RIC.bars}</span>Cost breakdown</div>
 <div class="rs-tw"><table class="rs-cost"><thead><tr><th>Element</th><th>Precursor</th><th>Mass <small>(g)</small></th><th>Price <small>(USD/kg)</small></th><th>Cost (USD)</th><th>Share</th></tr></thead><tbody>${ci.parts.map(p=>`<tr><td>${esc(p.element)}</td><td>${esc(p.precursor)}${p.excess_pct?` <small>(+${p.excess_pct}%)</small>`:""}</td><td>${fmt(p.mass_g,3)}</td><td>${fmt(p.norm_price_kg,2)}</td><td>${fmt(p.cost,3)}</td><td>${fmt(p.share*100,1)}%</td></tr>`).join("")}</tbody><tfoot><tr><td colspan="4">Total per mole of cathode</td><td colspan="2">$${fmt(ci.cost_per_mol,3)}</td></tr><tr><td colspan="4">Estimated cost per kg of cathode</td><td colspan="2">${usd(ci.index)}</td></tr></tfoot></table></div></div>`};
const predSummary=o=>{
 const t=o.thresholds,f=o.final,fails=[];
 if(o.orr_result==="FAIL")fails.push(`log10(K*) is below ${+t.orr} ${UNITS.LOGK}`);
 if(o.ehull_result==="FAIL")fails.push(`Ehull is above ${t.ehull} meV/atom`);
 if(o.tec_result==="FAIL")fails.push(`TEC is above ${t.tec} ×10⁻⁶ K⁻¹`);
 if(o.ad_result==="FAIL"&&!o.full)fails.push("it lies outside the applicability domain");
 if(f==="PASS")return`${esc(o.formula)} meets the log10(K*), Ehull and TEC criteria.`;
 if(f==="FAIL")return`${esc(o.formula)} does not qualify because ${fails.join(" and ")}.`;
 return(o.not_available||[]).length?o.not_available.map(esc).join(" "):`${esc(o.formula)} could not be fully evaluated.`};
const predHtml=o=>{
 const t=o.thresholds,f=o.final,e=o.ehull,na=o.cost==null;
 return`<div class="card pres rs"><div class="rs-head"><div class="rs-id"><div class="rs-name">${subF(o.formula)}</div><span class="rs-big ${f}">${f==="PASS"?RIC.ok:f==="FAIL"?RIC.x:""}${f==="INCOMPLETE"?"NOT EVALUABLE":f}</span><p class="rs-subt">Cathode prediction results based on ML model</p></div><div class="rs-3d" id="v3slot" title="Drag to rotate"><div class="v3-msg">${v3Spin("Loading 3D…")}</div></div></div>
 ${o.dataset_match?`<div class="desc-note">Values reproduced from the SCOPE dataset (${esc(o.dataset_match.formula)} at ${fmt(o.dataset_match.temperature_c,1)} °C).</div>`:""}
 <div class="rs-list">${rsMetric("trend","log10(K*)",o.orr_result,fmt(o.pred_log,2)+" "+UNITS.LOGK,`predicted ≥ ${+t.orr} ${UNITS.LOGK} (LSC benchmark)`)}${rsMetric("shield","EHull (stability)",o.ehull_result,e==null?"not entered":fmt(e,1)+" meV/atom",`predicted ≤ ${t.ehull} meV/atom`)}${o.tec!=null?rsMetric("therm","Thermal expansion (TEC)",o.tec_result,fmt(o.tec,2)+" ×10<sup>-6</sup> K<sup>-1</sup>",`predicted ≤ ${t.tec} ×10<sup>-6</sup> K<sup>-1</sup>`):""}</div>
 <div class="rs-two">${rsInfo("coins","Estimated Cost","precursor cost",na?"not available":usd(o.cost),!na?(lvl[o.cost_result]||"level needs a screening"):((o.cost_info&&o.cost_info.reason)||""))}${rsInfo("cube","Applicability Domain",`distance ≤ ${fmt(t.ad,2)}`,o.ad==="INSIDE"?"Inside":"Outside","distance "+fmt(o.dist,2))}</div>
 ${predCostTable(o.cost_info)}
 <div class="rs-sum ${f}"><span>${RIC.info}</span>${predSummary(o)}</div></div>`};

P.predictHistory=async()=>{   // admin read-only view of a user: that user's past single-cathode predictions (all datasets / built-in models)
 const pm=$("#pmount");if(!pm)return;pm.innerHTML='<p class="muted">Loading…</p>';
 try{const list=await api("/my-predictions");window._pp=list;
  pm.innerHTML=`<div class="card flush"><div class="tw"><table><thead><tr><th>Cathode</th><th>Result</th><th>Model</th><th>Time</th><th></th></tr></thead><tbody>${list.map((p,i)=>`<tr><td><b>${esc(p.formula)}</b></td><td>${badge(p.result.final)}</td><td>${esc(p.model)}${p.dataset?` <span class="muted small">· ${esc(p.dataset)}</span>`:""}</td><td class="muted small">${esc(p.ago)}</td><td><button type="button" class="btn sm" onclick="ppDetail(${i})">View</button></td></tr>`).join("")||'<tr><td colspan="5" class="muted" style="padding:18px">This user has not made any single-cathode predictions yet.</td></tr>'}</tbody></table></div></div>`}
 catch(e){pm.innerHTML=`<div class="note bad">${esc(e.message)}</div>`}};
const DESC_UI=[
["Ion_A","IE_A","Valence electron ionization energy of A-site"],
["Ion_B","IE_B","Valence electron ionization energy of B-site"],
["EN_A","EN_A","Electronegativity of A-site"],
["EN_B","EN_B","Electronegativity of B-site"],
["R_A","R_A","Shannon ionic radius of A-site"],
["R_B","R_B","Shannon ionic radius of B-site"],
["Sa_A","Sa_A","Ionic Lewis acidity of A-site"],
["Sa_B","Sa_B","Ionic Lewis acidity of B-site"],
["Delec_B","N_d(B)","Number of d-electrons in B-site"],
["t","t","Goldschmidt tolerance factor"],
["Ionic_A","Ionic_A","Ionicity index of A-site"],
["Ionic_B","Ionic_B","Ionicity index of B-site"],
["Avg_Ionic_Character","Avg_IC","Average ionic character"],
["SmithAcid_A","SA_A","Smith Acidity of A-site"],
["SmithAcid_B","SA_B","Smith Acidity of B-site"],
["Work_Function","WF","Work function"],
["O_pband","O-p","O-p band center radius"],
["Log_dieletric","log ε","log dielectric constant"],
["Oxide_vacancy","E_vac","Oxygen vacancy formation energy"],
["Gap","Eg","Band gap"],
["_x1","σ_ion","Bulk ionic conductivity"],
["_x2","σ_total","Total electronic conductivity"],
["_x4","ASR","Area-specific resistance (ASR)"]];
const unitSpan=k=>{const u=UNITS.unit(k);return u?` <span class="fl-u">(${esc(u)})</span>`:""};
const descField=(st,cur,sec)=>([k,sn,full])=>{const s=st[k]||{};const live=cur().features.includes(k);return `<label class="fld"><span class="fl-k">${esc(sn)}</span><span class="fl-l">${esc(full)}${unitSpan(k)}</span><input type="number" step="any" ${live?`data-f="${esc(k)}"`:`data-x="${esc(sn)}"`}${sec?` data-sec="${sec}"`:""} placeholder="${s.median!=null&&sec?"e.g. "+fmt(s.median,3):"value"}"></label>`};
/* Predict button gate: enabled only after after "Predict using SVR" or "Fill with typical values"
   were pressed for the CURRENT formula / doping / temperature, and every model input is filled. Any change to formula, doping or temperature resets it. */
const PG={sig:null,desc:null,other:null,timer:null};
const pgSig=()=>JSON.stringify([$("#pf_name")?.value.trim(),$("#pf_t")?.value.trim(),[...document.querySelectorAll("#fx input,#fx select")].map(i=>i.value)]);
window.pgMark=k=>{PG[k]=pgSig();pgUpdate()};
function pgUpdate(){
 const b=$("#pbtn");if(!b)return;
 const sig=pgSig(),miss=[];
 if(!$("#pf_name").value.trim())miss.push("enter the cathode formula");
 const tv=$("#pf_t").value.trim();if(tv===""||!isFinite(+tv)||+tv+273.15<=0)miss.push("enter the temperature");
 if(PG.other!==sig)miss.push("press <b>Predict using SVR</b> or <b>Fill with typical values</b>");
 const empty=[...document.querySelectorAll("#pf_grid [data-f],#pf_grid2 [data-f]")].filter(i=>i.value.trim()==="").length;
 if(empty&&PG.other===sig)miss.push(`fill the ${empty} empty descriptor field${empty>1?"s":""}`);
 const ok=!miss.length;b.disabled=!ok;b.title=ok?"":"First: "+miss.join(", ").replace(/<\/?b>/g,"");
 const h=$("#predhint");if(h)h.innerHTML=ok?"":`To enable Predict: ${miss.join(" · ")}.`}
function pgInit(){
 PG.desc=PG.other=null;clearInterval(PG.timer);
 const root=$("#pgrid");if(!root)return;
 ["input","change","click"].forEach(ev=>root.addEventListener(ev,()=>setTimeout(pgUpdate,0)));
 PG.auto=null;PG.timer=setInterval(()=>{if(!$("#pbtn")){clearInterval(PG.timer);return}autoDesc();autoKnown();pgUpdate()},250);
 pgUpdate()}
/* descriptors fill automatically (and keep updating) as the cathode formula / doping rows change; values stay editable by hand
   until the cathode itself changes again. */
window.autoDesc=()=>{
 const note=$("#calcnote");if(!note||!window.FX||!FX.composition)return;
 const c=FX.composition(),ok=!!(c&&c.A.length&&c.B.length),key=ok?JSON.stringify([c.A,c.B]):"";
 if(key===PG.auto)return;PG.auto=key;
 const inputs=document.querySelectorAll("#pf_grid [data-f]");
 if(!ok){inputs.forEach(i=>{i.value="";i.classList.remove("calc")});note.className="desc-note";note.textContent="";return}
 const r=DESC_CALC.compute(c),n=Object.keys(r.values).length;
 inputs.forEach(i=>{const v=r.values[i.dataset.f];if(v!==undefined){i.value=v;i.classList.add("calc");i.oninput=()=>i.classList.remove("calc")}else{i.value="";i.classList.remove("calc")}});
 const miss=[...new Set([...r.unknownA,...r.unknownB])];
 note.className="desc-note"+(miss.length?" warn":"");
 note.textContent=(!n?"Nothing could be calculated.":"")+(miss.length?`No built-in data for ${miss.join(", ")} yet – type those fields in manually.`:"")};
/* A cathode that is in the training dataset AT THIS TEMPERATURE: its own descriptors + 5 properties are loaded and the dataset's recorded values are
   reproduced on Predict (server side). No match (other formula or other temperature) -> everything works as before. */
window.autoKnown=async()=>{
 const note=$("#calcnote");if(!note||!window.FX||!FX.composition)return;
 const c=FX.composition(),tv=$("#pf_t")?.value.trim(),ok=!!(c&&c.A.length&&c.B.length)&&tv!==""&&isFinite(+tv),key=ok?JSON.stringify([c.A,c.B,+tv]):"";
 if(key===PG.kkey)return;PG.kkey=key;
 const was=PG.known;
 let j=null;if(ok){try{j=await api("/known",{json:{composition:c,temperature_c:+tv}})}catch(e){j=null}}
 if(PG.kkey!==key)return;                                  /* the inputs changed while waiting */
 if(j&&j.found){
  Object.entries(j.values).forEach(([k,v])=>{const i=document.querySelector(`[data-f="${k}"]`);if(i){i.value=v;i.classList.add("calc");i.oninput=()=>i.classList.remove("calc")}});
  PG.known=key;pgMark("other");
  note.className="desc-note";
  note.textContent=`Found in the SCOPE dataset (${j.formula}, ${fmt(j.row.t,1)} °C): its descriptors and material properties were loaded and the dataset values will be reproduced. Dataset: log10(k*) ${fmt(j.row.logk)}, Ehull ${fmt(j.row.ehull)} meV/atom, TEC ${fmt(j.row.tec)} ×10⁻⁶ K⁻¹.`;
 }else if(was){                                            /* no longer a dataset cathode at this temperature: back to the normal flow */
  PG.known=null;PG.auto=null;
  document.querySelectorAll("#pf_grid2 [data-f]").forEach(i=>{i.value="";i.classList.remove("calc")});
  pgUpdate()}};

P.predict=()=>{
 if(!S.ds||!$("#pmount"))return;if(VIEW)return P.predictHistory();const t=S.ds.train;
 if(!t)return $("#pmount").innerHTML='<div class="note">This dataset has not been trained yet.</div>';
 const cur=()=>t;
 const lab={};(cur().shap||[]).forEach(x=>lab[x.feature]=x.label);const st=cur().feature_stats||{};
 $("#pmount").innerHTML=`<div class="pred-grid solo" id="pgrid"><div class="card">

   
   <div class="top-row"><div class="ac-wrap"><label>Cathode formula<input id="pf_name" placeholder="e.g. La0.6Sr0.4Fe0.9Ga0.1O3" maxlength="60" autocomplete="off" spellcheck="false"></label></div><div class="tb-col"><button type="button" class="btn sm sec vp-btn" id="vpbtn" onclick="togglePastPreds()">View predictions</button><div class="temp-box"><label class="fld"><span class="fl-k">Temperature</span><span class="fl-l">Operating temperature (&deg;C)</span><input type="number" step="any" id="pf_t" placeholder="e.g. 700"></label></div></div></div><div id="vppanel" class="vp-panel hidden"></div><div id="fx" class="hidden"></div>
   <div class="desc-line"></div>
   <h3 class="desc-h">Descriptors</h3>
   <div class="fgrid" id="pf_grid">${DESC_UI.slice(0,15).map(descField(st,cur)).join("")}</div>
   <div class="desc-act"><span id="calcnote" class="desc-note"></span></div>
   <div class="desc-line"></div>
   <h3 class="desc-h">Other features</h3>
   <div class="fgrid" id="pf_grid2">${DESC_UI.slice(15).map(descField(st,cur,"o")).join("")}</div>
   <div class="desc-act"><button type="button" class="btn sec" onclick="fillPred();pgMark('other')">Fill with typical values</button><button type="button" class="btn" id="svrbtn" onclick="predictProps()">Predict using SVR</button></div><div id="propnote" class="desc-note prop-note"></div>
      <div style="margin-top:22px;display:flex;gap:10px;flex-wrap:wrap"><button class="btn" id="pbtn" onclick="runPredict()" disabled>Predict</button><button class="btn sec" onclick="clearPred()">Clear</button></div><div id="predhint" class="desc-note prop-note" style="margin-top:8px"></div></div>
  <div id="predres" class="pred-res"></div></div>`;
 window.FX&&FX.mount();pgInit();
 document.querySelectorAll("[data-f],[data-x],#pf_t,#pf_name").forEach(i=>i.addEventListener("keydown",e=>{if(e.key==="Enter")runPredict()}));
};
/* "View predictions": past single-cathode predictions (cathode + PASS/FAIL); View -> everything entered + the full result */
window.togglePastPreds=async()=>{
 const pn=$("#vppanel"),bt=$("#vpbtn");if(!pn)return;
 if(!pn.classList.contains("hidden")){pn.classList.add("hidden");bt.textContent="View predictions";return}
 bt.textContent="Hide predictions";pn.classList.remove("hidden");pn.innerHTML='<p class="muted small">Loading…</p>';
 try{const list=await api("/my-predictions");window._pp=list;
  pn.innerHTML=list.length?`<div class="tw"><table><thead><tr><th>Cathode</th><th>Result</th><th>Time</th><th></th></tr></thead><tbody>${list.map((p,i)=>`<tr><td><b>${esc(p.formula)}</b></td><td>${badge(p.result.final)}</td><td class="muted small">${esc(p.ago)}</td><td><button type="button" class="btn sm" onclick="ppDetail(${i})">View</button></td></tr>`).join("")}</tbody></table></div>`:'<p class="muted">No predictions made yet.</p>'}
 catch(e){pn.innerHTML=`<div class="note bad">${esc(e.message)}</div>`}};
window.ppDetail=i=>{const p=window._pp[i],r=p.result;
 if(p.full&&p.full.thresholds){   // the exact result page shown when the prediction was made
  const live=document.querySelector("#predres #v3slot");if(live)live.id="v3slot-live";   // the live result panel (right side) also has a #v3slot: rename it while the popup is open so the 3D view goes to the popup
  const ef=p.inputs&&p.inputs["Entered formula"],note=ef&&ef!==p.full.formula?`<div class="small muted" style="margin-bottom:8px">Entered formula: <b>${esc(ef)}</b> · identified as <b>${esc(p.full.formula)}</b></div>`:"";   // same note FX.annotate() adds on the live page
  $("#mbody").innerHTML=`<div class="rsmod"><div class="rsmod-bar"><span class="rsmod-rank">${esc(p.model)}${p.dataset?" · "+esc(p.dataset):""}</span><span class="rsmod-temp">${esc(p.ago)}</span></div>${predHtml(p.full).replace('<div class="card pres rs">','<div class="card pres rs">'+note)}</div>`;
  $(".mbox").classList.remove("wide");$("#modal").classList.remove("hidden");v3Mount({formula:p.full.formula});return}
 const kv=o=>`<div class="tw"><table><tbody>${Object.entries(o).map(([k,v])=>`<tr><td>${esc(UNITS.label(k))}</td><td><b>${v==null?"—":typeof v==="number"?fmt(v):esc(v)}</b></td></tr>`).join("")}</tbody></table></div>`;
 const inp={...p.inputs};if(inp["1000/T"]!=null&&isFinite(+inp["1000/T"])&&+inp["1000/T"]>0)inp["Temperature (°C)"]=+(1000/+inp["1000/T"]-273.15).toFixed(2);
 $("#mbody").innerHTML=`<h3>${esc(p.formula)} ${badge(r.final)}</h3><p class="muted small">${esc(p.model)}${p.dataset?" · "+esc(p.dataset):""} · ${esc(p.ago)}</p><h4>What you entered</h4>${kv(inp)}<h4 style="margin-top:14px">Result</h4>${kv({["Predicted log10(k*) ("+UNITS.LOGK+")"]:r.pred_log,"Predicted k* (cm/s)":r.pred_k,"Mahalanobis distance":r.dist,"Applicability domain":r.ad_result,"Ehull check":r.ehull_result,"ORR check":r.orr_result,"Est. cost":r.cost==null?null:usd(r.cost),"Cost level":r.cost_result,"Final":r.final})}`;$("#modal").classList.remove("hidden")};
window.predictProps=async()=>{
 const note=$("#propnote"),btn=$("#svrbtn"),values={};
 document.querySelectorAll("#pf_grid [data-f]").forEach(i=>{if(i.value.trim()!=="")values[i.dataset.f]=i.value});
 const tv=$("#pf_t").value.trim();if(tv!==""&&+tv+273.15>0)values["1000/T"]=String(1000/(+tv+273.15));
 note.className="desc-note prop-note";note.textContent="";btn.disabled=true;btn.textContent="Predicting…";
 try{
  const j=await api("/properties/predict",{json:{values}}),v=j.values;
  const put=(sel,x)=>{const i=document.querySelector(sel);if(!i)return;if(x==null||!isFinite(x)){return}i.value=+(+x).toPrecision(4);i.classList.add("calc");i.oninput=()=>i.classList.remove("calc")};
  if(!PG.known){put('[data-f="Work_Function"]',v.Work_Function);put('[data-f="O_pband"]',v.O_pband);put('[data-f="Log_dieletric"]',v.Log_dieletric);put('[data-f="Oxide_vacancy"]',v.Oxide_vacancy);put('[data-f="Gap"]',v.Gap)}   /* dataset cathode: keep its own measured values */
  put('[data-x="σ_ion"]',v.Bulk_Ionic);put('[data-x="σ_total"]',v.Total_Electronic);put('[data-x="ASR"]',v.ASR);
  pgMark("other");
  note.textContent=(j.outside&&j.outside.length?`Inputs outside the training range: ${j.outside.join(", ")}. `:"")+(j.notes&&j.notes.length?j.notes.join(" "):"");
  if(j.notes&&j.notes.length)note.classList.add("warn");
 }catch(e){note.classList.add("bad");note.textContent=e.message}
 finally{btn.disabled=false;btn.textContent="Predict using SVR"}};
window.fillPred=()=>{const st=S.ds.train.feature_stats||{};document.querySelectorAll("[data-sec=o][data-f]").forEach(i=>{const s=st[i.dataset.f];if(s&&s.median!=null)i.value=+s.median.toPrecision(5)})};
window.clearPred=()=>{document.querySelectorAll("[data-f],[data-x],#pf_t,#pf_name").forEach(i=>{i.value="";i.classList.remove("calc")});$("#calcnote").textContent="";$("#propnote").textContent="";$("#predres").innerHTML="";window.FX&&FX.reset();$("#pgrid").classList.add("solo");PG.desc=PG.other=null;pgUpdate()};
window.showPredPanes=()=>{const g=$("#pgrid");if(!g)return;g.classList.remove("solo");const tb=document.querySelector(".topbar");document.documentElement.style.setProperty("--tb",(tb?tb.offsetHeight:96)+"px");setTimeout(()=>g.scrollIntoView({block:"start",behavior:"smooth"}),30)};
window.runPredict=async()=>{
 if($("#pbtn")?.disabled)return;
 const values={};document.querySelectorAll("[data-f]").forEach(i=>{if(i.value.trim()!=="")values[i.dataset.f]=i.value});
 const tv=$("#pf_t").value.trim();if(tv!==""&&+tv+273.15>0)values["1000/T"]=String(1000/(+tv+273.15));
 if(!values["1000/T"])return toast("Enter the temperature (°C) – it is converted to 1000/T.");
 if(!Object.keys(values).length)return toast("Enter at least one descriptor value.");
 const fx=window.FX?FX.forPredict():{formula:$("#pf_name").value};if(fx.error)return toast(fx.error);
 const b=$("#pbtn");b.disabled=true;b.textContent="Predicting…";
 try{const o=await api(S.ds.shared?"/shared/predict":`/datasets/${S.ds.id}/predict`,{json:{values,full:true,ehull:"",formula:fx.formula,original_formula:fx.original||"",composition:fx.composition||null,model:"SVR"}});window._liveF=o.formula;$("#predres").innerHTML=predHtml(o);window.FX&&FX.annotate();showPredPanes();v3Mount({formula:o.formula})}
 catch(e){toast(e.message);$("#predres").innerHTML=`<div class="note bad">${esc(e.message)}</div>`;showPredPanes()}
 finally{b.textContent="Predict";pgUpdate()}};

window.exportCard=()=>{const n=S.ds.filename.replace(/\.[^.]+$/,"");
 return `<div class="sec-t">Export results</div><div class="card">
 <div class="exp-list" style="margin-top:0"><button class="btn exp-btn" onclick="dl('/datasets/${S.ds.id}/export/all','${n}_all.xlsx')"><svg class="ei" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/></svg><span class="et"><b>Complete Results Excel</b></span><svg class="ed" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11M7 11l5 5 5-5M5 20h14"/></svg></button><button class="btn exp-btn" onclick="dl('/datasets/${S.ds.id}/export/pass','${n}_PASS.xlsx')"><svg class="ei" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/></svg><span class="et"><b>PASS Cathodes Excel</b></span><svg class="ed" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11M7 11l5 5 5-5M5 20h14"/></svg></button><button class="btn exp-btn" onclick="dl('/datasets/${S.ds.id}/export/fail','${n}_FAIL.xlsx')"><svg class="ei" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/></svg><span class="et"><b>FAIL Cathodes Excel</b></span><svg class="ed" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11M7 11l5 5 5-5M5 20h14"/></svg></button><button class="btn exp-btn" onclick="dl('/datasets/${S.ds.id}/export/csv','${n}_results.csv')"><svg class="ei" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 12h6M9 15h6M9 18h3"/></svg><span class="et"><b>Results CSV</b></span><svg class="ed" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11M7 11l5 5 5-5M5 20h14"/></svg></button></div></div>`};
show();
setInterval(()=>{if(S.token&&!VIEW&&!document.hidden)api("/ping").catch(()=>{})},30000); // heartbeat: keeps "active" status accurate for the admin dashboard

/* ---- scroll-reveal: cards / sections slide up 60px and fade in over 1.2s when they enter the viewport ---- */
(()=>{
 if(!("IntersectionObserver" in window)||(window.matchMedia&&matchMedia("(prefers-reduced-motion: reduce)").matches))return;
 const SEL=".ph,.card,.stat,.crit,.ds,.tile,.kpi,.note,.pres,.expl,details,#main>h2";
 const io=new IntersectionObserver(es=>{
  for(const e of es){
   if(!e.isIntersecting)continue;
   const el=e.target; io.unobserve(el);
   requestAnimationFrame(()=>el.classList.add("in"));
   // after the animation, drop the helper classes so normal hover/transition styles are untouched
   setTimeout(()=>{el.classList.remove("rv","in");el.style.transitionDelay=""},1200+(parseInt(el.style.transitionDelay)||0)+150);
  }
 },{threshold:.06,rootMargin:"0px 0px -5% 0px"});
 const prep=root=>{
  const seen=new Map();
  root.querySelectorAll(SEL).forEach(el=>{
   if(el.dataset.rv)return;
   const up=el.parentElement&&el.parentElement.closest(SEL);
   if(up&&root.contains(up))return;                       // nested inside another revealed block: skip
   el.dataset.rv="1";
   const n=seen.get(el.parentElement)||0; seen.set(el.parentElement,n+1);
   el.style.transitionDelay=Math.min(n*80,400)+"ms";       // gentle stagger for siblings
   el.classList.add("rv"); io.observe(el);
  });
 };
 const watch=id=>{const root=document.getElementById(id); if(!root)return;
  new MutationObserver(ms=>{if(ms.some(m=>m.addedNodes.length))prep(root)}).observe(root,{childList:true});
  if(root.children.length)prep(root);
 };
 watch("main"); watch("mbody");
})();