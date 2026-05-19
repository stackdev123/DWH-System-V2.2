
import React, { useState, useRef } from 'react';
import { Product, StockItem, ItemStatus, LabelData } from '../types';
import LabelPreview from './LabelPreview';
import { Printer, Tag, RefreshCw, FileImage, FileCode, Settings, Zap, Printer as PrinterIcon, ChevronLeft } from 'lucide-react';
import SearchableSelect from './SearchableSelect';
import { toJpeg } from 'html-to-image';

interface LabelGeneratorProps {
  products: Product[];
  stock: StockItem[];
  onAddStock: (items: StockItem[]) => void;
}

const LabelGenerator: React.FC<LabelGeneratorProps> = ({ products, stock, onAddStock }) => {
  const [selectedProductId, setSelectedProductId] = useState<string>(products[0]?.id || '');
  const [supplier, setSupplier] = useState<string>('');
  const [batchCode, setBatchCode] = useState<string>(''); 
  const [itemCount, setItemCount] = useState<number | ''>(1);
  const [quantityPerItem, setQuantityPerItem] = useState<number | ''>('');
  const [arrivalDate, setArrivalDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [expiryDate, setExpiryDate] = useState<string>('');
  
  const [labelsToPrint, setLabelsToPrint] = useState<{item: StockItem, count: number} | null>(null);
  const [showPrintView, setShowPrintView] = useState(false);
  const [isSavingAll, setIsSavingAll] = useState(false);
  const [isDirectPrinting, setIsDirectPrinting] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);

  const selectedProduct = products.find(p => p.id === selectedProductId);

  const generateAutoBatch = () => {
    const d = new Date();
    const datePart = `${String(d.getDate()).padStart(2, '0')}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getFullYear()).slice(-2)}`;
    const random = Math.random().toString(36).substring(2, 5).toUpperCase();
    return `${datePart}DP${random}`;
  };

  const handleGenerateAndRegister = () => {
    const qtyValue = Number(quantityPerItem);
    const numStickers = Number(itemCount);

    if (!selectedProductId || !selectedProduct || numStickers <= 0 || qtyValue <= 0 || !supplier) {
      alert("Mohon isi data wajib: Produk, Supplier, Jml Stiker, & Isi/Stiker");
      return;
    }

    const dateInStr = arrivalDate.replace(/-/g, '');
    const dateExpStr = expiryDate ? expiryDate.replace(/-/g, '') : 'NOEXP';
    
    // Pastikan batch terisi otomatis jika kosong
    const finalBatchCode = batchCode.trim() || generateAutoBatch();
    if (!batchCode.trim()) setBatchCode(finalBatchCode);

    const cleanBatch = finalBatchCode.replace(/[^a-zA-Z0-9&]/g, '').toUpperCase();
    const randomSuffix = Math.random().toString(36).substring(2, 6).toUpperCase();

    const uniqueId = `${selectedProductId}-${cleanBatch}-${dateInStr}-${dateExpStr}-${randomSuffix}`;
    
    const singleStockItem: StockItem = {
      uniqueId,
      productId: selectedProductId,
      productName: selectedProduct.name,
      batchCode: finalBatchCode,
      arrivalDate,
      expiryDate,
      supplier,
      status: ItemStatus.CREATED,
      createdAt: Date.now(),
      quantity: qtyValue * numStickers,
    };

    onAddStock([singleStockItem]);
    
    setLabelsToPrint({
      item: { ...singleStockItem, quantity: qtyValue },
      count: numStickers
    });
    setShowPrintView(true);
  };

  const generateZPL = (item: StockItem) => {
    const prod = products.find(p => p.id === item.productId);
    const name = prod?.name || 'Unknown';
    return `
^XA
^PW812
^LL568
^CI28
^FO50,40^A0N,50,50^FB712,1,0,C^FD${name.toUpperCase()}^FS
^FO50,100^A0N,30,30^FB712,1,0,C^FD(BATCH: ${item.batchCode?.toUpperCase()})^FS
^FO50,140^GB712,3,3^FS
^FO60,180^BQN,2,10^FDMM,A${item.uniqueId}^FS
^FO350,190^A0N,32,32^FDID    : ${item.uniqueId}^FS
^FO350,240^A0N,30,30^FDSUPP  : ${item.supplier.toUpperCase()}^FS
^FO350,290^A0N,30,30^FDDATE  : ${item.arrivalDate}^FS
^FO350,340^A0N,30,30^FDEXP   : ${item.expiryDate || 'NO EXPIRY'}^FS
^FO50,450^GB712,3,3^FS
^FO50,470^A0N,30,30^FB712,1,0,C^FDVERIFIED SIGNATURE^FS
^FO306,540^GB200,1,1^FS
^XZ`.trim();
  };

  const tryFetch = async (url: string, zpl: string) => {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 3000);
    try {
      const response = await fetch(url, {
        method: 'POST',
        mode: 'cors',
        signal: controller.signal,
        body: JSON.stringify({ device: { name: 'Zebra' }, data: zpl })
      });
      clearTimeout(id);
      return response;
    } catch (e) {
      clearTimeout(id);
      throw e;
    }
  };

  const handleDirectPrint = async () => {
    if (!labelsToPrint) return;
    setIsDirectPrinting(true);
    
    const singleZpl = generateZPL(labelsToPrint.item);
    const allZpl = Array(labelsToPrint.count).fill(singleZpl).join('\n');
    
    try {
      try {
        const response = await tryFetch('https://localhost:9101/write', allZpl);
        if (response.ok) { alert("Terkirim ke Zebra!"); return; }
      } catch (e) {}
      
      const response2 = await tryFetch('http://localhost:9100/write', allZpl);
      if (response2.ok) { alert("Terkirim ke Zebra (9100)!"); } 
      else { throw new Error(); }
    } catch (err) {
      alert("Printer Zebra tidak terdeteksi. Pastikan Zebra Browser Print aktif.");
    } finally {
      setIsDirectPrinting(false);
    }
  };

  const downloadZPLFile = () => {
    if (!labelsToPrint) return;
    const singleZpl = generateZPL(labelsToPrint.item);
    const zplContent = Array(labelsToPrint.count).fill(singleZpl).join('\n');
    const blob = new Blob([zplContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Labels_${labelsToPrint.item.uniqueId}.zpl`;
    link.click();
  };

  const saveAllAsJpg = async () => {
    if (!labelsToPrint || isSavingAll) return;
    setIsSavingAll(true);
    try {
      const element = document.getElementById(`label-print-0`);
      const target = element?.querySelector('.label-content-capture') as HTMLElement;
      if (target) {
        const dataUrl = await toJpeg(target, { quality: 1, pixelRatio: 3 });
        const link = document.createElement('a');
        link.download = `${labelsToPrint.item.uniqueId}_MASTER.jpg`;
        link.href = dataUrl;
        link.click();
      }
    } finally {
      setIsSavingAll(false);
    }
  };

  if (showPrintView && labelsToPrint) {
    return (
      <div className="bg-slate-100 min-h-screen">
        <div className="no-print p-4 bg-white shadow-md flex flex-col md:flex-row justify-between items-center sticky top-0 z-50 border-b border-slate-100 gap-4">
          <button onClick={() => setShowPrintView(false)} className="flex items-center gap-2 text-slate-500 font-black text-[10px] uppercase tracking-widest hover:text-red-600 transition-colors">
            <ChevronLeft size={16} /> Kembali ke Form
          </button>
          <div className="flex flex-wrap gap-2">
            <button onClick={handleDirectPrint} disabled={isDirectPrinting} className="bg-red-600 hover:bg-red-700 text-white px-6 py-3 rounded-xl flex items-center gap-3 font-black text-[11px] uppercase tracking-widest active:scale-95 shadow-xl transition-all border-2 border-red-500">
              {isDirectPrinting ? <RefreshCw className="animate-spin" size={16} /> : <PrinterIcon size={18} />} PRINT {labelsToPrint.count} LEMBAR
            </button>
            <button onClick={downloadZPLFile} className="bg-slate-900 text-white px-5 py-3 rounded-xl flex items-center gap-2 font-black text-[10px] uppercase tracking-widest active:scale-95 shadow-xl">
              <FileCode size={16} className="text-red-500" /> ZPL
            </button>
            <button onClick={saveAllAsJpg} disabled={isSavingAll} className="bg-emerald-600 text-white px-5 py-3 rounded-xl flex items-center gap-2 font-black text-[10px] uppercase tracking-widest active:scale-95 shadow-lg">
              {isSavingAll ? <RefreshCw className="animate-spin" size={16} /> : <FileImage size={16} />} DOWNLOAD MASTER JPG
            </button>
          </div>
        </div>
        <div ref={printRef} className="p-10 flex flex-col gap-10 items-center thermal-print-container">
          <p className="no-print text-[10px] font-black text-slate-400 uppercase tracking-widest">Preview Stiker (Identik {labelsToPrint.count}x)</p>
          <div id="label-print-0" className="bg-white shadow-2xl p-0 border border-slate-200">
            <div className="label-content-capture">
              <LabelPreview data={{
                item: { 
                  name: labelsToPrint.item.productName, 
                  code: labelsToPrint.item.uniqueId, 
                  batchCode: labelsToPrint.item.batchCode, 
                  quantity: labelsToPrint.item.quantity, 
                  unit: selectedProduct?.unit || '' 
                },
                supplier: labelsToPrint.item.supplier, 
                arrivalDate: labelsToPrint.item.arrivalDate, 
                expiryDate: labelsToPrint.item.expiryDate
              }} scale={1} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="p-6 bg-white rounded-[2.5rem] shadow-sm border border-slate-200">
        <div className="flex justify-between items-center mb-8">
          <h2 className="text-sm font-black text-slate-800 flex items-center gap-2 uppercase tracking-tighter">
            <Tag className="w-5 h-5 text-red-600" /> Registrasi & Labeling
          </h2>
          <div className="hidden md:flex items-center gap-2 px-4 py-2 bg-slate-50 border border-slate-100 rounded-2xl">
              <Settings size={14} className="text-slate-400" />
              <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Single Entry Mode</span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="md:col-span-2">
            <SearchableSelect label="Produk *" options={products} value={selectedProductId} onChange={setSelectedProductId} />
          </div>

          <div>
            <label className="block text-[9px] font-black text-slate-400 uppercase mb-1.5 tracking-widest ml-1">Supplier *</label>
            <input type="text" className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-[11px] outline-none" placeholder="Pemasok..." value={supplier} onChange={(e) => setSupplier(e.target.value)} />
          </div>
          <div>
            <label className="block text-[9px] font-black text-slate-400 uppercase mb-1.5 tracking-widest ml-1">Batch / Lot (Opsional)</label>
            <input type="text" className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl font-mono font-bold text-[11px] uppercase outline-none" placeholder="Auto Generate..." value={batchCode} onChange={(e) => setBatchCode(e.target.value)} />
          </div>

          <div>
            <label className="block text-[9px] font-black text-slate-400 uppercase mb-1.5 tracking-widest ml-1">Arrival Date *</label>
            <input type="date" className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl text-[11px] font-bold outline-none" value={arrivalDate} onChange={(e) => setArrivalDate(e.target.value)} />
          </div>
          <div>
            <label className="block text-[9px] font-black text-slate-400 uppercase mb-1.5 tracking-widest ml-1">Expiry Date</label>
            <input type="date" className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl text-[11px] font-bold outline-none" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-3 md:col-span-2">
               <div className="relative">
                  <label className="block text-[9px] font-black text-slate-400 uppercase mb-1.5 tracking-widest ml-1">Isi per Lembar ({selectedProduct?.unit})</label>
                  <input type="number" step="0.01" className="w-full p-4 bg-white border border-slate-200 rounded-2xl font-black text-[15px] text-red-600 outline-none" value={quantityPerItem} onChange={(e) => setQuantityPerItem(e.target.value === '' ? '' : parseFloat(e.target.value))} placeholder="0.00" />
               </div>
               <div className="relative">
                  <label className="block text-[9px] font-black text-slate-400 uppercase mb-1.5 tracking-widest ml-1">Jumlah Cetak (Lembar)</label>
                  <input type="number" min="1" className="w-full p-4 bg-white border border-slate-200 rounded-2xl font-black text-[15px] text-slate-900 outline-none" value={itemCount} onChange={(e) => setItemCount(e.target.value === '' ? '' : parseInt(e.target.value))} placeholder="1" />
               </div>
          </div>

          <div className="md:col-span-2 pt-4">
            <button onClick={handleGenerateAndRegister} className="w-full bg-slate-900 hover:bg-black text-white font-black py-5 rounded-2xl shadow-xl active:scale-95 text-[12px] uppercase tracking-[0.2em] flex items-center justify-center gap-3">
              <Zap size={20} className="text-red-500" /> DAFTARKAN & GENERATE STIKER
            </button>
          </div>
        </div>
      </div>
      
      <div className="bg-slate-50 border border-slate-200 p-6 rounded-[2rem] flex items-start gap-4">
        <div className="p-3 bg-white rounded-2xl text-slate-400"><PrinterIcon size={20} /></div>
        <div>
          <h4 className="text-[10px] font-black uppercase text-slate-800 tracking-widest">Informasi Sistem Non-Granular</h4>
          <p className="text-[10px] font-bold text-slate-400 mt-1 leading-relaxed">Pendaftaran ini akan membuat 1 entitas stok dengan total quantity (Isi x Lembar). Semua stiker yang dicetak akan memiliki QR Code dan ID yang identik.</p>
        </div>
      </div>
    </div>
  );
};

export default LabelGenerator;
