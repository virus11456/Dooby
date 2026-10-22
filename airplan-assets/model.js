(function(root){
  const airports = [
    ['TPE','台北桃園','TW'],['TSA','台北松山','TW'],['KHH','高雄','TW'],['HKG','香港','HK'],['MFM','澳門','HK'],
    ['NRT','東京成田','AS'],['HND','東京羽田','AS'],['KIX','大阪關西','AS'],['UKB','神戶','AS'],['CTS','札幌','AS'],['FUK','福岡','AS'],['OKA','沖繩','AS'],['SDJ','仙台','AS'],['AOJ','青森','AS'],['AKJ','旭川','AS'],['HKD','函館','AS'],['KMQ','小松','AS'],['MYJ','松山','AS'],['NGO','名古屋','AS'],
    ['ICN','首爾仁川','AS'],['GMP','首爾金浦','AS'],['PUS','釜山','AS'],['BKK','曼谷','AS'],['CNX','清邁','AS'],['SIN','新加坡','AS'],['KUL','吉隆坡','AS'],['MNL','馬尼拉','AS'],['CEB','宿霧','AS'],['CRK','克拉克','AS'],['SGN','胡志明市','AS'],['HAN','河內','AS'],['DAD','峴港','AS'],['DPS','峇里島','AS'],['CGK','雅加達','AS'],['DEL','德里','AS'],['KTI','金邊','AS'],['PEK','北京','AS'],['PVG','上海浦東','AS'],['SHA','上海虹橋','AS'],['CAN','廣州','AS'],['SZX','深圳','AS'],['XMN','廈門','AS'],['HGH','杭州','AS'],['CTU','成都雙流','AS'],
    ['LAX','洛杉磯','US'],['SFO','舊金山','US'],['SEA','西雅圖','US'],['YVR','溫哥華','US'],['JFK','紐約甘迺迪','USE'],['ORD','芝加哥','USE'],['IAH','休士頓','USE'],['DFW','達拉斯','USE'],['IAD','華盛頓','USE'],['YYZ','多倫多','USE'],['LHR','倫敦希斯洛','EU'],['CDG','巴黎戴高樂','EU'],['AMS','阿姆斯特丹','EU'],['VIE','維也納','EU'],['MUC','慕尼黑','EU'],['MXP','米蘭','EU'],['BNE','布里斯本','OC'],['SYD','雪梨','OC'],['MEL','墨爾本','OC'],['PER','伯斯','OC']
  ];
  const cabins={economy:'經濟艙',premium:'豪華經濟艙',business:'商務艙'};
  const evaSource='https://www.evaair.com/zh-hk/infinity-mileagelands/mileage-award-program/mileage-redemption/award-ticket/eva-uni-air/';
  const evaURL='https://booking.evaair.com/flyeva/eva/b2c/plan-your-journey/award-upgrade-availability/login.aspx?lang=zh-tw';
  const cxBase='https://www.cathaypacific.com/cx/zh_HK/book-a-trip/redeem-flights/redeem-flight-awards.html';
  const normalizeDate = s => {const m=String(s).match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);return m?`${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`:null;};
  function validate(q,now=new Date()){
    if(!q || !/^[A-Z]{3}$/.test(q.origin)||!/^[A-Z]{3}$/.test(q.destination)||q.origin===q.destination)throw Error('請選擇不同的出發與目的機場（三碼 IATA）。');
    if(!Object.hasOwn(cabins,q.cabin))throw Error('請選擇艙等。');
    if(!Number.isInteger(q.passengers)||q.passengers<1||q.passengers>6)throw Error('人數須為 1–6 位成人。');
    const d=new Date(q.date+'T00:00:00Z');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(q.date)||Number.isNaN(+d)||d.toISOString().slice(0,10)!==q.date)throw Error('日期格式不正確。');
    const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
    if(q.date<today || +d>+now+360*86400000)throw Error('請選今天起 360 天內的日期。');
    return {origin:q.origin,destination:q.destination,date:q.date,cabin:q.cabin,passengers:q.passengers};
  }
  function evaMiles(q){
    const a=airports.find(x=>x[0]===q.origin)?.[2],b=airports.find(x=>x[0]===q.destination)?.[2];
    const asia=x=>['TW','HK','AS'].includes(x);let rates;
    if(!a||!b||a==='TW'&&b==='TW')return null;
    if(a==='TW'&&b==='HK'||a==='HK'&&b==='TW')rates=[10000,null,25000];
    else if(asia(a)&&asia(b))rates=[17500,20000,25000];
    else if(asia(a)||asia(b)){
      const far=asia(a)?b:a;
      if(far==='USE')rates=[55000,60000,80000];
      else if(far==='US'||far==='EU')rates=[50000,55000,75000];
      else if(far==='OC')rates=[50000,null,75000];
    }
    return rates?.[['economy','premium','business'].indexOf(q.cabin)]??null;
  }
  function cathayURL(q){const u=new URL(cxBase);Object.entries({CABINCLASS:{economy:'Y',premium:'W',business:'J'}[q.cabin],TRIPTYPE:'O',ADULT:q.passengers,CHILD:0,FLEXIBLEDATE:'true','ORIGIN[1]':q.origin,'DESTINATION[1]':q.destination,'DEPARTUREDATE[1]':q.date.replaceAll('-','')}).forEach(([k,v])=>u.searchParams.set(k,v));return u.href;}
  function cxStatus({disabled,waitlist,mixed}){return disabled?'unavailable':waitlist?'waitlist':mixed?'mixed':'available';}
  const api={airports,cabins,evaSource,evaURL,cxBase,normalizeDate,validate,evaMiles,cathayURL,cxStatus};root.Airplan=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
