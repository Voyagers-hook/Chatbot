'use client';
import { useState, useEffect, useRef } from 'react';

const SUGGESTED_STARTERS = [
  "I'm new to fishing, where do I start?",
  "Best bait for carp right now?",
  "How do I tie a hair rig?",
  "Tell me about the Hook Club"
];

export default function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [showHandoff, setShowHandoff] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (open && messages.length === 0) {
      const t = setTimeout(() => {
        setMessages([{
          role: 'assistant',
          content: "Hi there! Welcome to Voyager's Hook.\n\nI can help with gear recommendations, bait advice, rig tips, knot tying, the Hook Club — pretty much anything fishing-related. What can I help with today?"
        }]);
      }, 300);
      return () => clearTimeout(t);
    }
  }, [open]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  async function sendMessage(text) {
    const content = (text || input).trim();
    if (!content || loading) return;

    const newMessages = [...messages, { role: 'user', content }];
    setMessages(newMessages);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: newMessages })
      });
      const data = await res.json();

      if (data.error) {
        setMessages([...newMessages, { role: 'assistant', content: data.error, isError: true }]);
        setShowHandoff(true);
      } else {
        setMessages([...newMessages, {
          role: 'assistant',
          content: data.reply,
          products: data.products
        }]);
        // Show handoff buttons if reply suggests them
        const reply = data.reply.toLowerCase();
        if (reply.includes('info@voyagershook') || reply.includes('07397') || reply.includes('better with the team')) {
          setShowHandoff(true);
        }
      }
    } catch (e) {
      setMessages([...newMessages, {
        role: 'assistant',
        content: "Sorry, the chat hit a snag. Use the buttons below to message us directly.",
        isError: true
      }]);
      setShowHandoff(true);
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }

  function restart() {
    setMessages([]);
    setShowHandoff(false);
  }

  function sendHandoff(mode) {
    const summary = messages.map(m =>
      `${m.role === 'user' ? 'Me' : "Voyager's Hook"}: ${m.content.replace(/<[^>]+>/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')}`
    ).join('\n\n');
    const body = `Hi, I was chatting on your website and need some more help. Here's what we discussed so far:\n\n${summary}\n\n— Add anything else here —`;
    if (mode === 'email') {
      window.location.href = `mailto:Info@voyagershook.com?subject=Chat%20follow-up&body=${encodeURIComponent(body)}`;
    } else {
      window.open(`https://wa.me/447397244450?text=${encodeURIComponent(body)}`, '_blank');
    }
  }

  function renderMessage(content) {
    const html = content
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br>');
    return <span dangerouslySetInnerHTML={{ __html: html }} />;
  }

  return (
    <>
      <button
        className={`vh-launcher ${open ? 'hidden' : ''}`}
        onClick={() => setOpen(true)}
        aria-label="Open chat"
      >Chat to us</button>

      <div className={`vh-overlay ${open ? 'active' : ''}`} onClick={() => setOpen(false)} />

      <div className={`vh-wrapper ${open ? 'open' : ''}`}>
        <div className={`vh-panel ${open ? 'open-pop' : ''}`}>
          <div className="vh-logo" />
          <button className="vh-close" onClick={() => setOpen(false)} aria-label="Close">✕</button>

          <div className="vh-header">
            <div className="vh-header-title">How can we help today?</div>
            <div className="vh-header-sub">Ask anything — we usually reply in seconds</div>
          </div>

          <div className="vh-messages">
            {messages.map((m, i) => (
              <div key={i} className={`vh-msg ${m.role}`}>
                <div className={`vh-msg-bubble ${m.isError ? 'error' : ''}`}>
                  {renderMessage(m.content)}
                  {m.products && m.products.length > 0 && (
                    <div className="vh-products">
                      {m.products.map((p, j) => (
                        <a key={j} href={p.url} target="_blank" rel="noopener" className="vh-product-card">
                          {p.image_url && <img src={p.image_url} alt={p.name} loading="lazy" />}
                          <div className="vh-product-info">
                            <div className="vh-product-name">{p.name}</div>
                            <div className="vh-product-price">
                              {p.wasPrice && <span className="was">£{p.wasPrice.toFixed(2)}</span>}
                              £{p.price.toFixed(2)}
                            </div>
                          </div>
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {loading && (
              <div className="vh-msg assistant">
                <div className="vh-msg-bubble vh-typing-bubble">
                  <div className="vh-typing"><i></i><i></i><i></i></div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {messages.length === 1 && !loading && (
            <div className="vh-starters">
              {SUGGESTED_STARTERS.map(s => (
                <button key={s} className="vh-starter" onClick={() => sendMessage(s)}>{s}</button>
              ))}
            </div>
          )}

          {showHandoff && messages.length > 1 && !loading && (
            <div className="vh-handoff-row">
              <button className="vh-handoff-btn email" onClick={() => sendHandoff('email')}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 5L2 7"/></svg>
                Email us
              </button>
              <button className="vh-handoff-btn wa" onClick={() => sendHandoff('wa')}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M17.5 14.4c-.3-.1-1.8-.9-2.1-1s-.5-.1-.7.1-.8 1-.9 1.2-.3.2-.6.1c-.3-.1-1.3-.5-2.5-1.5-.9-.8-1.5-1.8-1.7-2.1-.2-.3 0-.5.1-.6l.4-.5c.1-.2.2-.3.3-.5.1-.2 0-.4 0-.5-.1-.1-.7-1.7-.9-2.3-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1.1 2.9 1.2 3.1c.1.2 2.1 3.2 5.1 4.5.7.3 1.3.5 1.7.6.7.2 1.4.2 1.9.1.6-.1 1.8-.7 2-1.4.2-.7.2-1.3.2-1.4-.1-.1-.3-.2-.6-.3M12 2C6.5 2 2 6.5 2 12c0 1.8.5 3.4 1.3 4.9L2 22l5.3-1.3c1.4.8 3 1.3 4.7 1.3 5.5 0 10-4.5 10-10S17.5 2 12 2"/></svg>
                WhatsApp
              </button>
            </div>
          )}

          <div className="vh-input-area">
            <div className="vh-input-wrap">
              <input
                ref={inputRef}
                type="text"
                className="vh-input"
                placeholder="Ask about rods, bait, knots, anything..."
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && sendMessage()}
                disabled={loading}
              />
              <button
                className="vh-send"
                onClick={() => sendMessage()}
                disabled={loading || !input.trim()}
                aria-label="Send"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4z"/></svg>
              </button>
            </div>
            {messages.length > 1 && (
              <button className="vh-restart" onClick={restart}>Start new chat</button>
            )}
          </div>
        </div>
      </div>

      <style jsx global>{`
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300..700&display=swap');

        :root {
          --vh-font: "Outfit", sans-serif;
          --vh-panel-bg: #262420;
          --vh-message-bg: #f8f6f1;
          --vh-cyan: #0497b2;
          --vh-cyan-light: #04b2d3;
          --vh-cyan-dark: #027a8a;
        }

        .vh-launcher {
          position: fixed; bottom: 20px; left: 20px;
          background: linear-gradient(180deg, #00c4cc 10%, #0097b2 100%);
          color: #fff; padding: 12px 26px; border-radius: 40px;
          font-size: 16px; font-weight: 600; cursor: pointer;
          font-family: var(--vh-font); border: none;
          z-index: 999996;
          box-shadow: 0 20px 15px rgba(0,0,0,0.25), inset 0 2px 3px rgba(255,255,255,0.8);
          transition: transform .15s ease, box-shadow .15s ease, background .3s ease;
        }
        .vh-launcher:hover {
          transform: translateY(2px);
          background: linear-gradient(180deg, #0097b2 0%, #00c4cc 100%);
        }
        .vh-launcher.hidden { display: none; }

        .vh-overlay {
          position: fixed; inset: 0;
          background: rgba(0,0,0,0.60);
          z-index: 999997; opacity: 0; pointer-events: none;
          transition: opacity .35s ease;
        }
        .vh-overlay.active {
          opacity: 1; pointer-events: auto;
          backdrop-filter: blur(5px);
        }

        .vh-wrapper {
          position: fixed; bottom: 20px; left: 20px;
          width: 380px; height: 620px;
          pointer-events: none; z-index: 999998;
        }
        .vh-panel {
          width: 100%; height: 100%;
          background: var(--vh-panel-bg);
          border-radius: 16px;
          display: none; opacity: 0; transform: translateY(45px);
          transition: opacity .35s ease, transform .35s ease;
          pointer-events: auto; position: relative;
          padding-top: 70px;
          box-sizing: border-box;
          font-family: var(--vh-font);
          flex-direction: column;
          overflow: visible;
        }
        .vh-wrapper.open .vh-panel { display: flex; }
        .vh-panel.open-pop {
          opacity: 1; transform: translateY(-6px);
          box-shadow:
            0 12px 18px rgba(255,255,255,0.50),
            0 6px 10px rgba(255,255,255,0.25),
            0 0 16px rgba(4,151,178,0.25);
        }

        .vh-logo {
          position: absolute; top: -45px; left: 50%;
          transform: translateX(-50%);
          width: 90px; height: 90px;
          background: url('https://voyagers-hook.github.io/images/logo%20trans.png') center/contain no-repeat;
          pointer-events: none;
          z-index: 1;
        }
        .vh-close {
          position: absolute; top: 10px; right: 14px;
          font-size: 22px; color: var(--vh-cyan);
          cursor: pointer; font-weight: 800; background: none;
          border: none; transition: transform .25s ease;
          font-family: var(--vh-font);
          z-index: 2;
        }
        .vh-close:hover { transform: rotate(18deg) scale(1.15); }

        .vh-header {
          text-align: center; padding: 0 16px 14px;
          flex-shrink: 0;
        }
        .vh-header-title {
          color: #ffffff; font-size: 18px;
          font-weight: 700;
        }
        .vh-header-sub {
          color: var(--vh-cyan); font-size: 11px;
          margin-top: 3px; font-weight: 400;
        }

        .vh-messages {
          flex: 1; overflow-y: auto;
          padding: 14px 14px;
          display: flex; flex-direction: column; gap: 10px;
          background: var(--vh-message-bg);
          margin: 0 12px;
          border-radius: 12px;
          min-height: 0;
        }
        .vh-messages::-webkit-scrollbar { width: 4px; }
        .vh-messages::-webkit-scrollbar-thumb {
          background: rgba(0,0,0,0.15); border-radius: 2px;
        }

        .vh-msg { display: flex; animation: slidein .25s ease; }
        @keyframes slidein {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .vh-msg.user { justify-content: flex-end; }
        .vh-msg.assistant { justify-content: flex-start; }

        .vh-msg-bubble {
          max-width: 85%;
          padding: 10px 14px;
          border-radius: 14px;
          font-size: 14px;
          line-height: 1.5;
        }
        .vh-msg.assistant .vh-msg-bubble {
          background: #ffffff;
          color: #1a1a1a;
          border-bottom-left-radius: 4px;
          box-shadow: 0 1px 2px rgba(0,0,0,0.05);
        }
        .vh-msg.user .vh-msg-bubble {
          background: var(--vh-cyan);
          color: #ffffff;
          border-bottom-right-radius: 4px;
        }
        .vh-msg-bubble.error {
          background: #fff5f5;
          color: #8a2020;
          border: 1px solid #fdd;
        }
        .vh-msg-bubble a {
          color: var(--vh-cyan-dark);
          text-decoration: underline;
          text-underline-offset: 2px;
          font-weight: 500;
        }
        .vh-msg.user .vh-msg-bubble a {
          color: #fff; font-weight: 600;
        }
        .vh-msg-bubble strong { font-weight: 600; }

        .vh-products {
          display: flex; flex-direction: column;
          gap: 6px; margin-top: 10px;
        }
        .vh-product-card {
          display: flex; align-items: center; gap: 10px;
          padding: 8px;
          background: #f4f1ea;
          border-radius: 10px;
          text-decoration: none !important;
          color: inherit !important;
          transition: background .15s, transform .1s;
        }
        .vh-product-card:hover {
          background: #ece7dc;
          transform: translateY(-1px);
        }
        .vh-product-card img {
          width: 48px; height: 48px;
          object-fit: cover;
          border-radius: 6px;
          background: #fff;
          flex-shrink: 0;
        }
        .vh-product-info { flex: 1; min-width: 0; }
        .vh-product-name {
          font-size: 12px;
          font-weight: 600;
          color: #1a1a1a;
          line-height: 1.3;
          overflow: hidden;
          text-overflow: ellipsis;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
        }
        .vh-product-price {
          font-size: 13px;
          color: var(--vh-cyan-dark);
          font-weight: 600;
          margin-top: 3px;
        }
        .vh-product-price .was {
          font-size: 11px;
          color: #999;
          text-decoration: line-through;
          margin-right: 6px;
          font-weight: 400;
        }

        .vh-typing-bubble { padding: 8px 14px !important; }
        .vh-typing { display: flex; gap: 4px; }
        .vh-typing i {
          width: 6px; height: 6px; border-radius: 50%;
          background: #b0b0b0;
          animation: typing 1.4s infinite ease-in-out;
        }
        .vh-typing i:nth-child(2) { animation-delay: .2s; }
        .vh-typing i:nth-child(3) { animation-delay: .4s; }
        @keyframes typing {
          0%, 60%, 100% { transform: translateY(0); opacity: .4; }
          30% { transform: translateY(-4px); opacity: 1; }
        }

        .vh-starters {
          padding: 10px 16px 0;
          display: flex; flex-wrap: wrap; gap: 6px;
        }
        .vh-starter {
          padding: 7px 12px;
          background: rgba(4,151,178,0.12);
          border: 1px solid rgba(4,151,178,0.3);
          border-radius: 18px;
          color: var(--vh-cyan-light);
          font-size: 11.5px;
          cursor: pointer;
          font-family: var(--vh-font);
          transition: all .15s;
        }
        .vh-starter:hover {
          background: rgba(4,151,178,0.22);
          border-color: rgba(4,151,178,0.55);
        }

        .vh-handoff-row {
          padding: 12px 16px 0; display: flex; gap: 8px;
        }
        .vh-handoff-btn {
          flex: 1; padding: 10px 12px;
          border: none;
          border-radius: 10px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          font-family: var(--vh-font);
          display: flex; align-items: center; justify-content: center;
          gap: 6px;
          transition: transform .15s ease, box-shadow .15s ease;
          box-shadow: 0 4px 8px rgba(0,0,0,0.2), inset 0 1px 2px rgba(255,255,255,0.5);
        }
        .vh-handoff-btn.email {
          background: linear-gradient(180deg, #04b2d3 10%, #027a8a 100%);
          color: #ffffff;
        }
        .vh-handoff-btn.wa {
          background: linear-gradient(180deg, #33ff88 10%, #15a84c 100%);
          color: #000000;
        }
        .vh-handoff-btn:hover {
          transform: translateY(1px);
          box-shadow: 0 2px 4px rgba(0,0,0,0.2), inset 0 1px 2px rgba(255,255,255,0.6);
        }

        .vh-input-area { padding: 12px 16px 16px; flex-shrink: 0; }
        .vh-input-wrap {
          display: flex; gap: 6px;
          background: #ffffff;
          border-radius: 22px;
          padding: 5px 5px 5px 16px;
          align-items: center;
        }
        .vh-input {
          flex: 1; background: none; border: none;
          color: #1a1a1a; font-size: 14px;
          font-family: var(--vh-font); outline: none;
          padding: 8px 0;
        }
        .vh-input::placeholder { color: #999; }
        .vh-send {
          width: 34px; height: 34px;
          border-radius: 50%;
          background: var(--vh-cyan);
          border: none; color: #fff;
          cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          transition: background .15s;
          flex-shrink: 0;
        }
        .vh-send:hover:not(:disabled) { background: var(--vh-cyan-light); }
        .vh-send:disabled { background: #ccc; cursor: not-allowed; }

        .vh-restart {
          background: none; border: none;
          color: rgba(255,255,255,0.4);
          font-size: 11px;
          cursor: pointer;
          margin-top: 10px;
          font-family: var(--vh-font);
          width: 100%; text-align: center;
        }
        .vh-restart:hover { color: rgba(255,255,255,0.7); }

        @media (max-width: 640px) {
          .vh-launcher {
            width: 44px; height: 44px; padding: 0;
            border-radius: 50%; font-size: 0;
            display: flex; align-items: center; justify-content: center;
          }
          .vh-launcher::before {
            content: ""; display: block; width: 22px; height: 22px;
            background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='white'%3E%3Cpath d='M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z'/%3E%3C/svg%3E");
            background-repeat: no-repeat; background-size: contain;
          }
          .vh-wrapper {
            left: 0; right: 0; bottom: 0;
            width: 100%; height: 92vh;
          }
          .vh-panel { border-radius: 16px 16px 0 0; }
        }
      `}</style>
    </>
  );
}
