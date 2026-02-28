// /api/signal.js — Vercel Serverless Function
// In-memory KV store for WebRTC SDP signaling.
// Data is tiny (SDP strings ~2KB) and short-lived (room handshake only).
// Vercel Edge Functions share memory per region per instance — good enough for signaling.

// Simple in-memory store with TTL
const store = new Map();

function gc() {
    const now = Date.now();
    for (const [k, v] of store) {
        if (now - v.ts > 5 * 60 * 1000) store.delete(k); // 5 min TTL
    }
}

export default function handler(req, res) {
    // CORS — allow same origin and any origin for Vercel preview URLs
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    gc(); // clean up old entries

    if (req.method === 'GET') {
        const key = req.query.key;
        if (!key) return res.status(400).json({ error: 'missing key' });
        const entry = store.get(key);
        if (!entry) return res.status(404).json({ val: null });
        return res.status(200).json({ val: entry.val });
    }

    if (req.method === 'POST') {
        const { key, val } = req.body || {};
        if (!key || val === undefined) return res.status(400).json({ error: 'missing key or val' });
        store.set(key, { val, ts: Date.now() });
        return res.status(200).json({ ok: true });
    }

    if (req.method === 'DELETE') {
        const { key } = req.body || {};
        if (!key) return res.status(400).json({ error: 'missing key' });
        store.delete(key);
        return res.status(200).json({ ok: true });
    }

    res.status(405).json({ error: 'method not allowed' });
}