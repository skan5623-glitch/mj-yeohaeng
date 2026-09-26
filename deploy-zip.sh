#!/bin/zsh
# 여행 플래너 배포용 zip 만들기: index.html → dist/ → trip-dist.zip (Cloudflare Pages 'mj-yeohaeng' 에 업로드)
# BUILD 자리에 배포 시각을 넣어, 열어 둔 창에 '새 버전' 알림이 뜨게 한다.
cd "$(dirname "$0")"
rm -rf dist && mkdir dist
B=$(date +%Y%m%d%H%M%S)
sed "s/BUILD: '__BUILD__'/BUILD: '$B'/" index.html > dist/index.html
echo "$B" > dist/version.txt   # 열린 창은 이 작은 파일만 받아 새 버전인지 확인
printf '/*\n  Cache-Control: no-cache\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n' > dist/_headers
rm -f trip-dist.zip && (cd dist && zip -q -r ../trip-dist.zip .)
echo "$(pwd)/trip-dist.zip"
