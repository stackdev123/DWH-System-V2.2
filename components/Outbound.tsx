
import React, { useState, useMemo } from 'react';
import { StockItem, Product, ItemStatus } from '../types';
import { Scan, CheckCircle, Camera, RefreshCw, X, Trash2, AlertCircle, Package, ArrowUpRight, Filter, ListChecks, History } from 'lucide-react';
import CameraScanner from './CameraScanner';
import SearchableSelect from './SearchableSelect';

interface OutboundRequest {
  item: StockItem;
  qtyToTake: number;
  recipient: string;
  note: string;
  isLegacy?: boolean;
}

interface OutboundProps {
  products: Product[];
  stock: StockItem[];
  onOutbound: (requests: OutboundRequest[]) => Promise<void>;
  onRefresh?: () => void;
}

const Outbound: React.FC<OutboundProps> = ({ products, stock, onOutbound, onRefresh }) => {
  const [mode, setMode] = useState<'scan' | 'manual'>('scan');
  const [sortBasis, setSortBasis] = useState<'expiry' | 'arrival'>('expiry');
  const [scanInput, setScanInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [showCamera, setShowCamera] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  const [pendingQueue, setPendingQueue] = useState<OutboundRequest[]>([]);
  
  const [showReviewModal, setShowReviewModal] = useState(false);
  
  const [selectedProductId, setSelectedProductId] = useState<string>('');
  const [selectedBatchId, setSelectedBatchId] = useState<string>('');

  const sanitizeId = (id: string) => id.trim().replace(/[^a-zA-Z0-9-&]/g, '').toUpperCase();
  const getProductUnit = (id: string) => products.find(p => p.id === id)?.unit || '';

  const formatDateReadable = (dateStr: string) => {
    if (!dateStr || dateStr === 'System' || dateStr === 'Migration' || dateStr === '-') return dateStr;
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return dateStr;
      const day = String(d.getDate()).padStart(2, '0');
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
      return `${day} ${months[d.getMonth()]} ${d.getFullYear()}`;
    } catch {
      return dateStr;
    }
  };

  const getAvailableItems = (productId: string) => {
    const prod = products.find(p => p.id === productId);
    if (!prod) return [];
    
    // 1. Ambil semua batch formal berlabel
    let items = stock.filter(s => s.productId === productId && String(s.status) === String(ItemStatus.IN_STOCK) && s.quantity > 0.001);
    
    // 2. Hitung selisih saldo untuk Batch Virtual Legacy
    const sumBatches = items.reduce((acc, i) => acc + (Number(i.quantity) || 0), 0);
    const gap = (prod.stockToday || 0) - sumBatches;
    
    if (gap > 0.01) {
      items.push({
        uniqueId: prod.id,
        productId: prod.id,
        productName: prod.name,
        batchCode: 'LEGACY',
        arrivalDate: 'System',
        expiryDate: '',
        supplier: 'Migration',
        status: ItemStatus.IN_STOCK,
        createdAt: 0,
        quantity: gap
      });
    }

    return items.sort((a, b) => {
      if (sortBasis === 'expiry') {
        if (!a.expiryDate && b.expiryDate) return 1;
        if (a.expiryDate && !b.expiryDate) return -1;
        if (a.expiryDate && b.expiryDate) return new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime();
      }
      return new Date(a.arrivalDate).getTime() - new Date(b.arrivalDate).getTime();
    });
  };

  const handleInputLogic = (input: string | string[]) => {
    setError(null);
    let codeArray: string[] = Array.isArray(input) ? input : input.split(/[,;\s\n]+/).filter(Boolean);
    if (codeArray.length === 0) return;

    const itemsToAdd: OutboundRequest[] = [];
    const missingCodes: string[] = [];

    // Menggunakan loop standar agar bisa continue/break berdasarkan konfirmasi user
    for (const code of codeArray) {
      const cleanCode = sanitizeId(code);
      if (!cleanCode) continue;

      // 1. Cek Unit ID Murni (Sistem Baru)
      let item = stock.find(s => sanitizeId(s.uniqueId) === cleanCode && String(s.status) === String(ItemStatus.IN_STOCK));
      let isLegacy = false;

      // 2. Cek Kode Produk (Sistem Lama/Legacy)
      if (!item) {
        const product = products.find(p => sanitizeId(p.id) === cleanCode);
        if (product) {
          const available = getAvailableItems(product.id);
          if (available.length > 0) {
            const exactLegacy = available.find(a => a.uniqueId === product.id);
            item = exactLegacy || available[0];
            isLegacy = true;
          }
        }
      }

      if (item) {
        // --- VALIDASI FEFO ---
        // Hanya berlaku jika barang yang di-scan punya expired date
        if (item.expiryDate && item.expiryDate !== '-' && item.expiryDate !== 'NOEXP') {
           // Cari batch lain dari produk yang sama yang expired-nya lebih dulu
           const availableItems = stock.filter(s => 
             s.productId === item!.productId && 
             String(s.status) === String(ItemStatus.IN_STOCK) && 
             s.quantity > 0.001 &&
             s.expiryDate && s.expiryDate !== '-' && s.expiryDate !== 'NOEXP'
           ).sort((a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime());

           const earliestBatch = availableItems[0];
           
           if (earliestBatch && earliestBatch.uniqueId !== item.uniqueId) {
             const scannedExpTs = new Date(item.expiryDate).getTime();
             const earliestExpTs = new Date(earliestBatch.expiryDate).getTime();

             // Jika yang di-scan expired-nya lebih lama (setelah) dari yang paling awal tersedia
             if (scannedExpTs > earliestExpTs) {
                const isConfirmed = window.confirm(
                  `⚠️ PERINGATAN FEFO!\n\n` +
                  `Barang yang di-scan: ${item.productName}\n` +
                  `Expired: ${formatDateReadable(item.expiryDate)} (Batch: ${item.batchCode})\n\n` +
                  `Ditemukan batch lain yang expired LEBIH AWAL:\n` +
                  `Expired: ${formatDateReadable(earliestBatch.expiryDate)} (Batch: ${earliestBatch.batchCode})\n\n` +
                  `Apakah Anda yakin ingin tetap menggunakan barang ini?`
                );
                if (!isConfirmed) continue; // Skip item ini jika user menolak
             }
           }
        }
        // --- END VALIDASI FEFO ---

        if (!pendingQueue.some(q => q.item.uniqueId === item!.uniqueId) && !itemsToAdd.some(q => q.item.uniqueId === item!.uniqueId)) {
          itemsToAdd.push({ item, qtyToTake: 0, recipient: '', note: '', isLegacy: isLegacy || item.uniqueId === item.productId });
        }
      } else {
        missingCodes.push(code);
      }
    }

    if (missingCodes.length > 0) setError(`${missingCodes.length} barcode tidak ditemukan atau stok kosong.`);
    if (itemsToAdd.length > 0) {
      setPendingQueue(prev => [...itemsToAdd, ...prev]);
    }
    setScanInput('');
  };

  const updateItemInQueue = (uniqueId: string, updates: Partial<OutboundRequest>) => {
    setPendingQueue(prev => prev.map(q => q.item.uniqueId === uniqueId ? { ...q, ...updates } : q));
  };

  const commitOutbound = async () => {
    if (pendingQueue.some(q => !q.recipient.trim())) {
      setError("Isi nama penerima untuk semua barang.");
      return;
    }
    if (pendingQueue.some(q => q.qtyToTake <= 0)) {
      setError("Isi jumlah (QTY) untuk semua barang.");
      return;
    }
    setIsProcessing(true);
    try {
      await onOutbound([...pendingQueue]);
      setPendingQueue([]); 
      setShowReviewModal(false);
      if (onRefresh) onRefresh();
    } catch (err: any) {
      setError(err?.message || "Gagal simpan.");
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 animate-in fade-in duration-300 pb-32 md:pb-6">
      {error && (
        <div className="mx-1 p-4 bg-red-600 text-white rounded-2xl flex items-center gap-4 shadow-xl z-[90]">
            <AlertCircle size={20} />
            <span className="flex-1 text-[11px] font-black uppercase tracking-tight">{error}</span>
            <button onClick={() => setError(null)}><X size={20} /></button>
        </div>
      )}

      <div className="bg-white p-5 rounded-[2.5rem] border border-slate-200 shadow-sm space-y-5">
        <div className="flex justify-between items-center px-1">
            <h2 className="text-[11px] font-black uppercase text-slate-400 tracking-widest flex items-center gap-2.5">
                <ArrowUpRight size={18} className="text-red-600" /> Pengeluaran Barang
            </h2>
            <div className="flex bg-slate-100 p-0.5 rounded-xl">
                <button onClick={() => setMode('scan')} className={`px-5 py-2 rounded-lg text-[10px] font-black uppercase transition-all ${mode === 'scan' ? 'bg-white text-red-600 shadow-sm' : 'text-slate-400'}`}>SCAN</button>
                <button onClick={() => setMode('manual')} className={`px-5 py-2 rounded-lg text-[10px] font-black uppercase transition-all ${mode === 'manual' ? 'bg-white text-red-600 shadow-sm' : 'text-slate-400'}`}>MANUAL</button>
            </div>
        </div>

        {mode === 'scan' ? (
            <div className="flex gap-2">
                <div className="relative flex-1">
                    <Scan className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
                    <input type="text" value={scanInput} onChange={e => setScanInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleInputLogic(scanInput)} placeholder="Scan ID Unit atau Kode Produk..." className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-[2rem] text-[12px] font-mono uppercase focus:ring-1 focus:ring-red-500 outline-none" />
                </div>
                <button onClick={() => setShowCamera(true)} className="bg-slate-900 text-white p-4 rounded-[2rem] active:scale-95 shadow-xl transition-all"><Camera size={22} /></button>
            </div>
        ) : (
            <div className="space-y-4">
                <SearchableSelect placeholder="Pilih Produk..." options={products} value={selectedProductId} onChange={setSelectedProductId} />
                <div className="flex flex-col md:flex-row gap-3">
                    <div className="flex-1">
                        <SearchableSelect 
                            placeholder="Pilih Batch..." 
                            options={getAvailableItems(selectedProductId).map(item => ({ 
                              id: item.uniqueId, 
                              name: `${item.batchCode === 'LEGACY' || item.uniqueId === item.productId ? '[LEGACY] ' : ''}${item.batchCode} (${item.quantity}) • IN: ${formatDateReadable(item.arrivalDate)}${item.expiryDate ? ` • EXP: ${formatDateReadable(item.expiryDate)}` : ''}` 
                            }))} 
                            value={selectedBatchId} 
                            onChange={setSelectedBatchId} 
                        />
                    </div>
                    <button onClick={() => {
                        const b = getAvailableItems(selectedProductId).find(x => x.uniqueId === selectedBatchId);
                        if (b) { 
                          handleInputLogic(b.uniqueId); // Gunakan wrapper logic agar FEFO tetap dicek di mode manual
                          setSelectedBatchId(''); 
                        }
                    }} disabled={!selectedBatchId} className="bg-red-600 text-white px-6 py-4 md:py-0 rounded-2xl disabled:opacity-30 active:scale-95 transition-all font-black text-[10px] uppercase w-full md:w-auto">TAMBAH</button>
                </div>
            </div>
        )}
      </div>

      <div className="flex-1 min-h-0 flex flex-col gap-3">
        <div className="flex justify-between items-center px-5">
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Antrean ({pendingQueue.length})</span>
            {pendingQueue.length > 0 && <button onClick={() => setPendingQueue([])} className="text-[9px] font-black text-red-500 uppercase">Bersihkan</button>}
        </div>
        
        <div className="space-y-3 px-1">
            {pendingQueue.map((req) => (
                <div key={req.item.uniqueId} className="bg-white p-4 rounded-[1.8rem] border border-slate-100 flex flex-col gap-3 shadow-sm animate-in slide-in-from-left-2 transition-all relative overflow-hidden">
                    {req.isLegacy && <div className="absolute top-0 right-0 bg-blue-600 text-white px-3 py-0.5 rounded-bl-xl text-[6.5px] font-black uppercase tracking-widest">Legacy Unit</div>}
                    <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                            <div className="w-8 h-8 bg-slate-50 rounded-lg flex items-center justify-center text-slate-900 border border-slate-100 shrink-0">
                                <Package size={16} />
                            </div>
                            <div className="flex flex-col min-w-0">
                                <span className="text-[11px] font-black text-slate-900 uppercase truncate leading-tight">{req.item.productName}</span>
                                <div className="flex flex-col mt-0.5">
                                   <div className="flex items-center gap-1.5 flex-wrap">
                                      <span className="text-[7.5px] font-black text-slate-500 uppercase tracking-tighter">
                                        {req.item.batchCode} ({req.item.quantity}) • IN: {formatDateReadable(req.item.arrivalDate)}
                                        {req.item.expiryDate ? ` • EXP: ${formatDateReadable(req.item.expiryDate)}` : ''}
                                      </span>
                                      {req.isLegacy && <History size={8} className="text-blue-500" />}
                                   </div>
                                   <span className="text-[6.5px] font-mono font-bold text-slate-300 truncate uppercase mt-0.5">[{req.item.uniqueId}]</span>
                                </div>
                            </div>
                        </div>
                        <button onClick={() => setPendingQueue(prev => prev.filter(q => q.item.uniqueId !== req.item.uniqueId))} className="p-1 text-slate-200 hover:text-red-500 transition-colors">
                            <Trash2 size={16} />
                        </button>
                    </div>

                    <div className="grid grid-cols-1 gap-1.5">
                        <input 
                          type="text" 
                          placeholder="Nama Penerima..." 
                          value={req.recipient}
                          onChange={(e) => updateItemInQueue(req.item.uniqueId, { recipient: e.target.value.toUpperCase() })}
                          className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-[9px] font-black uppercase outline-none focus:ring-1 focus:ring-red-500 placeholder:text-slate-300"
                        />
                        <div className="flex items-center gap-2">
                            <input 
                              type="text" 
                              placeholder="Keterangan..." 
                              value={req.note}
                              onChange={(e) => updateItemInQueue(req.item.uniqueId, { note: e.target.value })}
                              className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-[9px] font-bold outline-none placeholder:text-slate-300"
                            />
                            <div className="flex items-center justify-between gap-1.5 px-3 py-2 bg-red-50 border border-red-100 rounded-xl shrink-0 w-24">
                                <div className="flex items-center gap-1 min-w-0">
                                    <input 
                                      type="number" 
                                      step="0.01"
                                      value={req.qtyToTake === 0 ? '' : req.qtyToTake}
                                      placeholder="0"
                                      onChange={(e) => {
                                        const val = e.target.value === '' ? 0 : parseFloat(e.target.value);
                                        if (val > req.item.quantity) return;
                                        updateItemInQueue(req.item.uniqueId, { qtyToTake: val });
                                      }}
                                      className="w-full bg-transparent text-[11px] font-black text-red-600 outline-none text-right"
                                    />
                                    <span className="text-[7.5px] font-black text-red-300 uppercase shrink-0">{getProductUnit(req.item.productId)}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            ))}
            {pendingQueue.length === 0 && (
                <div className="py-16 text-center text-slate-300 italic text-[11px] font-black tracking-widest bg-white rounded-[2rem] border-2 border-dashed border-slate-100">
                    SCAN ATAU INPUT MANUAL
                </div>
            )}
        </div>
      </div>

      {pendingQueue.length > 0 && (
          <div className="fixed bottom-20 left-4 right-4 md:relative md:bottom-0 md:left-0 md:right-0 z-[80] animate-in slide-in-from-bottom-5">
              <button 
                onClick={() => setShowReviewModal(true)} 
                className="w-full bg-red-600 text-white font-black py-3.5 rounded-xl uppercase text-[10px] tracking-[0.2em] shadow-lg shadow-red-900/20 active:scale-95 transition-all flex items-center justify-center gap-2 border border-red-500"
              >
                  <CheckCircle size={16} /> SIMPAN TRANSAKSI KELUAR
              </button>
          </div>
      )}

      {showReviewModal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-md p-6">
            <div className="bg-white rounded-[2.5rem] w-full max-w-sm p-10 shadow-2xl animate-in zoom-in-95 border border-slate-100">
                <div className="text-center mb-8">
                    <div className="w-20 h-20 bg-red-50 text-red-600 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-inner">
                        <ArrowUpRight size={32} />
                    </div>
                    <h3 className="text-2xl font-black text-slate-900 uppercase tracking-tighter">Simpan Data?</h3>
                    <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mt-3">Keluarkan {pendingQueue.length} SKU dari persediaan.</p>
                </div>
                <div className="flex flex-col gap-3">
                    <button onClick={commitOutbound} disabled={isProcessing} className="w-full py-5 bg-slate-900 text-white rounded-2xl font-black uppercase text-[11px] tracking-[0.3em] shadow-2xl active:scale-95 transition-all flex items-center justify-center gap-3">
                        {isProcessing ? <RefreshCw className="animate-spin" size={20} /> : <CheckCircle size={20} />} KONFIRMASI SIMPAN
                    </button>
                    <button onClick={() => setShowReviewModal(false)} className="w-full py-4 text-slate-400 font-black uppercase text-[10px] tracking-widest hover:bg-slate-50 rounded-xl transition-all">BATAL</button>
                </div>
            </div>
        </div>
      )}

      {showCamera && (
        <CameraScanner onScan={handleInputLogic} onClose={() => setShowCamera(false)} products={products} stockItems={stock} />
      )}
    </div>
  );
};

export default Outbound;
