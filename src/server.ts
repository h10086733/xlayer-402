import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { env } from './config/env';
import { x402Router } from './routes/x402';
import { startTimeSyncScheduler } from './lib/timeSync';

const app = express();
const isProduction = process.env.NODE_ENV === 'production';

// CORS配置
const corsOptions = {
  origin: isProduction 
    ? process.env.ALLOWED_ORIGINS?.split(',') || ['https://yourdomain.com']
    : true,
  credentials: true,
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '1mb' }));

// 安全中间件
app.use((req, res, next) => {
  // 安全头
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  
  if (isProduction) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  
  next();
});

startTimeSyncScheduler();

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

app.use('/api/x402', x402Router);

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (!isProduction) {
    console.error(err);
  }
  
  res.status(500).json({ 
    error: 'INTERNAL_SERVER_ERROR', 
    message: isProduction ? 'Internal server error' : err.message 
  });
});

if (require.main === module) {
  app.listen(env.port, '0.0.0.0', () => {
    if (!isProduction) {
      console.log(`API server running on http://0.0.0.0:${env.port}`);
    }
  });
}

export default app;
