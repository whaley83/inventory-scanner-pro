import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { X, Camera, Type, AlertCircle, Loader2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { GoogleGenAI } from "@google/genai";

interface ScannerProps {
  onScan: (barcode: string, base64Image?: string) => void;
  onAIIdentify: (base64: string) => Promise<void>;
  onClose: () => void;
  spreadsheetId?: string;
}

type ScanMode = 'BARCODE' | 'AI';

export function Scanner({ onScan, onAIIdentify, onClose, spreadsheetId }: ScannerProps) {
  const html5QrCodeRef = useRef<Html5Qrcode | null>(null);
  const [mode, setMode] = useState<ScanMode>('BARCODE');
  const [isIdentifying, setIsIdentifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const isTransitioning = useRef(false);

  useEffect(() => {
    const handleModeChange = async () => {
      if (isTransitioning.current) return;
      isTransitioning.current = true;

      try {
        await stopScanner();
        
        // Delay to allow OS to release camera hardware
        await new Promise(resolve => setTimeout(resolve, 500));

        if (mode === 'BARCODE') {
          await startBarcodeScanner();
        } else {
          await startCameraStream();
        }
      } finally {
        isTransitioning.current = false;
      }
    };

    handleModeChange();

    return () => {
      stopScanner();
    };
  }, [mode, resetKey]);

  const stopScanner = async () => {
    // 1. Explicitly stop barcode scanner library
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

    // 2. Kill all active media tracks to prevent hardware locks
    const activeStream = streamRef.current || (videoRef.current?.srcObject as MediaStream);
    const scannerVideo = document.querySelector('#reader video') as HTMLVideoElement;
    const scannerStream = scannerVideo?.srcObject as MediaStream;

    const streamsToStop = [activeStream, scannerStream].filter(Boolean);
    
    streamsToStop.forEach(stream => {
      stream!.getTracks().forEach(track => {
        track.stop();
        console.log("Explicitly stopped track:", track.label);
      });
    });

    // 3. Nullify references
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    if (scannerVideo) scannerVideo.srcObject = null;
  };

  const resetCamera = async () => {
    await stopScanner();
    await new Promise(resolve => setTimeout(resolve, 500));
    setResetKey(prev => prev + 1);
    toast.info("Camera resetting...");
  };

  const startBarcodeScanner = async () => {
    try {
      // Small delay to ensure the container is in the DOM
      await new Promise(resolve => setTimeout(resolve, 200));
      
      const html5QrCode = new Html5Qrcode("reader");
      html5QrCodeRef.current = html5QrCode;

      const config = { 
        fps: 20, 
        qrbox: (viewWidth: number, viewHeight: number) => {
          const boxWidth = viewWidth * 0.95;
          const boxHeight = Math.min(boxWidth * 0.6, viewHeight * 0.9);
          return { width: Math.floor(boxWidth), height: Math.floor(boxHeight) };
        },
        aspectRatio: undefined,
        disableFlip: false,
        videoConstraints: {
          facingMode: "environment",
          width: { ideal: 1280 }
        }
      };

      await html5QrCode.start(
        { facingMode: "environment" },
        config,
        async (decodedText) => {
          if (isTransitioning.current) return;
          isTransitioning.current = true;
          try {
            // Capture frame before stopping
            let base64Image: string | undefined;
            const video = document.querySelector('#reader video') as HTMLVideoElement;
            if (video && canvasRef.current) {
              const canvas = canvasRef.current;
              const context = canvas.getContext('2d');
              if (context) {
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                context.drawImage(video, 0, 0);
                base64Image = canvas.toDataURL('image/jpeg', 0.8).split(',')[1];
              }
            }

            await stopScanner();
            onScan(decodedText, base64Image);
          } catch (err) {
            console.error("Error stopping after scan:", err);
            onScan(decodedText);
          } finally {
            isTransitioning.current = false;
          }
        },
        (errorMessage) => {
          // Ignore frequent scan errors
        }
      );
      
      // Apply object-fit contain to ensure full frame is visible
      const videoElement = document.querySelector('#reader video') as HTMLVideoElement;
      if (videoElement) {
        videoElement.style.objectFit = 'contain';
        videoElement.style.width = '100%';
        videoElement.style.height = 'auto';
      }
      setError(null);
    } catch (err) {
      console.error("Error starting barcode scanner:", err);
      setError("Camera not found or already in use. Please check your browser permissions.");
    }
  };

  const startCameraStream = async () => {
    try {
      const constraints = {
        video: { 
          facingMode: "environment",
          width: { ideal: 1280 }
        }
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setError(null);
    } catch (err) {
      console.error("Error accessing camera for identification:", err);
      setError("Camera not found or already in use. Please check your browser permissions.");
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
        await stopScanner();
        onClose();
      } catch (error) {
        console.error("AI Identify Error:", error);
        toast.error("AI could not identify product. Please enter manually.");
        await stopScanner();
        onClose();
      } finally {
        setIsIdentifying(false);
      }
    }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black/90 flex flex-col items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md overflow-hidden flex flex-col shadow-2xl">
        <div className="p-4 border-b flex justify-between items-center bg-gray-50">
          <h3 className="font-bold text-gray-900">
            {mode === 'BARCODE' ? 'Scan Barcode' : 'Identify Product'}
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
             className={`flex-1 py-4 flex items-center justify-center gap-2 font-bold transition-all ${mode === 'AI' ? 'bg-blue-50 text-blue-600 border-b-4 border-blue-600' : 'text-gray-500 hover:bg-gray-50'}`}
             onClick={() => setMode('AI')}
           >
             <Sparkles size={20} /> AI Identify
           </button>
        </div>

        <div className="relative w-full bg-black min-h-[300px] flex items-center justify-center overflow-hidden">
          {error ? (
            <div className="p-8 text-center text-white flex flex-col items-center gap-4">
              <AlertCircle size={48} className="text-red-500" />
              <p className="font-medium">{error}</p>
              <div className="flex gap-2">
                <button 
                  onClick={resetCamera}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors font-bold"
                >
                  Reset Camera
                </button>
                <button 
                  onClick={() => window.location.reload()}
                  className="px-4 py-2 bg-white/20 hover:bg-white/30 rounded-lg transition-colors"
                >
                  Reload App
                </button>
              </div>
            </div>
          ) : (
            <div key={`${mode}-${resetKey}`} className="w-full h-full">
              {mode === 'BARCODE' && (
                <div className="relative w-full h-full">
                  <div id="reader" className="w-full h-auto min-h-[300px]"></div>
                  <canvas ref={canvasRef} className="hidden" />
                  
                  {/* Overlay guide for barcode - Matches the 95% config */}
                  <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                    <div className="w-[95%] aspect-[5/3] relative">
                      {/* Shading */}
                      <div className="absolute inset-0 shadow-[0_0_0_1000px_rgba(0,0,0,0.4)] rounded-xl"></div>
                      
                      {/* Corners - White larger borders */}
                      <div className="absolute top-0 left-0 w-12 h-12 border-t-4 border-l-4 border-white rounded-tl-xl"></div>
                      <div className="absolute top-0 right-0 w-12 h-12 border-t-4 border-r-4 border-white rounded-tr-xl"></div>
                      <div className="absolute bottom-0 left-0 w-12 h-12 border-b-4 border-l-4 border-white rounded-bl-xl"></div>
                      <div className="absolute bottom-0 right-0 w-12 h-12 border-b-4 border-r-4 border-white rounded-br-xl"></div>
                      
                      {/* Scanning line animation */}
                      <div className="absolute top-0 left-0 right-0 h-[2px] bg-red-500/50 animate-scan shadow-[0_0_8px_rgba(239,68,68,0.5)]"></div>
                    </div>
                  </div>
                </div>
              )}

              {mode === 'AI' && (
                <>
                  <video 
                    ref={videoRef} 
                    autoPlay 
                    playsInline 
                    className="w-full h-full object-contain"
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
                  
                  {/* Overlay guide for AI identification - Rectangular 95% width with 5:3 aspect ratio */}
                  <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                    <div className="w-[95%] aspect-[5/3] relative">
                      {/* Shading */}
                      <div className="absolute inset-0 shadow-[0_0_0_1000px_rgba(0,0,0,0.4)] rounded-xl border border-purple-400/30"></div>
                      
                      {/* Corners - White larger borders (keeping high visibility) */}
                      <div className="absolute top-0 left-0 w-12 h-12 border-t-4 border-l-4 border-white rounded-tl-xl"></div>
                      <div className="absolute top-0 right-0 w-12 h-12 border-t-4 border-r-4 border-white rounded-tr-xl"></div>
                      <div className="absolute bottom-0 left-0 w-12 h-12 border-b-4 border-l-4 border-white rounded-bl-xl"></div>
                      <div className="absolute bottom-0 right-0 w-12 h-12 border-b-4 border-r-4 border-white rounded-br-xl"></div>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
        
        <div className="p-4 bg-gray-50 text-center text-xs text-gray-500">
          Tip: Hold the camera steady and ensure good lighting.
        </div>
      </div>
    </div>
  );
}
