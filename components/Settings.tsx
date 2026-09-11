import React, { useState } from 'react';
import { User } from '../types.ts';
import {
    Sliders,
    Moon,
    Sun,
    Monitor,
    Volume2,
    VolumeX,
    ShieldCheck,
    User as UserIcon,
    Database,
    HardDrive,
    CheckCircle2,
    RefreshCw,
    Sparkles,
    Info
} from 'lucide-react';

export type ThemeMode = 'light' | 'dark' | 'system';

interface SettingsProps {
    currentUser: User;
    theme: ThemeMode;
    onThemeChange: (newTheme: ThemeMode) => void;
    audioAlertEnabled?: boolean;
    onToggleAudioAlert?: (enabled: boolean) => void;
    onTestAudio?: () => void;
}

const Settings: React.FC<SettingsProps> = ({
    currentUser,
    theme,
    onThemeChange,
    audioAlertEnabled = true,
    onToggleAudioAlert,
    onTestAudio
}) => {
    const [clearingCache, setClearingCache] = useState(false);
    const [clearedNotice, setClearedNotice] = useState(false);

    // Periksa apakah peran pengguna memiliki akses Projection Stock
    const hasPpicAccess = currentUser.role === 'AdminPPIC' || currentUser.username.toLowerCase() === 'adminppic' || currentUser.role === 'SuperAdmin';

    const handleClearCache = () => {
        if (window.confirm("Bersihkan cache lokal preferensi tampilan dan data sementara browser? Data stok di server tetap aman.")) {
            setClearingCache(true);
            setTimeout(() => {
                try {
                    // Bersihkan data non-kritis
                    localStorage.removeItem('bsi_dwh_packaging_pr_plan');
                } catch (e) {
                    console.error(e);
                }
                setClearingCache(false);
                setClearedNotice(true);
                setTimeout(() => setClearedNotice(false), 3000);
            }, 500);
        }
    };

    return (
        <div className="space-y-6 max-w-4xl mx-auto pb-10 animate-in fade-in duration-300">
            {/* HEADER SECTION */}
            <div className="bg-white p-6 md:p-8 rounded-[2.5rem] shadow-sm border border-slate-200 relative overflow-hidden">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-10">
                    <div className="flex items-center gap-4">
                        <div className="w-14 h-14 bg-red-600 text-white rounded-2xl flex items-center justify-center shadow-lg shadow-red-600/20">
                            <Sliders size={28} />
                        </div>
                        <div>
                            <h1 className="text-xl md:text-2xl font-black text-slate-900 uppercase tracking-tight">
                                Pengaturan Sistem
                            </h1>
                            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mt-1">
                                Preferensi Tampilan & Konfigurasi Operasional Gudang
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2 self-start md:self-auto bg-slate-100 px-3 py-1.5 rounded-full border border-slate-200">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                        <span className="text-[9px] font-black uppercase tracking-widest text-slate-600">
                            Versi v2.1.4
                        </span>
                    </div>
                </div>
            </div>

            {/* 1. TEMA & PENCAHAYAAN GUDANG (CORE FEATURE) */}
            <div className="bg-white p-6 md:p-8 rounded-[2.5rem] shadow-sm border border-slate-200">
                <div className="flex items-start justify-between gap-4 mb-6">
                    <div className="flex items-center gap-3">
                        <div className="p-2.5 bg-amber-500/10 text-amber-600 rounded-xl">
                            <Moon size={22} />
                        </div>
                        <div>
                            <h2 className="text-sm md:text-base font-black text-slate-900 uppercase tracking-tight flex items-center gap-2">
                                Mode Tampilan & Pencahayaan
                                <span className="text-[8px] bg-red-50 text-red-600 font-black px-2 py-0.5 rounded-full border border-red-100 uppercase tracking-widest">
                                    Gudang
                                </span>
                            </h2>
                            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mt-0.5">
                                Optimasi visual untuk kenyamanan mata dan penghematan daya di area pencahayaan minim
                            </p>
                        </div>
                    </div>
                </div>

                {/* Pilihan Kartu Tema */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {/* OPSI 1: MODE TERANG */}
                    <button
                        onClick={() => onThemeChange('light')}
                        className={`p-5 rounded-2xl border text-left transition-all relative flex flex-col justify-between group ${theme === 'light'
                                ? 'bg-red-50/20 border-red-500 ring-2 ring-red-500/20 shadow-md'
                                : 'bg-slate-50 hover:bg-slate-100 border-slate-200'
                            }`}
                    >
                        <div>
                            <div className="flex items-center justify-between mb-3">
                                <div className={`p-2 rounded-xl ${theme === 'light' ? 'bg-amber-500 text-white shadow-md shadow-amber-500/30' : 'bg-slate-200 text-slate-600'}`}>
                                    <Sun size={20} />
                                </div>
                                {theme === 'light' && (
                                    <span className="flex items-center gap-1 text-[8px] font-black uppercase tracking-widest bg-red-600 text-white px-2 py-0.5 rounded-full">
                                        <CheckCircle2 size={10} /> Aktif
                                    </span>
                                )}
                            </div>
                            <h3 className="text-xs font-black text-slate-900 uppercase tracking-tight">
                                Mode Terang (Light)
                            </h3>
                            <p className="text-[10px] text-slate-500 font-medium mt-1 leading-relaxed">
                                Tampilan terang bersih. Ideal untuk ruangan kantor atau area gudang dengan pencahayaan lampu maksimal di siang hari.
                            </p>
                        </div>

                        {/* Mini preview card */}
                        <div className="mt-4 p-2 bg-white rounded-xl border border-slate-200 shadow-sm">
                            <div className="h-1.5 w-12 bg-slate-200 rounded mb-1.5"></div>
                            <div className="h-2.5 w-20 bg-slate-900 rounded"></div>
                        </div>
                    </button>

                    {/* OPSI 2: MODE GELAP (REKOMENDASI GUDANG) */}
                    <button
                        onClick={() => onThemeChange('dark')}
                        className={`p-5 rounded-2xl border text-left transition-all relative flex flex-col justify-between group ${theme === 'dark'
                                ? 'bg-slate-900 text-white border-blue-500 ring-2 ring-blue-500/30 shadow-xl'
                                : 'bg-slate-50 hover:bg-slate-100 border-slate-200'
                            }`}
                    >
                        <div>
                            <div className="flex items-center justify-between mb-3">
                                <div className={`p-2 rounded-xl ${theme === 'dark' ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30' : 'bg-slate-200 text-slate-600'}`}>
                                    <Moon size={20} />
                                </div>
                                {theme === 'dark' ? (
                                    <span className="flex items-center gap-1 text-[8px] font-black uppercase tracking-widest bg-blue-600 text-white px-2 py-0.5 rounded-full">
                                        <CheckCircle2 size={10} /> Aktif
                                    </span>
                                ) : (
                                    <span className="text-[7px] font-black uppercase tracking-widest bg-blue-50 text-blue-600 border border-blue-200 px-1.5 py-0.5 rounded-md">
                                        Rekomendasi
                                    </span>
                                )}
                            </div>
                            <h3 className={`text-xs font-black uppercase tracking-tight ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>
                                Mode Gelap (Dark Mode)
                            </h3>
                            <p className={`text-[10px] font-medium mt-1 leading-relaxed ${theme === 'dark' ? 'text-slate-300' : 'text-slate-500'}`}>
                                Latar gelap kontras tinggi. Sangat nyaman untuk mata di area gudang minim cahaya, lorong rak tinggi, atau shift malam.
                            </p>
                        </div>

                        {/* Mini preview card */}
                        <div className="mt-4 p-2 bg-[#0b0f19] rounded-xl border border-slate-800 shadow-sm">
                            <div className="h-1.5 w-12 bg-slate-700 rounded mb-1.5"></div>
                            <div className="h-2.5 w-20 bg-blue-400 rounded"></div>
                        </div>
                    </button>

                    {/* OPSI 3: OTOMATIS (IKUTI SISTEM) */}
                    <button
                        onClick={() => onThemeChange('system')}
                        className={`p-5 rounded-2xl border text-left transition-all relative flex flex-col justify-between group ${theme === 'system'
                                ? 'bg-red-50/20 border-red-500 ring-2 ring-red-500/20 shadow-md'
                                : 'bg-slate-50 hover:bg-slate-100 border-slate-200'
                            }`}
                    >
                        <div>
                            <div className="flex items-center justify-between mb-3">
                                <div className={`p-2 rounded-xl ${theme === 'system' ? 'bg-purple-600 text-white shadow-md shadow-purple-600/30' : 'bg-slate-200 text-slate-600'}`}>
                                    <Monitor size={20} />
                                </div>
                                {theme === 'system' && (
                                    <span className="flex items-center gap-1 text-[8px] font-black uppercase tracking-widest bg-red-600 text-white px-2 py-0.5 rounded-full">
                                        <CheckCircle2 size={10} /> Aktif
                                    </span>
                                )}
                            </div>
                            <h3 className="text-xs font-black text-slate-900 uppercase tracking-tight">
                                Ikuti Sistem (Auto)
                            </h3>
                            <p className="text-[10px] text-slate-500 font-medium mt-1 leading-relaxed">
                                Menyesuaikan otomatis dengan preferensi tema perangkat atau sistem operasi Android/iOS/Windows Anda.
                            </p>
                        </div>

                        {/* Mini preview card */}
                        <div className="mt-4 p-2 bg-gradient-to-r from-white to-[#0b0f19] rounded-xl border border-slate-300 shadow-sm flex items-center justify-between">
                            <div className="h-2 w-8 bg-slate-900 rounded"></div>
                            <div className="h-2 w-8 bg-blue-400 rounded"></div>
                        </div>
                    </button>
                </div>

                {/* Tip Kenyamanan Gudang */}
                <div className="mt-6 p-4 rounded-2xl bg-blue-50/60 border border-blue-200 flex items-start gap-3">
                    <div className="p-1.5 bg-blue-600 text-white rounded-lg shrink-0 mt-0.5">
                        <Sparkles size={14} />
                    </div>
                    <div className="text-[10px] text-slate-700 leading-relaxed">
                        <strong className="font-black text-blue-900 uppercase block mb-0.5">
                            Kenyamanan Operator Gudang:
                        </strong>
                        Saat melakukan inspeksi stok di malam hari atau area penyimpanan dengan pencahayaan temaram, gunakan <strong>Mode Gelap</strong> untuk mencegah silau layar pemindai QR dan menghemat daya baterai perangkat scanner mobile.
                    </div>
                </div>
            </div>

            {/* 2. PREFERENSI SUARA & NOTIFIKASI GUDANG */}
            <div className="bg-white p-6 md:p-8 rounded-[2.5rem] shadow-sm border border-slate-200">
                <div className="flex items-center gap-3 mb-6">
                    <div className="p-2.5 bg-red-600/10 text-red-600 rounded-xl">
                        <Volume2 size={22} />
                    </div>
                    <div>
                        <h2 className="text-sm md:text-base font-black text-slate-900 uppercase tracking-tight">
                            Peringatan Audio & Notifikasi
                        </h2>
                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mt-0.5">
                            Pengaturan sinyal suara peringatan saat stok kosong, kritis, atau scan berhasil
                        </p>
                    </div>
                </div>

                <div className="space-y-4">
                    <div className="flex items-center justify-between p-4 rounded-2xl bg-slate-50 border border-slate-100">
                        <div className="flex items-center gap-3">
                            <div className={`p-2 rounded-xl ${audioAlertEnabled ? 'bg-emerald-500 text-white' : 'bg-slate-300 text-slate-600'}`}>
                                {audioAlertEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />}
                            </div>
                            <div>
                                <span className="text-xs font-black text-slate-900 uppercase block">
                                    Efek Suara Peringatan (Audio Alert)
                                </span>
                                <span className="text-[10px] text-slate-500 font-medium block">
                                    Memutar bunyi peringatan saat ada notifikasi stok habis, stok kritis, atau mutasi baru.
                                </span>
                            </div>
                        </div>

                        <div className="flex items-center gap-3">
                            {onTestAudio && audioAlertEnabled && (
                                <button
                                    onClick={onTestAudio}
                                    className="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl text-[9px] font-black uppercase tracking-wider transition-all"
                                >
                                    Uji Suara
                                </button>
                            )}
                            {onToggleAudioAlert && (
                                <button
                                    onClick={() => onToggleAudioAlert(!audioAlertEnabled)}
                                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${audioAlertEnabled ? 'bg-emerald-600' : 'bg-slate-300'
                                        }`}
                                >
                                    <span
                                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${audioAlertEnabled ? 'translate-x-6' : 'translate-x-1'
                                            }`}
                                    />
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* 3. PROFIL PENGGUNA & HAK AKSES */}
            <div className="bg-white p-6 md:p-8 rounded-[2.5rem] shadow-sm border border-slate-200">
                <div className="flex items-center gap-3 mb-6">
                    <div className="p-2.5 bg-purple-600/10 text-purple-600 rounded-xl">
                        <UserIcon size={22} />
                    </div>
                    <div>
                        <h2 className="text-sm md:text-base font-black text-slate-900 uppercase tracking-tight">
                            Profil & Hak Akses Pengguna
                        </h2>
                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mt-0.5">
                            Identitas sesi saat ini dan batasan modul sistem
                        </p>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100 flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-slate-900 text-white flex items-center justify-center font-black uppercase text-sm">
                            {currentUser.username.slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                            <span className="text-[8px] font-bold text-slate-400 uppercase tracking-wider block">Username</span>
                            <span className="text-xs font-black text-slate-900 uppercase">{currentUser.username}</span>
                        </div>
                    </div>

                    <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100 flex items-center gap-3">
                        <div className="p-2.5 rounded-xl bg-red-50 text-red-600 border border-red-100">
                            <ShieldCheck size={20} />
                        </div>
                        <div>
                            <span className="text-[8px] font-bold text-slate-400 uppercase tracking-wider block">Peran / Hak Akses</span>
                            <span className="text-xs font-black text-red-600 uppercase">{currentUser.role}</span>
                        </div>
                    </div>
                </div>

                {/* Status Akses Projection Stock */}
                <div className="mt-4 p-4 rounded-2xl bg-slate-50 border border-slate-100 flex items-center justify-between">
                    <div>
                        <span className="text-xs font-black text-slate-800 uppercase block">
                            Akses Modul Proyeksi Stok (PPIC)
                        </span>
                        <span className="text-[9px] text-slate-500 font-medium">
                            {hasPpicAccess
                                ? 'Akun Anda memiliki hak akses penuh ke modul Projection Stock & Perencanaan PR.'
                                : 'Akses terbatas khusus untuk AdminPPIC. Akun Admin biasa tidak dapat melihat modul ini.'}
                        </span>
                    </div>
                    <span className={`text-[9px] font-black uppercase px-2.5 py-1 rounded-full ${hasPpicAccess ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'
                        }`}>
                        {hasPpicAccess ? 'Diizinkan' : 'Dibatasi'}
                    </span>
                </div>
            </div>

            {/* 4. PENYIMPANAN LOKAL & SINKRONISASI */}
            <div className="bg-white p-6 md:p-8 rounded-[2.5rem] shadow-sm border border-slate-200">
                <div className="flex items-center gap-3 mb-6">
                    <div className="p-2.5 bg-emerald-600/10 text-emerald-600 rounded-xl">
                        <HardDrive size={22} />
                    </div>
                    <div>
                        <h2 className="text-sm md:text-base font-black text-slate-900 uppercase tracking-tight">
                            Penyimpanan Lokal & Data Offline
                        </h2>
                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mt-0.5">
                            Manajemen cache browser dan sinkronisasi real-time
                        </p>
                    </div>
                </div>

                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 p-4 rounded-2xl bg-slate-50 border border-slate-100">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-slate-200 text-slate-600 rounded-xl">
                            <Database size={18} />
                        </div>
                        <div>
                            <span className="text-xs font-black text-slate-900 uppercase block">
                                Cache Rencana PR & Tampilan
                            </span>
                            <span className="text-[10px] text-slate-500 font-medium block">
                                Reset data sementara tersimpan pada peramban ini jika tampilan terasa lambat.
                            </span>
                        </div>
                    </div>

                    <button
                        onClick={handleClearCache}
                        disabled={clearingCache}
                        className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-[10px] font-black uppercase tracking-wider transition-all flex items-center justify-center gap-2 self-start sm:self-auto shrink-0"
                    >
                        <RefreshCw size={14} className={clearingCache ? 'animate-spin' : ''} />
                        {clearingCache ? 'Membersihkan...' : 'Bersihkan Cache'}
                    </button>
                </div>

                {clearedNotice && (
                    <div className="mt-3 p-3 bg-emerald-50 text-emerald-800 text-[10px] font-bold rounded-xl border border-emerald-200 flex items-center gap-2 animate-in fade-in">
                        <CheckCircle2 size={14} className="text-emerald-600" />
                        Cache browser berhasil dibersihkan. Pengaturan tampilan tetap tersimpan.
                    </div>
                )}
            </div>
        </div>
    );
};

export default Settings;
