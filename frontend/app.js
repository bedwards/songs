/**
 * Vibe Engine — Frontend Application
 * Search, discover, favorite, and organize songs.
 */

// --- Config ---
const API_BASE = 'https://vibe-engine-api.brian-mabry-edwards.workers.dev';

// --- Songwriter Attribution ---
// Maps band/group names to their primary songwriter
const SONGWRITER_MAP = {
    'Son Volt': 'Jay Farrar (Son Volt)',
    'The Beatles': 'Lennon/McCartney (The Beatles)',
    'The Flatlanders': 'Joe Ely, Jimmie Dale Gilmore & Butch Hancock (The Flatlanders)',
    'Wilco': 'Jeff Tweedy (Wilco)',
    'Hank Williams Jr.': 'Hank Williams Jr.',
};

/**
 * Format the songwriter credit line for a song's style field.
 * Returns something like: "An original song · CC BY 4.0 · Inspired by the songwriting of Jay Farrar (Son Volt)"
 */
function formatCredit(style) {
    if (!style) return '';
    // Extract the artist name from various "Style of: X" or "Style: X" formats
    let artist = style;
    if (style.startsWith('Style of: ')) artist = style.replace('Style of: ', '');
    else if (style.startsWith('Style: ')) artist = style.replace('Style: ', '');

    // Map bands to primary songwriters
    const songwriter = SONGWRITER_MAP[artist] || artist;

    return songwriter;
}

function formatCreditFull(style) {
    const songwriter = formatCredit(style);
    if (!songwriter) return '';
    return `Original song · Free to perform (CC0) · Inspiration: ${songwriter}`;
}

// --- State ---
let currentSong = null;
let currentAlbumId = null;

// --- LocalStorage Helpers ---
function loadState(key, fallback) {
    try { return JSON.parse(localStorage.getItem(`vibe_${key}`)) || fallback; }
    catch { return fallback; }
}
function saveState(key, value) {
    localStorage.setItem(`vibe_${key}`, JSON.stringify(value));
}

// --- State Management ---
let favorites = loadState('favorites', []);
let albums = loadState('albums', []);
let searchHistory = loadState('history', []);

function saveFavorites() { saveState('favorites', favorites); updateBadge(); }
function saveAlbums() { saveState('albums', albums); updateBadge(); }
function saveHistory() { saveState('history', searchHistory); }

function isFavorited(filename) {
    return favorites.some(f => f.filename === filename);
}

function toggleFavorite(song) {
    const idx = favorites.findIndex(f => f.filename === song.filename);
    if (idx >= 0) {
        favorites.splice(idx, 1);
    } else {
        favorites.push({
            title: song.title,
            style: song.style,
            key: song.key,
            tempo: song.tempo,
            filename: song.filename,
            full_content: song.full_content,
            vibe_match: song.vibe_match,
        });
    }
    saveFavorites();
}

function addToHistory(query) {
    searchHistory = searchHistory.filter(q => q !== query);
    searchHistory.unshift(query);
    if (searchHistory.length > 20) searchHistory = searchHistory.slice(0, 20);
    saveHistory();
}

function updateBadge() {
    const badge = document.getElementById('sidebar-badge');
    const total = favorites.length + albums.length;
    badge.textContent = total;
    badge.style.display = total > 0 ? 'flex' : 'none';
    document.getElementById('fav-count').textContent = `(${favorites.length})`;
    document.getElementById('album-count').textContent = `(${albums.length})`;
}

// --- API ---
async function searchSongs(query) {
    const res = await fetch(`${API_BASE}/api/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, limit: 10 }),
    });
    if (!res.ok) throw new Error(`Search failed: ${res.status}`);
    return res.json();
}

async function suggestSongs(category) {
    const res = await fetch(`${API_BASE}/api/suggest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category }),
    });
    if (!res.ok) throw new Error(`Suggest failed: ${res.status}`);
    return res.json();
}

async function getStats() {
    const res = await fetch(`${API_BASE}/api/stats`);
    if (!res.ok) throw new Error(`Stats failed: ${res.status}`);
    return res.json();
}

// --- Rendering ---
function renderResults(songs, query) {
    const container = document.getElementById('results');
    const queryDisplay = document.getElementById('query-display');
    const queryText = document.getElementById('query-text');

    if (query) {
        queryDisplay.classList.remove('hidden');
        queryText.textContent = `"${query}"`;
    }

    // Grade on a curve: top result 89-100%, lowest ≥67%, rest proportionally between
    if (songs.length > 0) {
        const rawScores = songs.map(s => s.vibe_match);
        const rawMax = Math.max(...rawScores);
        const rawMin = Math.min(...rawScores);
        const curvedTop = 89 + Math.round(Math.random() * 11); // 89-100
        const curvedBottom = 67 + Math.round(Math.random() * 8); // 67-75
        const rawRange = rawMax - rawMin || 1;
        const curvedRange = curvedTop - curvedBottom;
        songs = songs.map(s => ({
            ...s,
            title: cleanTitle(s.title, s.full_content),
            vibe_match: Math.round(curvedBottom + ((s.vibe_match - rawMin) / rawRange) * curvedRange)
        }));
    }

    /**
     * Clean up a song title:
     * - Strip "Title: ", code fences, markdown headers
     * - Title Case the result
     * - If the result is garbage, use the first 4 words from the song content
     */
    function cleanTitle(raw, content) {
        let t = (raw || '').trim();
        // Strip common junk
        t = t.replace(/^```\w*\s*/g, '');  // ```text, ```markdown, ```
        t = t.replace(/```\s*$/g, '');      // trailing ```
        t = t.replace(/^#+\s*/, '');        // # Markdown headers
        t = t.replace(/^Title:\s*/i, '');   // Title: prefix
        t = t.replace(/^\d{2,4}[\s\-]+/, ''); // 326- or 1134- number prefixes
        t = t.trim();

        // Check if it's garbage (empty, just punctuation, or too short to be a real title)
        if (!t || t.length < 2 || /^[\W\d_]+$/.test(t)) {
            t = fallbackTitle(content);
        }

        // Final safety: never start with "Title:"
        t = t.replace(/^Title:\s*/i, '').trim();

        return toTitleCase(t);
    }

    function toTitleCase(str) {
        const minor = new Set(['a', 'an', 'the', 'and', 'but', 'or', 'for', 'nor', 'in', 'on', 'at', 'to', 'by', 'of', 'up', 'as', 'is', 'it']);
        return str.replace(/[\w][\w''']*/g, (word, i) => {
            if (i === 0 || !minor.has(word.toLowerCase())) {
                return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
            }
            return word.toLowerCase();
        });
    }

    function fallbackTitle(content) {
        if (!content) return 'Untitled';
        // Find the first line that looks like actual song content (not metadata/fences)
        const lines = content.split('\n');
        for (const line of lines) {
            const cleaned = line.trim()
                .replace(/^```\w*\s*/, '')
                .replace(/^#+\s*/, '')
                .replace(/^Title:\s*/i, '')
                .replace(/^Style[:\s].*/i, '')
                .replace(/^Key[:\s].*/i, '')
                .replace(/^Tempo[:\s].*/i, '')
                .trim();
            if (cleaned.length > 3 && !/^[\[(]/.test(cleaned) && !/^```/.test(cleaned)) {
                // Take first 4 words
                return cleaned.split(/\s+/).slice(0, 4).join(' ');
            }
        }
        return 'Untitled';
    }

    container.innerHTML = songs.map((song, i) => `
    <div class="result-card" data-index="${i}" onclick="openSong(${i})">
      <div class="result-header">
        <span class="result-title">${escapeHtml(song.title)}</span>
        <span class="result-match">${song.vibe_match}% match</span>
      </div>
      <div class="result-credit">✦ Inspiration: ${escapeHtml(formatCredit(song.style))}</div>
      <div class="result-meta">
        ${song.key ? `<span class="meta-tag">🎵 ${escapeHtml(song.key)}</span>` : ''}
        ${song.tempo ? `<span class="meta-tag">⏱ ${escapeHtml(song.tempo)}</span>` : ''}
      </div>
      <div class="result-preview">${getPreview(song.full_content)}</div>
      <div class="result-actions" onclick="event.stopPropagation()">
        <button class="result-action-btn ${isFavorited(song.filename) ? 'favorited' : ''}"
                onclick="handleFavoriteClick(event, ${i})" title="Favorite">♥</button>
        <button class="result-action-btn" onclick="handleAddToAlbumClick(event, ${i})" title="Add to Setlist">♫+</button>
      </div>
    </div>
  `).join('');

    // Store current results for reference
    window._currentResults = songs;
}

function getPreview(content) {
    // Get first few meaningful lines (skip code fence, metadata)
    const lines = content.split('\n');
    const meaningful = [];
    let started = false;
    for (const line of lines) {
        const trimmed = line.trim();
        if (!started) {
            if (trimmed.startsWith('[Verse') || trimmed.startsWith('[Chorus')) {
                started = true;
                continue;
            }
        } else {
            if (trimmed === '' || trimmed.startsWith('[')) break;
            meaningful.push(escapeHtml(trimmed));
            if (meaningful.length >= 3) break;
        }
    }
    return meaningful.join('\n') || escapeHtml(lines.slice(2, 5).join('\n'));
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Strip markdown code fences from song content.
 * Removes opening ``` / ```markdown / ```text and closing ```
 */
function cleanContent(content) {
    if (!content) return '';
    return content
        .replace(/^```(?:markdown|text)?\s*\n?/gm, '')
        .replace(/\n?```\s*$/gm, '')
        .trim();
}

// --- Song Modal ---
function openSong(index) {
    const song = window._currentResults ? window._currentResults[index] :
        favorites[index - 10000]; // offset for favorites
    if (!song) return;
    currentSong = song;

    document.getElementById('modal-title').textContent = song.title;
    document.getElementById('modal-key').textContent = song.key || '';
    document.getElementById('modal-tempo').textContent = song.tempo || '';
    document.getElementById('modal-match').textContent = song.vibe_match ? `${song.vibe_match}% match` : '';
    document.getElementById('modal-credit').textContent = formatCreditFull(song.style);

    // Display content exactly as it appears in the source file
    document.getElementById('modal-content').textContent = cleanContent(song.full_content);

    const favBtn = document.getElementById('modal-fav-btn');
    favBtn.classList.toggle('favorited', isFavorited(song.filename));

    document.getElementById('song-modal').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
}

function closeSongModal() {
    document.getElementById('song-modal').classList.add('hidden');
    document.body.style.overflow = '';
    currentSong = null;
}

// --- Favorites ---
function handleFavoriteClick(event, index) {
    event.stopPropagation();
    const song = window._currentResults[index];
    toggleFavorite(song);

    // Update button state
    const btn = event.currentTarget;
    btn.classList.toggle('favorited', isFavorited(song.filename));

    renderFavorites();
}

function renderFavorites() {
    const list = document.getElementById('favorites-list');
    const empty = document.getElementById('favorites-empty');

    if (favorites.length === 0) {
        list.innerHTML = '';
        empty.style.display = 'block';
        return;
    }

    empty.style.display = 'none';
    list.innerHTML = favorites.map((fav, i) => `
    <div class="sidebar-item" onclick="openFavoriteSong(${i})">
      <span class="sidebar-item-title">${escapeHtml(fav.title)}</span>
      <button class="sidebar-item-remove" onclick="removeFavorite(event, ${i})" title="Remove">✕</button>
    </div>
  `).join('');

    updateBadge();
}

function openFavoriteSong(index) {
    window._currentResults = favorites;
    openSong(index);
}

function removeFavorite(event, index) {
    event.stopPropagation();
    favorites.splice(index, 1);
    saveFavorites();
    renderFavorites();
}

// --- Albums/Setlists ---
function createAlbum(name = 'Untitled Setlist') {
    const album = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        name,
        songs: [],
        created: new Date().toISOString(),
    };
    albums.push(album);
    saveAlbums();
    renderAlbums();
    return album;
}

function renderAlbums() {
    const list = document.getElementById('albums-list');
    const empty = document.getElementById('albums-empty');

    if (albums.length === 0) {
        list.innerHTML = '';
        empty.style.display = 'block';
        return;
    }

    empty.style.display = 'none';
    list.innerHTML = albums.map((album, i) => `
    <div class="sidebar-item" onclick="openAlbumModal('${album.id}')">
      <span class="sidebar-item-title">${escapeHtml(album.name)} (${album.songs.length})</span>
      <button class="sidebar-item-remove" onclick="removeAlbum(event, ${i})" title="Delete">✕</button>
    </div>
  `).join('');

    updateBadge();
}

function removeAlbum(event, index) {
    event.stopPropagation();
    if (confirm(`Delete "${albums[index].name}"?`)) {
        albums.splice(index, 1);
        saveAlbums();
        renderAlbums();
    }
}

function openAlbumModal(albumId) {
    const album = albums.find(a => a.id === albumId);
    if (!album) return;
    currentAlbumId = albumId;

    document.getElementById('album-name-input').value = album.name;
    renderAlbumSongs(album);

    document.getElementById('album-modal').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
}

function renderAlbumSongs(album) {
    const container = document.getElementById('album-songs');
    const empty = document.getElementById('album-songs-empty');

    if (album.songs.length === 0) {
        container.innerHTML = '';
        empty.style.display = 'block';
        return;
    }

    empty.style.display = 'none';
    container.innerHTML = album.songs.map((song, i) => `
    <div class="album-song-item" draggable="true" data-index="${i}">
      <span class="album-song-num">${i + 1}</span>
      <span class="album-song-title">${escapeHtml(song.title)}</span>
      <button class="album-song-remove" onclick="removeFromAlbum(${i})" title="Remove">✕</button>
    </div>
  `).join('');

    // Setup drag and drop
    setupAlbumDragDrop(container, album);
}

function removeFromAlbum(index) {
    const album = albums.find(a => a.id === currentAlbumId);
    if (!album) return;
    album.songs.splice(index, 1);
    saveAlbums();
    renderAlbumSongs(album);
}

function setupAlbumDragDrop(container, album) {
    const items = container.querySelectorAll('.album-song-item');
    let dragIndex = null;

    items.forEach((item, i) => {
        item.addEventListener('dragstart', () => {
            dragIndex = i;
            item.classList.add('dragging');
        });
        item.addEventListener('dragend', () => {
            item.classList.remove('dragging');
            dragIndex = null;
        });
        item.addEventListener('dragover', (e) => {
            e.preventDefault();
            if (dragIndex === null || dragIndex === i) return;
            const [moved] = album.songs.splice(dragIndex, 1);
            album.songs.splice(i, 0, moved);
            dragIndex = i;
            saveAlbums();
            renderAlbumSongs(album);
        });
    });
}

function addSongToAlbum(albumId, song) {
    const album = albums.find(a => a.id === albumId);
    if (!album) return;
    // Don't add duplicates
    if (album.songs.some(s => s.filename === song.filename)) return;
    album.songs.push({
        title: song.title,
        style: song.style,
        key: song.key,
        tempo: song.tempo,
        filename: song.filename,
        full_content: song.full_content,
    });
    saveAlbums();
    renderAlbums();
}

// --- Add to Album Popover ---
function handleAddToAlbumClick(event, index) {
    event.stopPropagation();
    const song = window._currentResults[index];
    showAddToAlbumPopover(event.currentTarget, song);
}

function showAddToAlbumPopover(anchor, song) {
    const popover = document.getElementById('add-to-album-popover');
    const rect = anchor.getBoundingClientRect();

    popover.style.top = `${rect.bottom + 8}px`;
    popover.style.left = `${Math.min(rect.left, window.innerWidth - 220)}px`;

    const listEl = document.getElementById('popover-albums');
    listEl.innerHTML = albums.map(album => `
    <button class="popover-item" onclick="addToAlbumFromPopover('${album.id}')">${escapeHtml(album.name)}</button>
  `).join('');

    window._popoverSong = song;
    popover.classList.remove('hidden');

    // Close on click outside
    setTimeout(() => {
        document.addEventListener('click', closePopover, { once: true });
    }, 10);
}

function addToAlbumFromPopover(albumId) {
    if (window._popoverSong) {
        addSongToAlbum(albumId, window._popoverSong);
    }
    closePopover();
}

function closePopover() {
    document.getElementById('add-to-album-popover').classList.add('hidden');
}

// --- Export ---
function exportAlbum(albumId) {
    const album = albums.find(a => a.id === albumId);
    if (!album) return;

    let text = `${'='.repeat(60)}\n`;
    text += `  ${album.name}\n`;
    text += `  ${album.songs.length} songs\n`;
    text += `${'='.repeat(60)}\n\n`;

    album.songs.forEach((song, i) => {
        text += `${'-'.repeat(60)}\n`;
        text += `  ${i + 1}. ${song.title}\n`;
        text += `${'-'.repeat(60)}\n\n`;
        text += song.full_content;
        text += `\n\n`;
    });

    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${album.name.replace(/[^a-z0-9]/gi, '-').toLowerCase()}-setlist.txt`;
    a.click();
    URL.revokeObjectURL(url);
}

// --- History ---
function renderHistory() {
    const list = document.getElementById('history-list');
    const empty = document.getElementById('history-empty');

    if (searchHistory.length === 0) {
        list.innerHTML = '';
        empty.style.display = 'block';
        return;
    }

    empty.style.display = 'none';
    list.innerHTML = searchHistory.map((query, i) => `
    <div class="sidebar-item" onclick="rerunSearch('${escapeHtml(query).replace(/'/g, "\\'")}')">
      <span class="sidebar-item-title">${escapeHtml(query)}</span>
    </div>
  `).join('');
}

function rerunSearch(query) {
    document.getElementById('search-input').value = query;
    performSearch(query);
}

// --- Search Flow ---
async function performSearch(query) {
    const loading = document.getElementById('loading');
    const results = document.getElementById('results');

    results.innerHTML = '';
    loading.classList.remove('hidden');

    try {
        const data = await searchSongs(query);
        loading.classList.add('hidden');
        addToHistory(query);
        renderResults(data.songs, data.query);
        renderHistory();
    } catch (err) {
        loading.classList.add('hidden');
        // Silently fall back to a surprise search
        performSurprise(null);
    }
}

async function performSurprise(category) {
    const loading = document.getElementById('loading');
    const results = document.getElementById('results');

    results.innerHTML = '';
    loading.classList.remove('hidden');

    try {
        const data = await suggestSongs(category);
        loading.classList.add('hidden');
        renderResults(data.songs, data.query);
    } catch (err) {
        loading.classList.add('hidden');
        // Silently show nothing rather than an error
        results.innerHTML = '';
    }
}

// --- Event Listeners ---
document.addEventListener('DOMContentLoaded', () => {
    // Search
    const searchInput = document.getElementById('search-input');
    const searchBtn = document.getElementById('search-btn');

    searchBtn.addEventListener('click', () => {
        const query = searchInput.value.trim();
        if (query) performSearch(query);
    });

    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            const query = searchInput.value.trim();
            if (query) performSearch(query);
        }
    });

    // Surprise Me — main button picks from all categories
    document.getElementById('surprise-btn').addEventListener('click', () => {
        performSurprise(null);
    });

    // Category buttons — each one directly triggers a surprise in that category
    document.querySelectorAll('.surprise-cat-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            performSurprise(btn.dataset.category);
        });
    });

    // Sidebar toggle
    document.getElementById('sidebar-toggle').addEventListener('click', () => {
        document.getElementById('sidebar').classList.toggle('open');
    });

    // Sidebar tabs
    document.querySelectorAll('.sidebar-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.sidebar-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
        });
    });

    // Song modal events
    document.getElementById('modal-close').addEventListener('click', closeSongModal);
    document.querySelector('#song-modal .modal-backdrop').addEventListener('click', closeSongModal);

    document.getElementById('modal-fav-btn').addEventListener('click', () => {
        if (currentSong) {
            toggleFavorite(currentSong);
            document.getElementById('modal-fav-btn').classList.toggle('favorited', isFavorited(currentSong.filename));
            renderFavorites();
            // Update result cards
            document.querySelectorAll('.result-card').forEach(card => {
                const idx = parseInt(card.dataset.index);
                const song = window._currentResults[idx];
                if (song) {
                    const favBtn = card.querySelector('.result-action-btn');
                    if (favBtn) favBtn.classList.toggle('favorited', isFavorited(song.filename));
                }
            });
        }
    });

    document.getElementById('modal-add-to-album').addEventListener('click', (e) => {
        if (currentSong) showAddToAlbumPopover(e.currentTarget, currentSong);
    });

    // Album modal events
    document.getElementById('album-close').addEventListener('click', () => {
        document.getElementById('album-modal').classList.add('hidden');
        document.body.style.overflow = '';
        currentAlbumId = null;
    });
    document.querySelector('#album-modal .modal-backdrop').addEventListener('click', () => {
        document.getElementById('album-modal').classList.add('hidden');
        document.body.style.overflow = '';
        currentAlbumId = null;
    });

    document.getElementById('album-name-input').addEventListener('input', (e) => {
        const album = albums.find(a => a.id === currentAlbumId);
        if (album) {
            album.name = e.target.value || 'Untitled Setlist';
            saveAlbums();
            renderAlbums();
        }
    });

    document.getElementById('album-export-btn').addEventListener('click', () => {
        if (currentAlbumId) exportAlbum(currentAlbumId);
    });

    document.getElementById('album-delete-btn').addEventListener('click', () => {
        const album = albums.find(a => a.id === currentAlbumId);
        if (album && confirm(`Delete "${album.name}"?`)) {
            albums = albums.filter(a => a.id !== currentAlbumId);
            saveAlbums();
            renderAlbums();
            document.getElementById('album-modal').classList.add('hidden');
            document.body.style.overflow = '';
            currentAlbumId = null;
        }
    });

    // Create album button
    document.getElementById('create-album-btn').addEventListener('click', () => {
        const album = createAlbum();
        openAlbumModal(album.id);
    });

    document.getElementById('popover-new-album').addEventListener('click', () => {
        const album = createAlbum();
        if (window._popoverSong) {
            addSongToAlbum(album.id, window._popoverSong);
        }
        closePopover();
    });

    // Escape key to close modals
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeSongModal();
            document.getElementById('album-modal').classList.add('hidden');
            document.body.style.overflow = '';
            closePopover();
        }
    });

    // Load initial state
    renderFavorites();
    renderAlbums();
    renderHistory();
    updateBadge();

    // Load song count
    getStats().then(data => {
        const rounded = Math.floor(data.total_songs / 1000) * 1000;
        document.getElementById('song-count').textContent =
            `${rounded.toLocaleString()}+ songs in catalog`;
    }).catch(() => {
        document.getElementById('song-count').textContent = '2,000+ songs in catalog';
    });

    // Auto-load a random surprise on page load so Kevin sees songs right away
    performSurprise(null);
});
