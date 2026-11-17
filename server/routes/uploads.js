// File upload: .txt / .md / .docx converted to sanitized, editable content.
import express from 'express';
import multer from 'multer';
import { HttpError, h } from '../http.js';
import { fileToHtml } from '../content.js';

export function uploadRoutes({ docs, session, limiters, options }) {
  const { requireUser } = session;
  const { serializeDoc, insertDoc } = docs;
  const { maxUploadBytes } = options;
  const uploadLimiter = limiters.upload;
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: maxUploadBytes, files: 1 } });
  const router = express.Router();

  const singleFile = (req, res, next) =>
    upload.single('file')(req, res, (err) => {
      if (err?.code === 'LIMIT_FILE_SIZE') return next(new HttpError(413, `File is larger than ${Math.round(maxUploadBytes / 1024 / 1024)} MB`));
      if (err) return next(new HttpError(400, err.message));
      if (!req.file) return next(new HttpError(400, 'No file uploaded (field name must be "file")'));
      next();
    });

  // Upload a file -> brand new document owned by the uploader.
  router.post(
    '/documents/import',
    requireUser,
    uploadLimiter,
    singleFile,
    h(async (req, res) => {
      const { title, html, warnings } = await fileToHtml(req.file.originalname, req.file.buffer);
      const doc = await insertDoc(req.user.id, title, html, `Imported from ${req.file.originalname}`.slice(0, 200));
      res.status(201).json({ document: await serializeDoc(doc, 'owner'), warnings });
    })
  );

  // Upload a file -> sanitized HTML the client inserts into the open draft.
  router.post(
    '/convert',
    requireUser,
    uploadLimiter,
    singleFile,
    h(async (req, res) => {
      const { html, warnings } = await fileToHtml(req.file.originalname, req.file.buffer);
      res.json({ html, warnings });
    })
  );

  return router;
}
