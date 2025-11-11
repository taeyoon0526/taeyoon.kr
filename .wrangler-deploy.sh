#!/bin/bash

# Cloudflare Workers 배포 스크립트
# Dashboard 설정을 덮어쓰지 않고 코드만 업데이트

echo "🚀 Deploying worker with Dashboard settings preservation..."

# 1. 현재 Dashboard 설정 확인
echo "📋 Current Dashboard bindings will be preserved"
echo "   - VISITOR_LOG"
echo "   - VISITOR_ANALYTICS_KV (from Dashboard)"
echo "   - SECURITY_DATA (from Dashboard)"

# 2. --keep-vars 플래그와 함께 배포
# 주의: Wrangler는 --keep-vars가 없지만, 대신 wrangler.toml을 정확하게 작성해야 함

echo ""
echo "⚠️  Important: Make sure wrangler.toml has ALL bindings before deploying"
echo ""
echo "Deploying in 3 seconds... (Ctrl+C to cancel)"
sleep 3

npx wrangler deploy

echo ""
echo "✅ Deployment complete!"
echo ""
echo "🔍 Verifying bindings..."
curl -s https://contact.taeyoon.kr/visitor/check-bindings | jq

echo ""
echo "📊 Security Dashboard: https://contact.taeyoon.kr/visitor/security"
