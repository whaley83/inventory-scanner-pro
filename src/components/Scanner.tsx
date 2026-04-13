import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { X, Camera, Type, AlertCircle, Loader2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { GoogleGenAI } from "@google/genai";

interface ScannerProps {
  onScan: (barcode: string) => void;
  onTextScan: (text: string) => void;
  onAIIdentify: (base64: string) => Promise<void>;
  onClose: () => void;
  spreadsheetId?: string;
}

type ScanMode = 'BARCODE' | 'TEXT' | 'AI';

export function Scanner({ onScan, onTextScan, onAIIdentify, onClose, spreadsheetId }: ScannerProps) {
  const html5QrCodeRef = useRef<Html5Qrcode | null>(null);
  const [mode, setMode] = useState<ScanMode>('BARCODE');
  const [isProcessingText, setIsProcessingText] = useState(false);
  const [isIdentifying, setIsIdentifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const isTransitioning = useRef(false);

  useEffect(() => {
    const handleModeChange = async () => {
      if (isTransitioning.current) return;
      isTransitioning.current = true;

      try {
        if (mode === 'BARCODE') {
          stopCameraStream();
          await startBarcodeScanner();
        } else {
          await stopBarcodeScanner();
          await startCameraStream();
        }
      } finally {
        isTransitioning.current = false;
      }
    };

    handleModeChange();

    return () => {
      stopBarcodeScanner();
      stopCameraStream();
    };
  }, [mode]);

  const startBarcodeScanner = async () => {
    try {
      // Ensure any previous instance is cleaned up
      if (html5QrCodeRef.current) {
        try {
          if (html5QrCodeRef.current.isScanning) {
            await html5QrCodeRef.current.stop();
          }
        } catch (e) {
          console.warn("Cleanup error:", e);
        }
        html5QrCodeRef.current = null;
      }

      // Small delay to ensure the container is in the DOM
      await new Promise(resolve => setTimeout(resolve, 150));
      
      const html5QrCode = new Html5Qrcode("reader");
      html5QrCodeRef.current = html5QrCode;

      const config = { 
        fps: 10, 
        qrbox: { width: 250, height: 150 },
        aspectRatio: 1.0
      };

      await html5QrCode.start(
        { facingMode: "environment" },
        config,
        async (decodedText) => {
          if (isTransitioning.current) return;
          isTransitioning.current = true;
          try {
            await html5QrCode.stop();
            html5QrCodeRef.current = null;
            onScan(decodedText);
          } catch (err) {
            console.error("Error stopping after scan:", err);
            // Still call onScan even if stop fails
            onScan(decodedText);
          } finally {
            isTransitioning.current = false;
          }
        },
        (errorMessage) => {
          // Ignore frequent scan errors
        }
      );
      setError(null);
    } catch (err) {
      console.error("Error starting barcode scanner:", err);
      setError("Could not access camera. Please ensure you have granted permission and are using HTTPS.");
    }
  };

  const stopBarcodeScanner = async () => {
    if (html5QrCodeRef.current) {
      try {
        if (html5QrCodeRef.current.isScanning) {
          await html5QrCodeRef.current.stop();
        }
      } catch (err) {
        console.warn("Error stopping barcode scanner:", err);
      } finally {
        html5QrCodeRef.current = null;
      }
    }
  };

  const startCameraStream = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setError(null);
    } catch (err) {
      console.error("Error accessing camera for text scan:", err);
      setError("Could not access camera for text scanning.");
    }
  };

  const stopCameraStream = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
  };

  const captureAndIdentify = async () => {
    if (!videoRef.current || !canvasRef.current) return;

    setIsIdentifying(true);
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');

    if (context) {
      // Resize logic: max 1024px
      const MAX_WIDTH = 1024;
      const MAX_HEIGHT = 1024;
      let width = video.videoWidth;
      let height = video.videoHeight;

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
      context.drawImage(video, 0, 0, width, height);

      const imageDataUrl = canvas.toDataURL('image/jpeg', 0.8);
      const base64Data = imageDataUrl.split(',')[1];

      try {
        await onAIIdentify(base64Data);
      } catch (error) {
        console.error("AI Identify Error:", error);
        toast.error("AI could not identify product. Please enter manually.");
      } finally {
        setIsIdentifying(false);
      }
    }
  };

  const captureAndRecognizeText = async () => {
    if (!videoRef.current || !canvasRef.current) return;

    setIsProcessingText(true);
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');

    if (context) {
      // Resize logic: max 1024px
      const MAX_WIDTH = 1024;
      const MAX_HEIGHT = 1024;
      let width = video.videoWidth;
      let height = video.videoHeight;

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
      context.drawImage(video, 0, 0, width, height);

      const imageDataUrl = canvas.toDataURL('image/jpeg', 0.8);
      const base64Data = imageDataUrl.split(',')[1];

      try {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey || apiKey.includes('TODO') || apiKey.includes('YOUR_API_KEY')) {
          throw new Error('AI service not configured. Please check your API key in settings.');
        }

        const ai = new GoogleGenAI({ apiKey });
        const response = await ai.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: [
            {
              text: `You are a strictly evidentiary product scanner. 
              Analyze the image for a clear product label, barcode, or identifiable text (SKU, Product Name).
              
              RULES:
              1. If the image does not contain a clear product label, barcode, or identifiable text, return exactly: {"error": "no_product_detected"}.
              2. Do NOT 'guess' based on background objects, people, or context.
              3. Only return product data if a SKU, Barcode, or Product Name is clearly legible.
              4. If found, return the most prominent text found on the label (e.g., the SKU or Product Name).
              
              Response format: Return ONLY the text found or the error JSON.`
            },
            {
              inlineData: {
                data: base64Data,
                mimeType: "image/jpeg"
              }
            }
          ]
        });

        const resultText = response.text?.trim() || "";
        
        if (resultText.includes('no_product_detected')) {
          toast.error("No product detected. Please point the camera at a label");
        } else if (resultText) {
          onTextScan(resultText);
        } else {
          toast.error("No text found. Please try again.");
        }
      } catch (error) {
        console.error("Vision Error:", error);
        toast.error("Failed to read product details. Please try again.");
      } finally {
        setIsProcessingText(false);
      }
    }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black/90 flex flex-col items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md overflow-hidden flex flex-col shadow-2xl">
        <div className="p-4 border-b flex justify-between items-center bg-gray-50">
          <h3 className="font-bold text-gray-900">
            {mode === 'BARCODE' ? 'Scan Barcode' : 'Scan Product Details'}
          </h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700 p-2 hover:bg-gray-200 rounded-full transition-colors">
            <X size={24} />
          </button>
        </div>
        
        <div className="flex border-b">
           <button 
             className={`flex-1 py-4 flex items-center justify-center gap-2 font-bold transition-all ${mode === 'BARCODE' ? 'bg-blue-50 text-blue-600 border-b-4 border-blue-600' : 'text-gray-500 hover:bg-gray-50'}`}
             onClick={() => setMode('BARCODE')}
           >
             <Camera size={20} /> Barcode
           </button>
           <button 
             className={`flex-1 py-4 flex items-center justify-center gap-2 font-bold transition-all ${mode === 'TEXT' ? 'bg-blue-50 text-blue-600 border-b-4 border-blue-600' : 'text-gray-500 hover:bg-gray-50'}`}
             onClick={() => setMode('TEXT')}
           >
             <Type size={20} /> Read Text
           </button>
           <button 
             className={`flex-1 py-4 flex items-center justify-center gap-2 font-bold transition-all ${mode === 'AI' ? 'bg-blue-50 text-blue-600 border-b-4 border-blue-600' : 'text-gray-500 hover:bg-gray-50'}`}
             onClick={() => setMode('AI')}
           >
             <Sparkles size={20} /> AI Identify
           </button>
        </div>

        <div className="relative w-full bg-black aspect-square flex items-center justify-center overflow-hidden">
          {error ? (
            <div className="p-8 text-center text-white flex flex-col items-center gap-4">
              <AlertCircle size={48} className="text-red-500" />
              <p className="font-medium">{error}</p>
              <button 
                onClick={() => window.location.reload()}
                className="px-4 py-2 bg-white/20 hover:bg-white/30 rounded-lg transition-colors"
              >
                Reload App
              </button>
            </div>
          ) : (
            <>
              {mode === 'BARCODE' && (
                 <div id="reader" className="w-full h-full"></div>
              )}
              
              {mode === 'TEXT' && (
                <>
                  <video 
                    ref={videoRef} 
                    autoPlay 
                    playsInline 
                    className="w-full h-full object-cover"
                  />
                  <canvas ref={canvasRef} className="hidden" />
                  
                  <div className="absolute bottom-6 left-0 right-0 flex justify-center">
                    <button
                      onClick={captureAndRecognizeText}
                      disabled={isProcessingText}
                      className="bg-blue-600 text-white px-8 py-4 rounded-full font-bold shadow-xl flex items-center gap-2 disabled:opacity-50 active:scale-95 transition-transform"
                    >
                      {isProcessingText ? (
                        <>
                          <Loader2 className="animate-spin" size={20} />
                          <span>Analyzing...</span>
                        </>
                      ) : (
                        <>
                          <Camera size={20} />
                          <span>Capture Product</span>
                        </>
                      )}
                    </button>
                  </div>
                  
                  {/* Overlay guide for text scanning */}
                  <div className="absolute inset-0 pointer-events-none border-[60px] border-black/40">
                    <div className="w-full h-full border-2 border-white/80 rounded-xl shadow-[0_0_0_1000px_rgba(0,0,0,0.4)]"></div>
                  </div>
                </>
              )}

              {mode === 'AI' && (
                <>
                  <video 
                    ref={videoRef} 
                    autoPlay 
                    playsInline 
                    className="w-full h-full object-cover"
                  />
                  <canvas ref={canvasRef} className="hidden" />
                  
                  <div className="absolute bottom-6 left-0 right-0 flex justify-center">
                    <button
                      onClick={captureAndIdentify}
                      disabled={isIdentifying}
                      className="bg-purple-600 text-white px-8 py-4 rounded-full font-bold shadow-xl flex items-center gap-2 disabled:opacity-50 active:scale-95 transition-transform"
                    >
                      {isIdentifying ? (
                        <>
                          <Loader2 className="animate-spin" size={20} />
                          <span>Loading...</span>
                        </>
                      ) : (
                        <>
                          <Sparkles size={20} />
                          <span>AI Identify</span>
                        </>
                      )}
                    </button>
                  </div>
                  
                  {/* Overlay guide for AI identification */}
                  <div className="absolute inset-0 pointer-events-none border-[60px] border-black/40">
                    <div className="w-full h-full border-2 border-purple-400/80 rounded-xl shadow-[0_0_0_1000px_rgba(0,0,0,0.4)]"></div>
                  </div>
                </>
              )}
            </>
          )}
        </div>
        
        <div className="p-4 bg-gray-50 text-center text-xs text-gray-500">
          Tip: Hold the camera steady and ensure good lighting.
        </div>
      </div>
    </div>
  );
}
