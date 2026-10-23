/* Family dashboard API bridge. All records are fetched after password login. */
(function(global){
'use strict';
const $=id=>document.getElementById(id);
const clone=x=>JSON.parse(JSON.stringify(x));
let app=null,connected=false,csrf='',lastSaved=null,saveTimer=null,writing=false,dirty=false,conflict=false;
function alertStatus(message,bad=false){const s=$('storageStatus');if(s){s.textContent=message;s.style.color=bad?'#a6303c':'#23635c';}const msg=$('authMessage');if(msg&&bad&&!$('authGate').classList.contains('hidden'))msg.textContent=message;}
async function api(path,body){
 const o={credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'}};
 if(body!==undefined){o.method='POST';o.headers['Content-Type']='application/json';o.headers['X-CSRF-Token']=csrf;o.body=JSON.stringify(body);}
 let r;try{r=await fetch(path,o);}catch{throw Error('Нет соединения с сервером');}
 let j={};try{j=await r.json()}catch{}
 if(!r.ok){if(r.status===401){connected=false;$('authGate').classList.remove('hidden');}const detail=typeof j.detail==='string'?j.detail:'Ошибка сервера '+r.status;const e=new Error(detail);e.status=r.status;throw e;}
 return j;
}
function compare(x,y){return JSON.stringify(x)===JSON.stringify(y);}
function computeDiff(prev,now){
 const ops=[];
 for(const [month,m] of Object.entries(now.months||{})){
  const old=prev.months?.[month];if(!old)continue;
  for(const [date,day] of Object.entries(m.days||{})){
   const before=old.days?.[date];if(!before||compare(day,before))continue;
   ops.push({type:'day',month,date,base:before,value:day});
  }
  if(!compare(m.weeks,old.weeks))ops.push({type:'weeks',month,base:old.weeks,value:m.weeks});
 }
 return ops;
}
async function refresh(force=false){
 if((dirty||writing)&&!force){alertStatus('Сначала сохрани изменения',true);return;}
 const r=await api('/api/data');
 if(r.needs_import){
  $('authGate').classList.remove('hidden');$('importPanel').hidden=false;
  $('authMessage').textContent='База подключена. Один раз загрузи сохраненную JSON-копию расписания.';
  alertStatus('Ожидается загрузка данных');return;
 }
 if(!r.data?.months)throw Error('База не вернула расписание');
 app.setCloudData(r.data);lastSaved=clone(r.data);dirty=false;conflict=false;connected=true;
 $('authGate').classList.add('hidden');alertStatus('✓ Данные синхронизированы');
}
async function flush(){
 if(!connected||!lastSaved||!app||writing||conflict)return;
 clearTimeout(saveTimer);const snapshot=clone(app.getData());const ops=computeDiff(lastSaved,snapshot);
 if(!ops.length){dirty=false;alertStatus('✓ Сохранено');return;}
 writing=true;dirty=false;alertStatus('Сохраняю…');let succeeded=false;
 try{
  await api('/api/patch',{ops});lastSaved=snapshot;alertStatus('✓ Сохранено для всех');succeeded=true;
 }catch(e){dirty=true;conflict=e.status===409;alertStatus('⚠ Не сохранено: '+e.message,true);$('retrySave').hidden=false;
  if(conflict)alert('Пока ты редактировала, изменился тот же день. Скачай JSON-копию для сохранности и затем обнови страницу. Изменения других участников не перезаписаны.');
 }finally{writing=false;if(dirty&&succeeded){clearTimeout(saveTimer);saveTimer=setTimeout(flush,950);}}
}
function scheduleSave(){
 if(!connected){alertStatus('Сначала войди по паролю',true);return;}
 dirty=true;alertStatus('Изменения ожидают сохранения…');
 clearTimeout(saveTimer);saveTimer=setTimeout(flush,850);
}
function share(){
 const url=location.origin+location.pathname;
 navigator.clipboard?.writeText(url).then(()=>alert('Ссылка скопирована. Передай пароль отдельно, только тем, кто должен менять расписание.')).catch(()=>prompt('Скопируй ссылку:',url))||prompt('Скопируй ссылку:',url);
}
function init(loginApp){
 app=loginApp;const gate=$('authGate'),message=$('authMessage');
 const password=$('familyPassword'),btn=$('authConnect'),importInput=$('importFile'),importPanel=$('importPanel');
 async function authenticate(pass){
  const r=await api('/api/login',{password:pass});csrf=r.csrf;connected=true;password.value='';
  try{await refresh();}catch(e){message.textContent=e.message;alertStatus('⚠ '+e.message,true);}
 }
 btn.addEventListener('click',async()=>{
  if(!password.value.trim()){message.textContent='Введите семейный пароль';return;}
  btn.disabled=true;message.textContent='Проверяю пароль…';
  try{await authenticate(password.value);}catch(e){message.textContent=e.message;alertStatus('⚠ '+e.message,true);}finally{btn.disabled=false;}
 });
 password.addEventListener('keydown',e=>{if(e.key==='Enter')btn.click();});
 $('retrySave').addEventListener('click',()=>{if(conflict){alert('Сначала экспортируй JSON и обнови страницу для разрешения конфликта');return;}flush();});
 $('refreshCloud').addEventListener('click',()=>refresh().catch(e=>alertStatus(e.message,true)));
 importInput.addEventListener('change',async e=>{
  const file=e.target.files?.[0];if(!file)return;
  if(file.size>2_000_000){message.textContent='Файл слишком большой';return;}
  try{const data=JSON.parse(await file.text());await api('/api/import',data);importPanel.hidden=true;await refresh();}
  catch(err){message.textContent='Не удалось импортировать: '+err.message;}
 });
 // Restore a previously signed-in session if the browser still has a cookie.
 api('/api/session').then(async res=>{csrf=res.csrf;connected=true;await refresh();}).catch(()=>{gate.classList.remove('hidden');alertStatus('Вход по паролю');});
 global.addEventListener('beforeunload',e=>{if(dirty||writing){e.preventDefault();e.returnValue='Несохраненные изменения';}});
 setInterval(()=>{if(connected&&!dirty&&!writing&&!conflict&&document.visibilityState==='visible')refresh().catch(()=>{});},60000);
}
global.SavvaSync={init,isConnected:()=>connected,scheduleSave,share,refresh,computeDiff};
})(window);