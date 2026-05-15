import Anthropic from '@anthropic-ai/sdk';
import { SYSTEM_PROMPT } from '../../../lib/system-prompt';
import { findRelevantProducts, formatProductsForContext } from '../../../lib/products';

export const runtime = 'nodejs';
export const maxDuration = 30;

// Simple per-IP rate limit
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
        { error: "We're getting a lot of messages right now! Please try again in a moment, or drop us a WhatsApp on 07397 244450." },
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
      model: 'claude-sonnet-4-6',
      max_tokens: 800,
      system: fullSystemPrompt,
      messages: messages.map(m => ({ role: m.role, content: m.content }))
    });

    const reply = response.content[0]?.type === 'text' ? response.content[0].text : '';

    return Response.json({
      reply,
      productsFound: products.length,
      products: products.slice(0, 4).map(p => ({
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
      { error: "Something went wrong on our end. Try again in a moment, or message us directly — Info@voyagershook.com or WhatsApp 07397 244450." },
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
