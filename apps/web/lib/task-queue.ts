import type { RunAuditTaskPayload } from '@rankforge/schema';

export async function enqueueAuditTask(payload: RunAuditTaskPayload): Promise<void> {
  const workerUrl = process.env.WORKER_URL || 'http://localhost:4050';
  const tasksQueue = process.env.TASKS_QUEUE;
  const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.PROJECT_ID;

  if (tasksQueue && projectId) {
    try {
      // Dynamic import to avoid missing module crash in offline environments
      const tasksPackage = '@google-cloud/tasks';
      const { CloudTasksClient } = await import(/* webpackIgnore: true */ tasksPackage);
      const client = new CloudTasksClient();
      const location = process.env.TASKS_LOCATION || 'asia-south1';
      const parent = client.queuePath(projectId, location, tasksQueue);
      const serviceAccountEmail =
        process.env.TASKS_SA || `rf-tasks@${projectId}.iam.gserviceaccount.com`;

      const task = {
        httpRequest: {
          httpMethod: 'POST' as const,
          url: `${workerUrl}/internal/tasks/run`,
          headers: { 'Content-Type': 'application/json' },
          body: Buffer.from(JSON.stringify(payload)).toString('base64'),
          oidcToken: {
            serviceAccountEmail,
            audience: workerUrl,
          },
          dispatchDeadline: { seconds: 900 },
        },
      };

      await client.createTask({ parent, task });
      console.info(`[TaskQueue] Cloud Task created for audit ${payload.auditId} (900s deadline)`);
      return;
    } catch (err) {
      console.warn(
        `[TaskQueue] Cloud Tasks dispatch failed, falling back to local dispatch:`,
        (err as Error).message
      );
    }
  }

  // Local Development Fallback: unawaited asynchronous HTTP POST to worker
  const localTarget = `${workerUrl}/internal/tasks/run`;
  console.info(`[TaskQueue] Dispatching local worker task for audit ${payload.auditId} to ${localTarget}`);

  // Intentionally unawaited (fire-and-forget) so ingress API returns immediately
  fetch(localTarget, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-local-dev': 'true',
    },
    body: JSON.stringify(payload),
  }).catch((err) => {
    console.warn(`[TaskQueue] Local worker unreachable at ${localTarget}:`, (err as Error).message);
  });
}
