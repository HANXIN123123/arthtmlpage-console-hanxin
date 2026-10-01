// Configure browser analytics with the signed-in owner's Google access token.
// This does not provision a server, billing plan, or service-account key.
async function configureBrowserAnalytics(version) {
  const projectId=fbState.projectId, url=fbState.databaseURL;
  const check=()=>{if(version!==connectionVersion||!fbState.connected)throw Error('프로젝트가 변경되었습니다.');};
  check();
  const templateResponse=await fetch('./database.rules.json');
  if(!templateResponse.ok)throw Error('분석 규칙 파일을 불러오지 못했습니다.');
  const template=await templateResponse.json(),token=await ensureFreshToken();check();
  const headers={Authorization:'Bearer '+token,'Content-Type':'application/json'};
  const currentResponse=await fetch(url+'/.settings/rules.json',{headers});
  if(!currentResponse.ok)throw Error('데이터베이스 규칙을 읽을 권한이 없습니다.');
  const current=await currentResponse.json();
  if(current.rules?.['.read']===true||current.rules?.['.write']===true)throw Error('루트 전체가 공개된 규칙입니다. Firebase에서 루트 공개 권한을 먼저 해제해주세요.');
  check();
  try {
    await googleApi('https://identitytoolkit.googleapis.com/admin/v2/projects/'+encodeURIComponent(projectId)+'/config?updateMask=signIn.anonymous.enabled',{
      method:'PATCH',body:JSON.stringify({signIn:{anonymous:{enabled:true}}})
    });
  } catch(error) {
    throw Error('Firebase Authentication에서 익명 로그인을 활성화한 뒤 다시 눌러주세요. '+error.message);
  }
  check();
  const saved=await fetch(url+'/.settings/rules.json',{method:'PUT',headers,body:JSON.stringify({rules:{...current.rules,analytics:template.rules.analytics}})});
  if(!saved.ok)throw Error('분석 보안 규칙 저장에 실패했습니다.');
  check();
  await fbSet('_artmug/analyticsVersion',3);
  await fbSet('_artmug/analytics',{enabled:true,mode:'firebase-direct',retentionDays:30,configuredAt:Date.now()});
  latestData._artmug={...latestData._artmug,analyticsVersion:3};
}
