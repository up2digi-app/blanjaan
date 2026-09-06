/**
 * BLANJAAN v2.0 — API Client (fetchAPI)
 */

const API_TIMEOUT_MS = 20000;
const API_MAX_RETRIES = 1;

async function fetchAPI(action, payload = null) {
    let lastError = null;

    for (let attempt = 0; attempt <= API_MAX_RETRIES; attempt++) {
        let timer = null;
        try {
            const url = `${API_URL}/${action}`;
            const controller = new AbortController();
            timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

            const options = payload
                ? {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json;charset=utf-8'
                    },
                    body: JSON.stringify(payload),
                    signal: controller.signal,
                    cache: 'no-store'
                }
                : {
                    method: 'GET',
                    signal: controller.signal,
                    cache: 'no-store'
                };

            const res = await fetch(url, options);
            const raw = await res.text();
            let json = null;
            try { json = JSON.parse(raw); } catch (_) {}

            if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
            if (!json || json.success !== true) throw new Error((json && json.message) || 'Gagal mengambil data.');

            return json.data;
        } catch (error) {
            const reason = error && error.name === 'AbortError'
                ? `Timeout ${API_TIMEOUT_MS / 1000} detik.`
                : (error.message || String(error));
            lastError = new Error(reason);

            const isRead = !payload;
            const retryable = isRead && (error?.name === 'AbortError' || /failed to fetch|network|http error:\s*5\d\d|service unavailable|gateway/i.test(reason));
            if (!retryable || attempt >= API_MAX_RETRIES) break;
            await new Promise(r => setTimeout(r, 700 * Math.pow(2, attempt)));
        } finally {
            if (timer) clearTimeout(timer);
        }
    }

    console.warn(`[API Gagal] ${action}: ${lastError?.message || 'unknown'}`);

    // Fallback Mock Data saat dev/offline
    if (action === 'categories') return MOCK_CATEGORIES;
    if (action === 'products') return MOCK_PRODUCTS;
    if (action === 'catalog') return { categories: MOCK_CATEGORIES, products: MOCK_PRODUCTS, sellers: MOCK_SELLERS };
    if (action === 'seller') {
        let id = null;
        if (payload && (payload.id || payload.seller_id)) id = payload.id || payload.seller_id;
        const found = MOCK_SELLERS.filter(s => s.seller_id === id);
        return found.length > 0 ? found : [MOCK_SELLERS[0]];
    }

    throw (lastError || new Error('Gagal terhubung ke server.'));
}
