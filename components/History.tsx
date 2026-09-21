import React, { useState, useMemo, useRef, useCallback } from 'react';
import { LogEntry, Product, StockItem, User, ItemStatus } from '../types.ts';
import {
  Search, Calendar, Tag, FileText, FileSpreadsheet,
  User as UserIcon, Filter, FileImage, Package, History as HistoryIcon,
  Info, Clock, Truck, Edit3, Trash2, Lock, X, Check, ShieldAlert, RefreshCw,
  LayoutList, List
} from 'lucide-react';
import SearchableSelect from './SearchableSelect.tsx';
import { toJpeg } from 'html-to-image';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import { db } from '../services/database.ts';

interface HistoryProps {
  logs: LogEntry[];
  products: Product[];
  stock: StockItem[];
  currentUser: User;
  onRefresh?: () => Promise<void>;
  onAdjust?: (item: StockItem, newQty: number, note: string) => void;
}

const History: React.FC<HistoryProps> = ({ logs, products, stock, currentUser, onRefresh }) => {
  const [activeTab, setActiveTab] = useState<'all' | 'stockCard' | 'report'>('all');
  const [expandedNotes, setExpandedNotes] = useState<Record<string, boolean>>({});
  const [stockCardSubTab, setStockCardSubTab] = useState<'detail' | 'rekap'>('detail');
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'IN' | 'OUT' | 'CREATE' | 'ADJUST'>('ALL');
  const [searchTerm, setSearchTerm] = useState('');

  const [startDate, setStartDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState<string>(new Date().toISOString().split('T')[0]);

  const [selectedProductId, setSelectedProductId] = useState<string>('');

  const reportExportRef = useRef<HTMLDivElement>(null);
  const stockCardExportRef = useRef<HTMLDivElement>(null);

  // SuperAdmin Edit/Delete State
  const [secureAction, setSecureAction] = useState<{ type: 'edit' | 'delete', log: LogEntry } | null>(null);
  const [verifyPassword, setVerifyPassword] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ qty: 0, note: '', recipient: '' });

  const isSuperAdmin = currentUser.role === 'SuperAdmin';

  const handleDownloadImage = async (ref: React.RefObject<HTMLDivElement>, filename: string) => {
    if (!ref.current) return;
    try {
      const dataUrl = await toJpeg(ref.current, {
        quality: 1,
        pixelRatio: 2,
        backgroundColor: '#ffffff',
      });
      const link = document.createElement('a');
      link.download = `${filename}.jpg`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error('Failed to download image', err);
    }
  };

  // Renamed to avoid collision with manual jsPDF handleDownloadPDF function below
  const handleDownloadElementAsPDF = async (ref: React.RefObject<HTMLDivElement>, filename: string) => {
    if (!ref.current) return;
    try {
      const dataUrl = await toJpeg(ref.current, {
        quality: 0.95,
        backgroundColor: '#ffffff',
        pixelRatio: 2
      });
      const imgWidth = ref.current.offsetWidth;
      const imgHeight = ref.current.offsetHeight;
      const pdf = new jsPDF({
        orientation: imgWidth > imgHeight ? 'l' : 'p',
        unit: 'px',
        format: [imgWidth + 40, imgHeight + 40]
      });
      pdf.addImage(dataUrl, 'JPEG', 20, 20, imgWidth, imgHeight);
      pdf.save(`${filename}.pdf`);
    } catch (err) {
      console.error('Failed to download PDF', err);
    }
  };

  const formatDateReadable = (dateStr: string | undefined) => {
    if (!dateStr || dateStr === 'System' || dateStr === 'Migration' || dateStr === '-') return String(dateStr || '-');
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

  const filterStartTs = useMemo(() => new Date(startDate).setHours(0, 0, 0, 0), [startDate]);
  const filterEndTs = useMemo(() => new Date(endDate).setHours(23, 59, 59, 999), [endDate]);

  const stockMap = useMemo(() => {
    const map = new Map<string, StockItem>();
    stock.forEach(s => {
      if (s && s.uniqueId) {
        map.set(s.uniqueId.trim().toLowerCase(), s);
      }
    });
    return map;
  }, [stock]);

  const getItem = useCallback((stockItemId?: string): StockItem | undefined => {
    if (!stockItemId) return undefined;
    const cleanId = String(stockItemId).trim().toLowerCase();
    const found = stockMap.get(cleanId);
    if (found) return found;

    // Fallback: jika item fisik sudah terhapus/keluar tapi unique_id memiliki format standar:
    // Contoh: CMI001-080126DPF69-20260108-NOEXP-V68P
    const parts = stockItemId.split('-');
    if (parts.length >= 4) {
      const batchCode = parts[1] || '-';
      const arrRaw = parts[2];
      let arrivalDate = arrRaw;
      if (arrRaw && arrRaw.length === 8 && /^\d{8}$/.test(arrRaw)) {
        arrivalDate = `${arrRaw.slice(0, 4)}-${arrRaw.slice(4, 6)}-${arrRaw.slice(6, 8)}`;
      }
      const expRaw = parts[3];
      let expiryDate = expRaw;
      if (expRaw && expRaw.length === 8 && /^\d{8}$/.test(expRaw)) {
        expiryDate = `${expRaw.slice(0, 4)}-${expRaw.slice(4, 6)}-${expRaw.slice(6, 8)}`;
      }
      return {
        uniqueId: stockItemId,
        productId: parts[0],
        productName: '',
        batchCode,
        arrivalDate,
        expiryDate: expiryDate === 'NOEXP' ? '' : expiryDate,
        supplier: '',
        status: ItemStatus.OUTBOUND,
        createdAt: 0,
        quantity: 0
      };
    }
    return undefined;
  }, [stockMap]);

  const productNameToIdMap = useMemo(() => {
    const map = new Map<string, string>();
    products.forEach(p => {
      if (p && p.name) map.set(p.name.toLowerCase().trim(), p.id);
    });
    return map;
  }, [products]);

  const reportData = useMemo(() => {
    if (activeTab !== 'report') return [];
    const logsByProduct = new Map<string, LogEntry[]>();
    logs.forEach(l => {
      const pid = productNameToIdMap.get(String(l.productName || '').toLowerCase().trim());
      if (pid) {
        if (!logsByProduct.has(pid)) logsByProduct.set(pid, []);
        logsByProduct.get(pid)!.push(l);
      }
    });

    const search = (searchTerm || '').toLowerCase();

    return products
      .filter(p => p.isActive !== false)
      .filter(p => search === '' || String(p.name || '').toLowerCase().includes(search) || String(p.id || '').toLowerCase().includes(search))
      .sort((a, b) => (a.id || '').localeCompare(b.id || '', undefined, { numeric: true }))
      .map(prod => {
        const pLogs = (logsByProduct.get(prod.id) || []).sort((a, b) => b.timestamp - a.timestamp);
        const currentStock = Number(prod.stockToday) || 0;
        const mutationsAfterPeriod = pLogs.filter(l => l.timestamp > filterEndTs).reduce((acc, l) => acc + (Number(l.quantityChange) || 0), 0);
        const stockEnd = currentStock - mutationsAfterPeriod;
        const inRangeIn = pLogs.filter(l => l.timestamp >= filterStartTs && l.timestamp <= filterEndTs && (l.type === 'IN' || (l.type === 'ADJUST' && Number(l.quantityChange || 0) > 0) || l.type === 'CREATE')).reduce((acc, l) => acc + Math.abs(Number(l.quantityChange || 0)), 0);
        const inRangeOut = pLogs.filter(l => l.timestamp >= filterStartTs && l.timestamp <= filterEndTs && (l.type === 'OUT' || (l.type === 'ADJUST' && Number(l.quantityChange || 0) < 0))).reduce((acc, l) => acc + Math.abs(Number(l.quantityChange || 0)), 0);
        const totalInRange = pLogs.filter(l => l.timestamp >= filterStartTs && l.timestamp <= filterEndTs).reduce((acc, l) => acc + (Number(l.quantityChange) || 0), 0);
        const openingStock = stockEnd - totalInRange;

        return { code: prod.id, name: prod.name, uom: prod.unit, openingStock, inRange: inRangeIn, outRange: inRangeOut, stockEnd };
      });
  }, [activeTab, products, logs, productNameToIdMap, filterStartTs, filterEndTs]);

  const formatDateTimeFull = (ts: any) => {
    if (!ts) return "-";
    const d = new Date(Number(ts));
    const day = String(d.getDate()).padStart(2, '0');
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
    return `${day} ${months[d.getMonth()]} ${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  const stockCardData = useMemo(() => {
    if (activeTab !== 'stockCard' || !selectedProductId) return null;
    const prod = products.find(p => p.id === selectedProductId);
    if (!prod) return null;

    const pLogs = logs.filter(l => String(l.productName || '').toLowerCase().trim() === String(prod.name || '').toLowerCase().trim()).sort((a, b) => b.timestamp - a.timestamp);
    let runningBalance = Number(prod.stockToday) || 0;
    const historyWithBalance = pLogs.map(l => {
      const entry = { ...l, balanceAfter: runningBalance };
      runningBalance -= (Number(l.quantityChange) || 0);
      return entry;
    });

    historyWithBalance.sort((a, b) => a.timestamp - b.timestamp);
    const filteredMutations = historyWithBalance.filter(l => l.timestamp >= filterStartTs && l.timestamp <= filterEndTs);

    let openingVal = 0;
    const logsBefore = historyWithBalance.filter(l => l.timestamp < filterStartTs);
    if (logsBefore.length > 0) openingVal = logsBefore[logsBefore.length - 1].balanceAfter;
    else if (filteredMutations.length > 0) openingVal = filteredMutations[0].balanceAfter - (Number(filteredMutations[0].quantityChange) || 0);
    else {
      const mutationsAfter = historyWithBalance.filter(l => l.timestamp > filterEndTs).reduce((acc, l) => acc + (Number(l.quantityChange) || 0), 0);
      openingVal = (Number(prod.stockToday) || 0) - mutationsAfter;
    }

    return { openingBalance: openingVal, mutations: filteredMutations };
  }, [activeTab, selectedProductId, logs, products, filterStartTs, filterEndTs]);

  const stockCardRekapData = useMemo(() => {
    if (!stockCardData) return [];
    const dailyMap = new Map<string, { date: string, in: number, out: number, lastBalance: number }>();

    const sortedMutations = [...stockCardData.mutations].sort((a, b) => a.timestamp - b.timestamp);

    sortedMutations.forEach(m => {
      const dateKey = new Date(m.timestamp).toISOString().split('T')[0];
      if (!dailyMap.has(dateKey)) {
        dailyMap.set(dateKey, { date: dateKey, in: 0, out: 0, lastBalance: m.balanceAfter });
      }
      const entry = dailyMap.get(dateKey)!;
      const qty = Number(m.quantityChange) || 0;
      if (qty > 0) entry.in += qty;
      else entry.out += Math.abs(qty);
      entry.lastBalance = m.balanceAfter;
    });

    // Urutan dari yang lama ke yang baru (Ascending) sesuai permintaan
    return Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [stockCardData]);

  const filteredLogs = useMemo(() => {
    const search = (searchTerm || '').toLowerCase();
    const result = logs.filter(l => {
      const matchSearch = String(l.productName || '').toLowerCase().includes(search) || (l.recipient && String(l.recipient).toLowerCase().includes(search)) || (l.user && String(l.user).toLowerCase().includes(search));
      const matchDate = l.timestamp >= filterStartTs && l.timestamp <= filterEndTs;
      const matchType = typeFilter === 'ALL' || String(l.type || '').trim().toUpperCase() === typeFilter;
      return matchSearch && matchDate && matchType;
    });
    return result.sort((a, b) => b.timestamp - a.timestamp);
  }, [logs, searchTerm, filterStartTs, filterEndTs, typeFilter]);

  const downloadRekapExcel = () => {
    const data = reportData.map(r => ({
      'Kode': r.code,
      'Nama Produk': r.name,
      'UOM': r.uom,
      'Stok Awal': r.openingStock,
      'Masuk': r.inRange,
      'Keluar': r.outRange,
      'Stok Akhir': r.stockEnd
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Rekap Mutasi");
    XLSX.writeFile(wb, `Rekap_Mutasi_${startDate}_ke_${endDate}.xlsx`);
  };

  const downloadBukuMutasiExcel = () => {
    const data = filteredLogs.map(l => {
      const item = getItem(l.stockItemId);
      return {
        'Waktu': formatDateTimeFull(l.timestamp),
        'Tipe': l.type,
        'Barang': l.productName,
        'Qty': Math.abs(Number(l.quantityChange || 0)),
        'Unit': products.find(p => p.name === l.productName)?.unit || '',
        'Batch': item?.batchCode || l.stockItemId || '-',
        'Supplier': item?.supplier || '-',
        'Kedatangan': item?.arrivalDate ? formatDateReadable(item.arrivalDate) : '-',
        'Expired': item?.expiryDate && item.expiryDate !== '-' && item.expiryDate !== 'NOEXP' ? formatDateReadable(item.expiryDate) : '-',
        'Penerima/Catatan': l.recipient || l.note || '-',
        'User': l.user || 'SYS',
        'Batch ID': l.stockItemId
      };
    });
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Buku Mutasi");
    XLSX.writeFile(wb, `Buku_Mutasi_${startDate}_ke_${endDate}.xlsx`);
  };

  const handleDownloadPDF = () => {
    const pdf = new jsPDF('p', 'mm', 'a4');
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 10;
    const contentWidth = pageWidth - (margin * 2);
    let yPos = margin;

    const drawPDFHeader = (title: string, subtitle: string, columns: string[], colWidths: number[]) => {
      pdf.setFontSize(14);
      pdf.setFont('helvetica', 'bold');
      pdf.setTextColor(15, 23, 42);
      pdf.text(title, pageWidth / 2, yPos + 10, { align: 'center' });

      pdf.setFontSize(9);
      pdf.setFont('helvetica', 'normal');
      pdf.setTextColor(100, 116, 139);
      pdf.text(subtitle, pageWidth / 2, yPos + 16, { align: 'center' });

      pdf.setFontSize(7);
      pdf.setFont('helvetica', 'bold');
      pdf.setTextColor(220, 38, 38);
      pdf.text("BOUNTY SEGAR INDONESIA - DRY WAREHOUSE SYSTEM", pageWidth / 2, yPos + 21, { align: 'center' });

      yPos += 28;

      pdf.setFillColor(30, 41, 59);
      pdf.rect(margin, yPos, contentWidth, 9, 'F');
      pdf.setTextColor(255, 255, 255);
      pdf.setFontSize(6.5);
      pdf.setFont('helvetica', 'bold');

      let x = margin;
      columns.forEach((col, i) => {
        const isNumeric = col.toLowerCase().includes('qty') || col.toLowerCase().includes('masuk') ||
          col.toLowerCase().includes('keluar') || col.toLowerCase().includes('saldo') ||
          col.toLowerCase().includes('awal') || col.toLowerCase().includes('akhir') ||
          col.toLowerCase().includes('mut') || col.toLowerCase().includes('bal') ||
          col.toLowerCase().includes('in') || col.toLowerCase().includes('exp') ||
          col.toLowerCase().includes('unit') || col.toLowerCase().includes('tanggal');

        if (isNumeric) {
          pdf.text(col.toUpperCase(), x + (colWidths[i] / 2), yPos + 6, { align: 'center' });
        } else {
          pdf.text(col.toUpperCase(), x + 2, yPos + 6);
        }
        x += colWidths[i];
      });

      pdf.setTextColor(0, 0, 0);
      yPos += 9;
    };

    if (activeTab === 'report') {
      const cols = ['Kode', 'Nama Produk', 'Unit', 'Awal', 'Masuk', 'Keluar', 'Akhir'];
      const widths = [22, 85, 12, 17, 17, 17, 18];
      drawPDFHeader('LAPORAN REKAPITULASI MUTASI BARANG', `Periode: ${formatDateReadable(startDate)} s/d ${formatDateReadable(endDate)}`, cols, widths);

      reportData.forEach((row, idx) => {
        if (yPos > pageHeight - 15) {
          pdf.addPage();
          yPos = margin;
          drawPDFHeader('LAPORAN REKAPITULASI MUTASI BARANG', `Periode: ${startDate} s/d ${endDate}`, cols, widths);
        }

        if (idx % 2 === 0) {
          pdf.setFillColor(248, 250, 252);
          pdf.rect(margin, yPos, contentWidth, 7, 'F');
        }

        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(7);
        let x = margin;

        pdf.text(String(row.code), x + 2, yPos + 4.5); x += widths[0];
        pdf.text(String(row.name).toUpperCase(), x + 2, yPos + 4.5); x += widths[1];
        pdf.text(String(row.uom), x + (widths[2] / 2), yPos + 4.5, { align: 'center' }); x += widths[2];
        pdf.text(row.openingStock.toLocaleString(), x + (widths[3] / 2), yPos + 4.5, { align: 'center' }); x += widths[3];
        pdf.setTextColor(5, 150, 105);
        pdf.text(`+${row.inRange.toLocaleString()}`, x + (widths[4] / 2), yPos + 4.5, { align: 'center' });
        pdf.setTextColor(0, 0, 0);
        x += widths[4];
        pdf.setTextColor(220, 38, 38);
        pdf.text(`-${row.outRange.toLocaleString()}`, x + (widths[5] / 2), yPos + 4.5, { align: 'center' });
        pdf.setTextColor(0, 0, 0);
        x += widths[5];
        pdf.setFont('helvetica', 'bold');
        pdf.text(row.stockEnd.toLocaleString(), x + (widths[6] / 2), yPos + 4.5, { align: 'center' });

        yPos += 7;
      });
      pdf.save(`Rekap_Mutasi_${startDate}_ke_${endDate}.pdf`);

    } else if (activeTab === 'stockCard' && selectedProductId) {
      const prod = products.find(p => p.id === selectedProductId);
      const prodName = prod?.name || 'Unknown';

      if (stockCardSubTab === 'detail') {
        const cols = ['Waktu', 'Tipe', 'Detail', 'Batch', 'Supp', 'In', 'Exp', 'Mut', 'Bal'];
        const widths = [28, 10, 32, 22, 22, 20, 20, 15, 16];
        drawPDFHeader(`KARTU STOK ${prodName.toUpperCase()}`, `Periode: ${formatDateReadable(startDate)} s/d ${formatDateReadable(endDate)}`, cols, widths);

        pdf.setFillColor(241, 245, 249);
        pdf.rect(margin, yPos, contentWidth, 7, 'F');
        pdf.setFont('helvetica', 'bolditalic');
        pdf.text('SALDO AWAL PERIODE', margin + 40, yPos + 4.5);
        pdf.text(stockCardData?.openingBalance.toLocaleString() || '0', margin + contentWidth - 2, yPos + 4.5, { align: 'right' });
        yPos += 7;

        stockCardData?.mutations.forEach((log, idx) => {
          if (yPos > pageHeight - 15) { pdf.addPage(); yPos = margin; drawPDFHeader(`KARTU STOK ${prodName.toUpperCase()}`, `Periode: ${startDate} s/d ${endDate}`, cols, widths); }
          if (idx % 2 === 1) { pdf.setFillColor(248, 250, 252); pdf.rect(margin, yPos, contentWidth, 7, 'F'); }
          const item = getItem(log.stockItemId);
          pdf.setFont('helvetica', 'normal'); pdf.setFontSize(6);
          let x = margin;
          pdf.text(formatDateTimeFull(log.timestamp), x + 1, yPos + 4.5); x += widths[0];
          pdf.setFont('helvetica', 'bold');
          if (log.type === 'IN') pdf.setTextColor(5, 150, 105);
          else if (log.type === 'OUT') pdf.setTextColor(220, 38, 38);
          pdf.text(log.type, x + (widths[1] / 2), yPos + 4.5, { align: 'center' });
          pdf.setTextColor(0, 0, 0); pdf.setFont('helvetica', 'normal'); x += widths[1];
          pdf.text((log.recipient || log.note || '-').substring(0, 24), x + 1, yPos + 4.5); x += widths[2];
          pdf.text((item?.batchCode || '-').substring(0, 18), x + 1, yPos + 4.5); x += widths[3];
          pdf.text((item?.supplier || '-').substring(0, 18), x + 1, yPos + 4.5); x += widths[4];
          pdf.text(formatDateReadable(item?.arrivalDate), x + (widths[5] / 2), yPos + 4.5, { align: 'center' }); x += widths[5];
          pdf.text(formatDateReadable(item?.expiryDate), x + (widths[6] / 2), yPos + 4.5, { align: 'center' }); x += widths[6];
          const qChange = Number(log.quantityChange || 0);
          pdf.setFont('helvetica', 'bold');
          if (qChange > 0) pdf.setTextColor(5, 150, 105); else pdf.setTextColor(220, 38, 38);
          pdf.text(qChange.toLocaleString(), x + (widths[7] / 2), yPos + 4.5, { align: 'center' });
          pdf.setTextColor(0, 0, 0); x += widths[7];
          pdf.text(log.balanceAfter.toLocaleString(), x + (widths[8] / 2), yPos + 4.5, { align: 'center' });
          yPos += 7;
        });
      } else {
        const cols = ['Tanggal', 'Total Masuk (+)', 'Total Keluar (-)', 'Stok Akhir'];
        const widths = [contentWidth * 0.25, contentWidth * 0.25, contentWidth * 0.25, contentWidth * 0.25];
        drawPDFHeader(`KARTU STOK ${prodName.toUpperCase()}`, `Periode: ${formatDateReadable(startDate)} s/d ${formatDateReadable(endDate)}`, cols, widths);

        pdf.setFillColor(241, 245, 249);
        pdf.rect(margin, yPos, contentWidth, 8, 'F');
        pdf.setFont('helvetica', 'bolditalic');
        pdf.text(`SALDO AWAL SEBELUM ${formatDateReadable(startDate)}`, margin + 2, yPos + 5.5);
        pdf.text(stockCardData?.openingBalance.toLocaleString() || '0', margin + contentWidth - 2, yPos + 5.5, { align: 'right' });
        yPos += 8;

        stockCardRekapData.forEach((day, idx) => {
          if (yPos > pageHeight - 15) { pdf.addPage(); yPos = margin; drawPDFHeader(`KARTU STOK ${prodName.toUpperCase()}`, `Periode: ${startDate} s/d ${endDate}`, cols, widths); }
          if (idx % 2 === 1) { pdf.setFillColor(248, 250, 252); pdf.rect(margin, yPos, contentWidth, 8, 'F'); }
          pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8);
          let x = margin;
          pdf.text(formatDateReadable(day.date), x + (widths[0] / 2), yPos + 5.5, { align: 'center' }); x += widths[0];
          pdf.setTextColor(5, 150, 105);
          pdf.text(`+${day.in.toLocaleString()}`, x + (widths[1] / 2), yPos + 5.5, { align: 'center' }); x += widths[1];
          pdf.setTextColor(220, 38, 38);
          pdf.text(`-${day.out.toLocaleString()}`, x + (widths[2] / 2), yPos + 5.5, { align: 'center' }); x += widths[2];
          pdf.setTextColor(0, 0, 0); pdf.setFont('helvetica', 'bold');
          pdf.text(day.lastBalance.toLocaleString(), x + (widths[3] / 2), yPos + 5.5, { align: 'center' });
          yPos += 8;
        });
      }
      pdf.save(`Kartu_Stok_${prodName}_${startDate}.pdf`);
    }
  };

  const openEditModal = (log: LogEntry) => {
    setSecureAction({ type: 'edit', log });
    setEditForm({
      qty: Math.abs(log.quantityChange || 0),
      note: log.note || '',
      recipient: log.recipient || ''
    });
    setVerifyError(null);
  };

  const openDeleteModal = (log: LogEntry) => {
    setSecureAction({ type: 'delete', log });
    setVerifyError(null);
  };

  const handleProcessSecureAction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!secureAction || isVerifying) return;
    setIsVerifying(true); setVerifyError(null);
    try {
      const isValid = await db.verifyPassword(currentUser.username, verifyPassword);
      if (!isValid) { setVerifyError("Password verifikasi salah."); setIsVerifying(false); return; }
      if (secureAction.type === 'delete') { await db.deleteLogAndReverse(secureAction.log); }
      else { const newQtyChange = secureAction.log.type === 'OUT' ? -editForm.qty : editForm.qty; await db.updateLogAndAdjust(secureAction.log, newQtyChange, { note: editForm.note, recipient: editForm.recipient }); }
      if (onRefresh) await onRefresh();
      setSecureAction(null); setVerifyPassword('');
    } catch (err) { setVerifyError("Gagal memproses aksi."); } finally { setIsVerifying(false); }
  };

  return (
    <div className="space-y-4 pb-20">

      {/* SuperAdmin Modification Modal */}
      {secureAction && (
        <div className="fixed inset-0 z-[500] flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
          <div className="bg-white rounded-[2.5rem] shadow-2xl p-8 max-w-sm w-full border border-slate-100 animate-in zoom-in-95">
            <div className="flex flex-col items-center text-center mb-6">
              <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mb-4 shadow-inner ${secureAction.type === 'edit' ? 'bg-blue-50 text-blue-600' : 'bg-red-50 text-red-600'}`}>
                {secureAction.type === 'edit' ? <Edit3 size={32} /> : <Trash2 size={32} />}
              </div>
              <h3 className="text-xl font-black text-slate-900 uppercase tracking-tighter">
                {secureAction.type === 'edit' ? 'Edit Mutasi' : 'Hapus Mutasi'}
              </h3>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-2 px-4 leading-relaxed">
                {secureAction.log.productName} <br />
                [{formatDateTimeFull(secureAction.log.timestamp)}]
              </p>
            </div>

            <form onSubmit={handleProcessSecureAction} className="space-y-4">
              {secureAction.type === 'edit' && (
                <div className="space-y-3 p-4 bg-slate-50 rounded-2xl border border-slate-100">
                  <div>
                    <label className="block text-[8px] font-black text-slate-400 uppercase mb-1 ml-1">Quantity</label>
                    <input type="number" step="0.01" className="w-full p-2.5 bg-white border border-slate-200 rounded-xl font-black text-xs outline-none" value={editForm.qty} onChange={e => setEditForm({ ...editForm, qty: parseFloat(e.target.value) || 0 })} />
                  </div>
                  {secureAction.log.type === 'OUT' && (
                    <div>
                      <label className="block text-[8px] font-black text-slate-400 uppercase mb-1 ml-1">Penerima</label>
                      <input type="text" className="w-full p-2.5 bg-white border border-slate-200 rounded-xl font-bold text-xs outline-none uppercase" value={editForm.recipient} onChange={e => setEditForm({ ...editForm, recipient: e.target.value })} />
                    </div>
                  )}
                  <div>
                    <label className="block text-[8px] font-black text-slate-400 uppercase mb-1 ml-1">Catatan</label>
                    <input type="text" className="w-full p-2.5 bg-white border border-slate-200 rounded-xl font-bold text-xs outline-none" value={editForm.note} onChange={e => setEditForm({ ...editForm, note: e.target.value })} />
                  </div>
                </div>
              )}
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                <input type="password" autoFocus className="w-full bg-slate-50 border border-slate-200 rounded-2xl py-4 pl-12 pr-4 text-slate-900 font-bold outline-none" placeholder="Verifikasi Password..." value={verifyPassword} onChange={e => setVerifyPassword(e.target.value)} />
              </div>
              {verifyError && <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-100 rounded-xl text-red-600 text-[10px] font-bold uppercase"><ShieldAlert size={14} /> {verifyError}</div>}
              <div className="flex flex-col gap-3">
                <button type="submit" disabled={isVerifying || !verifyPassword} className={`w-full py-4 text-white rounded-2xl font-black uppercase text-[11px] tracking-[0.2em] shadow-xl transition-all flex items-center justify-center gap-2 disabled:opacity-50 ${secureAction.type === 'edit' ? 'bg-blue-600' : 'bg-red-600'}`}>
                  {isVerifying ? <RefreshCw className="animate-spin" size={16} /> : <Check size={16} />} KONFIRMASI
                </button>
                <button type="button" onClick={() => setSecureAction(null)} className="w-full py-3 text-slate-400 font-black uppercase text-[10px] tracking-widest hover:bg-slate-50 rounded-xl">BATAL</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* EXPORT TEMPLATES (HIDDEN) */}
      <div style={{ position: 'absolute', left: '-9999px', top: 0, pointerEvents: 'none' }}>
        <div ref={reportExportRef} className="bg-white p-12 w-[1000px]">
          <div className="text-center mb-10">
            <h1 className="text-3xl font-black text-slate-900 uppercase tracking-tighter">Rekapitulasi Mutasi Barang Dry Warehouse</h1>
            <p className="text-sm font-bold text-slate-400 uppercase tracking-widest mt-2">Periode: {startDate} s/d {endDate}</p>
            <div className="w-24 h-1.5 bg-red-600 mx-auto mt-4 rounded-full"></div>
          </div>
          <table className="w-full text-center text-xs border-collapse border border-slate-900">
            <thead>
              <tr className="bg-slate-900 text-white font-black uppercase text-[10px] tracking-widest">
                <th className="border border-slate-700 px-4 py-4">Kode SKU</th>
                <th className="border border-slate-700 px-4 py-4 text-left">Nama Produk</th>
                <th className="border border-slate-700 px-4 py-4">Unit</th>
                <th className="border border-slate-700 px-4 py-4 bg-slate-800">Stok Awal</th>
                <th className="border border-slate-700 px-4 py-4 text-emerald-400">Masuk</th>
                <th className="border border-slate-700 px-4 py-4 text-red-400">Keluar</th>
                <th className="border border-slate-700 px-4 py-4 bg-slate-800">Stok Akhir</th>
              </tr>
            </thead>
            <tbody>
              {reportData.map((row) => (
                <tr key={row.code} className="font-bold border-b border-slate-200">
                  <td className="border border-slate-200 px-4 py-3 font-mono">{row.code}</td>
                  <td className="border border-slate-200 px-4 py-3 text-left uppercase">{row.name}</td>
                  <td className="border border-slate-200 px-4 py-3 text-slate-400">{row.uom}</td>
                  <td className="border border-slate-200 px-4 py-3 bg-slate-50">{row.openingStock.toLocaleString()}</td>
                  <td className="border border-slate-200 px-4 py-3 text-emerald-600">+{row.inRange.toLocaleString()}</td>
                  <td className="border border-slate-200 px-4 py-3 text-red-600">-{row.outRange.toLocaleString()}</td>
                  <td className="border border-slate-200 px-4 py-3 bg-slate-50 font-black">{row.stockEnd.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* VISIBLE UI */}
      <div className="bg-white p-1 rounded-2xl border border-slate-200 shadow-sm flex overflow-x-auto no-scrollbar">
        <button onClick={() => setActiveTab('all')} className={`flex-1 min-w-[100px] px-4 py-2.5 rounded-xl text-[10px] font-black uppercase transition-all ${activeTab === 'all' ? 'bg-red-600 text-white' : 'text-slate-400'}`}>Buku Mutasi</button>
        <button onClick={() => setActiveTab('stockCard')} className={`flex-1 min-w-[100px] px-4 py-2.5 rounded-xl text-[10px] font-black uppercase transition-all ${activeTab === 'stockCard' ? 'bg-red-600 text-white' : 'text-slate-400'}`}>Kartu Stok</button>
        <button onClick={() => setActiveTab('report')} className={`flex-1 min-w-[100px] px-4 py-2.5 rounded-xl text-[10px] font-black uppercase transition-all ${activeTab === 'report' ? 'bg-red-600 text-white' : 'text-slate-400'}`}>Rekap Mutasi</button>
      </div>

      <div className="bg-white p-5 rounded-[2rem] border border-slate-200 shadow-sm space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="relative"><Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" /><input type="date" className="w-full pl-10 p-3 bg-slate-50 border border-slate-200 rounded-2xl text-[11px] font-black" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></div>
          <div className="relative"><Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" /><input type="date" className="w-full pl-10 p-3 bg-slate-50 border border-slate-200 rounded-2xl text-[11px] font-black" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></div>
        </div>
        {activeTab === 'stockCard' ? (
          <SearchableSelect label="Cari Produk" options={products.filter(p => p.isActive !== false)} value={selectedProductId} onChange={setSelectedProductId} placeholder="Pilih Produk..." />
        ) : (
          <div className="flex flex-col md:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input type="text" placeholder="Cari barang..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full pl-12 pr-4 py-3 border border-slate-200 rounded-2xl text-[12px] font-bold bg-slate-50 outline-none" />
            </div>
            {activeTab === 'all' && (
              <div className="flex bg-slate-100 p-1 rounded-2xl gap-1 overflow-x-auto no-scrollbar border border-slate-200">
                {(['ALL', 'IN', 'OUT', 'CREATE', 'ADJUST'] as const).map(type => (
                  <button key={type} onClick={() => setTypeFilter(type)} className={`px-4 py-2 rounded-xl text-[9px] font-black uppercase whitespace-nowrap transition-all ${typeFilter === type ? 'bg-white text-slate-900 shadow-sm border border-slate-200' : 'text-slate-400'}`}>
                    {type === 'ALL' ? 'Semua' : type === 'IN' ? 'Masuk' : type === 'OUT' ? 'Keluar' : type === 'CREATE' ? 'Reg' : 'Adj'}
                  </button>
                ))}
                <button onClick={downloadBukuMutasiExcel} className="px-4 py-2 rounded-xl text-[9px] font-black uppercase whitespace-nowrap transition-all bg-emerald-100 text-emerald-700 hover:bg-emerald-200 ml-1 flex items-center gap-1.5 border border-emerald-200">
                  <FileSpreadsheet size={12} /> XLSX
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {activeTab === 'report' ? (
        <div className="space-y-4">
          <div className="flex justify-end gap-2 px-1">
            <button onClick={downloadRekapExcel} className="bg-emerald-600 text-white px-4 py-2.5 rounded-xl flex items-center gap-2 font-black text-[10px] uppercase shadow-lg"><FileSpreadsheet size={16} /> XLSX</button>
            <button onClick={() => handleDownloadImage(reportExportRef, `Rekap_Mutasi`)} className="bg-slate-900 text-white px-4 py-2.5 rounded-xl flex items-center gap-2 font-black text-[10px] uppercase shadow-lg"><FileImage size={16} /> JPG</button>
            {/* Fix: Changed handleDownloadReportPDF to handleDownloadPDF as defined below */}
            <button onClick={handleDownloadPDF} className="bg-red-800 text-white px-4 py-2.5 rounded-xl flex items-center gap-2 font-black text-[10px] uppercase shadow-lg"><FileText size={16} /> PDF</button>
          </div>

          <div className="hidden md:block bg-white rounded-[2rem] border border-slate-200 overflow-hidden p-6 shadow-sm">
            <table className="w-full text-center text-[11px] border-collapse border border-slate-900">
              <thead>
                <tr className="bg-slate-50 font-black border-b-2 border-slate-900 uppercase">
                  <th className="border border-slate-900 px-3 py-4">Kode</th>
                  <th className="border border-slate-900 px-3 py-4 text-left">Nama Produk</th>
                  <th className="border border-slate-900 px-3 py-4">Unit</th>
                  <th className="border border-slate-900 px-3 py-4 bg-slate-50">Stok Awal</th>
                  <th className="border border-slate-900 px-3 py-4 text-emerald-600">Masuk</th>
                  <th className="border border-slate-900 px-3 py-4 text-red-600">Keluar</th>
                  <th className="border border-slate-900 px-3 py-4 bg-slate-900 text-white">Stok Akhir</th>
                </tr>
              </thead>
              <tbody>
                {reportData.map((row) => (
                  <tr key={row.code} className="font-bold border-b border-slate-200">
                    <td className="border border-slate-200 px-4 py-3 font-mono">{row.code}</td>
                    <td className="border border-slate-200 px-4 py-3 text-left uppercase truncate">{row.name}</td>
                    <td className="border border-slate-200 px-4 py-3 text-slate-400">{row.uom}</td>
                    <td className="border border-slate-200 px-4 py-3 bg-slate-50">{row.openingStock.toLocaleString()}</td>
                    <td className="border border-slate-200 px-4 py-3 text-emerald-600">+{row.inRange.toLocaleString()}</td>
                    <td className="border border-slate-200 px-4 py-3 text-red-600">-{row.outRange.toLocaleString()}</td>
                    <td className="border border-slate-200 px-4 py-3 bg-slate-50 font-black">{row.stockEnd.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="md:hidden space-y-3 px-1">
            {reportData.map((row) => (
              <div key={row.code} className="bg-white p-5 rounded-[2rem] border border-slate-200 shadow-sm space-y-3">
                <div className="flex justify-between items-start">
                  <div className="flex-1 pr-4">
                    <h4 className="text-[12px] font-black text-slate-900 uppercase leading-tight">{row.name}</h4>
                    <span className="text-[8px] font-mono font-bold text-slate-400 uppercase block mt-1">ID: {row.code}</span>
                  </div>
                  <span className="text-[9px] font-black text-slate-500 bg-slate-100 px-2.5 py-0.5 rounded-lg border border-slate-200">{row.uom}</span>
                </div>
                <div className="grid grid-cols-4 gap-2 pt-3 border-t border-slate-50">
                  <div className="flex flex-col"><span className="text-[7px] font-black text-slate-400 uppercase">Awal</span><span className="text-[10px] font-bold text-slate-700">{row.openingStock.toLocaleString()}</span></div>
                  <div className="flex flex-col"><span className="text-[7px] font-black text-slate-400 uppercase">In</span><span className="text-[10px] font-bold text-emerald-600">+{row.inRange.toLocaleString()}</span></div>
                  <div className="flex flex-col"><span className="text-[7px] font-black text-slate-400 uppercase">Out</span><span className="text-[10px] font-bold text-red-600">-{row.outRange.toLocaleString()}</span></div>
                  <div className="flex flex-col items-end"><span className="text-[7px] font-black text-slate-400 uppercase">Saldo</span><span className="text-[11px] font-black text-slate-900">{row.stockEnd.toLocaleString()}</span></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : activeTab === 'stockCard' ? (
        <div className="space-y-4">
          {selectedProductId && (
            <div className="flex bg-slate-100 p-1 rounded-2xl border border-slate-200 w-full max-w-xs mx-auto animate-in fade-in zoom-in-95">
              <button
                onClick={() => setStockCardSubTab('detail')}
                className={`flex-1 py-2.5 rounded-xl text-[10px] font-black uppercase flex items-center justify-center gap-2 transition-all ${stockCardSubTab === 'detail' ? 'bg-white text-red-600 shadow-sm' : 'text-slate-400'}`}
              >
                <LayoutList size={14} /> Detail
              </button>
              <button
                onClick={() => setStockCardSubTab('rekap')}
                className={`flex-1 py-2.5 rounded-xl text-[10px] font-black uppercase flex items-center justify-center gap-2 transition-all ${stockCardSubTab === 'rekap' ? 'bg-white text-red-600 shadow-sm' : 'text-slate-400'}`}
              >
                <List size={14} /> Rekap Harian
              </button>
            </div>
          )}

          <div className="flex justify-end gap-2 px-1">
            <button onClick={() => handleDownloadImage(stockCardExportRef, `Kartu_Stok`)} disabled={!selectedProductId} className="bg-slate-900 text-white px-4 py-2.5 rounded-xl flex items-center gap-2 font-black text-[10px] uppercase shadow-lg disabled:opacity-30"><FileImage size={16} /> JPG</button>
            <button onClick={handleDownloadPDF} disabled={!selectedProductId} className="bg-red-800 text-white px-4 py-2.5 rounded-xl flex items-center gap-2 font-black text-[10px] uppercase shadow-lg disabled:opacity-30"><FileText size={16} /> PDF</button>
          </div>

          <div className="bg-white rounded-[2rem] border border-slate-200 overflow-hidden p-6 shadow-sm min-h-[300px]">
            {selectedProductId && stockCardData ? (
              <>
                {stockCardSubTab === 'detail' ? (
                  <>
                    <div className="hidden md:block overflow-x-auto">
                      <table className="w-full text-left text-[11px] border-collapse border border-slate-200">
                        <thead className="bg-slate-50 text-slate-900 font-black uppercase text-[9px] border-b-2 border-slate-900">
                          <tr>
                            <th className="px-4 py-3.5 border border-slate-200 text-center">Waktu</th>
                            <th className="px-4 py-3.5 border border-slate-200 text-center">Tipe</th>
                            <th className="px-4 py-3.5 border border-slate-200">Keterangan / Detail Batch & Supplier</th>
                            <th className="px-4 py-3.5 border border-slate-200 text-center">Mutasi</th>
                            <th className="px-4 py-3.5 border border-slate-200 text-center bg-slate-100">Saldo</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 font-bold">
                          <tr className="bg-blue-50/20">
                            <td className="px-4 py-3 border border-slate-200 italic text-slate-400">-</td>
                            <td className="px-4 py-3 border border-slate-200 text-center"><span className="px-2 py-0.5 rounded text-[8px] font-black uppercase border bg-blue-50 text-blue-600 border-blue-100">SALDO AWAL</span></td>
                            <td className="px-4 py-3 border border-slate-200 text-slate-400 italic">Saldo kumulatif sebelum {startDate}</td>
                            <td className="px-4 py-3 border border-slate-200 text-right text-slate-200">-</td>
                            <td className="px-4 py-3 border border-slate-200 text-right bg-blue-50/30 font-black">{stockCardData.openingBalance.toLocaleString()}</td>
                          </tr>
                          {stockCardData.mutations.map((log) => {
                            const item = getItem(log.stockItemId);
                            return (
                              <tr key={log.id} className="hover:bg-slate-50/50">
                                <td className="px-4 py-3 border border-slate-200 text-slate-500">{formatDateTimeFull(log.timestamp)}</td>
                                <td className="px-4 py-3 border border-slate-200 text-center">
                                  <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase border ${log.type === 'IN' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : log.type === 'OUT' ? 'bg-red-50 text-red-600 border-red-100' : 'bg-slate-100 text-slate-500'}`}>{log.type}</span>
                                </td>
                                <td className="px-4 py-3 border border-slate-200 text-slate-600">
                                  <div className="text-slate-900">{log.recipient ? `Penerima: ${log.recipient}` : log.note || '-'}</div>
                                  {item && (
                                    <div className="text-[9px] text-slate-400 font-normal mt-0.5">
                                      Batch: {item.batchCode}
                                      {item.supplier && <span className="text-blue-600 font-bold"> • Supp: {item.supplier}</span>}
                                      • In: {formatDateReadable(item.arrivalDate)}
                                      • Exp: {item.expiryDate ? formatDateReadable(item.expiryDate) : '-'}
                                    </div>
                                  )}
                                </td>
                                <td className={`px-4 py-3 border border-slate-200 text-right font-black ${Number(log.quantityChange || 0) > 0 ? 'text-emerald-600' : 'text-red-600'}`}>{Number(log.quantityChange || 0) > 0 ? `+${log.quantityChange?.toLocaleString()}` : log.quantityChange?.toLocaleString()}</td>
                                <td className="px-4 py-3 border border-slate-200 text-right font-black bg-slate-50">{log.balanceAfter.toLocaleString()}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <div className="md:hidden space-y-3">
                      <div className="bg-blue-50/50 p-4 rounded-2xl border border-blue-100 flex justify-between items-center"><span className="text-[10px] font-black text-blue-600 uppercase">Saldo Awal s/d {startDate}</span><span className="text-[14px] font-black text-slate-900">{stockCardData.openingBalance.toLocaleString()}</span></div>
                      {stockCardData.mutations.map((log) => {
                        const item = getItem(log.stockItemId);
                        return (
                          <div key={log.id} className="bg-white p-4 rounded-[1.5rem] border border-slate-200 shadow-sm space-y-3">
                            <div className="flex justify-between items-center">
                              <span className={`px-2 py-0.5 rounded-lg text-[8px] font-black uppercase border ${log.type === 'IN' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : log.type === 'OUT' ? 'bg-red-50 text-red-600 border-red-100' : 'bg-blue-50 text-blue-600'}`}>MUTASI {log.type}</span>
                              <span className="text-[9px] font-bold text-slate-400">{formatDateTimeFull(log.timestamp)}</span>
                            </div>
                            <div className="flex justify-between items-end gap-2">
                              <div className="flex-1 min-w-0">
                                <h4 className="text-[10px] font-black text-slate-800 uppercase truncate leading-tight">{log.recipient ? `Penerima: ${log.recipient}` : log.note || '-'}</h4>
                                {item && (
                                  <p className="text-[8px] font-bold text-slate-400 uppercase mt-1">
                                    Batch: {item.batchCode}
                                    {item.supplier && <span className="text-blue-500"> • Supp: {item.supplier}</span>}
                                    <br />
                                    In: {formatDateReadable(item.arrivalDate)} • Exp: {item.expiryDate ? formatDateReadable(item.expiryDate) : '-'}
                                  </p>
                                )}
                              </div>
                              <div className="text-right">
                                <div className={`text-sm font-black ${Number(log.quantityChange || 0) > 0 ? 'text-emerald-600' : 'text-red-600'}`}>{Number(log.quantityChange || 0) > 0 ? '+' : ''}{log.quantityChange?.toLocaleString()}</div>
                                <div className="text-[8px] font-black text-slate-400 uppercase">Saldo: {log.balanceAfter.toLocaleString()}</div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-center text-[11px] border-collapse border border-slate-200">
                      <thead className="bg-slate-50 text-slate-900 font-black uppercase text-[9px] border-b-2 border-slate-900">
                        <tr>
                          <th className="px-4 py-3.5 border border-slate-200">Tanggal</th>
                          <th className="px-4 py-3.5 border border-slate-200 text-emerald-600">Total Masuk (+)</th>
                          <th className="px-4 py-3.5 border border-slate-200 text-red-600">Total Keluar (-)</th>
                          <th className="px-4 py-3.5 border border-slate-200 bg-slate-100">Stok Akhir</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-bold">
                        <tr className="bg-blue-50/20">
                          <td className="px-4 py-3 border border-slate-200 italic text-slate-400">Sebelum {formatDateReadable(startDate)}</td>
                          <td className="px-4 py-3 border border-slate-200">-</td>
                          <td className="px-4 py-3 border border-slate-200">-</td>
                          <td className="px-4 py-3 border border-slate-200 bg-blue-50/30 font-black">{stockCardData.openingBalance.toLocaleString()}</td>
                        </tr>
                        {stockCardRekapData.map(day => (
                          <tr key={day.date} className="hover:bg-slate-50/50">
                            <td className="px-4 py-3 border border-slate-200">{formatDateReadable(day.date)}</td>
                            <td className="px-4 py-3 border border-slate-200 text-emerald-600">{day.in > 0 ? `+${day.in.toLocaleString()}` : '0'}</td>
                            <td className="px-4 py-3 border border-slate-200 text-red-600">{day.out > 0 ? `-${day.out.toLocaleString()}` : '0'}</td>
                            <td className="px-4 py-3 border border-slate-200 font-black bg-slate-50">{day.lastBalance.toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            ) : (
              <div className="py-20 text-center text-slate-300 font-black uppercase text-[10px] flex flex-col items-center gap-4"><Package size={40} className="opacity-20" /> Pilih produk di atas untuk melihat kartu stok</div>
            )}
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-[2rem] border border-slate-200 overflow-hidden shadow-sm">
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left text-[11px] border-collapse min-w-[600px]">
              <thead className="bg-slate-50 text-slate-500 font-black uppercase text-[8px] tracking-widest border-b border-slate-100">
                <tr><th className="px-6 py-5">Waktu</th><th className="px-6 py-5">Nama Barang</th><th className="px-6 py-5 text-center">Tipe</th><th className="px-6 py-5 text-right">Mutasi QTY</th><th className="px-6 py-5">Note / Penerima</th><th className="px-6 py-5 text-center">Petugas</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-bold">
                {filteredLogs.map(log => {
                  const item = getItem(log.stockItemId);
                  return (
                    <tr key={log.id} className="hover:bg-slate-50/50">
                      <td className="px-6 py-4 font-bold text-slate-400 whitespace-nowrap">{formatDateTimeFull(log.timestamp)}</td>
                      <td className="px-6 py-4 min-w-[220px]">
                        <div className="flex justify-between items-center">
                          <div className="flex-1 min-w-0">
                            <div className="font-black text-slate-800 uppercase tracking-tight truncate">{log.productName}</div>
                            {item && (
                              <div className="flex flex-wrap items-center gap-2 mt-1">
                                <span className="text-[8px] font-black text-slate-500 uppercase bg-slate-50 px-2 py-0.5 rounded border">BATCH: {item.batchCode}</span>
                                {item.supplier && (
                                  <span className="text-[8px] font-black text-blue-500 uppercase bg-blue-50 px-2 py-0.5 rounded border border-blue-100 flex items-center gap-1">
                                    <Truck size={8} /> {item.supplier}
                                  </span>
                                )}
                                <span className="text-[8px] font-black text-slate-500 uppercase bg-slate-50 px-2 py-0.5 rounded border">IN: {formatDateReadable(item.arrivalDate)}</span>
                                {item.expiryDate && item.expiryDate !== '-' && item.expiryDate !== 'NOEXP' && (
                                  <span className="text-[8px] font-black text-red-500 uppercase bg-red-50/50 px-2 py-0.5 rounded border border-red-100">EXP: {formatDateReadable(item.expiryDate)}</span>
                                )}
                              </div>
                            )}
                          </div>
                          {isSuperAdmin && (
                            <div className="flex gap-1 ml-4 shrink-0">
                              <button onClick={() => openEditModal(log)} className="p-1.5 text-blue-500 hover:bg-blue-50 rounded-lg transition-colors"><Edit3 size={14} /></button>
                              <button onClick={() => openDeleteModal(log)} className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition-colors"><Trash2 size={14} /></button>
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-center"><span className={`px-2.5 py-1 rounded-lg text-[8px] font-black border uppercase ${log.type === 'IN' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : log.type === 'OUT' ? 'bg-red-50 text-red-600 border-red-100' : 'bg-blue-50 text-blue-600'}`}>{log.type}</span></td>
                      <td className={`px-6 py-4 text-right font-black ${Number(log.quantityChange || 0) > 0 ? 'text-emerald-600' : 'text-red-600'}`}>{Number(log.quantityChange || 0) > 0 ? `+${log.quantityChange?.toLocaleString()}` : log.quantityChange?.toLocaleString()}</td>
                      <td
                        className={`px-6 py-4 text-slate-400 max-w-[200px] uppercase text-[10px] cursor-pointer hover:bg-slate-100/50 transition-colors ${expandedNotes[log.id] ? 'whitespace-normal break-words' : 'truncate'}`}
                        onClick={() => setExpandedNotes(prev => ({ ...prev, [log.id]: !prev[log.id] }))}
                        title="Klik untuk melihat selengkapnya"
                      >
                        {log.recipient || log.note || '-'}
                      </td>
                      <td className="px-6 py-4 text-center"><div className="inline-flex items-center gap-1.5 bg-slate-50 px-3 py-1 rounded-full border border-slate-100"><UserIcon size={10} className="text-red-600" /><span className="text-[9px] font-black text-slate-900 uppercase">{log.user || '-'}</span></div></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="md:hidden divide-y divide-slate-100">
            {filteredLogs.map((log) => {
              const item = getItem(log.stockItemId);
              return (
                <div key={log.id} className="p-5 flex flex-col gap-3">
                  <div className="flex justify-between items-start">
                    <div className="flex gap-2">
                      <span className={`px-2 py-0.5 rounded-lg text-[8px] font-black uppercase border ${log.type === 'IN' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : log.type === 'OUT' ? 'bg-red-50 text-red-600 border-red-100' : 'bg-blue-50 text-blue-600'}`}>{log.type}</span>
                      <span className="text-[9px] font-bold text-slate-400">{formatDateTimeFull(log.timestamp)}</span>
                    </div>
                    {isSuperAdmin && (
                      <div className="flex gap-2">
                        <button onClick={() => openEditModal(log)} className="p-1 text-blue-500"><Edit3 size={14} /></button>
                        <button onClick={() => openDeleteModal(log)} className="p-1 text-red-500"><Trash2 size={14} /></button>
                      </div>
                    )}
                  </div>
                  <div className="flex justify-between items-start gap-4">
                    <div className="flex-1 min-w-0">
                      <h4 className="text-[12px] font-black text-slate-900 uppercase truncate leading-tight">{log.productName}</h4>
                      {item && (
                        <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                          <span className="text-[7.5px] font-black text-slate-400 uppercase bg-slate-50 px-1.5 py-0.5 rounded border">BATCH: {item.batchCode}</span>
                          {item.supplier && (
                            <span className="text-[7.5px] font-black text-blue-500 uppercase bg-blue-50 px-1.5 py-0.5 rounded border border-blue-100">{item.supplier}</span>
                          )}
                          <span className="text-[7.5px] font-black text-slate-400 uppercase bg-slate-50 px-1.5 py-0.5 rounded border">IN: {formatDateReadable(item.arrivalDate)}</span>
                          {item.expiryDate && item.expiryDate !== '-' && item.expiryDate !== 'NOEXP' && (
                            <span className="text-[7.5px] font-black text-red-500 uppercase bg-red-50/50 px-1.5 py-0.5 rounded border border-red-100">EXP: {formatDateReadable(item.expiryDate)}</span>
                          )}
                        </div>
                      )}
                      <p
                        className={`text-[9px] font-bold text-slate-400 uppercase mt-2 bg-slate-50 p-1.5 rounded-lg cursor-pointer hover:bg-slate-100 transition-colors ${expandedNotes[log.id] ? 'whitespace-normal break-words' : 'truncate'}`}
                        onClick={() => setExpandedNotes(prev => ({ ...prev, [log.id]: !prev[log.id] }))}
                        title="Klik untuk melihat selengkapnya"
                      >
                        {log.recipient ? `PENERIMA: ${log.recipient}` : log.note || '-'}
                      </p>
                    </div>
                    <div className={`text-right font-black shrink-0 ${Number(log.quantityChange || 0) > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                      <span className="text-sm">{Number(log.quantityChange || 0) > 0 ? '+' : ''}{log.quantityChange?.toLocaleString()}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default History;