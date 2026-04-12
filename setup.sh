#!/bin/bash
# 올리브영 트래커 - 새 컴퓨터 셋업 스크립트

echo ""
echo "======================================"
echo " 올리브영 트래커 셋업 시작"
echo "======================================"
echo ""

# 1. Node.js 확인
if ! command -v node &> /dev/null; then
  echo "❌ Node.js가 설치되어 있지 않아요."
  echo ""
  echo "👉 https://nodejs.org 에서 LTS 버전을 설치한 뒤 다시 실행해주세요."
  exit 1
fi
echo "✅ Node.js $(node -v) 확인됨"

# 2. npm 패키지 설치
echo ""
echo "📦 패키지 설치 중..."
npm install
echo "✅ 패키지 설치 완료"

# 3. Playwright 브라우저 설치
echo ""
echo "🌐 브라우저 설치 중 (1~2분 소요)..."
npx playwright install chromium
echo "✅ 브라우저 설치 완료"

# 4. .env 파일 생성
echo ""
if [ -f ".env" ]; then
  echo "✅ .env 파일이 이미 있어요. 건너뜀."
else
  echo "🔑 Supabase 연결 정보를 입력해주세요."
  echo "   (Supabase 대시보드 → Settings → Data API 에서 확인)"
  echo ""
  read -p "SUPABASE_URL (https://xxxxx.supabase.co): " SUPABASE_URL
  read -p "SUPABASE_KEY (eyJhbGci...): " SUPABASE_KEY
  echo ""

  cat > .env << EOF
SUPABASE_URL=${SUPABASE_URL}
SUPABASE_KEY=${SUPABASE_KEY}
EOF
  echo "✅ .env 파일 생성 완료"
fi

# 5. 완료
echo ""
echo "======================================"
echo " ✅ 셋업 완료!"
echo "======================================"
echo ""
echo "이제 아래 명령어로 실행할 수 있어요:"
echo ""
echo "  대시보드 생성:  node src/report.js"
echo "  전체 수집 실행: node src/runner.js"
echo ""
