import type { FastifyInstance } from "fastify";
import { runDailyPush } from "../routes/push.js";

export function startPushScheduler(app: FastifyInstance): NodeJS.Timeout {
  const hour = Number(process.env.PUSH_DAILY_HOUR ?? 9);
  const minute = Number(process.env.PUSH_DAILY_MINUTE ?? 0);

  const timer = setInterval(async () => {
    const now = new Date();
    if (now.getHours() !== hour || now.getMinutes() !== minute) return;

    try {
      const result = await runDailyPush(app);
      app.log.info({ pushScheduler: true, result }, "daily push run finished");
    } catch (e) {
      app.log.error({ err: e }, "daily push run failed");
    }
  }, 60 * 1000);

  return timer;
}
