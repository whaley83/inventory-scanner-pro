import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { X, Camera, Type, AlertCircle } from 'lucide-react';
import Tesseract from 'tesseract.js';

interface ScannerProps {
  onScan: (barcode: string) => void;
  onTextScan: (text: string) => void;
  onClose: () => void;
}

type ScanMode = 'BARCODE' | 'TEXT';

export function Scanner({ onScan, onTextScan, onClose }: ScannerProps) {
  const html5QrCodeRef = useRef<Html5Qrcode | null>(null);
  const [mode, setMode] = useState<ScanMode>('BARCODE');
  const [isProcessingText, setIsProcessingText] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (mode === 'BARCODE') {
      stopCameraStream();
      startBarcodeScanner();
    } else {
      stopBarcodeScanner();
      startCameraStream();
    }

    return () => {
      stopBarcodeScanner();
      stopCameraStream();
    };
  }, [mode]);

  const startBarcodeScanner = async () => {
    try {
      // Small delay to ensure the container is in the DOM
      await new Promise(resolve => setTimeout(resolve, 100));
      
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
        (decodedText) => {
          html5QrCode.stop().then(() => {
            onScan(decodedText);
          }).catch(console.error);
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
    if (html5QrCodeRef.current && html5QrCodeRef.current.isScanning) {
      try {
        await html5QrCodeRef.current.stop();
        html5QrCodeRef.current = null;
      } catch (err) {
        console.error("Error stopping barcode scanner:", err);
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

  const captureAndRecognizeText = async () => {
    if (!videoRef.current || !canvasRef.current) return;

    setIsProcessingText(true);
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');

    if (context) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);

      const imageDataUrl = canvas.toDataURL('image/png');

      try {
        const result = await Tesseract.recognize(imageDataUrl, 'eng');
        const cleanText = result.data.text.replace(/\s+/g, ' ').trim();
        if (cleanText) {
           onTextScan(cleanText);
        } else {
           alert("No text found. Please try again.");
        }
      } catch (error) {
        console.error("OCR Error:", error);
        alert("Failed to read text. Please try again.");
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
                      {isProcessingText ? 'Reading...' : 'Capture Text'}
                    </button>
                  </div>
                  
                  {/* Overlay guide for text scanning */}
                  <div className="absolute inset-0 pointer-events-none border-[60px] border-black/40">
                    <div className="w-full h-full border-2 border-white/80 rounded-xl shadow-[0_0_0_1000px_rgba(0,0,0,0.4)]"></div>
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
