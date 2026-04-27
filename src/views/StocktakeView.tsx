import React, { useState, useRef, useEffect } from 'react';
import { Camera, Search, CheckCircle2, ArrowRight, Package, AlertCircle, ClipboardList, Plus, Loader2, RefreshCw, Truck, Upload, MapPin, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { Scanner } from '../components/Scanner';
import { Product, BarcodeAlias, StocktakeRecord, AccessLevel } from '../types';
import { GoogleGenAI } from "@google/genai";

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
  externalProductAction?: {
    product: Product;
    mode: 'Stocktake' | 'Receiving';
  } | null;
  onClearExternalAction?: () => void;
}

type Step = 'LANDING' | 'SCAN' | 'COUNT' | 'NEW_PRODUCT' | 'ERROR' | 'SUCCESS' | 'COMPLETED';

export function StocktakeView({ 
  products, 
  aliases, 
  addProduct, 
  addAlias, 
  addRecord, 
  saveRecordToScript, 
  isSyncing, 
  userEmail, 
  accessLevel,
  externalProductAction,
  onClearExternalAction
}: Props) {
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
  const [isFromImage, setIsFromImage] = useState(false);
  const [stores, setStores] = useState<string[]>([]);
  const [selectedStore, setSelectedStore] = useState<string>(() => localStorage.getItem('inv_selected_store') || '');

  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch stores from permissions
  useEffect(() => {
    const fetchStores = async () => {
      try {
        const res = await fetch(`/api/auth/permissions?email=${userEmail || ''}`);
        if (res.ok) {
          const data = await res.json();
          console.log('Permissions data:', data);
          if (data.stores && Array.isArray(data.stores)) {
            setStores(data.stores);
          } else if (data.permissions && Array.isArray(data.permissions)) {
            const uniqueStores = Array.from(new Set(data.permissions.map((p: any) => p.store).filter(Boolean))) as string[];
            setStores(uniqueStores);
          } else if (Array.isArray(data)) {
            const uniqueStores = Array.from(new Set(data.map((p: any) => p.store || p).filter(Boolean))) as string[];
            setStores(uniqueStores);
          }
        }
      } catch (error) {
        console.error('Failed to fetch stores:', error);
      }
    };
    fetchStores();
  }, [userEmail]);

  // Save selected store to localStorage
  useEffect(() => {
    if (selectedStore) {
      localStorage.setItem('inv_selected_store', selectedStore);
    }
  }, [selectedStore]);

  // Auto-focus input for bluetooth scanners
  useEffect(() => {
    if (step === 'SCAN' && !showScanner && inputRef.current) {
      inputRef.current.focus();
    }
  }, [step, showScanner]);

  // Handle external product action (from Products tab)
  useEffect(() => {
    if (externalProductAction) {
      const { product, mode } = externalProductAction;
      setProduct(product);
      setBarcode(product.barcode);
      setMode(mode);
      setStep('COUNT');
      setShowScanner(false);
      setIsNewProduct(false);
      
      // Clear the action so it doesn't trigger again
      if (onClearExternalAction) {
        onClearExternalAction();
      }
    }
  }, [externalProductAction, onClearExternalAction]);

  const handleAIIdentify = async (data: any) => {
    // If AI failed to provide basic info, we still try to proceed to NEW_PRODUCT if possible
    const productName = data?.productName || '';
    const variant = data?.variant || '';
    const extractedKeywords = data?.keywords || [];
    const extractedBarcode = data?.barcode || '';

    // Advanced lookup logic
    let matchedProduct: Product | null = null;

    // 1. Try barcode match if AI found one
    if (extractedBarcode) {
      matchedProduct = products.find(p => 
        p.barcode === extractedBarcode || 
        p.barcode1 === extractedBarcode || 
        p.barcode2 === extractedBarcode || 
        p.barcode3 === extractedBarcode
      ) || null;
    }

    // 2. Try Exact Name + Variant match
    if (!matchedProduct && productName && variant) {
      matchedProduct = products.find(p => 
        p.name.toLowerCase() === productName.toLowerCase() && 
        p.variantName.toLowerCase() === variant.toLowerCase()
      ) || null;
    }

    // 3. Keyword-based fuzzy lookup
    if (!matchedProduct && extractedKeywords.length > 0) {
      // Find products that match most keywords
      const scores = products.map(p => {
        const productText = `${p.name} ${p.variantName} ${p.sku} ${p.barcode}`.toLowerCase();
        let score = 0;
        extractedKeywords.forEach((kw: string) => {
          if (productText.includes(kw.toLowerCase())) score++;
        });
        return { product: p, score };
      });

      const bestMatch = scores.sort((a, b) => b.score - a.score)[0];
      if (bestMatch && bestMatch.score >= 2) { // Require at least 2 keywords to match
        matchedProduct = bestMatch.product;
      }
    }

    if (matchedProduct) {
      setProduct(matchedProduct);
      setBarcode(matchedProduct.barcode);
      setStep('COUNT');
      setShowScanner(false);
      toast.success(`Product identified: ${matchedProduct.name}`);
      return;
    }

    // Fallback to New Product Entry with pre-filled AI data
    setBarcode(extractedBarcode || '');
    setProduct({
      name: productName,
      category: data?.category || 'Vape',
      description: '',
      variantName: variant,
      sku: '',
      barcode: extractedBarcode || '',
      barcode1: '',
      barcode2: '',
      barcode3: '',
      quantity: 0
    });
    setPhysicalQty('');
    setIsNewProduct(true);
    setStep('NEW_PRODUCT');
    setShowScanner(false);
    
    if (data?.isNewProduct) {
      toast.info('Product looks new. AI pre-filled the form for you.');
    } else {
      toast.info('AI identified details but no exact database match found.');
    }
  };

  const identifyProductWithAI = async (base64Data: string) => {
    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey || apiKey.includes('TODO') || apiKey.includes('YOUR_API_KEY')) {
        throw new Error('AI service not configured. Please check your API key in settings.');
      }

      const ai = new GoogleGenAI({ apiKey });
      
      const prompt = `Identify the product in this image. 
      
      EXTRACTION GOALS:
      1. BRAND: Identify the brand (e.g., 'Elf Bar', 'Lost Mary', 'Pod Juice').
      2. PRODUCT NAME: Identify the core model/product name.
      3. VARIANT/FLAVOR: Identify specific flavor, nicotine level, or size.
      4. BARCODE: Look for any visible barcode numbers (GTIN, EAN, UPC) on the product packaging.
      5. KEYWORDS: Extract 3-5 specific searchable keywords found on the label.

      Return a JSON object:
      {
        "productName": "string",
        "variant": "string",
        "barcode": "string or null",
        "category": "string",
        "keywords": ["array", "of", "strings"],
        "isNewProduct": boolean
      }

      Return ONLY the JSON object, no other text.`;

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
          {
            text: prompt
          },
          {
            inlineData: {
              data: base64Data,
              mimeType: "image/jpeg"
            }
          }
        ],
        config: {
          responseMimeType: "application/json"
        }
      });

      const result = JSON.parse(response.text);
      handleAIIdentify(result);
    } catch (error: any) {
      console.error('AI Identification Error:', error);
      toast.error('AI Identification failed. Using manual entry.');
      handleAIIdentify({ isNewProduct: true });
    }
  };

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

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsAnalyzing(true);
    setIsFromImage(true);
    setStep('SCAN');

    try {
      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve) => {
        reader.onload = () => {
          const base64 = (reader.result as string).split(',')[1];
          resolve(base64);
        };
      });
      reader.readAsDataURL(file);
      const base64DataRaw = await base64Promise;

      // Resize image before sending to server
      const resizeImage = (base64: string): Promise<string> => {
        return new Promise((resolve) => {
          const img = new Image();
          img.onload = () => {
            const canvas = document.createElement('canvas');
            const MAX_WIDTH = 1024;
            const MAX_HEIGHT = 1024;
            let width = img.width;
            let height = img.height;

            if (width > height) {
              if (width > MAX_WIDTH) {
                height *= MAX_WIDTH / width;
                width = MAX_WIDTH;
              }
            } else {
              if (height > MAX_HEIGHT) {
                width *= MAX_HEIGHT / height;
                height = MAX_HEIGHT;
              }
            }
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx?.drawImage(img, 0, 0, width, height);
            resolve(canvas.toDataURL('image/jpeg', 0.8).split(',')[1]);
          };
          img.src = `data:image/jpeg;base64,${base64}`;
        });
      };

      const base64Data = await resizeImage(base64DataRaw);

      await identifyProductWithAI(base64Data);
    } catch (error) {
      console.error('Image analysis failed:', error);
      toast.error('Failed to analyze image.');
    } finally {
      setIsAnalyzing(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleAddNewProduct = () => {
    setProduct({
      name: '',
      category: '',
      description: '',
      variantName: '',
      sku: '',
      barcode: barcode,
      barcode1: '',
      barcode2: '',
      barcode3: '',
      quantity: 0
    });
    setPhysicalQty('');
    setIsNewProduct(true);
    setStep('NEW_PRODUCT');
  };

  const handleNewProductSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!product || !physicalQty) return;

    setIsSaving(true);
    
    let qty = 0;
    if (unitType === 'Piece') {
      qty = parseInt(physicalQty, 10);
    } else {
      qty = parseInt(physicalQty, 10) * parseInt(piecesPerBox, 10);
    }

    // For new products, variance is just the quantity since original was 0
    const variance = qty;
    const variancePercentage = 1.0; // +100%

    const record: StocktakeRecord = {
      id: crypto.randomUUID(),
      sku: product.sku || '',
      category: product.category,
      productName: product.name,
      variant: product.variantName,
      description: product.description,
      barcode: product.barcode,
      barcodeScanned: barcode,
      quantity: 0,
      originalQuantity: 0,
      physicalQty: qty,
      physicalCount: qty,
      unitType: unitType,
      variance: variance,
      variancePercent: 100,
      variancePercentage: variancePercentage,
      timestamp: new Date().toISOString(),
      user: userEmail || 'Anonymous',
      status: 'Pending',
      mode: mode,
      isNewProduct: true,
      storeLocation: selectedStore,
    };

    addProduct(product);
    await addRecord(record);
    const success = await saveRecordToScript(record);
    
    setIsSaving(false);
    if (success) {
      toast.success('New Product Recorded');
      setStep('LANDING');
      setBarcode('');
      setProduct(null);
      setPhysicalQty('');
      setUnitType('Piece');
      setPiecesPerBox('1');
      setIsFromImage(false);
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
      status: 'Pending',
      mode: mode,
      isNewProduct: isNewProduct,
      storeLocation: selectedStore,
    };

    if (isNewProduct) {
      addProduct(product);
    }

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
    setIsFromImage(false);
  };

  return (
    <div className="flex flex-col h-full max-w-md mx-auto w-full p-4">
      {showScanner && (
        <Scanner 
          onScan={handleScan} 
          onAIIdentify={identifyProductWithAI}
          onClose={() => setShowScanner(false)} 
          spreadsheetId={import.meta.env.VITE_GOOGLE_SHEET_ID || '1bbVxr0BqFlDra2OPSd4o8J8kamWpKi-leG2Ax6wCdPs'}
        />
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
            <div className="space-y-2">
              <label className="text-sm font-bold text-gray-700 flex items-center gap-2">
                <MapPin size={16} />
                Select Store Location
              </label>
              <select
                value={selectedStore}
                onChange={(e) => setSelectedStore(e.target.value)}
                className="w-full p-4 bg-white border-2 border-gray-200 rounded-2xl focus:border-blue-500 focus:ring-0 transition-colors"
              >
                <option value="">-- Select Store --</option>
                {stores.map(store => (
                  <option key={store} value={store}>{store}</option>
                ))}
              </select>
            </div>

            <div className="flex bg-gray-100 p-1 rounded-2xl">
              <button
                onClick={() => setMode('Stocktake')}
                className={`flex-1 py-3 rounded-xl font-semibold flex items-center justify-center gap-2 transition-all ${
                  mode === 'Stocktake' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                <ClipboardList size={20} />
                Stocktake
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
              onClick={() => {
                if (!selectedStore) {
                  toast.error('Please select a store location first');
                  return;
                }
                setStep('SCAN');
              }}
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
        <div className="flex flex-col items-center justify-center h-full space-y-8 animate-in fade-in zoom-in duration-300 overflow-y-auto pb-24">
          <div className="text-center space-y-2">
            <div className={`p-4 rounded-full inline-block mb-2 ${mode === 'Stocktake' ? 'bg-blue-100 text-blue-600' : 'bg-green-100 text-green-600'}`}>
              {mode === 'Stocktake' ? <Package size={48} /> : <Truck size={48} />}
            </div>
            <h2 className="text-2xl font-bold text-gray-800">{mode} Mode</h2>
            <p className="text-gray-500">Scan a barcode to begin {mode.toLowerCase()}</p>
          </div>

          <div className="w-full space-y-3">
            <div className="flex gap-2">
              <button
                onClick={() => {
                  if (!selectedStore) {
                    toast.error('⚠️ Please select a store location first!');
                    return;
                  }
                  setShowScanner(true);
                }}
                className={`flex-1 py-4 text-white rounded-2xl font-semibold text-lg flex items-center justify-center space-x-2 shadow-lg transition-all active:scale-95 ${
                  mode === 'Stocktake' ? 'bg-blue-600 hover:bg-blue-700 shadow-blue-200' : 'bg-green-600 hover:bg-green-700 shadow-green-200'
                }`}
              >
                <Camera size={24} />
                <span>Camera</span>
              </button>
              <button
                onClick={() => {
                  if (!selectedStore) {
                    toast.error('⚠️ Please select a store location first!');
                    return;
                  }
                  fileInputRef.current?.click();
                }}
                disabled={isAnalyzing}
                className="flex-1 py-4 bg-white border-2 border-purple-200 text-purple-600 rounded-2xl font-semibold text-lg flex items-center justify-center space-x-2 shadow-sm hover:bg-purple-50 transition-all active:scale-95 disabled:opacity-50"
              >
                {isAnalyzing ? <Loader2 size={24} className="animate-spin" /> : <Sparkles size={24} />}
                <span>Smart Upload</span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleImageUpload}
                className="hidden"
              />
            </div>
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
        <div className="flex flex-col h-full animate-in slide-in-from-right-4 duration-300 overflow-y-auto pb-24">
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
                <div className="mt-3 bg-white/20 px-3 py-1.5 rounded-lg border border-white/30 inline-block font-mono tracking-wider">
                  <span className="text-[10px] uppercase font-bold opacity-70 block mb-0.5">Barcode</span>
                  <span className="text-sm font-bold">{product.barcode}</span>
                </div>
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

      {step === 'NEW_PRODUCT' && product && (
        <div className="flex flex-col h-full animate-in slide-in-from-right-4 duration-300 overflow-y-auto pb-24">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-gray-800">New Product Entry</h2>
            <button onClick={reset} className="text-sm text-gray-500 hover:text-gray-800 font-medium">Cancel</button>
          </div>

          <form onSubmit={handleNewProductSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1 uppercase tracking-wider">Category</label>
              <input
                type="text"
                required
                value={product.category}
                onChange={(e) => setProduct({ ...product, category: e.target.value })}
                className="w-full p-4 bg-white border-2 border-gray-200 rounded-2xl focus:border-blue-500 focus:ring-0"
                placeholder="e.g. Beverages"
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1 uppercase tracking-wider">Product Name</label>
              <input
                type="text"
                required
                value={product.name}
                onChange={(e) => setProduct({ ...product, name: e.target.value })}
                className="w-full p-4 bg-white border-2 border-gray-200 rounded-2xl focus:border-blue-500 focus:ring-0"
                placeholder="e.g. Coca Cola"
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1 uppercase tracking-wider">Variant</label>
              <input
                type="text"
                required
                value={product.variantName}
                onChange={(e) => setProduct({ ...product, variantName: e.target.value })}
                className="w-full p-4 bg-white border-2 border-gray-200 rounded-2xl focus:border-blue-500 focus:ring-0"
                placeholder="e.g. 500ml Bottle"
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1 uppercase tracking-wider">Description</label>
              <textarea
                value={product.description}
                onChange={(e) => setProduct({ ...product, description: e.target.value })}
                className="w-full p-4 bg-white border-2 border-gray-200 rounded-2xl focus:border-blue-500 focus:ring-0"
                placeholder="Optional description..."
              />
            </div>
            <div className="grid grid-cols-1 gap-4">
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1 uppercase tracking-wider">Barcode</label>
                <input
                  type="text"
                  required
                  value={product.barcode}
                  onChange={(e) => setProduct({ ...product, barcode: e.target.value })}
                  className="w-full p-4 bg-gray-50 border-2 border-gray-200 rounded-2xl text-gray-500"
                  readOnly
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2 uppercase tracking-wider">
                {mode === 'Stocktake' ? 'Physical Count (Pieces)' : 'Qty Received'}
              </label>
              <input
                type="number"
                required
                min="1"
                value={physicalQty}
                onChange={(e) => setPhysicalQty(e.target.value)}
                className="w-full p-4 bg-white border-2 border-gray-200 rounded-2xl focus:border-blue-500 focus:ring-0"
                placeholder="0"
              />
            </div>

            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2 uppercase tracking-wider">Default Unit</label>
              <div className="flex bg-gray-100 p-1 rounded-xl">
                <button
                  type="button"
                  className={`flex-1 py-3 rounded-lg text-sm font-bold transition-colors ${unitType === 'Piece' ? 'bg-white text-gray-900 shadow' : 'text-gray-500 hover:text-gray-700'}`}
                  onClick={() => setUnitType('Piece')}
                >
                  Piece
                </button>
                <button
                  type="button"
                  className={`flex-1 py-3 rounded-lg text-sm font-bold transition-colors ${unitType === 'Box' ? 'bg-white text-gray-900 shadow' : 'text-gray-500 hover:text-gray-700'}`}
                  onClick={() => setUnitType('Box')}
                >
                  Box
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={isSaving}
              className={`w-full py-4 text-white rounded-2xl font-bold text-xl shadow-lg transition-all active:scale-95 mt-4 flex items-center justify-center space-x-2 ${
                mode === 'Stocktake' ? 'bg-blue-600 hover:bg-blue-700' : 'bg-green-600 hover:bg-green-700'
              } disabled:opacity-50`}
            >
              {isSaving ? (
                <>
                  <Loader2 size={24} className="animate-spin" />
                  <span>Saving...</span>
                </>
              ) : (
                <span>Submit New Product</span>
              )}
            </button>
          </form>
        </div>
      )}

      {step === 'ERROR' && (
        <div className="flex flex-col h-full animate-in slide-in-from-bottom-4 duration-300 overflow-y-auto pb-24">
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
              onClick={() => fileInputRef.current?.click()}
              disabled={isAnalyzing}
              className="w-full py-4 bg-purple-600 hover:bg-purple-700 text-white rounded-2xl font-semibold text-lg flex items-center justify-center space-x-2 shadow-lg shadow-purple-200 transition-all active:scale-95 disabled:opacity-50"
            >
              {isAnalyzing ? (
                <>
                  <Loader2 size={24} className="animate-spin" />
                  <span>AI Analyzing...</span>
                </>
              ) : (
                <>
                  <Sparkles size={24} />
                  <span>Ask AI Agent to Identify</span>
                </>
              )}
            </button>

            <button
              onClick={handleAddNewProduct}
              disabled={isAnalyzing}
              className={`w-full py-4 text-white rounded-2xl font-semibold text-lg flex items-center justify-center space-x-2 shadow-lg transition-all active:scale-95 disabled:opacity-50 ${
                mode === 'Stocktake' ? 'bg-blue-600 hover:bg-blue-700 shadow-blue-200' : 'bg-green-600 hover:bg-green-700 shadow-green-200'
              }`}
            >
              <Plus size={24} />
              <span>Add New Product</span>
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

      <input 
        type="file" 
        ref={fileInputRef} 
        onChange={handleImageUpload} 
        accept="image/*" 
        className="hidden" 
      />
    </div>
  );
}
