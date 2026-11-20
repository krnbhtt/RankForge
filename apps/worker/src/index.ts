import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import {
  ScrapeTaskInputSchema,
  AnalyzeTaskInputSchema,
  RebuildTaskInputSchema,
  AuditErrorSchema,
} from '@rankforge/schema';
import { featureFlags } from '@rankforge/config';
import { tasksRouter } from './routes/tasks.js';

const app = express();
const PORT = Number(process.env.PORT) || 4050;

app.use(cors());
app.use(express.json());

// Mount tasks router (includes POST /internal/tasks/run)
app.use(tasksRouter);

// Request logging middleware
app.use((req: Request, _res: Response, next: NextFunction) => {
  const timestamp = new Date().toISOString();
  console.info(`[${timestamp}] ${req.method} ${req.url}`);
  next();
});

// Health check endpoint
app.get('/healthz', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    service: 'rf-worker',
    port: PORT,
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    featureFlags: {
      imageGeneration: featureFlags.IMAGE_GENERATION,
      visualCroAudit: featureFlags.VISUAL_CRO_AUDIT,
      runtimePatchMode: featureFlags.RUNTIME_PATCH_MODE,
      costCapInr: featureFlags.COST_CAP_INR,
    },
  });
});

// Task: Scrape Target Page & Extract AST
app.post('/tasks/scrape', (req: Request, res: Response) => {
  const parseResult = ScrapeTaskInputSchema.safeParse(req.body);

  if (!parseResult.success) {
    const errorPayload = AuditErrorSchema.parse({
      code: 'UserInputError',
      message: 'Invalid scrape task payload',
      recoveryAction: 'Verify that targetUrl is a valid HTTP/HTTPS URL and auditId is a UUID',
      details: { issues: parseResult.error.issues },
      timestamp: new Date().toISOString(),
    });
    return res.status(400).json({ success: false, error: errorPayload });
  }

  const { auditId, targetUrl, keyword } = parseResult.data;
  const taskId = `task_scrape_${Date.now()}`;

  console.info(`[Worker] Enqueued scrape task ${taskId} for audit ${auditId} (url: ${targetUrl})`);

  return res.status(202).json({
    success: true,
    taskId,
    auditId,
    targetUrl,
    keyword,
    status: 'queued',
    message: 'Scrape task received and queued for execution',
    queuedAt: new Date().toISOString(),
  });
});

// Task: Competitor Crawling & Gap Analysis
app.post('/tasks/analyze', (req: Request, res: Response) => {
  const parseResult = AnalyzeTaskInputSchema.safeParse(req.body);

  if (!parseResult.success) {
    const errorPayload = AuditErrorSchema.parse({
      code: 'UserInputError',
      message: 'Invalid analyze task payload',
      recoveryAction: 'Verify that auditId is a valid UUID',
      details: { issues: parseResult.error.issues },
      timestamp: new Date().toISOString(),
    });
    return res.status(400).json({ success: false, error: errorPayload });
  }

  const { auditId } = parseResult.data;
  const taskId = `task_analyze_${Date.now()}`;

  console.info(`[Worker] Enqueued analyze task ${taskId} for audit ${auditId}`);

  return res.status(202).json({
    success: true,
    taskId,
    auditId,
    status: 'queued',
    message: 'Analysis task received and queued for execution',
    queuedAt: new Date().toISOString(),
  });
});

// Task: Section-by-Section Rebuild & Scoring
app.post('/tasks/rebuild', (req: Request, res: Response) => {
  const parseResult = RebuildTaskInputSchema.safeParse(req.body);

  if (!parseResult.success) {
    const errorPayload = AuditErrorSchema.parse({
      code: 'UserInputError',
      message: 'Invalid rebuild task payload',
      recoveryAction: 'Verify that auditId is a valid UUID',
      details: { issues: parseResult.error.issues },
      timestamp: new Date().toISOString(),
    });
    return res.status(400).json({ success: false, error: errorPayload });
  }

  const { auditId } = parseResult.data;
  const taskId = `task_rebuild_${Date.now()}`;

  console.info(`[Worker] Enqueued rebuild task ${taskId} for audit ${auditId}`);

  return res.status(202).json({
    success: true,
    taskId,
    auditId,
    status: 'queued',
    message: 'Rebuild task received and queued for execution',
    queuedAt: new Date().toISOString(),
  });
});

// Global error handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[Worker] Unhandled error:', err);
  const errorPayload = AuditErrorSchema.parse({
    code: 'InternalError',
    message: err.message || 'An internal worker error occurred',
    recoveryAction: 'Check worker logs and retry the task',
    timestamp: new Date().toISOString(),
  });
  res.status(500).json({ success: false, error: errorPayload });
});

// Start listening if executed directly
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, '0.0.0.0', () => {
    console.info(`[Worker] RankForge Worker service listening on http://0.0.0.0:${PORT}`);
  });
}

export default app;
