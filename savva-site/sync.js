/* Shared Savva dashboard. NO personal schedule data in the public code.
 * Each collaborator signs into Google and uses their own access to the sheet.
 * OAuth client IDs are public identifiers, not secrets.
 */
(function(global){
  'use strict';
  const SHEET_ID='1bucbwT6K6zg2-qjfLtOxjO-MLkJJuZ2OYgEW1zs9xaA';
  const BASE=`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}`;
  const MONTHS=['Октябрь 2026','Ноябрь 2026','Декабрь 2026','Январь 2027','Февраль 2027','Март 2027','Апрель 2027','Май 2027','Июнь 2027','Июль 2027','Август 2027','Сентябрь 2027'];
  const NOTE_SHEET='Веб_дневник';
  let app=null, accessToken='', tokenClient=null, lastSaved=null, saveTimer=null, writing=false, dirty=false;
  let noteIndex=new Map(), sheetMaxRow=new Map(), disconnectNotice=false, configuredClient='';
  const $=id=>document.getElementById(id);
  const clone=o=>JSON.parse(JSON.stringify(o));
  const errMessage=e=>e instanceof Error?e.message:String(e);
  const a1=name=>`'${name.replace(/'/g,"''")}'`;
  const dateISO=s=>{const m=String(s||'').match(/^(\d{2})\.(\d{2})\.(\d{4})$/);return m?`${m[3]}-${m[2]}-${m[1]}`:null;};
  const dateLocal=s=>String(s).slice(8,10)+'.'+String(s).slice(5,7)+'.'+String(s).slice(0,4);
  const hasOwn=(x,k)=>Object.prototype.hasOwnProperty.call(x||{},k);
  function notify(msg,error=false){const el=$('storageStatus');if(el){el.textContent=msg;el.style.background=error?'#fff0ed':'#ecf4f5';el.style.color=error?'#9e3645':'#26666b';} if(error){const a=$('authMessage');if(a&&!$('authGate').classList.contains('hidden'))a.textContent=msg;}}
  function showGate(msg){$('authGate').classList.remove('hidden');if(msg)$('authMessage').textContent=msg;}
  function isConnected(){return !!accessToken&&!!lastSaved;}
  function clientId(){const u=new URLSearchParams(location.search).get('client_id');let saved='';try{saved=localStorage.getItem('savva_google_client_id')||'';}catch{}return (u||saved||'').trim();}
  async function api(path,options={}){
    if(!accessToken)throw Error('Сначала войди в Google');
    let resp;
    try{resp=await fetch(BASE+path,{...options,headers:{Authorization:`Bearer ${accessToken}`, ...(options.body?{'Content-Type':'application/json'}:{}),...options.headers}});}catch(e){throw Error('Нет соединения с Google Sheets: '+errMessage(e));}
    const content=await resp.text();let obj={};try{obj=content?JSON.parse(content):{};}catch{obj={message:content};}
    if(!resp.ok){if(resp.status===401){accessToken='';showGate('Срок доступа истек. Нажми «Войти через Google» еще раз.');}
      const reason=obj.error?.message||obj.message||String(resp.status);
      throw Error(`Google Sheets (${resp.status}): ${reason}`);}
    return obj;
  }
  function qsRanges(ranges,other=''){const p=new URLSearchParams(other);for(const r of ranges)p.append('ranges',r);return '?'+p.toString();}
  function summarizeMonth(name, eventRows, weekRows){
    const days={},rows=eventRows||[];let selected=null,max=15;
    for(let i=0;i<rows.length;i++){
      const cells=rows[i]||[],row=16+i,iso=dateISO(cells[0]);
      if(cells.some(v=>v!==''&&v!==undefined&&v!==null))max=row;
      if(iso){selected=iso;if(!days[iso])days[iso]={date:iso,status:String(cells[2]||'Сад'),events:[],notes:'',_startRow:row,_endRow:row,_noteRow:null};}
      if(!selected)continue;
      const day=days[selected],title=String(cells[4]||'').trim(),category=String(cells[5]||'').trim(),note=String(cells[9]||'').trim();
      if(title&&category){
        const m=Number(cells[7]);
        day.events.push({id:`${name}-${row}`,sourceRow:row,time:String(cells[3]??''),title,category,attended:cells[6]===true||String(cells[6]).toLowerCase()==='true',minutes:Number.isFinite(m)?m:0,note});
      }else if(note){day.notes+=(day.notes?'; ':'')+note;day._noteRow=row;}
      if(!iso && day._endRow<row)day._endRow=row;
    }
    // If a new event is appended at the end of a month with its own date header,
    // the existing date is merged rather than overwritten. It has a sourceRow.
    const weeks=(weekRows||[]).map((r,i)=>({label:String((r||[])[0]||`Неделя ${i+1}`),count:Number((r||[])[1]||0),minutes:30}));
    while(weeks.length<6)weeks.push({label:`Неделя ${weeks.length+1}`,count:0,minutes:30});
    sheetMaxRow.set(name,max);
    return {days,weeks};
  }
  async function ensureNotesSheet(){
    // This tab contains per-day notes added on the web. It remains inside the
    // same Google Sheet and is protected by the same Google permissions.
    const info=await api('?fields=sheets.properties(title,sheetId)');
    if(!(info.sheets||[]).some(s=>s.properties?.title===NOTE_SHEET)){
      await api(':batchUpdate',{method:'POST',body:JSON.stringify({requests:[{addSheet:{properties:{title:NOTE_SHEET,hidden:true,gridProperties:{rowCount:1000,columnCount:3}}}}]})});
      await api(`/values/${encodeURIComponent(a1(NOTE_SHEET)+'!A1:B1')}?valueInputOption=RAW`,{method:'PUT',body:JSON.stringify({values:[['Дата','Примечание дня']]})});
    }
  }
  async function fetchLive(){
    const ranges=MONTHS.flatMap(n=>[`${a1(n)}!A16:M440`,`${a1(n)}!D5:E10`]);
    const all=await api('/values:batchGet'+qsRanges(ranges,'valueRenderOption=UNFORMATTED_VALUE'));
    const months={};
    for(let i=0;i<MONTHS.length;i++){
      months[MONTHS[i]]=summarizeMonth(MONTHS[i],all.valueRanges?.[2*i]?.values||[],all.valueRanges?.[2*i+1]?.values||[]);
    }
    const nr=await api(`/values/${encodeURIComponent(a1(NOTE_SHEET)+'!A2:B1000')}?valueRenderOption=UNFORMATTED_VALUE`);
    noteIndex=new Map();
    (nr.values||[]).forEach((r,i)=>{const date=String(r[0]||'');if(!date)return;noteIndex.set(date,{row:2+i,notes:String(r[1]||'')});});
    for(const m of Object.values(months))for(const d of Object.values(m.days))if(noteIndex.has(d.date))d.notes=noteIndex.get(d.date).notes;
    return {version:1,months};
  }
  async function refresh(){
    if(writing||dirty){notify('Сначала заверши сохранение',true);return;}
    notify('Обновляю данные…');
    try{const data=await fetchLive();lastSaved=clone(data);app.setCloudData(data);notify('✓ Синхронизировано с Google Sheets');}
    catch(e){notify(errMessage(e),true);throw e;}
  }
  const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  function addPatch(changes,month,col,row,val){changes.push({range:`${a1(month)}!${col}${row}`,values:[[val]]});}
  function sourceRows(d){return new Map((d?.events||[]).filter(e=>Number.isInteger(e.sourceRow)).map(e=>[e.sourceRow,e]));}
  function diff(oldObj,newObj){
    const cells=[],additions=[],notes=[],sickM=[];
    for(const name of MONTHS){const nm=newObj.months[name],om=oldObj.months[name];if(!nm||!om)continue;
      for(let j=0;j<Math.max(nm.weeks.length,om.weeks.length);j++)if(nm.weeks[j]&&Number(nm.weeks[j].count)!==Number(om.weeks[j]?.count||0))addPatch(cells,name,'E',5+j,Number(nm.weeks[j].count));
      for(const [iso,d] of Object.entries(nm.days)){
        const prev=om.days[iso];if(!prev)continue;
        if(d.status!==prev.status && Number.isInteger(prev._startRow))addPatch(cells,name,'C',prev._startRow,d.status);
        if(String(d.notes||'')!==String(prev.notes||''))notes.push({date:iso,notes:String(d.notes||''),month:name,startRow:prev._startRow,endRow:prev._endRow});
        const old=sourceRows(prev),now=sourceRows(d);
        for(const [row,e] of now){const e0=old.get(row);if(!e0)continue;
          for(const [key,col] of [['time','D'],['title','E'],['category','F'],['attended','G'],['minutes','H'],['note','J']]){
            const val=key==='minutes'?Number(e[key]||0):key==='attended'?!!e[key]:String(e[key]||'');
            const before=key==='minutes'?Number(e0[key]||0):key==='attended'?!!e0[key]:String(e0[key]||'');
            if(val!==before){addPatch(cells,name,col,row,val);if(key==='note')sickM.push({date:iso,month:name,startRow:prev._startRow,endRow:prev._endRow});}
          }
        }
        for(const [row,e0] of old)if(!now.has(row)){
          for(const [col,value] of [['E',''],['F',''],['G',false],['H',0],['J','']])addPatch(cells,name,col,row,value);
        }
        for(const e of d.events)if(!Number.isInteger(e.sourceRow))additions.push({name,date:iso,day:d,event:e});
      }
    }
    return {cells,additions,notes,sickM};
  }
  async function patchCells(cells){if(!cells.length)return;
    for(let i=0;i<cells.length;i+=300){const chunk=cells.slice(i,i+300);
      await api('/values:batchUpdate',{method:'POST',body:JSON.stringify({valueInputOption:'RAW',data:chunk})});}
  }
  async function writeNotes(notes){for(const note of notes){
    const existing=noteIndex.get(note.date);
    if(existing){await api(`/values/${encodeURIComponent(a1(NOTE_SHEET)+'!B'+existing.row)}?valueInputOption=RAW`,{method:'PUT',body:JSON.stringify({values:[[note.notes]]})});existing.notes=note.notes;}
    else{
      const row=2+noteIndex.size;
      await api(`/values/${encodeURIComponent(a1(NOTE_SHEET)+'!A'+row+':B'+row)}?valueInputOption=RAW`,{method:'PUT',body:JSON.stringify({values:[[note.date,note.notes]]})});
      noteIndex.set(note.date,{row,notes:note.notes});
    }
    await updateSickFormula(note);
  }}
  async function updateSickFormula(note){
    // Accounts for ordinary notes, web-specific day notes and appended events.
    if(!Number.isInteger(note.startRow))return;
    const start=note.startRow,end=note.endRow||start;
    const date=dateLocal(note.date);
    const formula=`=OR($C$${start}="Больничный";COUNTIF($J$${start}:$J$${end};"*болел*")>0;COUNTIFS('${NOTE_SHEET}'!$A:$A;"${note.date}";'${NOTE_SHEET}'!$B:$B;"*болел*")>0;COUNTIFS($A$16:$A$440;"${date}";$J$16:$J$440;"*болел*")>0)`;
    await api(`/values/${encodeURIComponent(a1(note.month)+'!M'+start)}?valueInputOption=USER_ENTERED`,{method:'PUT',body:JSON.stringify({values:[[formula]]})});
  }
  async function putNewEvent({name,date,day,event}){
    const currentMax=sheetMaxRow.get(name)||15;let row=currentMax+1;
    // Re-read candidate to avoid overwriting an existing row after another edit.
    while(row<=440){const hit=await api(`/values/${encodeURIComponent(a1(name)+'!A'+row+':M'+row)}?valueRenderOption=UNFORMATTED_VALUE`);
      if(!(hit.values||[]).some(r=>r.some(v=>v!==''&&v!==null&&v!==undefined)))break;
      row++;
    }
    if(row>440)throw Error(`В листе «${name}» закончилось место для занятий. Открой таблицу и добавь строки в диапазон учета.`);
    const m=MONTHS.includes(name),startRow=day._startRow||row,cat=String(event.category),sick=cat==='Сад';
    const use=sick?'L':'G';
    const inner=`=IF(AND(${use}${row}=TRUE;ISNUMBER(H${row});C${row}<>"Больничный";OR(F${row}<>"Сад";C${row}="Сад"));H${row}/60;0)`;
    const nCounter=`=IF(AND(E${row}<>"";G${row}=TRUE;C${row}<>"Больничный";OR(F${row}<>"Сад";C${row}="Сад"));1;0)`;
    const garden=sick?`=AND(G${row};NOT($M$${startRow});$C$${startRow}="Сад")`:'';
    const next=[dateLocal(date), '',`=$C$${startRow}`,event.time||'',event.title||'',cat,!!event.attended,Number(event.minutes)||0,inner,event.note||'',nCounter,garden,''];
    // Use USER_ENTERED to preserve formulas, while prefixing the date with an
    // apostrophe so it remains in the source sheet's DD.MM.YYYY text format.
    next[0]="'"+next[0];
    const ran=`${a1(name)}!A${row}:M${row}`;
    await api(`/values/${encodeURIComponent(ran)}?valueInputOption=USER_ENTERED`,{method:'PUT',body:JSON.stringify({values:[next]})});
    sheetMaxRow.set(name,row);
    event.sourceRow=row;event.id=`${name}-${row}`;
    return row;
  }
  async function flush(){
    if(!accessToken||!lastSaved||!app||writing)return;
    clearTimeout(saveTimer);writing=true;dirty=false;
    const current=clone(app.getData());const changes=diff(lastSaved,current);
    if(!changes.cells.length&&!changes.additions.length&&!changes.notes.length){writing=false;notify('✓ Данные сохранены');return;}
    notify('Сохраняю в общую таблицу…');
    let succeeded=false;
    try{
      await patchCells(changes.cells);
      await writeNotes(changes.notes);
      for(const item of changes.sickM.filter(x=>!changes.notes.some(n=>n.date===x.date)))await updateSickFormula(item);
      for(const item of changes.additions){const oldId=item.event.id;
        const row=await putNewEvent(item);
        const real=app.getData().months[item.name]?.days[item.date]?.events.find(e=>e.id===oldId);
        if(real){real.sourceRow=row;real.id=`${item.name}-${row}`;}
        if(/болел/i.test(item.event.note||''))await updateSickFormula({date:item.date,month:item.name,startRow:item.day._startRow,endRow:item.day._endRow});}
      lastSaved=clone(current);
      notify('✓ Сохранено в Google Sheets');
      succeeded=true;
    }catch(e){dirty=true;notify('⚠ Не сохранено: '+errMessage(e),true);
      const b=$('syncRetry');if(b)b.hidden=false;
    }finally{writing=false;if(dirty&&accessToken&&succeeded){clearTimeout(saveTimer);saveTimer=setTimeout(flush,850);}}
  }
  function scheduleSave(){if(!accessToken)return;dirty=true;notify('Изменения ожидают записи…');clearTimeout(saveTimer);saveTimer=setTimeout(flush,850);}
  function init(loginApp){app=loginApp;configuredClient=clientId();$('oauthClient').value=configuredClient;
    const conn=$('authConnect'),msg=$('authMessage');
    conn.addEventListener('click',async()=>{
      configuredClient=$('oauthClient').value.trim();
      if(!/^[0-9A-Za-z_-]+\.apps\.googleusercontent\.com$/.test(configuredClient)){msg.textContent='Нужен действительный OAuth Client ID веб-приложения Google.';return;}
      try{localStorage.setItem('savva_google_client_id',configuredClient);}catch{}
      if(!global.google?.accounts?.oauth2){msg.textContent='Сервис входа Google еще не загрузился. Обнови страницу и попробуй снова.';return;}
      msg.textContent='Подключение к Google…';
      tokenClient=global.google.accounts.oauth2.initTokenClient({client_id:configuredClient,scope:'https://www.googleapis.com/auth/spreadsheets',callback:async response=>{
        if(response.error){msg.textContent=response.error;return;}
        accessToken=response.access_token;
        try{await ensureNotesSheet();await refresh();$('authGate').classList.add('hidden');
          if(!$('syncReload')){
            const btn=document.createElement('button');btn.id='syncReload';btn.className='share-button';btn.textContent='↻ Обновить';btn.addEventListener('click',()=>refresh());$('shareLink').after(btn);
            const retry=document.createElement('button');retry.id='syncRetry';retry.className='share-button';retry.textContent='Повторить сохранение';retry.hidden=true;retry.addEventListener('click',()=>{retry.hidden=true;flush();});btn.after(retry);
          }
        }catch(e){msg.textContent=errMessage(e);notify('Нет доступа к таблице',true);}
      }});
      tokenClient.requestAccessToken({prompt:'consent'});
    });
    notify('Нужен вход в Google');
    global.addEventListener('beforeunload',e=>{if(dirty||writing){e.preventDefault();e.returnValue='Несохраненные изменения';}});
    // Check for updates from other collaborators while idle.
    setInterval(()=>{if(isConnected()&&!dirty&&!writing&&document.visibilityState==='visible')refresh().catch(()=>{});},60000);
  }
  async function share(){
    const cid=configuredClient||clientId();const u=new URL(location.href);u.searchParams.set('client_id',cid);u.hash='';
    try{await navigator.clipboard.writeText(u.toString());alert('Ссылка скопирована. Другому человеку также нужно выдать доступ к Google-таблице через кнопку «Поделиться» в Google Sheets.');}
    catch{prompt('Скопируй ссылку. Не забудь открыть доступ к исходной таблице:',u.toString());}
  }
  global.SavvaSync={init,isConnected,scheduleSave,refresh,share,parseMonth:summarizeMonth,parseDate:dateISO,computeDiff:diff};
})(window);
