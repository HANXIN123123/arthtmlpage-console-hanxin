window.ArtmugPortfolioEditor = (() => {
  const store=window.ArtmugPortfolioStore;
  const adapter=window.ArtmugPortfolio;
  let session=-1, primary='', secondary='', message='', working=null;
  let draggedItem='',draggedPrimary='';

  function el(tag,cls,text){
    const node=document.createElement(tag);
    if(cls)node.className=cls;
    if(text!==undefined)node.textContent=text;
    return node;
  }
  function button(label,fn,cls='pe-button'){
    const node=el('button',cls,label);
    node.type='button';
    node.addEventListener('click',fn);
    return node;
  }
  function icon(symbol,name,fn){
    const node=button(symbol,fn,'pe-icon');
    node.title=name;
    node.setAttribute('aria-label',name);
    return node;
  }
  function input(type,value){
    const node=el('input','pe-input');
    node.type=type;
    node.value=value;
    node.required=true;
    return node;
  }
  function select(list,value){
    const node=el('select','pe-input');
    for(const [id,label] of list)node.add(new Option(label,id));
    if(list.some(([id])=>id===value))node.value=value;
    return node;
  }
  function field(label,control){
    const wrap=el('label','pe-field');
    wrap.append(el('span','',label),control);
    return wrap;
  }
  function busy(ctx){return working===ctx.version;}
  async function perform(ctx,action){
    store.check(ctx);
    if(busy(ctx))throw Error('진행 중인 작업이 있습니다.');
    working=ctx.version;
    portfolioBody.inert=true;
    try{
      const result=await action();
      store.check(ctx);
      message=typeof result==='string'?result:'저장했습니다.';
    }finally{
      if(working===ctx.version){
        working=null;
        portfolioBody.inert=false;
        if(fbState.connected && ctx.version===connectionVersion)render();
      }
    }
  }
  function direct(ctx,action){
    return async()=>{
      try{await perform(ctx,action);}
      catch(error){if(ctx.version===connectionVersion){message=error.message;render();}}
    };
  }
  function dialog(ctx,title,fields,action,label='저장',danger=false){
    const box=el('dialog','pe-dialog');
    const form=el('form','pe-dialog-form');
    const head=el('h3','',title);
    head.id='pe-dialog-title';
    box.setAttribute('aria-labelledby',head.id);
    const error=el('p','pe-error');
    error.setAttribute('role','alert');
    const footer=el('div','pe-dialog-actions');
    const cancel=button('취소',()=>box.close());
    const submit=el('button','pe-button '+(danger?'pe-danger':'pe-primary'),label);
    submit.type='submit';
    footer.append(cancel,submit);
    form.append(head,...fields,error,footer);
    box.append(form);
    document.body.append(box);
    box.addEventListener('close',()=>box.remove(),{once:true});
    box.addEventListener('cancel',event=>{if(submit.disabled)event.preventDefault();});
    form.addEventListener('submit',async event=>{
      event.preventDefault();
      if(submit.disabled)return;
      submit.disabled=cancel.disabled=true;
      error.textContent='';
      try{await perform(ctx,action);box.close();}
      catch(err){
        if(ctx.version!==connectionVersion){box.close();return;}
        error.textContent=err.message;
        submit.disabled=cancel.disabled=false;
      }
    });
    box.showModal();
    return box;
  }
  function nameDialog(ctx,p,s,isNew){
    const current=isNew?'':store.category(store.model(),p,s).name;
    const text=input('text',current);
    text.maxLength=80;
    const level=isNew?(p?'2차':'1차'):(s?'2차':'1차');
    const title=level+' 카테고리 '+(isNew?'추가':'이름 변경');
    dialog(ctx,title,[field('카테고리 이름',text)],async()=>{
      const name=text.value.trim();
      if(!name)throw Error('이름을 입력해주세요.');
      if(!isNew)return await store.rename(ctx,p,s,name)||'카테고리와 Drive 폴더 이름을 변경했습니다.';
      const result=await store.addCategory(ctx,p,name);
      primary=p||result.id;
      secondary=p?result.id:'';
      return result.message||'카테고리를 추가했습니다.';
    });
    text.select();
  }
  function positionDialog(ctx,p,s,id,position,total){
    const number=input('number',String(position));
    number.min='1';number.max=String(total);number.step='1';
    dialog(ctx,id?'작품 위치 변경':'카테고리 위치 변경',[field('이동할 위치 (1–'+total+')',number)],
      ()=>store.move(ctx,p,s,id,Number(number.value)));
    number.select();
  }
  function arrowMove(control,ctx,p,s,id,position,total){
    control.setAttribute('aria-keyshortcuts','ArrowLeft ArrowRight ArrowUp ArrowDown');
    control.addEventListener('keydown',async event=>{
      const delta={ArrowLeft:-1,ArrowUp:-1,ArrowRight:1,ArrowDown:1}[event.key];
      if(!delta)return;
      event.preventDefault();
      const next=position+delta;
      if(next<1 || next>total || busy(ctx))return;
      await direct(ctx,()=>store.move(ctx,p,s,id,next))();
      const restored=id?portfolioBody.querySelector('[data-item-id="'+CSS.escape(id)+'"] .pe-grip'):
        portfolioBody.querySelector('[data-move-level="'+(s?'secondary':'primary')+'"]');
      restored?.focus({preventScroll:true});
    });
  }
  function sortDialog(ctx,p,s){
    const selectSort=select([['name-asc','이름순 · 오름차순'],['name-desc','이름순 · 내림차순'],
      ['time-asc','올린 순서 · 오래된 순'],['time-desc','올린 순서 · 최신순']]);
    dialog(ctx,'작품 정렬',[field('이 카테고리의 표시 순서',selectSort)],
      ()=>store.sort(ctx,p,s,selectSort.value),'정렬 적용');
  }
  function defaultDialog(ctx){
    const tree=store.model(), current=adapter.resolveDefaults(tree);
    const choices=entries=>entries.map(([id,n])=>[id,n.name]);
    const first=select(choices(store.entries(tree.categories)),current.primaryId);
    const second=select([]);
    function update(){
      const list=choices(store.entries(tree.categories?.[first.value]?.categories));
      second.replaceChildren(...list.map(([id,name])=>new Option(name,id)));
      if(first.value===current.primaryId && list.some(([id])=>id===current.secondaryId))second.value=current.secondaryId;
    }
    update();
    first.addEventListener('change',update);
    const mode=select([['grid','격자'],['slide','슬라이드']],current.mode);
    dialog(ctx,'첫 화면 설정',[field('1차 카테고리',first),field('2차 카테고리',second),field('기본 보기',mode)],
      ()=>{if(!second.value)throw Error('2차 카테고리를 선택해주세요.');return store.defaults(ctx,first.value,second.value,mode.value);});
  }
  function deleteDialog(ctx,p,s,id,title){
    const hint=el('p','pe-note',id?'이 작품을 삭제합니다. 연결된 이미지 파일은 Drive 휴지통으로 이동합니다.':
      '카테고리와 그 안의 작품을 삭제합니다. 연결된 이미지와 비워진 폴더는 Drive 휴지통으로 이동합니다.');
    dialog(ctx,'「'+title+'」 삭제',[hint],()=>store.remove(ctx,p,s,id),'삭제',true);
  }
  function videoDialog(ctx,p,s){
    const url=input('text','');
    url.placeholder='YouTube 링크';
    dialog(ctx,'영상 추가',[field('YouTube 주소',url)],async()=>{
      const address=url.value.trim(),id=extractYoutubeId(address);
      if(!id || !/^[\w-]{11}$/.test(id))throw Error('올바른 YouTube 영상 주소를 입력해주세요.');
      const title=await fetchYoutubeTitle(address);
      await store.addItem(ctx,p,s,store.key(),{type:'video',id,title:title||id,url:address,addedAt:Date.now()});
    },'영상 추가');
  }
  function uploadDialog(ctx,p,s){
    const files=input('file','');
    files.accept='image/jpeg,image/png,image/webp,image/gif';
    files.multiple=true;
    const status=el('p','pe-note','선택한 순서로 업로드하며, 메인 페이지에서 볼 수 있도록 링크 공개합니다.');
    const completed=new Set(),uploaded=new Map();
    dialog(ctx,'이미지 추가',[field('이미지 파일',files),status],async()=>{
      const batch=Array.from(files.files);
      if(!batch.length)throw Error('파일을 선택해주세요.');
      if(batch.some(f=>!['image/jpeg','image/png','image/gif','image/webp'].includes(f.type)))throw Error('JPG, PNG, GIF, WebP 파일을 선택해주세요.');
      const parent=await store.folder(ctx,p,s);
      let unpublished=0;
      for(const [i,file] of batch.entries()){
        if(completed.has(file))continue;
        store.check(ctx);
        status.textContent='업로드 중 · '+(i+1)+' / '+batch.length+' · '+file.name;
        const remote=uploaded.get(file)||await uploadFileToDrive(file,parent);
        uploaded.set(file,remote);
        await store.addItem(ctx,p,s,remote.id,{type:'image',driveFileId:remote.id,name:file.name,mimeType:remote.mimeType||file.type,addedAt:Date.now()});
        try{await store.publish(ctx,p,s,remote.id);}catch(e){store.check(ctx);unpublished++;}
        completed.add(file);
      }
      return unpublished?'이미지 저장 완료 · '+unpublished+'개 이미지의 공개 설정을 다시 시도해주세요.':'이미지를 추가했습니다.';
    },'업로드');
  }
  function categoryTools(ctx,tree,p,s){
    const list=s?store.entries(tree.categories[p].categories):store.entries(tree.categories);
    const id=s||p,position=list.findIndex(([k])=>k===id)+1;
    const name=store.category(tree,p,s).name;
    const wrap=el('span','pe-tools');
    const move=icon('↕',name+' 순서 변경',()=>positionDialog(ctx,p,s,null,position,list.length));
    move.dataset.moveLevel=s?'secondary':'primary';
    move.title='위치 입력 또는 방향키로 순서 변경';
    arrowMove(move,ctx,p,s,null,position,list.length);
    wrap.append(icon('✎',name+' 이름 변경',()=>nameDialog(ctx,p,s,false)),
      move,
      icon('×',name+' 삭제',()=>deleteDialog(ctx,p,s,null,name)));
    return wrap;
  }
  function card(ctx,p,s,id,item,index,total){
    const name=adapter.itemName(item),kind=item.type==='video'?'영상':'이미지';
    const wrap=el('li','pe-card');
    wrap.dataset.itemId=id;
    const preview=el('div','pe-preview');
    if(item.type==='video'){
      const img=el('img');img.alt='';img.loading='lazy';img.src='https://img.youtube.com/vi/'+encodeURIComponent(item.id)+'/hqdefault.jpg';
      const play=button('▶',()=>{
        const player=el('iframe');
        player.title=name;
        player.allow='autoplay; encrypted-media; picture-in-picture';
        player.allowFullscreen=true;
        player.src='https://www.youtube-nocookie.com/embed/'+encodeURIComponent(item.id)+'?autoplay=1';
        preview.replaceChildren(player);
      },'pe-play');
      play.setAttribute('aria-label',name+' 재생');preview.append(img,play);
    }else{
      const img=el('img');img.loading='lazy';img.alt=name;
      const fallback=()=>{
        if(!item.driveFileId || !img.isConnected)return;
        getImageBlobUrl(item.driveFileId).then(url=>{if(img.isConnected)img.src=url;}).catch(()=>{img.alt='이미지 미리보기 실패 · '+name;});
      };
      const src=item.publicUrl||item.url;
      if(typeof src==='string' && /^https:\/\//i.test(src)){
        img.addEventListener('error',fallback,{once:true});img.src=src;
      }else queueMicrotask(fallback);
      preview.append(img);
    }
    const row=el('div','pe-card-title');
    const number=button(String(index+1),()=>positionDialog(ctx,p,s,id,index+1,total),'pe-position');
    number.title='작품 위치 변경';number.setAttribute('aria-label',name+' 위치 '+(index+1)+' 변경');
    const title=el('span','',name);title.title=name;
    row.append(number,title);
    const actions=el('div','pe-card-actions');
    const grip=button('⠿ '+kind,()=>positionDialog(ctx,p,s,id,index+1,total),'pe-grip');
    grip.draggable=true;grip.title='드래그 또는 방향키로 위치 변경';
    grip.setAttribute('aria-label',name+' 드래그 또는 방향키로 순서 변경');
    arrowMove(grip,ctx,p,s,id,index+1,total);
    grip.addEventListener('dragstart',e=>{draggedItem=id;e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',id);});
    grip.addEventListener('dragend',()=>{draggedItem='';});
    wrap.addEventListener('dragover',e=>{if(draggedItem)e.preventDefault();});
    wrap.addEventListener('drop',e=>{
      if(!draggedItem)return;
      e.preventDefault();const source=draggedItem;draggedItem='';
      if(source!==id)direct(ctx,()=>store.move(ctx,p,s,source,index+1))();
    });
    actions.append(grip,icon('×',name+' 삭제',()=>deleteDialog(ctx,p,s,id,name)));
    if(item.type==='image'&&item.driveFileId&&!item.publicUrl&&!item.url)
      actions.insertBefore(button('공개하기',direct(ctx,()=>store.publish(ctx,p,s,id)),'pe-text'),actions.lastChild);
    wrap.append(preview,row,actions);
    return wrap;
  }
  function render(){
    if(!fbState.connected)return;
    const ctx=store.context(),tree=store.model();
    if(session!==ctx.version){
      document.querySelectorAll('dialog.pe-dialog[open]').forEach(box=>box.close());
      session=ctx.version;primary=secondary=message=draggedItem=draggedPrimary='';working=null;
    }
    const first=store.entries(tree.categories);
    const defaultPage=adapter.resolveDefaults(tree);
    if(!tree.categories?.[primary])primary=defaultPage.primaryId;
    const parent=tree.categories?.[primary],children=store.entries(parent?.categories);
    if(!parent?.categories?.[secondary])secondary=(primary===defaultPage.primaryId && defaultPage.secondaryId)||children[0]?.[0]||'';
    const p=primary,s=secondary,section=parent?.categories?.[s];
    const shell=el('div','pe-editor');
    const toolbar=el('div','pe-toolbar');
    const settings=button('첫 화면 설정',()=>defaultDialog(ctx));
    settings.disabled=!first.some(([,n])=>store.entries(n.categories).length);
    toolbar.append(button('+ 카테고리 추가',()=>nameDialog(ctx,null,null,true),'pe-button pe-primary'),settings);
    if(Object.keys(tree.pendingTrash||{}).length)
      toolbar.append(button('Drive 삭제 정리 다시 시도',direct(ctx,async()=>{await store.finishTrash(ctx);return 'Drive 삭제 정리를 마쳤습니다.';})));
    const status=el('p','pe-status',message);
    status.setAttribute('role','status');
    shell.append(toolbar,status);
    if(parent){
      const tabs=el('nav','pe-tabs');
      tabs.setAttribute('aria-label','1차 카테고리');
      for(const [index,[id,n]] of first.entries()){
        const tab=button(n.name,()=>{primary=id;secondary='';render();},'pe-tab');
        tab.draggable=true;
        tab.addEventListener('dragstart',event=>{draggedPrimary=id;event.dataTransfer.setData('text/plain',id);});
        tab.addEventListener('dragover',event=>{if(draggedPrimary)event.preventDefault();});
        tab.addEventListener('dragend',()=>{draggedPrimary='';});
        tab.addEventListener('drop',event=>{
          if(!draggedPrimary)return;
          event.preventDefault();const source=draggedPrimary;draggedPrimary='';
          if(source!==id)direct(ctx,()=>store.move(ctx,source,null,null,index+1))();
        });
        tab.setAttribute('aria-pressed',String(id===p));tabs.append(tab);
      }
      const top=el('div','pe-heading');
      top.append(el('h3','',parent.name),categoryTools(ctx,tree,p,null));
      const area=el('section','pe-area');
      const subToolbar=el('div','pe-toolbar');
      subToolbar.append(button('+ 2차 카테고리 추가',()=>nameDialog(ctx,p,null,true)),
        button('1차 폴더 동기화',direct(ctx,async()=>{await store.syncFolders(ctx,p);return '카테고리의 Drive 폴더를 동기화했습니다.';})));
      if(section){
        const picker=select(children.map(([id,n])=>[id,n.name]),s);
        picker.setAttribute('aria-label','2차 카테고리 선택');
        picker.addEventListener('change',()=>{secondary=picker.value;render();});
        const controls=el('div','pe-secondary');
        const sort=button('정렬 필터',()=>sortDialog(ctx,p,s));
        sort.disabled=store.entries(section.items,'addedAt').length<2;
        controls.append(picker,categoryTools(ctx,tree,p,s),sort);
        area.append(controls);
      }
      top.append(subToolbar);
      shell.append(tabs,top,area);
      if(section){
        const tools=el('div','pe-toolbar');
        tools.append(button('+ 이미지 추가',()=>uploadDialog(ctx,p,s)),button('+ 영상 추가',()=>videoDialog(ctx,p,s)));
        const more=el('details','pe-drive');
        more.append(el('summary','','Drive 관리'),
          button('Drive 폴더 동기화',direct(ctx,async()=>{await store.syncFolders(ctx,p,s);return 'Drive 폴더와 파일 위치를 확인했습니다.';})),
          button('Drive에 남은 이미지 불러오기',direct(ctx,async()=>{await store.recover(ctx,p,s);return 'Drive 폴더의 이미지 목록을 반영했습니다.';})));
        tools.append(more);area.append(tools);
        const list=el('ol','pe-grid'),items=store.entries(section.items,'addedAt');
        items.forEach(([id,item],index)=>list.append(card(ctx,p,s,id,item,index,items.length)));
        area.append(items.length?list:el('p','pe-empty','이 카테고리에 등록된 작품이 없습니다.'));
      }else area.append(el('p','pe-empty','2차 카테고리를 추가하면 작품을 등록할 수 있습니다.'));
    }else shell.append(el('p','pe-empty','첫 번째 카테고리를 추가해주세요.'));
    portfolioBody.replaceChildren(shell);
    portfolioBody.inert=busy(ctx);
    const active=shell.querySelector('.pe-tab[aria-pressed="true"]');
    if(active)active.parentElement.scrollLeft=active.offsetLeft-active.parentElement.offsetLeft-(active.parentElement.clientWidth-active.offsetWidth)/2;
  }
  return {render};
})();
