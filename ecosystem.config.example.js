// Plantilla de despliegue con PM2.
//
// Copiar a `ecosystem.config.js` en el servidor y completar los valores.
// `ecosystem.config.js` esta en .gitignore: NO debe versionarse con credenciales.
//
// Preferible a embeber secretos aca: dejarlos en un archivo .env junto al proyecto
// y arrancar con `pm2 start ecosystem.config.js` habiendo cargado ese .env.

module.exports = {
  apps: [
    {
      name: 'kiosco',
      cwd: '/ruta/al/proyecto',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3099',
      exec_mode: 'fork',
      instances: 1,
      env: {
        NODE_ENV: 'production',
        PORT: '3099',
        DATABASE_URL: 'postgresql://usuario:contrasena@localhost:5432/kiosco?schema=public',
        JWT_SECRET: 'reemplazar-por-un-secreto-generado',
      },
      max_memory_restart: '512M',
      out_file: './logs/out.log',
      error_file: './logs/error.log',
      merge_logs: true,
      autorestart: true,
    },
  ],
}
