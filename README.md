# 디자인 한신 콘솔 — GitHub Pages

게시 주소: https://hanxin123123.github.io/arthtmlpage-console-hanxin/
기본 Firebase 프로젝트: artmug-hanxin

기존 콘솔의 독립 복제본입니다. main 브랜치 루트를 Pages로 게시합니다. 기존 Google OAuth 앱을 사용하며 https://hanxin123123.github.io 출처 허용이 필요합니다. 계정의 Google IAM 권한으로 프로젝트 접근을 검사합니다.

프로젝트 자동 연결·페이지 연결·일정·포트폴리오 정렬·Drive 업로드 및 공개 재시도·파일과 카테고리 폴더 삭제 기능을 유지합니다. Drive 파일은 기존 페이지와 공유하므로 삭제 시 양쪽에 영향이 있습니다.

분석 서버 연결은 Firebase 직접 기록으로 변경했습니다. 새 메인페이지가 기록한 브라우저 ID 기반 방문 분석을 읽습니다. 다른 프로젝트는 행동분석의 ‘브라우저 분석 설정’으로 익명 인증과 분석 규칙을 적용할 수 있습니다. Firebase Authentication을 아직 시작하지 않은 프로젝트는 Firebase 콘솔에서 익명 로그인을 먼저 활성화해야 할 수 있습니다. 상세보기·신규 방문 필터·초기화를 유지합니다. 누적 수치는 날짜별 익명 카운터의 합입니다. 원본 IP 분석 기록은 이전하지 않습니다.

기존 Netlify 저장소·배포·Firebase는 변경하지 않습니다. 규칙과 웹앱 설정은 새 메인페이지 저장소에서 관리합니다.
