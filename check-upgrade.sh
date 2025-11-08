#!/bin/bash

echo "🎨 =================================="
echo "   웹사이트 업그레이드 확인"
echo "=================================="
echo ""

# 파일 존재 확인
echo "📁 파일 확인..."
files=("index.html" "styles.css" "theme-upgrade.css" "script.js")
for file in "${files[@]}"; do
  if [ -f "$file" ]; then
    echo "  ✅ $file ($(du -h "$file" | cut -f1))"
  else
    echo "  ❌ $file 없음!"
  fi
done

echo ""
echo "🌐 배포 상태..."
echo "  Repository: taeyoon0526/taeyoon.kr"
echo "  Branch: main"
echo "  URL: https://taeyoon.kr"

echo ""
echo "✨ 새로운 기능:"
echo "  1. 🌓 다크/라이트 모드 토글"
echo "  2. 🎯 스킬 카테고리 필터링"
echo "  3. 🚀 Projects 섹션"
echo "  4. 📱 향상된 반응형 디자인"
echo "  5. 🎨 Glassmorphism 효과"

echo ""
echo "🔍 테스트 방법:"
echo "  1. 로컬에서 index.html 파일 열기"
echo "  2. 또는 https://taeyoon.kr 방문 (1-2분 후)"
echo ""

# Git 상태 확인
echo "📊 Git 상태:"
git log --oneline -3

echo ""
echo "✅ 업그레이드 완료!"
echo ""
echo "💡 다음 단계:"
echo "  - 브라우저에서 테스트"
echo "  - 모바일 기기에서 확인"
echo "  - 피드백 수집"
echo ""
echo "📧 문의: contact@taeyoon.kr"
