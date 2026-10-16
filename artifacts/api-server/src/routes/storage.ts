import { Readable } from "node:stream";
import { Router, type IRouter } from "express";
import {
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";
import {
  ObjectNotFoundError,
  ObjectStorageService,
} from "../lib/objectStorage";

const router: IRouter = Router();
const objectStorage = new ObjectStorageService();

router.post(
  "/storage/uploads/request-url",
  requireAuth,
  async (req, res): Promise<void> => {
    const parsed = RequestUploadUrlBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Choose a supported file up to 10 MB." });
      return;
    }
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Sign in to continue." });
      return;
    }

    try {
      const uploadURL = await objectStorage.getObjectEntityUploadURL(user.id);
      const objectPath = objectStorage.normalizeObjectEntityPath(uploadURL);
      res.json(RequestUploadUrlResponse.parse({ uploadURL, objectPath }));
    } catch (error) {
      req.log.error({ err: error }, "Could not prepare private file upload");
      res
        .status(503)
        .json({ error: "File uploads are temporarily unavailable. Try again later." });
    }
  },
);

router.get(
  "/storage/objects/*path",
  requireAuth,
  async (req, res): Promise<void> => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Sign in to continue." });
      return;
    }
    const rawPath = req.params.path;
    const entityPath = Array.isArray(rawPath) ? rawPath.join("/") : rawPath;
    if (!user.isAdmin && !entityPath.startsWith(`uploads/${user.id}/`)) {
      res.status(403).json({ error: "You do not have access to this file." });
      return;
    }

    try {
      const file = await objectStorage.getObjectEntityFile(`/objects/${entityPath}`);
      const response = await objectStorage.downloadObject(file);
      res.status(response.status);
      response.headers.forEach((value, key) => res.setHeader(key, value));
      if (response.body) {
        Readable.fromWeb(
          response.body as ReadableStream<Uint8Array>,
        ).pipe(res);
      } else {
        res.end();
      }
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        res.status(404).json({ error: "File not found." });
        return;
      }
      req.log.error({ err: error }, "Could not read private file");
      res.status(500).json({ error: "Could not read file." });
    }
  },
);

export default router;
