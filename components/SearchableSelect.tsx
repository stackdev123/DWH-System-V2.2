
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Search, ChevronDown, Check, X } from 'lucide-react';

interface Option {
  id: string;
  name: string;
  unit?: string;
  category?: string;
}

interface SearchableSelectProps {
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
}

const SearchableSelect: React.FC<SearchableSelectProps> = ({ options = [], value, onChange, placeholder = "Pilih...", label }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedOption = useMemo(() => (options || []).find(o => o.id === value), [options, value]);

  const filteredOptions = useMemo(() => {
    const s = (search || '').toLowerCase();
    const safeOptions = Array.isArray(options) ? options : [];
    return safeOptions.filter(o => {
      const name = (o.name || '').toLowerCase();
      const id = (o.id || '').toLowerCase();
      return name.includes(s) || id.includes(s);
    });
  }, [options, search]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  return (
    <div className="relative w-full" ref={containerRef}>
      {label && <label className="block text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">{label}</label>}
      
      <div 
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full px-3 py-2 border rounded-xl bg-white cursor-pointer flex justify-between items-center transition-all ${isOpen ? 'border-red-500 ring-1 ring-red-50' : 'border-slate-300 hover:border-slate-400'}`}
      >
        <div className="flex flex-col min-w-0">
          {selectedOption ? (
            <>
              <span className="font-bold text-slate-800 text-[11px] leading-none truncate uppercase">{selectedOption.name}</span>
              <span className="text-[7px] font-mono text-slate-400 mt-0.5">{selectedOption.id}</span>
            </>
          ) : (
            <span className="text-slate-400 text-[10px]">{placeholder}</span>
          )}
        </div>
        <ChevronDown size={14} className={`text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </div>

      {isOpen && (
        <div className="absolute z-[200] mt-1 w-full bg-white rounded-xl shadow-xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-100">
          <div className="p-2 border-b border-slate-50 bg-slate-50">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400" />
              <input
                ref={inputRef}
                type="text"
                className="w-full pl-7 pr-2 py-1.5 bg-white border border-slate-100 rounded-lg text-[10px] outline-none"
                placeholder="Cari..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          </div>
          
          <div className="max-h-48 overflow-y-auto custom-scrollbar">
            {filteredOptions.length > 0 ? (
              filteredOptions.map((option) => (
                <div
                  key={option.id}
                  onClick={() => {
                    onChange(option.id);
                    setIsOpen(false);
                    setSearch('');
                  }}
                  className={`px-3 py-2 cursor-pointer flex justify-between items-center hover:bg-red-50 transition-colors ${value === option.id ? 'bg-red-50' : ''}`}
                >
                  <div className="flex flex-col min-w-0">
                    <span className={`text-[10px] font-bold ${value === option.id ? 'text-red-700' : 'text-slate-700'} truncate uppercase`}>{option.name}</span>
                    <span className="text-[7px] text-slate-400 font-mono">[{option.id}]</span>
                  </div>
                  {value === option.id && <Check className="w-3 h-3 text-red-600" />}
                </div>
              ))
            ) : (
              <div className="p-4 text-center text-slate-300 italic text-[9px]">Tidak ada.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default SearchableSelect;
