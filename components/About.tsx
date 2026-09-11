import React from 'react';
import { Info, ShieldCheck, Tag, Box, Database, Smartphone, History, CheckCircle2 } from 'lucide-react';

const About: React.FC = () => {
  const features = [
    {
      icon: <Tag className="text-red-500" />,
      title: "Pelacakan Unit Unik",
      desc: "Pelacakan granular per batch/unit dengan identitas QR unik untuk setiap barang."
    },
    {
      icon: <ShieldCheck className="text-blue-500" />,
      title: "Operasional Aman",
      desc: "Alur kerja berbasis verifikasi untuk penyesuaian stok dan mutasi barang yang sensitif."
    },
    {
      icon: <Box className="text-amber-500" />,
      title: "Inventaris Pintar",
      desc: "Pemantauan tingkat stok secara real-time dengan peringatan otomatis untuk stok menipis."
    },
    {
      icon: <Database className="text-purple-500" />,
      title: "Data Terpusat",
      desc: "Manajemen Master Data yang kokoh untuk memastikan konsistensi operasional gudang."
    },
    {
      icon: <Smartphone className="text-slate-500" />,
      title: "Pemindai Mobile",
      desc: "Pemindai QR internal yang mendukung mode pemrosesan tunggal maupun batch (banyak sekaligus)."
    },
    {
      icon: <History className="text-emerald-500" />,
      title: "Laporan Akurat",
      desc: "Fitur kartu stok dan rekap mutasi yang disinkronkan langsung dengan saldo inventaris."
    }
  ];

  const updateLogs = [
    {
      version: "v2.1.4",
      date: "11 September 2026",
      items: [
        "Penambahan fitur Projection Stock",
        "Penambahan opsi tema gelap (Dark Mode) pada menu Pengaturan untuk area gudang minim pencahayaan"
      ]
    },
    {
      version: "v2.1.3",
      date: "Juli 2026",
      items: [
        "Menambahkan fitur ekspor Buku Mutasi ke format Excel (XLSX)"
      ]
    },
    {
      version: "v2.1.2",
      date: "Mei 2026",
      items: [
        "Peningkatan Ekspor Excel & PDF pada Monitor Kedaluwarsa",
        "Penambahan Informasi Qty dan Tanggal Kedatangan pada Rekap Kedaluwarsa",
        "Penambahan Laporan Rekap Per Item pada Ekspor Kedaluwarsa",
        "Perbaikan Filter Tab 'Semua' pada Riwayat Transaksi",
        "Fitur Expand (Klik) untuk Deskripsi & Catatan Panjang pada Laporan"
      ]
    },
    {
      version: "v2.1.1",
      date: "Januari 2025",
      items: [
        "Sistem Notifikasi Native Sistem HP (Pop-up Pop-up Sistem)",
        "Notifikasi Real-time Floating Toast In-App",
        "Peringatan Otomatis Stok Habis (Angka 0)",
        "Peringatan Stok Kritis (Dibawah Safety Stock)",
        "Notifikasi Kedatangan Barang Baru (Input Inbound)",
        "Fitur Audio Alert pada sistem notifikasi"
      ]
    },
    {
      version: "v2.1.0",
      date: "Desember 2025",
      items: [
        "Implementasi Modul Baru: Maintenance (MT) & General Affairs (GA)",
        "Fitur Laporan & Log Transaksi Terperinci pada Modul MT/GA",
        "Export Laporan Mutasi ke format PDF & Excel",
        "Sistem Perhitungan Stok Awal Otomatis pada Modul Transisi",
        "Peningkatan Akurasi Dashboard & Notifikasi Stok Menipis",
        "Perbaikan UI Input Transaksi pada Perangkat Mobile"
      ]
    },
    {
      version: "v2.0.0",
      date: "Desember 2025",
      items: [
        "Rilis Stabil Resmi (Official Stable Release)",
        "Fitur Kartu Stok & Rekap Mutasi Akurat",
        "Integrasi Detail Batch, Supplier & Kedaluwarsa",
        "Optimasi UI/UX & Performa Pemindai QR",
        "Bahasa Indonesia Sebagai Bahasa Utama"
      ]
    },
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-500 pb-10">
      <div className="bg-white p-10 rounded-[2.5rem] shadow-sm border border-slate-200 text-center relative overflow-hidden">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-red-600/5 blur-[100px] rounded-full"></div>
        <div className="relative z-10">
          <div className="w-24 h-24 bg-gradient-to-br from-red-600 to-red-800 text-white rounded-[2.5rem] flex items-center justify-center mx-auto shadow-2xl mb-8">
            <Info size={44} />
          </div>
          <h1 className="text-3xl font-black text-slate-900 uppercase tracking-tighter">Dry Warehouse System</h1>
          <p className="text-xs font-black text-red-600 uppercase tracking-[0.2em] mt-3 bg-red-50 px-6 py-1.5 rounded-full inline-block border border-red-100">Rilis v2.1.4</p>
          <div className="mt-8 max-w-2xl mx-auto text-slate-500 font-bold text-sm leading-relaxed uppercase tracking-wider">
            Sistem manajemen gudang modern yang dioptimalkan untuk performa, akurasi stok, dan kemudahan operasional BOUNTY SEGAR INDONESIA.
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {features.map((f, idx) => (
          <div key={idx} className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm hover:shadow-md transition-shadow group">
            <div className="w-10 h-10 bg-slate-50 rounded-2xl flex items-center justify-center mb-4 group-hover:bg-slate-100 transition-colors">
              {f.icon}
            </div>
            <h3 className="font-black text-slate-800 uppercase text-xs tracking-tight mb-2">{f.title}</h3>
            <p className="text-[10px] text-slate-400 font-bold leading-relaxed uppercase">{f.desc}</p>
          </div>
        ))}
      </div>

      <div className="bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm">
        <div className="flex items-center gap-3 mb-8">
          <div className="bg-slate-900 p-2.5 rounded-xl text-white shadow-lg"><History size={20} /></div>
          <h2 className="text-lg font-black text-slate-900 uppercase tracking-tighter leading-none">Riwayat Pembaruan</h2>
        </div>
        <div className="space-y-6">
          {updateLogs.map((log, idx) => (
            <div key={idx} className="relative pl-8 border-l-2 border-slate-100 pb-2">
              <div className={`absolute -left-[9px] top-0 w-4 h-4 rounded-full bg-white border-4 ${idx === 0 ? 'border-red-600' : 'border-slate-300'}`}></div>
              <div className="flex items-center gap-3 mb-2">
                <span className={`text-[12px] font-black uppercase ${idx === 0 ? 'text-red-600' : 'text-slate-900'}`}>{log.version}</span>
                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">{log.date}</span>
              </div>
              <ul className="space-y-1.5">
                {log.items.map((item, i) => (
                  <li key={i} className="flex items-center gap-2 text-[10px] font-bold text-slate-600 uppercase tracking-tight">
                    <CheckCircle2 size={12} className="text-emerald-500 shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-col items-center py-6 opacity-60">
        <p className="text-center text-[8px] font-black text-slate-400 uppercase tracking-[0.2em]">
          Dikembangkan oleh
        </p>
        <p className="text-center text-[9px] font-black text-slate-600 uppercase tracking-widest mt-1">
          Habib Dwi Prajoto • Raffly Pasya Trenadhi
        </p>
      </div>
    </div>
  );
};

export default About;