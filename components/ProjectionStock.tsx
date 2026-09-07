import React, { useState, useMemo, useEffect } from 'react';
import { Product, StockItem, LogEntry, User } from '../types.ts';
import {
    TrendingDown, Calendar, Timer, ShoppingCart, Calculator,
    FileSpreadsheet, Copy, Check, RotateCcw, AlertTriangle,
    ShieldCheck, Search, Filter, Package, ArrowRight, Sparkles,
    Info, ChevronDown, Download
} from 'lucide-react';

interface ProjectionStockProps {
    products: Product[];
    inventory: StockItem[];
    logs: LogEntry[];
    currentUser: User;
    onRefresh?: () => void;
}

const STORAGE_PR_KEY = 'bsi_dwh_packaging_pr_plan';

export const ProjectionStock: React.FC<ProjectionStockProps> = ({
    products,
    inventory,
    logs,
    currentUser,
    onRefresh
}) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState<'ALL' | 'CRITICAL' | 'WARNING' | 'SAFE' | 'WITH_PR' | 'EMPTY'>('ALL');
    const [periodDays, setPeriodDays] = useState<number>(30); // 7, 14, 30, 60, 90 (3 bulan)
    const [targetCoverWeeks, setTargetCoverWeeks] = useState<number>(4); // default planning target 4 weeks
    const [copiedNotification, setCopiedNotification] = useState(false);

    // PR input quantities state (productId -> planned quantity)
    const [prQuantities, setPrQuantities] = useState<Record<string, number>>(() => {
        try {
            const saved = localStorage.getItem(STORAGE_PR_KEY);
            if (saved) return JSON.parse(saved);
        } catch (e) {
            console.error("Failed to load PR plan from storage", e);
        }
        return {};
    });

    // Persist PR quantities whenever changed
    useEffect(() => {
        try {
            localStorage.setItem(STORAGE_PR_KEY, JSON.stringify(prQuantities));
        } catch (e) {
            console.error("Failed to save PR plan to storage", e);
        }
    }, [prQuantities]);

    const handlePrChange = (productId: string, val: string) => {
        const num = parseFloat(val);
        setPrQuantities(prev => {
            const updated = { ...prev };
            if (isNaN(num) || num <= 0) {
                delete updated[productId];
            } else {
                updated[productId] = num;
            }
            return updated;
        });
    };

    const handleResetPr = () => {
        if (window.confirm("Apakah Anda yakin ingin mengosongkan semua rencana Purchase Request (PR)?")) {
            setPrQuantities({});
        }
    };

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

    // Filter only Packaging products
    const packagingProducts = useMemo(() => {
        return products.filter(p => {
            const cat = (p.category || '').trim().toLowerCase();
            const isPack = cat === 'packaging' || cat.includes('packag');
            const isActive = p.isActive !== false;
            return isPack && isActive;
        });
    }, [products]);

    // Calculate usage and projection metrics for each packaging product
    const projectionItems = useMemo(() => {
        const windowStart = Date.now() - (periodDays * 24 * 60 * 60 * 1000);

        return packagingProducts.map(product => {
            // Find outbound logs within the window
            const productLogs = logs.filter(l =>
                l.type === 'OUT' &&
                l.timestamp >= windowStart &&
                (String(l.productName).trim().toLowerCase() === String(product.name).trim().toLowerCase() ||
                    (product.id && String(l.stockItemId || '').toUpperCase().includes(String(product.id).toUpperCase())))
            );

            const totalOut = productLogs.reduce((acc, l) => acc + Math.abs(Number(l.quantityChange || 0)), 0);
            const avgDailyUsage = totalOut / periodDays;
            const avgWeeklyUsage = avgDailyUsage * 7;

            const currentStock = Number(product.stockToday) || 0;
            const safetyStock = Number(product.safetyStock) || 0;

            // Current cover
            let currentDaysCover = 0;
            let currentWeekCover = 0;
            let currentEstDateStr = '-';

            if (currentStock <= 0) {
                currentDaysCover = 0;
                currentWeekCover = 0;
                currentEstDateStr = 'Habis';
            } else if (avgDailyUsage <= 0) {
                currentDaysCover = 999;
                currentWeekCover = 999;
                currentEstDateStr = 'Stagnan (0 Keluar)';
            } else {
                currentDaysCover = currentStock / avgDailyUsage;
                currentWeekCover = currentDaysCover / 7;
                const estDate = new Date(Date.now() + Math.round(currentDaysCover) * 86400000);
                currentEstDateStr = formatDateReadable(estDate.toISOString());
            }

            // Purchase Request & Projected metrics
            const prQty = prQuantities[product.id] || 0;
            const projectedStock = currentStock + prQty;

            let projectedDaysCover = 0;
            let projectedWeekCover = 0;
            let projectedEstDateStr = '-';

            if (projectedStock <= 0) {
                projectedDaysCover = 0;
                projectedWeekCover = 0;
                projectedEstDateStr = 'Habis';
            } else if (avgDailyUsage <= 0) {
                projectedDaysCover = 999;
                projectedWeekCover = 999;
                projectedEstDateStr = 'Stagnan (0 Keluar)';
            } else {
                projectedDaysCover = projectedStock / avgDailyUsage;
                projectedWeekCover = projectedDaysCover / 7;
                const estProjDate = new Date(Date.now() + Math.round(projectedDaysCover) * 86400000);
                projectedEstDateStr = formatDateReadable(estProjDate.toISOString());
            }

            // Auto-suggested PR quantity for target weeks
            const targetDailyStock = targetCoverWeeks * 7 * avgDailyUsage;
            const suggestedPrQty = Math.max(0, Math.ceil(targetDailyStock - currentStock));

            // Health status determination
            let status: 'EMPTY' | 'CRITICAL' | 'WARNING' | 'SAFE' | 'STAGNANT' = 'SAFE';
            if (currentStock <= 0) {
                status = 'EMPTY';
            } else if (avgDailyUsage <= 0) {
                status = 'STAGNANT';
            } else if (currentWeekCover < 1.0) {
                status = 'CRITICAL'; // Less than 1 week
            } else if (currentWeekCover < 2.0) {
                status = 'WARNING'; // 1 to 2 weeks
            } else {
                status = 'SAFE';
            }

            // Projected health status
            let projectedStatus: 'EMPTY' | 'CRITICAL' | 'WARNING' | 'SAFE' | 'STAGNANT' = 'SAFE';
            if (projectedStock <= 0) {
                projectedStatus = 'EMPTY';
            } else if (avgDailyUsage <= 0) {
                projectedStatus = 'STAGNANT';
            } else if (projectedWeekCover < 1.0) {
                projectedStatus = 'CRITICAL';
            } else if (projectedWeekCover < 2.0) {
                projectedStatus = 'WARNING';
            } else {
                projectedStatus = 'SAFE';
            }

            return {
                product,
                totalOut,
                avgDailyUsage,
                avgWeeklyUsage,
                currentStock,
                safetyStock,
                currentDaysCover,
                currentWeekCover,
                currentEstDateStr,
                status,
                prQty,
                projectedStock,
                projectedDaysCover,
                projectedWeekCover,
                projectedEstDateStr,
                projectedStatus,
                suggestedPrQty
            };
        });
    }, [packagingProducts, logs, periodDays, prQuantities, targetCoverWeeks]);

    // Auto-fill suggested PR for items that have cover < targetCoverWeeks
    const handleAutoSuggestAll = () => {
        const updated = { ...prQuantities };
        let filledCount = 0;
        projectionItems.forEach(item => {
            if (item.avgDailyUsage > 0 && item.currentWeekCover < targetCoverWeeks) {
                if (item.suggestedPrQty > 0) {
                    updated[item.product.id] = item.suggestedPrQty;
                    filledCount++;
                }
            }
        });
        setPrQuantities(updated);
    };

    // Filtered rows
    const filteredItems = useMemo(() => {
        const q = searchTerm.toLowerCase().trim();
        return projectionItems.filter(item => {
            const matchSearch =
                !q ||
                item.product.name.toLowerCase().includes(q) ||
                item.product.id.toLowerCase().includes(q);

            let matchStatus = true;
            if (statusFilter === 'CRITICAL') matchStatus = item.status === 'CRITICAL';
            else if (statusFilter === 'WARNING') matchStatus = item.status === 'WARNING';
            else if (statusFilter === 'SAFE') matchStatus = item.status === 'SAFE';
            else if (statusFilter === 'EMPTY') matchStatus = item.status === 'EMPTY';
            else if (statusFilter === 'WITH_PR') matchStatus = item.prQty > 0;

            return matchSearch && matchStatus;
        });
    }, [projectionItems, searchTerm, statusFilter]);

    // Executive summary counts
    const summary = useMemo(() => {
        const totalItems = projectionItems.length;
        const criticalCount = projectionItems.filter(i => i.status === 'CRITICAL' || i.status === 'EMPTY').length;
        const warningCount = projectionItems.filter(i => i.status === 'WARNING').length;
        const withPrCount = projectionItems.filter(i => i.prQty > 0).length;
        const totalPrQuantity = projectionItems.reduce((acc, i) => acc + (i.prQty || 0), 0);

        return {
            totalItems,
            criticalCount,
            warningCount,
            withPrCount,
            totalPrQuantity
        };
    }, [projectionItems]);

    // Export PR plan to CSV
    const handleExportCSV = () => {
        const itemsToExport = projectionItems.filter(i => i.prQty > 0);
        if (itemsToExport.length === 0) {
            alert("Belum ada Purchase Request (PR) yang diisi.");
            return;
        }

        const headers = [
            "Kode Produk",
            "Nama Kemasan / Packaging",
            "Satuan",
            "Stok Sekarang",
            "Total Keluar",
            "Rata-rata/Hari",
            "Week Cover Sekarang",
            "Purchase Request (PR)",
            "Est Stok Setelah PR",
            "Est Week Cover Setelah PR",
            "Est Habis Setelah PR"
        ];

        const rows = itemsToExport.map(i => [
            `"${i.product.id}"`,
            `"${i.product.name.replace(/"/g, '""')}"`,
            `"${i.product.unit}"`,
            i.currentStock,
            i.totalOut,
            i.avgDailyUsage.toFixed(2),
            i.currentWeekCover === 999 ? "Stagnan" : i.currentWeekCover.toFixed(1),
            i.prQty,
            i.projectedStock,
            i.projectedWeekCover === 999 ? "Stagnan" : i.projectedWeekCover.toFixed(1),
            `"${i.projectedEstDateStr}"`
        ]);

        const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", `PR_Packaging_Planning_${new Date().toISOString().split('T')[0]}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    // Copy PR summary text to clipboard
    const handleCopySummary = () => {
        const itemsWithPr = projectionItems.filter(i => i.prQty > 0);
        if (itemsWithPr.length === 0) {
            alert("Belum ada Purchase Request (PR) yang diisi.");
            return;
        }

        let text = `*RENCANA PURCHASE REQUEST (PR) PACKAGING*\nTanggal: ${new Date().toLocaleDateString('id-ID', { dateStyle: 'full' })}\nBasis Rata-rata: ${periodDays} Hari Terakhir\n\n`;
        itemsWithPr.forEach((item, index) => {
            text += `${index + 1}. [${item.product.id}] ${item.product.name}\n`;
            text += `   - Stok Sekarang: ${item.currentStock.toLocaleString()} ${item.product.unit} (${item.currentWeekCover === 999 ? 'Stagnan' : item.currentWeekCover.toFixed(1) + ' Wk Cover'})\n`;
            text += `   - Pemakaian Rata-rata: ${item.avgDailyUsage.toFixed(1)} ${item.product.unit}/hari\n`;
            text += `   - *Usulan PR*: *${item.prQty.toLocaleString()} ${item.product.unit}*\n`;
            text += `   - *Est Stok Setelah PR*: ${item.projectedStock.toLocaleString()} ${item.product.unit} (Est Cover: ${item.projectedWeekCover === 999 ? 'Stagnan' : item.projectedWeekCover.toFixed(1) + ' Minggu'})\n`;
            text += `   - *Est Habis*: ${item.projectedEstDateStr}\n\n`;
        });
        text += `Total Jenis Barang: ${itemsWithPr.length}\n`;

        navigator.clipboard.writeText(text).then(() => {
            setCopiedNotification(true);
            setTimeout(() => setCopiedNotification(false), 3000);
        }).catch(() => {
            alert("Gagal menyalin ke clipboard.");
        });
    };

    const getWeekCoverBadge = (weekCover: number, status: string, isProjected = false) => {
        if (status === 'EMPTY') {
            return (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-wider bg-red-600 text-white">
                    Stok Habis
                </span>
            );
        }
        if (status === 'STAGNANT' || weekCover === 999) {
            return (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-wider bg-slate-100 text-slate-600 border border-slate-200">
                    Stagnan
                </span>
            );
        }
        if (weekCover < 1.0) {
            return (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-wider bg-red-500 text-white shadow-sm shadow-red-200">
                    <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse"></span>
                    {weekCover.toFixed(1)} Mg (Kritis)
                </span>
            );
        }
        if (weekCover < 2.0) {
            return (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-wider bg-amber-500 text-white shadow-sm shadow-amber-200">
                    {weekCover.toFixed(1)} Mg (Waspada)
                </span>
            );
        }
        return (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-wider bg-emerald-500 text-white shadow-sm shadow-emerald-200">
                {weekCover.toFixed(1)} Mg (Aman)
            </span>
        );
    };

    // Hanya AdminPPIC (atau SuperAdmin) yang berhak melihat halaman Projection Stock
    const canAccess = currentUser.role === 'AdminPPIC' || currentUser.username.toLowerCase() === 'adminppic' || currentUser.role === 'SuperAdmin';

    if (!canAccess) {
        return (
            <div className="bg-white p-10 rounded-[2.5rem] border border-slate-200 shadow-sm text-center max-w-md mx-auto my-12">
                <div className="w-16 h-16 bg-red-50 text-red-600 rounded-2xl flex items-center justify-center mx-auto mb-4 border border-red-100">
                    <AlertTriangle size={28} />
                </div>
                <h3 className="text-base font-black text-slate-900 uppercase tracking-tight">Akses Khusus AdminPPIC</h3>
                <p className="text-xs text-slate-500 font-bold mt-2 leading-relaxed uppercase tracking-wider">
                    Halaman Proyeksi Stok khusus dapat diakses oleh AdminPPIC. Akun Anda tidak memiliki izin untuk melihat modul ini.
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-5">
            {/* Toast Notification for Copied Summary */}
            {copiedNotification && (
                <div className="fixed top-24 right-6 z-[600] bg-slate-900 text-white px-5 py-3 rounded-2xl shadow-2xl flex items-center gap-3 animate-in slide-in-from-top-4">
                    <Check size={18} className="text-emerald-400" />
                    <span className="text-xs font-black uppercase tracking-wider">Ringkasan PR Berhasil Disalin!</span>
                </div>
            )}

            {/* HEADER PLANNING DASHBOARD CARDS */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
                <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between">
                    <div className="flex items-center justify-between text-slate-400">
                        <span className="text-[9px] font-black uppercase tracking-widest">Total Packaging</span>
                        <Package size={16} className="text-slate-500" />
                    </div>
                    <div className="mt-2 flex items-baseline gap-2">
                        <span className="text-2xl md:text-3xl font-black text-slate-900">{summary.totalItems}</span>
                        <span className="text-[9px] font-bold text-slate-400 uppercase">Item</span>
                    </div>
                    <span className="text-[8px] font-bold text-slate-400 mt-1 uppercase">Kategori Kemasan</span>
                </div>

                <div className="bg-red-50/60 p-4 rounded-2xl border border-red-200 shadow-sm flex flex-col justify-between">
                    <div className="flex items-center justify-between text-red-500">
                        <span className="text-[9px] font-black uppercase tracking-widest">Kritis (&lt; 1 Minggu)</span>
                        <AlertTriangle size={16} className="text-red-600 animate-bounce" />
                    </div>
                    <div className="mt-2 flex items-baseline gap-2">
                        <span className="text-2xl md:text-3xl font-black text-red-600">{summary.criticalCount}</span>
                        <span className="text-[9px] font-bold text-red-500 uppercase">Item</span>
                    </div>
                    <span className="text-[8px] font-black text-red-500 mt-1 uppercase">Perlu Segera Order!</span>
                </div>

                <div className="bg-amber-50/60 p-4 rounded-2xl border border-amber-200 shadow-sm flex flex-col justify-between">
                    <div className="flex items-center justify-between text-amber-600">
                        <span className="text-[9px] font-black uppercase tracking-widest">Waspada (1-2 Minggu)</span>
                        <Timer size={16} className="text-amber-600" />
                    </div>
                    <div className="mt-2 flex items-baseline gap-2">
                        <span className="text-2xl md:text-3xl font-black text-amber-700">{summary.warningCount}</span>
                        <span className="text-[9px] font-bold text-amber-600 uppercase">Item</span>
                    </div>
                    <span className="text-[8px] font-bold text-amber-600 mt-1 uppercase">Persiapan PO</span>
                </div>

                <div className="bg-blue-50/60 p-4 rounded-2xl border border-blue-200 shadow-sm flex flex-col justify-between">
                    <div className="flex items-center justify-between text-blue-600">
                        <span className="text-[9px] font-black uppercase tracking-widest">Rencana PR Aktif</span>
                        <ShoppingCart size={16} className="text-blue-600" />
                    </div>
                    <div className="mt-2 flex items-baseline gap-2">
                        <span className="text-2xl md:text-3xl font-black text-blue-700">{summary.withPrCount}</span>
                        <span className="text-[9px] font-bold text-blue-600 uppercase">Item Diisi</span>
                    </div>
                    <span className="text-[8px] font-bold text-blue-600 mt-1 uppercase">Total Qty: {summary.totalPrQuantity.toLocaleString()}</span>
                </div>
            </div>

            {/* CONTROLS & TOOLBAR */}
            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col lg:flex-row gap-4 justify-between items-stretch lg:items-center">
                {/* Left: Search & Filter */}
                <div className="flex flex-wrap gap-2 items-center flex-1">
                    <div className="relative flex-1 min-w-[200px] max-w-md">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <input
                            type="text"
                            placeholder="Cari nama atau kode packaging..."
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                            className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:border-red-500 focus:bg-white transition-all"
                        />
                    </div>

                    <div className="relative min-w-[140px]">
                        <Filter className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                        <select
                            value={statusFilter}
                            onChange={e => setStatusFilter(e.target.value as any)}
                            className="w-full pl-8 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-[10px] font-black uppercase outline-none cursor-pointer"
                        >
                            <option value="ALL">SEMUA STATUS</option>
                            <option value="CRITICAL">KRITIS (&lt; 1 MG)</option>
                            <option value="WARNING">WASPADA (1-2 MG)</option>
                            <option value="SAFE">AMAN (&gt; 2 MG)</option>
                            <option value="WITH_PR">DENGAN RENCANA PR</option>
                            <option value="EMPTY">STOK HABIS</option>
                        </select>
                    </div>
                </div>

                {/* Right: Planning Settings & Actions */}
                <div className="flex flex-wrap gap-2 items-center">
                    {/* Basis Rata-Rata Picker */}
                    <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl border border-slate-200 text-[10px] font-black uppercase">
                        <span className="text-slate-400 px-1.5 text-[8px]">Basis Data:</span>
                        {[
                            { days: 7, label: '7D' },
                            { days: 14, label: '14D' },
                            { days: 30, label: '30D' },
                            { days: 60, label: '60D' },
                            { days: 90, label: '90D (3 Bln)' }
                        ].map(item => (
                            <button
                                key={item.days}
                                type="button"
                                title={`${item.days} Hari (${item.days === 90 ? '3 Bulan' : item.days === 60 ? '2 Bulan' : item.days === 30 ? '1 Bulan' : `${item.days} Hari`})`}
                                onClick={() => setPeriodDays(item.days)}
                                className={`px-2.5 py-1 rounded-lg text-[9px] font-black transition-all ${periodDays === item.days ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                            >
                                {item.label}
                            </button>
                        ))}
                    </div>

                    {/* Target Cover Suggestion */}
                    <button
                        type="button"
                        onClick={handleAutoSuggestAll}
                        title="Isi otomatis PR agar stok mencapai cover 4 minggu"
                        className="flex items-center gap-1.5 px-3 py-2 bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all"
                    >
                        <Sparkles size={13} className="text-blue-600" />
                        Saran PR (4 Mg)
                    </button>

                    {/* Clear PR */}
                    {summary.withPrCount > 0 && (
                        <button
                            type="button"
                            onClick={handleResetPr}
                            className="flex items-center gap-1 px-3 py-2 bg-slate-100 hover:bg-red-50 hover:text-red-600 text-slate-500 rounded-xl text-[10px] font-black uppercase transition-all"
                        >
                            <RotateCcw size={13} />
                            Reset PR
                        </button>
                    )}

                    {/* Copy Summary Text */}
                    <button
                        type="button"
                        onClick={handleCopySummary}
                        className="flex items-center gap-1.5 px-3 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-[10px] font-black uppercase tracking-wider transition-all"
                    >
                        <Copy size={13} />
                        Salin PR
                    </button>

                    {/* Export CSV */}
                    <button
                        type="button"
                        onClick={handleExportCSV}
                        className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-[10px] font-black uppercase tracking-wider transition-all"
                    >
                        <Download size={13} />
                        CSV
                    </button>
                </div>
            </div>

            {/* MAIN PLANNING TABLE (DESKTOP) */}
            <div className="hidden lg:block bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-[11px] border-collapse min-w-[1000px]">
                        <thead>
                            <tr className="bg-slate-50 text-slate-500 font-black uppercase text-[8px] tracking-widest border-b border-slate-200">
                                <th className="px-5 py-4 w-72">Item Packaging</th>
                                <th className="px-3 py-4 text-center">Satuan</th>
                                <th className="px-4 py-4 text-right bg-slate-100/50">Stok Saat Ini</th>
                                <th className="px-4 py-4 text-right">Rata-rata/Hari ({periodDays}D)</th>
                                <th className="px-4 py-4 text-center">Week Cover (Saat Ini)</th>
                                <th className="px-4 py-4 text-center">Est Habis (Saat Ini)</th>
                                <th className="px-4 py-4 text-center bg-blue-50/60 text-blue-700 border-x border-blue-100">
                                    <div className="flex items-center justify-center gap-1">
                                        <ShoppingCart size={12} />
                                        <span>Purchase Request (PR)</span>
                                    </div>
                                </th>
                                <th className="px-4 py-4 text-right bg-emerald-50/30 text-emerald-900">Est Stok (+PR)</th>
                                <th className="px-4 py-4 text-center bg-emerald-50/30 text-emerald-900">Est Week Cover</th>
                                <th className="px-4 py-4 text-center bg-emerald-50/30 text-emerald-900">Est Habis Baru</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {filteredItems.length > 0 ? filteredItems.map(item => {
                                const hasPr = item.prQty > 0;
                                return (
                                    <tr
                                        key={item.product.id}
                                        className={`hover:bg-slate-50/80 transition-colors ${hasPr ? 'bg-blue-50/20' : ''}`}
                                    >
                                        {/* Item Packaging Identity */}
                                        <td className="px-5 py-3">
                                            <div className="font-black text-slate-900 uppercase text-[11px] leading-tight tracking-tight">
                                                {item.product.name}
                                            </div>
                                            <div className="flex items-center gap-2 mt-1">
                                                <span className="text-[8px] font-mono font-bold text-slate-400 uppercase">
                                                    #{item.product.id}
                                                </span>
                                                {item.safetyStock > 0 && (
                                                    <span className="text-[7px] font-black text-slate-400 uppercase bg-slate-100 px-1.5 py-0.2 rounded">
                                                        Safety: {item.safetyStock}
                                                    </span>
                                                )}
                                            </div>
                                        </td>

                                        {/* Satuan */}
                                        <td className="px-3 py-3 text-center font-bold text-slate-400 uppercase">
                                            {item.product.unit}
                                        </td>

                                        {/* Current Stock */}
                                        <td className="px-4 py-3 text-right bg-slate-100/30 font-black text-slate-900 text-sm">
                                            {item.currentStock.toLocaleString()}
                                        </td>

                                        {/* Average Daily Usage */}
                                        <td className="px-4 py-3 text-right">
                                            <div className="font-black text-slate-800">
                                                {item.avgDailyUsage > 0 ? item.avgDailyUsage.toFixed(1) : '0'}
                                            </div>
                                            <div className="text-[8px] font-bold text-slate-400">
                                                {item.avgWeeklyUsage > 0 ? `(${item.avgWeeklyUsage.toFixed(0)}/mg)` : '-'}
                                            </div>
                                        </td>

                                        {/* Current Week Cover Status */}
                                        <td className="px-4 py-3 text-center">
                                            {getWeekCoverBadge(item.currentWeekCover, item.status)}
                                        </td>

                                        {/* Current Depletion Date */}
                                        <td className="px-4 py-3 text-center">
                                            <div className="font-black text-slate-800 text-[10px]">
                                                {item.currentEstDateStr}
                                            </div>
                                            {item.currentDaysCover < 999 && item.currentDaysCover > 0 && (
                                                <div className="text-[8px] font-bold text-slate-400">
                                                    {Math.round(item.currentDaysCover)} hari lagi
                                                </div>
                                            )}
                                        </td>

                                        {/* PR Input Field */}
                                        <td className="px-3 py-2 bg-blue-50/30 border-x border-blue-100">
                                            <div className="flex items-center gap-1.5 justify-center">
                                                <input
                                                    type="number"
                                                    min="0"
                                                    step="any"
                                                    placeholder="0"
                                                    value={item.prQty > 0 ? item.prQty : ''}
                                                    onChange={e => handlePrChange(item.product.id, e.target.value)}
                                                    className={`w-28 px-2.5 py-1.5 rounded-xl text-center font-black text-xs outline-none border transition-all ${hasPr
                                                            ? 'bg-blue-600 text-white border-blue-600 shadow-sm shadow-blue-200 font-extrabold'
                                                            : 'bg-white border-slate-200 text-slate-800 focus:border-blue-500 focus:ring-2 focus:ring-blue-100'
                                                        }`}
                                                />
                                                {item.suggestedPrQty > 0 && !hasPr && (
                                                    <button
                                                        type="button"
                                                        onClick={() => handlePrChange(item.product.id, String(item.suggestedPrQty))}
                                                        title={`Klik untuk isi rekomendasi: +${item.suggestedPrQty} ${item.product.unit}`}
                                                        className="text-[8px] font-black text-blue-600 bg-blue-100 hover:bg-blue-200 px-1.5 py-1 rounded-lg uppercase tracking-tight shrink-0 transition-colors"
                                                    >
                                                        +{item.suggestedPrQty}
                                                    </button>
                                                )}
                                            </div>
                                        </td>

                                        {/* Projected Stock (+PR) */}
                                        <td className="px-4 py-3 text-right bg-emerald-50/10 font-black text-sm">
                                            <span className={hasPr ? 'text-blue-700 font-extrabold' : 'text-slate-900'}>
                                                {item.projectedStock.toLocaleString()}
                                            </span>
                                            {hasPr && (
                                                <div className="text-[8px] font-black text-emerald-600">
                                                    +{item.prQty.toLocaleString()}
                                                </div>
                                            )}
                                        </td>

                                        {/* Projected Week Cover */}
                                        <td className="px-4 py-3 text-center bg-emerald-50/10">
                                            {getWeekCoverBadge(item.projectedWeekCover, item.projectedStatus, true)}
                                            {hasPr && item.projectedWeekCover < 999 && item.currentWeekCover < 999 && (
                                                <div className="text-[8px] font-black text-blue-600 mt-0.5">
                                                    +{(item.projectedWeekCover - item.currentWeekCover).toFixed(1)} mg
                                                </div>
                                            )}
                                        </td>

                                        {/* Projected Depletion Date */}
                                        <td className="px-4 py-3 text-center bg-emerald-50/10">
                                            <div className={`font-black text-[10px] ${hasPr ? 'text-emerald-700 font-extrabold' : 'text-slate-800'}`}>
                                                {item.projectedEstDateStr}
                                            </div>
                                            {hasPr && item.projectedDaysCover < 999 && (
                                                <div className="text-[8px] font-bold text-emerald-600">
                                                    {Math.round(item.projectedDaysCover)} hari total
                                                </div>
                                            )}
                                        </td>
                                    </tr>
                                );
                            }) : (
                                <tr>
                                    <td colSpan={10} className="py-16 text-center text-slate-400 font-bold text-xs uppercase tracking-wider">
                                        Tidak ada item packaging yang cocok dengan filter.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* MOBILE OPTIMIZED CARDS */}
            <div className="lg:hidden space-y-3">
                {filteredItems.length > 0 ? filteredItems.map(item => {
                    const hasPr = item.prQty > 0;
                    return (
                        <div
                            key={item.product.id}
                            className={`bg-white p-4 rounded-2xl border transition-all ${hasPr ? 'border-blue-300 shadow-sm bg-blue-50/10' : 'border-slate-200'
                                }`}
                        >
                            {/* Card Header */}
                            <div className="flex justify-between items-start gap-3">
                                <div>
                                    <h4 className="font-black text-slate-900 uppercase text-xs leading-tight">
                                        {item.product.name}
                                    </h4>
                                    <div className="flex items-center gap-2 mt-1">
                                        <span className="text-[8px] font-mono font-bold text-slate-400 uppercase">
                                            #{item.product.id}
                                        </span>
                                        <span className="text-[8px] font-bold text-slate-400 uppercase bg-slate-100 px-1.5 py-0.5 rounded">
                                            {item.product.unit}
                                        </span>
                                    </div>
                                </div>

                                <div className="text-right">
                                    <div className="text-[8px] font-black text-slate-400 uppercase">Stok Sekarang</div>
                                    <div className="text-lg font-black text-slate-900">{item.currentStock.toLocaleString()}</div>
                                </div>
                            </div>

                            {/* Usage & Current Cover Status */}
                            <div className="mt-3 grid grid-cols-2 gap-2 bg-slate-50 p-2.5 rounded-xl border border-slate-100 text-[10px]">
                                <div>
                                    <span className="text-[8px] font-black text-slate-400 uppercase block">Rata-rata Keluar</span>
                                    <span className="font-black text-slate-800">
                                        {item.avgDailyUsage.toFixed(1)} {item.product.unit}/hari
                                    </span>
                                    <span className="text-[7px] text-slate-400 block font-bold">
                                        ({item.avgWeeklyUsage.toFixed(0)}/minggu)
                                    </span>
                                </div>
                                <div>
                                    <span className="text-[8px] font-black text-slate-400 uppercase block mb-1">Week Cover Saat Ini</span>
                                    {getWeekCoverBadge(item.currentWeekCover, item.status)}
                                    <div className="text-[7px] font-bold text-slate-500 mt-1">
                                        Est Habis: {item.currentEstDateStr}
                                    </div>
                                </div>
                            </div>

                            {/* Purchase Request Input & Projection Section */}
                            <div className="mt-3 pt-3 border-t border-slate-100">
                                <div className="flex items-center justify-between gap-2">
                                    <label className="text-[9px] font-black text-blue-700 uppercase flex items-center gap-1">
                                        <ShoppingCart size={12} />
                                        Purchase Request (PR):
                                    </label>
                                    {item.suggestedPrQty > 0 && !hasPr && (
                                        <button
                                            type="button"
                                            onClick={() => handlePrChange(item.product.id, String(item.suggestedPrQty))}
                                            className="text-[8px] font-black text-blue-600 bg-blue-100 px-2 py-0.5 rounded uppercase"
                                        >
                                            + Rekomendasi ({item.suggestedPrQty})
                                        </button>
                                    )}
                                </div>

                                <div className="mt-2 flex items-center gap-2">
                                    <input
                                        type="number"
                                        min="0"
                                        placeholder="Masukkan jumlah PR..."
                                        value={item.prQty > 0 ? item.prQty : ''}
                                        onChange={e => handlePrChange(item.product.id, e.target.value)}
                                        className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-black text-xs outline-none focus:bg-white focus:border-blue-500"
                                    />
                                    <span className="text-[10px] font-black text-slate-400 uppercase">{item.product.unit}</span>
                                </div>

                                {/* Live Projection Box */}
                                {hasPr && (
                                    <div className="mt-2.5 p-2.5 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center justify-between text-[10px]">
                                        <div>
                                            <span className="text-[8px] font-black text-emerald-800 uppercase block">Est Stok Baru</span>
                                            <span className="font-black text-emerald-900 text-xs">{item.projectedStock.toLocaleString()} {item.product.unit}</span>
                                        </div>
                                        <div className="text-right">
                                            <span className="text-[8px] font-black text-emerald-800 uppercase block mb-0.5">Est Week Cover</span>
                                            {getWeekCoverBadge(item.projectedWeekCover, item.projectedStatus, true)}
                                            <div className="text-[7px] font-black text-emerald-700 mt-1">
                                                Est: {item.projectedEstDateStr}
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                }) : (
                    <div className="py-16 text-center text-slate-400 font-bold text-xs uppercase tracking-wider bg-white rounded-2xl border border-slate-200">
                        Tidak ada item packaging yang cocok.
                    </div>
                )}
            </div>
        </div>
    );
};

export default ProjectionStock;
