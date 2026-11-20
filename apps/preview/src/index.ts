import { createStorageFromEnv } from '@rankforge/storage';
import { createPreviewApp } from './app.js';

const PORT = Number(process.env.PORT) || 4060;

const app = createPreviewApp(createStorageFromEnv());

app.listen(PORT, '0.0.0.0', () => {
  process.stdout.write(
    `${JSON.stringify({ ts: new Date().toISOString(), level: 'info', service: 'rf-preview', msg: 'listening', port: PORT })}\n`
  );
});
