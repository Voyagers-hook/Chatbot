import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Keywords for figuring out what product type the user is asking about
const TYPE_KEYWORDS = {
  rod: ['rod', 'rods'],
  reel: ['reel', 'reels', 'baitrunner', 'baitcaster', 'spinning reel', 'match reel', 'centrepin'],
  bait: ['bait', 'boilie', 'boilies', 'pellet', 'pellets', 'groundbait', 'particle', 'hemp', 'corn',
         'sweetcorn', 'maggot', 'worm', 'pop-up', 'popup', 'hookbait', 'method mix'],
  hook: ['hook', 'hooks', 'hooklink', 'hair rig'],
  line: ['line', 'braid', 'mono', 'monofilament', 'fluorocarbon', 'fluoro'],
  feeder: ['feeder', 'method feeder', 'cage feeder', 'open end feeder'],
  lure: ['lure', 'lures', 'spinner', 'spoon', 'soft bait', 'jig', 'jig head', 'wobbler', 'crankbait',
         'shad', 'twister', 'dropshot'],
  net: ['net', 'landing net', 'pan net'],
  float: ['float', 'floats', 'waggler', 'stick float', 'pellet waggler'],
  weight: ['weight', 'sinker', 'lead', 'ledger', 'shot'],
  swivel: ['swivel', 'snap link'],
  alarm: ['alarm', 'bite alarm'],
  bag: ['bag', 'holdall', 'rucksack', 'backpack'],
  shelter: ['bivvy', 'brolly', 'tent', 'shelter'],
  seating: ['chair', 'bed chair', 'bedchair', 'seat box'],
  tackle_box: ['tackle box', 'tackle bag', 'lure box']
};

const STYLE_KEYWORDS = {
  carp: ['carp'],
  coarse: ['coarse', 'feeder', 'match', 'float', 'waggler', 'pole', 'roach', 'bream', 'tench', 'barbel', 'chub'],
  lrf: ['lrf', 'light rock', 'ultralight', 'ultra light', 'ultra-light', 'bfs', 'finesse', 'wrasse', 'pollack'],
  predator: ['predator', 'pike', 'perch', 'spinning', 'lure fishing', 'bass', 'jerk', 'zander'],
  fly: ['fly fishing', 'fly rod', 'fly reel'],
  sea: ['sea', 'beach', 'mackerel', 'cod fishing']
};

const BRANDS = ['mikado', 'maver', 'fjuka', 'crafty catcher', 'shakespeare', 'spro', 'sonik',
                'wychwood', 'ngt', 'leeda', 'rapture', 'kamasan', 'gamakatsu', 'ringers',
                'copdock', 'dinsmore', 'zebco', 'saber'];

function analyseQuery(query) {
  const q = query.toLowerCase();
  const types = [];
  const styles = [];
  const brandsRequested = [];

  for (const [t, words] of Object.entries(TYPE_KEYWORDS)) {
    if (words.some(w => q.includes(w))) types.push(t);
  }
  for (const [s, words] of Object.entries(STYLE_KEYWORDS)) {
    if (words.some(w => q.includes(w))) styles.push(s);
  }
  for (const b of BRANDS) {
    if (q.includes(b)) brandsRequested.push(b);
  }

  // Budget hints
  let maxPrice = null;
  const m1 = q.match(/(?:under|less than|below|max|up to|<)\s*£?(\d+)/);
  if (m1) maxPrice = parseInt(m1[1]);
  const m2 = q.match(/£(\d+)\s*(?:budget|max|or less)/);
  if (m2) maxPrice = parseInt(m2[1]);

  return { types, styles, brandsRequested, maxPrice };
}

export async function findRelevantProducts(query, limit = 8) {
  const { types, styles, brandsRequested, maxPrice } = analyseQuery(query);

  // No clear product intent → don't waste a Supabase call
  if (types.length === 0 && styles.length === 0 && brandsRequested.length === 0) {
    return [];
  }

  try {
    // Pull joined data: rich chatbot knowledge + live price/stock from
    // the inventory sync manager
    let q = supabase
      .from('chatbot_product_knowledge')
      .select(`
        product_id, full_description, brand, fishing_styles, product_types,
        product_url, image_url, categories, tags,
        products!inner(
          id, name, active,
          channel_listings(channel_price, sq_sale_price, sq_on_sale, channel_product_id),
          inventory(total_stock)
        )
      `)
      .eq('products.active', true);

    // Build OR conditions for type/style matching against product_types and fishing_styles columns
    const orConditions = [];
    for (const t of types) {
      orConditions.push(`product_types.ilike.%${t}%`);
      orConditions.push(`search_text.ilike.%${t}%`);
    }
    for (const s of styles) {
      orConditions.push(`fishing_styles.ilike.%${s}%`);
    }
    for (const b of brandsRequested) {
      orConditions.push(`brand.ilike.%${b}%`);
    }

    if (orConditions.length > 0) {
      q = q.or(orConditions.join(','));
    }

    q = q.limit(limit * 4);
    const { data, error } = await q;
    if (error) {
      console.error('Supabase query error:', error);
      return [];
    }

    // Score and filter
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

        // Compute a relevance score — more matches in product_types and fishing_styles = higher
        let score = 0;
        const productTypes = (r.product_types || '').toLowerCase();
        const productStyles = (r.fishing_styles || '').toLowerCase();
        const productBrand = (r.brand || '').toLowerCase();
        const productName = (p.name || '').toLowerCase();

        for (const t of types) {
          if (productTypes.includes(t)) score += 10;
          if (productName.includes(t)) score += 5;
        }
        for (const s of styles) {
          if (productStyles.includes(s)) score += 8;
          if (productName.includes(s)) score += 4;
        }
        for (const b of brandsRequested) {
          if (productBrand.includes(b)) score += 15;
        }

        return {
          name: p.name,
          description: (r.full_description || '').slice(0, 200),
          brand: r.brand,
          fishing_styles: r.fishing_styles,
          product_types: r.product_types,
          price,
          wasPrice,
          stock,
          score,
          url: r.product_url || (listing.channel_product_id
            ? `https://www.voyagershook.com/product/${listing.channel_product_id}`
            : 'https://www.voyagershook.com'),
          image_url: r.image_url
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score || a.price - b.price)
      .slice(0, limit);

    return scored;
  } catch (e) {
    console.error('Product search failed:', e);
    return [];
  }
}

export function formatProductsForContext(products) {
  if (!products || products.length === 0) return '';
  const lines = products.map(p => {
    const priceStr = p.wasPrice
      ? `£${p.price.toFixed(2)} (was £${p.wasPrice.toFixed(2)})`
      : `£${p.price.toFixed(2)}`;
    const brandPart = p.brand ? ` [${p.brand}]` : '';
    const desc = p.description ? `\n  ${p.description}` : '';
    return `- ${p.name}${brandPart} — ${priceStr} — ${p.stock} in stock\n  URL: ${p.url}${desc}`;
  });
  return `\n\n## RELEVANT PRODUCTS FROM LIVE INVENTORY\n\nReal products in stock right now. Recommend ONLY from this list — never invent products or prices.\n\n${lines.join('\n\n')}\n\n---\n`;
}
