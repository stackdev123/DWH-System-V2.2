import React, { useMemo, useRef, useState } from 'react';
import { Product, StockItem, LogEntry } from '../types.ts';
import { 
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  AreaChart, Area, PieChart, Pie, Cell, Legend
} from 'recharts';
import { 
  Package, AlertTriangle, 
  Activity, ArrowUpRight, ArrowDownLeft, PieChart as PieIcon,
  TrendingUp, Zap, Clock, Timer, AlertOctagon, TimerOff,
  FileSpreadsheet, FileDown
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import { toJpeg } from 'html-to-image';

interface DashboardProps {
  products: Product[];
  stock: StockItem[];
  logs: LogEntry[];
}

const Dashboard: React.FC<DashboardProps> = ({ products, stock, logs }) => {
  const exportRef = useRef<HTMLDivElement>(null);
  const [isExporting, setIsExporting] = useState(false);

  const stats = useMemo(() => {
    const totalSKU = products.length;
    // Filter critical items: must be active, must have safety stock > 0, and current stock <= safety stock
    const criticalItems = products.filter(p => 
      p.isActive !== false && 
      (p.safetyStock || 0) > 0 && 
      (p.stockToday || 0) <= (p.safetyStock || 0)
    );
    
    const startOfDay = new Date().setHours(0, 0, 0, 0);
    const todayLogs = logs.filter(l => l.timestamp >= startOfDay);
    const todayIn = todayLogs.filter(l => l.type === 'IN').reduce((acc, l) => acc + (l.quantityChange || 0), 0);
    const todayOut = todayLogs.filter(l => l.type === 'OUT').reduce((acc, l) => acc + Math.abs(l.quantityChange || 0), 0);

    return { totalSKU, lowStockCount: criticalItems.length, criticalItems, todayIn, todayOut, todayTransCount: todayLogs.length };
  }, [products, logs]);

  const trendData = useMemo(() => {
    const last7Days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (6 - i));
      return d.toISOString().split('T')[0];
    });

    return last7Days.map(date => {
      const dayStart = new Date(date).setHours(0, 0, 0, 0);
      const dayEnd = new Date(date).setHours(23, 59, 59, 999);
      const dayLogs = logs.filter(l => l.timestamp >= dayStart && l.timestamp <= dayEnd);
      
      return {
        name: new Date(date).toLocaleDateString('id-ID', { weekday: 'short' }),
        masuk: dayLogs.filter(l => l.type === 'IN').reduce((acc, l) => acc + (l.quantityChange || 0), 0),
        keluar: dayLogs.filter(l => l.type === 'OUT').reduce((acc, l) => acc + Math.abs(l.quantityChange || 0), 0),
      };
    });
  }, [logs]);

  const expiryAlerts = useMemo(() => {
    const now = new Date();
    const oneMonthLater = new Date();
    oneMonthLater.setMonth(now.getMonth() + 1);

    const alerts = stock.filter(s => {
      if (s.quantity <= 0 || !s.expiryDate || s.expiryDate === '-' || s.expiryDate === 'NOEXP') return false;
      const prod = products.find(p => p.id === s.productId);
      return prod && prod.isActive !== false;
    }).map(s => {
      const expDate = new Date(s.expiryDate);
      const isExpired = expDate <= now;
      const isExpiringSoon = expDate <= oneMonthLater && !isExpired;
      return { ...s, isExpired, isExpiringSoon, daysLeft: Math.ceil((expDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) };
    }).filter(s => s.isExpired || s.isExpiringSoon);

    return alerts.sort((a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime());
  }, [stock, products]);

  const topVelocityItems = useMemo(() => {
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const outByProd: Record<string, { total: number, unit: string }> = {};
    
    logs.filter(l => l.type === 'OUT' && l.timestamp >= thirtyDaysAgo).forEach(l => {
      const prod = products.find(p => p.name === l.productName);
      if (!outByProd[l.productName]) {
        outByProd[l.productName] = { total: 0, unit: prod?.unit || '' };
      }
      outByProd[l.productName].total += Math.abs(l.quantityChange || 0);
    });

    return Object.entries(outByProd)
      .map(([name, data]) => ({ name, total: data.total, unit: data.unit }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);
  }, [logs, products]);

  const categoryData = useMemo(() => {
    const cats: Record<string, number> = {};
    products.forEach(p => {
      if (p.isActive !== false) {
        const catName = p.category || 'Lainnya';
        cats[catName] = (cats[catName] || 0) + (p.stockToday || 0);
      }
    });
    // Filter categories with 0 stock to make the chart readable
    const entries = Object.entries(cats)
      .map(([name, value]) => ({ name, value }))
      .filter(e => e.value > 0);
    
    return entries.length > 0 ? entries : [{ name: 'N/A', value: 0 }];
  }, [products]);

  const COLORS = ['#ef4444', '#0f172a', '#3b82f6', '#10b981', '#f59e0b'];

  const formatDateReadable = (dateStr: string) => {
    if (!dateStr || dateStr === '-') return '-';
    try {
      const d = new Date(dateStr);
      const day = String(d.getDate()).padStart(2, '0');
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
      return `${day} ${months[d.getMonth()]} ${d.getFullYear()}`;
    } catch { return dateStr; }
  };

  const exportExcel = () => {
    const wsDetail = XLSX.utils.json_to_sheet(expiryAlerts.map(item => ({
      'Barang': item.productName,
      'Batch': item.batchCode,
      'QTY': item.quantity,
      'Unit': products.find(p => p.id === item.productId)?.unit || '',
      'Status': item.isExpired ? 'EXPIRED' : `${item.daysLeft} Hari Lagi`,
      'Tgl Kedatangan': item.arrivalDate ? formatDateReadable(item.arrivalDate) : '-',
      'Tgl Expired': item.expiryDate ? formatDateReadable(item.expiryDate) : '-'
    })));

    const groupMap: Record<string, any> = {};
    expiryAlerts.forEach(item => {
      if (!groupMap[item.productName]) {
        groupMap[item.productName] = {
           'Barang': item.productName,
           'Total QTY Alert': 0,
           'Unit': products.find(p => p.id === item.productId)?.unit || '',
           'Banyak Batch': 0
        };
      }
      groupMap[item.productName]['Total QTY Alert'] += item.quantity;
      groupMap[item.productName]['Banyak Batch'] += 1;
    });

    const wsGroup = XLSX.utils.json_to_sheet(Object.values(groupMap));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, wsGroup, "Rekap Item");
    XLSX.utils.book_append_sheet(wb, wsDetail, "Detail Batch");
    XLSX.writeFile(wb, `Rekap_Kedaluwarsa.xlsx`);
  };

  const exportPDF = async () => {
    if (!exportRef.current) return;
    setIsExporting(true);
    try {
      const dataUrl = await toJpeg(exportRef.current, { quality: 0.95, backgroundColor: '#ffffff', pixelRatio: 2 });
      const pdf = new jsPDF({ orientation: 'p', unit: 'px', format: [exportRef.current.offsetWidth + 40, exportRef.current.offsetHeight + 40] });
      pdf.addImage(dataUrl, 'JPEG', 20, 20, exportRef.current.offsetWidth, exportRef.current.offsetHeight);
      pdf.save(`Rekap_Kadaluwarsa.pdf`);
    } catch (err) { alert("PDF Error."); } finally { setIsExporting(false); }
  };

  return (
    <div className="space-y-6 pb-20 animate-in fade-in duration-700">
      <div>
        <h1 className="text-2xl font-black text-slate-900 uppercase tracking-tighter">Analitik Gudang</h1>
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Visualisasi performa gudang secara real-time</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-[2rem] border border-slate-200 shadow-sm flex flex-col gap-3">
          <div className="w-10 h-10 bg-slate-900 text-white rounded-2xl flex items-center justify-center overflow-hidden">
            <img 
              src="logo2.png" 
              alt="BSI" 
              className="w-7 h-7 object-contain"
              onError={(e) => {
                (e.target as HTMLImageElement).src = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IndoaXRlIiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PHBhdGggZD0iTTIxIDE2VjhMMTIgNEwzIDhWMTZMMTIgMjBMMjEgMTZaIi8+PHBhdGggZD0iTTEyIDIyVjEyIi8+PHBhdGggZD0iTTMgOEwxMiAxMkwyMSA4Ii8+PC9zdmc+';
              }}
            />
          </div>
          <div>
            <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block">Total SKU</span>
            <span className="text-2xl font-black text-slate-900">{stats.totalSKU}</span>
          </div>
        </div>
        
        <div className={`p-5 rounded-[2rem] border shadow-sm flex flex-col gap-3 ${stats.lowStockCount > 0 ? 'bg-red-50 border-red-200' : 'bg-white border-slate-200'}`}>
          <div className={`w-10 h-10 rounded-2xl flex items-center justify-center ${stats.lowStockCount > 0 ? 'bg-red-600 text-white shadow-lg' : 'bg-slate-100 text-slate-600'}`}>
            <AlertTriangle size={20} />
          </div>
          <div>
            <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block">Status Kritis</span>
            <span className={`text-2xl font-black ${stats.lowStockCount > 0 ? 'text-red-600' : 'text-slate-900'}`}>{stats.lowStockCount} SKU</span>
          </div>
        </div>

        <div className="bg-white p-5 rounded-[2rem] border border-slate-200 shadow-sm flex flex-col gap-3">
          <div className="w-10 h-10 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center">
            <ArrowDownLeft size={20} />
          </div>
          <div>
            <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block">Masuk Hari Ini</span>
            <span className="text-2xl font-black text-emerald-600">+{stats.todayIn.toLocaleString()}</span>
          </div>
        </div>

        <div className="bg-white p-5 rounded-[2rem] border border-slate-200 shadow-sm flex flex-col gap-3">
          <div className="w-10 h-10 bg-red-50 text-red-600 rounded-2xl flex items-center justify-center">
            <ArrowUpRight size={20} />
          </div>
          <div>
            <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block">Keluar Hari Ini</span>
            <span className="text-2xl font-black text-red-600">-{stats.todayOut.toLocaleString()}</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white p-6 rounded-[2.5rem] border border-slate-200 shadow-sm flex flex-col min-h-[350px]">
          <div className="flex items-center justify-between mb-8">
            <h3 className="text-[11px] font-black text-slate-800 uppercase tracking-widest flex items-center gap-3">
              <TrendingUp size={18} className="text-red-600" /> Alur Aktivitas (7 Hari)
            </h3>
            <div className="flex gap-4">
              <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-full bg-emerald-500"></div><span className="text-[8px] font-black uppercase text-slate-400">MASUK</span></div>
              <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-full bg-red-500"></div><span className="text-[8px] font-black uppercase text-slate-400">KELUAR</span></div>
            </div>
          </div>
          <div className="w-full h-[250px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trendData}>
                <defs>
                  <linearGradient id="colorIn" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.15}/>
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorOut" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ef4444" stopOpacity={0.15}/>
                    <stop offset="95%" stopColor="#ef4444" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fontSize: 10, fontWeight: 900, fill: '#94a3b8'}} />
                <YAxis hide />
                <Tooltip 
                  contentStyle={{borderRadius: '20px', border: 'none', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)', fontSize: '10px', fontWeight: 'bold'}}
                  formatter={(value: any) => [value.toLocaleString(), '']}
                />
                <Area 
                  type="monotone" 
                  dataKey="masuk" 
                  name="Masuk" 
                  stroke="#10b981" 
                  fillOpacity={1} 
                  fill="url(#colorIn)" 
                  strokeWidth={4} 
                />
                <Area 
                  type="monotone" 
                  dataKey="keluar" 
                  name="Keluar" 
                  stroke="#ef4444" 
                  fillOpacity={1} 
                  fill="url(#colorOut)" 
                  strokeWidth={4} 
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-slate-900 p-6 rounded-[2.5rem] text-white shadow-xl flex flex-col">
          <h3 className="text-[11px] font-black uppercase tracking-widest flex items-center gap-3 mb-6">
            <Zap size={18} className="text-red-500" /> Barang Fast Moving (30 Hari)
          </h3>
          <div className="flex-1 space-y-4">
            {topVelocityItems.map((item, idx) => (
              <div key={idx} className="flex flex-col gap-1 group">
                <div className="flex justify-between items-center text-[10px] font-black uppercase">
                  <span className="truncate max-w-[150px]">{item.name}</span>
                  <span className="text-red-500">{item.total.toLocaleString()} {item.unit}</span>
                </div>
                <div className="h-1.5 w-full bg-white/10 rounded-full overflow-hidden">
                   <div 
                     className="h-full bg-red-600 transition-all duration-1000" 
                     style={{ width: `${(item.total / (topVelocityItems[0]?.total || 1)) * 100}%` }}
                   />
                </div>
              </div>
            ))}
            {topVelocityItems.length === 0 && (
              <div className="h-full flex flex-col items-center justify-center opacity-30 text-center gap-4">
                <Clock size={40} />
                <p className="text-[9px] font-black uppercase tracking-widest">Mengumpulkan data...</p>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-[2.5rem] border border-slate-200 shadow-sm flex flex-col">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-[11px] font-black text-slate-800 uppercase tracking-widest flex items-center gap-3">
              <Timer size={18} className="text-red-600" /> Monitor Kedaluwarsa
            </h3>
            <div className="flex items-center gap-2">
              <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest hidden sm:inline-block">Alert 1 Bulan & Expired</span>
              {expiryAlerts.length > 0 && (
                <div className="flex items-center gap-1 bg-slate-50 p-1 rounded-xl">
                  <button onClick={exportExcel} disabled={isExporting} className="p-1.5 bg-white text-emerald-600 rounded-lg shadow-sm hover:bg-emerald-50 transition-colors disabled:opacity-50" title="Download Excel">
                    <FileSpreadsheet size={14} />
                  </button>
                  <button onClick={exportPDF} disabled={isExporting} className="p-1.5 bg-white text-red-600 rounded-lg shadow-sm hover:bg-red-50 transition-colors disabled:opacity-50" title="Download PDF">
                    <FileDown size={14} />
                  </button>
                </div>
              )}
            </div>
          </div>
          <div className="space-y-3 flex-1 overflow-y-auto max-h-[350px] pr-1 custom-scrollbar">
            {expiryAlerts.map(item => (
              <div key={item.uniqueId} className={`flex items-center justify-between p-3 border rounded-2xl ${item.isExpired ? 'bg-red-50 border-red-100' : 'bg-amber-50 border-amber-100'}`}>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h4 className="text-[10px] font-black uppercase truncate text-slate-900">{item.productName}</h4>
                    {item.isExpired ? <AlertOctagon size={12} className="text-red-600" /> : <Timer size={12} className="text-amber-500" />}
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[7px] font-mono text-slate-400 uppercase">Batch: {item.batchCode}</span>
                    <span className={`text-[7px] font-black uppercase px-1.5 py-0.5 rounded-lg ${item.isExpired ? 'bg-red-600 text-white' : 'bg-amber-500 text-white'}`}>
                      {item.isExpired ? 'EXPIRED' : `${item.daysLeft} Hari Lagi`}
                    </span>
                  </div>
                </div>
                <div className="text-right pl-4">
                  <div className={`text-[10px] font-black ${item.isExpired ? 'text-red-600' : 'text-amber-600'}`}>{formatDateReadable(item.expiryDate)}</div>
                  <div className="text-[8px] font-bold text-slate-400 uppercase">{item.quantity.toLocaleString()} {products.find(p => p.id === item.productId)?.unit}</div>
                </div>
              </div>
            ))}
            {expiryAlerts.length === 0 && (
              <div className="py-20 flex flex-col items-center justify-center gap-3 text-slate-200">
                <TimerOff size={44} />
                <p className="text-[9px] font-black uppercase tracking-[0.2em]">Sistem Aman dari Expired</p>
              </div>
            )}
          </div>
        </div>

        <div className="bg-white p-6 rounded-[2.5rem] border border-slate-200 shadow-sm flex flex-col">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-[11px] font-black text-slate-800 uppercase tracking-widest flex items-center gap-3">
              <AlertTriangle size={18} className="text-amber-500" /> Stok Menipis
            </h3>
            <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Monitor Safety Stock</span>
          </div>
          <div className="space-y-3 flex-1 overflow-y-auto max-h-[350px] pr-1 custom-scrollbar">
            {stats.criticalItems.map(p => (
              <div key={p.id} className="flex items-center justify-between p-3 bg-slate-50/50 border border-slate-100 rounded-2xl">
                <div className="min-w-0 flex-1">
                  <h4 className="text-[10px] font-black uppercase truncate text-slate-900">{p.name}</h4>
                  <p className="text-[8px] font-mono text-slate-400 mt-0.5">ID: {p.id}</p>
                </div>
                <div className="text-right pl-4">
                  <div className="text-[12px] font-black text-red-600">{p.stockToday?.toLocaleString()} / <span className="text-slate-400 text-[10px]">{p.safetyStock?.toLocaleString()}</span></div>
                  <div className="text-[8px] font-black text-red-400 uppercase">{p.unit}</div>
                </div>
              </div>
            ))}
            {stats.criticalItems.length === 0 && (
              <div className="py-20 flex flex-col items-center justify-center gap-3 text-slate-200">
                <Activity size={44} />
                <p className="text-[9px] font-black uppercase tracking-[0.2em]">Semua Stok Terpenuhi</p>
              </div>
            )}
          </div>
        </div>
      </div>
      
      <div className="bg-white p-6 rounded-[2.5rem] border border-slate-200 shadow-sm flex flex-col min-h-[350px]">
        <div className="flex items-center justify-between mb-8">
          <h3 className="text-[11px] font-black text-slate-800 uppercase tracking-widest flex items-center gap-3">
            <PieIcon size={18} className="text-red-600" /> Distribusi Kategori
          </h3>
        </div>
        <div className="w-full h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={categoryData}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={90}
                paddingAngle={5}
                dataKey="value"
                nameKey="name"
                animationBegin={0}
                animationDuration={800}
              >
                {categoryData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(value: any) => [value.toLocaleString(), 'Total Stok']} />
              <Legend verticalAlign="bottom" iconType="circle" wrapperStyle={{fontSize: '9px', fontWeight: 900, textTransform: 'uppercase', paddingTop: '20px'}} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* EXPORT DATA (HIDDEN) */}
      <div style={{ position: 'absolute', left: '-9999px', top: 0, pointerEvents: 'none' }}>
        <div ref={exportRef} className="bg-white p-12 w-[1100px]">
          <div className="mb-8 border-b-4 border-slate-900 pb-6">
            <h1 className="text-3xl font-black text-slate-900 uppercase tracking-tighter">Laporan Rekap Kedaluwarsa</h1>
            <p className="text-sm font-bold text-slate-500 uppercase mt-2">DWH BSI SYSTEM • {formatDateReadable(new Date().toISOString())}</p>
          </div>
          
          <div className="mb-6">
            <h2 className="text-lg font-black text-slate-800 uppercase tracking-widest mb-3 border-l-4 border-red-600 pl-3">Rekap Per Item</h2>
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-slate-100 text-slate-900 font-black uppercase text-[10px] tracking-widest border-b-2 border-slate-900">
                <tr>
                  <th className="px-4 py-3">Nama Barang</th>
                  <th className="px-4 py-3 text-right">Total QTY Alert</th>
                  <th className="px-4 py-3 text-right">Jumlah Batch</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 font-bold text-slate-700">
                {Object.values(expiryAlerts.reduce((acc, item) => {
                  if (!acc[item.productName]) acc[item.productName] = { name: item.productName, qty: 0, unit: products.find(p => p.id === item.productId)?.unit || '', count: 0 };
                  acc[item.productName].qty += item.quantity;
                  acc[item.productName].count += 1;
                  return acc;
                }, {} as Record<string, {name: string, qty: number, unit: string, count: number}>)).map((g, i) => (
                  <tr key={i}>
                    <td className="px-4 py-3 border-r border-slate-100">{g.name}</td>
                    <td className="px-4 py-3 border-r border-slate-100 text-right text-red-600">{g.qty.toLocaleString()} <span className="text-[10px] text-slate-400">{g.unit}</span></td>
                    <td className="px-4 py-3 text-right">{g.count} Batch</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div>
            <h2 className="text-lg font-black text-slate-800 uppercase tracking-widest mb-3 border-l-4 border-red-600 pl-3">Detail Batch Kedaluwarsa</h2>
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-slate-100 text-slate-900 font-black uppercase text-[10px] tracking-widest border-b-2 border-slate-900">
                <tr>
                  <th className="px-4 py-3">Nama Barang</th>
                  <th className="px-4 py-3">Batch</th>
                  <th className="px-4 py-3 text-right">QTY</th>
                  <th className="px-4 py-3 text-center">Status</th>
                  <th className="px-4 py-3 text-right">Tgl Datang</th>
                  <th className="px-4 py-3 text-right">Tgl Expired</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 font-bold text-slate-700">
                {expiryAlerts.map(item => (
                  <tr key={item.uniqueId}>
                    <td className="px-4 py-3 border-r border-slate-100">{item.productName}</td>
                    <td className="px-4 py-3 border-r border-slate-100">{item.batchCode}</td>
                    <td className="px-4 py-3 border-r border-slate-100 text-right">{item.quantity.toLocaleString()} <span className="text-[10px] text-slate-400">{products.find(p => p.id === item.productId)?.unit}</span></td>
                    <td className={`px-4 py-3 border-r border-slate-100 text-center uppercase ${item.isExpired ? 'text-red-600' : 'text-amber-600'}`}>
                      {item.isExpired ? 'EXPIRED' : `${item.daysLeft} Hari Lagi`}
                    </td>
                    <td className="px-4 py-3 border-r border-slate-100 text-right uppercase">{item.arrivalDate ? formatDateReadable(item.arrivalDate) : '-'}</td>
                    <td className="px-4 py-3 text-right uppercase">{item.expiryDate ? formatDateReadable(item.expiryDate) : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;