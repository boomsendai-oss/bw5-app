// src/lib/drive.ts — Node.js runtime 専用。Edge では動きません。
import { google, drive_v3 } from "googleapis";
import { Readable } from "node:stream";

function getDriveClient(): drive_v3.Drive {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("Google Drive の環境変数が未設定です (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN)");
  }
  const auth = new google.auth.OAuth2(clientId, clientSecret);
  auth.setCredentials({ refresh_token: refreshToken });
  return google.drive({ version: "v3", auth });
}

function bufferToStream(buf: Buffer): Readable {
  return Readable.from(buf);
}

export async function uploadPdfToFolder(folderId: string, filename: string, pdfBuffer: Buffer): Promise<{ fileId: string; webViewLink: string | null }> {
  const drive = getDriveClient();
  const res = await drive.files.create({
    requestBody: { name: filename, parents: [folderId] },
    media: { mimeType: "application/pdf", body: bufferToStream(pdfBuffer) },
    fields: "id, webViewLink",
    supportsAllDrives: true,
  });
  const fileId = res.data.id;
  if (!fileId) throw new Error("アップロード成功だが fileId が取得できませんでした");
  return { fileId, webViewLink: res.data.webViewLink ?? null };
}

export async function updatePdf(fileId: string, pdfBuffer: Buffer): Promise<void> {
  const drive = getDriveClient();
  await drive.files.update({
    fileId,
    media: { mimeType: "application/pdf", body: bufferToStream(pdfBuffer) },
    supportsAllDrives: true,
  });
}

export async function deleteFile(fileId: string): Promise<void> {
  const drive = getDriveClient();
  await drive.files.delete({ fileId, supportsAllDrives: true });
}
