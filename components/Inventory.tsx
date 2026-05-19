import React, { useState, useMemo, useEffect } from 'react';
import { StockItem, Product, LogEntry, ItemStatus, User, LabelData } from '../types.ts';
import { 
  Search, Package, AlertTriangle, RefreshCw, X, Tag, FileSpreadsheet, 
  Eye, Settings2, Plus, Minus, ScanLine, User as UserIcon, Activity, 
  Database, Clock, Calendar, Hash, FileText, TrendingDown, Timer, Printer,
  Info, Filter, Activity as StatusIcon, Truck, ChevronRight
} from 'lucide-react';
import StockOpname from './StockOpname.tsx';
import MasterData from './MasterData.tsx';
import LabelPreview from './LabelPreview.tsx';
import { db } from '../services/database.ts';
import CameraScanner from './CameraScanner.tsx';

interface InventoryProps {
  products: Product[];
  inventory: StockItem[];
  logs: LogEntry[];
  currentUser: User;
  onAdjust?: (item: StockItem, newQty: number, note: string) => void;
  onBulkAdjust?: (adjustments: { item: StockItem, newQty: number, note: string }[]) => Promise<void>;
  onRefresh?: () => void;
}

const Inventory: React.FC<InventoryProps> = ({ products, inventory, logs, currentUser, onAdjust, onBulkAdjust, onRefresh }) => {
  const [filter, setFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [viewMode, setViewMode] = useState<'recap' | 'opname' | 'master'>('recap');
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [detailTab, setDetailTab] = useState<'batches' | 'history'>('batches');
  
  const [showScanner, setShowScanner] = useState(false);
  const [scannedUnit, setScannedUnit] = useState<{ item: StockItem; logs: LogEntry[] } | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);

  const [previewSticker, setPreviewSticker] = useState<LabelData | null>(null);
  const [stickerScale, setStickerScale] = useState(0.85);

  const [manageForm, setManageForm] = useState({ safetyStock: 0, adjustQty: 0, adjustNote: '' });
  const [isAdminSubmitting, setIsAdminSubmitting] = useState(false);

  const isViewer = currentUser.role === 'Viewer';
  const isAdminOrSuper = currentUser.role === 'Admin' || currentUser.role === 'SuperAdmin';

  useEffect(() => {
    if (selectedProduct) {
      const latest = products.find(p => p.id === selectedProduct.id);
      if (latest) setSelectedProduct(latest);
    }
  }, [products]);

  const categories = useMemo(() => {
    const cats = Array.from(new Set(products.map(p => p.category))).filter(Boolean);
    return ['ALL', ...cats];
  }, [products]);

  const statuses = ['ALL', 'AMAN', 'KRITIS', 'HABIS'];

  useEffect(() => {
    if (selectedProduct) {
      setManageForm({
        safetyStock: selectedProduct.safetyStock || 0,
        adjustQty: 0,
        adjustNote: ''
      });
      setDetailTab('batches');
    }
  }, [selectedProduct]);

  useEffect(() => {
    const handleResize = () => {
      setStickerScale(window.innerWidth < 640 ? 0.65 : 0.85);
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const formatDateReadable = (dateStr: string) => {
    if (!dateStr || dateStr === 'System' || dateStr === 'Migration' || dateStr === '-') return String(dateStr);
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return String(dateStr);
      const day = String(d.getDate()).padStart(2, '0');
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
      return `${day} ${months[d.getMonth()]} ${d.getFullYear()}`;
    } catch {
      return String(dateStr);
    }
  };

  const formatDateTimeFull = (ts: any) => {
    if (!ts) return "-";
    const d = new Date(Number(ts));
    if (isNaN(d.getTime())) return "-";
    const day = String(d.getDate()).padStart(2, '0');
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
    return `${day} ${months[d.getMonth()]} ${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  const handleScanCheck = (id: string | string[]) => {
    const uniqueId = Array.isArray(id) ? id[0] : id;
    const cleanId = String(uniqueId).trim().toUpperCase();
    setScanError(null);

    const item = inventory.find(s => String(s.uniqueId).trim().toUpperCase() === cleanId);
    if (item) {
      const unitLogs = logs.filter(l => String(l.stockItemId).trim().toUpperCase() === cleanId).sort((a, b) => b.timestamp - a.timestamp);
      setScannedUnit({ item, logs: unitLogs });
      return;
    }

    const product = products.find(p => String(p.id).trim().toUpperCase() === cleanId);
    if (product) {
      setSelectedProduct(product);
      return;
    }

    setScanError(`ID "${uniqueId}" tidak ditemukan.`);
    setTimeout(() => setScanError(null), 3000);
  };

  const getStockStatus = (p: Product) => {
    const stock = p.stockToday || 0;
    const safety = p.safetyStock || 0;
    if (stock <= 0) return { label: 'HABIS', color: 'bg-red-600', text: 'text-white' };
    if (stock <= safety) return { label: 'KRITIS', color: 'bg-amber-500', text: 'text-white' }; 
    return { label: 'AMAN', color: 'bg-emerald-500', text: 'text-white' };
  };

  const getRestockEstimation = (p: Product) => {
    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    const outLogs = logs.filter(l => String(l.productName) === p.name && l.type === 'OUT' && l.timestamp >= thirtyDaysAgo);
    const totalOut = outLogs.reduce((acc, l) => acc + Math.abs(Number(l.quantityChange || 0)), 0);
    const avgDailyOut = totalOut / 30;

    const currentStock = p.stockToday || 0;
    const safety = p.safetyStock || 0;
    
    if (avgDailyOut === 0) {
      if (currentStock === 0) return { text: "Stok Habis", dateText: null, shouldRestock: true, tooltip: "Stok sudah habis." };
      return { text: "Stagnan (0 Keluar)", dateText: null, shouldRestock: currentStock <= safety, tooltip: "Tidak ada pengeluaran stok 30 hari terakhir." };
    }

    const daysLeft = Math.floor(currentStock / avgDailyOut);
    if (currentStock === 0) return { text: "Stok Habis", dateText: null, shouldRestock: true, tooltip: "Stok sudah habis." };
    
    // We consider "shouldRestock" if daysLeft is less than 7 or stock <= safety
    const shouldRestock = daysLeft <= 7 || currentStock <= safety;

    const estDate = new Date();
    estDate.setDate(estDate.getDate() + daysLeft);

    return { 
      text: `${daysLeft} Hari Lagi`, 
      dateText: formatDateReadable(estDate.toISOString()),
      shouldRestock,
      tooltip: `(${avgDailyOut.toFixed(1)} ${p.unit}/hari)`
    };
  };

  const exhaustionData = useMemo(() => {
    if (!selectedProduct) return null;
    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    const outLogs = logs.filter(l => String(l.productName) === selectedProduct.name && l.type === 'OUT' && l.timestamp >= thirtyDaysAgo);
    const totalOut = outLogs.reduce((acc, l) => acc + Math.abs(Number(l.quantityChange || 0)), 0);
    const avgDailyOut = totalOut / 30;
    if (avgDailyOut <= 0) return { avg: 0, daysLeft: Infinity, date: null };
    const daysLeft = (selectedProduct.stockToday || 0) / avgDailyOut;
    const depletionDate = new Date();
    depletionDate.setDate(depletionDate.getDate() + Math.ceil(daysLeft));
    return { avg: avgDailyOut, daysLeft: Math.ceil(daysLeft), date: depletionDate.toISOString().split('T')[0] };
  }, [selectedProduct, logs]);

  const handleAdminUpdate = async () => {
    if (!selectedProduct || isAdminSubmitting || isViewer) return;
    setIsAdminSubmitting(true);
    try {
      if (manageForm.safetyStock !== (selectedProduct.safetyStock || 0)) {
        await db.upsertProduct({ ...selectedProduct, safetyStock: manageForm.safetyStock });
      }
      if (manageForm.adjustQty !== 0) {
        if (!manageForm.adjustNote.trim()) {
          alert("Alasan penyesuaian stok harus diisi.");
          setIsAdminSubmitting(false);
          return;
        }
        const currentQty = selectedProduct.stockToday || 0;
        const newQty = currentQty + manageForm.adjustQty;
        const group = inventory.find(s => s.productId === selectedProduct.id && s.status === ItemStatus.IN_STOCK);
        const correctionItem: StockItem = group ? { ...group } : {
           uniqueId: `CORR-${selectedProduct.id}-${Date.now()}`,
           productId: selectedProduct.id,
           productName: selectedProduct.name,
           batchCode: 'ADMIN-CORRECTION',
           arrivalDate: new Date().toISOString().split('T')[0],
           expiryDate: '',
           supplier: 'SYSTEM',
           status: ItemStatus.IN_STOCK,
           createdAt: Date.now(),
           quantity: currentQty
        };
        if (onAdjust) await onAdjust(correctionItem, newQty, `[ADMIN FIX] ${manageForm.adjustNote}`);
      }
      setSelectedProduct(null);
      if (onRefresh) onRefresh();
    } catch (e) {
      alert("Gagal memperbarui data.");
    } finally {
      setIsAdminSubmitting(false);
    }
  };

  const filteredRecap = useMemo(() => {
    const search = (filter || '').toLowerCase();
    return products.filter(p => {
      const matchSearch = String(p.name || '').toLowerCase().includes(search) || String(p.id || '').toLowerCase().includes(search);
      const matchCategory = categoryFilter === 'ALL' || p.category === categoryFilter;
      const matchStatus = statusFilter === 'ALL' || getStockStatus(p).label === statusFilter;
      const isActive = p.isActive !== false;
      return matchSearch && matchCategory && matchStatus && isActive;
    });
  }, [products, filter, categoryFilter, statusFilter]);

  const productBatches = useMemo(() => {
    if (!selectedProduct) return [];
    const targetId = String(selectedProduct.id).trim().toUpperCase();
    const physicalItems = inventory.filter(s => 
      String(s.productId).trim().toUpperCase() === targetId && 
      s.status === ItemStatus.IN_STOCK && 
      s.quantity > 0.001
    );
    const physicalSum = physicalItems.reduce((acc, b) => acc + (Number(b.quantity) || 0), 0);
    const totalMasterStock = Number(selectedProduct.stockToday) || 0;
    const legacyGap = totalMasterStock - physicalSum;
    const finalBatchList: StockItem[] = [...physicalItems];
    if (legacyGap > 0.01) { 
        finalBatchList.push({
            uniqueId: `LEGACY-${selectedProduct.id}`,
            productId: selectedProduct.id,
            productName: selectedProduct.name,
            batchCode: 'SALDO-AWAL',
            arrivalDate: 'System',
            expiryDate: '',
            supplier: 'Migration',
            status: ItemStatus.IN_STOCK,
            createdAt: 0,
            quantity: legacyGap,
            isUnlabeled: true,
            note: 'Sisa stok awal sistem / belum berstiker'
        });
    }
    return finalBatchList;
  }, [selectedProduct, inventory]);

  const recentHistory = useMemo(() => {
    if (!selectedProduct) return [];
    return logs.filter(l => String(l.productName) === selectedProduct.name).sort((a, b) => b.timestamp - a.timestamp).slice(0, 30);
  }, [selectedProduct, logs]);

  return (
    <div className="space-y-4 relative">
      {showScanner && <CameraScanner onScan={handleScanCheck} onClose={() => setShowScanner(false)} stockItems={inventory} products={products} />}
      {previewSticker && (
        <div className="fixed inset-0 z-[500] flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
          <div className="bg-white p-6 rounded-[2.5rem] shadow-2xl flex flex-col items-center gap-6 w-[95%] max-w-md overflow-hidden">
            <div className="w-full flex justify-center items-center" style={{ minHeight: '5cm' }}>
              <div style={{ transform: `scale(${stickerScale})`, transformOrigin: 'center' }}>
                <LabelPreview data={previewSticker} scale={1} className="shadow-lg border border-slate-300" />
              </div>
            </div>
            <button onClick={() => setPreviewSticker(null)} className="w-full py-4 bg-slate-900 text-white rounded-2xl font-black uppercase text-[10px] tracking-[0.2em]">TUTUP PREVIEW</button>
          </div>
        </div>
      )}
      {scannedUnit && (
        <div className="fixed inset-0 z-[400] flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
           <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
              <div className="p-5 bg-slate-900 text-white relative">
                 <button onClick={() => setScannedUnit(null)} className="absolute top-5 right-5 p-2 bg-white/10 rounded-full"><X size={20} /></button>
                 <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 bg-red-600 rounded-xl flex items-center justify-center"><Package size={22} /></div>
                    <div>
                       <h3 className="text-base font-black uppercase tracking-tighter">{String(scannedUnit.item.productName)}</h3>
                       <div className="flex items-center gap-2">
                          <span className={`px-2 py-0.5 rounded-full text-[7px] font-black uppercase tracking-widest ${scannedUnit.item.status === ItemStatus.IN_STOCK ? 'bg-emerald-500' : 'bg-red-500'}`}>{String(scannedUnit.item.status)}</span>
                          <span className="text-[7px] font-black text-slate-500 uppercase">ID: {String(scannedUnit.item.uniqueId)}</span>
                    </div>
                    </div>
                 </div>
              </div>
              <div className="flex-1 overflow-y-auto p-5 bg-slate-50">
                 {scannedUnit.item.note && (
                    <div className="mb-6 p-4 bg-blue-50 border border-blue-100 rounded-2xl flex items-start gap-3">
                       <FileText size={18} className="text-blue-500 mt-0.5" />
                       <div>
                          <span className="text-[8px] font-black text-blue-400 uppercase block mb-1">Keterangan Unit</span>
                          <p className="text-[11px] font-bold text-blue-700 italic">{String(scannedUnit.item.note)}</p>
                       </div>
                    </div>
                 )}
                 <h4 className="text-[8px] font-black text-slate-900 uppercase tracking-widest flex items-center gap-2 mb-4"><Activity size={12} className="text-red-600" /> Mutasi Unit</h4>
                 <div className="space-y-4 relative ml-1 border-l-2 border-slate-200 pl-4">
                    {scannedUnit.logs.length > 0 ? scannedUnit.logs.map((log) => (
                      <div key={log.id} className="relative">
                         <div className={`absolute -left-[25px] top-0 w-2.5 h-2.5 rounded-full border-2 border-white ${log.type === 'IN' ? 'bg-emerald-500' : log.type === 'OUT' ? 'bg-red-500' : 'bg-blue-500'}`}></div>
                         <div className="flex justify-between items-start">
                           <div className="min-w-0">
                              <span className="text-[9px] font-black text-slate-900 uppercase">Transaksi {String(log.type)}</span>
                              <p className="text-[8px] font-black text-slate-400 mt-0.5">{formatDateTimeFull(log.timestamp)}</p>
                              <p className="text-[8px] font-medium text-slate-500 truncate mt-1">{String(log.note || log.recipient || '-')}</p>
                           </div>
                           <div className={`font-black text-[10px] ${Number(log.quantityChange || 0) > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                             {Number(log.quantityChange || 0) > 0 ? '+' : ''}{log.quantityChange?.toLocaleString()}
                           </div>
                         </div>
                      </div>
                    )) : <div className="py-10 text-center text-slate-300 italic text-[9px] uppercase font-black">Tidak Ada Mutasi</div>}
                 </div>
              </div>
              <div className="p-4 border-t border-slate-100">
                <button onClick={() => setScannedUnit(null)} className="w-full py-3 bg-slate-950 text-white rounded-xl font-black uppercase text-[9px] tracking-widest">TUTUP</button>
              </div>
           </div>
        </div>
      )}
      <div className="bg-white rounded-[2rem] shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-4 md:p-5 border-b border-slate-100 flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-3 w-full md:w-auto">
            <div className="w-10 h-10 bg-slate-900 text-white rounded-xl flex items-center justify-center"><Package size={22} /></div>
            <div><h2 className="text-sm font-black text-slate-800 uppercase tracking-tighter">Kontrol Inventaris</h2><p className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">Pemantauan Stok Global</p></div>
          </div>
          <div className="flex bg-slate-100 p-0.5 rounded-xl w-full md:w-auto border border-slate-200">
             <button onClick={() => setViewMode('recap')} className={`flex-1 px-4 py-2 rounded-lg text-[9px] font-black uppercase transition-all ${viewMode === 'recap' ? 'bg-white text-red-600 shadow-sm' : 'text-slate-400'}`}>REKAP</button>
             {!isViewer && <button onClick={() => setViewMode('opname')} className={`flex-1 px-4 py-2 rounded-lg text-[9px] font-black uppercase transition-all ${viewMode === 'opname' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-400'}`}>OPNAME</button>}
             {!isViewer && isAdminOrSuper && <button onClick={() => setViewMode('master')} className={`flex-1 px-4 py-2 rounded-lg text-[9px] font-black uppercase transition-all ${viewMode === 'master' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400'}`}>MASTER</button>}
          </div>
          <div className="flex flex-wrap gap-2 w-full md:w-auto items-center">
              {viewMode === 'recap' && (
                <>
                    <div className="flex flex-wrap gap-2 flex-1 md:flex-initial">
                        <div className="relative min-w-[100px] flex-1">
                            <Filter className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                            <select 
                              className="w-full pl-8 pr-2 py-2 bg-slate-50 border border-slate-200 rounded-xl text-[10px] font-black uppercase outline-none cursor-pointer"
                              value={categoryFilter}
                              onChange={(e) => setCategoryFilter(e.target.value)}
                            >
                              {categories.map(c => <option key={c} value={c}>{c === 'ALL' ? 'KATEGORI' : c.toUpperCase()}</option>)}
                            </select>
                        </div>
                        <div className="relative min-w-[100px] flex-1">
                            <StatusIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                            <select 
                              className="w-full pl-8 pr-2 py-2 bg-slate-50 border border-slate-200 rounded-xl text-[10px] font-black uppercase outline-none cursor-pointer"
                              value={statusFilter}
                              onChange={(e) => setStatusFilter(e.target.value)}
                            >
                              {statuses.map(s => <option key={s} value={s}>{s === 'ALL' ? 'STATUS' : s.toUpperCase()}</option>)}
                            </select>
                        </div>
                    </div>
                    <button onClick={() => setShowScanner(true)} className="bg-slate-900 text-white px-3 py-2 rounded-xl active:scale-95"><ScanLine size={16} className="text-red-500" /></button>
                    <div className="relative flex-1 md:w-40">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                        <input type="text" placeholder="Cari..." value={filter} onChange={(e) => setFilter(e.target.value)} className="w-full pl-8 pr-3 py-2 border border-slate-200 rounded-xl text-[10px] font-bold outline-none bg-slate-50" />
                    </div>
                </>
              )}
          </div>
        </div>
        <div className="p-0">
          {viewMode === 'recap' ? (
            <>
              {/* DESKTOP TABLE */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-left text-[10px] border-collapse min-w-[600px]">
                    <thead className="bg-slate-50 text-slate-500 font-black uppercase text-[8px] tracking-widest border-b border-slate-100">
                      <tr><th className="px-6 py-4">Identitas Produk</th><th className="px-4 py-4 text-center">Unit</th><th className="px-4 py-4 text-right bg-red-50/20 text-red-600">Stok</th><th className="px-4 py-4 text-center">Status</th><th className="px-6 py-4 text-center">Aksi</th></tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredRecap.map(p => {
                        return (
                        <tr key={p.id} className="hover:bg-slate-50/70 transition-all group">
                          <td className="px-6 py-4 cursor-pointer" onClick={() => setSelectedProduct(p)}>
                            <div className="font-black text-slate-900 uppercase text-[11px] leading-tight tracking-tight">{String(p.name)}</div>
                            <div className="flex items-center gap-2 mt-1">
                              <span className="text-[8px] font-mono font-bold text-slate-400 uppercase tracking-widest">{String(p.id)}</span>
                              <span className="text-[7px] font-black text-slate-300 uppercase tracking-widest bg-slate-50 px-2 py-0.5 rounded-lg border border-slate-100">{String(p.category)}</span>
                            </div>
                          </td>
                          <td className="px-4 py-4 text-center font-bold text-slate-400 uppercase">{String(p.unit)}</td>
                          <td className="px-4 py-4 text-right bg-red-50/5"><span className="text-sm font-black text-slate-900">{p.stockToday?.toLocaleString() || 0}</span></td>
                          <td className="px-4 py-4 text-center"><div className={`inline-flex items-center px-2 py-0.5 rounded-full text-[7px] font-black uppercase ${getStockStatus(p).color} ${getStockStatus(p).text}`}>{getStockStatus(p).label}</div></td>
                          <td className="px-6 py-4 text-center"><button onClick={() => setSelectedProduct(p)} className="p-2 text-slate-300 hover:text-slate-900"><Eye size={18} /></button></td>
                        </tr>
                      )})}
                    </tbody>
                </table>
              </div>

              {/* MOBILE CARDS OPTIMIZED */}
              <div className="md:hidden divide-y divide-slate-50 bg-slate-50/50">
                {filteredRecap.length > 0 ? filteredRecap.map(p => {
                  const status = getStockStatus(p);
                  return (
                    <div key={p.id} onClick={() => setSelectedProduct(p)} className="bg-white p-5 active:bg-slate-50 transition-colors flex justify-between items-center group">
                       <div className="flex-1 min-w-0 pr-4">
                          <h4 className="text-[12px] font-black text-slate-900 uppercase leading-tight truncate">{String(p.name)}</h4>
                          <div className="flex items-center gap-2 mt-1.5">
                             <span className="text-[8px] font-mono font-bold text-red-600 uppercase tracking-tighter">#{String(p.id)}</span>
                             <span className="text-[7px] font-black text-slate-400 uppercase tracking-widest bg-slate-100 px-2 py-0.5 rounded border border-slate-200">{String(p.category)}</span>
                          </div>
                          <div className="mt-3">
                             <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-[7px] font-black uppercase ${status.color} ${status.text} shadow-sm shadow-slate-200`}>
                                <div className="w-1 h-1 rounded-full bg-white animate-pulse"></div>
                                {status.label}
                             </div>
                          </div>
                       </div>
                       <div className="text-right flex flex-col items-end gap-1">
                          <div className="flex flex-col items-end leading-none">
                             <span className="text-[18px] font-black text-slate-900 tracking-tighter">{p.stockToday?.toLocaleString() || 0}</span>
                             <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest">{String(p.unit)}</span>
                          </div>
                          <div className="mt-2 p-2 bg-slate-50 rounded-xl text-slate-300 group-active:text-red-600 group-active:bg-red-50 transition-all">
                             <ChevronRight size={16} />
                          </div>
                       </div>
                    </div>
                  );
                }) : (
                  <div className="py-20 text-center flex flex-col items-center gap-3">
                     <Package size={40} className="text-slate-100" />
                     <p className="text-[10px] font-black text-slate-300 uppercase tracking-[0.3em]">No Data Matched</p>
                  </div>
                )}
              </div>
            </>
          ) : viewMode === 'opname' && !isViewer ? <div className="p-4">{onBulkAdjust && <StockOpname products={products} inventory={inventory} currentUser={currentUser} onBulkAdjust={onBulkAdjust} onRefresh={onRefresh} />}</div> : <div className="p-4"><MasterData products={products} currentUser={currentUser} onRefresh={async () => onRefresh?.()} /></div>}
        </div>
      </div>
      {selectedProduct && (
        <div className="fixed inset-0 z-[300] flex items-end md:items-center justify-center bg-slate-900/40 backdrop-blur-[2px] p-0 md:p-4">
          <div className="bg-white rounded-t-[2rem] md:rounded-[2rem] shadow-2xl w-full max-w-5xl flex flex-col max-h-[85vh] overflow-hidden">
            <div className="p-4 flex justify-between items-center border-b border-slate-100 bg-white sticky top-0 z-10">
              <div className="flex gap-3 items-center">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-white shadow-lg ${getStockStatus(selectedProduct).color}`}><Package size={18} /></div>
                <div><h3 className="text-sm font-black text-slate-900 uppercase tracking-tighter leading-none">{String(selectedProduct.name)}</h3><div className="flex items-center gap-2 mt-1"><span className="text-[7px] font-mono font-bold text-slate-400 uppercase">{String(selectedProduct.id)}</span></div></div>
              </div>
              <button onClick={() => setSelectedProduct(null)} className="p-2 text-slate-400 hover:text-red-600 bg-slate-50 rounded-full"><X size={18} /></button>
            </div>
            <div className="flex-1 overflow-y-auto bg-slate-50">
                <div className="m-4 p-5 bg-gradient-to-br from-slate-900 to-slate-800 rounded-3xl text-white shadow-xl flex flex-col md:flex-row gap-6">
                    <div className="flex-1 lg:border-r lg:border-white/10 lg:pr-6">
                      <span className="text-[9px] font-black text-slate-400 uppercase tracking-[0.2em] mb-3 flex items-center gap-2"><TrendingDown size={12} className="text-red-500" /> Analisis Kecepatan Konsumsi</span>
                      <div className="flex items-end gap-3"><span className="text-3xl font-black">{exhaustionData?.avg.toFixed(2)}</span><span className="text-[10px] font-bold text-slate-400 uppercase mb-2">{String(selectedProduct.unit)} / Hari</span></div>
                    </div>
                    <div className="flex-1">
                      <span className="text-[9px] font-black text-slate-400 uppercase tracking-[0.2em] mb-3 flex items-center gap-2">
                         <Timer size={12} className="text-amber-500" /> Estimasi Habis 
                         {getRestockEstimation(selectedProduct).dateText && <span className="text-[8px] tracking-widest bg-white/10 text-slate-300 px-2 py-0.5 rounded-full ml-1">{getRestockEstimation(selectedProduct).dateText}</span>}
                      </span>
                      <div className="flex items-end gap-3" title={getRestockEstimation(selectedProduct).tooltip}>
                         <span className={`text-2xl font-black ${getRestockEstimation(selectedProduct).shouldRestock ? 'text-red-400' : 'text-emerald-400'}`}>{getRestockEstimation(selectedProduct).text}</span>
                         {getRestockEstimation(selectedProduct).shouldRestock && <span className="text-[9px] font-black bg-white focus:outline-none text-red-600 px-2 py-0.5 rounded uppercase mb-1.5 tracking-widest">Restock!</span>}
                      </div>
                    </div>
                </div>
                <div className="bg-white p-4"><div className="flex bg-slate-100 p-0.5 rounded-xl"><button onClick={() => setDetailTab('batches')} className={`flex-1 py-2 rounded-lg text-[8px] font-black uppercase transition-all ${detailTab === 'batches' ? 'bg-white text-red-600 shadow-sm' : 'text-slate-400'}`}>Stiker</button><button onClick={() => setDetailTab('history')} className={`flex-1 py-2 rounded-lg text-[8px] font-black uppercase transition-all ${detailTab === 'history' ? 'bg-white text-red-600 shadow-sm' : 'text-slate-400'}`}>Mutasi</button></div></div>
                <div className="p-4">
                {detailTab === 'batches' ? (
                  <div className="space-y-3">
                    {productBatches.map((item) => (
                        <div key={item.uniqueId} className="bg-white p-4 rounded-3xl border border-slate-200 shadow-sm group">
                          <div className="flex justify-between items-start">
                             <div className="flex items-center gap-3">
                               <div className="p-2 bg-slate-50 rounded-xl text-slate-400"><Tag size={16} /></div>
                               <div className="flex flex-col min-w-0">
                                  <span className="text-[11px] font-black text-slate-900 uppercase">{String(item.batchCode || 'GENERAL')}</span>
                                  <span className="text-[7px] font-mono font-bold text-slate-400 uppercase mt-1 tracking-widest truncate">{String(item.uniqueId)}</span>
                                  <div className="flex flex-col gap-1 mt-1">
                                     <div className="flex items-center gap-1.5">
                                        <Calendar size={10} className="text-red-500" />
                                        <span className="text-[8px] font-black text-slate-500 uppercase tracking-widest">Masuk: {formatDateReadable(item.arrivalDate)}</span>
                                     </div>
                                     <div className="flex items-center gap-1.5">
                                        <Truck size={10} className="text-slate-400" />
                                        <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Supp: {String(item.supplier)}</span>
                                     </div>
                                     {item.expiryDate && item.expiryDate !== '-' && (
                                       <div className="flex items-center gap-1.5">
                                          <Timer size={10} className="text-amber-500" />
                                          <span className="text-[8px] font-black text-slate-500 uppercase tracking-widest">Exp: {formatDateReadable(item.expiryDate)}</span>
                                       </div>
                                     )}
                                  </div>
                               </div>
                             </div>
                             <div className="text-right"><div className="text-sm font-black text-slate-900">{item.quantity.toLocaleString()} <span className="text-[8px] uppercase text-slate-400 ml-1 font-bold">{String(selectedProduct.unit)}</span></div></div>
                          </div>
                          <div className="flex items-center justify-between gap-2 mt-4">
                             {item.note && <div className="flex-1 flex items-center gap-2 px-3 py-2 bg-blue-50/50 rounded-xl"><FileText size={10} className="text-blue-400" /><span className="text-[8px] font-bold text-blue-600 italic truncate">{String(item.note)}</span></div>}
                             {!item.isUnlabeled && (
                               <button onClick={() => setPreviewSticker({ item: { name: selectedProduct.name, code: item.uniqueId, batchCode: item.batchCode, quantity: item.quantity, unit: selectedProduct.unit }, supplier: item.supplier, arrivalDate: item.arrivalDate, expiryDate: item.expiryDate })} className="flex items-center gap-1.5 px-4 py-2 bg-white border border-slate-200 rounded-xl text-[8px] font-black uppercase shrink-0 hover:bg-slate-50 transition-colors"><Printer size={12} /> Lihat Stiker</button>
                             )}
                          </div>
                        </div>
                    ))}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {recentHistory.map((log) => (
                        <div key={log.id} className="bg-white p-3 rounded-2xl border border-slate-200 shadow-sm relative overflow-hidden">
                          <div className={`absolute left-0 top-0 bottom-0 w-1 ${log.type === 'IN' ? 'bg-emerald-500' : log.type === 'OUT' ? 'bg-red-500' : 'bg-blue-500'}`}></div>
                          <div className="flex justify-between items-start mb-2">
                             <div className="flex flex-col">
                                <span className={`text-[7px] font-black uppercase tracking-widest ${log.type === 'IN' ? 'text-emerald-600' : log.type === 'OUT' ? 'text-red-600' : 'text-blue-600'}`}>{String(log.type)}</span>
                                <p className="text-[9px] font-black text-slate-900">{formatDateTimeFull(log.timestamp)}</p>
                             </div>
                             <div className={`text-xs font-black ${Number(log.quantityChange || 0) > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                               {Number(log.quantityChange || 0) > 0 ? '+' : ''}{log.quantityChange?.toLocaleString()}
                             </div>
                          </div>
                          <div className="flex items-center justify-between pt-2 border-t border-slate-50">
                             <div className="flex items-center gap-1"><UserIcon size={10} className="text-red-600" /><span className="text-[8px] font-black text-slate-900 uppercase">{String(log.user || 'SYS')}</span></div>
                             <div className="flex items-center gap-1 max-w-[60%]"><Info size={10} className="text-slate-300" /><span className="text-[8px] font-bold text-slate-400 italic truncate">{String(log.recipient || log.note || '-')}</span></div>
                          </div>
                        </div>
                    ))}
                  </div>
                )}
                </div>
                {!isViewer && isAdminOrSuper && (
                  <div className="m-4 p-4 bg-white rounded-3xl border border-slate-200 space-y-3 shadow-sm">
                    <h4 className="text-[8px] font-black text-slate-900 uppercase tracking-widest flex items-center gap-2"><Settings2 size={12} className="text-blue-600" /> Alat Admin</h4>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1"><label className="text-[7px] font-black text-slate-400 uppercase block ml-1">Safety</label><input type="number" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-[10px] font-black outline-none" value={manageForm.safetyStock} onChange={(e) => setManageForm({...manageForm, safetyStock: parseInt(e.target.value) || 0})}/></div>
                      <div className="space-y-1"><label className="text-[7px] font-black text-slate-400 uppercase block ml-1">Koreksi (+/-)</label><input type="number" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-[10px] font-black outline-none" value={manageForm.adjustQty} onChange={(e) => setManageForm({...manageForm, adjustQty: parseFloat(e.target.value) || 0})}/></div>
                    </div>
                    {manageForm.adjustQty !== 0 && <input type="text" placeholder="Alasan..." className="w-full px-3 py-2 bg-blue-50 border border-blue-100 rounded-xl text-[10px] font-bold outline-none" value={manageForm.adjustNote} onChange={(e) => setManageForm({...manageForm, adjustNote: e.target.value})} />}
                    <button onClick={handleAdminUpdate} disabled={isAdminSubmitting} className="w-full py-3 bg-slate-900 text-white rounded-xl font-black uppercase text-[9px] tracking-widest flex items-center justify-center gap-2 active:scale-95 transition-all">
                      {isAdminSubmitting ? <RefreshCw className="animate-spin" size={12} /> : <Database size={14} />} SIMPAN PERUBAHAN
                    </button>
                  </div>
                )}
            </div>
            <div className="p-4 border-t border-slate-100 bg-white"><button onClick={() => setSelectedProduct(null)} className="w-full py-3 bg-slate-950 text-white rounded-xl font-black uppercase text-[9px] tracking-widest">TUTUP</button></div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Inventory;