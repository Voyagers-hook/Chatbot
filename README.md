# Voyager's Hook — AI Chat

AI-powered customer chat for voyagershook.com. Powered by Claude Sonnet 4.6, connected live to your Supabase inventory, with rich product knowledge pulled from your Squarespace catalogue.

## What it does

- Friendly local-expert chat tone — answers angling questions naturally (knots, rigs, bait theory, species advice)
- Recommends real products with live prices, stock and images
- Promotes Hook Club membership when natural
- Suggests Bundle Builder when buying multiple items
- Hands off to Email/WhatsApp only when it genuinely can't help
- Conversation context is sent through to email/WhatsApp on handoff
- Mobile-friendly (slide-up bottom sheet)
- Rate-limited at 30 messages per IP per hour

## Architecture

```
Squarespace shop
    ↓
Inventory sync manager → products table (prices, stock, names)
                        ↓
                        chatbot_product_knowledge table ← cron job pulls rich content from Squarespace API every 6h
                        ↓
                        Chat API route (Claude Sonnet) reads both
                        ↓
                        Chat widget renders on voyagershook.com via iframe
```

## Deployment steps

### 1. Push these files to your GitHub repo

Replace everything in your existing repo with this project, commit, and push. Vercel will redeploy automatically.

### 2. Set environment variables in Vercel

Project → Settings → Environment Variables. Add:

| Variable | Value |
|----------|-------|
| `ANTHROPIC_API_KEY` | Your new Anthropic key |
| `SUPABASE_URL` | `https://czoppjnkjxmduldxlbqh.supabase.co` |
| `SUPABASE_ANON_KEY` | `sb_publishable_4jv4iG0QDwFoolVMQ5zqqA_W49a2oh5` |
| `SUPABASE_SERVICE_ROLE_KEY` | Get from Supabase → Settings → API → service_role |
| `SEED_SECRET` | Any random string (e.g. `vh-seed-2026-x7k9`) |
| `CRON_SECRET` | Any random string — Vercel uses this for cron auth |
| `SQUARESPACE_API_KEY` | Get from Squarespace → Settings → Advanced → Developer API Keys (Products: Read scope) |

### 3. Run the one-time seed

Once deployed, visit this URL in your browser to load 302 products into the chatbot:

```
https://YOUR-VERCEL-URL.vercel.app/api/seed?secret=YOUR_SEED_SECRET
```

You should see a JSON response showing matched and synced counts. Run this once.

### 4. Test the chat

Visit `https://YOUR-VERCEL-URL.vercel.app/embed`

Ask it questions like:
- "I'm new to fishing, where should I start?"
- "What's the best bait for carp at the moment?"
- "How do I tie a Palomar knot?"
- "Recommend a lightweight lure rod under £60"

### 5. Embed on Squarespace

Replace your existing chat widget in Squarespace → Settings → Advanced → Code Injection → Footer with:

```html
<iframe
  src="https://YOUR-VERCEL-URL.vercel.app/embed"
  style="position:fixed;bottom:0;left:0;width:100%;height:100%;border:0;pointer-events:none;z-index:999996;background:transparent;"
  allowtransparency="true"
  scrolling="no"
  id="voyagers-chat-frame"
></iframe>
<script>
  document.getElementById('voyagers-chat-frame').onload = function() {
    this.style.pointerEvents = 'auto';
  };
</script>
```

## Auto-sync (new products appear automatically)

Once `SQUARESPACE_API_KEY` is set, Vercel runs `/api/cron/sync` every 6 hours, pulling fresh products from Squarespace and updating the chatbot knowledge base. New products you add appear in the chat within hours, no manual work.

You can also trigger a manual sync by calling:
```
curl https://YOUR-VERCEL-URL.vercel.app/api/cron/sync \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```

## Files

```
app/
  api/
    chat/route.js          ← Chat API (Claude Sonnet 4.6)
    cron/sync/route.js     ← Scheduled product sync (every 6h)
    seed/route.js          ← One-time backfill from bundled JSON
  embed/page.js            ← The page Squarespace iframes
  page.js                  ← Setup info page (you can ignore)
  layout.js                ← Root layout

components/
  ChatWidget.js            ← The chat UI

lib/
  system-prompt.js         ← The chatbot's brain — EDIT THIS to tune behaviour
  products.js              ← Smart product search

scripts/
  sync-products.js         ← Manual CSV sync (optional)
  seed-data.json           ← Bundled product data for one-time seeding
```

## Cost

- Chat per message: ~£0.003 with Claude Sonnet 4.6
- At 5 customers × 5 messages a day → ~£2.25/month
- Supabase queries: free tier
- Vercel hosting: free tier
- Vercel cron job: free tier

## Customising the chatbot

The chatbot's personality, tone, and behaviour all live in `lib/system-prompt.js`. Edit it any time — push to GitHub, Vercel auto-redeploys, the chatbot's behaviour changes instantly. No code changes needed.

## What to do if it goes wrong

If the chatbot starts misbehaving or giving bad recommendations:

1. Check the cron sync ran successfully: visit `/api/cron/sync` with the auth header
2. Check products are loading: query Supabase `chatbot_product_knowledge` table
3. Tweak `lib/system-prompt.js` and push to GitHub for an instant redeploy
4. Worst case, just remove the iframe from Squarespace — your shop is unaffected
