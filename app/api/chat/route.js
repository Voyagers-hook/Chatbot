import Anthropic from '@anthropic-ai/sdk';
import { SYSTEM_PROMPT } from '../../../lib/system-prompt';
import { findRelevantProducts, formatProductsForContext } from '../../../lib/products';

export const runtime = 'nodejs';
export const maxDuration = 30;

const rateLimits = new Map();
const RATE_LIMIT = 30;
const RATE_WINDOW = 60 * 60 * 1000;

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = rateLimits.get(ip) || { count: 0, reset: now + RATE_WINDOW };
  if (now > entry.reset) {
    entry.count = 0;
    entry.reset = now + RATE_WINDOW;
  }
  entry.count++;
  rateLimits.set(ip, entry);
  return entry.count <= RATE_LIMIT;
}

export async function POST(req) {
  try {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
    if (!checkRateLimit(ip)) {
      return Response.json(
        { error: "We're getting a lot of messages right now. Try again in a moment, or hit the WhatsApp button below." },
        { status: 429 }
      );
    }

    const { messages } = await req.json();
    if (!messages?.length) {
      return Response.json({ error: 'No messages provided' }, { status: 400 });
    }

    const lastUserMessage = [...messages].reverse().find(m => m.role === 'user')?.content || '';
    const products = await findRelevantProducts(lastUserMessage);
    const productContext = formatProductsForContext(products);

    const fullSystemPrompt = SYSTEM_PROMPT + productContext;

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 600,
      system: fullSystemPrompt,
      messages: messages.map(m => ({ role: m.role, content: m.content }))
    });

    const reply = response.content[0]?.type === 'text' ? response.content[0].text : '';

    // Determine which products to show as cards based on what Claude actually mentioned
    const replyLower = reply.toLowerCase();
    const mentionedProducts = products.filter(p => {
      const nameTokens = p.name.toLowerCase().split(/\s+/).filter(w => w.length > 3);
      // Show card if Claude mentioned at least 2 significant words from the name
      const matches = nameTokens.filter(t => replyLower.includes(t)).length;
      return matches >= 2 || replyLower.includes(p.brand?.toLowerCase());
    });

    // If Claude mentioned products but none matched, show top 3 anyway
    const cardsToShow = mentionedProducts.length > 0
      ? mentionedProducts.slice(0, 4)
      : (products.length > 0 && /recommend|suggest|i'd go with|try the/.test(replyLower)
          ? products.slice(0, 3)
          : []);

    return Response.json({
      reply,
      products: cardsToShow.map(p => ({
        name: p.name,
        price: p.price,
        wasPrice: p.wasPrice,
        url: p.url,
        image_url: p.image_url
      }))
    });

  } catch (error) {
    console.error('Chat API error:', error);
    return Response.json(
      { error: "Something went wrong on our end. Try again in a moment, or message us using the WhatsApp button below." },
      { status: 500 }
    );
  }
}

export async function OPTIONS() {
  return new Response(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}
