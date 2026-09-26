#!/bin/zsh
# 여행 플래너 배포용 zip 만들기: index.html → dist/ → trip-dist.zip (Cloudflare Pages 'mj-yeohaeng' 에 업로드)
# BUILD 자리에 배포 시각을 넣어, 열어 둔 창에 '새 버전' 알림이 뜨게 한다.
cd "$(dirname "$0")"
rm -rf dist && mkdir dist
sed "s/BUILD: '__BUILD__'/BUILD: '$(date +%Y%m%d%H%M%S)'/" index.html > dist/index.html
printf '/*\n  Cache-Control: no-cache\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n' > dist/_headers
rm -f trip-dist.zip && (cd dist && zip -q -r ../trip-dist.zip .)
echo "$(pwd)/trip-dist.zip"
