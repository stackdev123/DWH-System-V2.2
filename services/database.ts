import { createClient } from '@supabase/supabase-js';
import { StockItem, LogEntry, Product, InventorySummary, User, ItemStatus, OpnameRequest, SimpleItem, SimpleTransaction } from '../types.ts';
import { idbStorage } from './indexedDb.ts';

const SUPABASE_URL = "https://gkivokddqirabsqexdap.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_UMe4xlyFFKTvKJairJCLEQ_mVnPw59Z";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const PROJECT_ID = SUPABASE_URL.split('//')[1]?.split('.')[0] || 'default';

// --- HYBRID INDEXEDDB & IN-MEMORY CACHE LAYER (REDUCES SUPABASE EGRESS BY UP TO 99.9%) ---
const CACHE_KEYS = {
  PRODUCTS: `bsi_dwh_cache_products_${PROJECT_ID}`,
  STOCK: `bsi_dwh_cache_stock_${PROJECT_ID}`,
  LOGS: `bsi_dwh_cache_logs_${PROJECT_ID}`,
  SIMPLE_ITEMS: `bsi_dwh_cache_s_items_${PROJECT_ID}`,
  SIMPLE_TX: `bsi_dwh_cache_s_tx_${PROJECT_ID}`
};

function safeGetStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function safeSetStorage(key: string, val: any): void {
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch { }
}

// Initial synchronous fallback from localStorage (fast boot)
let cachedProducts: Product[] = safeGetStorage<Product[]>(CACHE_KEYS.PRODUCTS, []);
let lastProductsFetch = 0;
let productsCacheDirty = cachedProducts.length === 0;

let cachedStock: StockItem[] = safeGetStorage<StockItem[]>(CACHE_KEYS.STOCK, []);
let lastStockFetch = 0;
let stockCacheDirty = cachedStock.length === 0;

let cachedLogs: LogEntry[] = safeGetStorage<LogEntry[]>(CACHE_KEYS.LOGS, []);
let lastLogsFetch = 0;
let logsCacheDirty = cachedLogs.length === 0;

// Cache untuk modul MT/GA/HR
const simpleItemsCache: Record<string, { data: SimpleItem[], timestamp: number }> = {};
const simpleTxCache: Record<string, { data: SimpleTransaction[], timestamp: number }> = {};

// Asynchronous background hydration from IndexedDB (handles tens of thousands of rows without 5MB quota cap)
let idbHydrationPromise: Promise<void> | null = null;
function ensureIdbReady(): Promise<void> {
  if (!idbHydrationPromise) {
    idbHydrationPromise = (async () => {
      try {
        const [p, s, l, q] = await Promise.all([
          idbStorage.get<Product[]>(CACHE_KEYS.PRODUCTS, cachedProducts),
          idbStorage.get<StockItem[]>(CACHE_KEYS.STOCK, cachedStock),
          idbStorage.get<LogEntry[]>(CACHE_KEYS.LOGS, cachedLogs),
          idbStorage.get<OfflineTask[]>(OFFLINE_QUEUE_KEY, inMemoryOfflineQueue)
        ]);

        if (Array.isArray(p) && p.length > 0) {
          cachedProducts = p;
          productsCacheDirty = false;
        }
        if (Array.isArray(s) && s.length > 0) {
          cachedStock = s;
          stockCacheDirty = false;
        }
        if (Array.isArray(l) && l.length > 0) {
          cachedLogs = l;
          logsCacheDirty = false;
        }
        if (Array.isArray(q) && q.length > 0) {
          const current = getOfflineQueue();
          const currentIds = new Set(current.map(item => item.id));
          const mergedQueue = [...current, ...q.filter(item => !currentIds.has(item.id))];
          saveOfflineQueue(mergedQueue);
        }
      } catch (err) {
        console.warn("IndexedDB hydration error, continuing with memory cache:", err);
      }
    })();
  }
  return idbHydrationPromise;
}

// Immediately trigger hydration on file load
ensureIdbReady();

/**
 * Menjamin eksekusi fungsi database dengan mekanisme auto-retry, exponential backoff,
 * dan per-attempt connection timeout (12 detik).
 * Mencegah kegagalan input akibat gangguan jaringan sementara, latency Wi-Fi gudang,
 * atau timeout koneksi Supabase.
 */
export async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3, initialDelayMs = 400, timeoutMs = 12000): Promise<T> {
  let lastError: any;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      let timerId: any;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timerId = setTimeout(() => reject(new Error(`Timeout koneksi database (${timeoutMs / 1000}s)`)), timeoutMs);
      });
      const result = await Promise.race([fn(), timeoutPromise]);
      clearTimeout(timerId);
      return result;
    } catch (err: any) {
      lastError = err;
      console.warn(`[DWH Network Retry] Percobaan ${attempt}/${maxRetries} gagal:`, err?.message || err);
      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, initialDelayMs * Math.pow(1.5, attempt - 1)));
      }
    }
  }
  throw lastError;
}

// --- OFFLINE RESILIENCE QUEUE ---
const OFFLINE_QUEUE_KEY = `bsi_dwh_offline_queue_${PROJECT_ID}`;

export interface OfflineTask {
  id: string;
  type: 'STOCK_ITEMS' | 'LOGS' | 'SIMPLE_TX' | 'UPDATE_STOCK_ITEM' | 'PRODUCT_BALANCE';
  payload: any;
  timestamp: number;
}

let inMemoryOfflineQueue: OfflineTask[] = safeGetStorage<OfflineTask[]>(OFFLINE_QUEUE_KEY, []);

function getOfflineQueue(): OfflineTask[] {
  try {
    const raw = localStorage.getItem(OFFLINE_QUEUE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        inMemoryOfflineQueue = parsed;
        return parsed;
      }
    }
  } catch { }
  return inMemoryOfflineQueue;
}

function saveOfflineQueue(queue: OfflineTask[]): void {
  inMemoryOfflineQueue = queue;
  try {
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
  } catch (e) {
    console.warn("localStorage quota reached, persisted to IndexedDB only", e);
  }
  idbStorage.set(OFFLINE_QUEUE_KEY, queue).catch(() => { });
}

function enqueueOffline(type: OfflineTask['type'], payload: any): void {
  const queue = getOfflineQueue();
  queue.push({
    id: `queue-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
    type,
    payload,
    timestamp: Date.now()
  });
  saveOfflineQueue(queue);
  console.info(`[DWH Offline Queue] Disimpan ke antrean offline: ${type}`);
}

export const db = {
  getCachedProducts: (): Product[] => cachedProducts,
  getCachedStock: (): StockItem[] => cachedStock,
  getCachedLogs: (): LogEntry[] => cachedLogs,

  invalidateProductsCache: () => { productsCacheDirty = true; },
  invalidateStockCache: () => { stockCacheDirty = true; },
  invalidateLogsCache: () => { logsCacheDirty = true; },
  clearAllCache: () => {
    productsCacheDirty = true;
    stockCacheDirty = true;
    logsCacheDirty = true;
    lastProductsFetch = 0;
    lastStockFetch = 0;
    lastLogsFetch = 0;
  },

  login: async (user: string, pass: string): Promise<{ success: boolean, user?: User, message?: string }> => {
    try {
      const { data, error } = await supabase
        .from('users')
        .select('username, role')
        .eq('username', user)
        .eq('password', pass)
        .single();

      if (error || !data) return { success: false, message: "Username atau Password salah." };

      await supabase.from('users').update({ last_seen: new Date().toISOString() }).eq('username', user);

      return {
        success: true,
        user: { username: data.username, role: data.role as any }
      };
    } catch (e) {
      return { success: false, message: "Koneksi database gagal." };
    }
  },

  updatePresence: async (username: string): Promise<void> => {
    await supabase
      .from('users')
      .update({ last_seen: new Date().toISOString() })
      .eq('username', username);
  },

  getOnlineUsers: async (): Promise<{ username: string, role: string }[]> => {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from('users')
      .select('username, role')
      .gt('last_seen', fiveMinutesAgo);

    if (error) return [];
    return data || [];
  },

  verifyPassword: async (username: string, pass: string): Promise<boolean> => {
    const { data, error } = await supabase
      .from('users')
      .select('id')
      .eq('username', username)
      .eq('password', pass)
      .single();
    return !!data && !error;
  },

  getProducts: async (forceFresh = false): Promise<Product[]> => {
    await ensureIdbReady();
    const now = Date.now();
    // Cache TTL 3 menit jika tidak dirty/forced (realtime websocket menginvalidaasi otomatis jika ada update)
    if (!forceFresh && !productsCacheDirty && cachedProducts.length > 0 && (now - lastProductsFetch < 180000)) {
      return cachedProducts;
    }

    try {
      const { count } = await supabase.from('products').select('id', { count: 'exact', head: true });
      const total = count || 0;
      const pageSize = 1000;
      const numPages = Math.max(1, Math.ceil(total / pageSize));

      const promises = [];
      for (let i = 0; i < numPages; i++) {
        promises.push(
          supabase
            .from('products')
            .select('id, name, category, unit, initial_stock, safety_stock, stock, is_active')
            .order('id', { ascending: true })
            .range(i * pageSize, (i + 1) * pageSize - 1)
            .then(r => r.data || [])
        );
      }

      const chunks = await Promise.all(promises);
      const allData = chunks.flat();

      if (allData.length > 0) {
        const mapped = allData.map(item => ({
          id: item.id,
          name: item.name,
          category: item.category,
          unit: item.unit,
          initialStock: item.initial_stock,
          safetyStock: item.safety_stock,
          stockToday: item.stock || 0,
          isActive: item.is_active !== false // Default true if null
        }));
        cachedProducts = mapped;
        productsCacheDirty = false;
        lastProductsFetch = now;
        idbStorage.set(CACHE_KEYS.PRODUCTS, mapped);
        safeSetStorage(CACHE_KEYS.PRODUCTS, mapped.slice(0, 500));
        return mapped;
      }
    } catch (e) {
      console.warn("getProducts network/quota warning, using cached:", e);
    }

    if (cachedProducts.length > 0) return cachedProducts;
    return [];
  },

  upsertProduct: async (product: Product): Promise<void> => {
    productsCacheDirty = true;
    const payload = {
      id: product.id,
      name: product.name,
      category: product.category,
      unit: product.unit,
      initial_stock: product.initialStock || 0,
      safety_stock: product.safetyStock || 0,
      stock: product.stockToday || 0,
      is_active: product.isActive !== false
    };
    const { error } = await supabase.from('products').upsert(payload);
    if (error) throw error;
  },

  updateProductBalance: async (productName: string, qtyChange: number, allowQueue = true): Promise<void> => {
    productsCacheDirty = true;
    const cleanName = (productName || '').trim();
    if (!cleanName) return;

    try {
      let prod: any = null;
      await withRetry(async () => {
        const { data, error } = await supabase
          .from('products')
          .select('id, stock')
          .eq('name', cleanName)
          .maybeSingle();

        if (!error && data) {
          prod = data;
          return;
        }

        const { data: dataIlike } = await supabase
          .from('products')
          .select('id, stock')
          .ilike('name', cleanName)
          .maybeSingle();

        if (dataIlike) prod = dataIlike;
      });

      if (!prod) return;

      const newStock = (Number(prod.stock) || 0) + qtyChange;
      await withRetry(async () => {
        const { error: updateErr } = await supabase
          .from('products')
          .update({ stock: newStock })
          .eq('id', prod.id);

        if (updateErr) throw updateErr;
      });
    } catch (err) {
      console.error("updateProductBalance error:", err);
      if (allowQueue) {
        enqueueOffline('PRODUCT_BALANCE', { productName, qtyChange });
      }
    }
  },

  updateStockItemBalance: async (uniqueId: string, qtyChange: number): Promise<void> => {
    stockCacheDirty = true;
    if (!uniqueId || uniqueId === 'SYSTEM-MIGRATION') return;

    try {
      let item: any = null;
      await withRetry(async () => {
        const { data, error: fetchErr } = await supabase
          .from('stock_items')
          .select('quantity')
          .eq('unique_id', uniqueId)
          .maybeSingle();

        if (!fetchErr && data) item = data;
      });

      if (!item) return;

      const newQty = (Number(item.quantity) || 0) + qtyChange;
      await withRetry(async () => {
        const { error: updateErr } = await supabase
          .from('stock_items')
          .update({
            quantity: newQty,
            status: newQty > 0 ? ItemStatus.IN_STOCK : ItemStatus.OUTBOUND
          })
          .eq('unique_id', uniqueId);

        if (updateErr) throw updateErr;
      });
    } catch (err) {
      console.error("updateStockItemBalance error:", err);
    }
  },

  deleteLogAndReverse: async (log: LogEntry): Promise<void> => {
    logsCacheDirty = true;
    productsCacheDirty = true;
    stockCacheDirty = true;
    // 1. Delete log
    const { error: logErr } = await supabase.from('logs').delete().eq('id', log.id);
    if (logErr) throw logErr;

    // Optimistic cache update
    cachedLogs = cachedLogs.filter(l => l.id !== log.id);
    idbStorage.set(CACHE_KEYS.LOGS, cachedLogs);
    safeSetStorage(CACHE_KEYS.LOGS, cachedLogs.slice(0, 500));

    // 2. Reverse product balance
    await db.updateProductBalance(log.productName, -(log.quantityChange || 0));

    // 3. Reverse batch/stock item balance
    if (log.stockItemId && log.stockItemId !== 'SYSTEM-MIGRATION') {
      await db.updateStockItemBalance(log.stockItemId, -(log.quantityChange || 0));
    }
  },

  updateLogAndAdjust: async (log: LogEntry, newQtyChange: number, updates: { note?: string, recipient?: string }): Promise<void> => {
    logsCacheDirty = true;
    productsCacheDirty = true;
    stockCacheDirty = true;
    const diff = newQtyChange - (log.quantityChange || 0);

    // 1. Update log
    const { error: logErr } = await supabase.from('logs').update({
      quantity_change: newQtyChange,
      ...updates
    }).eq('id', log.id);
    if (logErr) throw logErr;

    // Optimistic cache update
    cachedLogs = cachedLogs.map(l => l.id === log.id ? { ...l, quantityChange: newQtyChange, ...updates } : l);
    idbStorage.set(CACHE_KEYS.LOGS, cachedLogs);
    safeSetStorage(CACHE_KEYS.LOGS, cachedLogs.slice(0, 500));

    if (diff !== 0) {
      // 2. Adjust product balance
      await db.updateProductBalance(log.productName, diff);

      // 3. Adjust batch/stock item balance
      if (log.stockItemId && log.stockItemId !== 'SYSTEM-MIGRATION') {
        await db.updateStockItemBalance(log.stockItemId, diff);
      }
    }
  },

  recalculateProductStock: async (productId: string): Promise<void> => {
    productsCacheDirty = true;
    const { data: product, error: pErr } = await supabase
      .from('products')
      .select('id, name, initial_stock')
      .eq('id', productId)
      .single();

    if (pErr || !product) return;

    const { data: logs, error: lErr } = await supabase
      .from('logs')
      .select('quantity_change')
      .eq('product_name', product.name);

    if (lErr) throw lErr;

    const totalMutation = (logs || []).reduce((acc, l) => acc + (Number(l.quantity_change) || 0), 0);
    const correctStock = (Number(product.initial_stock) || 0) + totalMutation;

    const { error: uErr } = await supabase
      .from('products')
      .update({ stock: correctStock })
      .eq('id', productId);

    if (uErr) throw uErr;
  },

  deleteProduct: async (productId: string): Promise<void> => {
    productsCacheDirty = true;
    const { error } = await supabase.from('products').delete().eq('id', productId);
    if (error) throw error;
    cachedProducts = cachedProducts.filter(p => p.id !== productId);
    safeSetStorage(CACHE_KEYS.PRODUCTS, cachedProducts);
  },

  getAllStock: async (forceFresh = false): Promise<StockItem[]> => {
    await ensureIdbReady();
    const now = Date.now();
    // Cache valid for 3 minutes if not dirty/forced (realtime websocket already invalidates on changes)
    if (!forceFresh && !stockCacheDirty && cachedStock.length > 0 && (now - lastStockFetch < 180000)) {
      return cachedStock;
    }

    try {
      const { count } = await supabase.from('stock_items').select('unique_id', { count: 'exact', head: true });
      const total = count || 0;
      const pageSize = 1000;
      const numPages = Math.max(1, Math.ceil(total / pageSize));

      const promises = [];
      for (let i = 0; i < numPages; i++) {
        promises.push(
          supabase
            .from('stock_items')
            .select('unique_id, product_id, product_name, batch_code, arrival_date, expiry_date, supplier, status, created_at_ts, quantity, note')
            .order('created_at_ts', { ascending: false })
            .range(i * pageSize, (i + 1) * pageSize - 1)
            .then(r => r.data || [])
        );
      }

      const chunks = await Promise.all(promises);
      const allData = chunks.flat();

      if (allData.length > 0) {
        const mapped = allData.map(s => ({
          id: s.unique_id,
          uniqueId: s.unique_id,
          productId: s.product_id,
          productName: s.product_name,
          batchCode: s.batch_code,
          arrivalDate: s.arrival_date,
          expiryDate: s.expiry_date,
          supplier: s.supplier,
          status: s.status as ItemStatus,
          createdAt: s.created_at_ts,
          quantity: s.quantity,
          note: s.note
        }));
        // Cegah inputan hilang: Pertahankan batch lokal yang baru dibuat / diperbarui (< 10 menit)
        const fetchedUniqueIds = new Set(mapped.map(s => s.uniqueId));
        const nowTs = Date.now();
        const pendingLocal = cachedStock.filter(s => !fetchedUniqueIds.has(s.uniqueId) && (nowTs - (Number(s.createdAt) || 0) < 600000));

        // Sertakan juga dari antrean offline jika ada
        const currentQueue = getOfflineQueue();
        currentQueue.forEach(task => {
          if (task.type === 'STOCK_ITEMS' && Array.isArray(task.payload)) {
            task.payload.forEach((item: StockItem) => {
              if (!fetchedUniqueIds.has(item.uniqueId) && !pendingLocal.some(p => p.uniqueId === item.uniqueId)) {
                pendingLocal.push(item);
              }
            });
          }
        });

        const mergedStock = [...mapped, ...pendingLocal];
        cachedStock = mergedStock;
        stockCacheDirty = false;
        lastStockFetch = now;
        idbStorage.set(CACHE_KEYS.STOCK, mergedStock);
        safeSetStorage(CACHE_KEYS.STOCK, mergedStock.slice(0, 500));
        return mergedStock;
      }
    } catch (e) {
      console.warn("getAllStock warning, using cached:", e);
    }

    if (cachedStock.length > 0) return cachedStock;
    return [];
  },

  getAllLogs: async (forceFresh = false): Promise<LogEntry[]> => {
    await ensureIdbReady();
    const now = Date.now();

    try {
      // 1. FAST DELTA SYNC (Penghematan Egress s/d 99.9%):
      // Jika data sudah ada di local cache (IndexedDB/RAM) dan bukan forced refresh,
      // kita HANYA mengambil mutasi baru yang timestamp-nya lebih besar dari data lokal.
      if (!forceFresh && !logsCacheDirty && cachedLogs.length > 0) {
        if (now - lastLogsFetch < 45000) {
          return cachedLogs;
        }

        const maxTs = cachedLogs.reduce((max, l) => (Number(l.timestamp) || 0) > max ? Number(l.timestamp) : max, 0);
        const { data: deltaLogs, error: deltaErr } = await supabase
          .from('logs')
          .select('id, type, stock_item_id, product_name, timestamp, recipient, note, quantity_change, user')
          .gt('timestamp', maxTs)
          .order('timestamp', { ascending: false });

        if (!deltaErr && deltaLogs) {
          lastLogsFetch = now;
          if (deltaLogs.length === 0) {
            // Egress hanya ~150 byte header HTTP tanpa payload baris data
            return cachedLogs;
          }

          const mappedDelta: LogEntry[] = deltaLogs.map(l => ({
            id: l.id,
            type: l.type,
            stockItemId: l.stock_item_id,
            productName: l.product_name,
            timestamp: Number(l.timestamp) || 0,
            recipient: l.recipient,
            note: l.note,
            quantityChange: Number(l.quantity_change) || 0,
            user: l.user
          }));

          const idSet = new Set(mappedDelta.map(l => l.id));
          cachedLogs = [...mappedDelta, ...cachedLogs.filter(l => !idSet.has(l.id))];
          cachedLogs.sort((a, b) => (Number(b.timestamp) || 0) - (Number(a.timestamp) || 0));
          idbStorage.set(CACHE_KEYS.LOGS, cachedLogs);
          safeSetStorage(CACHE_KEYS.LOGS, cachedLogs.slice(0, 500));
          return cachedLogs;
        }
      }

      // 2. FULL PARALLEL MULTI-PAGE FETCH:
      // Hanya dijalankan pada saat buka pertama kali jika cache benar-benar kosong, atau saat tombol 'Refresh' ditekan.
      const { count } = await supabase.from('logs').select('id', { count: 'exact', head: true });
      const total = count || 0;
      const pageSize = 1000;
      const numPages = Math.max(1, Math.ceil(total / pageSize));

      const promises = [];
      for (let i = 0; i < numPages; i++) {
        promises.push(
          supabase
            .from('logs')
            .select('id, type, stock_item_id, product_name, timestamp, recipient, note, quantity_change, user')
            .order('timestamp', { ascending: false })
            .range(i * pageSize, (i + 1) * pageSize - 1)
            .then(r => r.data || [])
        );
      }

      const chunks = await Promise.all(promises);
      const allData = chunks.flat();

      if (allData.length > 0) {
        const mapped = allData.map(l => ({
          id: l.id,
          type: l.type,
          stockItemId: l.stock_item_id,
          productName: l.product_name,
          timestamp: Number(l.timestamp) || 0,
          recipient: l.recipient,
          note: l.note,
          quantityChange: Number(l.quantity_change) || 0,
          user: l.user
        }));

        // Cegah inputan hilang: Pertahankan log lokal yang baru masuk (< 10 menit) atau yang masih di antrean offline
        const fetchedIdSet = new Set(mapped.map(l => l.id));
        const nowTs = Date.now();
        const pendingLocal = cachedLogs.filter(l => !fetchedIdSet.has(l.id) && (nowTs - (Number(l.timestamp) || 0) < 600000));

        const offlineQueue = getOfflineQueue();
        const offlineLogs: LogEntry[] = [];
        offlineQueue.forEach(task => {
          if (task.type === 'LOGS' && Array.isArray(task.payload)) {
            task.payload.forEach((item: LogEntry) => {
              if (!fetchedIdSet.has(item.id) && !pendingLocal.some(p => p.id === item.id) && !offlineLogs.some(o => o.id === item.id)) {
                offlineLogs.push(item);
              }
            });
          }
        });

        const mergedLogs = [...pendingLocal, ...offlineLogs, ...mapped];
        mergedLogs.sort((a, b) => (Number(b.timestamp) || 0) - (Number(a.timestamp) || 0));

        cachedLogs = mergedLogs;
        logsCacheDirty = false;
        lastLogsFetch = now;
        idbStorage.set(CACHE_KEYS.LOGS, mergedLogs);
        safeSetStorage(CACHE_KEYS.LOGS, mergedLogs.slice(0, 500));
        return mergedLogs;
      }
    } catch (e) {
      console.warn("getAllLogs warning, using cached:", e);
    }

    if (cachedLogs.length > 0) return cachedLogs;
    return [];
  },

  addStockItems: async (items: StockItem[], allowQueue = true): Promise<void> => {
    stockCacheDirty = true;
    productsCacheDirty = true;

    // Optimistic in-memory and IndexedDB cache update immediately
    const existingMap = new Map(cachedStock.map(s => [s.uniqueId, s]));
    items.forEach(item => existingMap.set(item.uniqueId, item));
    cachedStock = Array.from(existingMap.values());
    idbStorage.set(CACHE_KEYS.STOCK, cachedStock);
    safeSetStorage(CACHE_KEYS.STOCK, cachedStock.slice(0, 500));

    try {
      for (const item of items) {
        await withRetry(async () => {
          const payload = {
            unique_id: item.uniqueId,
            product_id: item.productId,
            product_name: item.productName,
            batch_code: item.batchCode || null,
            arrival_date: item.arrivalDate,
            expiry_date: item.expiryDate || null,
            supplier: item.supplier,
            status: item.status,
            created_at_ts: item.createdAt || Date.now(),
            quantity: item.quantity,
            note: item.note || null
          };
          const { error } = await supabase
            .from('stock_items')
            .upsert(payload, { onConflict: 'unique_id' });
          if (error) throw error;
        });
      }
    } catch (err) {
      console.error("addStockItems network error:", err);
      if (allowQueue) {
        enqueueOffline('STOCK_ITEMS', items);
      } else {
        throw err;
      }
    }
  },

  updateStockItem: async (item: StockItem, allowQueue = true): Promise<void> => {
    stockCacheDirty = true;
    productsCacheDirty = true;

    // Optimistic cache update
    cachedStock = cachedStock.map(s => s.uniqueId === item.uniqueId ? item : s);
    idbStorage.set(CACHE_KEYS.STOCK, cachedStock);
    safeSetStorage(CACHE_KEYS.STOCK, cachedStock.slice(0, 500));

    try {
      await withRetry(async () => {
        // Jika item virtual legacy (uniqueId === productId), tidak perlu update stock_items
        if (item.uniqueId === item.productId || item.uniqueId === 'SYSTEM-MIGRATION') {
          return;
        }
        const { error } = await supabase
          .from('stock_items')
          .update({
            status: item.status,
            quantity: item.quantity,
            note: item.note
          })
          .eq('unique_id', item.uniqueId);
        if (error) throw error;
      });
    } catch (err) {
      console.error("updateStockItem error:", err);
      if (allowQueue) {
        enqueueOffline('UPDATE_STOCK_ITEM', item);
      } else {
        throw err;
      }
    }
  },

  extendExpiryDate: async (uniqueId: string, newExpiryDate: string): Promise<void> => {
    stockCacheDirty = true;
    const { data: item } = await supabase.from('stock_items').select('note, expiry_date').eq('unique_id', uniqueId).single();
    let updatedNote = item?.note || '';
    if (!updatedNote.includes(`[EXT_FROM:${item?.expiry_date}]`)) {
      updatedNote = updatedNote ? updatedNote + ` [EXTENDED] [EXT_FROM:${item?.expiry_date}]` : `[EXTENDED] [EXT_FROM:${item?.expiry_date}]`;
    }
    await withRetry(async () => {
      const { error } = await supabase
        .from('stock_items')
        .update({ expiry_date: newExpiryDate, note: updatedNote })
        .eq('unique_id', uniqueId);
      if (error) throw error;
    });
  },

  addLogEntries: async (logs: LogEntry[], allowQueue = true): Promise<void> => {
    logsCacheDirty = true;
    productsCacheDirty = true;

    // Optimistic cache update immediately so it is never lost from view
    const currentMap = new Map(cachedLogs.map(l => [l.id, l]));
    logs.forEach(l => currentMap.set(l.id, l));
    cachedLogs = Array.from(currentMap.values()).sort((a, b) => (Number(b.timestamp) || 0) - (Number(a.timestamp) || 0));
    idbStorage.set(CACHE_KEYS.LOGS, cachedLogs);
    safeSetStorage(CACHE_KEYS.LOGS, cachedLogs.slice(0, 500));

    const payload = logs.map(l => ({
      id: l.id,
      type: l.type,
      stock_item_id: l.stockItemId,
      product_name: l.productName,
      timestamp: l.timestamp,
      recipient: l.recipient,
      note: l.note,
      quantity_change: l.quantityChange,
      user: l.user
    }));

    try {
      await withRetry(async () => {
        const { error } = await supabase.from('logs').upsert(payload, { onConflict: 'id' });
        if (error) throw error;
      });

      for (const log of logs) {
        if (log.quantityChange !== undefined && log.quantityChange !== 0) {
          await db.updateProductBalance(log.productName, log.quantityChange);
        }
      }
    } catch (err) {
      console.error("addLogEntries network error:", err);
      if (allowQueue) {
        enqueueOffline('LOGS', logs);
      } else {
        throw err;
      }
    }
  },

  // --- MT & GA SPECIFIC FUNCTIONS (OPTIMIZED FOR ZERO-WASTE EGRESS) ---

  getSimpleItems: async (module: 'MT' | 'GA' | 'HR', forceFresh = false): Promise<SimpleItem[]> => {
    await ensureIdbReady();
    const now = Date.now();
    const cacheKey = `${CACHE_KEYS.SIMPLE_ITEMS}_${module}`;

    // Check in-memory cache
    let cached = simpleItemsCache[module]?.data;
    if (!cached || cached.length === 0) {
      cached = await idbStorage.get<SimpleItem[]>(cacheKey, []);
      if (cached && cached.length > 0) {
        simpleItemsCache[module] = { data: cached, timestamp: now };
      }
    }

    if (!forceFresh && cached && cached.length > 0 && (now - (simpleItemsCache[module]?.timestamp || 0) < 180000)) {
      return cached;
    }

    try {
      const { count } = await supabase.from('simple_master_items').select('id', { count: 'exact', head: true }).eq('module', module);
      const total = count || 0;
      const pageSize = 1000;
      const numPages = Math.max(1, Math.ceil(total / pageSize));

      const promises = [];
      for (let i = 0; i < numPages; i++) {
        promises.push(
          supabase
            .from('simple_master_items')
            .select('id, name, unit, module, initial_stock')
            .eq('module', module)
            .order('name', { ascending: true })
            .range(i * pageSize, (i + 1) * pageSize - 1)
            .then(r => r.data || [])
        );
      }

      const chunks = await Promise.all(promises);
      const allData = chunks.flat();

      const mapped = allData.map(item => ({
        id: item.id,
        name: item.name,
        unit: item.unit,
        module: item.module,
        initialStock: Number(item.initial_stock) || 0
      }));
      simpleItemsCache[module] = { data: mapped, timestamp: now };
      idbStorage.set(cacheKey, mapped);
      return mapped;
    } catch {
      if (cached && cached.length > 0) return cached;
      return [];
    }
  },

  getSimpleTransactions: async (module: 'MT' | 'GA' | 'HR', forceFresh = false): Promise<SimpleTransaction[]> => {
    await ensureIdbReady();
    const now = Date.now();
    const cacheKey = `${CACHE_KEYS.SIMPLE_TX}_${module}`;

    // Check memory then IndexedDB
    let cached = simpleTxCache[module]?.data;
    if (!cached || cached.length === 0) {
      cached = await idbStorage.get<SimpleTransaction[]>(cacheKey, []);
      if (cached && cached.length > 0) {
        // Do not set timestamp to 'now' so delta sync is not blocked on initial memory hydration
        simpleTxCache[module] = { data: cached, timestamp: 0 };
      }
    }

    // DELTA SYNC UNTUK SIMPLE TRANSACTIONS:
    // Hanya ambil transaksi baru jika sudah ada data lokal dan bukan forceFresh
    if (!forceFresh && cached && cached.length > 0) {
      // Jika baru saja disinkronkan kurang dari 15 detik lalu, gunakan cache
      if (simpleTxCache[module]?.timestamp && (now - simpleTxCache[module].timestamp < 15000)) {
        return cached;
      }

      const maxTs = cached.reduce((max, t) => (Number(t.timestamp) || 0) > max ? Number(t.timestamp) : max, 0);
      const { data: delta, error: deltaErr } = await supabase
        .from('simple_transactions')
        .select('id, timestamp, type, item_name, quantity, unit, supplier, recipient, officer, note, module')
        .eq('module', module)
        .gt('timestamp', maxTs)
        .order('timestamp', { ascending: false });

      if (!deltaErr && delta) {
        if (delta.length === 0) {
          simpleTxCache[module] = { data: cached, timestamp: now };
          return cached;
        }

        const mappedDelta: SimpleTransaction[] = delta.map(t => ({
          id: t.id,
          timestamp: Number(t.timestamp) || 0,
          type: t.type,
          itemName: t.item_name,
          quantity: t.quantity,
          unit: t.unit,
          supplier: t.supplier,
          recipient: t.recipient,
          officer: t.officer,
          note: t.note,
          module: t.module
        }));

        const idSet = new Set(mappedDelta.map(d => d.id));
        const merged = [...mappedDelta, ...cached.filter(c => !idSet.has(c.id))];
        merged.sort((a, b) => (Number(b.timestamp) || 0) - (Number(a.timestamp) || 0));
        simpleTxCache[module] = { data: merged, timestamp: now };
        idbStorage.set(cacheKey, merged);
        return merged;
      }
    }

    try {
      const { count } = await supabase.from('simple_transactions').select('id', { count: 'exact', head: true }).eq('module', module);
      const total = count || 0;
      const pageSize = 1000;
      const numPages = Math.max(1, Math.ceil(total / pageSize));

      const promises = [];
      for (let i = 0; i < numPages; i++) {
        promises.push(
          supabase
            .from('simple_transactions')
            .select('id, timestamp, type, item_name, quantity, unit, supplier, recipient, officer, note, module')
            .eq('module', module)
            .order('timestamp', { ascending: false })
            .range(i * pageSize, (i + 1) * pageSize - 1)
            .then(r => r.data || [])
        );
      }

      const chunks = await Promise.all(promises);
      const allData = chunks.flat();

      const mapped = allData.map(t => ({
        id: t.id,
        timestamp: Number(t.timestamp) || 0,
        type: t.type,
        itemName: t.item_name,
        quantity: t.quantity,
        unit: t.unit,
        supplier: t.supplier,
        recipient: t.recipient,
        officer: t.officer,
        note: t.note,
        module: t.module
      }));

      // Cegah transaksi baru hilang jika Supabase lag: pertahankan transaksi lokal baru (< 10 menit)
      const fetchedIdSet = new Set(mapped.map(t => t.id));
      const nowTs = Date.now();
      const pendingLocal = (cached || []).filter(t => !fetchedIdSet.has(t.id) && (nowTs - (Number(t.timestamp) || 0) < 600000));

      // Cek juga dari offline queue
      const currentQueue = getOfflineQueue();
      currentQueue.forEach(task => {
        if (task.type === 'SIMPLE_TX' && task.payload && task.payload.module === module) {
          const txItem = task.payload as SimpleTransaction;
          if (!fetchedIdSet.has(txItem.id) && !pendingLocal.some(p => p.id === txItem.id)) {
            pendingLocal.push(txItem);
          }
        }
      });

      const merged = [...pendingLocal, ...mapped];
      merged.sort((a, b) => (Number(b.timestamp) || 0) - (Number(a.timestamp) || 0));

      simpleTxCache[module] = { data: merged, timestamp: now };
      idbStorage.set(cacheKey, merged);
      return merged;
    } catch {
      if (cached && cached.length > 0) return cached;
      return [];
    }
  },

  addSimpleTransaction: async (tx: SimpleTransaction, allowQueue = true): Promise<SimpleTransaction> => {
    delete simpleItemsCache[tx.module];

    const savedTx: SimpleTransaction = {
      id: tx.id || `tx-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      timestamp: tx.timestamp || Date.now(),
      type: tx.type,
      itemName: (tx.itemName || '').trim().toUpperCase(),
      quantity: Number(tx.quantity) || 0,
      unit: tx.unit || 'Pcs',
      supplier: tx.supplier || undefined,
      recipient: tx.recipient || undefined,
      officer: tx.officer,
      note: tx.note || undefined,
      module: tx.module
    };

    // Optimistic cache update in memory and in IndexedDB immediately
    const cacheKey = `${CACHE_KEYS.SIMPLE_TX}_${tx.module}`;
    const prevCached = simpleTxCache[tx.module]?.data || await idbStorage.get<SimpleTransaction[]>(cacheKey, []);
    const updated = [savedTx, ...prevCached.filter(t => t.id !== savedTx.id)];
    simpleTxCache[tx.module] = { data: updated, timestamp: Date.now() };
    await idbStorage.set(cacheKey, updated);

    try {
      // 1. Registrasi master item jika belum ada (non-fatal, jangan gagalkan transaksi utama jika master item gagal)
      try {
        await withRetry(async () => {
          const { data: existing } = await supabase
            .from('simple_master_items')
            .select('id')
            .ilike('name', savedTx.itemName)
            .eq('module', savedTx.module)
            .maybeSingle();

          if (!existing) {
            await supabase.from('simple_master_items').insert({
              name: savedTx.itemName,
              unit: savedTx.unit,
              module: savedTx.module,
              initial_stock: 0
            });
          }
        }, 2, 200, 5000);
      } catch (masterErr) {
        console.warn("Registrasi simple master item non-fatal warning:", masterErr);
      }

      // 2. Simpan transaksi utama ke Supabase
      const payload = {
        timestamp: savedTx.timestamp,
        type: savedTx.type,
        item_name: savedTx.itemName,
        quantity: savedTx.quantity,
        unit: savedTx.unit,
        supplier: savedTx.supplier || null,
        recipient: savedTx.recipient || null,
        officer: savedTx.officer,
        note: savedTx.note || null,
        module: savedTx.module
      };

      await withRetry(async () => {
        const { data, error = null } = await supabase
          .from('simple_transactions')
          .insert(payload)
          .select('id')
          .single();

        if (error) throw error;
        if (data?.id) {
          const oldTempId = savedTx.id;
          savedTx.id = data.id;
          if (oldTempId !== data.id) {
            const currentCached = simpleTxCache[savedTx.module]?.data || [];
            const synced = currentCached.map(t => t.id === oldTempId ? { ...t, id: data.id } : t);
            simpleTxCache[savedTx.module] = { data: synced, timestamp: Date.now() };
            idbStorage.set(cacheKey, synced);
          }
        }
      });
    } catch (err) {
      console.error("addSimpleTransaction error:", err);
      if (allowQueue) {
        enqueueOffline('SIMPLE_TX', savedTx);
      } else {
        throw err;
      }
    }

    return savedTx;
  },

  flushOfflineQueue: async (): Promise<number> => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return 0;
    const queue = getOfflineQueue();
    if (queue.length === 0) return 0;

    const remaining: OfflineTask[] = [];
    let processed = 0;

    for (const task of queue) {
      try {
        if (task.type === 'STOCK_ITEMS') {
          await db.addStockItems(task.payload, false);
        } else if (task.type === 'LOGS') {
          await db.addLogEntries(task.payload, false);
        } else if (task.type === 'SIMPLE_TX') {
          await db.addSimpleTransaction(task.payload, false);
        } else if (task.type === 'UPDATE_STOCK_ITEM') {
          await db.updateStockItem(task.payload, false);
        } else if (task.type === 'PRODUCT_BALANCE') {
          await db.updateProductBalance(task.payload.productName, task.payload.qtyChange, false);
        }
        processed++;
      } catch (err: any) {
        const errMsg = String(err?.message || err);
        if (errMsg.includes('duplicate key') || errMsg.includes('already exists') || errMsg.includes('23505')) {
          console.info(`[DWH Offline Queue] Task ${task.id} sudah ada di database, tandai selesai.`);
          processed++;
        } else {
          console.warn(`[DWH Offline Queue] Gagal memproses task ${task.id}:`, err);
          remaining.push(task);
        }
      }
    }

    saveOfflineQueue(remaining);
    return processed;
  },

  getPendingOfflineCount: (): number => {
    return getOfflineQueue().length;
  },

  getOpnameRequests: async (forceFresh = false): Promise<OpnameRequest[]> => {
    const now = Date.now();
    if (!forceFresh && (db as any)._cachedOpname && (now - (db as any)._lastOpnameFetch < 60000)) {
      return (db as any)._cachedOpname;
    }

    try {
      const { count } = await supabase.from('opname_requests').select('id', { count: 'exact', head: true });
      const total = count || 0;
      const pageSize = 1000;
      const numPages = Math.max(1, Math.ceil(total / pageSize));

      const promises = [];
      for (let i = 0; i < numPages; i++) {
        promises.push(
          supabase
            .from('opname_requests')
            .select('id, product_id, product_name, batch_code, system_qty, physical_qty, variance, note, is_initial_adj, reference_date, submitted_by, submitted_at, status')
            .order('submitted_at', { ascending: false })
            .range(i * pageSize, (i + 1) * pageSize - 1)
            .then(r => r.data || [])
        );
      }

      const chunks = await Promise.all(promises);
      const allData = chunks.flat();

      const mapped = allData.map(r => ({
        id: r.id,
        productId: r.product_id,
        productName: r.product_name,
        batchCode: r.batch_code,
        systemQty: r.system_qty,
        physicalQty: r.physical_qty,
        variance: r.variance,
        note: r.note,
        isInitialStockAdjustment: r.is_initial_adj,
        referenceDate: r.reference_date,
        submittedBy: r.submitted_by,
        submittedAt: r.submitted_at,
        status: r.status
      }));
      (db as any)._cachedOpname = mapped;
      (db as any)._lastOpnameFetch = now;
      return mapped;
    } catch {
      return (db as any)._cachedOpname || [];
    }
  },

  submitOpnameRequest: async (request: Partial<OpnameRequest>): Promise<void> => {
    (db as any)._lastOpnameFetch = 0;
    const payload = {
      product_id: request.productId,
      product_name: request.productName,
      batch_code: request.batchCode,
      system_qty: request.systemQty,
      physical_qty: request.physicalQty,
      variance: request.variance,
      note: request.note,
      is_initial_adj: request.isInitialStockAdjustment,
      reference_date: request.referenceDate,
      submitted_by: request.submittedBy,
      submitted_at: Date.now(),
      status: 'PENDING'
    };
    const { error } = await supabase.from('opname_requests').insert(payload);
    if (error) throw error;
  },

  updateOpnameStatus: async (requestId: string, status: 'APPROVED' | 'REJECTED'): Promise<void> => {
    (db as any)._lastOpnameFetch = 0;
    const { error } = await supabase
      .from('opname_requests')
      .update({ status })
      .eq('id', requestId);
    if (error) throw error;
  },

  updateInitialStock: async (productId: string, newInitialQty: number): Promise<void> => {
    productsCacheDirty = true;
    const { error } = await supabase
      .from('products')
      .update({ initial_stock: newInitialQty })
      .eq('id', productId);
    if (error) throw error;
    await db.recalculateProductStock(productId);
  }
};

// Auto-flush antrean offline saat koneksi pulih atau secara periodik
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    console.info('[DWH Offline Resilience] Perangkat kembali online, memproses antrean...');
    db.flushOfflineQueue();
  });
  // Periksa antrean offline setiap 20 detik jika ada transaksi yang tertunda
  setInterval(() => {
    if (typeof navigator !== 'undefined' && navigator.onLine) {
      db.flushOfflineQueue();
    }
  }, 20000);
}