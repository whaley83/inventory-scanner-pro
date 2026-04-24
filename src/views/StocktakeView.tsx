import React, { useState, useRef, useEffect } from 'react';
import { Camera, Search, CheckCircle2, ArrowRight, Package, AlertCircle, ClipboardList, Plus, Loader2, RefreshCw, Truck, Upload, MapPin, Sparkles, X } from 'lucide-react';
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
  const [expectedQtyInput, setExpectedQtyInput] = useState('');
  const [mode, setMode] = useState<'Stocktake' | 'Receiving'>('Stocktake');
  const [isNewProduct, setIsNewProduct] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [lastScannedImage, setLastScannedImage] = useState<string | null>(null);
  const [lastScannedText, setLastScannedText] = useState<string>('');
  const [candidates, setCandidates] = useState<Product[]>([]);
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
    const productName = data?.productName || '';
    const variant = data?.variant || '';
    const confidence = data?.confidence || (data?.isNewProduct ? 'none' : 'high');

    // 1. High Confidence Match (Exact or Semantic)
    if (confidence === 'high' && productName && variant) {
      const found = products.find(p => 
        (p.name.toLowerCase() === productName.toLowerCase() && p.variantName.toLowerCase() === variant.toLowerCase()) ||
        (`${p.name} ${p.variantName}`.toLowerCase() === `${productName} ${variant}`.toLowerCase())
      );
      if (found) {
        setProduct(found);
        setBarcode(found.barcode);
        setStep('COUNT');
        setShowScanner(false);
        setCandidates([]);
        toast.success(`Matched: ${found.name} (${found.variantName})`);
        return;
      }
    }

    // 2. Ambiguous Match (Multiple Candidates)
    if (confidence === 'ambiguous' && data?.candidates?.length > 0) {
      // Cross-reference candidates with actual product list to ensure we have full objects
      const matchedCandidates = data.candidates.map((c: any) => {
        return products.find(p => 
          (p.name.toLowerCase() === c.productName?.toLowerCase() && p.variantName.toLowerCase() === c.variant?.toLowerCase())
        );
      }).filter(Boolean);

      if (matchedCandidates.length > 0) {
        setCandidates(matchedCandidates);
        setShowScanner(false);
        // We stay in SCAN or go to a special AMBIGUOUS step, but let's keep it simple
        // If we have candidates, we'll show them in the UI
        toast.info(`Found ${matchedCandidates.length} possible matches. Please select one.`);
        return;
      }
    }

    // 3. No Match or AI forced New Product
    // Use Smart Pre-fill for NEW_PRODUCT
    setBarcode(data?.barcode || barcode || lastScannedText || '');
    setProduct({
      name: productName,
      category: data?.category || 'Vape',
      description: data?.description || '',
      variantName: variant,
      sku: data?.sku || '',
      barcode: data?.barcode || barcode || lastScannedText || '',
      quantity: 0
    });
    setPhysicalQty('');
    setIsNewProduct(true);
    setStep('NEW_PRODUCT');
    setShowScanner(false);
    setCandidates([]);
    
    if (confidence === 'none') {
      toast.info('AI could not find a match. Pre-filled form with extracted info.');
    } else {
      toast.info('Smart pre-fill applied for new product entry.');
    }
  };

  const identifyProductWithAI = async (base64Data: string, textHint: string = '') => {
    setIsAnalyzing(true);
    setLastScannedImage(base64Data);
    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey || apiKey.includes('TODO') || apiKey.includes('YOUR_API_KEY')) {
        throw new Error('AI service not configured. Please check your API key in settings.');
      }

      const ai = new GoogleGenAI({ apiKey });
      
      const productListContext = products.map(p => `- ${p.name} | ${p.variantName}`).join('\n');

      const prompt = `You are a semantic product matcher for an inventory system.
      
      TASK: Identify the product in the image and match it to the MASTER PRODUCT LIST.
      
      INPUTS:
      1. Image of product/barcode.
      2. Text Hint (if available): "${textHint}"
      
      MASTER PRODUCT LIST (Product Name | Variant):
      ${productListContext}
      
      RULES:
      1. SEMANTIC MATCHING: Look for the most semantically similar item. "Wenax Q Pro" is the same as "WENAX Q PRO". 
      2. FUZZY SEARCH: If its "Moonlit Silver" on the box but "Moonlit Silver (2ml)" in the list, its a match.
      3. CONFIDENCE SCORING:
         - "high": Only one definitive match found in the list.
         - "ambiguous": Multiple variants for the same product exist in the list (e.g., same flavor but different nicotine levels or colors), and you aren't 100% sure which one it is.
         - "none": No similar product exists in the list.
      4. If "ambiguous", provide up to 5 best matches in the "candidates" field.
      5. If "high" or "none", still provide "productName" and "variant" based on identification.
      
      STRICT JSON RESPONSE FORMAT:
      {
        "confidence": "high" | "ambiguous" | "none",
        "productName": "string",
        "variant": "string",
        "candidates": [{ "productName": "string", "variant": "string" }],
        "barcode": "string or null",
        "category": "string",
        "isNewProduct": boolean
      }
      
      Return ONLY the JSON.`;

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
          { text: prompt },
          { inlineData: { data: base64Data, mimeType: "image/jpeg" } }
        ],
        config: { responseMimeType: "application/json" }
      });

      const result = JSON.parse(response.text);
      handleAIIdentify(result);
    } catch (error: any) {
      console.error('AI Identification Error:', error);
      toast.error('AI identification failed. Please enter manually.');
      handleAddNewProduct(); // Fallback to manual entry with current state
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleScan = (scannedBarcode: string, base64Image?: string) => {
    if (step === 'COMPLETED') return;
    if (!scannedBarcode.trim()) return;
    
    setBarcode(scannedBarcode);
    setLastScannedText(scannedBarcode);
    if (base64Image) setLastScannedImage(base64Image);
    setShowScanner(false);
    setCandidates([]);
    
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
    // If we have some text from a failed scan, use it as a starting point
    setProduct({
      name: lastScannedText || '',
      category: '',
      description: '',
      variantName: '',
      sku: '',
      barcode: barcode || lastScannedText || '',
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
      expectedQuantity: mode === 'Receiving' ? parseFloat(physicalQty) : 0, // In new product, expected is same if receiving? or separate? user said "replace Original Qty with Expected Quantity"
      physicalQty: qty,
      physicalCount: qty,
      unitType: unitType,
      variance: mode === 'Receiving' ? 0 : qty,
      variancePercent: mode === 'Receiving' ? 0 : 100,
      variancePercentage: mode === 'Receiving' ? 0 : 1.0,
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

    const variance = mode === 'Receiving' 
      ? qty - parseFloat(expectedQtyInput || '0')
      : qty - product.quantity;
      
    let variancePercentage = 0;
    
    if (mode === 'Receiving') {
      const expected = parseFloat(expectedQtyInput || '0');
      if (expected !== 0) {
        variancePercentage = (qty - expected) / expected;
      }
    } else {
      if (product.quantity !== 0) {
        variancePercentage = (variance / product.quantity);
      } else if (variance > 0) {
        variancePercentage = 1.0;
      }
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
      originalQuantity: mode === 'Receiving' ? parseFloat(expectedQtyInput || '0') : product.quantity,
      expectedQuantity: mode === 'Receiving' ? parseFloat(expectedQtyInput || '0') : undefined,
      physicalQty: qty,
      physicalCount: qty,
      unitType: unitType,
      variance: variance,
      variancePercent: Math.round(variancePercentage * 100),
      variancePercentage: variancePercentage,
      timestamp: new Date().toISOString(),
      user: userEmail || 'Anonymous',
      status: 'Pending', // Internal status for the record object
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

      {candidates.length > 0 && (
        <div className="fixed inset-0 z-[110] bg-black/80 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm overflow-hidden flex flex-col shadow-2xl animate-in fade-in zoom-in duration-200">
            <div className="p-4 border-b bg-gray-50 flex justify-between items-center">
              <h3 className="font-bold text-gray-900">Select Variant</h3>
              <button 
                onClick={() => setCandidates([])} 
                className="text-gray-400 hover:text-gray-600 p-1 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-4">
              <p className="text-sm text-gray-500 mb-4 text-center italic">
                "I found <strong>{candidates[0].name}</strong>. Which variant is this?"
              </p>
              <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1 custom-scrollbar">
                {candidates.map((c, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      setProduct(c);
                      setBarcode(c.barcode);
                      setStep('COUNT');
                      setCandidates([]);
                    }}
                    className="w-full text-left p-4 rounded-xl border border-gray-200 hover:border-blue-500 hover:bg-blue-50 transition-all flex items-center justify-between group"
                  >
                    <div>
                      <div className="font-bold text-gray-900 group-hover:text-blue-700">{c.variantName}</div>
                      <div className="text-xs text-gray-500 font-mono mt-1">SKU: {c.sku}</div>
                    </div>
                    <ArrowRight size={18} className="text-gray-300 group-hover:text-blue-500" />
                  </button>
                ))}
              </div>
              <button
                onClick={() => {
                  const first = candidates[0];
                  setProduct({
                    name: first.name,
                    category: first.category,
                    description: '',
                    variantName: '',
                    sku: '',
                    barcode: barcode || '',
                    quantity: 0
                  });
                  setIsNewProduct(true);
                  setStep('NEW_PRODUCT');
                  setCandidates([]);
                }}
                className="w-full mt-4 py-3 text-center text-sm font-bold text-blue-600 hover:bg-blue-50 rounded-xl transition-colors"
              >
                None of these, add as new product
              </button>
            </div>
          </div>
        </div>
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
                <p className="text-sm text-white/60 font-mono mt-1">Barcode: {product.barcode}</p>
              </div>
              <span className={`text-xs px-2 py-1 rounded font-bold uppercase tracking-wider ${
                mode === 'Stocktake' ? 'bg-blue-500 text-white' : 'bg-green-500 text-white'
              }`}>
                {product.category}
              </span>
            </div>

            <form onSubmit={handleCountSubmit} className="space-y-4">
              {mode === 'Receiving' && (
                <div className="space-y-2">
                  <label className="text-xs font-bold text-white/70 uppercase">Expected Quantity</label>
                  <input
                    type="number"
                    required
                    value={expectedQtyInput}
                    onChange={(e) => setExpectedQtyInput(e.target.value)}
                    placeholder="Enter expected amount..."
                    className="w-full p-4 bg-white/10 border-2 border-white/20 rounded-xl text-white placeholder:text-white/40 focus:border-white focus:ring-0 transition-colors"
                  />
                </div>
              )}
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
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1 uppercase tracking-wider">SKU (Optional)</label>
                <input
                  type="text"
                  value={product.sku}
                  onChange={(e) => setProduct({ ...product, sku: e.target.value })}
                  className="w-full p-4 bg-white border-2 border-gray-200 rounded-2xl focus:border-blue-500 focus:ring-0"
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1 uppercase tracking-wider">Barcode</label>
                <input
                  type="text"
                  required
                  value={product.barcode}
                  onChange={(e) => setProduct({ ...product, barcode: e.target.value })}
                  className="w-full p-4 bg-white border-2 border-gray-200 rounded-2xl focus:border-blue-500 focus:ring-0 transition-colors"
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
              onClick={() => {
                if (lastScannedImage) {
                  identifyProductWithAI(lastScannedImage, barcode || lastScannedText);
                } else {
                   fileInputRef.current?.click();
                }
              }}
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
