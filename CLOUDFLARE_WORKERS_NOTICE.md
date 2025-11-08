# ⚡ Cloudflare Workers Auto-Deployment Setup

## Current Setup

This project uses **GitHub auto-deployment** to Cloudflare Workers via Cloudflare Pages integration.

### 1. 🌐 Static Website (GitHub Pages)
- **Files**: `index.html`, `styles.css`, `script.js`, etc.
- **Deployed to**: GitHub Pages at `https://taeyoon.kr`
- **Build**: Automatic via GitHub Actions ✅

### 2. ⚡ Serverless Function (Cloudflare Workers)
- **File**: `worker.js`
- **Deployed to**: Cloudflare Workers at `https://contact.taeyoon.kr`
- **Build**: Automatic via Cloudflare Pages integration ✅
- **Config**: `wrangler.jsonc`

## Required: Environment Variables

The Worker needs these **secret environment variables** to be configured in Cloudflare Dashboard:

### 📝 How to Add Environment Variables

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Navigate to: **Workers & Pages** → **contact-form** → **Settings** → **Variables**
3. Add the following variables:

#### Required Variables:

**1. TURNSTILE_SECRET**
```
Name: TURNSTILE_SECRET
Value: [Your Cloudflare Turnstile Secret Key]
Type: Encrypted ✅
```
- Get from: https://dash.cloudflare.com → Turnstile → Your Site → Secret Key

**2. RESEND_API_KEY**
```
Name: RESEND_API_KEY
Value: [Your Resend API Key starting with 're_']
Type: Encrypted ✅
```
- Get from: https://resend.com/api-keys

**3. ALLOWED_ORIGIN** (Optional, already in wrangler.jsonc)
```
Name: ALLOWED_ORIGIN
Value: https://taeyoon.kr
Type: Plain text
```

### ⚠️ Important Notes

- **Never commit these secrets to Git!** They are only stored in Cloudflare Dashboard
- Environment variables are **encrypted** in Cloudflare
- The auto-deployment will work once these variables are set

## How Auto-Deployment Works

1. **Push to GitHub** → Code is pushed to `main` branch
2. **Cloudflare Detects** → Cloudflare Pages integration triggers build
3. **Build Process** → Runs `npx wrangler deploy` using `wrangler.jsonc` config
4. **Deploy Worker** → Deploys `worker.js` to Cloudflare Workers
5. **Live!** → Contact form is updated at `https://contact.taeyoon.kr`

## Current Status

✅ **Website is working perfectly** at https://taeyoon.kr  
✅ **Contact form auto-deployment enabled** via Cloudflare Pages  
✅ **Configuration file added**: `wrangler.jsonc`  
⚠️ **Action Required**: Add environment variables in Cloudflare Dashboard

---

## 📚 Additional Resources

- Full deployment guide: `DEPLOYMENT_GUIDE.md`
- Quick setup: `QUICK_DEPLOY.md`
- Security guidelines: `SECURITY.md`
