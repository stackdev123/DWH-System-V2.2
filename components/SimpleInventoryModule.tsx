
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { SimpleItem, SimpleTransaction, User } from '../types.ts';
import { db, supabase } from '../services/database.ts';
import {
  Package, History,
  FileSpreadsheet, Search, User as UserIcon,
  Tag, Truck, UserCheck, Save, RefreshCw, Calendar, FileDown,
  Info, Briefcase, Users,
  ChevronDown, Plus, Lock, X, Check, FileText
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

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

  const [startDate, setStartDate] = useState<string>(() => {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}-01`;
  });
  const [endDate, setEndDate] = useState<string>(() => {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  });

  const getStartTimestamp = (dateStr: string) => {
    if (!dateStr || !dateStr.trim()) return 0;
    const parts = dateStr.trim().split('-').map(Number);
    if (parts.length !== 3 || isNaN(parts[0]) || isNaN(parts[1]) || isNaN(parts[2])) return 0;
    return new Date(parts[0], parts[1] - 1, parts[2], 0, 0, 0, 0).getTime();
  };

  const getEndTimestamp = (dateStr: string) => {
    if (!dateStr || !dateStr.trim()) return Infinity;
    const parts = dateStr.trim().split('-').map(Number);
    if (parts.length !== 3 || isNaN(parts[0]) || isNaN(parts[1]) || isNaN(parts[2])) return Infinity;
    return new Date(parts[0], parts[1] - 1, parts[2], 23, 59, 59, 999).getTime();
  };

  const [form, setForm] = useState({ name: '', qty: 0, unit: 'Pcs', supplier: '', recipient: '', note: '' });

  // Standard initial units
  const DEFAULT_UNITS = useMemo(() => [
    'Pcs', 'Box', 'Pack', 'Roll', 'Unit', 'Set',
    'Lembar', 'Rim', 'Dus', 'Btl', 'Can',
    'Kg', 'Gram', 'Liter', 'Meter'
  ], []);

  // Custom units saved by users
  const [customUnits, setCustomUnits] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('simple_inventory_custom_units');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [showAddUnitModal, setShowAddUnitModal] = useState(false);
  const [newUnitName, setNewUnitName] = useState('');
  const [addUnitError, setAddUnitError] = useState('');

  // Available units combining defaults, custom, master items, and transactions
  const availableUnits = useMemo(() => {
    const map = new Map<string, string>();
    DEFAULT_UNITS.forEach(u => map.set(u.toUpperCase(), u));
    customUnits.forEach(u => {
      if (u && u.trim()) map.set(u.trim().toUpperCase(), u.trim());
    });
    masterItems.forEach(i => {
      if (i.unit && i.unit.trim()) map.set(i.unit.trim().toUpperCase(), i.unit.trim());
    });
    transactions.forEach(t => {
      if (t.unit && t.unit.trim()) map.set(t.unit.trim().toUpperCase(), t.unit.trim());
    });
    if (form.unit && form.unit.trim()) {
      map.set(form.unit.trim().toUpperCase(), form.unit.trim());
    }
    return Array.from(map.values()).sort((a, b) => a.localeCompare(b));
  }, [DEFAULT_UNITS, customUnits, masterItems, transactions, form.unit]);

  const handleAddNewUnit = (unitToAdd?: string) => {
    const raw = (unitToAdd !== undefined ? unitToAdd : newUnitName).trim();
    if (!raw) {
      setAddUnitError('Nama satuan tidak boleh kosong');
      return;
    }
    // Format casing: if all lowercase or mixed, capitalize first letter of each word
    const formatted = raw.length <= 4
      ? raw.toUpperCase()
      : raw.charAt(0).toUpperCase() + raw.slice(1);

    const existingMatch = availableUnits.find(u => u.toUpperCase() === formatted.toUpperCase());
    const finalUnit = existingMatch || formatted;

    if (!existingMatch && !customUnits.some(u => u.toUpperCase() === finalUnit.toUpperCase())) {
      const updated = [...customUnits, finalUnit];
      setCustomUnits(updated);
      try {
        localStorage.setItem('simple_inventory_custom_units', JSON.stringify(updated));
      } catch (e) {
        console.error('Failed to save custom unit', e);
      }
    }

    setForm(prev => ({ ...prev, unit: finalUnit }));
    setNewUnitName('');
    setAddUnitError('');
    setShowAddUnitModal(false);
  };

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

  const loadData = async (forceFresh = false) => {
    setIsLoading(true);
    const targetModule = isHRGAMode ? subModule : module;
    try {
      const [items, txs] = await Promise.all([
        db.getSimpleItems(targetModule),
        db.getSimpleTransactions(targetModule, forceFresh)
      ]);
      setMasterItems(items);
      setTransactions(prev => {
        const txIds = new Set(txs.map(t => t.id));
        const now = Date.now();
        // Hanya pertahankan transaksi lokal sementara yang sesuai modul ini dan belum masuk Supabase
        const pendingLocal = prev.filter(t =>
          t.module === targetModule &&
          !txIds.has(t.id) &&
          t.id?.startsWith('tx-') &&
          !txs.some(s => s.itemName === t.itemName && s.type === t.type && Math.abs((Number(s.timestamp) || 0) - (Number(t.timestamp) || 0)) < 15000) &&
          (now - (Number(t.timestamp) || 0) < 300000)
        );
        return [...pendingLocal, ...txs].sort((a, b) => (Number(b.timestamp) || 0) - (Number(a.timestamp) || 0));
      });
    } catch (err) {
      console.error("Gagal loadData simple module:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData(true);

    const targetModule = isHRGAMode ? subModule : module;
    const channel = supabase
      .channel(`rt-simple-${targetModule}-${Date.now()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'simple_transactions' },
        (payload) => {
          const mod = (payload.new as any)?.module || (payload.old as any)?.module;
          if (!mod || mod === targetModule) {
            db.invalidateSimpleTxCache(targetModule);
            loadData(true);
          }
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'simple_master_items' },
        (payload) => {
          const mod = (payload.new as any)?.module || (payload.old as any)?.module;
          if (!mod || mod === targetModule) {
            loadData(true);
          }
        }
      )
      .subscribe();

    // Auto-refresh fallback setiap 15 detik jika tab browser sedang dibuka/aktif
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        loadData(false);
      }
    }, 15000);

    const handleFocus = () => {
      if (document.visibilityState === 'visible') {
        loadData(true);
      }
    };
    window.addEventListener('focus', handleFocus);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
      window.removeEventListener('focus', handleFocus);
    };
  }, [module, subModule, isHRGAMode]);

  const [successToast, setSuccessToast] = useState<{ message: string; tx: SimpleTransaction } | null>(null);

  useEffect(() => {
    if (!successToast) return;
    const timer = setTimeout(() => {
      setSuccessToast(null);
    }, 6000);
    return () => clearTimeout(timer);
  }, [successToast]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isViewer) {
      alert("Akun Viewer hanya memiliki akses baca (tidak dapat menyimpan transaksi).");
      return;
    }
    const cleanName = (form.name || '').trim();
    const cleanQty = Number(form.qty);
    if (!cleanName) {
      alert("Mohon isi Nama Barang terlebih dahulu.");
      return;
    }
    if (isNaN(cleanQty) || cleanQty <= 0) {
      alert("Mohon isi Quantity (jumlah barang) lebih dari 0.");
      return;
    }
    if (activeTab === 'in' && !form.supplier?.trim()) {
      alert("Mohon isi nama Supplier untuk barang masuk.");
      return;
    }
    if (activeTab === 'out' && !form.recipient?.trim()) {
      alert("Mohon isi nama Penerima untuk barang keluar.");
      return;
    }

    setIsLoading(true);
    const targetModule = isHRGAMode ? subModule : module;
    try {
      const tx: SimpleTransaction = {
        timestamp: Date.now(),
        type: activeTab === 'in' ? 'IN' : 'OUT',
        itemName: cleanName.toUpperCase(),
        quantity: cleanQty,
        unit: form.unit || 'Pcs',
        supplier: activeTab === 'in' ? form.supplier.trim() : undefined,
        recipient: activeTab === 'out' ? form.recipient.trim() : undefined,
        officer: currentUser?.username || 'GUDANG',
        note: form.note?.trim() || undefined,
        module: targetModule
      };
      const savedTx = await db.addSimpleTransaction(tx);
      // Update local transactions state immediately so it renders without delay in both log and sidebar
      setTransactions(prev => [savedTx, ...prev.filter(t => t.id !== savedTx.id)]);
      setForm({ name: '', qty: 0, unit: form.unit || 'Pcs', supplier: '', recipient: '', note: '' });
      setSuccessToast({
        message: `Transaksi ${savedTx.itemName} (${savedTx.type === 'IN' ? 'Masuk' : 'Keluar'} ${savedTx.quantity} ${savedTx.unit}) berhasil dicatat!`,
        tx: savedTx
      });
      await loadData(true);
    } catch (err: any) {
      console.error("Gagal simpan transaksi:", err);
      alert(`Gagal simpan: ${err?.message || 'Terjadi gangguan jaringan database'}`);
    } finally {
      setIsLoading(false);
    }
  };

  const filteredTransactions = useMemo(() => {
    const startTs = getStartTimestamp(startDate);
    const endTs = getEndTimestamp(endDate);
    const search = searchTermLog.toLowerCase().trim();
    return transactions.filter(t => {
      const txTs = Number(t.timestamp) || 0;
      const matchDate = txTs >= startTs && txTs <= endTs;
      const matchSearch = !search ||
        t.itemName.toLowerCase().includes(search) ||
        t.officer.toLowerCase().includes(search) ||
        (t.supplier && t.supplier.toLowerCase().includes(search)) ||
        (t.recipient && t.recipient.toLowerCase().includes(search)) ||
        (t.note && t.note.toLowerCase().includes(search));
      return matchDate && matchSearch;
    });
  }, [transactions, startDate, endDate, searchTermLog]);

  const inventorySummary = useMemo(() => {
    const startTs = getStartTimestamp(startDate);
    const endTs = getEndTimestamp(endDate);
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
      const txTs = Number(t.timestamp) || 0;
      if (txTs < startTs) {
        if (t.type === 'IN') summary[name].opening += qty;
        else summary[name].opening -= qty;
      } else if (txTs >= startTs && txTs <= endTs) {
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

  const exportPDF = () => {
    setIsLoading(true);
    const targetLabel = isHRGAMode ? subModule : module;
    try {
      // Standard A4 Portrait (210 x 297 mm)
      const doc = new jsPDF({
        orientation: 'p',
        unit: 'mm',
        format: 'a4'
      });

      const totalPagesExp = '{total_pages_count_string}';
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();

      // Header Info
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(15);
      doc.setTextColor(15, 23, 42); // slate-900
      doc.text(`LAPORAN REKAP INVENTARIS ${targetLabel}`, 14, 18);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(100, 116, 139); // slate-500
      doc.text(`Periode: ${startDate} s/d ${endDate}  |  Dicetak oleh: ${currentUser.username}  |  Waktu Cetak: ${new Date().toLocaleString('id-ID')}`, 14, 24);

      const tableData = inventorySummary.map((s, idx) => [
        idx + 1,
        s.name,
        s.unit || 'Pcs',
        s.opening.toLocaleString('id-ID'),
        `+${s.in.toLocaleString('id-ID')}`,
        `-${s.out.toLocaleString('id-ID')}`,
        s.closing.toLocaleString('id-ID')
      ]);

      autoTable(doc, {
        head: [['No', 'Nama Barang', 'Unit', 'Stok Awal', 'Masuk (+)', 'Keluar (-)', 'Saldo Akhir']],
        body: tableData,
        startY: 28,
        theme: 'grid',
        showHead: 'everyPage',
        margin: { top: 28, bottom: 18, left: 14, right: 14 },
        headStyles: {
          fillColor: [15, 23, 42],
          textColor: [255, 255, 255],
          fontStyle: 'bold',
          fontSize: 8.5,
          halign: 'center'
        },
        styles: {
          fontSize: 8,
          cellPadding: 2.2,
          valign: 'middle'
        },
        columnStyles: {
          0: { halign: 'center', cellWidth: 10 },
          1: { halign: 'left' },
          2: { halign: 'center', cellWidth: 18 },
          3: { halign: 'right', cellWidth: 24 },
          4: { halign: 'right', cellWidth: 24, textColor: [5, 150, 105] }, // emerald-600
          5: { halign: 'right', cellWidth: 24, textColor: [220, 38, 38] }, // red-600
          6: { halign: 'right', cellWidth: 26, fontStyle: 'bold' }
        },
        alternateRowStyles: {
          fillColor: [248, 250, 252] // slate-50
        },
        didDrawPage: (data) => {
          // Footer with Page Number
          doc.setFontSize(8);
          doc.setTextColor(148, 163, 184); // slate-400
          const pageStr = `Halaman ${data.pageNumber} dari ${totalPagesExp}`;
          doc.text(pageStr, pageWidth - 14, pageHeight - 10, { align: 'right' });
          doc.text(`Sistem Logistik Internal - PT. BSI (${targetLabel})`, 14, pageHeight - 10);
        }
      });

      if (typeof (doc as any).putTotalPages === 'function') {
        (doc as any).putTotalPages(totalPagesExp);
      }

      doc.save(`Laporan_Rekap_${targetLabel}_${startDate}_sd_${endDate}.pdf`);
    } catch (err) {
      console.error(err);
      alert("Gagal membuat PDF Laporan Rekap.");
    } finally {
      setIsLoading(false);
    }
  };

  const exportLogExcel = () => {
    const targetLabel = isHRGAMode ? subModule : module;
    const ws = XLSX.utils.json_to_sheet(filteredTransactions.map((t, idx) => ({
      'No': idx + 1,
      'Waktu': new Date(t.timestamp).toLocaleString('id-ID'),
      'Barang': t.itemName,
      'Tipe': t.type === 'IN' ? 'MASUK' : 'KELUAR',
      'Qty': t.quantity,
      'Unit': t.unit || 'Pcs',
      'Penerima / Supplier': t.recipient || t.supplier || '-',
      'Keterangan': t.note || '-',
      'Petugas': t.officer
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Log Transaksi");
    XLSX.writeFile(wb, `Log_Transaksi_${targetLabel}.xlsx`);
  };

  const exportLogPDF = () => {
    setIsLoading(true);
    const targetLabel = isHRGAMode ? subModule : module;
    try {
      // Standard A4 Landscape (297 x 210 mm) for wide transaction log
      const doc = new jsPDF({
        orientation: 'l',
        unit: 'mm',
        format: 'a4'
      });

      const totalPagesExp = '{total_pages_count_string}';
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();

      // Header Info
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(15);
      doc.setTextColor(15, 23, 42); // slate-900
      doc.text(`LOG TRANSAKSI INVENTARIS ${targetLabel}`, 14, 18);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(100, 116, 139); // slate-500
      doc.text(`Periode: ${startDate} s/d ${endDate}  |  Dicetak oleh: ${currentUser.username}  |  Waktu Cetak: ${new Date().toLocaleString('id-ID')}`, 14, 24);

      const tableData = filteredTransactions.map((t, idx) => [
        idx + 1,
        new Date(t.timestamp).toLocaleString('id-ID'),
        t.itemName,
        t.type === 'IN' ? 'MASUK' : 'KELUAR',
        t.quantity.toLocaleString('id-ID'),
        t.unit || 'Pcs',
        t.recipient || t.supplier || '-',
        t.note || '-',
        t.officer
      ]);

      autoTable(doc, {
        head: [['No', 'Waktu', 'Nama Barang', 'Tipe', 'Qty', 'Unit', 'Penerima / Supplier', 'Keterangan', 'Petugas']],
        body: tableData,
        startY: 28,
        theme: 'grid',
        showHead: 'everyPage',
        margin: { top: 28, bottom: 18, left: 14, right: 14 },
        headStyles: {
          fillColor: [15, 23, 42],
          textColor: [255, 255, 255],
          fontStyle: 'bold',
          fontSize: 8,
          halign: 'center'
        },
        styles: {
          fontSize: 7.5,
          cellPadding: 2,
          valign: 'middle',
          overflow: 'linebreak'
        },
        columnStyles: {
          0: { halign: 'center', cellWidth: 10 },
          1: { halign: 'left', cellWidth: 32 },
          2: { halign: 'left', cellWidth: 48 },
          3: { halign: 'center', cellWidth: 20 },
          4: { halign: 'right', cellWidth: 18, fontStyle: 'bold' },
          5: { halign: 'center', cellWidth: 16 },
          6: { halign: 'left', cellWidth: 40 },
          7: { halign: 'left' }, // Remaining space for Keterangan
          8: { halign: 'center', cellWidth: 24 }
        },
        alternateRowStyles: {
          fillColor: [248, 250, 252] // slate-50
        },
        didParseCell: (data) => {
          if (data.section === 'body' && data.column.index === 3) {
            const rawVal = data.cell.raw;
            if (rawVal === 'MASUK') {
              data.cell.styles.textColor = [5, 150, 105]; // emerald-600
              data.cell.styles.fontStyle = 'bold';
            } else if (rawVal === 'KELUAR') {
              data.cell.styles.textColor = [220, 38, 38]; // red-600
              data.cell.styles.fontStyle = 'bold';
            }
          }
        },
        didDrawPage: (data) => {
          // Footer with Page Number
          doc.setFontSize(8);
          doc.setTextColor(148, 163, 184); // slate-400
          const pageStr = `Halaman ${data.pageNumber} dari ${totalPagesExp}`;
          doc.text(pageStr, pageWidth - 14, pageHeight - 10, { align: 'right' });
          doc.text(`Sistem Logistik Internal - PT. BSI (${targetLabel})`, 14, pageHeight - 10);
        }
      });

      if (typeof (doc as any).putTotalPages === 'function') {
        (doc as any).putTotalPages(totalPagesExp);
      }

      doc.save(`Log_Transaksi_${targetLabel}_${startDate}_sd_${endDate}.pdf`);
    } catch (err) {
      console.error(err);
      alert("Gagal membuat PDF Log Transaksi.");
    } finally {
      setIsLoading(false);
    }
  };

  const currentThemeColor = module === 'MT' ? 'bg-blue-600' : subModule === 'HR' ? 'bg-indigo-600' : 'bg-purple-600';
  const currentAccentColor = module === 'MT' ? 'text-blue-600' : subModule === 'HR' ? 'text-indigo-600' : 'text-purple-600';

  return (
    <div className="space-y-6 pb-10">
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
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 border rounded-xl">
                  <Calendar size={14} className="text-slate-400 shrink-0" />
                  <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="bg-transparent text-[10px] font-black outline-none" title="Tanggal Mulai" />
                  <span className="text-slate-300 mx-1">-</span>
                  <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="bg-transparent text-[10px] font-black outline-none" title="Tanggal Akhir" />
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      const d = new Date();
                      const year = d.getFullYear();
                      const month = String(d.getMonth() + 1).padStart(2, '0');
                      const day = String(d.getDate()).padStart(2, '0');
                      setStartDate(`${year}-${month}-01`);
                      setEndDate(`${year}-${month}-${day}`);
                    }}
                    className="px-2.5 py-2 bg-slate-50 hover:bg-slate-100 text-slate-600 rounded-xl text-[9px] font-black uppercase border transition-all"
                    title="Filter Bulan Ini"
                  >
                    Bulan Ini
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setStartDate('');
                      setEndDate('');
                    }}
                    className={`px-2.5 py-2 rounded-xl text-[9px] font-black uppercase border transition-all ${!startDate && !endDate ? 'bg-slate-900 text-white border-slate-900' : 'bg-slate-50 hover:bg-slate-100 text-slate-600'
                      }`}
                    title="Tampilkan Seluruh Data"
                  >
                    Semua
                  </button>
                  <button
                    type="button"
                    onClick={() => loadData(true)}
                    disabled={isLoading}
                    className="p-2 bg-slate-50 hover:bg-slate-100 text-slate-600 rounded-xl border transition-all active:scale-95 disabled:opacity-50"
                    title="Muat Ulang / Ambil Data Terbaru dari Database"
                  >
                    <RefreshCw size={13} className={isLoading ? "animate-spin text-blue-600" : ""} />
                  </button>
                </div>
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
                {activeTab === 'log' && (
                  <div className="flex gap-2">
                    <button onClick={exportLogExcel} className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-xl font-black text-[10px] uppercase flex items-center gap-2 shadow-sm transition-all active:scale-95"><FileSpreadsheet size={16} /> XLSX</button>
                    <button onClick={exportLogPDF} className="bg-red-800 hover:bg-red-900 text-white px-4 py-2 rounded-xl font-black text-[10px] uppercase flex items-center gap-2 shadow-sm transition-all active:scale-95"><FileDown size={16} /> PDF</button>
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
                      <th className="px-6 py-4">Keterangan</th>
                      <th className="px-6 py-4 text-center">Petugas</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y font-bold uppercase">
                    {filteredTransactions.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-6 py-12 text-center">
                          <div className="flex flex-col items-center justify-center space-y-2">
                            <Calendar className="text-slate-300" size={32} />
                            <p className="text-xs font-bold text-slate-500">
                              Tidak ada transaksi pada rentang tanggal yang dipilih {startDate && endDate ? `(${startDate} s/d ${endDate})` : ''}
                            </p>
                            <button
                              type="button"
                              onClick={() => { setStartDate(''); setEndDate(''); }}
                              className="text-[11px] font-black text-blue-600 hover:underline uppercase"
                            >
                              Tampilkan Semua Riwayat Transaksi
                            </button>
                          </div>
                        </td>
                      </tr>
                    ) : filteredTransactions.map((t, idx) => (
                      <tr key={idx}>
                        <td className="px-6 py-4 text-slate-400">{new Date(t.timestamp).toLocaleString()}</td>
                        <td className="px-6 py-4 text-slate-900 max-w-[250px] truncate">{t.itemName}</td>
                        <td className="px-4 py-4 text-center">
                          <span className={`px-2 py-0.5 rounded-full text-[8px] font-black border ${t.type === 'IN' ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'}`}>{t.type}</span>
                        </td>
                        <td className={`px-4 py-4 text-right ${t.type === 'IN' ? 'text-emerald-600' : 'text-red-600'}`}>{t.type === 'IN' ? '+' : '-'}{t.quantity}</td>
                        <td className="px-6 py-4 text-slate-500 text-[10px] font-black">{t.recipient || t.supplier || '-'}</td>
                        <td className="px-6 py-4 text-slate-600 text-[10px] font-medium max-w-[200px] truncate normal-case" title={t.note || ''}>{t.note || '-'}</td>
                        <td className="px-6 py-4 text-slate-900 text-center">{t.officer}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="md:hidden space-y-3">
                {filteredTransactions.length === 0 ? (
                  <div className="bg-white p-8 rounded-[1.5rem] border text-center space-y-2">
                    <p className="text-xs font-bold text-slate-500">
                      Tidak ada transaksi pada rentang tanggal ini
                    </p>
                    <button
                      type="button"
                      onClick={() => { setStartDate(''); setEndDate(''); }}
                      className="text-[10px] font-black text-blue-600 hover:underline uppercase"
                    >
                      Tampilkan Semua Data
                    </button>
                  </div>
                ) : filteredTransactions.map((t, idx) => (
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
                        {t.note && (
                          <div className="mt-2 text-[9px] font-medium text-slate-600 bg-slate-50 p-2 rounded-xl border border-slate-100 flex items-start gap-1.5">
                            <FileText size={11} className="text-slate-400 shrink-0 mt-0.5" />
                            <span className="break-words normal-case">{t.note}</span>
                          </div>
                        )}
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
              <div className="space-y-4">
                {successToast && (
                  <div className="bg-emerald-500/10 border border-emerald-500/30 p-4 rounded-2xl flex items-center justify-between gap-3 text-emerald-600 animate-in fade-in slide-in-from-top-2 duration-300">
                    <div className="flex items-center gap-2 min-w-0">
                      <Check size={18} className="shrink-0 text-emerald-600" />
                      <span className="text-xs font-bold truncate">{successToast.message}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          setActiveTab('log');
                          setSuccessToast(null);
                        }}
                        className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-[10px] font-black uppercase shadow-sm transition-all active:scale-95"
                      >
                        Buka Log
                      </button>
                      <button
                        type="button"
                        onClick={() => setSuccessToast(null)}
                        className="text-slate-400 hover:text-slate-600 p-1"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </div>
                )}
                <form onSubmit={handleSave} className="bg-white p-6 md:p-8 rounded-[2rem] border shadow-sm space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="md:col-span-2">
                      <label className="block text-[10px] font-black text-slate-500 uppercase mb-2 tracking-widest">Nama Barang</label>
                      <div className="relative">
                        <Tag className={`absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 transition-colors ${currentAccentColor}`} size={18} />
                        <input list={`items-${module}`} className="w-full h-14 p-4 pl-12 bg-slate-50 border border-slate-200 rounded-2xl font-black uppercase text-xs outline-none focus:ring-2 focus:ring-opacity-20 focus:ring-slate-400" placeholder="Ketik nama barang..." value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required />
                        <datalist id={`items-${module}`}>{masterItems.map((i, idx) => <option key={idx} value={i.name} />)}</datalist>
                      </div>
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest">Quantity & Satuan</label>
                        {isKnownItem && (
                          <span className="text-[9px] font-bold text-slate-400 flex items-center gap-1">
                            <Lock size={10} /> Terkunci dari Master
                          </span>
                        )}
                      </div>
                      <div className="flex gap-2 h-14 items-center">
                        <input
                          type="number"
                          step="0.01"
                          placeholder="0"
                          className="flex-1 min-w-0 h-14 p-4 bg-slate-50 border border-slate-200 rounded-2xl font-black text-lg outline-none focus:ring-2 focus:ring-opacity-20 focus:ring-slate-400"
                          value={form.qty || ''}
                          onChange={e => setForm({ ...form, qty: parseFloat(e.target.value) || 0 })}
                          required
                        />
                        <div className="relative shrink-0">
                          <select
                            value={form.unit || 'Pcs'}
                            disabled={isKnownItem}
                            onChange={e => {
                              if (e.target.value === '__ADD_NEW__') {
                                setShowAddUnitModal(true);
                              } else {
                                setForm({ ...form, unit: e.target.value });
                              }
                            }}
                            className={`w-28 sm:w-32 h-14 pl-3.5 pr-8 border rounded-2xl font-black text-xs uppercase outline-none transition-all appearance-none cursor-pointer focus:ring-2 focus:ring-opacity-20 focus:ring-slate-400 ${isKnownItem
                              ? 'bg-slate-100 border-slate-200 text-slate-500 cursor-not-allowed'
                              : 'bg-slate-50 border-slate-200 text-slate-900 hover:bg-slate-100/70'
                              }`}
                            title={isKnownItem ? 'Satuan otomatis terkunci berdasarkan data master barang' : 'Pilih satuan'}
                            required
                          >
                            {availableUnits.map(u => (
                              <option key={u} value={u} className="font-bold text-slate-900 py-1">
                                {u}
                              </option>
                            ))}
                            {!isKnownItem && (
                              <option value="__ADD_NEW__" className="font-black text-emerald-600 bg-emerald-50">
                                + Tambah Unit...
                              </option>
                            )}
                          </select>
                          <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400 flex items-center">
                            {isKnownItem ? <Lock size={14} className="text-slate-400" /> : <ChevronDown size={16} />}
                          </div>
                        </div>
                        {!isKnownItem && (
                          <button
                            type="button"
                            onClick={() => {
                              setNewUnitName('');
                              setAddUnitError('');
                              setShowAddUnitModal(true);
                            }}
                            className="w-12 h-14 shrink-0 flex items-center justify-center bg-slate-50 hover:bg-emerald-50 hover:text-emerald-600 hover:border-emerald-300 text-slate-500 border border-slate-200 rounded-2xl transition-all shadow-sm active:scale-95"
                            title="Tambah Satuan Baru"
                          >
                            <Plus size={18} />
                          </button>
                        )}
                      </div>
                    </div>
                    <div>
                      <label className="block text-[10px] font-black text-slate-500 uppercase mb-2 tracking-widest">{activeTab === 'in' ? 'Supplier' : 'Penerima'}</label>
                      <div className="relative">
                        {activeTab === 'in' ? <Truck className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} /> : <UserCheck className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />}
                        <input
                          className="w-full h-14 p-4 pl-12 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-xs outline-none focus:ring-2 focus:ring-opacity-20 focus:ring-slate-400"
                          placeholder="..."
                          value={activeTab === 'in' ? form.supplier : form.recipient}
                          onChange={e => setForm({ ...form, supplier: activeTab === 'in' ? e.target.value : '', recipient: activeTab === 'out' ? e.target.value : '' })}
                          required
                        />
                      </div>
                    </div>
                    {activeTab === 'out' && (
                      <div className="md:col-span-2">
                        <label className="block text-[10px] font-black text-slate-500 uppercase mb-2 tracking-widest">Keterangan</label>
                        <div className="relative">
                          <FileText className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                          <input
                            type="text"
                            className="w-full h-14 p-4 pl-12 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-xs outline-none focus:ring-2 focus:ring-opacity-20 focus:ring-slate-400"
                            placeholder="Keterangan pengeluaran barang (keperluan, nomor SPK, lokasi, dsb)..."
                            value={form.note}
                            onChange={e => setForm({ ...form, note: e.target.value })}
                          />
                        </div>
                      </div>
                    )}
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
              </div>
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
                      {t.note && (
                        <span className="text-[7.5px] text-slate-400 italic block truncate mt-0.5" title={t.note}>
                          Ket: {t.note}
                        </span>
                      )}
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

      {/* MODAL TAMBAH SATUAN BARU */}
      {showAddUnitModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-white rounded-3xl p-6 max-w-sm w-full shadow-2xl border border-slate-100 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shadow-sm">
                  <Plus size={20} />
                </div>
                <div>
                  <h3 className="font-black text-slate-900 text-sm uppercase tracking-wider">Tambah Satuan Baru</h3>
                  <p className="text-[10px] text-slate-400 font-bold uppercase">Unit Modul {isHRGAMode ? `HRGA (${subModule})` : module}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => { setShowAddUnitModal(false); setAddUnitError(''); }}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <div>
              <label className="block text-[10px] font-black text-slate-500 uppercase mb-2 tracking-widest">
                Nama Satuan (Unit)
              </label>
              <input
                type="text"
                autoFocus
                value={newUnitName}
                onChange={e => {
                  setNewUnitName(e.target.value);
                  if (addUnitError) setAddUnitError('');
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddNewUnit();
                  }
                  if (e.key === 'Escape') {
                    setShowAddUnitModal(false);
                    setAddUnitError('');
                  }
                }}
                placeholder="Misal: Drum, Sak, Koli, Lusin, Rol..."
                className="w-full h-12 px-4 bg-slate-50 border border-slate-200 rounded-xl font-black text-sm outline-none focus:ring-2 focus:ring-emerald-500 focus:bg-white uppercase"
              />
              {addUnitError ? (
                <p className="text-[11px] font-bold text-red-500 mt-1.5">{addUnitError}</p>
              ) : (
                <p className="text-[10px] text-slate-400 mt-1.5">
                  Satuan baru otomatis tersimpan di daftar dan dapat langsung digunakan.
                </p>
              )}
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => { setShowAddUnitModal(false); setAddUnitError(''); }}
                className="flex-1 h-11 rounded-xl border border-slate-200 text-slate-600 font-bold text-xs hover:bg-slate-50 transition-colors uppercase"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={() => handleAddNewUnit()}
                className="flex-1 h-11 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs transition-colors shadow-md flex items-center justify-center gap-1.5 uppercase active:scale-95"
              >
                <Check size={16} /> Simpan & Pilih
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SimpleInventoryModule;
