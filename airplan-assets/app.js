const isPopup=location.protocol==='chrome-extension:';
const $=id=>document.getElementById(id);let connected=false,current=null,polling=false;const pending=new Map();
window.addEventListener('message',event=>{if(event.source!==window||event.origin!==location.origin||event.data?.source!=='airplan-extension')return;const p=pending.get(event.data.id);if(!p)return;pending.delete(event.data.id);clearTimeout(p.timer);event.data.error?p.reject(Error(event.data.error)):p.resolve(event.data.value);});
function request(type,data={}){if(isPopup)return chrome.runtime.sendMessage({type,...data}).then(r=>{if(r?.error)throw Error(r.error);return r?.value;});return new Promise((resolve,reject)=>{const id=crypto.randomUUID(),timer=setTimeout(()=>{pending.delete(id);reject(Error('尚未連接 Chrome 本機助手，請先安裝並重新整理此頁。'));},type==='START'?20000:3500);pending.set(id,{resolve,reject,timer});window.postMessage({source:'airplan-web',id,type,...data},location.origin);});}
for(const [code,name] of Airplan.airports){const o=document.createElement('option');o.value=code;o.label=name+' · '+code;$('airports').append(o);}
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());$('date').min=today;const next=new Date(today+'T00:00:00Z');next.setUTCDate(next.getUTCDate()+7);$('date').value=next.toISOString().slice(0,10);const max=new Date(today+'T00:00:00Z');max.setUTCDate(max.getUTCDate()+359);$('date').max=max.toISOString().slice(0,10);
function airport(input){const s=input.value.trim().toUpperCase();const found=Airplan.airports.find(a=>a[0]===s||a[1]===input.value.trim());if(found)return found[0];return s;}
function query(){return Airplan.validate({origin:airport($('origin')),destination:airport($('destination')),date:$('date').value,cabin:'economy',passengers:1});}
function hero(){$('hero-origin').textContent=airport($('origin')).slice(0,3);$('hero-destination').textContent=airport($('destination')).slice(0,3);}
$('origin').onchange=hero;$('destination').onchange=hero;$('swap').onclick=()=>{const value=$('origin').value;$('origin').value=$('destination').value;$('destination').value=value;hero();};
$('help-open').onclick=()=>$('help').showModal();
async function connect(){try{await request('PING');connected=true;$('connection-dot').classList.add('online');$('connection-text').textContent='本機助手已連接 · 登入資料留在官網';const state=await request('STATE');if(state){if(isPopup){$('origin').value=state.query.origin;$('destination').value=state.query.destination;$('date').value=state.query.date;hero();}render(state);}}catch(e){connected=false;$('connection-dot').classList.remove('online');$('connection-text').textContent='即時查票需要 Chrome 本機助手';}}
$('connect').onclick=connect;
const names={available:'有票可換',waitlist:'候補',unavailable:'沒有可兌換機位',unknown:'尚未確認',mixed:'混合艙等 · 請確認'};
function render(search){
 current=search;const q=search.query;$('query-summary').textContent=`${q.origin} → ${q.destination} · ${q.date} · ${Airplan.cabins[q.cabin]} · ${q.passengers} 位成人 · 單程`;
 const active=Object.values(search.providers).some(p=>['running','login'].includes(p.status));$('stop').hidden=!active;
 for(const key of ['eva','cathay']){
  const p=search.providers[key],rows=p.rows||[],available=rows.filter(r=>r.status==='available'),mixed=rows.filter(r=>r.status==='mixed');
  const textStatus={running:'查詢中',login:'請登入',attention:'需確認',error:'查詢失敗',stopped:'已停止',ready:available.length?'有票可換':mixed.length?'混合艙等 · 請確認':rows.some(r=>r.status==='unknown')?'尚未確認':rows.some(r=>r.status==='waitlist')?'僅候補':'沒有可兌換機位'}[p.status]||'尚未搜尋';
  $(key+'-status').textContent=textStatus;$(key+'-status').className='status '+p.status;$(key+'-message').textContent=p.message||'';
  $(key+'-time').textContent=p.checkedAt?'查詢於 '+new Date(p.checkedAt).toLocaleString('zh-TW',{hour12:false}):'等待官網回覆';
  const list=$(key+'-results');list.replaceChildren();
  for(const r of rows){const item=document.createElement('div');item.className='flight';const line=document.createElement('div');line.className='line';const flight=document.createElement('b');flight.textContent=r.flight;const status=document.createElement('span');status.className=r.status;status.textContent=names[r.status]||'未確認';line.append(flight,status);const note=document.createElement('p');note.textContent=r.status==='mixed'?'部分航段不是經濟艙，請到官網確認。':r.status==='waitlist'?'需等待候補，尚未確認機位。':'';item.append(line,note);list.append(item);}
 }
}
$('search-form').onsubmit=async event=>{event.preventDefault();$('form-message').textContent='';try{const q=query();if(!connected){$('help').showModal();throw Error('請先完成一次本機助手安裝；網站本身無法讀取航空會員票位。');}$('search').disabled=true;const state=await request('START',{query:q});render(state);$('form-message').textContent='已開啟兩家航空查詢。若提示登入，請點卡片的「開啟官網」。';}catch(e){$('form-message').textContent=e.message;}finally{$('search').disabled=false;}};
$('stop').onclick=async()=>{try{render(await request('STOP'));}catch(e){$('form-message').textContent=e.message;}};
document.querySelectorAll('.source-button').forEach(button=>button.onclick=async()=>{const provider=button.dataset.provider;if(connected&&current){try{await request('FOCUS',{provider});return;}catch{}}window.open(provider==='eva'?Airplan.evaURL:Airplan.cathayURL(query()),'_blank','noopener');});
setInterval(async()=>{if(!connected||polling)return;polling=true;try{const state=await request('STATE');if(state)render(state);}catch{connected=false;$('connection-text').textContent='本機助手連線中斷，請重新連接';$('connection-dot').classList.remove('online');}finally{polling=false;}},1800);
connect();
