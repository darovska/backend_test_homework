/* AnonHaven Trend Radar: публичный интерфейс только для чтения.
   Источник выпусков: /data/issues.json, старые снимки не переписываются. */
"use strict";
const view = { data:null, tab:"priorities", query:"", kind:"Все", sort:"priority", error:null };
const el = (id) => document.getElementById(id);
function esc(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g,(x)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[x]));
}
function safeUrl(value) {
  try {
    const u = new URL(String(value));
    return /^https?:$/.test(u.protocol) ? esc(u.toString()) : "#";
  } catch { return "#"; }
}
function external(url,text) {
  return '<a class="source-link" href="'+safeUrl(url)+'" target="_blank" rel="noopener noreferrer">'+esc(text||url)+' ↗</a>';
}
function bLink(issue,b) {
  return "#brief="+encodeURIComponent(issue.date)+"/"+encodeURIComponent(b.slug||b.eventId);
}
function arr(xs){return Array.isArray(xs)?xs:[]}
function list(xs){return '<ul>'+arr(xs).map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul>'}
function tags(b){
  return '<span class="tag '+(b.kind==="Новости"?"news":"analytic")+'">'+esc(b.kind)+'</span>'+
    '<span class="tag">'+esc(b.category)+'</span><span class="tag">'+esc(b.urgency)+'</span>';
}
function score(n){return '<div class="score" title="Редакционная оценка, не SEO-метрика"><b>'+esc(n)+'</b><div class="score-caption">из 100</div></div>'}
function dates(data) {
  return arr(data.issues).filter(x=>x&&/^\d{4}-\d\d-\d\d$/.test(x.date)&&Array.isArray(x.briefs)).sort((a,b)=>b.date.localeCompare(a.date));
}
function humanDate(date){
  try {return new Intl.DateTimeFormat("ru-RU",{day:"numeric",month:"long",year:"numeric",timeZone:"UTC"}).format(new Date(date+"T12:00:00Z"))}
  catch{return date}
}
function current(){return view.data&&view.data.issues[0]}
function updateStats(){
  const issue=current();
  if(!issue)return;
  const siteCount=arr(issue.sources).filter(x=>x.type==="Сайт").length;
  const tgCount=arr(issue.sources).filter(x=>x.type==="Telegram").length;
  el("stats").innerHTML =
    '<div class="stat"><div class="stat-label">Последняя проверка</div><div class="stat-value date">'+esc(issue.checkedAt||humanDate(issue.date))+'</div></div>'+
    '<div class="stat"><div class="stat-label">Мониторинг</div><div class="stat-value">'+siteCount+' + '+tgCount+'</div><div class="stat-extra">сайтов / Telegram</div></div>'+
    '<div class="stat"><div class="stat-label">Полные ТЗ</div><div class="stat-value">'+arr(issue.briefs).length+'</div><div class="stat-extra">в свежем выпуске</div></div>'+
    '<div class="stat"><div class="stat-label">История</div><div class="stat-value">'+view.data.issues.length+'</div><div class="stat-extra">выпусков сохранено</div></div>';
  el("history-count").textContent=view.data.issues.length;
}
function filteredBriefs(issue){
  const query=view.query.trim().toLocaleLowerCase("ru");
  return arr(issue.briefs).filter(b=>view.kind==="Все"||b.kind===view.kind)
   .filter(b=>!query||[b.h1,b.angle,b.mainKeyword,...arr(b.extraKeywords),...arr(b.entities),b.category].join(" ").toLocaleLowerCase("ru").includes(query))
   .sort((a,b)=>view.sort==="name"?String(a.h1).localeCompare(String(b.h1),"ru"):(Number(b.score)||0)-(Number(a.score)||0));
}
function heading(title,subtitle,count){
  return '<div class="section-heading"><div><h2>'+esc(title)+'</h2>'+(subtitle?'<p>'+esc(subtitle)+'</p>':'')+'</div>'+(count==null?'':'<span class="count">'+count+' тем</span>')+'</div>';
}
function topicCard(issue,b){
  return '<article class="topic"><div class="topic-top"><div class="topic-main">'+
    '<div class="tags">'+tags(b)+'</div>'+
    '<h3><a href="'+bLink(issue,b)+'">'+esc(b.h1)+'</a></h3>'+
    '<p>'+esc(b.angle)+'</p></div>'+score(b.score)+'</div>'+
    '<div class="topic-foot"><div class="tags"><span class="tag">'+esc(b.format)+'</span><span class="tag">'+esc(b.status)+'</span></div>'+
    '<a class="link-button" href="'+bLink(issue,b)+'">Открыть полное ТЗ →</a></div></article>';
}
function topicsPage(isBriefs){
 const issue=current(),items=filteredBriefs(issue);
 const title=isBriefs?"Редакционные ТЗ":"Что брать в работу";
 const caption="Свежий выпуск: "+humanDate(issue.date)+". Приоритет основан на редакционной оценке, а не частотности запросов.";
 return heading(title,caption,items.length)+ (items.length?'<div class="cards">'+items.map(x=>topicCard(issue,x)).join('')+'</div>':'<div class="empty">Темы не найдены. Измени поисковый запрос или фильтр.</div>')+
 (isBriefs?'<p class="note">Открой карточку, чтобы увидеть полный план, SEO-параметры, первоисточники, ответ для ИИ-поиска и готовые ответы FAQ.</p>':'');
}
function section(title,body,cls=""){return '<section class="brief-section '+cls+'"><h3>'+esc(title)+'</h3>'+body+'</section>'}
function row(title,body){return '<div class="field-row"><span class="label">'+esc(title)+'</span><span class="value">'+body+'</span></div>'}
function linkItems(items,mode){
  return '<ul>'+arr(items).map(x=>mode==="objects"?'<li>'+external(x.url,x.label)+'</li>':'<li>'+external(x)+'</li>').join('')+'</ul>';
}
function detail(issue,b){
 const backlinks=issue.date===current().date?"#tab=priorities":"#tab=history";
 const seo=section("SEO-пакет",'<div class="field-list">'+
   row("Title",esc(b.seoTitle)+' <button class="copy" type="button" data-copy="'+esc(b.seoTitle)+'">Копировать</button>')+
   row("Description",esc(b.seoDescription)+' <button class="copy" type="button" data-copy="'+esc(b.seoDescription)+'">Копировать</button>')+
   row("Основной запрос",esc(b.mainKeyword))+
   row("Дополнительные запросы",esc(arr(b.extraKeywords).join(" · ")))+
   row("Целевой URL",'<code>'+esc(b.proposedUrl)+'</code> <small class="note">(предложенный адрес, не опубликованная статья)</small>')+'</div>');
 const faq=section("Вопросы и ответы (FAQ)",arr(b.faq).map(x=>'<div class="faq-item"><strong>'+esc(x.q)+'</strong><p>'+esc(x.a)+'</p></div>').join(''));
 const links=section("Первоисточники и освещение",'<div class="field-list">'+row("Первоисточники",linkItems(b.primary,"objects"))+row("Контекст в СМИ",linkItems(b.coverage,"objects"))+'</div>');
 const dateNotice=issue.date===current().date?'Текущий выпуск':'Архивный выпуск: '+humanDate(issue.date);
 return '<button type="button" class="back" data-back="'+esc(backlinks)+'">← Назад к радару</button>'+
   '<article class="brief-full"><header class="brief-header"><p class="section-kicker">'+esc(dateNotice)+'</p><div class="tags">'+tags(b)+'</div>'+
   '<h2>'+esc(b.h1)+'</h2><p>'+esc(b.angle)+'</p>'+
   '<div class="brief-meta"><span class="tag">Приоритет: '+esc(b.score)+'/100</span><span class="tag">'+esc(b.format)+'</span><span class="tag">'+esc(b.status)+'</span><span class="tag">'+esc(b.volume)+'</span></div>'+
   '<p class="note">Проверка: '+esc(issue.checkedAt||issue.date)+' · ID: '+esc(b.eventId)+'</p></header>'+
   section("Подтвержденные факты",list(b.facts))+
   section("Что нельзя утверждать без подтверждения",list(b.notConfirmed),"warn")+
   section("Хронология",list(b.timeline))+
   links+seo+
   section("План материала: H2",list(b.h2))+
   section("ИИ-поиск и ответный лид",'<p><strong>Вопрос пользователя:</strong> '+esc(b.aiQuestion)+'</p><div class="answer">'+esc(b.aiAnswer)+'</div>')+
   section("Ключевые сущности",'<p>'+esc(arr(b.entities).join(" · "))+'</p>')+
   section("Собственная полезная часть материала",'<p>'+esc(b.contribution)+'</p>')+
   faq+
   section("Внутренняя перелинковка",linkItems(b.internalLinks))+
   section("Иллюстрация и alt",'<div class="field-list">'+row("Идея",esc(b.illustration))+row("Alt",esc(b.alt))+'</div>')+
   '</article>';
}
function reservePage(){
 const issue=current();
 return heading("Резерв и наблюдение","Сигналы, которым нужна дополнительная проверка или значимое развитие.")+
  arr(issue.reserve).map((x,i)=>'<article class="reserve-item"><p class="section-kicker">РЕЗЕРВ '+String(i+1).padStart(2,'0')+'</p><h3>'+esc(x.title)+'</h3><p>'+esc(x.note)+'</p>'+linkItems(x.links)+'</article>').join('');
}
function sourcesPage(){
 const issue=current(),sites=arr(issue.sources).filter(x=>x.type==="Сайт"),channels=arr(issue.sources).filter(x=>x.type==="Telegram");
 function renderSource(x){return '<div class="source-row"><div><div class="source-name">'+external(x.url,x.name)+'</div>'+
   (x.note?'<div class="source-note">'+esc(x.note)+'</div>':'')+'</div><span class="status '+(x.status==="Частично"?"partial":"")+'">'+esc(x.status)+'</span></div>'}
 return heading("Отслеживаемые источники","Статус относится к проверке "+humanDate(issue.date)+". Частичный просмотр не означает отсутствия новостей.")+
  '<h3 class="subheading">Исследования, СМИ и блоги · '+sites.length+'</h3>'+sites.map(renderSource).join('')+
  '<h3 class="subheading">Telegram · '+channels.length+'</h3>'+channels.map(renderSource).join('')+
  '<h3 class="subheading">Ограничения проверки</h3>'+list(issue.limitations);
}
function archiveIssue(issue,index){
 const currentIssue=index===0;
 const h=humanDate(issue.date),bs=arr(issue.briefs);
 return '<details class="archive"'+(currentIssue?' open':'')+'><summary aria-label="'+esc(h)+' — '+bs.length+' ТЗ">'+
  '<div class="archive-left"><span class="chevron" aria-hidden="true">›</span><div><strong>'+esc(h)+'</strong> '+(currentIssue?'<span class="current-label">Свежий</span>':'')+
  '<div class="archive-meta">'+bs.length+' ТЗ · '+arr(issue.reserve).length+' резервных сигналов · '+esc(issue.checkedAt||'')+'</div></div></div>'+
  '<span class="expand"><span class="expand-text">Развернуть ↓</span><span class="collapse-text">Свернуть ↑</span></span></summary>'+
  '<div class="archive-body"><ol>'+bs.map(b=>'<li><a href="'+bLink(issue,b)+'">'+esc(b.h1)+'</a><small>'+esc(b.kind)+' · '+esc(b.score)+'/100 · '+esc(b.status)+'</small></li>').join('')+'</ol></div></details>';
}
function historyPage(){
 return heading("История выпусков","Последний выпуск открыт по умолчанию. Предыдущие дни свернуты: нажми «Развернуть», чтобы посмотреть старые темы.")+
 '<div class="history-list">'+view.data.issues.map(archiveIssue).join('')+'</div>'+
 '<p class="note">Выпуски сохраняются как отдельные снимки по датам. При публикации нового выпуска все предыдущие дни автоматически становятся свернутым архивом.</p>';
}
function tabFromHash(){
 const m=location.hash.match(/^#tab=(priorities|briefs|reserve|sources|history)$/);
 if(m)return m[1];
 return null;
}
function briefFromHash(){
 let str;
 try {str=decodeURIComponent(location.hash.slice(1))}catch{return null}
 const m=/^brief=(\d{4}-\d{2}-\d{2})\/([a-z0-9-]+)$/.exec(str);
 if(!m||!view.data)return null;
 const issue=view.data.issues.find(x=>x.date===m[1]);
 const brief=issue&&arr(issue.briefs).find(x=>(x.slug||x.eventId)===m[2]);
 return issue&&brief?{issue,brief}:null;
}
function setTab(next){view.tab=next;location.hash="tab="+next;render()}
function render(){
 if(!view.data)return;
 const direct=briefFromHash();
 if(!direct){const h=tabFromHash();if(h)view.tab=h}
 document.querySelectorAll("#tabs button").forEach(btn=>{
   const active=!direct&&btn.dataset.tab===view.tab;
   btn.classList.toggle("active",active);
   if(active)btn.setAttribute("aria-current","page");else btn.removeAttribute("aria-current");
 });
 const showFilters=!direct&&(view.tab==="priorities"||view.tab==="briefs");
 el("filters").classList.toggle("hidden",!showFilters);
 const main=el("content");
 if(direct){main.innerHTML=detail(direct.issue,direct.brief);document.title=direct.brief.h1+" | AnonHaven Trend Radar";return}
 document.title="AnonHaven Trend Radar | Редакционные ТЗ";
 if(view.tab==="briefs")main.innerHTML=topicsPage(true);
 else if(view.tab==="reserve")main.innerHTML=reservePage();
 else if(view.tab==="sources")main.innerHTML=sourcesPage();
 else if(view.tab==="history")main.innerHTML=historyPage();
 else main.innerHTML=topicsPage(false);
}
async function refresh(){
 el("refresh").disabled=true;
 try{
   const result=await fetch("./data/issues.json?t="+Date.now(),{cache:"no-store"});
   if(!result.ok)throw Error("HTTP "+result.status);
   const data=await result.json();
   const issues=dates(data);
   if(!issues.length)throw Error("Нет валидных выпусков");
   const oldDate=current()&&current().date;
   view.data={...data,issues};
   updateStats();
   render();
   if(oldDate&&oldDate!==issues[0].date){
      const status=document.createElement("p");status.className="note";status.textContent="Опубликован новый выпуск: "+humanDate(issues[0].date);
      el("content").prepend(status);
   }
 }catch(error){
   view.error=String(error);
   if(!view.data){el("content").innerHTML='<div class="empty">Не удалось загрузить выпуски. Попробуй нажать «Обновить» позднее.</div>';el("stats").textContent="Данные временно недоступны"}
 }finally{el("refresh").disabled=false}
}
document.addEventListener("DOMContentLoaded",()=>{
 document.querySelectorAll("#tabs button").forEach(x=>x.addEventListener("click",()=>setTab(x.dataset.tab)));
 document.querySelectorAll("[data-kind]").forEach(x=>x.addEventListener("click",()=>{
   view.kind=x.dataset.kind;document.querySelectorAll("[data-kind]").forEach(y=>y.classList.toggle("selected",y===x));render();
 }));
 el("search").addEventListener("input",event=>{view.query=event.target.value;render()});
 el("sort").addEventListener("change",event=>{view.sort=event.target.value;render()});
 el("refresh").addEventListener("click",refresh);
 el("content").addEventListener("click",async event=>{
   const back=event.target.closest("[data-back]");
   if(back){location.hash=back.dataset.back;return}
   const copy=event.target.closest("[data-copy]");
   if(copy){try{await navigator.clipboard.writeText(copy.dataset.copy);const old=copy.textContent;copy.textContent="Скопировано";setTimeout(()=>copy.textContent=old,1600)}catch{}}
 });
 window.addEventListener("hashchange",()=>{render();window.scrollTo({top:0,behavior:"instant"})});
 refresh();
 // В уже открытой вкладке проверяем новый выпуск без перезагрузки каждые 15 минут.
 setInterval(()=>{if(document.visibilityState==="visible")refresh()},15*60*1000);
});
