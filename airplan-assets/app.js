const isPopup=location.protocol==='chrome-extension:';
const $=id=>document.getElementById(id);let connected=false,current=null,polling=false,connecting=false,nextConnectAt=0;const pending=new Map();
window.addEventListener('message',event=>{if(event.source!==window||event.origin!==location.origin||event.data?.source!=='airplan-extension')return;if(event.data.type==='READY'){if(!connected)connect();return;}const p=pending.get(event.data.id);if(!p)return;pending.delete(event.data.id);clearTimeout(p.timer);event.data.error?p.reject(Error(event.data.error)):p.resolve(event.data.value);});
function request(type,data={}){if(isPopup)return chrome.runtime.sendMessage({type,...data}).then(r=>{if(r?.error)throw Error(r.error);return r?.value;});return new Promise((resolve,reject)=>{const id=crypto.randomUUID(),timer=setTimeout(()=>{pending.delete(id);reject(Error('尚未連接 Chrome 助手，請安裝 0.5.1 並重新整理此頁。'));},type==='START'?20000:3500);pending.set(id,{resolve,reject,timer});window.postMessage({source:'airplan-web',id,type,...data},location.origin);});}
for(const [code,name] of Airplan.airports){const o=document.createElement('option');o.value=code;o.label=name+' · '+code;$('airports').append(o);}
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const offset=n=>{const d=new Date(today+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
$('date').min=today;$('date').max=offset(359);$('date').value=offset(7);$('return-date').max=offset(359);$('return-date').value=offset(14);
function tripFields(){const round=$('trip').value==='roundtrip';$('return-label').hidden=!round;$('return-date').disabled=!round;$('return-date').required=round;$('return-date').min=$('date').value||today;}
$('trip').onchange=tripFields;$('date').onchange=tripFields;tripFields();
function airport(input){const s=input.value.trim().toUpperCase();const found=Airplan.airports.find(a=>a[0]===s||a[1]===input.value.trim());return found?found[0]:s;}
function query(){return Airplan.validateJourney({origin:airport($('origin')),destination:airport($('destination')),date:$('date').value,trip:$('trip').value,returnDate:$('return-date').value,cabin:'economy',passengers:1});}
function hero(){$('hero-origin').textContent=airport($('origin')).slice(0,3);$('hero-destination').textContent=airport($('destination')).slice(0,3);}
$('origin').onchange=hero;$('destination').onchange=hero;$('swap').onclick=()=>{const value=$('origin').value;$('origin').value=$('destination').value;$('destination').value=value;hero();};
$('help-open').onclick=()=>$('help').showModal();
async function connect(){if(connecting)return;connecting=true;try{const info=await request('PING');if(!info?.version||info.version.localeCompare('0.5.1',undefined,{numeric:true})<0)throw Error(`助手版本 ${info?.version||'未知'}，請下載 0.5.1 並重新載入擴充功能。`);connected=true;$('connection-dot').classList.add('online');$('connection-text').textContent=`助手 ${info.version} 已連接 · 登入資料留在官網`;const state=await request('STATE');if(state){if(isPopup){$('origin').value=state.query.origin;$('destination').value=state.query.destination;$('date').value=state.query.date;$('trip').value=state.query.trip||'oneway';if(state.query.returnDate)$('return-date').value=state.query.returnDate;tripFields();hero();}render(state);}}catch(e){connected=false;$('connection-dot').classList.remove('online');$('connection-text').textContent=e.message;}finally{connecting=false;nextConnectAt=Date.now()+5000;}}
$('connect').onclick=connect;
const names={available:'有票可換',waitlist:'僅候補',unavailable:'沒有可兌換機位',unknown:'尚未確認',mixed:'混合艙等 · 請確認',running:'查詢中',login:'請登入',attention:'需確認',error:'查詢失敗',stopped:'已停止',idle:'尚未搜尋'};
function node(tag,text,cls){const el=document.createElement(tag);el.textContent=text;if(cls)el.className=cls;return el;}
async function focusProvider(provider){try{if(connected&&current){await request('FOCUS',{provider});return;}const q=query();window.open(provider.startsWith('eva')?Airplan.evaURL:Airplan.cathayURL(q),'_blank','noopener');}catch(e){$('form-message').textContent=e.message;}}
function render(search){
 if(!search?.query||!search.providers)return;current=search;const q=search.query,round=q.trip==='roundtrip';
 $('query-summary').textContent=`${q.origin} ${round?'⇄':'→'} ${q.destination} · ${q.date}${round?' 去程／'+q.returnDate+' 回程':''} · ${Airplan.cabins[q.cabin]} · ${q.passengers} 位成人`;
 const jobs=Object.values(search.providers);$('search-progress').textContent=`已完成 ${jobs.filter(p=>p.status==='ready').length}／${jobs.filter(p=>p.status!=='skipped').length} 項 · ${jobs.filter(p=>p.status==='error').length} 項未確認`;
 $('stop').hidden=!Object.values(search.providers).some(p=>['queued','running','login','attention'].includes(p.status));
 const container=$('calendar-results');container.replaceChildren();
 const legend=node('p','○ 有票可換　× 無票　△ 可候補　… 查詢中／等待　？ 未確認');container.append(legend);
 for(const [leg,query] of Object.entries(Airplan.legs(q))){
  const section=node('section','','calendar-leg');section.append(node('h3',`${leg==='outbound'?'去程':'回程'} · ${query.origin} → ${query.destination}`));
  const table=document.createElement('table'),caption=node('caption',`以 ${query.date} 為中心，前後各三天`);table.append(caption);
  const head=document.createElement('thead'),hr=document.createElement('tr');for(const name of ['日期','長榮航空','亞洲萬里通']){const th=node('th',name);th.scope='col';hr.append(th);}head.append(hr);table.append(head);
  const body=document.createElement('tbody');
  for(const date of Airplan.dateWindow(query.date)){
   const tr=document.createElement('tr');if(date===query.date)tr.className='selected-date';const th=node('th',date+(date===query.date?'（選定）':''));th.scope='row';tr.append(th);
   for(const provider of ['eva','cathay']){
    const key=provider+(leg==='inbound'?'Return':'')+'_'+date,p=search.providers[key],status=Airplan.availability(p);
    const symbol={available:'○',unavailable:'×',waitlist:'△',queued:'…',running:'…',skipped:'—'}[status]||'？';
    const label=names[status]||({queued:'等待查詢',skipped:'超出可查詢日期範圍'}[status])||'尚未確認';
    const td=document.createElement('td'),mark=node('span',symbol,'availability-symbol '+status);mark.setAttribute('aria-label',label);mark.title=label;td.append(mark);
    if(['login','attention','error','mixed','unknown','stopped','skipped'].includes(status)){td.append(node('small',status==='mixed'?names.mixed:(p?.message||label)));if(p?.tabId){const button=node('button','開啟官網','text-button');button.type='button';button.onclick=()=>focusProvider(key);td.append(button);}}
    if(['error','attention','stopped'].includes(status)){const retry=node('button','重試此日','text-button');retry.type='button';retry.onclick=async()=>{try{render(await request('RETRY',{provider:key}));}catch(e){$('form-message').textContent=e.message;}};td.append(retry);}
    tr.append(td);
   }body.append(tr);
  }table.append(body);section.append(table);container.append(section);
 }

}
$('search-form').onsubmit=async event=>{event.preventDefault();$('form-message').textContent='';try{const q=query();if(!connected){$('help').showModal();throw Error('請先安裝或更新到助手 0.5.1，再重新連接。');}$('search').disabled=true;render(await request('START',{query:q}));document.querySelector('.results-top').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});$('form-message').textContent='搜尋已開始。若提示登入，請點對應的「開啟官網」。';}catch(e){$('form-message').textContent=e.message;}finally{$('search').disabled=false;}};
$('stop').onclick=async()=>{try{render(await request('STOP'));}catch(e){$('form-message').textContent=e.message;}};
document.querySelectorAll('.source-button').forEach(button=>button.onclick=()=>focusProvider(button.dataset.provider));
setInterval(async()=>{if(!connected){if(Date.now()>=nextConnectAt)connect();return;}if(polling)return;polling=true;try{const state=await request('STATE');if(state)render(state);}catch{connected=false;$('connection-text').textContent='助手連線中斷，請重新連接';$('connection-dot').classList.remove('online');}finally{polling=false;}},1800);
window.addEventListener('focus',()=>{if(!connected)connect();});
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!connected)connect();});
connect();
