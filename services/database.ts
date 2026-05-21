import { createClient } from '@supabase/supabase-js';
import { StockItem, LogEntry, Product, InventorySummary, User, ItemStatus, OpnameRequest, SimpleItem, SimpleTransaction } from '../types.ts';

const SUPABASE_URL = "https://rvddbgirgevteifjjjud.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_s4U5py44CncLoJmNOPxFKA_JHACcSlQ";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export const db = {
  login: async (user: string, pass: string): Promise<{success: boolean, user?: User, message?: string}> => {
    try {
      const { data, error } = await supabase
        .from('users')
        .select('*')
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

  getOnlineUsers: async (): Promise<{username: string, role: string}[]> => {
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

  getProducts: async (): Promise<Product[]> => {
    let allData: any[] = [];
    let page = 0;
    const pageSize = 1000;
    
    while (true) {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .order('id', { ascending: true })
        .range(page * pageSize, (page + 1) * pageSize - 1);
      
      if (error || !data || data.length === 0) break;
      allData = [...allData, ...data];
      if (data.length < pageSize) break;
      page++;
      if (page > 10) break; // Safety
    }
    
    return allData.map(item => ({
      id: item.id,
      name: item.name,
      category: item.category,
      unit: item.unit,
      initialStock: item.initial_stock,
      safetyStock: item.safety_stock,
      stockToday: item.stock || 0,
      isActive: item.is_active !== false // Default true if null
    }));
  },

  upsertProduct: async (product: Product): Promise<void> => {
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

  updateProductBalance: async (productName: string, qtyChange: number): Promise<void> => {
    const { data: prod, error: fetchErr } = await supabase
      .from('products')
      .select('id, stock')
      .eq('name', productName)
      .single();

    if (fetchErr || !prod) return;

    const newStock = (prod.stock || 0) + qtyChange;
    const { error: updateErr } = await supabase
      .from('products')
      .update({ stock: newStock })
      .eq('id', prod.id);

    if (updateErr) throw updateErr;
  },

  updateStockItemBalance: async (uniqueId: string, qtyChange: number): Promise<void> => {
    if (!uniqueId || uniqueId === 'SYSTEM-MIGRATION') return;
    const { data: item, error: fetchErr } = await supabase
      .from('stock_items')
      .select('quantity')
      .eq('unique_id', uniqueId)
      .maybeSingle();

    if (fetchErr || !item) return;

    const newQty = (item.quantity || 0) + qtyChange;
    const { error: updateErr } = await supabase
      .from('stock_items')
      .update({ 
        quantity: newQty,
        status: newQty > 0 ? ItemStatus.IN_STOCK : ItemStatus.OUTBOUND
      })
      .eq('unique_id', uniqueId);

    if (updateErr) throw updateErr;
  },

  deleteLogAndReverse: async (log: LogEntry): Promise<void> => {
    // 1. Delete log
    const { error: logErr } = await supabase.from('logs').delete().eq('id', log.id);
    if (logErr) throw logErr;

    // 2. Reverse product balance
    await db.updateProductBalance(log.productName, -(log.quantityChange || 0));

    // 3. Reverse batch/stock item balance
    if (log.stockItemId && log.stockItemId !== 'SYSTEM-MIGRATION') {
      await db.updateStockItemBalance(log.stockItemId, -(log.quantityChange || 0));
    }
  },

  updateLogAndAdjust: async (log: LogEntry, newQtyChange: number, updates: { note?: string, recipient?: string }): Promise<void> => {
    const diff = newQtyChange - (log.quantityChange || 0);

    // 1. Update log
    const { error: logErr } = await supabase.from('logs').update({
      quantity_change: newQtyChange,
      ...updates
    }).eq('id', log.id);
    if (logErr) throw logErr;

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
    const { data: product, error: pErr } = await supabase
      .from('products')
      .select('*')
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
    const { error } = await supabase.from('products').delete().eq('id', productId);
    if (error) throw error;
  },

  getAllStock: async (): Promise<StockItem[]> => {
    let allData: any[] = [];
    let page = 0;
    const pageSize = 1000;
    
    while (true) {
      const { data, error } = await supabase
        .from('stock_items')
        .select('*')
        .order('created_at_ts', { ascending: false })
        .range(page * pageSize, (page + 1) * pageSize - 1);
      
      if (error || !data || data.length === 0) break;
      allData = [...allData, ...data];
      if (data.length < pageSize) break;
      page++;
      if (page > 50) break; // Safety
    }

    return allData.map(s => ({
      id: s.id, 
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
  },

  getAllLogs: async (): Promise<LogEntry[]> => {
    let allData: any[] = [];
    let page = 0;
    const pageSize = 1000;
    
    while (true) {
      const { data, error } = await supabase
        .from('logs')
        .select('*')
        .order('timestamp', { ascending: false })
        .range(page * pageSize, (page + 1) * pageSize - 1);
      
      if (error || !data || data.length === 0) break;
      allData = [...allData, ...data];
      if (data.length < pageSize) break;
      page++;
      if (page > 50) break; // Safety limit (50k logs)
    }

    return allData.map(l => ({
      id: l.id,
      type: l.type,
      stockItemId: l.stock_item_id,
      productName: l.product_name,
      timestamp: l.timestamp,
      recipient: l.recipient,
      note: l.note,
      quantityChange: Number(l.quantity_change) || 0,
      user: l.user
    }));
  },

  addStockItems: async (items: StockItem[]): Promise<void> => {
    for (const item of items) {
      const { data: existing } = await supabase
        .from('stock_items')
        .select('quantity, status')
        .eq('unique_id', item.uniqueId)
        .single();

      if (existing) {
        await supabase
          .from('stock_items')
          .update({ 
            quantity: item.quantity, 
            status: item.status, 
            arrival_date: item.arrivalDate,
            expiry_date: item.expiryDate || null,
            supplier: item.supplier,
            note: item.note || null 
          })
          .eq('unique_id', item.uniqueId);
      } else {
        const payload = {
          unique_id: item.uniqueId,
          product_id: item.productId,
          product_name: item.productName,
          batch_code: item.batchCode || null,
          arrival_date: item.arrivalDate,
          expiry_date: item.expiryDate || null,
          supplier: item.supplier,
          status: item.status,
          created_at_ts: item.createdAt,
          quantity: item.quantity,
          note: item.note || null 
        };
        await supabase.from('stock_items').insert(payload);
      }
    }
  },

  updateStockItem: async (item: StockItem): Promise<void> => {
    const { error } = await supabase
      .from('stock_items')
      .update({ 
        status: item.status,
        quantity: item.quantity,
        note: item.note 
      })
      .eq('unique_id', item.uniqueId);
    if (error) throw error;
  },

  extendExpiryDate: async (uniqueId: string, newExpiryDate: string): Promise<void> => {
    const { data: item } = await supabase.from('stock_items').select('note').eq('unique_id', uniqueId).single();
    let updatedNote = item?.note || '';
    if (!updatedNote.includes('[EXTENDED]')) {
      updatedNote = updatedNote ? updatedNote + ' [EXTENDED]' : '[EXTENDED]';
    }
    const { error } = await supabase
      .from('stock_items')
      .update({ expiry_date: newExpiryDate, note: updatedNote })
      .eq('unique_id', uniqueId);
    if (error) throw error;
  },

  addLogEntries: async (logs: LogEntry[]): Promise<void> => {
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

    const { error } = await supabase.from('logs').insert(payload);
    if (error) throw error;

    for (const log of logs) {
       if (log.quantityChange !== undefined && log.quantityChange !== 0) {
          await db.updateProductBalance(log.productName, log.quantityChange);
       }
    }
  },

  // --- MT & GA SPECIFIC FUNCTIONS ---

  getSimpleItems: async (module: 'MT' | 'GA' | 'HR'): Promise<SimpleItem[]> => {
    let allData: any[] = [];
    let page = 0;
    const pageSize = 1000;
    
    while (true) {
      const { data, error } = await supabase
        .from('simple_master_items')
        .select('*')
        .eq('module', module)
        .order('name', { ascending: true })
        .range(page * pageSize, (page + 1) * pageSize - 1);
      
      if (error || !data || data.length === 0) break;
      allData = [...allData, ...data];
      if (data.length < pageSize) break;
      page++;
      if (page > 10) break;
    }
    
    return allData.map(item => ({
      id: item.id,
      name: item.name,
      unit: item.unit,
      module: item.module,
      initialStock: Number(item.initial_stock) || 0
    }));
  },

  getSimpleTransactions: async (module: 'MT' | 'GA' | 'HR'): Promise<SimpleTransaction[]> => {
    let allData: any[] = [];
    let page = 0;
    const pageSize = 1000;
    
    while (true) {
      const { data, error } = await supabase
        .from('simple_transactions')
        .select('*')
        .eq('module', module)
        .order('timestamp', { ascending: false })
        .range(page * pageSize, (page + 1) * pageSize - 1);
      
      if (error || !data || data.length === 0) break;
      allData = [...allData, ...data];
      if (data.length < pageSize) break;
      page++;
      if (page > 50) break;
    }
    
    return allData.map(t => ({
      id: t.id,
      timestamp: t.timestamp,
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
  },

  addSimpleTransaction: async (tx: SimpleTransaction): Promise<void> => {
    const { data: existing } = await supabase
      .from('simple_master_items')
      .select('id')
      .ilike('name', tx.itemName)
      .eq('module', tx.module)
      .maybeSingle();

    if (!existing) {
      await supabase.from('simple_master_items').insert({
        name: tx.itemName,
        unit: tx.unit,
        module: tx.module,
        initial_stock: 0
      });
    }

    const payload = {
      timestamp: tx.timestamp,
      type: tx.type,
      item_name: tx.itemName,
      quantity: tx.quantity,
      unit: tx.unit,
      supplier: tx.supplier,
      recipient: tx.recipient,
      officer: tx.officer,
      note: tx.note,
      module: tx.module
    };

    const { error = null } = await supabase.from('simple_transactions').insert(payload);
    if (error) throw error;
  },

  getOpnameRequests: async (): Promise<OpnameRequest[]> => {
    const { data, error } = await supabase
      .from('opname_requests')
      .select('*')
      .order('submitted_at', { ascending: false })
      .limit(5000);
    
    if (error) return [];
    return data.map(r => ({
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
  },

  submitOpnameRequest: async (request: Partial<OpnameRequest>): Promise<void> => {
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
    const { error } = await supabase
      .from('opname_requests')
      .update({ status })
      .eq('id', requestId);
    if (error) throw error;
  },

  updateInitialStock: async (productId: string, newInitialQty: number): Promise<void> => {
    const { error } = await supabase
      .from('products')
      .update({ initial_stock: newInitialQty })
      .eq('id', productId);
    if (error) throw error;
    await db.recalculateProductStock(productId);
  }
};