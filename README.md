# roam. — 우리들의 작은 아지트

자동차를 타고 만나고, 채팅과 사진을 나누는 **React + Vite + Three.js** 친목 공간입니다. Bruno Simon 사이트의 탐색 방식에서 영감을 받았으며, 지형·나무·건물·자동차는 직접 만든 3D 지오메트리입니다.

## 실행

Node.js 24를 사용합니다. 차고지 저장에는 Node에 포함된 SQLite를 사용합니다.

```bash
cd roam
npm ci
npm run dev:all
```

**http://localhost:5174**에서 테스트합니다. 로컬 멀티플레이는 3002 포트, 데이터는 `roam/data/local/`을 사용하므로 운영 서버(3001)와 사진·코인·아이템이 섞이지 않습니다. 2인 대결은 별도 브라우저/시크릿 창 또는 `http://127.0.0.1:5174`에서 다른 닉네임으로 접속해 시험할 수 있습니다. 같은 브라우저 프로필의 같은 주소는 하나의 차고지로 복귀합니다.

다음에 다시 실행할 때는 루트의 `start-local.cmd`를 더블클릭해도 됩니다. 최초 입장은 0코인과 기본 아이템으로 시작합니다.

**작업 흐름: 로컬 수정 → 사용자 localhost 테스트 → 사용자가 명시적으로 배포 지시 → push 및 수동 배포.** 승인 전에는 운영 서버를 갱신·재시작하거나 GitHub로 push하지 않습니다. 배포 워크플로도 수동 실행만 지원합니다.

```bash
npm test        # 실제 WebSocket 클라이언트를 사용한 서버 통합 테스트
npm run build  # 정적 배포 파일 → roam/dist
```

## 구현 기능

- **마우스 우클릭** 목적지 이동: 장애물 회피 경로 탐색, 도착 시 정지, 키보드로 즉시 취소
- WASD·방향키 자동차 운전, Shift 부스트, Space 브레이크, R 초기화, 마우스 휠 확대·축소
- 넓어진 섬, 캠프파이어·텐트·방석·전구 장식이 있는 캠핑 아지트
- 접속 후 5분 동안 낮→노을→밤, 다음 5분 동안 새벽→낮으로 돌아오는 연속 변화. 네온 간판·레일·전구·차량 전조등에 HDR 블룸 적용. 로컬에서는 `http://localhost:5174/?time=night`로 밤, `?time=sunset`으로 노을을 바로 확인할 수 있습니다(고정 미리보기, 기본 주소는 실제 시간 진행).
- 차량 발광 램프는 차체의 기울기·서스펜션과 함께 움직입니다. 작은 광원의 블룸은 여러 샘플과 부드러운 밝기 기준으로 처리해 주행 중 반짝거림을 줄입니다.
- 충돌하면 터졌다가 8초 후 돌아오는 상자 3개, 부스트 발판 2개, 범퍼 2개, 점프패드 2개
- 다른 사람의 점프 높이와 상자·발판 효과 동기화
- 섬 아래 원통형 순환 레일, 장애물 없는 넓은 연결로, 닉네임 입장 후 서버가 확인한 한 바퀴마다 **20코인**. 코스 진입 지점부터 어느 방향이든 온전한 한 바퀴를 측정하며, 중간에 멈춰도 기록을 유지하고 실제 완주 진행률을 표시합니다.
- 차고지: 기본 아이템 포함 **컬렉션 100종**(차체 35·주행 이펙트 31·스프레이 34), **100코인 상자**, 외형 장착. 커먼 75%, 레어 20%, 에픽 4%, 레전더리 1%. 중복 아이템은 40코인 반환
- T로 장착한 스티커 스프레이 표시, 다른 플레이어에게도 외형·효과 공유
- 맵 왼쪽 별도 직선 레일에서 1대1 레이싱: 상대가 참가하면 두 차량을 각 출발선으로 자동 이동, 카운트다운 후 결승선 선착순으로 판돈 전액 지급, 정산 후 원래 위치로 자동 복귀. 직선 코스에서는 한 번에 한 대결만 진행하며, 순환 레일의 한 바퀴 보상과 별개입니다. 코인은 플레이로 획득하는 게임 내 재화이며 현금 결제·환전은 없음
- 매치 성사 시 서버가 점프패드·범퍼 위치를 새로 정합니다. 두 레인에 같은 종류와 진행 지점으로 3~4개씩 배치하고 출발·결승 구간은 비워 둡니다. 경기 중 밟으면 점프하거나 옆으로 튕기며, 공중에서는 통과할 수 있습니다. 상대 레인으로 이동해도 접촉 효과가 적용되고, 경기 종료 시 전부 제거됩니다.
- 사진 공유: 내 차 위에 사진 카드 표시, 다른 사람의 사진 클릭 확대, 변경·내리기
- 오늘의 한 장 사진첩: 올린 사진을 서버 디스크에 보관하고 닉네임·날짜와 함께 최신순으로 탐색, 클릭 확대, 이전 사진 더 보기
- E/Enter 근처 구역 탐색, 미니맵 빠른 이동
- 모바일 터치 조작, 효과음 켜기/끄기, 그래픽 미지원 시 일반 메뉴 탐색
- 닉네임 입장, **서버에서 최대 10명 제한**, 중복 닉네임 방지
- 15Hz 차량 상태 전파와 부드러운 원격 차량 보간, 차량 간 가벼운 충돌 반응
- 실시간 채팅, 인사 보내기, 접속 인원, 퇴장·끊긴 접속 정리
- 채팅 길이·빈도 제한, 메시지 크기 제한, Origin 검증

`roam/src/App.jsx`에서 화면을, `world.js`에서 섬과 자동차를, `attractions.js`에서 놀이 요소를 변경할 수 있습니다.

## GitHub Pages 배포

프런트엔드는 GitHub Pages에 배포됩니다. `.github/workflows/deploy.yml`이 테스트·빌드·배포를 수행합니다.

1. 저장소 **Settings → Pages → Source**를 **GitHub Actions**로 설정합니다.
2. 로컬 테스트 후 사용자의 배포 지시를 받은 경우에만 변경을 push하고 **Actions → Deploy roam to GitHub Pages → Run workflow**를 실행합니다. push만으로 자동 배포하지 않습니다.
3. 기본 배포 경로는 `https://egurgine.github.io/react_study/`입니다. 저장소 이름을 바꾸면 `roam/vite.config.js`의 base도 변경합니다.

## 멀티플레이 서버 배포

GitHub Pages에서는 WebSocket 서버를 실행할 수 없습니다. `server/index.js`는 별도 Node.js 서비스로 실행합니다. 저장소 루트의 `render.yaml`은 Render 배포용 설정입니다.

### 내 Windows PC를 서버로 사용하기

현재 PC에서 서버를 실행하고 Cloudflare Quick Tunnel로 연결할 수 있습니다. 공유기 포트 개방 없이 이 앱의 서버만 연결하며, PC와 실행 프로그램이 켜져 있어야 합니다.

1. [Cloudflare 공식 배포판](https://github.com/cloudflare/cloudflared/releases)에서 Windows용 `cloudflared`를 받습니다. 이 작업 PC에는 저장소 루트의 `.task-tools/cloudflared.exe`로 준비되어 있습니다. 다른 경로에 설치했으면 `CLOUDFLARED_PATH` 환경 변수에 실행 파일 경로를 지정하거나 PATH에 등록합니다.
2. 기존 `npm run server` / `npm run dev:all`의 서버를 종료한 뒤 다음 명령을 실행합니다. 3001 포트를 이미 사용 중이면 다른 프로세스를 자동 종료하지 않고 중단합니다.

```powershell
cd roam
npm run host:pc
```

Windows에서는 루트의 `start-server.cmd`를 더블클릭해도 같은 명령이 실행됩니다.

3. 출력되는 `wss://...trycloudflare.com/ws` 주소를 저장소 **Settings → Secrets and variables → Actions → Variables → VITE_MULTIPLAYER_URL**에 설정합니다.
4. **Actions → Deploy roam to GitHub Pages → Run workflow**를 실행합니다. 완료되면 친구에게 GitHub Pages 주소를 공유합니다.
5. 서버를 끄려면 실행 창에서 **Ctrl+C**를 누릅니다. 로컬 서버와 이 명령이 시작한 터널이 함께 종료됩니다.

Quick Tunnel은 테스트용으로, **재시작하면 서버 주소가 달라지므로 3~4단계를 다시 진행해야 합니다.** PC 절전·종료·인터넷 끊김 동안 멀티플레이와 사진첩을 사용할 수 없습니다. 서버를 재시작하면 채팅·차 위의 사진은 초기화되지만, 디스크에 저장된 사진첩은 유지됩니다. 고정 주소로 상시 운영하려면 Cloudflare 계정과 본인 도메인을 연결한 정식 Tunnel을 사용합니다. [Cloudflare 안내](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)

### 사진첩 보관

업로드한 사진은 기본적으로 **`roam/data/gallery/`**에 저장됩니다. 퇴장하거나 차 위에서 사진을 내려도 사진첩에는 남고, 자동 만료나 오래된 사진 자동 삭제는 없습니다. 이 폴더는 Git에 포함되지 않으므로 PC를 바꾸거나 백업할 때 별도로 복사해야 합니다. 기존에 저장 기능 없이 공유했다가 사라진 사진은 복구되지 않습니다.

`GALLERY_DIR`로 저장 폴더를 바꿀 수 있고, `GALLERY_MAX_BYTES`로 사진 저장 용량을 바이트 단위로 설정할 수 있습니다. 기본 한도는 **1GiB 또는 50,000장**입니다. 한도에 도달하면 기존 사진은 유지하고 새 업로드에 공간 부족 안내를 표시합니다. 여러 서버 프로세스가 같은 저장 폴더를 동시에 사용하지 않도록 합니다.

### 별도 호스팅을 사용하는 경우

1. Render에서 **New → Blueprint**를 선택하고 이 GitHub 저장소를 연결합니다.
2. `roam-multiplayer` 서비스를 생성합니다. 무료 플랜으로 구성되어 있습니다.
3. 발급된 서비스 URL이 `https://이름.onrender.com`이면, GitHub 저장소 **Settings → Secrets and variables → Actions → Variables**에 `VITE_MULTIPLAYER_URL=wss://이름.onrender.com/ws`를 추가합니다.
4. **Deploy roam to GitHub Pages** 워크플로를 다시 실행합니다.

다른 호스팅에서도 `cd roam && npm ci --omit=dev && npm start`로 실행할 수 있습니다. `PORT`는 호스팅 업체가 지정한 값을 사용합니다. `ALLOWED_ORIGINS`는 허용할 프런트엔드 origin을 쉼표로 구분합니다. 기본값은 `https://egurgine.github.io`와 localhost입니다.

### 운영 범위

- 코인·아이템은 `roam/data/players/`의 SQLite 데이터베이스에 저장됩니다. 같은 브라우저의 비밀 복귀 키로 차고지를 다시 불러오며, 닉네임만으로 다른 사람의 아이템에 접근할 수 없습니다. 브라우저 사이트 데이터를 지우면 복귀 키도 지워집니다. 서버 데이터는 Git에 포함되지 않으므로 사진첩과 함께 따로 백업합니다.

- 단일 섬 / 단일 서버 인스턴스입니다. 여러 인스턴스로 확장하려면 공유 상태 저장소가 필요합니다.
- 접속 상태와 최근 50개 채팅은 서버 메모리에만 보관되며 서버 재시작 시 초기화됩니다.
- 차 위의 사진은 한 사람당 한 장이며 퇴장 시 내려갑니다. 업로드할 때마다 사진첩에 별도 저장되므로 이전 사진도 계속 열람할 수 있습니다. 사진첩은 사이트 방문자에게 공개되며 닉네임 입장 전에도 볼 수 있습니다.
- 사진은 JPG/PNG/WebP 최대 12MB를 입력받아 브라우저에서 최대 1024px JPEG로 다시 인코딩합니다. 원본 EXIF 메타데이터는 전송하지 않습니다. 서버는 이미지 서명과 최대 512KiB 크기를 확인합니다.
- 무료 호스팅의 절전 상태에서는 첫 접속이 지연될 수 있습니다. 접속 오류가 표시되면 잠시 뒤 재시도하세요.
- 서버 URL이 없는 정적 빌드에서는 싱글 플레이와 콘텐츠 탐색이 동작하고, 멀티플레이 입장 시 연결 안내가 표시됩니다.
- 모바일 조작과 배경 탭의 느린 실행을 고려해 서버는 연결 상태를 heartbeat로 확인합니다. 연결이 끊기면 다시 닉네임으로 입장할 수 있습니다.

## 구조

```text
roam/
  src/App.jsx           화면, 패널, 닉네임, 채팅
  src/world.js          Three.js 월드, 자동차, 입력, 원격 차량
  src/navigation.js     우클릭 이동 경로 탐색
  src/attractions.js    폭발 상자, 부스트, 범퍼, 점프패드, 캠프장
  src/railWorld.js       원통형 순환 레일과 넓은 연결로
  src/railNavigation.js  연결로·레일 자동 이동 경로
  src/cosmeticsWorld.js  차체·주행 이펙트·스티커
  src/gameConfig.js      보상·상자 확률·아이템·레일 공통 규칙
  src/GamePanels.jsx    차고지·대결·코인 화면
  src/photos.js         공유 사진 크기 조절·재인코딩
  src/gallery.js        사진첩 조회·페이지네이션
  src/multiplayer.js    WebSocket 클라이언트
  src/styles.css        반응형 디자인
  server/index.js       독립 실행 가능한 WebSocket 서버
  server/gallery.js     디스크 사진 보관·목록 조회
  server/game.js        SQLite 차고지, 완주 보상, 판돈 정산
  server/index.test.js  서버 통합 테스트
  scripts/local.mjs     운영과 분리된 프런트·서버 로컬 실행
.github/workflows/deploy.yml
render.yaml
```
