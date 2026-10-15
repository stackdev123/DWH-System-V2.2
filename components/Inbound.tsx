
import React, { useState, useMemo } from 'react';
import { StockItem, Product, ItemStatus } from '../types';
import { Scan, ArrowDownLeft, CheckCircle, Camera, RefreshCw, X, Trash2, AlertCircle, Package, Layers, Zap, FileText, History } from 'lucide-react';
import CameraScanner from './CameraScanner';
import SearchableSelect from './SearchableSelect';

interface InboundProps {
  products: Product[];
  stock: StockItem[];
  onInbound: (items: StockItem[], note: string, isMigration?: boolean) => Promise<void>;
  onRefresh?: () => void;
}

const Inbound: React.FC<InboundProps> = ({ products, stock, onInbound, onRefresh }) => {
  const [mode, setMode] = useState<'scan' | 'manual'>('scan');
  const [scanInput, setScanInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [showCamera, setShowCamera] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isMigration, setIsMigration] = useState(false);

  const [pendingQueue, setPendingQueue] = useState<(StockItem & { isLegacy?: boolean })[]>([]);
  const [generalNote, setGeneralNote] = useState('');

  const [selectedProductId, setSelectedProductId] = useState<string>('');
  const [selectedBatchId, setSelectedBatchId] = useState<string>('');

  const sanitizeId = (id: string) => (id || '').trim().replace(/[^a-zA-Z0-9-&]/g, '').toUpperCase();

  const formatDateReadable = (dateStr: string) => {
    if (!dateStr || dateStr === 'System' || dateStr === 'Migration') return dateStr;
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

  const handleScanLogic = (input: string | string[]) => {
    setError(null);
    let codeArray: string[] = Array.isArray(input) ? input : input.split(/[,;\s\n]+/).filter(Boolean);

    const foundItems: (StockItem & { isLegacy?: boolean })[] = [];
    codeArray.forEach(code => {
      const cleanCode = sanitizeId(code);
      if (!cleanCode) return;

      // 1. Prioritas: Cari ID Unit murni (Sistem Baru)
      let item = stock.find(s => sanitizeId(s.uniqueId) === cleanCode && String(s.status) === String(ItemStatus.CREATED));
      let isLegacy = false;

      // 2. Fallback: Cek apakah ini ID Produk (Legacy Scan)
      if (!item) {
        const product = products.find(p => sanitizeId(p.id) === cleanCode);
        if (product) {
          item = stock.find(s => s.productId === product.id && String(s.status) === String(ItemStatus.CREATED));
          isLegacy = true;
        }
      }

      if (item && !pendingQueue.some(i => i.uniqueId === item!.uniqueId)) {
        foundItems.push({ ...item, note: '', isLegacy });
      }
    });

    if (foundItems.length > 0) {
      setPendingQueue(prev => [...foundItems, ...prev]);
    } else if (codeArray.length > 0) {
      setError("Item tidak terdaftar atau sudah di-inbound.");
    }
    setScanInput('');
    setSelectedBatchId('');
  };

  const updateItemNote = (uniqueId: string, note: string) => {
    setPendingQueue(prev => prev.map(item =>
      item.uniqueId === uniqueId ? { ...item, note } : item
    ));
  };

  const commitInbound = async () => {
    if (pendingQueue.length === 0) {
      setError("Antrean barang masuk masih kosong. Scan barcode atau pilih batch terlebih dahulu.");
      return;
    }
    setIsProcessing(true);
    try {
      await onInbound([...pendingQueue], generalNote, isMigration);
      setPendingQueue([]);
      setGeneralNote('');
      setIsMigration(false);
      if (onRefresh) onRefresh();
    } catch (err: any) {
      setError(err?.message || "Gagal simpan barang masuk.");
    } finally {
      setIsProcessing(false);
    }
  };

  const getProductUnit = (id: string) => products.find(p => p.id === id)?.unit || '';

  const availableBatches = useMemo(() => {
    if (!selectedProductId) return [];
    return stock
      .filter(s => s.productId === selectedProductId && String(s.status) === String(ItemStatus.CREATED))
      .map(s => {
        const isLegacy = s.uniqueId === s.productId;
        return {
          id: s.uniqueId,
          name: `${isLegacy ? '[LEGACY] ' : ''}${s.batchCode || 'No Batch'} (${s.quantity}) • In: ${formatDateReadable(s.arrivalDate)}`
        };
      });
  }, [stock, selectedProductId]);

  return (
    <div className="flex flex-col gap-3 animate-in fade-in duration-300">
      {error && (
        <div className="p-4 bg-red-600 text-white rounded-2xl flex items-center justify-between shadow-xl">
          <div className="flex items-center gap-3">
            <AlertCircle size={20} />
            <span className="text-[10px] font-black uppercase tracking-tight">{error}</span>
          </div>
          <button onClick={() => setError(null)}><X size={18} /></button>
        </div>
      )}

      <div className="bg-white p-5 rounded-[2.5rem] border border-slate-200 shadow-sm space-y-5">
        <div className="flex justify-between items-center">
          <h2 className="text-[11px] font-black uppercase text-slate-400 tracking-widest flex items-center gap-2">
            <ArrowDownLeft size={18} className="text-red-600" /> Inbound Goods
          </h2>
          <div className="flex bg-slate-100 p-0.5 rounded-xl">
            <button onClick={() => setMode('scan')} className={`px-5 py-2 rounded-lg text-[10px] font-black uppercase transition-all ${mode === 'scan' ? 'bg-white text-red-600 shadow-sm' : 'text-slate-400'}`}>SCAN</button>
            <button onClick={() => setMode('manual')} className={`px-5 py-2 rounded-lg text-[10px] font-black uppercase transition-all ${mode === 'manual' ? 'bg-white text-red-600 shadow-sm' : 'text-slate-400'}`}>MANUAL</button>
          </div>
        </div>

        {mode === 'scan' ? (
          <div className="flex gap-2">
            <input
              type="text"
              value={scanInput}
              onChange={(e) => setScanInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleScanLogic(scanInput)}
              placeholder="Scan ID Unit atau Kode Produk..."
              className="flex-1 px-5 py-4 bg-slate-50 border border-slate-200 rounded-[2rem] text-xs font-mono uppercase outline-none focus:ring-1 focus:ring-red-500"
            />
            <button onClick={() => setShowCamera(true)} className="bg-slate-900 text-white p-5 rounded-[2rem] active:scale-95 transition-all">
              <Camera size={22} />
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <SearchableSelect
              placeholder="1. Pilih Produk..."
              options={products}
              value={selectedProductId}
              onChange={(val) => {
                setSelectedProductId(val);
                setSelectedBatchId('');
              }}
            />
            <SearchableSelect
              placeholder={selectedProductId ? "2. Pilih Batch Terdaftar..." : "Pilih produk terlebih dahulu..."}
              options={availableBatches}
              value={selectedBatchId}
              onChange={setSelectedBatchId}
            />
            <button
              onClick={() => handleScanLogic(selectedBatchId)}
              disabled={!selectedBatchId}
              className="w-full bg-slate-900 text-white py-4 rounded-2xl font-black uppercase text-[10px] tracking-widest disabled:opacity-30 disabled:grayscale transition-all active:scale-95"
            >
              Tambahkan ke Antrean
            </button>
          </div>
        )}
      </div>

      <div className="space-y-3 max-h-[45vh] overflow-y-auto custom-scrollbar">
        {pendingQueue.map((item) => (
          <div key={item.uniqueId} className="bg-white p-5 rounded-[2rem] border border-slate-200 flex flex-col gap-3 shadow-sm relative overflow-hidden">
            {(item.isLegacy || item.uniqueId === item.productId) && <div className="absolute top-0 right-0 bg-blue-600 text-white px-3 py-1 rounded-bl-xl text-[7px] font-black uppercase tracking-widest">Legacy Unit</div>}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 bg-slate-50 text-red-600 rounded-xl flex items-center justify-center border border-slate-100"><Package size={20} /></div>
                <div className="flex flex-col">
                  <span className="text-[11px] font-black text-slate-900 uppercase truncate max-w-[200px] leading-tight">{item.productName}</span>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[8px] font-mono text-slate-400 uppercase tracking-widest">BATCH: {item.batchCode || 'No Batch'}</span>
                    {(item.isLegacy || item.uniqueId === item.productId) && <History size={10} className="text-blue-500" />}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <span className="text-[14px] font-black text-slate-900">+{item.quantity}</span>
                  <span className="text-[8px] font-black text-slate-400 uppercase block">{getProductUnit(item.productId)}</span>
                </div>
                <button onClick={() => setPendingQueue(prev => prev.filter(i => i.uniqueId !== item.uniqueId))} className="text-slate-200 hover:text-red-500"><Trash2 size={18} /></button>
              </div>
            </div>

            <div className="flex items-center gap-2 bg-slate-50 px-3 py-2 rounded-xl border border-slate-100">
              <FileText size={12} className="text-slate-400" />
              <input
                type="text"
                placeholder="Keterangan unit (Opsional)..."
                value={item.note || ''}
                onChange={(e) => updateItemNote(item.uniqueId, e.target.value)}
                className="flex-1 bg-transparent text-[10px] font-bold text-slate-600 outline-none"
              />
            </div>
          </div>
        ))}
        {pendingQueue.length === 0 && (
          <div className="py-20 text-center text-slate-300 italic text-[10px] font-black uppercase tracking-[0.3em] bg-white rounded-[2rem] border-2 border-dashed border-slate-50">
            ANTREAN KOSONG
          </div>
        )}
      </div>

      {pendingQueue.length > 0 && (
        <div className="bg-slate-900 p-6 rounded-[2.5rem] flex flex-col gap-4">
          <input
            type="text"
            placeholder="Catatan Transaksi..."
            value={generalNote}
            onChange={(e) => setGeneralNote(e.target.value)}
            className="w-full bg-white/10 border border-white/10 rounded-2xl px-5 py-3 text-white text-[11px] outline-none"
          />
          <button
            onClick={commitInbound}
            disabled={isProcessing}
            className="w-full bg-red-600 text-white font-black py-4 rounded-2xl uppercase text-[11px] tracking-widest flex items-center justify-center gap-3 active:scale-95 transition-all"
          >
            {isProcessing ? <RefreshCw className="animate-spin" size={18} /> : <CheckCircle size={18} />} SIMPAN TRANSAKSI
          </button>
        </div>
      )}

      {showCamera && (
        <CameraScanner
          onScan={handleScanLogic}
          onClose={() => setShowCamera(false)}
          products={products}
          stockItems={stock}
        />
      )}
    </div>
  );
};

export default Inbound;
