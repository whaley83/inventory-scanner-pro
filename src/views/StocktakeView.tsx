import React, { useState, useRef, useEffect } from 'react';
import { Camera, Search, CheckCircle2, ArrowRight, Package, AlertCircle, ClipboardList } from 'lucide-react';
import { Scanner } from '../components/Scanner';
import { Product, BarcodeAlias, StocktakeRecord } from '../types';

interface Props {
  products: Product[];
  aliases: BarcodeAlias[];
  addProduct: (p: Product) => void;
  addAlias: (a: BarcodeAlias) => void;
  addRecord: (r: StocktakeRecord) => void;
}

type Step = 'LANDING' | 'SCAN' | 'COUNT' | 'ERROR' | 'SUCCESS';

export function StocktakeView({ products, aliases, addProduct, addAlias, addRecord }: Props) {
  const [step, setStep] = useState<Step>('LANDING');
  const [barcode, setBarcode] = useState('');
  const [product, setProduct] = useState<Product | null>(null);
  const [showScanner, setShowScanner] = useState(false);
  const [physicalQty, setPhysicalQty] = useState('');

  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus input for bluetooth scanners
  useEffect(() => {
    if (step === 'SCAN' && !showScanner && inputRef.current) {
      inputRef.current.focus();
    }
  }, [step, showScanner]);

  const handleScan = (scannedBarcode: string) => {
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
      setStep('COUNT');
      return;
    }
    
    // If no match found in text
    setBarcode('Text Scan Failed');
    setStep('ERROR');
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleScan(barcode);
  };

  const [isSaving, setIsSaving] = useState(false);
  const [unitType, setUnitType] = useState<'Piece' | 'Box'>('Piece');
  const [piecesPerBox, setPiecesPerBox] = useState('');

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
    let variancePercent = 0;
    if (product.quantity === 0) {
      variancePercent = qty > 0 ? 100 : 0;
    } else {
      variancePercent = Math.round((variance / product.quantity) * 1000) / 10;
    }

    const record: StocktakeRecord = {
      id: crypto.randomUUID(),
      sku: product.sku,
      variantName: product.variantName,
      barcodeScanned: barcode,
      quantity: product.quantity,
      physicalQty: qty,
      unitType: unitType,
      variance: variance,
      variancePercent: variancePercent,
      timestamp: new Date().toISOString(),
      user: 'Current User', // Mock user
      status: 'Pending',
    };

    await addRecord(record);
    setIsSaving(false);
    setStep('SUCCESS');
    setTimeout(() => {
      reset();
    }, 1500);
  };

  const reset = () => {
    setStep('SCAN');
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
            <div className="bg-blue-100 text-blue-600 p-6 rounded-full inline-block mb-4">
              <ClipboardList size={64} />
            </div>
            <h2 className="text-3xl font-bold text-gray-800">Ready to Count?</h2>
            <p className="text-gray-500 max-w-xs mx-auto">
              Start a new stocktake session to begin scanning and counting your inventory.
            </p>
          </div>
          <button
            onClick={() => setStep('SCAN')}
            className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-semibold text-xl flex items-center justify-center space-x-2 shadow-lg shadow-blue-200 transition-all active:scale-95"
          >
            <span>Start Stocktake</span>
          </button>
        </div>
      )}

      {step === 'SCAN' && (
        <div className="flex flex-col items-center justify-center h-full space-y-8 animate-in fade-in zoom-in duration-300">
          <div className="text-center space-y-2">
            <div className="bg-blue-100 text-blue-600 p-4 rounded-full inline-block mb-2">
              <Package size={48} />
            </div>
            <h2 className="text-2xl font-bold text-gray-800">Stocktake Mode</h2>
            <p className="text-gray-500">Scan a barcode to begin counting</p>
          </div>

          <button
            onClick={() => setShowScanner(true)}
            className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-semibold text-lg flex items-center justify-center space-x-2 shadow-lg shadow-blue-200 transition-all active:scale-95"
          >
            <Camera size={24} />
            <span>Open Camera Scanner</span>
          </button>

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
                  className="w-full pl-12 pr-4 py-4 bg-white border-2 border-gray-200 rounded-2xl focus:border-blue-500 focus:ring-0 text-lg transition-colors"
                  autoComplete="off"
                />
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={24} />
              </div>
              <button
                type="submit"
                disabled={!barcode.trim()}
                className="py-4 px-6 bg-gray-900 hover:bg-gray-800 text-white rounded-2xl font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Search
              </button>
            </div>
          </form>

          <div className="mt-auto pt-8 w-full">
            <button
              onClick={() => setStep('LANDING')}
              className="w-full py-4 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-2xl font-semibold text-lg flex items-center justify-center space-x-2 transition-all active:scale-95"
            >
              <CheckCircle2 size={24} />
              <span>Done Stocktaking</span>
            </button>
          </div>
        </div>
      )}

      {step === 'COUNT' && product && (
        <div className="flex flex-col h-full animate-in slide-in-from-right-4 duration-300">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-gray-800">Record Count</h2>
            <button onClick={reset} className="text-sm text-gray-500 hover:text-gray-800 font-medium">Cancel</button>
          </div>

          <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 mb-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-lg font-bold text-gray-900">{product.name}</h3>
                {product.variantName && (
                  <p className="text-sm font-medium text-gray-700 mt-1">Variant: {product.variantName}</p>
                )}
                <p className="text-sm text-gray-500 font-mono mt-1">SKU: {product.sku}</p>
              </div>
              <span className="bg-gray-100 text-gray-600 text-xs px-2 py-1 rounded font-medium">
                {product.category}
              </span>
            </div>
            
            <div className="flex items-center justify-between py-3 border-t border-b border-gray-50 mb-4">
              <span className="text-gray-600">Quantity</span>
              <span className="text-xl font-semibold text-gray-900">{product.quantity}</span>
            </div>

            <form onSubmit={handleCountSubmit} className="space-y-4">
              <div className="flex bg-gray-100 p-1 rounded-lg mb-4">
                <button
                  type="button"
                  className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${unitType === 'Piece' ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
                  onClick={() => setUnitType('Piece')}
                >
                  Piece
                </button>
                <button
                  type="button"
                  className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${unitType === 'Box' ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
                  onClick={() => setUnitType('Box')}
                >
                  Box
                </button>
              </div>

              {unitType === 'Piece' ? (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Physical Count (Pieces)</label>
                  <input
                    type="number"
                    required
                    min="0"
                    autoFocus
                    value={physicalQty}
                    onChange={(e) => setPhysicalQty(e.target.value)}
                    className="w-full text-center text-3xl font-bold py-4 bg-gray-50 border-2 border-gray-200 rounded-xl focus:border-blue-500 focus:bg-white transition-colors"
                    placeholder="0"
                  />
                </div>
              ) : (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Number of Boxes</label>
                    <input
                      type="number"
                      required
                      min="0"
                      autoFocus
                      value={physicalQty}
                      onChange={(e) => setPhysicalQty(e.target.value)}
                      className="w-full text-center text-3xl font-bold py-4 bg-gray-50 border-2 border-gray-200 rounded-xl focus:border-blue-500 focus:bg-white transition-colors"
                      placeholder="0"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Pieces per Box</label>
                    <input
                      type="number"
                      required
                      min="1"
                      value={piecesPerBox}
                      onChange={(e) => setPiecesPerBox(e.target.value)}
                      className="w-full text-center text-3xl font-bold py-4 bg-gray-50 border-2 border-gray-200 rounded-xl focus:border-blue-500 focus:bg-white transition-colors"
                      placeholder="0"
                    />
                  </div>
                  <div className="bg-blue-50 text-blue-800 p-3 rounded-lg text-center font-medium">
                    Total: {(parseInt(physicalQty || '0', 10) * parseInt(piecesPerBox || '0', 10)).toLocaleString()} pieces
                  </div>
                </div>
              )}

              <button
                type="submit"
                disabled={isSaving}
                className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold text-lg flex items-center justify-center space-x-2 shadow-md transition-all active:scale-95 disabled:opacity-70 mt-6"
              >
                <span>{isSaving ? 'Saving...' : 'Submit Count'}</span>
                {!isSaving && <ArrowRight size={20} />}
              </button>
            </form>
          </div>
        </div>
      )}

      {step === 'ERROR' && (
        <div className="flex flex-col h-full animate-in slide-in-from-bottom-4 duration-300">
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
              onClick={reset}
              className="w-full py-4 bg-gray-900 hover:bg-gray-800 text-white rounded-xl font-semibold flex items-center justify-center space-x-2 transition-all"
            >
              <span>Try Again</span>
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
