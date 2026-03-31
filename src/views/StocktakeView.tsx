import React, { useState, useRef, useEffect } from 'react';
import { Camera, Search, CheckCircle2, ArrowRight, Package, AlertCircle, ClipboardList, Plus, Loader2, RefreshCw, Truck } from 'lucide-react';
import { toast } from 'sonner';
import { Scanner } from '../components/Scanner';
import { Product, BarcodeAlias, StocktakeRecord, AccessLevel } from '../types';
import { GoogleGenAI, Type } from "@google/genai";

interface Props {
  products: Product[];
  aliases: BarcodeAlias[];
  addProduct: (p: Product) => void;
  addAlias: (a: BarcodeAlias) => void;
  addRecord: (r: StocktakeRecord) => void;
  saveRecordToScript: (r: StocktakeRecord) => Promise<boolean>;
  isSyncing: boolean;
  userEmail: string | null;
  accessLevel: AccessLevel;
}

type Step = 'LANDING' | 'SCAN' | 'COUNT' | 'ERROR' | 'SUCCESS' | 'COMPLETED';

export function StocktakeView({ products, aliases, addProduct, addAlias, addRecord, saveRecordToScript, isSyncing, userEmail, accessLevel }: Props) {
  const [step, setStep] = useState<Step>(() => {
    const isCompleted = localStorage.getItem('inv_stocktake_completed') === 'true';
    return isCompleted ? 'COMPLETED' : 'LANDING';
  });
  const [barcode, setBarcode] = useState('');
  const [product, setProduct] = useState<Product | null>(null);
  const [showScanner, setShowScanner] = useState(false);
  const [physicalQty, setPhysicalQty] = useState('');
  const [mode, setMode] = useState<'Stocktake' | 'Receiving'>('Stocktake');
  const [isNewProduct, setIsNewProduct] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [piecesPerBox, setPiecesPerBox] = useState('1');
  const [unitType, setUnitType] = useState<'Piece' | 'Box'>('Piece');
  const [isSaving, setIsSaving] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus input for bluetooth scanners
  useEffect(() => {
    if (step === 'SCAN' && !showScanner && inputRef.current) {
      inputRef.current.focus();
    }
  }, [step, showScanner]);

  const handleScan = (scannedBarcode: string) => {
    if (step === 'COMPLETED') return;
    if (!scannedBarcode.trim()) return;
    
    setBarcode(scannedBarcode);
    setShowScanner(false);
    
    // Check primary barcode first
    let prodByBarcode = products.find(p => p.barcode === scannedBarcode);
    
    // Then check barcode1
    if (!prodByBarcode) {
      prodByBarcode = products.find(p => p.barcode1 === scannedBarcode);
    }
    
    // Then check barcode2
    if (!prodByBarcode) {
      prodByBarcode = products.find(p => p.barcode2 === scannedBarcode);
    }
    
    // Then check barcode3
    if (!prodByBarcode) {
      prodByBarcode = products.find(p => p.barcode3 === scannedBarcode);
    }

    if (prodByBarcode) {
      setProduct(prodByBarcode);
      setStep('COUNT');
      return;
    }
    
    // If none of the barcodes match, return an error
    setStep('ERROR');
  };

  const handleTextScan = (scannedText: string) => {
    if (step === 'COMPLETED') return;
    if (!scannedText.trim()) return;
    
    setShowScanner(false);
    
    // Simple logic: check if the scanned text contains any of the barcodes or SKUs
    const lowerText = scannedText.toLowerCase();
    
    const prodByText = products.find(p => 
      lowerText.includes(p.barcode.toLowerCase()) ||
      (p.barcode1 && lowerText.includes(p.barcode1.toLowerCase())) ||
      (p.barcode2 && lowerText.includes(p.barcode2.toLowerCase())) ||
      (p.barcode3 && lowerText.includes(p.barcode3.toLowerCase())) ||
      lowerText.includes(p.sku.toLowerCase())
    );

    if (prodByText) {
      setBarcode(prodByText.barcode); // Use primary barcode for record keeping
      setProduct(prodByText);
      setIsNewProduct(false);
      setStep('COUNT');
      return;
    }
    
    // If no match found in text
    setBarcode(scannedText);
    setIsNewProduct(false);
    setStep('ERROR');
  };

  const handleAddNewProduct = async () => {
    setIsAnalyzing(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Analyze this barcode/SKU: "${barcode}". 
        Suggest product details for a stocktake app. 
        Return JSON format with: name, category, description, variantName, sku, barcode, quantity (default to 0).`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING },
              category: { type: Type.STRING },
              description: { type: Type.STRING },
              variantName: { type: Type.STRING },
              sku: { type: Type.STRING },
              barcode: { type: Type.STRING },
              quantity: { type: Type.NUMBER }
            },
            required: ["name", "category", "sku", "barcode"]
          }
        }
      });

      const suggestedProduct = JSON.parse(response.text);
      setProduct({
        ...suggestedProduct,
        barcode: barcode, // Ensure we use the scanned barcode
        sku: suggestedProduct.sku || barcode,
        quantity: 0
      });
      setIsNewProduct(true);
      setStep('COUNT');
    } catch (error) {
      console.error('AI Analysis failed:', error);
      toast.error('AI analysis failed. Please enter details manually.');
      // Fallback to manual entry with basic info
      setProduct({
        name: 'New Product',
        category: 'Miscellaneous',
        description: '',
        variantName: '',
        sku: barcode,
        barcode: barcode,
        quantity: 0
      });
      setIsNewProduct(true);
      setStep('COUNT');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleScan(barcode);
  };

  const handleCountSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!product || !physicalQty) return;
    if (unitType === 'Box' && !piecesPerBox) return;

    setIsSaving(true);
    
    let qty = 0;
    if (unitType === 'Piece') {
      qty = parseInt(physicalQty, 10);
    } else {
      qty = parseInt(physicalQty, 10) * parseInt(piecesPerBox, 10);
    }

    const variance = qty - product.quantity;
    let variancePercentage = 0;
    if (product.quantity !== 0) {
      variancePercentage = (variance / product.quantity);
    } else if (variance > 0) {
      variancePercentage = 1.0; // +100%
    }

    const productName = product.variantName && product.name.includes(product.variantName) 
      ? product.name.replace(product.variantName, '').trim() 
      : product.name;

    const record: StocktakeRecord = {
      id: crypto.randomUUID(),
      sku: product.sku,
      category: product.category,
      productName: productName,
      variant: product.variantName,
      description: product.description,
      barcode: product.barcode,
      barcodeScanned: barcode,
      quantity: product.quantity,
      originalQuantity: product.quantity,
      physicalQty: qty,
      physicalCount: qty,
      unitType: unitType,
      variance: variance,
      variancePercent: Math.round(variancePercentage * 100),
      variancePercentage: variancePercentage,
      timestamp: new Date().toISOString(),
      user: userEmail || 'Anonymous',
      status: isNewProduct ? 'Pending' : 'Pending', // User requested 'Pending' for new products
      mode: mode,
      isNewProduct: isNewProduct,
    };

    await addRecord(record);
    await saveRecordToScript(record);
    setIsSaving(false);
    setStep('SUCCESS');
    setTimeout(() => {
      reset();
    }, 1500);
  };

  const reset = () => {
    const isCompleted = localStorage.getItem('inv_stocktake_completed') === 'true';
    if (isCompleted) {
      setStep('COMPLETED');
    } else {
      setStep('SCAN');
    }
    setBarcode('');
    setProduct(null);
    setPhysicalQty('');
    setUnitType('Piece');
    setPiecesPerBox('');
  };

  return (
    <div className="flex flex-col h-full max-w-md mx-auto w-full p-4">
      {showScanner && (
        <Scanner onScan={handleScan} onTextScan={handleTextScan} onClose={() => setShowScanner(false)} />
      )}

      {step === 'LANDING' && (
        <div className="flex flex-col items-center justify-center h-full space-y-8 animate-in fade-in zoom-in duration-300">
          <div className="text-center space-y-4">
            <div className={`p-6 rounded-full inline-block mb-4 transition-colors ${mode === 'Stocktake' ? 'bg-blue-100 text-blue-600' : 'bg-green-100 text-green-600'}`}>
              {mode === 'Stocktake' ? <ClipboardList size={64} /> : <Truck size={64} />}
            </div>
            <h2 className="text-3xl font-bold text-gray-800">Inventory Operations</h2>
            <p className="text-gray-500 max-w-xs mx-auto">
              Select a mode and start scanning to manage your inventory.
            </p>
          </div>

          <div className="w-full space-y-6">
            <div className="flex bg-gray-100 p-1 rounded-2xl">
              <button
                onClick={() => setMode('Stocktake')}
                className={`flex-1 py-3 rounded-xl font-semibold flex items-center justify-center gap-2 transition-all ${
                  mode === 'Stocktake' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                <ClipboardList size={20} />
                Stocktaking
              </button>
              <button
                onClick={() => setMode('Receiving')}
                className={`flex-1 py-3 rounded-xl font-semibold flex items-center justify-center gap-2 transition-all ${
                  mode === 'Receiving' ? 'bg-white text-green-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                <Truck size={20} />
                Receiving
              </button>
            </div>

            <button
              onClick={() => setStep('SCAN')}
              className={`w-full py-4 text-white rounded-2xl font-semibold text-xl flex items-center justify-center space-x-2 shadow-lg transition-all active:scale-95 ${
                mode === 'Stocktake' ? 'bg-blue-600 hover:bg-blue-700 shadow-blue-200' : 'bg-green-600 hover:bg-green-700 shadow-green-200'
              }`}
            >
              <span>Start Scanning</span>
            </button>
          </div>
        </div>
      )}

      {step === 'SCAN' && (
        <div className="flex flex-col items-center justify-center h-full space-y-8 animate-in fade-in zoom-in duration-300 overflow-y-auto pb-32">
          <div className="text-center space-y-2">
            <div className={`p-4 rounded-full inline-block mb-2 ${mode === 'Stocktake' ? 'bg-blue-100 text-blue-600' : 'bg-green-100 text-green-600'}`}>
              {mode === 'Stocktake' ? <Package size={48} /> : <Truck size={48} />}
            </div>
            <h2 className="text-2xl font-bold text-gray-800">{mode} Mode</h2>
            <p className="text-gray-500">Scan a barcode to begin {mode.toLowerCase()}</p>
          </div>

          <div className="w-full space-y-3">
            <button
              onClick={() => setShowScanner(true)}
              className={`w-full py-4 text-white rounded-2xl font-semibold text-lg flex items-center justify-center space-x-2 shadow-lg transition-all active:scale-95 ${
                mode === 'Stocktake' ? 'bg-blue-600 hover:bg-blue-700 shadow-blue-200' : 'bg-green-600 hover:bg-green-700 shadow-green-200'
              }`}
            >
              <Camera size={24} />
              <span>Open Camera Scanner</span>
            </button>
          </div>

          <div className="w-full relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-200"></div>
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-2 bg-gray-50 text-gray-500">Or use Bluetooth Scanner</span>
            </div>
          </div>

          <form onSubmit={handleManualSubmit} className="w-full">
            <div className="relative flex items-center gap-2">
              <div className="relative flex-1">
                <input
                  ref={inputRef}
                  type="text"
                  value={barcode}
                  onChange={(e) => setBarcode(e.target.value)}
                  placeholder="Scan or type barcode..."
                  className={`w-full pl-12 pr-4 py-4 bg-white border-2 rounded-2xl focus:ring-0 text-lg transition-colors ${
                    mode === 'Stocktake' ? 'border-gray-200 focus:border-blue-500' : 'border-gray-200 focus:border-green-500'
                  }`}
                  autoComplete="off"
                />
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={24} />
              </div>
              <button
                type="submit"
                disabled={!barcode.trim()}
                className={`py-4 px-6 text-white rounded-2xl font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  mode === 'Stocktake' ? 'bg-blue-600 hover:bg-blue-700' : 'bg-green-600 hover:bg-green-700'
                }`}
              >
                Search
              </button>
            </div>
          </form>

          <div className="mt-auto pt-8 w-full space-y-3">
            <button
              onClick={() => setStep('LANDING')}
              className="w-full py-4 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-2xl font-semibold text-lg flex items-center justify-center space-x-2 transition-all active:scale-95"
            >
              <ArrowRight size={24} className="rotate-180" />
              <span>Back to Menu</span>
            </button>
          </div>
        </div>
      )}

      {step === 'COMPLETED' && (
        <div className="flex flex-col items-center justify-center h-full space-y-8 animate-in fade-in zoom-in duration-300">
          <div className="text-center space-y-4">
            <div className="bg-green-100 text-green-600 p-6 rounded-full inline-block mb-4">
              <CheckCircle2 size={64} />
            </div>
            <h2 className="text-3xl font-bold text-gray-800">Stocktake Completed</h2>
            <p className="text-gray-500 max-w-xs mx-auto">
              You have completed the stocktake. Scanning is now disabled. Please wait for the auditor to sign off.
            </p>
          </div>
          <div className="bg-blue-50 p-4 rounded-xl border border-blue-100 w-full">
            <p className="text-blue-800 text-sm font-medium text-center">
              The auditor has been notified of your completion.
            </p>
          </div>
        </div>
      )}

      {step === 'COUNT' && product && (
        <div className="flex flex-col h-full animate-in slide-in-from-right-4 duration-300 overflow-y-auto pb-32">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-gray-800">Record Count</h2>
            <button onClick={reset} className="text-sm text-gray-500 hover:text-gray-800 font-medium">Cancel</button>
          </div>

          <div className={`rounded-2xl p-6 shadow-lg mb-6 text-white ${
            mode === 'Stocktake' ? 'bg-blue-600 shadow-blue-100' : 'bg-green-600 shadow-green-100'
          }`}>
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-lg font-bold text-white">{product.name}</h3>
                {product.variantName && (
                  <p className="text-sm font-medium text-white/80 mt-1">Variant: {product.variantName}</p>
                )}
                <p className="text-sm text-white/60 font-mono mt-1">SKU: {product.sku}</p>
              </div>
              <span className={`text-xs px-2 py-1 rounded font-bold uppercase tracking-wider ${
                mode === 'Stocktake' ? 'bg-blue-500 text-white' : 'bg-green-500 text-white'
              }`}>
                {product.category}
              </span>
            </div>

            <form onSubmit={handleCountSubmit} className="space-y-4">
              <div className="flex bg-white/10 p-1 rounded-lg mb-4">
                <button
                  type="button"
                  className={`flex-1 py-2 rounded-md text-sm font-bold transition-colors ${unitType === 'Piece' ? 'bg-white text-gray-900 shadow' : 'text-white/60 hover:text-white'}`}
                  onClick={() => setUnitType('Piece')}
                >
                  Piece
                </button>
                <button
                  type="button"
                  className={`flex-1 py-2 rounded-md text-sm font-bold transition-colors ${unitType === 'Box' ? 'bg-white text-gray-900 shadow' : 'text-white/60 hover:text-white'}`}
                  onClick={() => setUnitType('Box')}
                >
                  Box
                </button>
              </div>

              {unitType === 'Piece' ? (
                <div>
                  <label className="block text-sm font-bold text-white/70 uppercase tracking-wider mb-2">
                    {mode === 'Stocktake' ? 'Physical Count (Pieces)' : 'Qty Received'}
                  </label>
                  <input
                    type="number"
                    required
                    min="0"
                    autoFocus
                    value={physicalQty}
                    onChange={(e) => setPhysicalQty(e.target.value)}
                    className="w-full text-center text-5xl font-bold py-6 bg-white/10 border-2 border-white/20 rounded-2xl focus:border-white focus:bg-white/20 focus:outline-none text-white transition-all placeholder:text-white/20"
                    placeholder="0"
                  />
                </div>
              ) : (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-bold text-white/70 uppercase tracking-wider mb-2">
                      {mode === 'Stocktake' ? 'Number of Boxes' : 'Qty Received'}
                    </label>
                    <input
                      type="number"
                      required
                      min="0"
                      autoFocus
                      value={physicalQty}
                      onChange={(e) => setPhysicalQty(e.target.value)}
                      className="w-full text-center text-5xl font-bold py-6 bg-white/10 border-2 border-white/20 rounded-2xl focus:border-white focus:bg-white/20 focus:outline-none text-white transition-all placeholder:text-white/20"
                      placeholder="0"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-white/70 uppercase tracking-wider mb-2">Pieces per Box</label>
                    <input
                      type="number"
                      required
                      min="1"
                      value={piecesPerBox}
                      onChange={(e) => setPiecesPerBox(e.target.value)}
                      className="w-full text-center text-3xl font-bold py-4 bg-white/10 border-2 border-white/20 rounded-xl focus:border-white focus:bg-white/20 focus:outline-none text-white transition-all placeholder:text-white/20"
                      placeholder="0"
                    />
                  </div>
                  <div className={`p-3 rounded-lg text-center font-bold ${
                    mode === 'Stocktake' ? 'bg-blue-500 text-white' : 'bg-green-500 text-white'
                  }`}>
                    Total: {(parseInt(physicalQty || '0', 10) * parseInt(piecesPerBox || '0', 10)).toLocaleString()} pieces
                  </div>
                </div>
              )}

              <button
                type="submit"
                disabled={isSaving}
                className={`w-full py-4 rounded-2xl font-bold text-xl flex items-center justify-center space-x-2 shadow-lg transition-all active:scale-95 disabled:opacity-70 mt-6 ${
                  mode === 'Stocktake' ? 'bg-white text-blue-600 hover:bg-blue-50' : 'bg-white text-green-600 hover:bg-green-50'
                }`}
              >
                <span>{isSaving ? 'Saving...' : mode === 'Stocktake' ? 'Submit Count' : 'Submit Received'}</span>
                {!isSaving && <ArrowRight size={20} />}
              </button>
            </form>
          </div>
        </div>
      )}

      {step === 'ERROR' && (
        <div className="flex flex-col h-full animate-in slide-in-from-bottom-4 duration-300 overflow-y-auto pb-32">
          <div className="text-center mb-8 mt-4">
            <div className="bg-red-100 text-red-600 p-4 rounded-full inline-block mb-4">
              <AlertCircle size={32} />
            </div>
            <h2 className="text-2xl font-bold text-gray-800 mb-2">Barcode Not Found</h2>
            <p className="text-gray-600 font-mono bg-gray-100 py-1 px-3 rounded inline-block">{barcode}</p>
            <p className="text-red-500 mt-4 text-sm font-medium">This barcode does not match any product in the database.</p>
          </div>

          <div className="space-y-3">
            <button
              onClick={handleAddNewProduct}
              disabled={isAnalyzing}
              className={`w-full py-4 text-white rounded-2xl font-semibold text-lg flex items-center justify-center space-x-2 shadow-lg transition-all active:scale-95 disabled:opacity-50 ${
                mode === 'Stocktake' ? 'bg-blue-600 hover:bg-blue-700 shadow-blue-200' : 'bg-green-600 hover:bg-green-700 shadow-green-200'
              }`}
            >
              {isAnalyzing ? (
                <>
                  <Loader2 size={24} className="animate-spin" />
                  <span>AI Analyzing...</span>
                </>
              ) : (
                <>
                  <Plus size={24} />
                  <span>Add New Product</span>
                </>
              )}
            </button>
            <button
              onClick={reset}
              className="w-full py-4 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-2xl font-semibold text-lg transition-all active:scale-95"
            >
              Try Again
            </button>
          </div>
        </div>
      )}

      {step === 'SUCCESS' && (
        <div className="flex flex-col items-center justify-center h-full animate-in zoom-in duration-300">
          <div className="bg-green-100 text-green-600 p-6 rounded-full mb-6">
            <CheckCircle2 size={64} />
          </div>
          <h2 className="text-2xl font-bold text-gray-800 mb-2">Count Recorded</h2>
          <p className="text-gray-500 text-center">
            {product?.name} {product?.variantName ? `(${product.variantName})` : ''} updated successfully.
          </p>
        </div>
      )}
    </div>
  );
}
