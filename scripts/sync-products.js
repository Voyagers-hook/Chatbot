/**
 * Voyager's Hook — Chatbot Product Sync
 *
 * This script populates the chatbot_product_knowledge table with rich product
 * data. It can be run in two modes:
 *
 *   1. CSV mode: node scripts/sync-products.js --csv=./products.csv
 *      Reads a Squarespace product export CSV. Use this for the initial backfill
 *      or whenever you want to refresh from a fresh export.
 *
 *   2. Squarespace API mode: node scripts/sync-products.js
 *      Pulls live data from Squarespace. This is what the cron job uses.
 *      (Requires SQUARESPACE_API_KEY env var.)
 *
 * The script matches products by name to the existing `products` table
 * (managed by the inventory sync manager) and only updates the new
 * chatbot_product_knowledge table. It NEVER modifies the products table itself.
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { parse } from 'csv-parse/sync';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

// ─── Enrichment helpers ──────────────────────────────────────────────────────

function cleanHtml(s) {
  if (!s) return '';
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractBrand(categories, title) {
  if (categories) {
    const m = categories.toLowerCase().match(/\/brands?\/([^,/\s]+)/);
    if (m) return m[1].replace(/-/g, ' ');
  }
  const brands = [
    'mikado','maver','fjuka','crafty catcher','shakespeare','spro','sonik',
    'wychwood','ngt','leeda','rapture','kamasan','gamakatsu','ringers',
    'copdock','dinsmore','zebco','saber','sog','soto','nextool','wildo',
    'outwell','easy camp','robens','antonini','maxpedition','voyagers hook',
    'cling','spike','oakwood','peg no','castaway','west country leads',
    'eco sinkers','kodex','jaws','fladen'
  ];
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
  if (/knife|knives/.test(text)) types.add('knife');
  if (/torch|head torch|lantern/.test(text)) types.add('lighting');
  if (text.includes('glove')) types.add('clothing');
  if (/tackle box|tackle bag/.test(text)) types.add('tackle_box');
  if (text.includes('lead clip')) types.add('rig');
  if (/mat|unhooking/.test(text)) types.add('care');
  if (/multi tool|multitool/.test(text)) types.add('tool');
  if (/stove|cookware|dinnerware|pot|pan|kettle/.test(text)) types.add('cookware');
  return [...types].sort().join(', ');
}

function enrichProduct(p) {
  const title = (p.Title || p.name || '').trim();
  if (!title) return null;

  const description = cleanHtml(p.Description || p.description || '').slice(0, 2000);
  const categories = (p.Categories || '').slice(0, 500);
  const tags = (p.Tags || '').slice(0, 500);
  const productUrl = p['Product URL']
    ? `https://www.voyagershook.com/${p['Product URL']}`
    : '';
  const imageUrl = p['Hosted Image URLs']
    ? p['Hosted Image URLs'].split(/\s+/)[0]
    : '';

  const brand = extractBrand(categories, title);
  const fishing_styles = extractFishingStyles(categories, tags, title);
  const product_types = extractProductTypes(categories, tags, title);
  const search_text = [title, description, categories, tags, brand, fishing_styles, product_types]
    .filter(Boolean).join(' ').slice(0, 3000);

  return {
    title,
    full_description: description,
    categories,
    tags,
    product_url: productUrl,
    image_url: imageUrl,
    brand,
    fishing_styles,
    product_types,
    search_text
  };
}

// ─── CSV mode ────────────────────────────────────────────────────────────────

async function syncFromCsv(csvPath) {
  const raw = readFileSync(csvPath, 'utf-8');
  const rows = parse(raw, { columns: true, skip_empty_lines: true });

  // Deduplicate by title (CSV has one row per variant)
  const byTitle = new Map();
  for (const r of rows) {
    const title = (r.Title || '').trim();
    if (!title || byTitle.has(title)) continue;
    byTitle.set(title, r);
  }

  console.log(`📦 ${byTitle.size} unique products in CSV`);

  // Enrich
  const enriched = [...byTitle.values()].map(enrichProduct).filter(Boolean);
  console.log(`✨ Enriched ${enriched.length} products`);

  // Fetch existing products from Supabase to match by name
  const { data: existingProducts, error: pErr } = await supabase
    .from('products')
    .select('id, name')
    .eq('active', true);
  if (pErr) throw pErr;

  console.log(`🔍 ${existingProducts.length} active products in Supabase`);

  // Normalize for matching
  const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const productMap = new Map();
  for (const p of existingProducts) {
    if (p.name) productMap.set(norm(p.name), p.id);
  }

  // Match and prepare upserts
  const upserts = [];
  let matched = 0;
  let unmatched = 0;
  for (const e of enriched) {
    const productId = productMap.get(norm(e.title));
    if (productId) {
      matched++;
      const { title, ...rest } = e;
      upserts.push({ product_id: productId, ...rest });
    } else {
      unmatched++;
    }
  }

  console.log(`✅ Matched: ${matched}, ❌ Unmatched: ${unmatched}`);

  // Upsert in batches of 100
  let success = 0;
  for (let i = 0; i < upserts.length; i += 100) {
    const batch = upserts.slice(i, i + 100);
    const { error } = await supabase
      .from('chatbot_product_knowledge')
      .upsert(batch, { onConflict: 'product_id' });
    if (error) {
      console.error(`❌ Batch ${i / 100 + 1} failed:`, error.message);
    } else {
      success += batch.length;
      console.log(`✅ Synced batch ${i / 100 + 1} (${success}/${upserts.length})`);
    }
  }

  console.log(`\n🎉 Done — ${success} products in chatbot knowledge base`);
}

// ─── Squarespace API mode (for cron) ─────────────────────────────────────────

async function syncFromSquarespaceAPI() {
  const apiKey = process.env.SQUARESPACE_API_KEY;
  if (!apiKey) {
    console.error('❌ SQUARESPACE_API_KEY env var not set');
    process.exit(1);
  }

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

  console.log(`📦 Fetched ${allProducts.length} products from Squarespace API`);

  // Transform Squarespace format → our enrichment input
  const transformed = allProducts.map(p => ({
    Title: p.name,
    Description: p.description,
    Categories: (p.categories || []).map(c => `/${c}`).join(', '),
    Tags: (p.tags || []).join(', '),
    'Product URL': p.urlSlug,
    'Hosted Image URLs': (p.images || []).map(i => i.url).join(' ')
  }));

  const enriched = transformed.map(enrichProduct).filter(Boolean);

  // Same matching logic as CSV mode
  const { data: existingProducts } = await supabase
    .from('products').select('id, name').eq('active', true);
  const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const productMap = new Map(existingProducts.map(p => [norm(p.name || ''), p.id]));

  const upserts = enriched
    .map(e => {
      const productId = productMap.get(norm(e.title));
      if (!productId) return null;
      const { title, ...rest } = e;
      return { product_id: productId, ...rest };
    })
    .filter(Boolean);

  console.log(`✅ Matched ${upserts.length} products`);

  for (let i = 0; i < upserts.length; i += 100) {
    const batch = upserts.slice(i, i + 100);
    await supabase.from('chatbot_product_knowledge').upsert(batch, { onConflict: 'product_id' });
  }

  console.log(`🎉 Synced ${upserts.length} products`);
  return upserts.length;
}

// ─── Entry point ─────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const csvArg = args.find(a => a.startsWith('--csv='));

if (csvArg) {
  syncFromCsv(csvArg.replace('--csv=', '')).catch(e => { console.error(e); process.exit(1); });
} else {
  syncFromSquarespaceAPI().catch(e => { console.error(e); process.exit(1); });
}
