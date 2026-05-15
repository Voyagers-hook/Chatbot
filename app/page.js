export default function Home() {
  return (
    <div style={{
      fontFamily: 'system-ui, sans-serif',
      maxWidth: '680px',
      margin: '0 auto',
      padding: '80px 24px',
      color: '#222',
      lineHeight: 1.6
    }}>
      <h1 style={{ color: '#0497b2', marginBottom: '8px', fontSize: '28px' }}>
        Voyager's Hook — AI Chat
      </h1>
      <p style={{ color: '#666', marginBottom: '32px', fontSize: '15px' }}>
        AI customer chat for voyagershook.com, powered by Claude. Connected to live Supabase inventory.
      </p>

      <div style={{
        background: '#f0f9fb',
        border: '1px solid #b5e3ec',
        borderRadius: '12px',
        padding: '20px 24px',
        marginBottom: '24px'
      }}>
        <p style={{ margin: 0, fontSize: '15px' }}>
          👉 <strong>Preview the chat widget</strong>:{' '}
          <a href="/embed" style={{ color: '#0497b2' }}>/embed</a>
        </p>
      </div>

      <h2 style={{ fontSize: '20px', marginTop: '40px' }}>Quick links</h2>
      <ul style={{ fontSize: '14px' }}>
        <li><a href="/embed" style={{ color: '#0497b2' }}>/embed</a> — the chat widget itself</li>
        <li><code>/api/seed?secret=XXX</code> — one-time backfill from bundled product data</li>
        <li><code>/api/cron/sync</code> — pull fresh products from Squarespace (auto-runs every 6h)</li>
        <li><code>/api/chat</code> — the chat API endpoint</li>
      </ul>

      <p style={{ marginTop: '40px', color: '#999', fontSize: '13px' }}>
        Read the README in the repo for full deployment instructions.
      </p>
    </div>
  );
}
