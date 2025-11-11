#!/bin/bash

echo "🚀 Deploying Cloudflare Worker with JSON config..."
echo ""

# Deploy with JSON config
npx wrangler deploy --config wrangler.json

echo ""
echo "⏳ Waiting for deployment to propagate..."
sleep 5

echo ""
echo "🔍 Verifying KV bindings..."
BINDINGS=$(curl -s https://contact.taeyoon.kr/visitor/check-bindings)

echo "$BINDINGS" | jq

VISITOR_LOG=$(echo "$BINDINGS" | jq -r '.VISITOR_LOG')
VISITOR_ANALYTICS=$(echo "$BINDINGS" | jq -r '.VISITOR_ANALYTICS_KV')
SECURITY_DATA=$(echo "$BINDINGS" | jq -r '.SECURITY_DATA')

echo ""
if [ "$VISITOR_LOG" == "true" ] && [ "$VISITOR_ANALYTICS" == "true" ] && [ "$SECURITY_DATA" == "true" ]; then
  echo "✅ All KV bindings are active!"
  echo ""
  echo "📊 Security Dashboard: https://contact.taeyoon.kr/visitor/security"
  echo "✅ Deployment successful!"
else
  echo "⚠️  WARNING: Some KV bindings are missing!"
  echo ""
  echo "Please add these bindings in Cloudflare Dashboard:"
  [ "$VISITOR_ANALYTICS" != "true" ] && echo "  - VISITOR_ANALYTICS_KV"
  [ "$SECURITY_DATA" != "true" ] && echo "  - SECURITY_DATA"
  echo ""
  echo "Dashboard: https://dash.cloudflare.com"
  echo "Navigate to: Workers & Pages → contact-form → Settings → Variables"
fi

echo ""
