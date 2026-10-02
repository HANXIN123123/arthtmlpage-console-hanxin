let renderedConnection = '';
function normalizeHttps(value) {
  const url=new URL(value);
  if(url.protocol!=='https:' || url.username || url.password)throw new Error('HTTPS 주소를 입력해주세요.');
  url.hash='';return url;
}
function validateMainPageConfig(config, projectId, databaseURL, configs) {
  if(!config?.apiKey || !config.appId || config.projectId!==projectId)throw new Error('이 메인페이지에 Firebase 키가 없거나 다른 프로젝트의 설정입니다.');
  if(String(config.databaseURL || '').replace(/\/$/,'')!==databaseURL.replace(/\/$/,''))throw new Error('메인페이지의 Realtime Database 주소가 이 프로젝트와 다릅니다.');
  if(!configs.some(app=>app.apiKey===config.apiKey && app.appId===config.appId))throw new Error('이 프로젝트에 등록된 Firebase 웹 앱의 키가 아닙니다.');
}
function inspectMainPage(value) {
  const url=normalizeHttps(value);
  const pagePath=path=>path.replace(/\/index\.html$/i,'/').replace(/\/$/,'');
  if(url.origin===location.origin && pagePath(url.pathname)===pagePath(location.pathname))throw new Error('콘솔 주소가 아니라 메인페이지 주소를 입력해주세요.');
  url.searchParams.set('artmug-verify','1');
  return new Promise((resolve,reject)=>{
    const frame=document.createElement('iframe');
    frame.hidden=true;frame.setAttribute('sandbox','allow-scripts allow-same-origin');
    const nonce=crypto.randomUUID();
    let timer,interval;
    function finish(error,result) {
      clearTimeout(timer);clearInterval(interval);window.removeEventListener('message',receive);frame.remove();
      error?reject(error):resolve(result);
    }
    function receive(event) {
      if(event.source!==frame.contentWindow || event.origin!==url.origin || event.data?.type!=='ARTMUG_CONFIG_RESPONSE' || event.data.nonce!==nonce)return;
      finish(null,event.data);
    }
    function ask(){frame.contentWindow?.postMessage({type:'ARTMUG_CONFIG_REQUEST',nonce},url.origin);}
    window.addEventListener('message',receive);frame.addEventListener('load',ask);
    frame.src=url.href;document.body.appendChild(frame);
    interval=setInterval(ask,300);
    timer=setTimeout(()=>finish(new Error('페이지 설정을 확인하지 못했습니다. 주소와 메인페이지의 embed-client.js 적용 여부를 확인해주세요.')),12000);
  });
}
function makeConnectionInput(label,value,type='url') {
  const wrap=document.createElement('label');wrap.className='connection-field';
  const text=document.createElement('span');text.textContent=label;
  const input=document.createElement('input');input.type=type;input.value=value || '';
  wrap.append(text,input);return {wrap,input};
}
function renderConnectedPages(force=false) {
  const main=latestData['main-page'] || {};
  const signature=JSON.stringify([fbState.projectId,fbState.connected,main]);
  if(!force && signature===renderedConnection)return;
  renderedConnection=signature;
  for(const page of ['overview','behavior','schedule']) {
    const panel=document.getElementById('page-'+page);
    if(!fbState.connected){panel.innerHTML=disconnectedPanels[page];continue;}
    panel.replaceChildren();
    const card=document.createElement('div');card.className='fb-connect-card';
    const title=document.createElement('h3');
    title.textContent=page==='overview'?'페이지 연결 관리':(main.name || fbState.projectName)+' · '+pageMeta[page].title;
    const subtitle=document.createElement('p');subtitle.textContent=fbState.projectName+' · '+fbState.projectId;
    card.append(title,subtitle);
    if(page!=='overview' && main.url && main.linked!==false && main.projectId===fbState.projectId){panel.append(card);window.mountProjectDashboard(page,panel,main);continue;}
    if(page!=='overview') {
      const note=document.createElement('p');
      note.textContent=main.url
        ?(page==='behavior'?'메인페이지가 연결되었습니다. 행동 데이터 수집은 다음 단계에서 연결합니다.':'메인페이지가 연결되었습니다. 일정 조회·편집은 다음 단계에서 연결합니다.')
        :'개요에서 메인페이지를 연결해주세요.';
      card.appendChild(note);panel.appendChild(card);continue;
    }
    const status=document.createElement('p');status.className='connection-status';status.setAttribute('role','status');
    const grid=document.createElement('div');grid.className='connection-grid';
    const mainInput=makeConnectionInput('메인페이지 주소',main.url);
    const artInput=makeConnectionInput('아트머그 상세페이지 주소',main.artmugUrl);
    const nameInput=makeConnectionInput('페이지 이름',main.name || fbState.projectName,'text');
    const version=connectionVersion;
    async function update(value) {
      if(version!==connectionVersion)throw new Error('연결 프로젝트가 변경되었습니다.');
      await fbPatch('main-page',value);
      if(version!==connectionVersion)return;
      latestData['main-page']={...main,...value};
      renderConnectedPages(true);
    }
    function row(field,label,action,unlink) {
      const box=document.createElement('div');box.className='connection-box';box.append(field.wrap);
      const controls=document.createElement('div');controls.className='connection-actions';
      const save=document.createElement('button');save.type='button';save.className='btn-confirm';save.textContent=label;
      const remove=document.createElement('button');remove.type='button';remove.className='btn-cancel';remove.textContent='연결 해제';remove.disabled=!field.input.value;
      async function run(task) {
        save.disabled=true;remove.disabled=true;status.textContent='확인하는 중입니다...';
        try {await task();}catch(error){status.textContent=error.message;save.disabled=false;remove.disabled=!field.input.value;}
      }
      save.onclick=()=>run(action);remove.onclick=()=>run(unlink);
      controls.append(save,remove);
      if(field.input.value) {
        try {
          const link=document.createElement('a');link.href=normalizeHttps(field.input.value).href;link.target='_blank';link.rel='noopener noreferrer';link.textContent='페이지 열기';controls.append(link);
        }catch(_){}
      }
      box.append(controls);return box;
    }
    grid.append(
      row(mainInput,'설정 확인 후 연결',async()=>{
        const url=normalizeHttps(mainInput.input.value.trim());
        const result=await inspectMainPage(url.href);
        validateMainPageConfig(result.config,fbState.projectId,fbState.databaseURL,fbState.webConfigs || []);
        await update({name:nameInput.input.value.trim() || result.name || fbState.projectName,url:url.href,projectId:fbState.projectId,linked:true,managed:true,updatedAt:Date.now()});
      },()=>update({url:'',linked:false,managed:true,updatedAt:Date.now()})),
      row(artInput,'아트머그 연결',async()=>{
        const url=normalizeHttps(artInput.input.value.trim());
        if(!['artmug.kr','www.artmug.kr'].includes(url.hostname) || url.searchParams.get('channel')!=='view' || !/^\d+$/.test(url.searchParams.get('uid') || ''))throw new Error('아트머그 상세페이지 주소(channel=view&uid=숫자)를 입력해주세요.');
        await update({artmugUrl:url.href,managed:true,updatedAt:Date.now()});
      },()=>update({artmugUrl:'',managed:true,updatedAt:Date.now()}))
    );
    card.append(nameInput.wrap,grid,status);
    const help=document.createElement('p');help.textContent='메인페이지의 Firebase 프로젝트·웹 앱 키·DB 주소를 확인합니다. 연결 해제는 포트폴리오를 삭제하지 않습니다.';
    card.append(help);
    if(fbState.webConfigs?.length) {
      const details=document.createElement('details'),summary=document.createElement('summary');
      summary.textContent='메인페이지에 넣을 Firebase 설정';
      const config={...fbState.webConfigs[0],databaseURL:fbState.databaseURL};
      const area=document.createElement('textarea');area.readOnly=true;area.rows=10;area.className='connection-code';
      const allowed=['apiKey','authDomain','databaseURL','projectId','storageBucket','messagingSenderId','appId'];
      area.value='const firebaseConfig = '+JSON.stringify(Object.fromEntries(allowed.filter(key=>config[key]).map(key=>[key,config[key]])),null,2)+';';
      details.append(summary,area);card.appendChild(details);
    }
    panel.appendChild(card);
  }
}

