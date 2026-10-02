// Drive folders are scoped to the connected Firebase project, never to a shared root.
let driveLayoutPending = null;
async function projectDriveLayout() {
  const projectId=fbState.projectId,version=connectionVersion;
  if(!fbState.connected||!projectId)throw Error('Firebase 프로젝트를 먼저 연결해주세요.');
  if(driveLayoutPending?.projectId===projectId&&driveLayoutPending.version===version)return driveLayoutPending.promise;
  const check=()=>{if(version!==connectionVersion||fbState.projectId!==projectId)throw Error('프로젝트가 변경되어 Drive 작업을 중단했습니다.');};
  const promise=(async()=>{
    const stored=latestData._artmug?.drive;
    let projectFolderId=stored?.projectId===projectId?stored.projectFolderId:null;
    if(projectFolderId){const meta=await googleApi('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(projectFolderId)+'?fields=id,mimeType,trashed');if(meta.trashed||meta.mimeType!=='application/vnd.google-apps.folder')throw Error('프로젝트 Drive 폴더를 복원해주세요.');}
    else{check();projectFolderId=await findOrCreateFolder(projectId,null);}
    check();const imageFolderId=await findOrCreateFolder(DRIVE_ROOT_FOLDER_NAME,projectFolderId);check();
    const layout={projectId,projectFolderId,imageFolderId};await fbPatch('_artmug',{drive:layout});check();
    latestData._artmug={...latestData._artmug,drive:layout};return {...layout,check};
  })();
  driveLayoutPending={projectId,version,promise};
  try{return await promise;}catch(error){driveLayoutPending=null;throw error;}
}
async function moveDriveItemTo(fileId,parentId,check) {
  check();
  const meta=await googleApi('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(fileId)+'?fields=id,parents,trashed');
  if(meta.trashed)throw Error('Drive 휴지통에 있는 항목입니다: '+fileId);
  if(meta.parents?.includes(parentId))return;
  const params=new URLSearchParams({addParents:parentId,fields:'id,parents'});
  if(meta.parents?.length)params.set('removeParents',meta.parents.join(','));
  check();const moved=await googleApi('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(fileId)+'?'+params,{method:'PATCH',body:'{}'});
  if(!moved.parents?.includes(parentId))throw Error('Drive 폴더 이동을 확인하지 못했습니다.');
}
async function ensureCategoryDriveFolder(primaryKey,subKey,subVal) {
  const layout=await projectDriveLayout();layout.check();
  let folderId=subVal.driveFolderId;
  if(folderId)await moveDriveItemTo(folderId,layout.imageFolderId,layout.check);
  else{folderId=await findOrCreateFolder(subVal.name||'미분류',layout.imageFolderId);layout.check();await fbPatch(primaryKey+'/categories/'+subKey,{driveFolderId:folderId});subVal.driveFolderId=folderId;}
  return folderId;
}
async function organizeProjectDrive(onProgress) {
  const layout=await projectDriveLayout(),categories=Object.entries(latestData['image-category']?.categories||{});
  let count=0;
  for(const [key,category] of categories){
    layout.check();onProgress('폴더 정리 중: '+category.name);
    const folderId=await ensureCategoryDriveFolder('image-category',key,category);
    for(const file of Object.values(category.images||{}))if(file.driveFileId){await moveDriveItemTo(file.driveFileId,folderId,layout.check);count++;}
  }
  return {categories:categories.length,files:count};
}
