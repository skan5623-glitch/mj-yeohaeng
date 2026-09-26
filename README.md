# 여행 플래너 (mj-yeohaeng)

친구들과 함께 쓰는 여행 일정 플래너예요. 파일 하나(`index.html`)로 된 웹앱이고, 가입 없이 링크로 함께 편집해요.

- 사이트: https://mj-yeohaeng.pages.dev
- 라이선스: MIT

## 할 수 있는 것
- 목적지를 대분류·중분류·소분류로 나누고, 도시를 여러 개 넣을 수 있어요.
- 가고 싶은 곳을 한꺼번에 적거나 지도 링크(구글·네이버·카카오), 구글 지도 저장 목록 링크를 넣으면 날짜별로 나누고 순서를 짜 줘요.
- 동선, 이동 시간, 식사·영업시간을 생각한 일정을 만들어요.
- 항공편: 첫날은 도착 시각부터, 마지막 날은 출발 시간에 맞춰 계산해요. 예약 캡쳐를 올리면 글자를 읽어 채워요.
- 링크로 공유하면 실시간으로 함께 편집해요. 사람마다 색이 달라요. 원하면 위치도 공유해요.
- 대중교통: 걸어서 30분이 넘는 구간은 실제 노선으로 찾아요.

## 쓰는 자료·서비스
- 지도: [OpenFreeMap](https://openfreemap.org) · © [OpenStreetMap](https://www.openstreetmap.org/copyright) 기여자
- 장소 검색: [Nominatim](https://nominatim.org) (OpenStreetMap)
- 도보·자동차 경로: [routing.openstreetmap.de](https://routing.openstreetmap.de) (OSRM)
- 대중교통 경로: [Transitous](https://transitous.org) ([자료 출처](https://transitous.org/sources/)) — 일본 등
- 선택: Google Places API (New)·Routes API (사용자가 직접 넣는 키, 기기에만 저장)
- 함께 편집: [Supabase](https://supabase.com) (함수로만 접근하는 표 + 실시간 채널)
- 글자 인식: [Tesseract.js](https://tesseract.projectnaptha.com)

## 구성
- `index.html` — 앱 전체(빌드 없음)
- `supabase/schema.sql` — 여행 저장 표와 함수(`trip_get`·`trip_patch` 등)
- `supabase/resolve-link.ts` — 지도 공유 링크·구글 지도 목록을 풀어 주는 Edge Function
- `deploy-zip.sh` — Cloudflare Pages에 올릴 zip 만들기

## English
A shared trip planner in a single HTML file (Leaflet + MapLibre, Supabase realtime, OSRM, Nominatim, Transitous for public transit, optional Google APIs). Non-commercial personal project. Contact: open an issue in this repository.
