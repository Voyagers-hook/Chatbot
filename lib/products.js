import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Expanded keyword map — these are the words people actually use
const SEARCH_EXPANSIONS = {
  'pellet': ['pellet', 'pellets', 'halibut', 'fjuka', 'method', 'feeder pellet'],
  'pellets': ['pellet', 'pellets', 'halibut', 'fjuka', 'method', 'feeder pellet'],
  'boilie': ['boilie', 'boilies', 'pop-up', 'pop up', 'popup', 'crafty catcher'],
  'boilies': ['boilie', 'boilies', 'pop-up', 'pop up', 'popup', 'crafty catcher'],
  'bait': ['bait', 'boilie', 'pellet', 'pop-up', 'particle', 'groundbait', 'hookbait', 'fjuka', 'crafty'],
  'rod': ['rod', 'mikado', 'shakespeare', 'feeder rod', 'carp rod', 'lure rod', 'spinning rod', 'float rod'],
  'reel': ['reel', 'baitrunner', 'baitcaster', 'spinning reel', 'match reel'],
  'line': ['line', 'braid', 'mono', 'monofilament', 'fluorocarbon'],
  'hook': ['hook', 'hooks', 'kamasan', 'gamakatsu', 'hooklink', 'hook to nylon'],
  'feeder': ['feeder', 'method', 'cage feeder', 'open end'],
  'lure': ['lure', 'spinner', 'spoon', 'jig', 'soft bait', 'wobbler', 'crankbait', 'shad'],
  'net': ['net', 'landing net', 'pan net'],
  'float': ['float', 'waggler', 'stick float', 'pellet waggler'],
  'method': ['method', 'method feeder', 'method mix', 'pellet'],
  'carp': ['carp'],
  'tench': ['tench', 'method', 'particle'],
  'perch': ['perch', 'lure', 'drop shot', 'jig'],
  'pike': ['pike', 'wire trace', 'lure', 'jerk'],
  'pellet waggler': ['pellet', 'waggler', 'float'],
};

function expandKeywords(query) {
  const q = query.toLowerCase();
  const expansions = new Set();

  for (const [trigger, expanded] of Object.entries(SEARCH_EXPANSIONS)) {
    if (q.includes(trigger)) {
      expanded.forEach(e => expansions.add(e));
    }
  }

  // Also extract individual significant words from the query
  const words = q.match(/\b[a-z]{4,}\b/g) || [];
  const STOP = ['what', 'which', 'with', 'have', 'sell', 'best', 'should', 'recommend', 'looking', 'fishing', 'need'];
  for (const w of words) {
    if (!STOP.includes(w) && w.length >= 4) expansions.add(w);
  }

  return [...expansions];
}

function extractBudget(query) {
  const m = query.match(/(?:under|less than|below|max|up to|<)\s*£?(\d+)/i);
  if (m) return parseInt(m[1]);
  const m2 = query.match(/£(\d+)\s*(?:budget|max|or less)/i);
  if (m2) return parseInt(m2[1]);
  return null;
}

export async function findRelevantProducts(query, limit = 6) {
  const keywords = expandKeywords(query);
  const maxPrice = extractBudget(query);

  if (keywords.length === 0) return [];

  try {
    // Build a Supabase OR search across multiple fields
    const orConditions = [];
    for (const kw of keywords.slice(0, 8)) {
      // Search across product name AND the chatbot knowledge fields
      orConditions.push(`product_types.ilike.%${kw}%`);
      orConditions.push(`fishing_styles.ilike.%${kw}%`);
      orConditions.push(`search_text.ilike.%${kw}%`);
      orConditions.push(`brand.ilike.%${kw}%`);
    }

    const { data, error } = await supabase
      .from('chatbot_product_knowledge')
      .select(`
        product_id, full_description, brand, fishing_styles, product_types,
        product_url, image_url,
        products!inner(
          id, name, active,
          channel_listings(channel_price, sq_sale_price, sq_on_sale, channel_product_id),
          inventory(total_stock)
        )
      `)
      .eq('products.active', true)
      .or(orConditions.join(','))
      .limit(40);

    if (error) {
      console.error('Knowledge search error:', error);
      return [];
    }

    // Also do a fallback search on the main products table (for items not yet in knowledge table)
    let fallbackProducts = [];
    if (!data || data.length < 3) {
      const nameConditions = keywords.slice(0, 4).map(kw => `name.ilike.%${kw}%`).join(',');
      const { data: fb } = await supabase
        .from('products')
        .select(`
          id, name,
          channel_listings(channel_price, sq_sale_price, sq_on_sale, channel_product_id),
          inventory(total_stock)
        `)
        .eq('active', true)
        .or(nameConditions)
        .limit(20);
      fallbackProducts = fb || [];
    }

    // Score and filter knowledge-table results
    const scored = (data || [])
      .map(r => {
        const p = r.products;
        if (!p) return null;
        const listing = p.channel_listings?.find(l => l.channel_price > 0) || p.channel_listings?.[0];
        if (!listing) return null;
        const basePrice = parseFloat(listing.channel_price) || 0;
        const salePrice = parseFloat(listing.sq_sale_price) || 0;
        const price = listing.sq_on_sale && salePrice > 0 ? salePrice : basePrice;
        const wasPrice = listing.sq_on_sale && salePrice > 0 ? basePrice : null;
        const stock = (p.inventory || []).reduce((s, i) => s + (parseInt(i.total_stock) || 0), 0);
        if (stock <= 0 || price <= 0) return null;
        if (maxPrice && price > maxPrice) return null;

        let score = 0;
        const text = `${p.name} ${r.product_types || ''} ${r.fishing_styles || ''} ${r.brand || ''}`.toLowerCase();
        for (const kw of keywords) {
          if (text.includes(kw)) score += 5;
          if ((r.product_types || '').toLowerCase().includes(kw)) score += 8;
        }

        return {
          id: p.id,
          name: p.name,
          brand: r.brand || '',
          shortDesc: shortenDescription(r.full_description, p.name),
          price,
          wasPrice,
          stock,
          score,
          url: r.product_url || (listing.channel_product_id
            ? `https://www.voyagershook.com/product/${listing.channel_product_id}`
            : 'https://www.voyagershook.com'),
          image_url: r.image_url || null
        };
      })
      .filter(Boolean);

    // Add fallback products (lower score)
    const knowledgeIds = new Set(scored.map(s => s.id));
    for (const p of fallbackProducts) {
      if (knowledgeIds.has(p.id)) continue;
      const listing = p.channel_listings?.find(l => l.channel_price > 0) || p.channel_listings?.[0];
      if (!listing) continue;
      const basePrice = parseFloat(listing.channel_price) || 0;
      const salePrice = parseFloat(listing.sq_sale_price) || 0;
      const price = listing.sq_on_sale && salePrice > 0 ? salePrice : basePrice;
      const wasPrice = listing.sq_on_sale && salePrice > 0 ? basePrice : null;
      const stock = (p.inventory || []).reduce((s, i) => s + (parseInt(i.total_stock) || 0), 0);
      if (stock <= 0 || price <= 0) continue;
      if (maxPrice && price > maxPrice) continue;

      scored.push({
        id: p.id,
        name: p.name,
        brand: '',
        shortDesc: '',
        price,
        wasPrice,
        stock,
        score: 1,
        url: listing.channel_product_id
          ? `https://www.voyagershook.com/product/${listing.channel_product_id}`
          : 'https://www.voyagershook.com',
        image_url: null
      });
    }

    return scored
      .sort((a, b) => b.score - a.score || a.price - b.price)
      .slice(0, limit);
  } catch (e) {
    console.error('Product search failed:', e);
    return [];
  }
}

function shortenDescription(desc, name) {
  if (!desc) return '';
  const cleaned = desc.replace(/\s+/g, ' ').trim();
  const sentence = cleaned.split(/[.!?]/)[0];
  return (sentence || cleaned).slice(0, 80);
}

// Returns a MINIMAL context for Claude — just product names and brands.
// Full details (image, price, link) are shown to the user as cards, NOT pasted as text.
export function formatProductsForContext(products) {
  if (!products || products.length === 0) return '';
  const lines = products.map(p => {
    const brand = p.brand ? ` (${p.brand})` : '';
    return `- ${p.name}${brand}`;
  });
  return `\n\n## RELEVANT PRODUCTS FROM LIVE INVENTORY\n\nThese are real products in stock. Recommend by name only — the customer sees full details (image, price, link) as cards below your message. Do NOT paste descriptions, prices or URLs in your reply.\n\n${lines.join('\n')}\n\n---\n`;
}
