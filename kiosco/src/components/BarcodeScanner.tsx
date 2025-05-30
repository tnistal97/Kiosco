"use client";
import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";

export default function BarcodeScanner({ onDetected }: { onDetected: (code: string) => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const codeReaderRef = useRef(new BrowserMultiFormatReader());

  useEffect(() => {
    const codeReader = codeReaderRef.current;
    let active = true;
    let currentStream: MediaStream | null = null;

    if (videoRef.current) {
      if (typeof navigator !== 'undefined' && navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function') {
        navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } })
          .then(stream => {
            if (!active) { // Component unmounted before stream started
              stream.getTracks().forEach(track => track.stop());
              return;
            }
            currentStream = stream;
            if (videoRef.current) { // Double check videoRef.current as it might become null
              videoRef.current.srcObject = stream;
              videoRef.current.play().catch(playErr => {
                console.error("Error playing video:", playErr);
                setError("Error al iniciar la cámara.");
              });

              codeReader.decodeFromVideoElement(videoRef.current, (result, decodeErr) => {
                console.log("ZXing intentando decodificar fotograma..."); // Debug: Verificar si ZXing procesa fotogramas
                if (!active) return; // Stop processing if component unmounted
                
                console.log(result, decodeErr)
                if (result) {
                  console.log("ZXing decodificó el código:", result.getText()); // Debug: Verificar el código decodificado
                  onDetected(result.getText());
                  active = false; // Stop further detections after one success
                  // Stop the stream tracks here as well if you want the camera to release immediately
                  if (currentStream) {
                    currentStream.getTracks().forEach(track => track.stop());
                  }
                }
                if (decodeErr && decodeErr.name !== 'NotFoundException') {
                  console.error("Barcode decoding error:", decodeErr);
                  setError("Error leyendo el código.");
                }
              });
            }
          })
          .catch(getUserMediaErr => {
            console.error("Error accessing camera:", getUserMediaErr);
            setError("No se pudo acceder a la cámara. Verifique los permisos.");
          });
      } else {
        setError("El acceso a la cámara no está soportado o la página no es segura (HTTPS).");
        console.error("navigator.mediaDevices.getUserMedia is not available.");
      }
    }

    return () => {
      active = false;
      if (currentStream) {
        currentStream.getTracks().forEach(track => track.stop());
      }
      // The BrowserMultiFormatReader instance (codeReader) might have its own reset/stop methods
      // depending on the version or specific continuous decoding methods, but for single decodeFromVideoElement
      // and releasing the camera, stopping the stream tracks is the primary concern.
    };
  }, [onDetected]);

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <video ref={videoRef} style={{ width: 320, height: 240, borderRadius: 8, background: "#000" }} autoPlay muted playsInline />
      {error && <p style={{ color: "red" }}>{error}</p>}
    </div>
  );
}
