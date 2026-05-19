
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { SimpleItem, SimpleTransaction, User } from '../types.ts';
import { db } from '../services/database.ts';
import { 
  Package, History, 
  FileSpreadsheet, Search, User as UserIcon, 
  // Added missing Info icon import
  Tag, Truck, UserCheck, Save, RefreshCw, Calendar, FileDown,
  Info, Briefcase, Users
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { toJpeg } from 'html-to-image';
import { jsPDF } from 'jspdf';

interface SimpleInventoryModuleProps {
  module: 'MT' | 'GA' | 'HR';
  currentUser: User;
}

const SimpleInventoryModule: React.FC<SimpleInventoryModuleProps> = ({ module, currentUser }) => {
  const isHRGAMode = module === 'GA' || module === 'HR';
  const [subModule, setSubModule] = useState<'GA' | 'HR'>(module === 'HR' ? 'HR' : 'GA');
  
  const isViewer = currentUser.role === 'Viewer';
  const [activeTab, setActiveTab] = useState<'in' | 'out' | 'log' | 'report'>(isViewer ? 'report' : 'in');
  const [masterItems, setMasterItems] = useState<SimpleItem[]>([]);
  const [transactions, setTransactions] = useState<SimpleTransaction[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchTermLog, setSearchTermLog] = useState('');
  const [searchTermReport, setSearchTermReport] = useState('');
  const exportRef = useRef<HTMLDivElement>(null);

  const [startDate, setStartDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState<string>(new Date().toISOString().split('T')[0]);

  const [form, setForm] = useState({ name: '', qty: 0, unit: 'Pcs', supplier: '', recipient: '', note: '' });

  // Logic: Auto-lookup unit based on name match
  useEffect(() => {
    if (form.name) {
      const match = masterItems.find(i => i.name.toUpperCase() === form.name.toUpperCase());
      if (match) {
        setForm(prev => ({ ...prev, unit: match.unit }));
      }
    }
  }, [form.name, masterItems]);

  const isKnownItem = useMemo(() => 
    masterItems.some(i => i.name.toUpperCase() === form.name.toUpperCase()),
  [form.name, masterItems]);

  const loadData = async () => {
    setIsLoading(true);
    const targetModule = isHRGAMode ? subModule : module;
    try {
      const [items, txs] = await Promise.all([
        db.getSimpleItems(targetModule), 
        db.getSimpleTransactions(targetModule)
      ]);
      setMasterItems(items);
      setTransactions(txs);
    } catch (err) { 
      console.error(err); 
    } finally { 
      setIsLoading(false); 
    }
  };

  useEffect(() => { loadData(); }, [module, subModule]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isViewer || !form.name || form.qty <= 0) return;
    setIsLoading(true);
    const targetModule = isHRGAMode ? subModule : module;
    try {
      const tx: SimpleTransaction = { 
        timestamp: Date.now(), 
        type: activeTab === 'in' ? 'IN' : 'OUT', 
        itemName: form.name.toUpperCase(), 
        quantity: form.qty, 
        unit: form.unit || 'Pcs', 
        supplier: activeTab === 'in' ? form.supplier : undefined, 
        recipient: activeTab === 'out' ? form.recipient : undefined, 
        officer: currentUser.username, 
        note: form.note, 
        module: targetModule
      };
      await db.addSimpleTransaction(tx);
      setForm({ name: '', qty: 0, unit: 'Pcs', supplier: '', recipient: '', note: '' });
      await loadData();
    } catch (err) { alert("Gagal simpan."); } finally { setIsLoading(false); }
  };

  const filteredTransactions = useMemo(() => {
    const startTs = new Date(startDate).setHours(0,0,0,0);
    const endTs = new Date(endDate).setHours(23,59,59,999);
    const search = searchTermLog.toLowerCase();
    return transactions.filter(t => {
      const matchDate = t.timestamp >= startTs && t.timestamp <= endTs;
      const matchSearch = t.itemName.toLowerCase().includes(search) || t.officer.toLowerCase().includes(search) || (t.supplier && t.supplier.toLowerCase().includes(search)) || (t.recipient && t.recipient.toLowerCase().includes(search));
      return matchDate && matchSearch;
    });
  }, [transactions, startDate, endDate, searchTermLog]);

  const inventorySummary = useMemo(() => {
    const startTs = new Date(startDate).setHours(0,0,0,0);
    const endTs = new Date(endDate).setHours(23,59,59,999);
    const summary: Record<string, any> = {};
    masterItems.forEach(m => {
      const name = m.name.toUpperCase();
      if (!summary[name]) summary[name] = { name: m.name, unit: m.unit, opening: 0, in: 0, out: 0, closing: 0 };
      summary[name].opening += Number(m.initialStock) || 0;
    });
    transactions.forEach(t => {
      const name = t.itemName.toUpperCase();
      if (!summary[name]) summary[name] = { name: t.itemName, unit: t.unit, opening: 0, in: 0, out: 0, closing: 0 };
      const qty = Number(t.quantity) || 0;
      if (t.timestamp < startTs) {
        if (t.type === 'IN') summary[name].opening += qty;
        else summary[name].opening -= qty;
      } else if (t.timestamp >= startTs && t.timestamp <= endTs) {
        if (t.type === 'IN') summary[name].in += qty;
        else summary[name].out += qty;
      }
    });
    Object.values(summary).forEach(s => { s.closing = s.opening + s.in - s.out; });
    return Object.values(summary).filter(s => s.name.toLowerCase().includes(searchTermReport.toLowerCase())).sort((a, b) => a.name.localeCompare(b.name));
  }, [transactions, masterItems, startDate, endDate, searchTermReport]);

  const exportExcel = () => {
    const targetLabel = isHRGAMode ? subModule : module;
    const ws = XLSX.utils.json_to_sheet(inventorySummary.map(s => ({ 'Barang': s.name, 'Unit': s.unit, 'Awal': s.opening, 'Masuk': s.in, 'Keluar': s.out, 'Akhir': s.closing })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Rekap");
    XLSX.writeFile(wb, `Rekap_${targetLabel}.xlsx`);
  };

  const exportPDF = async () => {
    if (!exportRef.current) return;
    setIsLoading(true);
    const targetLabel = isHRGAMode ? subModule : module;
    try {
      const dataUrl = await toJpeg(exportRef.current, { quality: 0.95, backgroundColor: '#ffffff', pixelRatio: 2 });
      const pdf = new jsPDF({ orientation: 'p', unit: 'px', format: [exportRef.current.offsetWidth + 40, exportRef.current.offsetHeight + 40] });
      pdf.addImage(dataUrl, 'JPEG', 20, 20, exportRef.current.offsetWidth, exportRef.current.offsetHeight);
      pdf.save(`Laporan_${targetLabel}.pdf`);
    } catch (err) { alert("PDF Error."); } finally { setIsLoading(false); }
  };

  const currentThemeColor = module === 'MT' ? 'bg-blue-600' : subModule === 'HR' ? 'bg-indigo-600' : 'bg-purple-600';
  const currentAccentColor = module === 'MT' ? 'text-blue-600' : subModule === 'HR' ? 'text-indigo-600' : 'text-purple-600';

  return (
    <div className="space-y-6 pb-10">
      <div style={{ position: 'absolute', left: '-9999px', top: 0, pointerEvents: 'none' }}>
        <div ref={exportRef} className="bg-white p-12 w-[1000px]">
           <div className="text-center mb-10">
              <h1 className="text-3xl font-black uppercase">Laporan Inventaris {isHRGAMode ? `HRGA (${subModule})` : module}</h1>
              <p className="text-sm font-bold text-slate-400 mt-2">Periode: {startDate} s/d {endDate}</p>
           </div>
           <table className="w-full border-collapse border border-slate-200 text-xs">
              <thead>
                <tr className="bg-slate-900 text-white font-black uppercase">
                  <th className="px-6 py-4 border border-slate-700">Nama Barang</th>
                  <th className="px-4 py-4 border border-slate-700 text-center">Unit</th>
                  <th className="px-6 py-4 border border-slate-700 text-right bg-slate-800">Awal</th>
                  <th className="px-6 py-4 border border-slate-700 text-right text-emerald-400">Masuk</th>
                  <th className="px-6 py-4 border border-slate-700 text-right text-red-400">Keluar</th>
                  <th className="px-6 py-4 border border-slate-700 text-right bg-blue-900">Akhir</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 font-bold uppercase">
                {inventorySummary.map(s => (
                  <tr key={s.name}>
                    <td className="px-6 py-4 border">{s.name}</td>
                    <td className="px-4 py-4 border text-center text-slate-400">{s.unit}</td>
                    <td className="px-6 py-4 border text-right bg-slate-50">{s.opening.toLocaleString()}</td>
                    <td className="px-6 py-4 border text-right text-emerald-600">+{s.in.toLocaleString()}</td>
                    <td className="px-6 py-4 border text-right text-red-600">-{s.out.toLocaleString()}</td>
                    <td className="px-6 py-4 border text-right bg-slate-50 font-black">{s.closing.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
           </table>
        </div>
      </div>

      <div className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm flex flex-col md:flex-row justify-between items-center gap-6">
        <div className="flex items-center gap-4">
          <div className={`w-12 h-12 ${currentThemeColor} text-white rounded-2xl flex items-center justify-center shadow-lg transition-colors`}>
            {module === 'MT' ? <Package size={28} /> : subModule === 'HR' ? <Users size={28} /> : <Briefcase size={28} />}
          </div>
          <div>
            <h2 className="text-2xl font-black text-slate-800 uppercase leading-none">
              {isHRGAMode ? 'HRGA Inventaris' : `${module} Inventaris`}
            </h2>
            <p className="text-[10px] font-bold text-slate-400 uppercase mt-1.5">Sistem Logistik Internal</p>
          </div>
          
          {isHRGAMode && (
            <div className="flex bg-slate-100 p-1 rounded-2xl border ml-0 md:ml-4">
               <button onClick={() => setSubModule('GA')} className={`px-4 py-1.5 rounded-xl text-[9px] font-black uppercase transition-all flex items-center gap-2 ${subModule === 'GA' ? 'bg-white text-purple-600 shadow-sm' : 'text-slate-400'}`}>
                 <Briefcase size={12} /> GA
               </button>
               <button onClick={() => setSubModule('HR')} className={`px-4 py-1.5 rounded-xl text-[9px] font-black uppercase transition-all flex items-center gap-2 ${subModule === 'HR' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-400'}`}>
                 <Users size={12} /> HR
               </button>
            </div>
          )}
        </div>
        <div className="flex bg-slate-100 p-1 rounded-2xl border w-full md:w-auto">
          {!isViewer && <button onClick={() => setActiveTab('in')} className={`flex-1 px-4 py-2 rounded-xl text-[9px] font-black uppercase transition-all ${activeTab === 'in' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-400'}`}>MASUK</button>}
          {!isViewer && <button onClick={() => setActiveTab('out')} className={`flex-1 px-4 py-2 rounded-xl text-[9px] font-black uppercase transition-all ${activeTab === 'out' ? 'bg-white text-red-600 shadow-sm' : 'text-slate-400'}`}>KELUAR</button>}
          <button onClick={() => setActiveTab('log')} className={`flex-1 px-4 py-2 rounded-xl text-[9px] font-black uppercase transition-all ${activeTab === 'log' ? `bg-white ${currentAccentColor} shadow-sm` : 'text-slate-400'}`}>LOG</button>
          <button onClick={() => setActiveTab('report')} className={`flex-1 px-4 py-2 rounded-xl text-[9px] font-black uppercase transition-all ${activeTab === 'report' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400'}`}>REKAP</button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className={`${(activeTab === 'report' || activeTab === 'log') ? 'lg:col-span-12' : 'lg:col-span-8'} space-y-6`}>
          {(activeTab === 'report' || activeTab === 'log') && (
             <div className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm flex flex-col md:flex-row justify-between gap-4">
                <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 border rounded-xl">
                   <Calendar size={14} className="text-slate-400" />
                   <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="bg-transparent text-[10px] font-black outline-none" />
                   <span className="text-slate-300 mx-2">-</span>
                   <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="bg-transparent text-[10px] font-black outline-none" />
                </div>
                <div className="flex-1 flex gap-3">
                   <div className="relative flex-1">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                      <input type="text" placeholder="Cari..." className="w-full pl-9 pr-4 py-2 bg-slate-50 border rounded-xl text-[10px] font-bold" value={activeTab === 'log' ? searchTermLog : searchTermReport} onChange={e => activeTab === 'log' ? setSearchTermLog(e.target.value) : setSearchTermReport(e.target.value)} />
                   </div>
                   {activeTab === 'report' && (
                     <div className="flex gap-2">
                        <button onClick={exportExcel} className="bg-emerald-600 text-white px-4 py-2 rounded-xl font-black text-[10px] uppercase flex items-center gap-2"><FileSpreadsheet size={16} /> XLSX</button>
                        <button onClick={exportPDF} className="bg-red-800 text-white px-4 py-2 rounded-xl font-black text-[10px] uppercase flex items-center gap-2"><FileDown size={16} /> PDF</button>
                     </div>
                   )}
                </div>
             </div>
          )}

          {activeTab === 'log' ? (
            <div className="space-y-4">
              <div className="hidden md:block bg-white rounded-[2rem] border overflow-hidden shadow-sm">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-400 font-black uppercase text-[8px] border-b">
                    <tr>
                      <th className="px-6 py-4">Waktu</th>
                      <th className="px-6 py-4">Barang</th>
                      <th className="px-4 py-4 text-center">Tipe</th>
                      <th className="px-4 py-4 text-right">Qty</th>
                      <th className="px-6 py-4">Penerima / Supplier</th>
                      <th className="px-6 py-4 text-center">Petugas</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y font-bold uppercase">
                    {filteredTransactions.map((t, idx) => (
                      <tr key={idx}>
                        <td className="px-6 py-4 text-slate-400">{new Date(t.timestamp).toLocaleString()}</td>
                        <td className="px-6 py-4 text-slate-900 max-w-[250px] truncate">{t.itemName}</td>
                        <td className="px-4 py-4 text-center">
                          <span className={`px-2 py-0.5 rounded-full text-[8px] font-black border ${t.type === 'IN' ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'}`}>{t.type}</span>
                        </td>
                        <td className={`px-4 py-4 text-right ${t.type === 'IN' ? 'text-emerald-600' : 'text-red-600'}`}>{t.type === 'IN' ? '+' : '-'}{t.quantity}</td>
                        <td className="px-6 py-4 text-slate-500 text-[10px] font-black">{t.recipient || t.supplier || '-'}</td>
                        <td className="px-6 py-4 text-slate-900 text-center">{t.officer}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="md:hidden space-y-3">
                {filteredTransactions.map((t, idx) => (
                  <div key={idx} className="bg-white p-4 rounded-[1.5rem] border shadow-sm space-y-3">
                    <div className="flex justify-between">
                      <span className={`px-2 py-0.5 rounded text-[8px] font-black border uppercase ${t.type === 'IN' ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'}`}>{t.type}</span>
                      <span className="text-[9px] font-bold text-slate-400">{new Date(t.timestamp).toLocaleTimeString()}</span>
                    </div>
                    <div className="flex justify-between items-start gap-4">
                      <div className="flex-1 min-w-0">
                        <h4 className="text-[11px] font-black text-slate-900 uppercase leading-tight truncate">{t.itemName}</h4>
                        <div className="flex items-center gap-1.5 mt-1.5">
                           <Info size={10} className="text-slate-400" />
                           <span className="text-[8px] font-black text-slate-500 uppercase">{t.recipient || t.supplier || '-'}</span>
                        </div>
                      </div>
                      <span className={`font-black text-sm shrink-0 ${t.type === 'IN' ? 'text-emerald-600' : 'text-red-600'}`}>{t.type === 'IN' ? '+' : '-'}{t.quantity}</span>
                    </div>
                    <div className="flex items-center gap-1.5 pt-2 border-t border-slate-50">
                       <UserIcon size={10} className="text-slate-400" />
                       <span className="text-[8px] font-black text-slate-400 uppercase">Petugas: {t.officer}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : activeTab === 'report' ? (
            <div className="bg-white rounded-[2rem] border overflow-hidden shadow-sm p-4 md:p-8">
              <div className="hidden md:block">
                <table className="w-full text-left text-[10px] border-collapse">
                  <thead className="bg-slate-50 text-slate-400 font-black uppercase text-[8px] border-b">
                    <tr><th className="px-3 py-2.5">Nama Barang</th><th className="px-2 py-2.5 text-center">Unit</th><th className="px-2 py-2.5 text-right text-blue-600">Awal</th><th className="px-2 py-2.5 text-right text-emerald-600">Masuk</th><th className="px-2 py-2.5 text-right text-red-600">Keluar</th><th className="px-3 py-2.5 text-right bg-slate-900 text-white">Akhir</th></tr>
                  </thead>
                  <tbody className="divide-y uppercase">
                    {inventorySummary.map(s => (
                      <tr key={s.name}>
                        <td className="px-3 py-2 font-black text-slate-900">{s.name}</td>
                        <td className="px-2 py-2 text-center font-bold text-slate-400">{s.unit}</td>
                        <td className="px-2 py-2 text-right font-black bg-blue-50/10">{s.opening.toLocaleString()}</td>
                        <td className="px-2 py-2 text-right font-black text-emerald-600">+{s.in.toLocaleString()}</td>
                        <td className="px-2 py-2 text-right font-black text-red-600">-{s.out.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right font-black bg-slate-50">{s.closing.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="md:hidden space-y-3">
                {inventorySummary.map(s => (
                  <div key={s.name} className="bg-slate-50 p-4 rounded-2xl border">
                    <h4 className="text-[11px] font-black text-slate-900 uppercase mb-3">{s.name}</h4>
                    <div className="grid grid-cols-4 gap-2 text-center font-bold">
                      <div className="flex flex-col"><span className="text-[7px] font-black text-slate-400">Awal</span><span className="text-[10px] text-blue-600">{s.opening}</span></div>
                      <div className="flex flex-col"><span className="text-[7px] font-black text-slate-400">In</span><span className="text-[10px] text-emerald-600">{s.in}</span></div>
                      <div className="flex flex-col"><span className="text-[7px] font-black text-slate-400">Out</span><span className="text-[10px] text-red-600">{s.out}</span></div>
                      <div className="flex flex-col"><span className="text-[7px] font-black text-slate-400">Saldo</span><span className="text-[11px] font-black">{s.closing}</span></div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            !isViewer && (
              <form onSubmit={handleSave} className="bg-white p-6 md:p-8 rounded-[2rem] border shadow-sm space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="md:col-span-2">
                    <label className="block text-[10px] font-black text-slate-500 uppercase mb-2 tracking-widest">Nama Barang</label>
                    <div className="relative">
                      <Tag className={`absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 transition-colors ${currentAccentColor}`} size={18} />
                      <input list={`items-${module}`} className="w-full h-14 p-4 pl-12 bg-slate-50 border border-slate-200 rounded-2xl font-black uppercase text-xs outline-none focus:ring-2 focus:ring-opacity-20 focus:ring-slate-400" placeholder="Ketik nama barang..." value={form.name} onChange={e => setForm({...form, name: e.target.value})} required />
                      <datalist id={`items-${module}`}>{masterItems.map((i, idx) => <option key={idx} value={i.name} />)}</datalist>
                    </div>
                  </div>
                  <div>
                    <label className="block text-[10px] font-black text-slate-500 uppercase mb-2 tracking-widest">Quantity</label>
                    <div className="flex gap-2 h-14">
                      <input type="number" step="0.01" className="flex-1 p-4 bg-slate-50 border border-slate-200 rounded-2xl font-black text-lg outline-none" value={form.qty || ''} onChange={e => setForm({...form, qty: parseFloat(e.target.value) || 0})} required />
                      <input 
                        className={`w-28 p-4 border rounded-2xl font-black text-xs text-center outline-none transition-all ${isKnownItem ? 'bg-white border-slate-200 text-slate-900 cursor-default' : 'bg-slate-50 border-slate-200 text-slate-900'}`}
                        value={form.unit} 
                        onChange={e => !isKnownItem && setForm({...form, unit: e.target.value})} 
                        placeholder="Unit" 
                        readOnly={isKnownItem}
                        required 
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[10px] font-black text-slate-500 uppercase mb-2 tracking-widest">{activeTab === 'in' ? 'Supplier' : 'Penerima'}</label>
                    <div className="relative">
                      {activeTab === 'in' ? <Truck className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} /> : <UserCheck className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />}
                      <input className="w-full h-14 p-4 pl-12 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-xs outline-none" placeholder="..." value={activeTab === 'in' ? form.supplier : form.recipient} onChange={e => setForm({...form, supplier: activeTab === 'in' ? e.target.value : '', recipient: activeTab === 'out' ? e.target.value : ''})} required />
                    </div>
                  </div>
                </div>
                <div className="pt-4 flex items-center justify-between bg-slate-50 p-4 rounded-2xl border-dashed border border-slate-200">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-slate-900 text-white rounded-xl flex items-center justify-center shadow-md"><UserIcon size={16} /></div>
                    <span className="text-[10px] font-black uppercase text-slate-900">{currentUser.username}</span>
                  </div>
                  <button type="submit" disabled={isLoading} className={`px-10 py-4 ${activeTab === 'in' ? 'bg-emerald-600' : 'bg-red-600'} text-white rounded-xl font-black uppercase text-xs shadow-xl active:scale-95 transition-all flex items-center gap-3`}>
                    {isLoading ? <RefreshCw className="animate-spin" size={18} /> : <><Save size={18} /> SIMPAN DATA</>}
                  </button>
                </div>
              </form>
            )
          )}
        </div>

        {(activeTab === 'in' || activeTab === 'out') && !isViewer && (
          <div className="lg:col-span-4 space-y-4">
            <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-500 px-2">Terakhir ({isHRGAMode ? subModule : module})</h3>
            <div className="space-y-3 max-h-[600px] overflow-y-auto custom-scrollbar pr-1">
              {transactions.slice(0, 10).map((t, idx) => (
                <div key={idx} className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm relative overflow-hidden group">
                  <div className={`absolute left-0 top-0 bottom-0 w-1 ${t.type === 'IN' ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'}`}></div>
                  <div className="flex justify-between items-start gap-4 mb-1">
                    <div className="flex-1 min-w-0">
                       <span className="text-[11px] font-black text-slate-900 uppercase truncate block leading-tight">{t.itemName}</span>
                       <span className="text-[7.5px] font-black text-slate-400 uppercase mt-1 block truncate">
                          {t.type === 'IN' ? `DARI: ${t.supplier || '-'}` : `UNTUK: ${t.recipient || '-'}`}
                       </span>
                    </div>
                    <span className={`text-[11px] font-black shrink-0 ${t.type === 'IN' ? 'text-emerald-600' : 'text-red-600'}`}>
                       {t.type === 'IN' ? '+' : '-'}{t.quantity}
                    </span>
                  </div>
                  <div className="text-[8px] font-bold text-slate-300 uppercase truncate mt-1 flex items-center gap-1.5">
                     <UserIcon size={10} /> {t.officer} • {new Date(t.timestamp).toLocaleTimeString()}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SimpleInventoryModule;
