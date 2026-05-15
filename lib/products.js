import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const SEARCH_EXPANSIONS = {
  // Bait
  'pellet': ['pellet', 'halibut', 'fjuka', 'coppens', 'method'],
  'pellets': ['pellet', 'halibut', 'fjuka', 'coppens', 'method'],
  'halibut': ['halibut', 'pellet', 'coppens', 'oily'],
  'boilie': ['boilie', 'crafty catcher', 'pop-up', 'shelf life'],
  'boilies': ['boilie', 'crafty catcher', 'pop-up', 'shelf life'],
  'pop-up': ['pop-up', 'popup', 'boilie', 'hookbait'],
  'popup': ['pop-up', 'popup', 'boilie', 'hookbait'],
  'particle': ['particle', 'hemp', 'corn', 'tigernut', 'crafty catcher'],
  'groundbait': ['groundbait', 'ground bait', 'method mix', 'sweet'],
  'hookbait': ['hookbait', 'pop-up', 'boilie', 'fatboys', 'fjuka'],
  'fatboys': ['fatboys', 'fjuka', 'hookbait'],
  'fjuka': ['fjuka', 'pellet', 'sensate', 'squeeze'],

  // Tackle
  'rod': ['rod', 'mikado', 'shakespeare', 'maver'],
  'reel': ['reel', 'baitrunner', 'baitcaster'],
  'line': ['line', 'braid', 'mono', 'fluorocarbon'],
  'hook': ['hook', 'kamasan', 'gamakatsu', 'hooklink'],
  'feeder': ['feeder', 'method', 'cage feeder'],
  'lure': ['lure', 'spinner', 'spoon', 'jig', 'soft bait', 'shad'],
  'net': ['net', 'landing'],
  'float': ['float', 'waggler', 'stick'],
  'alarm': ['alarm', 'bite alarm'],
  'swivel': ['swivel', 'snap link'],
  'weight': ['weight', 'lead', 'sinker'],

  // Techniques
  'method': ['method', 'method feeder', 'pellet', 'groundbait'],
  'method feeder': ['method', 'feeder', 'pellet', 'groundbait'],
  'pellet waggler': ['waggler', 'float', 'pellet'],
  'drop shot': ['drop shot', 'dropshot', 'lure'],

  // Species
  'carp': ['carp', 'boilie', 'pellet'],
  'tench': ['tench', 'method', 'particle', 'pellet'],
  'perch': ['perch', 'lure', 'drop shot', 'jig'],
  'pike': ['pike', 'wire trace', 'lure', 'jerk'],
  'bream': ['bream', 'groundbait', 'maggot'],
  'barbel': ['barbel', 'pellet', 'meat'],

  // Brands
  'crafty catcher': ['crafty catcher', 'boilie', 'particle'],
  'coppens': ['coppens', 'pellet', 'halibut'],
  'mikado': ['mikado', 'rod'],
  'maver': ['maver', 'rod'],
};

function expandKeywords(query) {
  const q = query.toLowerCase();
  const expansions = new Set();
  const STOP = new Set(['what', 'which', 'with', 'have', 'sell', 'best', 'should',
                        'recommend', 'looking', 'fishing', 'need', 'tell', 'about',
                        'show', 'give', 'find', 'sells', 'stock', 'good']);

  for (const [trigger, expanded] of Object.entries(SEARCH_EXPANSIONS)) {
    if (q.includes(trigger)) {
      expanded.forEach(e => expansions.add(e));
    }
  }

  const words = q.match(/\b[a-z]{4,}\b/g) || [];
  for (const w of words) {
    if (!STOP.has(w)) expansions.add(w);
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

/**
 * Critical function: figures out the ACTUAL USE of a product from its
 * name, description and tags. This stops Claude misusing products
 * (e.g. recommending hookbait as a feeder mix).
 */
function inferProductRole(name, desc, tags, types) {
  const text = `${name} ${desc} ${tags} ${types}`.toLowerCase();
  const roles = [];

  // ── BAIT ROLES (most prone to misuse) ──
  if (/pre.?drilled|drilled pellet|hair stop|hair rig pellet/.test(text)) {
    roles.push('HOOKBAIT (pre-drilled for hair rig — sits on the hook, not in the feeder)');
  } else if (/hookable|hook bait|hook pellet|fatboys|hook on/.test(text)) {
    roles.push('HOOKBAIT (designed to sit on the hook directly)');
  } else if (/method mix|method feeder mix|groundbait|ground bait/.test(text)) {
    roles.push('GROUNDBAIT (for packing into a feeder or balling in)');
  } else if (/method pellet|micro pellet|squeeze ready method|2mm|3mm method/.test(text)) {
    roles.push('METHOD FEEDER PELLETS (for packing the method feeder)');
  } else if (/pop.?up|popup/.test(text)) {
    roles.push('POP-UP HOOKBAIT (buoyant, sits above the lead)');
  } else if (/boilie/.test(text) && /shelf|frozen/.test(text)) {
    roles.push('BOILIES (can be used on hair rig OR as freebies)');
  } else if (/boilie/.test(text)) {
    roles.push('BOILIES (carp bait — hair rig or freebies)');
  } else if (/particle|hemp|tiger nut|tigernut|sweetcorn|maize/.test(text)) {
    roles.push('PARTICLE BAIT (loose feed or PVA bag content)');
  } else if (/pva mesh|pva bag|pva tape|dissolving/.test(text)) {
    roles.push('PVA PRODUCT (rig delivery / bait wrapping)');
  } else if (/liquid|booster|attractant|sensate|accelerant|dip/.test(text)) {
    roles.push('BAIT ADDITIVE / LIQUID (boosts attraction, soak baits)');
  } else if (/maggot|caster|worm/.test(text)) {
    roles.push('LIVE / NATURAL BAIT');
  }

  // ── TACKLE ROLES ──
  if (/carp rod|specimen rod/.test(text)) roles.push('CARP ROD');
  else if (/feeder rod/.test(text)) roles.push('FEEDER ROD (quivertip rod for feeder fishing)');
  else if (/float rod|match rod|waggler rod/.test(text)) roles.push('FLOAT ROD');
  else if (/spinning rod|lure rod|predator rod/.test(text)) roles.push('SPINNING / LURE ROD');
  else if (/lrf rod|ultralight rod|ultra.light rod/.test(text)) roles.push('LRF / ULTRALIGHT ROD');
  else if (/\brod\b/.test(text) && !roles.some(r => r.includes('ROD'))) roles.push('FISHING ROD');

  if (/baitrunner|free spool/.test(text)) roles.push('BAITRUNNER REEL (carp fishing)');
  else if (/baitcaster|bait caster/.test(text)) roles.push('BAITCASTER REEL (lure fishing)');
  else if (/spinning reel|fixed spool/.test(text)) roles.push('SPINNING REEL');
  else if (/reel/.test(text) && !roles.some(r => r.includes('REEL'))) roles.push('FISHING REEL');

  if (/method feeder|flatbed feeder/.test(text) && !roles.some(r => r.includes('FEEDER'))) {
    roles.push('METHOD FEEDER (terminal tackle)');
  } else if (/cage feeder/.test(text)) roles.push('CAGE FEEDER (terminal tackle)');
  else if (/open end feeder/.test(text)) roles.push('OPEN-END FEEDER (terminal tackle)');

  if (/landing net|pan net|specimen net/.test(text)) roles.push('LANDING NET');
  if (/bite alarm/.test(text)) roles.push('BITE ALARM');
  if (/wire trace/.test(text)) roles.push('WIRE TRACE (for pike / toothy predators)');
  if (/lead clip|safety clip/.test(text)) roles.push('LEAD CLIP (terminal rig component)');
  if (/braid/.test(text) && /line|main/.test(text)) roles.push('BRAID MAINLINE');
  if (/fluorocarbon|fluoro/.test(text) && /line|leader/.test(text)) roles.push('FLUOROCARBON LINE / LEADER');
  if (/mono|monofilament/.test(text) && /line|main/.test(text)) roles.push('MONO MAINLINE');

  return roles.join(' · ');
}

export async function findRelevantProducts(query, limit = 8) {
  const keywords = expandKeywords(query);
  const maxPrice = extractBudget(query);

  if (keywords.length === 0) return [];

  try {
    const orConditions = [];
    for (const kw of keywords.slice(0, 10)) {
      orConditions.push(`product_types.ilike.%${kw}%`);
      orConditions.push(`fishing_styles.ilike.%${kw}%`);
      orConditions.push(`search_text.ilike.%${kw}%`);
      orConditions.push(`brand.ilike.%${kw}%`);
    }

    const { data, error } = await supabase
      .from('chatbot_product_knowledge')
      .select(`
        product_id, full_description, brand, fishing_styles, product_types, tags,
        product_url, image_url,
        products!inner(
          id, name, active,
          channel_listings(channel_price, sq_sale_price, sq_on_sale, channel_product_id),
          inventory(total_stock)
        )
      `)
      .eq('products.active', true)
      .or(orConditions.join(','))
      .limit(50);

    if (error) {
      console.error('Knowledge search error:', error);
      return [];
    }

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
          if ((p.name || '').toLowerCase().includes(kw)) score += 10;
        }

        // Infer what this product is ACTUALLY for — critical for Claude
        const role = inferProductRole(p.name, r.full_description, r.tags, r.product_types);

        return {
          id: p.id,
          name: p.name,
          brand: r.brand || '',
          role,
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

    return scored
      .sort((a, b) => b.score - a.score || a.price - b.price)
      .slice(0, limit);
  } catch (e) {
    console.error('Product search failed:', e);
    return [];
  }
}

// Sends product NAME + USE ROLE to Claude. NEVER prices, URLs or full
// descriptions — those go to the customer as cards instead.
export function formatProductsForContext(products) {
  if (!products || products.length === 0) return '';
  const lines = products.map((p, i) => {
    const brand = p.brand ? ` (${p.brand})` : '';
    const role = p.role ? ` — ${p.role}` : '';
    return `${i + 1}. ${p.name}${brand}${role}`;
  });
  return `\n\n## RELEVANT PRODUCTS FROM LIVE INVENTORY

These real products are in stock. Each item shows what it's USED FOR after the dash — use this to recommend the right product for the customer's actual need. NEVER recommend a HOOKBAIT product as feeder mix, or a feeder product as hookbait.

Recommend by NAME ONLY. The customer sees full details (image, price, clickable link) as cards below your message — do NOT paste descriptions, prices or URLs in your reply.

${lines.join('\n')}

---
`;
}
