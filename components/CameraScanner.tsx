
import React, { useEffect, useRef, useState, useMemo } from 'react';
import { X, AlertCircle, Camera, Trash2, Package, Clock, Scan, ListChecks, CheckCircle2 } from 'lucide-react';
import { StockItem, Product } from '../types';

interface CameraScannerProps {
  onScan: (result: string | string[]) => void; 
  onClose: () => void;
  existingIds?: string[]; 
  stockItems?: StockItem[]; 
  products?: Product[]; 
}

const CameraScanner: React.FC<CameraScannerProps> = ({ onScan, onClose, stockItems = [], products = [] }) => {
  const scannerRef = useRef<any>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [batchMode, setBatchMode] = useState(false);
  
  const [lastDetectedCandidate, setLastDetectedCandidate] = useState<string | null>(null);
  const [sessionBuffer, setSessionBuffer] = useState<string[]>([]);
  const [isReviewing, setIsReviewing] = useState(false);
  const [flashTrigger, setFlashTrigger] = useState(false);
  
  const [captureHistory, setCaptureHistory] = useState<Record<string, number>>({});
  const [currentTime, setCurrentTime] = useState(Date.now());

  // Ukuran Box Scan Tetap
  const SCAN_SIZE = 240;

  const sanitizeId = (id: string) => id.trim().replace(/[^a-zA-Z0-9-&]/g, '').toUpperCase();

  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(Date.now()), 200);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => { initScanner(); }, 400);
    return () => { stopScanner(); };
  }, []);

  const playBeep = (type: 'success' | 'error' = 'success') => {
    try {
        const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); 
        gain.connect(ctx.destination);
        osc.frequency.setValueAtTime(type === 'success' ? 1000 : 200, ctx.currentTime);
        gain.gain.setValueAtTime(0.05, ctx.currentTime);
        osc.start(); 
        osc.stop(ctx.currentTime + (type === 'success' ? 0.05 : 0.2));
    } catch (e) {}
  };

  const stopScanner = async () => {
    if (scannerRef.current) {
      try { 
        if (scannerRef.current.isScanning) await scannerRef.current.stop(); 
        scannerRef.current.clear(); 
      } catch (err) {}
      scannerRef.current = null;
    }
  };

  const handleDetected = (decodedText: string) => {
    if (isReviewing) return;
    const scannableCode = sanitizeId(decodedText);
    if (!scannableCode) return;

    const isValid = products.some(p => sanitizeId(p.id) === scannableCode) || 
                    stockItems.some(s => sanitizeId(s.uniqueId) === scannableCode);

    if (!isValid) return;

    if (scannableCode !== lastDetectedCandidate) {
      setLastDetectedCandidate(scannableCode);
      playBeep('success');
    }
  };

  const cooldownStatus = useMemo(() => {
    if (!lastDetectedCandidate || !batchMode) return { active: false, remaining: 0 };
    const lastCapture = captureHistory[lastDetectedCandidate] || 0;
    const elapsed = currentTime - lastCapture;
    const remaining = Math.max(0, 1000 - elapsed); 
    return { active: remaining > 0, remaining: Math.ceil(remaining / 1000) };
  }, [lastDetectedCandidate, captureHistory, currentTime, batchMode]);

  const confirmCapture = () => {
    if (!lastDetectedCandidate) return;
    
    if (batchMode && cooldownStatus.active) {
      playBeep('error');
      setErrorMsg(`Tunggu 1 detik`);
      setTimeout(() => setErrorMsg(null), 800);
      return;
    }

    setFlashTrigger(true);
    setTimeout(() => setFlashTrigger(false), 80);

    if (batchMode) {
      setSessionBuffer(prev => [lastDetectedCandidate!, ...prev]);
      setCaptureHistory(prev => ({ ...prev, [lastDetectedCandidate!]: Date.now() }));
      setLastDetectedCandidate(null); 
    } else {
      onScan(lastDetectedCandidate);
      setTimeout(() => {
        stopScanner();
        onClose();
      }, 150);
    }
  };

  const initScanner = async () => {
    const Html5Qrcode = (window as any).Html5Qrcode;
    if (!Html5Qrcode) return;
    try {
      await stopScanner();
      const html5QrCode = new Html5Qrcode("reader");
      scannerRef.current = html5QrCode;
      
      await html5QrCode.start(
        { facingMode: "environment" }, 
        { 
          fps: 30, 
          // HAPUS qrbox agar library melakukan scan di seluruh frame video
          // Hal ini mencegah library merender kotak default-nya yang bertabrakan dengan UI kustom
          aspectRatio: 1.0
        }, 
        (text: string) => handleDetected(text), 
        () => {}
      );
    } catch (err: any) { 
      setErrorMsg("Kamera tidak dapat diakses."); 
    }
  };

  const metadata = useMemo(() => {
    if (!lastDetectedCandidate) return null;
    const productMatch = products.find(p => sanitizeId(p.id) === lastDetectedCandidate);
    const itemMatch = stockItems.find(s => sanitizeId(s.uniqueId) === lastDetectedCandidate);
    
    return {
      id: lastDetectedCandidate,
      name: productMatch ? productMatch.name : (itemMatch ? itemMatch.productName : "ID: " + lastDetectedCandidate),
      type: productMatch ? "MASTER" : (itemMatch ? "UNIT" : "UNKNOWN")
    };
  }, [lastDetectedCandidate, products, stockItems]);

  return (
    <div className="fixed inset-0 z-[99999] bg-black flex flex-col text-white overflow-hidden font-sans select-none">
      <div className={`absolute inset-0 bg-white z-[99999] pointer-events-none transition-opacity duration-75 ${flashTrigger ? 'opacity-80' : 'opacity-0'}`} />
      
      {/* Header Controls */}
      <div className="absolute top-0 left-0 right-0 p-4 z-[110] flex justify-between items-center bg-gradient-to-b from-black/80 to-transparent">
        {!isReviewing && (
          <>
            <button onClick={onClose} className="p-2.5 bg-white/10 backdrop-blur-2xl rounded-full border border-white/20 active:scale-90 transition-all">
              <X className="w-5 h-5" />
            </button>
            <div className="flex bg-black/40 backdrop-blur-2xl p-1 rounded-xl border border-white/10 shadow-lg">
                <button onClick={() => { setBatchMode(false); setLastDetectedCandidate(null); }} className={`px-4 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all ${!batchMode ? "bg-white text-slate-900" : "text-white/40"}`}>AUTO</button>
                <button onClick={() => { setBatchMode(true); setLastDetectedCandidate(null); }} className={`px-4 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all ${batchMode ? "bg-red-600 text-white" : "text-white/40"}`}>BATCH</button>
            </div>
            {batchMode && sessionBuffer.length > 0 ? (
              <button onClick={() => setIsReviewing(true)} className="relative p-2.5 bg-white/10 backdrop-blur-2xl rounded-full border border-white/20 active:scale-90">
                <ListChecks className="w-5 h-5 text-emerald-400" />
                <span className="absolute -top-1 -right-1 bg-emerald-500 text-white text-[8px] font-black h-4 w-4 rounded-full flex items-center justify-center border border-black">{sessionBuffer.length}</span>
              </button>
            ) : <div className="w-10" />}
          </>
        )}
      </div>

      {isReviewing ? (
        <div className="fixed inset-0 z-[120] bg-slate-950 p-6 flex flex-col pt-20 animate-in slide-in-from-right duration-300">
          <div className="flex justify-between items-center mb-6">
            <div>
              <h3 className="text-2xl font-black uppercase tracking-tighter">Review Sesi</h3>
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mt-1">{sessionBuffer.length} items siap dikirim</p>
            </div>
            <button onClick={() => setIsReviewing(false)} className="p-2 bg-white/5 rounded-full text-slate-400"><X /></button>
          </div>
          
          <div className="flex-1 overflow-y-auto space-y-2 custom-scrollbar mb-6 pr-1">
            {sessionBuffer.map((id, idx) => (
                <div key={`${id}-${idx}`} className="bg-white/5 border border-white/10 p-4 rounded-2xl flex justify-between items-center animate-in slide-in-from-right-4">
                  <div className="flex flex-col min-w-0 pr-4">
                    <span className="text-xs font-black font-mono tracking-tight text-white truncate">{id}</span>
                    <span className="text-[8px] font-black text-slate-500 uppercase">Unit Scan #{sessionBuffer.length - idx}</span>
                  </div>
                  <button onClick={() => setSessionBuffer(prev => prev.filter((_, i) => i !== idx))} className="text-red-500/50 hover:text-red-500 p-2"><Trash2 size={18} /></button>
                </div>
            ))}
          </div>
          
          <div className="flex flex-col gap-3 pb-8">
             <button 
               onClick={() => { onScan(sessionBuffer); onClose(); }} 
               className="py-4 bg-red-600 text-white rounded-[1.2rem] font-black uppercase text-[11px] tracking-[0.2em] shadow-2xl shadow-red-900/40 active:scale-95 transition-all flex items-center justify-center gap-3"
             >
               <CheckCircle2 size={20} /> COMMIT DATA
             </button>
             <button onClick={() => setIsReviewing(false)} className="py-3 text-slate-500 font-black uppercase text-[9px] tracking-widest flex items-center justify-center gap-2 hover:text-white transition-colors">
               LANJUTKAN SCAN
             </button>
          </div>
        </div>
      ) : (
        <div className="flex-1 relative flex flex-col">
           {/* Camera Preview Area */}
           <div id="reader" className="w-full flex-1 relative bg-black [&_video]:w-full [&_video]:h-full [&_video]:object-cover [&_canvas]:hidden"></div>
           
           {/* Viewfinder - Perfectly Adjusted Upwards */}
           <div className="absolute inset-0 pointer-events-none z-[50]">
              <div 
                className={`relative rounded-3xl transition-all duration-300 shadow-[0_0_0_100vmax_rgba(0,0,0,0.65)] ${lastDetectedCandidate ? 'border-[3px] border-emerald-500' : 'border-2 border-white/20'}`}
                style={{ 
                  width: `${SCAN_SIZE}px`, 
                  height: `${SCAN_SIZE}px`,
                  position: 'absolute',
                  top: '35%', // Disesuaikan lebih ke atas lagi sesuai feedback
                  left: '50%',
                  transform: 'translate(-50%, -50%)'
                }}
              >
                 {/* Precision Corner Brackets */}
                 <div className="absolute -top-[2px] -left-[2px] w-8 h-8 border-t-4 border-l-4 border-white rounded-tl-2xl"></div>
                 <div className="absolute -top-[2px] -right-[2px] w-8 h-8 border-t-4 border-r-4 border-white rounded-tr-2xl"></div>
                 <div className="absolute -bottom-[2px] -left-[2px] w-8 h-8 border-b-4 border-l-4 border-white rounded-bl-2xl"></div>
                 <div className="absolute -bottom-[2px] -right-[2px] w-8 h-8 border-b-4 border-r-4 border-white rounded-br-2xl"></div>
                 
                 {/* Scanning Laser */}
                 {!lastDetectedCandidate && (
                   <div className="absolute top-1 left-2 right-2 h-[3px] bg-red-500 shadow-[0_0_15px_rgba(239,68,68,1)] animate-laser-move"></div>
                 )}
              </div>
           </div>
           
           {/* Dynamic Action Island - Refined and Always Visible */}
           <div className="h-[200px] bg-slate-950 border-t border-white/10 p-6 flex flex-col items-center justify-center z-[100] relative">
              {lastDetectedCandidate && metadata ? (
                <div className="w-full flex flex-col items-center animate-in slide-in-from-bottom-6 duration-400">
                  <div className="w-full bg-white/5 border border-white/10 p-4 rounded-[1.5rem] mb-5 flex items-center gap-4 relative">
                    <div className="w-12 h-12 bg-red-600/20 text-red-500 rounded-2xl flex items-center justify-center border border-red-500/20 shrink-0">
                      <Package size={24} />
                    </div>
                    <div className="flex-1 min-w-0 text-left">
                      <span className="text-[8px] font-black text-red-500 uppercase tracking-[0.2em] block mb-1">{metadata.type} TERDETEKSI</span>
                      <h4 className="text-[13px] font-black uppercase truncate text-white leading-none mb-1">{metadata.name}</h4>
                      <p className="text-[10px] font-mono text-slate-500 truncate">{metadata.id}</p>
                    </div>
                    <button onClick={() => setLastDetectedCandidate(null)} className="p-2 text-slate-600 hover:text-white active:scale-90"><X size={20}/></button>
                  </div>
                  
                  <button 
                    onClick={confirmCapture} 
                    disabled={batchMode && cooldownStatus.active}
                    className={`w-full py-4 rounded-[1.2rem] font-black uppercase text-[11px] tracking-[0.2em] transition-all flex items-center justify-center gap-3 shadow-2xl active:scale-95 ${
                      batchMode && cooldownStatus.active 
                      ? 'bg-slate-800 text-slate-600 cursor-not-allowed' 
                      : 'bg-red-600 text-white shadow-red-900/40'
                    }`}
                  >
                    {batchMode ? (
                      cooldownStatus.active ? (
                        <><Clock size={18} className="animate-spin" /> {cooldownStatus.remaining}S</>
                      ) : (
                        <><Scan size={20} /> TAMBAH KE BATCH</>
                      )
                    ) : (
                      <><CheckCircle2 size={20} /> KONFIRMASI UNIT</>
                    )}
                  </button>
                </div>
              ) : (
                <div className="text-center flex flex-col items-center gap-3 animate-pulse">
                  <div className="w-12 h-12 rounded-full border-2 border-dashed border-white/20 flex items-center justify-center"><Camera size={24} className="text-white/20" /></div>
                  <p className="text-[9px] font-black uppercase tracking-[0.4em] text-white/30">ALIGN CODE IN CENTER</p>
                </div>
              )}
           </div>

           {errorMsg && (
             <div className="absolute top-1/2 left-0 right-0 z-[110] flex justify-center px-6 -translate-y-1/2">
                <div className="bg-red-600 text-white px-8 py-4 rounded-2xl flex items-center gap-3 shadow-[0_0_40px_rgba(220,38,38,0.5)] animate-bounce">
                    <AlertCircle size={22} />
                    <span className="font-black text-[11px] uppercase tracking-widest">{errorMsg}</span>
                </div>
             </div>
           )}
        </div>
      )}

      <style>{`
        /* Sembunyikan elemen UI bawaan library html5-qrcode agar tidak tumpang tindih */
        div[id^="reader__"] {
          display: none !important;
        }
        
        #reader__shading-top, #reader__shading-bottom, #reader__shading-left, #reader__shading-right,
        #reader__border-top, #reader__border-bottom, #reader__border-left, #reader__border-right {
          display: none !important;
        }
        
        @keyframes laser-move {
          0% { top: 5%; opacity: 0; }
          20% { opacity: 1; }
          80% { opacity: 1; }
          100% { top: 95%; opacity: 0; }
        }
        .animate-laser-move { animation: laser-move 1.8s linear infinite; }
        .py-4\.5 { padding-top: 1.125rem; padding-bottom: 1.125rem; }
      `}</style>
    </div>
  );
};

export default CameraScanner;
