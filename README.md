# Augustus — setup guide

Augustus is a personal assistant that remembers things about you and improves
based on your feedback. This folder is a ready-to-deploy website + app.

## What you need

1. A free [Vercel](https://vercel.com) account (sign up with GitHub or email).
2. A free [Anthropic Console](https://console.anthropic.com) account, with billing
   set up (pay-as-you-go — typically a few dollars a month for personal chat use).

## Step 1 — Get your API key

1. Go to https://console.anthropic.com
2. Sign up / log in.
3. Go to **Settings → Billing** and add a payment method (required even for small usage).
4. Go to **API Keys**, click **Create Key**, and copy it. It looks like `sk-ant-...`.
   Keep this private — never paste it into the website's code or share it.

## Step 2 — Deploy to Vercel

**Option A: No terminal, using the Vercel website**
1. Create a free GitHub account if you don't have one (https://github.com).
2. Create a new repository and upload this whole `augustus-app` folder to it.
3. Go to https://vercel.com/new, sign in, and import that GitHub repo.
4. Before deploying, click **Environment Variables** and add:
   - Name: `ANTHROPIC_API_KEY`
   - Value: *(paste the key from Step 1)*
5. Click **Deploy**. After a minute you'll get a live URL like `augustus-yourname.vercel.app`.

**Option B: Using a terminal**
```bash
npm install -g vercel
cd augustus-app
vercel
# follow the prompts, then:
vercel env add ANTHROPIC_API_KEY
# paste your key when asked
vercel --prod
```

## Step 3 — Install it like an app

Open your new URL on your phone:
- **iPhone (Safari):** tap Share → "Add to Home Screen"
- **Android (Chrome):** tap the menu (⋮) → "Install app" or "Add to Home Screen"

Augustus will now have his own icon and open full-screen, like a normal app.

## How memory works here

Everything Augustus learns is stored in your browser's local storage —
it's private to your device and browser, and isn't sent anywhere except to
Claude as part of generating responses. If you clear your browser data or
switch devices, Augustus starts fresh. (Want this stored in the cloud
instead, so it follows you across devices? That's a further upgrade —
just ask.)

## Costs

- Vercel hosting: free for personal projects on this scale.
- Anthropic API: pay-as-you-go, billed to the card on your Anthropic account.
  Casual daily chatting typically costs a few dollars a month, not more.

## Updating the app later

Edit the files in `public/` or `api/`, push to GitHub (if using Option A) or
run `vercel --prod` again (if using Option B), and the live site updates.
