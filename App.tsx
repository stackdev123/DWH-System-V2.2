import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { User, Product, StockItem, LogEntry, ItemStatus } from './types.ts';
import { db, supabase } from './services/database.ts';
import Login from './components/Login.tsx';
import Transactions from './components/Transactions.tsx';
import Inventory from './components/Inventory.tsx';
import History from './components/History.tsx';
import About from './components/About.tsx';
import LabelGenerator from './components/LabelGenerator.tsx';
import Dashboard from './components/Dashboard.tsx';
import SimpleInventoryModule from './components/SimpleInventoryModule.tsx';
import OnlineUsers from './components/OnlineUsers.tsx';
import SettingsComponent, { ThemeMode } from './components/Settings.tsx';
import {
  ArrowLeftRight,
  Package,
  History as HistoryIcon,
  Info,
  LogOut,
  RefreshCw,
  Tag,
  LayoutDashboard,
  Settings,
  Sliders,
  Moon,
  Sun,
  Briefcase,
  AlertOctagon,
  AlertTriangle,
  ArrowDownCircle,
  X
} from 'lucide-react';

const SESSION_KEY = 'dwh_bsi_session';
const SESSION_TIMEOUT = 4 * 60 * 60 * 1000;

interface StockNotification {
  id: string;
  productName: string;
  productId: string;
  type: 'EMPTY' | 'CRITICAL' | 'INBOUND' | 'EXPIRED' | 'EXPIRING_SOON';
  message: string;
  timestamp: number;
}

export const App: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<User | null>(() => {
    try {
      const savedSession = localStorage.getItem(SESSION_KEY);
      if (savedSession) {
        const { user, timestamp } = JSON.parse(savedSession);
        const now = Date.now();
        if (now - timestamp < SESSION_TIMEOUT) {
          return user;
        }
        localStorage.removeItem(SESSION_KEY);
      }
    } catch (e) {
      console.error("Failed to load session", e);
    }
    return null;
  });

  // Manajemen Tema (Light / Dark / System)
  const [theme, setTheme] = useState<ThemeMode>(() => {
    try {
      return (localStorage.getItem('bsi_dwh_theme') as ThemeMode) || 'light';
    } catch {
      return 'light';
    }
  });

  // Preferensi Audio Alert
  const [audioAlertEnabled, setAudioAlertEnabled] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('bsi_dwh_audio_alert');
      return saved !== null ? saved === 'true' : true;
    } catch {
      return true;
    }
  });

  const [activeTab, setActiveTab] = useState('dashboard');
  const [products, setProducts] = useState<Product[]>(() => db.getCachedProducts());
  const [stock, setStock] = useState<StockItem[]>(() => db.getCachedStock());
  const [logs, setLogs] = useState<LogEntry[]>(() => db.getCachedLogs());
  const [isLoading, setIsLoading] = useState(() => db.getCachedProducts().length === 0);
  const [notifications, setNotifications] = useState<StockNotification[]>([]);

  const prevStocksRef = useRef<Record<string, number>>({});
  const notifiedExpiryRef = useRef<Set<string>>(new Set());

  // Fungsi Notifikasi Native HP (System Banner)
  const sendSystemNotification = (title: string, body: string) => {
    if (!("Notification" in window)) return;

    if (Notification.permission === "granted") {
      try {
        // Gunakan Service Worker untuk keandalan di mobile/PWA
        if ('serviceWorker' in navigator) {
          navigator.serviceWorker.ready.then(registration => {
            registration.showNotification(title, {
              body: body,
              icon: '/logo2.png',
              badge: '/logo2.png',
              vibrate: [200, 100, 200],
              tag: 'dwh-bsi-system-alert'
            } as any);
          }).catch(() => {
            new Notification(title, { body, icon: '/logo2.png' });
          });
        } else {
          new Notification(title, { body, icon: '/logo2.png' });
        }
      } catch (e) {
        console.error("Native Notification failed", e);
      }
    }
  };

  const handleToggleAudioAlert = (enabled: boolean) => {
    setAudioAlertEnabled(enabled);
    try {
      localStorage.setItem('bsi_dwh_audio_alert', String(enabled));
    } catch (e) { }
  };

  const handleThemeChange = (newTheme: ThemeMode) => {
    setTheme(newTheme);
    try {
      localStorage.setItem('bsi_dwh_theme', newTheme);
      const isDark = newTheme === 'dark' || (newTheme === 'system' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
      if (isDark) {
        document.documentElement.classList.add('dark');
        document.documentElement.style.colorScheme = 'dark';
      } else {
        document.documentElement.classList.remove('dark');
        document.documentElement.style.colorScheme = 'light';
      }
    } catch (e) {
      console.error("Failed to apply theme", e);
    }
  };

  // Sinkronisasi tema aktif ke elemen root dokumen
  useEffect(() => {
    const applyCurrentTheme = () => {
      const isDark = theme === 'dark' || (theme === 'system' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
      if (isDark) {
        document.documentElement.classList.add('dark');
        document.documentElement.style.colorScheme = 'dark';
      } else {
        document.documentElement.classList.remove('dark');
        document.documentElement.style.colorScheme = 'light';
      }
    };

    applyCurrentTheme();

    if (window.matchMedia) {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const handleChange = () => {
        if (theme === 'system') {
          applyCurrentTheme();
        }
      };
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }
  }, [theme]);

  const playAlertSound = (type: string) => {
    if (!audioAlertEnabled) return;
    try {
      const AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!AudioContext) return;
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      if (type === 'EMPTY' || type === 'EXPIRED') {
        osc.frequency.setValueAtTime(440, ctx.currentTime);
        gain.gain.setValueAtTime(0.1, ctx.currentTime);
        osc.start();
        osc.stop(ctx.currentTime + 0.3);
      } else {
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        gain.gain.setValueAtTime(0.05, ctx.currentTime);
        osc.start();
        osc.stop(ctx.currentTime + 0.1);
      }
    } catch (e) { }
  };

  const handleTestAudio = () => {
    playAlertSound('CRITICAL');
  };

  const loadAllData = useCallback(async (silent = false, forceFresh = false) => {
    if (!silent && products.length === 0) setIsLoading(true);
    try {
      const [p, s, l] = await Promise.all([
        db.getProducts(forceFresh),
        db.getAllStock(forceFresh),
        db.getAllLogs(forceFresh)
      ]);

      const now = new Date();
      const todayDateStr = now.toISOString().split('T')[0];

      // LOGIKA LAPORAN PAGI JAM 08:00
      const currentHour = now.getHours();
      const lastMorningReport = localStorage.getItem('last_morning_report_date');

      if (currentHour >= 8 && lastMorningReport !== todayDateStr && p.length > 0) {
        const empty = p.filter(prod => prod.isActive !== false && (prod.stockToday || 0) <= 0).length;
        const critical = p.filter(prod => prod.isActive !== false && (prod.safetyStock || 0) > 0 && (prod.stockToday || 0) <= (prod.safetyStock || 0) && (prod.stockToday || 0) > 0).length;

        const oneMonthLater = new Date();
        oneMonthLater.setMonth(now.getMonth() + 1);

        const expired = s.filter(item => {
          if (item.quantity <= 0 || !item.expiryDate || item.expiryDate === '-' || item.expiryDate === 'NOEXP') return false;
          const prod = p.find(master => master.id === item.productId);
          return prod && prod.isActive !== false && new Date(item.expiryDate) <= now;
        }).length;

        const soon = s.filter(item => {
          if (item.quantity <= 0 || !item.expiryDate || item.expiryDate === '-' || item.expiryDate === 'NOEXP') return false;
          const prod = p.find(master => master.id === item.productId);
          const exp = new Date(item.expiryDate);
          return prod && prod.isActive !== false && exp > now && exp <= oneMonthLater;
        }).length;

        if (empty > 0 || critical > 0 || expired > 0 || soon > 0) {
          const reportBody = `Update 08:00 - ${empty} Habis, ${critical} Kritis, ${expired} Expired, ${soon} Segera Expired.`;
          sendSystemNotification("Laporan Inventaris Pagi", reportBody);
          playAlertSound('CRITICAL');

          // Fix: Explicitly cast the object literal to StockNotification to prevent type widening (type: string)
          setNotifications(prev => [{
            id: `MORNING-${Date.now()}`,
            productName: 'RINGKASAN HARIAN (08:00)',
            productId: 'SYSTEM',
            type: 'CRITICAL',
            message: reportBody,
            timestamp: Date.now()
          } as StockNotification, ...prev].slice(0, 5));
        }
        localStorage.setItem('last_morning_report_date', todayDateStr);
      }

      // Notifikasi Perubahan Stok Real-time
      if (silent && p.length > 0) {
        const newNotifs: StockNotification[] = [];
        const oneMonthLater = new Date();
        oneMonthLater.setMonth(now.getMonth() + 1);

        p.forEach(prod => {
          const prevVal = prevStocksRef.current[prod.id];
          const newVal = prod.stockToday || 0;
          const safety = prod.safetyStock || 0;

          if (prevVal !== undefined) {
            if (prevVal > 0 && newVal <= 0) {
              newNotifs.push({
                id: `EMPTY-${prod.id}-${Date.now()}`,
                productName: prod.name,
                productId: prod.id,
                type: 'EMPTY',
                message: 'STOK HABIS (0)',
                timestamp: Date.now()
              });
              sendSystemNotification("CRITICAL: STOK HABIS", `${prod.name} telah habis.`);
              playAlertSound('EMPTY');
            }
            else if (prevVal > safety && newVal <= safety && newVal > 0) {
              newNotifs.push({
                id: `CRIT-${prod.id}-${Date.now()}`,
                productName: prod.name,
                productId: prod.id,
                type: 'CRITICAL',
                message: `STOK KRITIS (<${safety})`,
                timestamp: Date.now()
              });
              sendSystemNotification("WARNING: STOK KRITIS", `${prod.name} di bawah safety stock.`);
              playAlertSound('CRITICAL');
            }
          }
          prevStocksRef.current[prod.id] = newVal;
        });

        if (newNotifs.length > 0) {
          setNotifications(prev => [...newNotifs, ...prev].slice(0, 5));
        }
      } else {
        p.forEach(prod => {
          prevStocksRef.current[prod.id] = prod.stockToday || 0;
        });
      }

      setProducts(p);
      setStock(s);
      setLogs(l);
    } catch (error) {
      console.error("Failed to load data:", error);
    } finally {
      setIsLoading(false);
    }
  }, [products.length]);

  useEffect(() => {
    if (currentUser) {
      // Minta izin notifikasi HP saat login
      if ("Notification" in window && Notification.permission === "default") {
        Notification.requestPermission();
      }

      if (currentUser.role === 'UserMT') setActiveTab('mt');
      else if (currentUser.role === 'UserGA' || currentUser.role === 'UserHRGA') setActiveTab('hrga');
      else setActiveTab('dashboard');

      loadAllData();

      let refreshTimeout: ReturnType<typeof setTimeout> | null = null;
      const scheduleDebouncedRefresh = () => {
        if (refreshTimeout) clearTimeout(refreshTimeout);
        refreshTimeout = setTimeout(() => {
          if (document.visibilityState === 'visible') {
            loadAllData(true);
          }
        }, 1500); // Debounce 1.5 detik agar multiple batch rows tidak menyebabkan multiple sync
      };

      const channel = supabase
        .channel('schema-db-changes')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public' },
          (payload) => {
            const table = payload.table;
            if (table === 'products') {
              db.invalidateProductsCache();
              scheduleDebouncedRefresh();
            } else if (table === 'stock_items') {
              db.invalidateStockCache();
              scheduleDebouncedRefresh();
            } else if (table === 'logs') {
              if (payload.eventType === 'DELETE' || payload.eventType === 'UPDATE') {
                db.invalidateLogsCache();
              }
              scheduleDebouncedRefresh();
            } else if (table === 'simple_transactions' || table === 'simple_master_items') {
              db.invalidateSimpleTxCache();
            }
          }
        )
        .subscribe();

      // Interval fallback efisien: 180 detik (3 menit)
      // Realtime push websocket sudah menerima update seketika tanpa perlu polling boros
      const syncInterval = setInterval(() => {
        if (document.visibilityState === 'visible') {
          loadAllData(true);
        }
      }, 180000);

      // Hanya sinkronisasi jika tab browser aktif/fokus dan minimal 60 detik sejak sync terakhir
      let lastFocusSync = Date.now();
      const handleVisibilityOrFocus = () => {
        if (document.visibilityState === 'visible') {
          const now = Date.now();
          if (now - lastFocusSync > 60000) {
            lastFocusSync = now;
            scheduleDebouncedRefresh();
          }
        }
      };

      window.addEventListener('focus', handleVisibilityOrFocus);
      document.addEventListener('visibilitychange', handleVisibilityOrFocus);

      return () => {
        supabase.removeChannel(channel);
        clearInterval(syncInterval);
        if (refreshTimeout) clearTimeout(refreshTimeout);
        window.removeEventListener('focus', handleVisibilityOrFocus);
        document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
      };
    }
  }, [currentUser, loadAllData]);

  const handleLoginSuccess = (user: User) => {
    const sessionData = { user, timestamp: Date.now() };
    localStorage.setItem(SESSION_KEY, JSON.stringify(sessionData));
    setCurrentUser(user);
  };

  const handleLogout = () => {
    if (window.confirm("Keluar dari sistem?")) {
      localStorage.removeItem(SESSION_KEY);
      setCurrentUser(null);
      setActiveTab('dashboard');
    }
  };

  const removeNotification = (id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  };

  const handleRegisterStock = async (items: StockItem[]) => {
    try {
      await db.addStockItems(items);
      await loadAllData(true);
    } catch (error: any) {
      console.error("Gagal registrasi:", error);
      alert(`Gagal registrasi: ${error?.message || 'Koneksi database terganggu'}`);
    }
  };

  const handleInbound = async (items: StockItem[], note: string, isMigration: boolean = false) => {
    if (!currentUser) {
      alert("Sesi login Anda telah berakhir. Silakan login kembali.");
      return;
    }
    if (!items || items.length === 0) return;
    try {
      const logEntries: LogEntry[] = items.map(item => ({
        id: `LOG-IN-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
        type: 'IN',
        stockItemId: item.uniqueId,
        productName: item.productName,
        timestamp: Date.now(),
        note: isMigration ? `Migrasi: ${note || 'Penerimaan'}` : (item.note || note || 'Penerimaan Barang'),
        quantityChange: item.quantity,
        user: currentUser.username
      }));

      await db.addStockItems(items.map(i => ({ ...i, status: ItemStatus.IN_STOCK, note: i.note || note })));
      await db.addLogEntries(logEntries);
      await loadAllData(true);
    } catch (error: any) {
      console.error("Gagal inbound:", error);
      alert(`Gagal inbound: ${error?.message || 'Koneksi terganggu'}`);
      throw error;
    }
  };

  const handleOutbound = async (requests: { item: StockItem, qtyToTake: number, recipient: string, note: string }[]) => {
    if (!currentUser) {
      alert("Sesi login Anda telah berakhir. Silakan login kembali.");
      return;
    }
    if (!requests || requests.length === 0) return;
    try {
      const logEntries: LogEntry[] = requests.map(req => ({
        id: `LOG-OUT-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
        type: 'OUT',
        stockItemId: req.item.uniqueId,
        productName: req.item.productName,
        timestamp: Date.now(),
        recipient: req.recipient,
        note: req.note || 'Pengeluaran Barang',
        quantityChange: -req.qtyToTake,
        user: currentUser.username
      }));
      for (const req of requests) {
        const newQty = req.item.quantity - req.qtyToTake;
        const updatedItem: StockItem = {
          ...req.item,
          quantity: newQty,
          status: newQty <= 0 ? ItemStatus.OUTBOUND : ItemStatus.IN_STOCK
        };
        await db.updateStockItem(updatedItem);
      }
      await db.addLogEntries(logEntries);
      await loadAllData(true);
    } catch (error: any) {
      console.error("Gagal outbound:", error);
      alert(`Gagal outbound: ${error?.message || 'Koneksi terganggu'}`);
      throw error;
    }
  };

  const handleAdjustment = async (item: StockItem, newQty: number, note: string) => {
    if (!currentUser) {
      alert("Sesi login Anda telah berakhir. Silakan login kembali.");
      return;
    }
    try {
      const diff = newQty - item.quantity;
      if (diff === 0) return;
      const logEntry: LogEntry = {
        id: `LOG-ADJ-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
        type: 'ADJUST',
        stockItemId: item.uniqueId,
        productName: item.productName,
        timestamp: Date.now(),
        note: note || 'Audit Stok',
        quantityChange: diff,
        user: currentUser.username
      };
      const updatedItem: StockItem = {
        ...item,
        quantity: newQty,
        status: newQty <= 0 ? ItemStatus.OUTBOUND : ItemStatus.IN_STOCK
      };
      await db.updateStockItem(updatedItem);
      await db.addLogEntries([logEntry]);
      await loadAllData(true);
    } catch (error: any) {
      console.error("Gagal adjustment:", error);
      alert(`Gagal penyesuaian stok: ${error?.message || 'Koneksi terganggu'}`);
    }
  };

  const handleBulkAdjust = async (adjustments: { item: StockItem, newQty: number, note: string }[]) => {
    for (const adj of adjustments) {
      await handleAdjustment(adj.item, adj.newQty, adj.note);
    }
  };

  const navItems = useMemo(() => {
    if (!currentUser) return [];
    const items = [];
    const isFullAccess = currentUser.role === 'SuperAdmin' || currentUser.role === 'Admin' || currentUser.role === 'AdminPPIC' || currentUser.role === 'User' || currentUser.username.toLowerCase() === 'adminppic';
    const isViewer = currentUser.role === 'Viewer';

    if (isFullAccess || isViewer) {
      items.push({ id: 'dashboard', label: 'Beranda', icon: <LayoutDashboard size={16} /> });
      items.push({ id: 'inventory', label: 'Inventaris', icon: <Package size={16} /> });
    }
    if (isFullAccess) {
      items.push({ id: 'sticker', label: 'Stiker', icon: <Tag size={16} /> });
      items.push({ id: 'transactions', label: 'Transaksi', icon: <ArrowLeftRight size={16} /> });
    }
    if (isFullAccess || isViewer) {
      items.push({ id: 'history', label: 'Laporan', icon: <HistoryIcon size={16} /> });
    }
    if (isFullAccess || currentUser.role === 'UserMT') {
      items.push({ id: 'mt', label: 'MT', icon: <Settings size={16} /> });
    }
    if (isFullAccess || currentUser.role === 'UserGA' || currentUser.role === 'UserHRGA') {
      items.push({ id: 'hrga', label: 'HRGA', icon: <Briefcase size={16} /> });
    }
    items.push({ id: 'about', label: 'Tentang', icon: <Info size={16} /> });
    return items;
  }, [currentUser]);

  if (!currentUser) {
    return <Login onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Toast Overlay untuk Notifikasi di dalam Aplikasi */}
      <div className="fixed top-20 right-4 left-4 md:left-auto md:w-96 z-[9999] pointer-events-none flex flex-col gap-3">
        {notifications.map((notif) => (
          <div key={notif.id} className={`pointer-events-auto p-4 rounded-2xl shadow-2xl flex items-start gap-4 animate-in slide-in-from-right-10 duration-300 border ${notif.type === 'EMPTY' || notif.type === 'EXPIRED' ? 'bg-red-600 text-white border-red-500' :
            notif.type === 'CRITICAL' || notif.type === 'EXPIRING_SOON' ? 'bg-amber-500 text-white border-amber-400' :
              'bg-emerald-600 text-white border-emerald-500'
            }`}>
            <div className="bg-white/20 p-2 rounded-xl shrink-0">
              {notif.type === 'EMPTY' || notif.type === 'EXPIRED' ? <AlertOctagon size={24} /> :
                notif.type === 'CRITICAL' || notif.type === 'EXPIRING_SOON' ? <AlertTriangle size={24} /> :
                  <ArrowDownCircle size={24} />}
            </div>
            <div className="flex-1 min-w-0">
              <h4 className="text-[10px] font-black uppercase tracking-widest leading-none opacity-80">{notif.message}</h4>
              <p className="text-[12px] font-black uppercase mt-1 leading-tight truncate">{notif.productName}</p>
              <p className="text-[9px] font-mono opacity-70 mt-1 uppercase">ID: {notif.productId}</p>
            </div>
            <button onClick={() => removeNotification(notif.id)} className="p-1 hover:bg-black/10 rounded-lg transition-colors">
              <X size={18} />
            </button>
          </div>
        ))}
      </div>

      <header className="bg-white border-b border-slate-200 sticky top-0 z-[100] shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="flex items-center">
              <img
                src="logo2.png"
                alt="Logo"
                className="h-10 w-auto object-contain"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
            </div>
            <div className="flex flex-col ml-1">
              <span className="font-black uppercase tracking-tighter text-slate-900 leading-none text-xs md:text-sm">Dry Warehouse</span>
              <span className="text-[8px] md:text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-0.5 leading-none">Sistem Manajemen</span>
              <span className="text-[8px] md:text-[9px] font-black text-red-600 uppercase tracking-widest mt-1">Bounty Segar Indonesia</span>
            </div>
          </div>
          <div className="flex items-center gap-2 md:gap-3">
            <OnlineUsers currentUser={currentUser} />

            {/* Tombol Cepat Mode Gelap / Terang (Dark / Light) */}
            <button
              onClick={() => handleThemeChange(theme === 'dark' ? 'light' : 'dark')}
              title={theme === 'dark' ? 'Beralih ke Mode Terang' : 'Beralih ke Mode Gelap (Gudang Minim Cahaya)'}
              className={`p-2 rounded-xl border transition-all flex items-center justify-center ${theme === 'dark'
                ? 'bg-slate-800 text-amber-400 border-slate-700 hover:bg-slate-700 shadow-sm'
                : 'bg-slate-100 text-slate-600 border-slate-200 hover:text-red-600 hover:bg-slate-200'
                }`}
            >
              {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </button>

            {/* Tombol Menu Pengaturan */}
            <button
              onClick={() => setActiveTab('settings')}
              title="Menu Pengaturan"
              className={`p-2 rounded-xl transition-all border ${activeTab === 'settings'
                ? 'bg-red-50 text-red-600 border-red-200'
                : 'text-slate-400 border-transparent hover:text-slate-700 hover:bg-slate-100'
                }`}
            >
              <Sliders size={18} />
            </button>

            <div className="hidden md:flex flex-col text-right">
              <span className="text-[11px] font-black text-slate-900 uppercase leading-none">{currentUser.username}</span>
              <span className="text-[9px] font-black text-red-500 uppercase tracking-widest mt-0.5">{currentUser.role}</span>
            </div>
            <button onClick={handleLogout} className="p-2 text-slate-400 hover:text-red-600 rounded-xl transition-all" title="Keluar">
              <LogOut size={20} />
            </button>
          </div>
        </div>
        <nav className="max-w-7xl mx-auto px-4 overflow-x-auto no-scrollbar hidden md:block border-t border-slate-50">
          <div className="flex gap-4">
            {navItems.map(item => (
              <button key={item.id} onClick={() => setActiveTab(item.id)} className={`flex items-center gap-2 px-4 py-3 border-b-2 font-black text-[10px] uppercase tracking-widest transition-all ${activeTab === item.id ? 'border-red-600 text-red-600' : 'border-transparent text-slate-400 hover:text-slate-600'}`}>{item.icon}{item.label}</button>
            ))}
          </div>
        </nav>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full p-4 md:p-6 pb-24 md:pb-6 overflow-y-auto">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center h-[50vh] gap-4">
            <RefreshCw className="animate-spin text-red-600" size={32} />
            <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">SINKRONISASI DATABASE...</span>
          </div>
        ) : (
          <div className="animate-in fade-in slide-in-from-bottom-2 duration-500">
            {activeTab === 'dashboard' && <Dashboard products={products} stock={stock} logs={logs} currentUser={currentUser} onRefresh={() => loadAllData(true, true)} />}
            {activeTab === 'inventory' && <Inventory products={products} inventory={stock} logs={logs} currentUser={currentUser} onAdjust={handleAdjustment} onBulkAdjust={handleBulkAdjust} onRefresh={() => loadAllData(true, true)} />}
            {activeTab === 'sticker' && <LabelGenerator products={products} stock={stock} onAddStock={handleRegisterStock} />}
            {activeTab === 'transactions' && <Transactions products={products} stock={stock} onInbound={handleInbound} onOutbound={handleOutbound} onRefresh={() => loadAllData(true, true)} />}
            {activeTab === 'history' && <History logs={logs} products={products} stock={stock} currentUser={currentUser} onRefresh={() => loadAllData(true, true)} onAdjust={handleAdjustment} />}
            {activeTab === 'mt' && <SimpleInventoryModule module="MT" currentUser={currentUser} />}
            {activeTab === 'hrga' && <SimpleInventoryModule module="GA" currentUser={currentUser} />}
            {activeTab === 'about' && <About />}
            {activeTab === 'settings' && (
              <SettingsComponent
                currentUser={currentUser}
                theme={theme}
                onThemeChange={handleThemeChange}
                audioAlertEnabled={audioAlertEnabled}
                onToggleAudioAlert={handleToggleAudioAlert}
                onTestAudio={handleTestAudio}
              />
            )}
          </div>
        )}
      </main>

      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 px-1 py-1 flex justify-around items-center z-[100] shadow-[0_-4px_10px_rgba(0,0,0,0.05)]">
        {navItems.map(item => (
          <button key={item.id} onClick={() => setActiveTab(item.id)} className={`flex flex-col items-center gap-1 p-2 rounded-xl transition-all ${activeTab === item.id ? 'text-red-600' : 'text-slate-400'}`}>
            {item.icon}
            <span className="text-[7px] font-black uppercase tracking-tighter text-center">{item.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
};