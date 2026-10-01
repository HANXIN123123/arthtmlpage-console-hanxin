// 기존 Google OAuth 세션을 Firebase와 Drive에서 함께 사용합니다.
function savedProjectId() {
  try { return localStorage.getItem('arthtml-project:' + authState.email); }
  catch (_) { return null; }
}
function rememberProjectId(projectId) {
  try { localStorage.setItem('arthtml-project:' + authState.email, projectId); }
  catch (_) {} // 저장이 차단된 iframe에서도 연결은 유지합니다.
}

const disconnectedPanels = Object.fromEntries(['overview', 'behavior', 'schedule'].map(page => [
  page, document.getElementById('page-' + page).innerHTML
]));

async function refreshMainPage() {
  if (!fbState.connected || document.hidden || Date.now() >= authState.expiresAt - 60000) return;
  const version = connectionVersion;
  try {
    const res = await fetch(fbState.databaseURL + '/main-page.json', {
      headers: { Authorization: 'Bearer ' + authState.accessToken }
    });
    if (!res.ok) return;
    const data = await res.json();
    if (version !== connectionVersion) return;
    if (JSON.stringify(latestData['main-page'] || null) === JSON.stringify(data)) {
      if(!document.getElementById('page-overview').contains(document.activeElement)) renderConnectedPages();
      return;
    }
    if (data && (typeof data.name !== 'string' || typeof data.url !== 'string')) return;
    if (data) latestData['main-page'] = data;
    else delete latestData['main-page'];
    if(!document.getElementById('page-overview').contains(document.activeElement)) renderConnectedPages();
  } catch (_) {} // 네트워크 복구 후 다음 주기에 다시 조회합니다.
}

async function publishDriveImage(fileId) {
  if (!fileId || !/^[\w-]+$/.test(fileId)) throw new Error('잘못된 Drive 파일 ID');
  const token = await ensureFreshToken([...MANAGEMENT_SCOPES,...DRIVE_SCOPES]);
  const res = await fetch('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(fileId) + '/permissions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'anyone', role: 'reader', allowFileDiscovery: false })
  });
  if (!res.ok) throw new Error('Drive 이미지 공개 권한을 설정하지 못했습니다.');
  return 'https://lh3.googleusercontent.com/d/' + encodeURIComponent(fileId);
}
