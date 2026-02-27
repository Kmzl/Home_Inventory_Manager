import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export async function uploadRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/upload-image", async (request, reply) => {
    const body = z
      .object({
        fileName: z.string().min(1),
        mimeType: z.string().min(1),
        dataBase64: z.string().min(1),
        targetType: z.enum(["item", "location"]).default("item")
      })
      .parse(request.body);

    if (!body.mimeType.startsWith("image/")) {
      reply.code(400);
      return { error: "only image mime type allowed" };
    }

    const cleanName = sanitizeName(body.fileName);
    const ext = path.extname(cleanName) || (body.mimeType.includes("png") ? ".png" : ".jpg");
    const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;

    const uploadDir = path.resolve(process.cwd(), "../../data/uploads", body.targetType);
    fs.mkdirSync(uploadDir, { recursive: true });
    const filePath = path.join(uploadDir, fileName);

    const buffer = Buffer.from(body.dataBase64, "base64");
    if (buffer.length > 12 * 1024 * 1024) {
      reply.code(400);
      return { error: "image too large (max 12MB)" };
    }

    fs.writeFileSync(filePath, buffer);
    const url = `/uploads/${body.targetType}/${fileName}`;
    return { ok: true, url };
  });

  app.get("/uploads/:target/:file", async (request, reply) => {
    const p = request.params as { target: string; file: string };
    if (!["item", "location"].includes(p.target)) {
      reply.code(404);
      return { error: "not found" };
    }
    const safe = sanitizeName(p.file);
    const filePath = path.resolve(process.cwd(), "../../data/uploads", p.target, safe);
    if (!fs.existsSync(filePath)) {
      reply.code(404);
      return { error: "not found" };
    }
    return reply.send(fs.createReadStream(filePath));
  });
}
