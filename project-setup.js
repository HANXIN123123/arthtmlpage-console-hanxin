const MANAGEMENT_SCOPES = ['https://www.googleapis.com/auth/cloud-platform','https://www.googleapis.com/auth/firebase.database'];
const DRIVE_SCOPES = ['https://www.googleapis.com/auth/drive.file'];
const BASIC_SCOPES = ['openid','email','profile'];

async function googleApi(url, options = {}) {
  const token = await ensureFreshToken();
  const response = await fetch(url, {
    ...options,
    headers: {Authorization:'Bearer '+token, 'Content-Type':'application/json',...options.headers}
  });
  const body = await response.json().catch(()=>({}));
  if(!response.ok) {
    const error = new Error(body.error?.message || 'Google API 요청 실패 ('+response.status+')');
    error.status=response.status; error.details=body.error?.details || [];
    throw error;
  }
  return body;
}

async function listProjectWebApps(projectId) {
  const apps=[];let pageToken='';
  do {
    const data=await googleApi('https://firebase.googleapis.com/v1beta1/projects/'+encodeURIComponent(projectId)+'/webApps?pageSize=100'+(pageToken?'&pageToken='+encodeURIComponent(pageToken):''));
    apps.push(...(data.apps || []));pageToken=data.nextPageToken;
  } while(pageToken);
  return apps;
}
async function getWebConfig(app) {
  return googleApi('https://firebase.googleapis.com/v1beta1/'+app.name+'/config');
}
async function assertNoOtherServices(project) {
  // 초기화가 필요한 프로젝트에만 적용합니다. 기존 데이터는 건드리지 않습니다.
  for(const url of [
    'https://firestore.googleapis.com/v1/projects/'+project.projectId+'/databases',
    'https://storage.googleapis.com/storage/v1/b?project='+project.projectId+'&maxResults=1'
  ]) {
    try {
      const data=await googleApi(url);
      if(data.databases?.length || data.items?.length) throw new Error('다른 데이터 서비스가 있는 프로젝트는 새 콘솔용으로 초기화할 수 없습니다.');
    } catch(error) {
      const disabled=error.details?.some(detail=>detail.reason==='SERVICE_DISABLED');
      if(!disabled && error.status!==404)throw error;
    }
  }
}
async function waitForWebApp(operation, version) {
  for(let attempt=0;attempt<30;attempt++) {
    if(version!==connectionVersion)throw new Error('연결 요청이 취소되었습니다.');
    if(operation.done) {
      if(operation.error)throw new Error(operation.error.message || '웹 앱 등록 실패');
      return operation.response;
    }
    await new Promise(resolve=>setTimeout(resolve,1000));
    operation=await googleApi('https://firebase.googleapis.com/v1beta1/'+operation.name);
  }
  throw new Error('웹 앱 생성이 진행 중입니다. 잠시 후 다시 연결해주세요.');
}
async function prepareFirebaseProject(project, version) {
  const parent='projects/'+(project.projectNumber || project.projectId)+'/locations/-';
  const instances=[];let pageToken='';
  do {
    let data;
    try {
      data=await googleApi('https://firebasedatabase.googleapis.com/v1beta/'+parent+'/instances?pageSize=100'+(pageToken?'&pageToken='+encodeURIComponent(pageToken):''));
    } catch(error) {
      if(!error.details?.some(detail=>detail.reason==='SERVICE_DISABLED'))throw error;
      if(version!==connectionVersion)throw new Error('연결 요청이 취소되었습니다.');
      setFbStatus('Realtime Database API를 준비하는 중...');
      let operation=await googleApi('https://serviceusage.googleapis.com/v1/projects/'+(project.projectNumber || project.projectId)+'/services/firebasedatabase.googleapis.com:enable',{method:'POST',body:'{}'});
      for(let attempt=0;!operation.done && attempt<30;attempt++){
        if(version!==connectionVersion)throw new Error('연결 요청이 취소되었습니다.');
        await new Promise(resolve=>setTimeout(resolve,1000));
        operation=await googleApi('https://serviceusage.googleapis.com/v1/'+operation.name);
      }
      if(!operation.done || operation.error)throw new Error('Realtime Database API를 준비하지 못했습니다. 프로젝트 권한을 확인해주세요.');
      data=await googleApi('https://firebasedatabase.googleapis.com/v1beta/'+parent+'/instances?pageSize=100');
    }
    instances.push(...(data.instances || []));pageToken=data.nextPageToken;
  } while(pageToken);
  if(instances.length>1)throw new Error('데이터베이스가 여러 개인 프로젝트입니다. 전용 프로젝트를 선택해주세요.');
  let instance=instances[0];
  let created=false;
  if(!instance) {
    await assertNoOtherServices(project);
    if(version!==connectionVersion)throw new Error('연결 요청이 취소되었습니다.');
    setFbStatus('빈 프로젝트에 Realtime Database를 만드는 중...');
    try {
      instance=await googleApi('https://firebasedatabase.googleapis.com/v1beta/projects/'+(project.projectNumber || project.projectId)+'/locations/us-central1/instances?databaseId='+encodeURIComponent(project.projectId+'-default-rtdb'),{
        method:'POST',body:JSON.stringify({type:'USER_DATABASE'})
      });
    } catch(error) {
      if(/billing|blaze|plan|paid|upgrade/i.test(error.message)) {
        const link=document.getElementById('firebaseCreateDatabaseLink');
        link.href='https://console.firebase.google.com/project/'+encodeURIComponent(project.projectId)+'/database';
        link.hidden=false;
        throw new Error('Google의 DB 생성 API는 Blaze 요금제가 필요합니다. 무료 Spark 프로젝트는 아래 Firebase 콘솔에서 빈 Realtime Database를 한 번 만든 뒤 다시 연결하면 나머지 설정이 자동 완료됩니다.');
      }
      throw error;
    }
    created=true;
  }
  if(instance.state && instance.state!=='ACTIVE')throw new Error('데이터베이스가 아직 사용 가능한 상태가 아닙니다. 잠시 후 다시 연결해주세요.');
  const databaseURL=(instance.databaseUrl || instance.databaseURL || '').replace(/\/$/,'');
  if(!databaseURL)throw new Error('데이터베이스 주소를 확인하지 못했습니다.');
  const token=await ensureFreshToken();
  const response=await fetch(databaseURL+'/.json',{headers:{Authorization:'Bearer '+token,'X-Firebase-ETag':'true'}});
  if(!response.ok)throw new Error('DB_READ_FAIL');
  let root=await response.json();
  if(!isValidArtmugSchema(root))throw new Error('다른 내용이 있는 프로젝트입니다. 이 콘솔에서 사용할 수 없습니다.');
  if(root===null) {
    if(!created)await assertNoOtherServices(project);
    if(version!==connectionVersion)throw new Error('연결 요청이 취소되었습니다.');
    const etag=response.headers.get('ETag');
    if(!etag)throw new Error('초기화 충돌 검사를 위한 ETag를 받지 못했습니다.');
    root={
      '_artmug':{app:'artmug-console',schemaVersion:2,projectId:project.projectId,createdAt:Date.now(),setupPending:true},
      'main-page':{name:project.displayName || project.projectId,url:'',artmugUrl:'',projectId:project.projectId,linked:false,managed:true},
      'youtube-category':{createdAt:Date.now()},
      'image-category':{createdAt:Date.now()}
    };
    const write=await fetch(databaseURL+'/.json',{
      method:'PUT',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json','if-match':etag},body:JSON.stringify(root)
    });
    if(write.status===412)throw new Error('다른 곳에서 데이터가 변경되었습니다. 덮어쓰지 않았으니 다시 연결해주세요.');
    if(!write.ok)throw new Error('새 프로젝트 데이터 구조를 저장하지 못했습니다.');
  }
  if(root._artmug?.setupPending === true && root._artmug.projectId === project.projectId) {
    if(version!==connectionVersion)throw new Error('연결 요청이 취소되었습니다.');
    // 초기화 중인 DB만 공개 포트폴리오 읽기를 설정합니다. 실패 시 다음 연결에서 재시도합니다.
    const rules=await fetch(databaseURL+'/.settings/rules.json',{
      method:'PUT',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
      body:JSON.stringify({rules:{'.read':false,'.write':false,'main-page':{'.read':true},'youtube-category':{'.read':true},'image-category':{'.read':true}}})
    });
    if(!rules.ok)throw new Error('구조는 생성했지만 공개 읽기 설정에 실패했습니다. Firebase 규칙을 확인해주세요.');
    const done=await fetch(databaseURL+'/_artmug/setupPending.json',{
      method:'PUT',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:'false'
    });
    if(!done.ok)throw new Error('초기화 완료 상태를 저장하지 못했습니다. 다시 연결해주세요.');
    root._artmug.setupPending=false;
  }
  let apps=await listProjectWebApps(project.projectId);
  if(!apps.length) {
    if(version!==connectionVersion)throw new Error('연결 요청이 취소되었습니다.');
    const operation=await googleApi('https://firebase.googleapis.com/v1beta1/projects/'+project.projectId+'/webApps',{
      method:'POST',body:JSON.stringify({displayName:'Artmug Main Page'})
    });
    await waitForWebApp(operation,version);
    apps=await listProjectWebApps(project.projectId);
  }
  const configs=await Promise.all(apps.map(getWebConfig));
  return {databaseURL,rootData:root,configs};
}
