/**
 * Vibe Engine — Cloudflare Worker API Proxy
 * 
 * Securely proxies requests to HuggingFace (embeddings) and Qdrant (vector search).
 * API keys never touch the client.
 */

import { getRandomQuery, getCategories } from './queries.js';

const HF_MODEL = 'sentence-transformers/all-MiniLM-L6-v2';
const HF_API_URL = `https://router.huggingface.co/hf-inference/models/${HF_MODEL}/pipeline/feature-extraction`;
const COLLECTION_NAME = 'songs';

// CORS headers
function corsHeaders(origin) {
    return {
        'Access-Control-Allow-Origin': origin || '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
    };
}

/**
 * Get embedding vector from HuggingFace
 */
async function getEmbedding(text, hfToken) {
    const response = await fetch(HF_API_URL, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${hfToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            inputs: text,
            options: { wait_for_model: true },
        }),
    });

    if (!response.ok) {
        const err = await response.text();
        throw new Error(`HuggingFace API error ${response.status}: ${err}`);
    }

    return response.json();
}

/**
 * Search Qdrant for nearest vectors
 */
async function searchQdrant(vector, limit, qdrantUrl, qdrantKey) {
    const response = await fetch(`${qdrantUrl}/collections/${COLLECTION_NAME}/points/search`, {
        method: 'POST',
        headers: {
            'api-key': qdrantKey,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            vector: vector,
            limit: limit,
            with_payload: true,
        }),
    });

    if (!response.ok) {
        const err = await response.text();
        throw new Error(`Qdrant API error ${response.status}: ${err}`);
    }

    return response.json();
}

/**
 * Handle search request
 */
async function handleSearch(request, env) {
    const { query, limit = 10 } = await request.json();

    if (!query || typeof query !== 'string' || query.trim().length === 0) {
        return new Response(JSON.stringify({ error: 'Query is required' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    // Step 1: Get embedding from HuggingFace
    const vector = await getEmbedding(query.trim(), env.HUGGINGFACE_TOKEN);

    // Step 2: Search Qdrant
    const results = await searchQdrant(vector, Math.min(limit, 20), env.QDRANT_URL, env.QDRANT_API_KEY);

    // Step 3: Format results
    const songs = results.result.map(hit => ({
        title: hit.payload.title,
        style: hit.payload.style,
        key: hit.payload.key,
        tempo: hit.payload.tempo,
        filename: hit.payload.filename,
        full_content: hit.payload.full_content,
        vibe_match: Math.round(hit.score * 100),
    }));

    return new Response(JSON.stringify({ query: query.trim(), songs }), {
        headers: { 'Content-Type': 'application/json' },
    });
}

/**
 * Handle suggest (Surprise Me) request
 */
async function handleSuggest(request, env) {
    let category = null;
    try {
        const body = await request.json();
        category = body.category || null;
    } catch {
        // No body is fine
    }

    const query = getRandomQuery(category);

    // Embed and search using the random query
    const vector = await getEmbedding(query, env.HUGGINGFACE_TOKEN);
    const results = await searchQdrant(vector, 10, env.QDRANT_URL, env.QDRANT_API_KEY);

    const songs = results.result.map(hit => ({
        title: hit.payload.title,
        style: hit.payload.style,
        key: hit.payload.key,
        tempo: hit.payload.tempo,
        filename: hit.payload.filename,
        full_content: hit.payload.full_content,
        vibe_match: Math.round(hit.score * 100),
    }));

    return new Response(JSON.stringify({
        query,
        category: category || 'random',
        categories: getCategories(),
        songs,
    }), {
        headers: { 'Content-Type': 'application/json' },
    });
}

/**
 * Handle stats request
 */
async function handleStats(env) {
    const response = await fetch(`${env.QDRANT_URL}/collections/${COLLECTION_NAME}`, {
        headers: { 'api-key': env.QDRANT_API_KEY },
    });

    if (!response.ok) {
        throw new Error(`Qdrant stats error: ${response.status}`);
    }

    const data = await response.json();

    return new Response(JSON.stringify({
        total_songs: data.result.points_count,
        status: data.result.status,
    }), {
        headers: { 'Content-Type': 'application/json' },
    });
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const origin = request.headers.get('Origin');

        // Handle CORS preflight
        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: corsHeaders(origin) });
        }

        try {
            let response;

            if (url.pathname === '/api/search' && request.method === 'POST') {
                response = await handleSearch(request, env);
            } else if (url.pathname === '/api/suggest' && request.method === 'POST') {
                response = await handleSuggest(request, env);
            } else if (url.pathname === '/api/stats' && request.method === 'GET') {
                response = await handleStats(env);
            } else {
                response = new Response(JSON.stringify({ error: 'Not found' }), {
                    status: 404,
                    headers: { 'Content-Type': 'application/json' },
                });
            }

            // Add CORS headers to response
            const headers = new Headers(response.headers);
            Object.entries(corsHeaders(origin)).forEach(([k, v]) => headers.set(k, v));

            return new Response(response.body, {
                status: response.status,
                headers,
            });

        } catch (error) {
            return new Response(JSON.stringify({ error: error.message }), {
                status: 500,
                headers: {
                    'Content-Type': 'application/json',
                    ...corsHeaders(origin),
                },
            });
        }
    },
};
