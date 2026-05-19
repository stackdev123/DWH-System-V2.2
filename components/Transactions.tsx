
import React, { useState } from 'react';
import { Product, StockItem } from '../types';
import Inbound from './Inbound';
import Outbound from './Outbound';
import { ArrowDownLeft, ArrowUpRight, ArrowLeftRight } from 'lucide-react';

interface TransactionsProps {
  products: Product[];
  stock: StockItem[];
  onInbound: (items: StockItem[], note: string) => Promise<void>;
  // Updated onOutbound signature to accept a single array of requests, as used by the Outbound component and App.tsx
  onOutbound: (requests: any[]) => Promise<void>;
  onRefresh: () => void;
}

const Transactions: React.FC<TransactionsProps> = ({ 
  products, 
  stock, 
  onInbound, 
  onOutbound, 
  onRefresh 
}) => {
  const [subTab, setSubTab] = useState<'in' | 'out'>('in');

  return (
    <div className="space-y-4 animate-in fade-in duration-500">
      {/* Header & Sub-tab Switcher */}
      <div className="bg-white p-4 rounded-3xl border border-slate-200 shadow-sm flex flex-col md:flex-row justify-between items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="bg-slate-900 p-2 rounded-xl text-white shadow-lg">
            <ArrowLeftRight size={20} />
          </div>
          <div>
            <h2 className="text-base font-black text-slate-800 uppercase tracking-tighter leading-none">Menu Transaksi</h2>
            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-1">Kelola barang masuk dan keluar gudang</p>
          </div>
        </div>

        <div className="flex bg-slate-100 p-1 rounded-2xl border border-slate-200 w-full md:w-auto">
          <button 
            onClick={() => setSubTab('in')} 
            className={`flex-1 md:w-40 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-all ${subTab === 'in' ? 'bg-white text-red-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
          >
            <ArrowDownLeft size={14} /> BARANG MASUK
          </button>
          <button 
            onClick={() => setSubTab('out')} 
            className={`flex-1 md:w-40 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-all ${subTab === 'out' ? 'bg-white text-red-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
          >
            <ArrowUpRight size={14} /> BARANG KELUAR
          </button>
        </div>
      </div>

      {/* Content Area */}
      <div className="animate-in slide-in-from-bottom-2 duration-300">
        {subTab === 'in' ? (
          <Inbound 
            products={products} 
            stock={stock} 
            onInbound={onInbound} 
            onRefresh={onRefresh} 
          />
        ) : (
          <Outbound 
            products={products} 
            stock={stock} 
            onOutbound={onOutbound} 
            onRefresh={onRefresh} 
          />
        )}
      </div>
    </div>
  );
};

export default Transactions;
