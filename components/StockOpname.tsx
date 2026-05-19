import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Product, StockItem, ItemStatus, User, LogEntry } from '../types.ts';
import { ClipboardCheck, Save, Search, RotateCcw, RefreshCw, Filter, Clock, CheckCircle, ScanLine, XCircle, ShieldAlert, FileSpreadsheet, FileText } from 'lucide-react';
import { db, supabase } from '../services/database.ts';
import CameraScanner from './CameraScanner.tsx';
import * as XLSX from 'xlsx';

interface StockOpnameProps {
  products: Product[];
  inventory: StockItem[];
  currentUser: User;
  onBulkAdjust: (adjustments: { item: StockItem, newQty: number, note: string }[]) => Promise<void>;
  onRefresh?: () => void;
}

interface BatchGroup {
  key: string; 
  productId: string;
  productName: string;
  unit: string;
  batchCode: string;
  items: StockItem[];
  totalSystemQty: number;
  productStockToday: number;
  productInitialStock: number;
  arrivalDate?: string;
  expiryDate?: string;
  supplier?: string;
}

const StockOpname: React.FC<StockOpnameProps> = ({ products, inventory, currentUser, onBulkAdjust, onRefresh }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [sessionAdjustments, setSessionAdjustments] = useState<Record<string, { newTotalQty: number, note: string, isInitial: boolean, refDate: string, requestId?: string }>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [showScanner, setShowScanner] = useState(false);

  const firstDayOfMonth = new Date();
  firstDayOfMonth.setDate(1);
  const defaultRefDate = firstDayOfMonth.toISOString().split('T')[0];

  const isAdminOrSuper = currentUser.role === 'Admin' || currentUser.role === 'SuperAdmin';

  useEffect(() => {
    const syncRequests = async () => {
      if (!isAdminOrSuper) return;
      try {
        const requests = await db.getOpnameRequests();
        const pending = requests.filter(r => r.status === 'PENDING');
        
        if (pending.length > 0) {
          const autoAdjusts: Record<string, any> = {};
          pending.forEach(req => {
            let keySuffix = req.batchCode;
            if (req.batchCode === 'SALDO-AWAL') keySuffix = 'LEGACY';
            else if (req.batchCode === 'GLOBAL') keySuffix = 'GLOBAL';
            
            const key = `${req.productId}|${keySuffix}`;
            autoAdjusts[key] = {
              newTotalQty: req.physicalQty,
              note: `[REQ BY ${req.submittedBy}] ${req.note || ''}`,
              isInitial: req.isInitialStockAdjustment,
              refDate: req.referenceDate || defaultRefDate,
              requestId: req.id 
            };
          });
          setSessionAdjustments(prev => ({ ...prev, ...autoAdjusts }));
        }
      } catch (err) {
        console.error("Gagal sinkronisasi pengajuan:", err);
      }
    };
    syncRequests();
  }, [isAdminOrSuper]);

  const allBatchGroups = useMemo(() => {
    const groups: BatchGroup[] = [];
    const activeItems = inventory.filter(item => 
      String(item.status) === String(ItemStatus.IN_STOCK)
    );

    products.forEach(product => {
      const productActiveItems = activeItems.filter(item => item.productId === product.id);
      const batchMap: Record<string, BatchGroup> = {};
      let physicalSum = 0;

      productActiveItems.forEach(item => {
        const batch = item.batchCode || 'TANPA-BATCH';
        const key = `${product.id}|${batch}`;
        if (!batchMap[key]) {
          batchMap[key] = {
            key, 
            productId: product.id, 
            productName: product.name,
            unit: product.unit, 
            batchCode: batch, 
            items: [], 
            totalSystemQty: 0,
            productStockToday: product.stockToday || 0,
            productInitialStock: product.initialStock || 0,
            arrivalDate: item.arrivalDate,
            expiryDate: item.expiryDate,
            supplier: item.supplier
          };
        }
        batchMap[key].items.push(item);
        const qty = Number(item.quantity) || 0;
        batchMap[key].totalSystemQty += qty;
        physicalSum += qty;
      });

      Object.values(batchMap).forEach(g => groups.push(g));

      const masterQty = Number(product.stockToday) || 0;
      const legacyGap = masterQty - physicalSum;
      
      if (legacyGap > 0.01) {
        groups.push({
          key: `${product.id}|LEGACY`,
          productId: product.id,
          productName: product.name,
          unit: product.unit,
          batchCode: 'SALDO-AWAL',
          items: [], 
          totalSystemQty: legacyGap,
          productStockToday: masterQty,
          productInitialStock: product.initialStock || 0,
          arrivalDate: 'System',
          expiryDate: '-',
          supplier: 'Migration'
        });
      } else if (productActiveItems.length === 0) {
        groups.push({
          key: `${product.id}|GLOBAL`,
          productId: product.id,
          productName: product.name,
          unit: product.unit,
          batchCode: 'GLOBAL',
          items: [],
          totalSystemQty: masterQty,
          productStockToday: masterQty,
          productInitialStock: product.initialStock || 0,
          arrivalDate: 'System',
          expiryDate: '-',
          supplier: 'System'
        });
      }
    });

    return groups.sort((a, b) => (a.productName || '').localeCompare(b.productName || ''));
  }, [inventory, products]);

  const filteredGroups = useMemo(() => {
    const search = (searchTerm || '').toLowerCase();
    return allBatchGroups.filter(g => 
      (g.productName || '').toLowerCase().includes(search) || 
      (g.batchCode || '').toLowerCase().includes(search)
    );
  }, [allBatchGroups, searchTerm]);

  const handleQtyChange = (key: string, val: string) => {
    const qty = val === '' ? 0 : parseFloat(val);
    const group = allBatchGroups.find(g => g.key === key);
    setSessionAdjustments(prev => ({
      ...prev,
      [key]: { 
        ...(prev[key] || { note: '', newTotalQty: group?.totalSystemQty || 0, isInitial: false, refDate: defaultRefDate }), 
        newTotalQty: qty 
      }
    }));
  };

  const toggleInitial = (key: string) => {
    setSessionAdjustments(prev => ({
      ...prev,
      [key]: { ...(prev[key] || { newTotalQty: allBatchGroups.find(g => g.key === key)?.totalSystemQty || 0, note: '', refDate: defaultRefDate }), isInitial: !prev[key]?.isInitial }
    }));
  };

  const resetAdjustment = (key: string) => {
    const newSession = { ...sessionAdjustments };
    delete newSession[key];
    setSessionAdjustments(newSession);
  };

  const adjustmentSummary = useMemo(() => {
    return (Object.entries(sessionAdjustments) as [string, any][])
      .map(([key, data]) => {
        const group = allBatchGroups.find(g => g.key === key);
        if (!group) return null;
        const variance = data.newTotalQty - group.totalSystemQty;
        if (variance === 0 && !data.note && !data.isInitial) return null;
        return { 
          key, 
          productId: group.productId,
          batchCode: group.batchCode, 
          productName: group.productName, 
          unit: group.unit, 
          system: group.totalSystemQty, 
          physical: data.newTotalQty, 
          variance, 
          note: data.note,
          isInitial: data.isInitial,
          refDate: data.refDate,
          requestId: data.requestId
        };
      })
      .filter(Boolean);
  }, [sessionAdjustments, allBatchGroups]);

  const commitOpname = async () => {
    if (adjustmentSummary.length === 0) return;
    setIsSubmitting(true);
    try {
      if (isAdminOrSuper) {
        const adjustmentsToSubmit: { item: StockItem, newQty: number, note: string }[] = [];
        const requestIdsToApprove: string[] = [];

        for (const adj of adjustmentSummary as any[]) {
          const group = allBatchGroups.find(g => g.key === adj.key);
          if (!group) continue;
          
          if (adj.requestId) requestIdsToApprove.push(adj.requestId);

          if (adj.isInitial) {
             const startTs = new Date(adj.refDate).getTime();
             const { data: logsInRange } = await supabase
                .from('logs')
                .select('quantity_change')
                .eq('product_name', group.productName)
                .gte('timestamp', startTs);
             
             const sumMutations = (logsInRange || []).reduce((acc: number, l: any) => acc + (Number(l.quantity_change) || 0), 0);
             const calculatedInitial = adj.physical - sumMutations;
             await db.updateInitialStock(group.productId, calculatedInitial);
          } else {
            if (group.items.length > 0) {
              // Koreksi pada item berstiker yang ada
              adjustmentsToSubmit.push({ item: group.items[0], newQty: adj.physical, note: adj.note || `Audit ${adj.batchCode}` });
            } else {
              // Koreksi pada stok legacy/global: TIDAK membuat batch baru, langsung rekam log koreksi
              const variance = adj.physical - adj.system;
              if (variance !== 0) {
                const logEntry: LogEntry = {
                  id: `LOG-OPN-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
                  type: 'ADJUST',
                  stockItemId: 'SYSTEM-MIGRATION', // Menggunakan ID migrasi sistem agar tidak mencemari tabel batch
                  productName: group.productName,
                  timestamp: Date.now(),
                  note: adj.note || `Audit Selisih Stok Legacy (${group.batchCode})`,
                  quantityChange: variance,
                  user: currentUser.username
                };
                await db.addLogEntries([logEntry]);
              }
            }
          }
        }
        
        if (adjustmentsToSubmit.length > 0) await onBulkAdjust(adjustmentsToSubmit);
        
        if (requestIdsToApprove.length > 0) {
          for (const id of requestIdsToApprove) {
            await db.updateOpnameStatus(id, 'APPROVED');
          }
        }
      } else {
        for (const adj of adjustmentSummary as any[]) {
          await db.submitOpnameRequest({
            productId: adj.productId,
            productName: adj.productName,
            batchCode: adj.batchCode,
            systemQty: adj.system,
            physicalQty: adj.physical,
            variance: adj.variance,
            note: adj.note,
            isInitialStockAdjustment: adj.isInitial,
            referenceDate: adj.refDate,
            submittedBy: currentUser.username
          });
        }
        alert("Pengajuan opname telah dikirim ke Admin.");
      }
      
      setSessionAdjustments({});
      setShowConfirmModal(false);
      if (onRefresh) onRefresh();
    } catch (error) {
      console.error(error);
      alert("Gagal menyimpan.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-4 animate-in fade-in duration-500">
      {showScanner && (
        <CameraScanner 
          onScan={(codes) => {
            const codeList = Array.isArray(codes) ? codes : [codes];
            setSessionAdjustments(prev => {
              const next = { ...prev };
              codeList.forEach(code => {
                const group = allBatchGroups.find(g => g.productId === code || g.items.some(i => i.uniqueId === code));
                if (group) {
                  const current = next[group.key] || { newTotalQty: 0, note: 'Scan Count', isInitial: false, refDate: defaultRefDate };
                  next[group.key] = { ...current, newTotalQty: current.newTotalQty + 1 };
                }
              });
              return next;
            });
          }} 
          onClose={() => setShowScanner(false)} 
          products={products}
          stockItems={inventory}
        />
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 md:gap-4">
        <div className="bg-slate-900 rounded-[2rem] p-5 text-white shadow-lg">
          <span className="text-[8px] font-black text-slate-500 uppercase tracking-widest block mb-1">Total SKU Diaudit</span>
          <span className="text-2xl font-black">{adjustmentSummary.length}</span>
          <div className="mt-3 flex items-center gap-2 text-emerald-400 text-[9px] font-bold">
            <ClipboardCheck size={12} /> Progress: {allBatchGroups.length > 0 ? Math.round((adjustmentSummary.length / allBatchGroups.length) * 100) : 0}%
          </div>
        </div>
        <div className="bg-white rounded-[2rem] p-5 border border-slate-200 shadow-sm">
          <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest block mb-1">Total Selisih (Variance)</span>
          <span className={`text-2xl font-black ${adjustmentSummary.reduce((acc, a: any) => acc + a.variance, 0) < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
            {adjustmentSummary.reduce((acc, a: any) => acc + a.variance, 0).toLocaleString()}
          </span>
          <p className="text-[8px] text-slate-400 font-bold mt-3 uppercase">Akumulasi Koreksi</p>
        </div>
        <div className="bg-white rounded-[2rem] p-2 border border-slate-200 shadow-sm flex flex-col gap-2">
           <button onClick={() => setShowScanner(true)} className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-900 rounded-2xl flex items-center justify-center gap-2 transition-all py-3 sm:py-0">
              <ScanLine size={18} className="text-red-600" />
              <span className="text-[9px] font-black uppercase tracking-widest">Scan</span>
           </button>
           <button onClick={() => setShowConfirmModal(true)} disabled={adjustmentSummary.length === 0} className="flex-1 bg-red-600 hover:bg-red-700 text-white rounded-2xl flex items-center justify-center gap-2 transition-all disabled:opacity-30 py-3 sm:py-0 shadow-lg shadow-red-100">
              <Save size={18} />
              <span className="text-[9px] font-black uppercase tracking-widest">Simpan</span>
           </button>
        </div>
      </div>

      <div className="bg-white p-3 rounded-[1.8rem] shadow-sm border border-slate-200 flex flex-col md:flex-row gap-3 items-center">
        <div className="relative flex-1 w-full">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input 
                type="text" 
                placeholder="Cari Barang / Batch..."
                className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl text-[11px] font-bold outline-none focus:ring-1 focus:ring-red-500/20"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
            />
        </div>
        <div className="flex gap-2 w-full md:w-auto">
          <button className="bg-slate-100 text-slate-600 p-3 rounded-2xl flex items-center justify-center">
            <Filter size={16} />
          </button>
        </div>
      </div>

      <div className="space-y-3">
        <div className="hidden md:block bg-white rounded-[2.5rem] shadow-sm border border-slate-200 overflow-hidden">
          <table className="w-full text-left text-[11px] border-collapse">
            <thead className="bg-slate-50 text-slate-500 font-black uppercase text-[8px] tracking-widest border-b border-slate-100">
              <tr>
                <th className="px-8 py-5">Produk / Batch Identity</th>
                <th className="px-6 py-5 text-center">System Stock</th>
                <th className="px-6 py-5 text-center">Physical Count</th>
                <th className="px-6 py-5 text-center">Variance</th>
                <th className="px-6 py-5 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredGroups.map((group) => {
                const adj = sessionAdjustments[group.key];
                const physical = adj ? adj.newTotalQty : group.totalSystemQty;
                const variance = physical - group.totalSystemQty;
                const isModified = adj !== undefined;
                return (
                  <tr key={group.key} className={`transition-colors ${isModified ? 'bg-amber-50/20' : 'hover:bg-slate-50/30'}`}>
                    <td className="px-8 py-4">
                      <div className="font-black text-slate-800 uppercase text-[12px] leading-tight">{group.productName}</div>
                      <div className="flex items-center gap-2 mt-1.5">
                        <span className="text-[8px] text-slate-400 font-mono tracking-widest">ID: {group.productId}</span>
                        <span className={`text-[8px] font-black px-2 py-0.5 rounded-lg border uppercase ${group.batchCode === 'SALDO-AWAL' ? 'bg-blue-50 text-blue-600' : 'bg-slate-900 text-white'}`}>{group.batchCode}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <span className="font-black text-slate-500 text-base">{group.totalSystemQty.toLocaleString()}</span>
                      <span className="text-[8px] font-black text-slate-300 block uppercase">{group.unit}</span>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <input type="number" step="0.01" className={`w-32 text-center py-3 rounded-2xl font-black text-lg outline-none border transition-all ${isModified ? 'border-red-400 bg-white ring-4 ring-red-50' : 'border-slate-200 bg-slate-50'}`} value={adj?.newTotalQty ?? group.totalSystemQty} onChange={(e) => handleQtyChange(group.key, e.target.value)} />
                    </td>
                    <td className="px-6 py-4 text-center">
                      <div className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-2xl font-black text-sm border ${variance === 0 ? 'text-slate-300 border-slate-100' : variance > 0 ? 'text-emerald-700 bg-emerald-50' : 'text-red-700 bg-red-50'}`}>
                        {variance === 0 ? 'PERFECT' : (variance > 0 ? `+${variance.toLocaleString()}` : variance.toLocaleString())}
                      </div>
                    </td>
                    <td className="px-8 py-4 text-center">
                      <div className="flex justify-center gap-2">
                        <button onClick={() => toggleInitial(group.key)} className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${adj?.isInitial ? 'bg-amber-600 text-white shadow-lg' : 'bg-slate-100 text-slate-400'}`}><Clock size={18} /></button>
                        <button onClick={() => resetAdjustment(group.key)} disabled={!isModified} className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${isModified ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-200'}`}><RotateCcw size={18} /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="md:hidden space-y-3">
          {filteredGroups.length > 0 ? filteredGroups.map((group) => {
            const adj = sessionAdjustments[group.key];
            const physical = adj ? adj.newTotalQty : group.totalSystemQty;
            const variance = physical - group.totalSystemQty;
            const isModified = adj !== undefined;
            const isInitial = adj?.isInitial || false;

            return (
              <div key={group.key} className={`p-5 rounded-[2rem] border transition-all shadow-sm ${isModified ? 'bg-white border-red-200 ring-2 ring-red-50' : 'bg-white border-slate-100'}`}>
                <div className="flex justify-between items-start mb-4">
                  <div className="min-w-0 pr-3">
                    <h4 className="text-[13px] font-black text-slate-900 uppercase leading-tight truncate">{group.productName}</h4>
                    <div className="flex items-center gap-2 mt-1.5">
                       <span className={`text-[8px] font-black px-2 py-0.5 rounded-lg border uppercase tracking-widest ${group.batchCode === 'SALDO-AWAL' ? 'bg-blue-50 text-blue-600 border-blue-100' : 'bg-slate-900 text-white border-slate-800'}`}>{group.batchCode}</span>
                       <span className="text-[7px] font-mono text-slate-400 uppercase">ID: {group.productId}</span>
                    </div>
                  </div>
                  <div className="flex flex-col items-end shrink-0">
                    <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest">System</span>
                    <span className="text-[13px] font-black text-slate-500">{group.totalSystemQty.toLocaleString()} {group.unit}</span>
                  </div>
                </div>

                <div className="grid grid-cols-12 gap-3 items-end pt-4 border-t border-slate-50">
                  <div className="col-span-7 space-y-1.5">
                    <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest ml-1">Actual Physical Count</label>
                    <div className="relative">
                      <input 
                        type="number" 
                        step="0.01"
                        className={`w-full py-4 px-4 rounded-2xl font-black text-xl outline-none border transition-all ${isModified ? 'border-red-400 bg-white' : 'border-slate-200 bg-slate-50 focus:border-slate-400'}`}
                        value={adj?.newTotalQty ?? group.totalSystemQty}
                        onChange={(e) => handleQtyChange(group.key, e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="col-span-5 flex flex-col gap-2">
                    <div className={`w-full py-2.5 text-center rounded-xl font-black text-[11px] border ${variance === 0 ? 'text-slate-300 border-slate-100' : variance > 0 ? 'text-emerald-700 bg-emerald-50 border-emerald-100' : 'text-red-700 bg-red-50 border-red-100'}`}>
                      {variance === 0 ? 'MATCH' : (variance > 0 ? `+${variance}` : variance)}
                    </div>
                    <div className="flex gap-2 h-10">
                      <button onClick={() => toggleInitial(group.key)} className={`flex-1 rounded-xl flex items-center justify-center transition-all ${isInitial ? 'bg-amber-600 text-white shadow-lg' : 'bg-slate-100 text-slate-400 border border-slate-200'}`}><Clock size={16} /></button>
                      <button onClick={() => resetAdjustment(group.key)} disabled={!isModified} className={`flex-1 rounded-xl flex items-center justify-center transition-all ${isModified ? 'bg-slate-900 text-white shadow-lg' : 'bg-slate-50 text-slate-200 border border-slate-100'}`}><RotateCcw size={16} /></button>
                    </div>
                  </div>
                </div>
              </div>
            );
          }) : (
            <div className="py-20 text-center">
              <XCircle size={40} className="text-slate-200 mx-auto mb-3" />
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Daftar Audit Kosong</p>
            </div>
          )}
        </div>
      </div>

      {showConfirmModal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
           <div className="bg-white rounded-[2.5rem] shadow-2xl p-6 md:p-8 max-w-lg w-full flex flex-col max-h-[85vh] border border-slate-100">
              <div className="flex justify-between items-center mb-6">
                <div>
                    <h3 className="text-xl font-black text-slate-800 uppercase tracking-tighter leading-none">Confirm Audit</h3>
                    <p className="text-[9px] text-slate-400 font-bold uppercase mt-2 tracking-widest">{adjustmentSummary.length} corrections pending</p>
                </div>
                <div className="p-3 bg-red-50 text-red-600 rounded-2xl"><ShieldAlert size={20} /></div>
              </div>
              
              <div className="flex-1 overflow-y-auto mb-6 space-y-2 pr-1 custom-scrollbar">
                {adjustmentSummary.map((adj: any) => (
                  <div key={adj.key} className="p-4 bg-slate-50 rounded-2xl flex flex-col gap-1 border border-slate-200">
                     <div className="flex justify-between items-start">
                        <span className="text-[10px] font-black text-slate-900 truncate uppercase flex-1 pr-2">{adj.productName}</span>
                        <div className={`px-2 py-0.5 rounded-lg text-[9px] font-black border ${adj.variance >= 0 ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-red-50 text-red-600 border-red-100'}`}>
                            {adj.variance > 0 ? `+${adj.variance}` : adj.variance}
                        </div>
                     </div>
                     <span className="text-[7px] font-mono text-slate-400 uppercase tracking-widest">BATCH: {adj.batchCode}</span>
                  </div>
                ))}
              </div>

              <div className="flex flex-col gap-2">
                <button onClick={commitOpname} disabled={isSubmitting} className="w-full py-4 bg-slate-900 text-white rounded-2xl font-black uppercase text-[10px] tracking-[0.2em] flex items-center justify-center gap-2 shadow-xl active:scale-[0.98] transition-all">
                  {isSubmitting ? <RefreshCw className="animate-spin" size={16}/> : <CheckCircle size={16}/>} 
                  {isAdminOrSuper ? 'AUTHENTICATE' : 'SUBMIT'}
                </button>
                <button onClick={() => setShowConfirmModal(false)} className="w-full py-3 rounded-2xl text-slate-400 font-black uppercase text-[9px] tracking-widest hover:bg-slate-50">Back</button>
              </div>
           </div>
        </div>
      )}
    </div>
  );
};

export default StockOpname;