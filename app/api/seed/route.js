/**
 * One-time seed endpoint to populate chatbot_product_knowledge from the
 * bundled seed-data.json. Call this once after deploying to load 302 products
 * with rich descriptions, brands, tags, images from the original CSV export.
 *
 * After this is done, the cron job at /api/cron/sync keeps everything fresh
 * automatically.
 *
 * Protected by SEED_SECRET — only callable if you know the secret.
 * Call: GET /api/seed?secret=YOUR_SEED_SECRET
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import path from 'path';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const providedSecret = searchParams.get('secret');

  if (!process.env.SEED_SECRET || providedSecret !== process.env.SEED_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
  );

  try {
    // Load bundled seed data
    const seedPath = path.join(process.cwd(), 'scripts', 'seed-data.json');
    const seedData = JSON.parse(readFileSync(seedPath, 'utf-8'));

    // Fetch existing products to match by name
    const { data: products, error: pErr } = await supabase
      .from('products')
      .select('id, name')
      .eq('active', true);

    if (pErr) throw pErr;

    const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const productMap = new Map(products.map(p => [norm(p.name), p.id]));

    // Build upserts
    const upserts = [];
    let unmatched = 0;
    for (const seed of seedData) {
      const productId = productMap.get(norm(seed.title));
      if (!productId) { unmatched++; continue; }
      upserts.push({
        product_id: productId,
        full_description: seed.description,
        categories: seed.categories,
        tags: seed.tags,
        product_url: seed.product_url,
        image_url: seed.image_url,
        brand: seed.brand,
        fishing_styles: seed.fishing_styles,
        product_types: seed.product_types,
        search_text: seed.search_text
      });
    }

    // Upsert in batches
    let synced = 0;
    const errors = [];
    for (let i = 0; i < upserts.length; i += 100) {
      const batch = upserts.slice(i, i + 100);
      const { error } = await supabase
        .from('chatbot_product_knowledge')
        .upsert(batch, { onConflict: 'product_id' });
      if (error) errors.push(error.message);
      else synced += batch.length;
    }

    return Response.json({
      success: true,
      seedRecords: seedData.length,
      matched: upserts.length,
      unmatched,
      synced,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
}
