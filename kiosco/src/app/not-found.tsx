import Link from 'next/link';

export default function NotFound() {
  return (
    <main style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--color-background)',
      color: 'var(--color-foreground)',
      textAlign: 'center',
    }}>
      <h1 style={{ fontSize: '3rem', marginBottom: '1rem' }}>404</h1>
      <h2 style={{ fontSize: '1.5rem', marginBottom: '2rem' }}>Página no encontrada</h2>
      <Link href="/">
        <span style={{
          color: 'var(--color-foreground)',
          textDecoration: 'underline',
          cursor: 'pointer',
          fontWeight: 500,
        }}>
          Volver al inicio
        </span>
      </Link>
    </main>
  );
}
