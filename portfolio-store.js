/* Portfolio v2 is inside the project's existing public portfolio branch. */
window.ArtmugPortfolioStore = (() => {
  const path = 'image-category/portfolioV2';
  const adapter = window.ArtmugPortfolio;
  const folderMime = 'application/vnd.google-apps.folder';
  const driveBase = 'https://www.googleapis.com/drive/v3/files';
  const key = () => crypto.randomUUID();

  function context() {
    return {version:connectionVersion, project:fbState.projectId, url:fbState.databaseURL};
  }
  function check(ctx) {
    if (!fbState.connected || connectionVersion !== ctx.version || fbState.databaseURL !== ctx.url)
      throw Error('연결 프로젝트가 변경되었습니다. 작업을 중단했습니다.');
  }
  function model() {
    return adapter.read(latestData['youtube-category'],latestData['image-category'],fbState.projectId);
  }
  async function db(ctx, branch, options = {}) {
    check(ctx);
    const token = await ensureFreshToken();
    check(ctx);
    const response = await fetch(ctx.url+'/'+branch+'.json', {
      ...options, headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',...options.headers}
    });
    if (!response.ok && response.status !== 412) throw Error('포트폴리오 저장소 요청 실패 ('+response.status+')');
    return response;
  }
  async function legacy(ctx) {
    const [video,image,drive] = await Promise.all(['youtube-category','image-category','_artmug/drive'].map(
      async branch => (await db(ctx,branch)).json()
    ));
    const tree = adapter.read(video,image,ctx.project);
    const primary = tree.categories?.['image-category'];
    if (!image?.portfolioV2 && primary && drive?.imageFolderId) primary.driveFolderId=drive.imageFolderId;
    return tree;
  }
  async function edit(ctx, change) {
    for (let attempt=0; attempt<5; attempt++) {
      const read = await db(ctx,path,{headers:{'X-Firebase-ETag':'true'}});
      const etag = read.headers.get('ETag');
      if (!etag) throw Error('다른 편집과의 충돌을 확인할 수 없습니다. 다시 시도해주세요.');
      const current = await read.json();
      if (current && current.version !== 2) throw Error('지원되지 않는 포트폴리오 버전입니다.');
      const tree = current || await legacy(ctx);
      tree.categories ||= {};
      change(tree);
      const result = await db(ctx,path,{method:'PUT',headers:{'If-Match':etag},body:JSON.stringify(tree)});
      if (result.status === 412) continue;
      check(ctx);
      latestData['image-category'] ||= {};
      latestData['image-category'].portfolioV2=tree;
      return tree;
    }
    throw Error('다른 편집이 진행 중입니다. 새로고침 후 다시 시도해주세요.');
  }
  function category(tree, primary, secondary) {
    const p=tree.categories?.[primary];
    const result=secondary ? p?.categories?.[secondary] : p;
    if (!result) throw Error('다른 편집에서 카테고리가 삭제되었습니다.');
    return result;
  }
  function entries(collection,field='createdAt') {return adapter.entries(collection,field);}
  function nextOrder(collection,field) {
    const sorted=entries(collection,field);
    // Normalize old records that only have creation dates before appending.
    sorted.forEach(([,obj],index)=>{obj.order=index;});
    return sorted.length;
  }
  async function drive(ctx,id,options={},query='') {
    check(ctx);
    const token=await ensureFreshToken([...MANAGEMENT_SCOPES,...DRIVE_SCOPES]);
    check(ctx);
    const response=await fetch(driveBase+(id?'/'+id:'')+query,{
      ...options,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'}
    });
    if (!response.ok) {
      const error=Error('Drive 요청 실패 ('+response.status+')');
      error.status=response.status;
      throw error;
    }
    return response.json();
  }
  function members(tree) {
    const result=[];
    for(const p of Object.values(tree.categories||{})){
      result.push(p);
      for(const s of Object.values(p.categories||{}))result.push(s,...Object.values(s.items||{}));
    }
    return result;
  }
  async function projectFolder(ctx) {
    const info=latestData._artmug?.drive;
    if(info?.projectId===ctx.project && info.projectFolderId)return info.projectFolderId;
    check(ctx);
    const id=await findOrCreateFolder(ctx.project,null);
    check(ctx);
    return id;
  }
  async function latest(ctx){
    const saved=await (await db(ctx,path)).json();
    check(ctx);
    if(!saved)return legacy(ctx);
    if(saved.version!==2)throw Error('지원되지 않는 포트폴리오 버전입니다.');
    latestData['image-category'] ||= {};
    latestData['image-category'].portfolioV2=saved;
    return saved;
  }
  async function folder(ctx,p,s,retries=2) {
    const parent=s?await folder(ctx,p):await projectFolder(ctx);
    let tree=await latest(ctx), node=category(tree,p,s);
    const shared=node.driveFolderId && members(tree).filter(n=>n.driveFolderId===node.driveFolderId).length>1;
    if(!node.driveFolderId || shared){
      const res=await drive(ctx,'generateIds',{},'?count=1&space=drive');
      tree=await edit(ctx,current=>{
        const target=category(current,p,s);
        if(target.driveFolderId && members(current).filter(n=>n.driveFolderId===target.driveFolderId).length===1)return;
        target.driveFolderId=res.ids[0];
        target.driveFolderPending=true;
      });
      node=category(tree,p,s);
    }
    const id=node.driveFolderId;
    let meta;
    try{meta=await drive(ctx,encodeURIComponent(id),{},'?fields=id,name,parents,mimeType,trashed');}
    catch(error){
      if(error.status!==404 || !node.driveFolderPending)throw error;
      try{meta=await drive(ctx,'',{method:'POST',body:JSON.stringify({id,name:node.name,mimeType:folderMime,parents:[parent]})},'?fields=id,name,parents,mimeType,trashed');}
      catch(createError){
        if(createError.status!==409)throw createError;
        meta=await drive(ctx,encodeURIComponent(id),{},'?fields=id,name,parents,mimeType,trashed');
      }
    }
    if(meta.trashed || meta.mimeType!==folderMime)throw Error('Drive 카테고리 폴더를 복원한 뒤 다시 시도해주세요.');
    if(meta.name!==node.name || !meta.parents?.includes(parent)){
      const params=new URLSearchParams({fields:'id,name,parents'});
      if(!meta.parents?.includes(parent)){
        params.set('addParents',parent);
        if(meta.parents?.length)params.set('removeParents',meta.parents.join(','));
      }
      await drive(ctx,encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({name:node.name})},'?'+params);
    }
    if(node.driveFolderPending)await edit(ctx,current=>{
      const n=category(current,p,s);
      if(n.driveFolderId===id)delete n.driveFolderPending;
    });
    const desired=category(await latest(ctx),p,s);
    if(desired.name!==node.name || desired.driveFolderId!==id){
      if(!retries)throw Error('Drive 폴더 정보가 변경되었습니다. 다시 동기화해주세요.');
      return folder(ctx,p,s,retries-1);
    }
    return id;
  }
  async function syncFolders(ctx,p,s) {
    const id=await folder(ctx,p,s);
    if(!s){
      for(const [sub] of entries(category(model(),p).categories))await syncFolders(ctx,p,sub);
      return;
    }
    const tree=model();
    for(const item of Object.values(category(tree,p,s).items||{})){
      if(!item.driveFileId)continue;
      if(members(tree).filter(n=>n.driveFileId===item.driveFileId).length>1)continue;
      const file=await drive(ctx,encodeURIComponent(item.driveFileId),{},'?fields=parents,trashed');
      if(file.trashed || file.parents?.includes(id))continue;
      const params=new URLSearchParams({addParents:id,fields:'id'});
      if(file.parents?.length)params.set('removeParents',file.parents.join(','));
      await drive(ctx,encodeURIComponent(item.driveFileId),{method:'PATCH',body:'{}'},'?'+params);
    }
  }
  async function syncName(ctx,p,s,splitShared=false) {
    try{
      if(splitShared)await syncFolders(ctx,p,s);
      else await folder(ctx,p,s);
      return '';
    }
    catch(error){check(ctx);return '이름을 저장했습니다. Drive 폴더 동기화를 다시 실행해주세요. '+error.message;}
  }
  async function addCategory(ctx,p,name) {
    const id=key();
    await edit(ctx,tree=>{
      const collection=p?(category(tree,p).categories ||= {}):tree.categories;
      collection[id]={name,createdAt:Date.now(),order:nextOrder(collection,'createdAt')};
    });
    const message=await syncName(ctx,p||id,p?id:null);
    return {id,message};
  }
  async function rename(ctx,p,s,name) {
    const tree=await edit(ctx,current=>{category(current,p,s).name=name;});
    const folderId=category(tree,p,s).driveFolderId;
    const shared=folderId && members(tree).filter(n=>n.driveFolderId===folderId).length>1;
    return syncName(ctx,p,s,shared);
  }
  async function addItem(ctx,p,s,id,item) {
    await edit(ctx,tree=>{
      const items=category(tree,p,s).items ||= {};
      if(item.driveFileId && awaitingTrash(tree,item.driveFileId))throw Error('Drive에서 삭제 중인 파일입니다.');
      if(!items[id])items[id]={...item,order:nextOrder(items,'addedAt')};
    });
  }
  async function publish(ctx,p,s,id) {
    const fileId=category(model(),p,s).items?.[id]?.driveFileId;
    if(!fileId)throw Error('이미지의 Drive 파일을 찾을 수 없습니다.');
    check(ctx);
    const publicUrl=await publishDriveImage(fileId);
    await edit(ctx,tree=>{
      const item=category(tree,p,s).items?.[id];
      if(!item || item.driveFileId!==fileId)throw Error('이미지 정보가 변경되었습니다.');
      item.publicUrl=publicUrl;
    });
  }
  async function recover(ctx,p,s) {
    const parent=await folder(ctx,p,s);
    let token='',count=0;
    do{
      const params=new URLSearchParams({q:"'"+escapeDriveQuery(parent)+"' in parents and trashed=false and mimeType contains 'image/'",fields:'nextPageToken,files(id,name,mimeType,createdTime)',pageSize:'100'});
      if(token)params.set('pageToken',token);
      const group=await drive(ctx,'',{},'?'+params);
      await edit(ctx,tree=>{
        const items=category(tree,p,s).items ||= {};
        const ids=new Set(Object.values(items).map(item=>item.driveFileId));
        for(const file of group.files||[]){
          if(ids.has(file.id) || awaitingTrash(tree,file.id))continue;
          items[file.id]={type:'image',driveFileId:file.id,name:file.name,mimeType:file.mimeType,
            addedAt:Date.parse(file.createdTime)||Date.now(),order:nextOrder(items,'addedAt')};
        }
      });
      count+=(group.files||[]).length;
      token=group.nextPageToken;
    }while(token);
    return count;
  }
  function reorder(collection,field,id,position) {
    const list=entries(collection,field);
    const from=list.findIndex(([k])=>k===id);
    if(from<0 || !Number.isInteger(position) || position<1 || position>list.length)
      throw Error('1부터 '+list.length+' 사이의 정수를 입력해주세요.');
    list.splice(position-1,0,list.splice(from,1)[0]);
    list.forEach(([,item],i)=>{item.order=i;});
  }
  async function move(ctx,p,s,item,position) {
    await edit(ctx,tree=>{
      if(item)reorder(category(tree,p,s).items,'addedAt',item,position);
      else if(s)reorder(category(tree,p).categories,'createdAt',s,position);
      else reorder(tree.categories,'createdAt',p,position);
    });
  }
  async function sort(ctx,p,s,mode) {
    await edit(ctx,tree=>{
      const list=entries(category(tree,p,s).items,'addedAt');
      const collator=new Intl.Collator('ko',{numeric:true,sensitivity:'base'});
      const dir=mode.endsWith('-desc')?-1:1;
      list.sort(([,a],[,b])=>dir*(mode.startsWith('name')
        ?collator.compare(adapter.itemName(a),adapter.itemName(b))
        :(Number(a.addedAt)||0)-(Number(b.addedAt)||0)));
      list.forEach(([,item],i)=>{item.order=i;});
    });
  }
  async function defaults(ctx,p,s,mode) {
    await edit(ctx,tree=>{
      category(tree,p,s);
      tree.defaults={primaryId:p,secondaryId:s,mode};
    });
  }
  function awaitingTrash(tree,fileId){
    return Object.values(tree.pendingTrash||{}).some(job=>(job.files||[]).includes(fileId));
  }
  async function finishTrash(ctx){
    const tree=await latest(ctx);
    const retained=new Set(members(tree).flatMap(n=>[n.driveFileId,n.driveFolderId]).filter(Boolean));
    const trash=async id=>{
      if(retained.has(id))return;
      try{await drive(ctx,encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({trashed:true})},'?fields=id');}
      catch(e){if(e.status!==404)throw e;}
    };
    for(const [key,job] of Object.entries(tree.pendingTrash||{})){
      for(const id of job.files||[])await trash(id);
      for(const id of job.folders||[]){
        if(retained.has(id))continue;
        // Untracked or shared children must remain reachable.
        const params=new URLSearchParams({q:"'"+escapeDriveQuery(id)+"' in parents and trashed=false",fields:'files(id)',pageSize:'1'});
        const contents=await drive(ctx,'',{},'?'+params);
        if(!contents.files?.length)await trash(id);
      }
      await edit(ctx,current=>{if(current.pendingTrash)delete current.pendingTrash[key];});
    }
  }
  // Commit the removal and the remaining Drive cleanup together, so a retry never
  // removes an item created while another operator was editing the category.
  async function remove(ctx,p,s,itemId) {
    const jobKey=key();
    await edit(ctx,tree=>{
      const c=category(tree,p,s);
      const target=itemId?c.items?.[itemId]:c;
      if(!target)throw Error('이미 삭제한 작품입니다.');
      const children=itemId||s?[]:Object.values(target.categories||{});
      const sources=itemId?[target]:[...children.flatMap(n=>[...Object.values(n.items||{}),n]),...Object.values(target.items||{}),target];
      if(itemId)delete c.items[itemId];
      else if(s)delete category(tree,p).categories[s];
      else delete tree.categories[p];
      const held=new Set(members(tree).flatMap(n=>[n.driveFolderId,n.driveFileId]).filter(Boolean));
      const ids=field=>[...new Set(sources.map(n=>n[field]).filter(id=>id&&!held.has(id)))];
      const files=ids('driveFileId'),folders=ids('driveFolderId');
      if(files.length||folders.length){
        tree.pendingTrash ||= {};
        tree.pendingTrash[jobKey]={files,folders};
      }
      const d=tree.defaults;
      if(d?.primaryId===p && !itemId && (!s || d.secondaryId===s))tree.defaults=adapter.resolveDefaults(tree);
    });
    if(model().pendingTrash?.[jobKey]){
      try{await finishTrash(ctx);}
      catch(error){check(ctx);return '목록에서 삭제했습니다. Drive 삭제 정리를 다시 시도해주세요. '+error.message;}
    }
    return '삭제했습니다.';
  }
  return {context,check,model,category,entries,folder,syncFolders,addCategory,rename,addItem,publish,recover,move,sort,defaults,remove,finishTrash,key};
})();
