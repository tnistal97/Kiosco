"use client";
import { useState } from "react";
import BarcodeScanner from "../../components/BarcodeScanner";

interface Product {
  product_name: string;
  brands: string;
  image_url: string;
  code: string;
  countries: string;
}

export default function ScanPage() {
  const [barcode, setBarcode] = useState<string | null>(null);
  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function fetchProduct(barcode: string) {
    setLoading(true);
    setError(null);
    setProduct(null);
    try {
      const res = await fetch(`https://world.openfoodfacts.org/api/v0/product/${barcode}.json`);
      const data = await res.json();
      if (data.status === 1 && data.product && data.product.countries_tags?.includes("es:argentina")) {
        setProduct({
          product_name: data.product.product_name,
          brands: data.product.brands,
          image_url: data.product.image_url,
          code: data.product.code,
          countries: data.product.countries,
        });
      } else if (data.status === 1) {
        setError("Producto encontrado, pero no es argentino.");
      } else {
        setError("Producto no encontrado.");
      }
    } catch (e) {
      setError("Error consultando la API.");
    }
    setLoading(false);
  }

  return (
    <main style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 24 }}>
      <h1 style={{ fontSize: 32, fontWeight: 700 }}>Escanear producto argentino</h1>
      {!barcode && <BarcodeScanner onDetected={(code) => { setBarcode(code); fetchProduct(code); }} />}
      {loading && <p>Buscando producto...</p>}
      {error && <p style={{ color: "red" }}>{error}</p>}
      {product && (
        <div style={{ textAlign: "center", marginTop: 24 }}>
          <img src={product.image_url} alt={product.product_name} style={{ width: 150, marginBottom: 12, borderRadius: 8 }} />
          <h2 style={{ fontSize: 24 }}>{product.product_name}</h2>
          <p><b>Marca:</b> {product.brands}</p>
          <p><b>Países:</b> {product.countries}</p>
          <p><b>Código:</b> {product.code}</p>
        </div>
      )}
      {barcode && !loading && (
        <button onClick={() => { setBarcode(null); setProduct(null); setError(null); }} style={{ marginTop: 16, padding: "8px 16px", borderRadius: 4, background: "#0a0a0a", color: "#fff", border: "none" }}>
          Escanear otro
        </button>
      )}
    </main>
  );
}
