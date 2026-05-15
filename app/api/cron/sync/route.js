/**
 * Vercel cron endpoint — automatically syncs the chatbot product knowledge
 * from Squarespace every 6 hours. Configured in vercel.json.
 *
 * This route is protected: only Vercel's cron runner can call it (via
 * the CRON_SECRET env var). New products added to your shop appear in the
 * chatbot within 6 hours, no buttons to press.
 */

import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const maxDuration = 60;

// Same enrichment helpers as the standalone script — duplicated here so
// the cron route is self-contained.
function cleanHtml(s) {
  if (!s) return '';
  return s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
}

function extractBrand(categories, title) {
  if (categories) {
    const m = categories.toLowerCase().match(/\/brands?\/([^,/\s]+)/);
    if (m) return m[1].replace(/-/g, ' ');
  }
  const brands = ['mikado','maver','fjuka','crafty catcher','shakespeare','spro','sonik','wychwood','ngt','leeda','rapture','kamasan','gamakatsu','ringers','copdock','dinsmore','zebco','saber','sog','soto','nextool','wildo','outwell','easy camp','robens','antonini','maxpedition','voyagers hook','cling','spike','oakwood','peg no','castaway','west country leads','eco sinkers','kodex','jaws','fladen'];
  const tl = title.toLowerCase();
  for (const b of brands) if (tl.includes(b)) return b;
  return '';
}

function extractFishingStyles(categories, tags, title) {
  const text = ((categories || '') + ' ' + (tags || '') + ' ' + title).toLowerCase();
  const styles = new Set();
  if (text.includes('carp')) styles.add('carp');
  if (/coarse|feeder|match|float|waggler|pole|roach|bream|tench|barbel/.test(text)) styles.add('coarse');
  if (/lrf|light rock|ultralight|ultra[- ]light|bfs|finesse|micro/.test(text)) styles.add('lrf');
  if (/predator|pike|perch|lure|spinning|spinner|bass|wire trace|jerk|jig head/.test(text)) styles.add('predator');
  if (text.includes('fly')) styles.add('fly');
  if (/sea|beach|mackerel|mackrel/.test(text)) styles.add('sea');
  return [...styles].sort().join(', ');
}

function extractProductTypes(categories, tags, title) {
  const text = ((categories || '') + ' ' + (tags || '') + ' ' + title).toLowerCase();
  const types = new Set();
  if (/\/rod|rods| rod\b/.test(text)) types.add('rod');
  if (/reel|baitrunner|baitcaster/.test(text)) types.add('reel');
  if (/boilie|pellet|groundbait|ground bait|particle|bait additive|hookbait|pop[- ]?up|sweet|bait booster/.test(text)) types.add('bait');
  if (/\/hook|hooks |hooker|hooklink|hook to nylon| hook /.test(text)) types.add('hook');
  if (/\bline\b|braid|\bmono\b|fluorocarbon|\/line/.test(text)) types.add('line');
  if (text.includes('feeder')) types.add('feeder');
  if (/lure|spinner|spoon|soft bait|\bjig\b|wobbler|crankbait|jerk|shad|twister/.test(text)) types.add('lure');
  if (text.includes('net')) types.add('net');
  if (/float |waggler|stick float|\/float/.test(text)) types.add('float');
  if (/weight|sinker|\blead\b|leads|ledger/.test(text)) types.add('weight');
  if (/swivel|snap link/.test(text)) types.add('swivel');
  if (text.includes('alarm')) types.add('alarm');
  if (/\bbag\b|holdall|rucksack|backpack/.test(text)) types.add('bag');
  if (/bivvy|brolly|tent|shelter/.test(text)) types.add('shelter');
  if (/chair|bed[- ]chair|bedchair|seat |seat box/.test(text)) types.add('seating');
  return [...types].sort().join(', ');
}

export async function GET(req) {
  // Verify it's actually Vercel calling us (not random internet traffic)
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
  );

  try {
    const apiKey = process.env.SQUARESPACE_API_KEY;
    if (!apiKey) {
      return Response.json({ error: 'SQUARESPACE_API_KEY not configured' }, { status: 500 });
    }

    // Fetch all products from Squarespace
    let allProducts = [];
    let cursor = null;
    do {
      const url = cursor
        ? `https://api.squarespace.com/1.0/commerce/products?cursor=${cursor}`
        : 'https://api.squarespace.com/1.0/commerce/products';
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${apiKey}`, 'User-Agent': 'voyagers-hook-chatbot' }
      });
      if (!res.ok) throw new Error(`Squarespace API: ${res.status}`);
      const data = await res.json();
      allProducts.push(...(data.products || []));
      cursor = data.pagination?.nextPageCursor;
    } while (cursor);

    // Get existing products from Supabase for matching
    const { data: existingProducts } = await supabase
      .from('products')
      .select('id, name')
      .eq('active', true);

    const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const productMap = new Map(existingProducts.map(p => [norm(p.name || ''), p.id]));

    // Enrich and match
    const upserts = [];
    for (const p of allProducts) {
      const title = (p.name || '').trim();
      if (!title) continue;
      const productId = productMap.get(norm(title));
      if (!productId) continue;

      const description = cleanHtml(p.description || '').slice(0, 2000);
      const categories = (p.categories || []).map(c => `/${c}`).join(', ').slice(0, 500);
      const tags = (p.tags || []).join(', ').slice(0, 500);
      const product_url = p.urlSlug ? `https://www.voyagershook.com/${p.urlSlug}` : '';
      const image_url = p.images?.[0]?.url || '';
      const brand = extractBrand(categories, title);
      const fishing_styles = extractFishingStyles(categories, tags, title);
      const product_types = extractProductTypes(categories, tags, title);

      upserts.push({
        product_id: productId,
        full_description: description,
        categories,
        tags,
        product_url,
        image_url,
        brand,
        fishing_styles,
        product_types,
        search_text: [title, description, categories, tags, brand, fishing_styles, product_types]
          .filter(Boolean).join(' ').slice(0, 3000)
      });
    }

    // Upsert in batches of 100
    let synced = 0;
    for (let i = 0; i < upserts.length; i += 100) {
      const batch = upserts.slice(i, i + 100);
      const { error } = await supabase
        .from('chatbot_product_knowledge')
        .upsert(batch, { onConflict: 'product_id' });
      if (!error) synced += batch.length;
    }

    return Response.json({
      success: true,
      fetched: allProducts.length,
      matched: upserts.length,
      synced,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
