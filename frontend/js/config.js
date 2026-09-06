/**
 * BLANJAAN v2.0 — Global Config & State Variables
 */

const API_URL = "/api";
const FALLBACK_IMG = "https://placehold.co/300x300/f3f4f6/a1a1aa?text=BLANJAAN";
const FALLBACK_LOGO = "https://placehold.co/100x100/FF6B00/ffffff?text=Toko";
const FALLBACK_SELLER_BANNER = "https://images.unsplash.com/photo-1556740738-b6a63e27c4df?auto=format&fit=crop&w=1200&q=80";
const SESSION_KEY = "blanjaan_session";
const SESSION_META_KEY = "blanjaan_session_meta";
const AUTH_SNAPSHOT_KEY = "blanjaan_auth_snapshot";
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;

let appConfig = {};
let sellerPreviewFromDashboard = false;
let lastActivityPersistAt = 0;

let liveProducts = [];
let liveCategories = [];
let sellerCache = {};
let orderList = [];

let activeCategoryId = null;
let activeCategoryName = null;
let searchQuery = "";
let isCheckoutProcessing = false;
let pendingLoginEmail = "";
let resendInterval = null;
let intentAfterLogin = null;

let activeFilter = 'terkait';
let sortHargaAsc = true;
let activeRatingSeller = null;
let activeRatingStars = 0;
let flashSaleBatches = [];
let flashSaleSellerOptions = [];
let adminDashboardCache = null;
let adminDashboardRefreshTimer = null;
let flashSaleTickerTimer = null;

// Infinite Scroll & Pagination
let currentPage = 1;
let itemsPerPage = 10;
let hasMoreData = true;
let isLoadingMore = false;
let currentFilteredProducts = [];

const authState = {
    status: "LOADING",
    sessionToken: null,
    user: null,
    seller: null,
    sellerApplication: null,
    sellerServices: []
};

const MOCK_CATEGORIES = [
    { category_id: "C1", category_name: "Makanan", icon: "coffee", status: "ACTIVE" },
    { category_id: "C2", category_name: "Fashion", icon: "shirt", status: "ACTIVE" },
    { category_id: "C3", category_name: "Elektronik", icon: "monitor", status: "ACTIVE" },
    { category_id: "C4", category_name: "Kerajinan", icon: "gift", status: "ACTIVE" },
    { category_id: "C5", category_name: "Kesehatan", icon: "heart", status: "ACTIVE" }
];

const MOCK_PRODUCTS = [
    { product_id: "P1", seller_id: "S1", category_id: "C1", product_category: "Makanan", product_name: "Kopi Gula Aren Asli (Biji Pilihan)", price: 75000, promo_price: 55000, main_image: "https://images.unsplash.com/photo-1559525839-b184a4d698c7?w=500&q=80", description: "Kopi aren segar asli.", stock: 10, views: 250, featured: true, status: "ACTIVE", upload_date: new Date(Date.now() - 2 * 86400000).toISOString() },
    { product_id: "P2", seller_id: "S2", category_id: "C2", product_category: "Fashion", product_name: "Kemeja Flanel Pria Premium", price: 150000, promo_price: 0, main_image: "https://images.unsplash.com/photo-1598033129183-c4f50c736f10?w=500&q=80", description: "Kemeja flanel tebal.", stock: 5, views: 120, featured: false, status: "ACTIVE", upload_date: new Date(Date.now() - 5 * 86400000).toISOString() },
    { product_id: "P3", seller_id: "S1", category_id: "C1", product_category: "Makanan", product_name: "Keripik Singkong Pedas Mantap", price: 15000, promo_price: 12000, main_image: "https://images.unsplash.com/photo-1621852004158-f3bc188ace2d?w=500&q=80", description: "Level 10.", stock: 100, views: 500, featured: true, status: "ACTIVE", upload_date: new Date(Date.now() - 10 * 86400000).toISOString() },
    { product_id: "P4", seller_id: "S3", category_id: "C4", product_category: "Kerajinan", product_name: "Tas Anyaman Bambu Tradisional", price: 85000, promo_price: 0, main_image: "https://images.unsplash.com/photo-1590874103328-eac38a683ce7?w=500&q=80", description: "Asli pengrajin lokal.", stock: 2, views: 80, featured: true, status: "ACTIVE", upload_date: new Date(Date.now() - 20 * 86400000).toISOString() },
    { product_id: "P5", seller_id: "S2", category_id: "C2", product_category: "Fashion", product_name: "Kaos Polos Katun Combed 30s", price: 45000, promo_price: 35000, main_image: "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=500&q=80", description: "Katun combed 30s.", stock: 50, views: 300, featured: false, status: "ACTIVE", upload_date: new Date(Date.now() - 30 * 86400000).toISOString() }
];

const MOCK_SELLERS = [
    { seller_id: "S1", store_name: "Toko Suka Maju", city: "Jakarta Selatan", wa: "628123456789", status: "ACTIVE" },
    { seller_id: "S2", store_name: "Fashion Hub", city: "Bandung", wa: "628123456789", status: "ACTIVE" },
    { seller_id: "S3", store_name: "Craft Indo", city: "Yogyakarta", wa: "628123456789", status: "ACTIVE" }
];

// Utility functions
const normalizeText = (str) => str ? String(str).trim() : "";
const escapeHTML = (str) => { if (!str) return ''; return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); };
const normalizeId = (id) => id ? String(id).trim() : null;
const normalizeStatus = (status) => status ? String(status).trim().toUpperCase() : 'INACTIVE';
const parseBoolean = (val) => [true, 1, "TRUE", "YES", "1"].includes(val) || [true, 1, "TRUE", "YES", "1"].includes(String(val).trim().toUpperCase());
const normalizeWhatsAppNumber = (wa) => { if (!wa) return null; let cleaned = String(wa).replace(/\D/g, ''); if (cleaned.startsWith('0')) cleaned = '62' + cleaned.substring(1); else if (cleaned.startsWith('8')) cleaned = '628' + cleaned.substring(1); if (!cleaned.startsWith('62')) return null; if (cleaned.length < 10 || cleaned.length > 15) return null; return cleaned; };
const validateHttpsUrl = (url) => { if (!url) return null; try { const parsed = new URL(url); return parsed.protocol === 'https:' ? parsed.href : null; } catch (e) { return null; } };
const formatRupiah = (angka) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(angka || 0);
const trackEvent = (eventName, payload = {}) => console.info(`[TRACK] ${eventName}`, payload);
