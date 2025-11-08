# ⚠️ Cloudflare Workers Build Notice

## Why is the Cloudflare Workers build failing?

GitHub detects `worker.js` in this repository and attempts to build it automatically through **Cloudflare Pages integration**. However, this project uses **two separate deployments**:

### 1. 🌐 Static Website (GitHub Pages)
- **Files**: `index.html`, `styles.css`, `script.js`, etc.
- **Deployed to**: GitHub Pages at `https://taeyoon.kr`
- **Build**: Automatic via GitHub Actions ✅

### 2. ⚡ Serverless Function (Cloudflare Workers)
- **File**: `worker.js`
- **Deployed to**: Cloudflare Workers at `https://contact.taeyoon.kr`
- **Build**: Manual deployment via Cloudflare Dashboard ✅

## Solution

The `worker.js` file is intentionally **not deployed via GitHub**. It's deployed manually to Cloudflare Workers Dashboard. This is the correct setup!

### To stop the failed build notifications:

1. **Option A**: Disable Cloudflare integration in GitHub repository settings
   - Go to: Repository Settings → Pages → Remove Cloudflare connection

2. **Option B**: Use `.cfignore` file (already added)
   - The `.cfignore` file tells Cloudflare Pages to ignore `worker.js`

3. **Option C**: Keep as-is (recommended)
   - The failed builds don't affect your website
   - GitHub Pages deployment continues to work perfectly
   - Just ignore the Cloudflare Workers build notifications

## Current Status

✅ **Website is working perfectly** at https://taeyoon.kr  
✅ **Contact form is working** via Cloudflare Workers  
⚠️ **Cloudflare Workers auto-build fails** (this is expected and harmless)

---

**Note**: If you want to enable automatic Cloudflare Workers deployment from GitHub, see `DEPLOYMENT_GUIDE.md` for full setup instructions.
