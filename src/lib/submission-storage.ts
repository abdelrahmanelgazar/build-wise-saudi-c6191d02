/**
 * Taqdiri Protected Document & Export Storage Helper
 * Handles SHA-256 verification, separated staging/committed artifact storage,
 * read-back proof verification, and time-limited signed URL retrieval for:
 * - Staged & Approved Tender Submission Excel workbooks (DEV-311)
 * - Supplier Quotation PDF / workbook attachments (DEV-302 / DEV-304)
 */

import { supabase } from "@/integrations/supabase/client";
import { isLocalDevelopment } from "@/lib/local-development";

const PRIVATE_BUCKET = "tender-documents";
const LOCAL_ARTIFACT_PREFIX = "taqdiri:artifact:";
const memoryArtifactStore = new Map<string, { b64: string; sha256: string; contentType: string; fileName: string }>();

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export async function computeSha256Hex(bytes: Uint8Array | ArrayBuffer | string): Promise<string> {
  const buffer =
    typeof bytes === "string"
      ? new TextEncoder().encode(bytes)
      : bytes instanceof Uint8Array
        ? bytes
        : new Uint8Array(bytes);

  if (globalThis.crypto?.subtle) {
    const cleanBuf = new Uint8Array(buffer.byteLength);
    cleanBuf.set(buffer);
    const digest = await globalThis.crypto.subtle.digest("SHA-256", cleanBuf.buffer);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  let h = 2166136261;
  for (let i = 0; i < buffer.length; i++) {
    h ^= buffer[i]!;
    h = Math.imul(h, 16777619);
  }
  return `fnv_${(h >>> 0).toString(16)}`;
}

export interface StoredDocumentResult {
  storagePath: string;
  sha256: string;
  byteSize: number;
  uploadedToCloudStorage: boolean;
}

function saveLocalArtifact(storagePath: string, bytes: Uint8Array, sha256: string, contentType: string, fileName: string) {
  const rec = { b64: bytesToBase64(bytes), sha256, contentType, fileName };
  memoryArtifactStore.set(storagePath, rec);
  try {
    if (typeof window !== "undefined" && window.localStorage && bytes.byteLength < 2_500_000) {
      window.localStorage.setItem(`${LOCAL_ARTIFACT_PREFIX}${storagePath}`, JSON.stringify(rec));
    }
  } catch {
    // ignore quota errors; memory store retains bytes for current session
  }
}

export function readLocalArtifactBytes(storagePath: string): { bytes: Uint8Array; sha256: string; contentType: string; fileName: string } | null {
  const cleanKey = storagePath.replace(/^local:\/\//, "");
  const mem = memoryArtifactStore.get(storagePath) ?? memoryArtifactStore.get(cleanKey);
  if (mem) {
    return { bytes: base64ToBytes(mem.b64), sha256: mem.sha256, contentType: mem.contentType, fileName: mem.fileName };
  }
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      const raw =
        window.localStorage.getItem(`${LOCAL_ARTIFACT_PREFIX}${storagePath}`) ??
        window.localStorage.getItem(`${LOCAL_ARTIFACT_PREFIX}${cleanKey}`);
      if (raw) {
        const parsed = JSON.parse(raw) as { b64: string; sha256: string; contentType: string; fileName: string };
        return {
          bytes: base64ToBytes(parsed.b64),
          sha256: parsed.sha256,
          contentType: parsed.contentType,
          fileName: parsed.fileName,
        };
      }
    }
  } catch {
    // ignore storage parse failure
  }
  return null;
}

/**
 * Uploads verified submission bytes into an isolated `staging/` prefix inside private bucket `tender-documents`.
 * Never falls back to an unbacked fake path when upload fails so callers can abort locking cleanly.
 */
export async function uploadStagingArtifact(params: {
  projectId: string;
  tenderId: string;
  stagingId: string;
  fileName: string;
  bytes: Uint8Array;
  contentType?: string;
  simulateUploadFailure?: boolean;
}): Promise<StoredDocumentResult> {
  if (params.simulateUploadFailure) {
    throw new Error("STORAGE_UPLOAD_FAILED: تعذر رفع ملف التجهيز إلى المخزن الخاص — لم يتم قفل العطاء ويمكنك إعادة المحاولة.");
  }

  const sha256 = await computeSha256Hex(params.bytes);
  const safeName = params.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const rawPath = `staging/${params.projectId}/${params.tenderId}/${params.stagingId}_${safeName}`;
  const contentType =
    params.contentType ?? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

  if (isLocalDevelopment()) {
    const localPath = `local://${rawPath}`;
    saveLocalArtifact(localPath, params.bytes, sha256, contentType, safeName);
    return {
      storagePath: localPath,
      sha256,
      byteSize: params.bytes.byteLength,
      uploadedToCloudStorage: false,
    };
  }

  const { error } = await supabase.storage
    .from(PRIVATE_BUCKET)
    .upload(rawPath, params.bytes, {
      contentType,
      upsert: false,
    });

  if (error) {
    throw new Error(`STORAGE_UPLOAD_FAILED: ${error.message}`);
  }

  return {
    storagePath: rawPath,
    sha256,
    byteSize: params.bytes.byteLength,
    uploadedToCloudStorage: true,
  };
}

/**
 * Reads back stored bytes from private storage (or local verified store) and proves SHA-256 matches.
 */
export async function verifyStoredArtifactExistsAndHash(params: {
  storagePath: string;
  expectedSha256: string;
  simulateReadbackMismatch?: boolean;
}): Promise<{ verified: boolean; actualSha256: string; byteSize: number }> {
  if (params.simulateReadbackMismatch) {
    throw new Error("STORAGE_HASH_MISMATCH: عدم تطابق بصمة الملف المرفوع مع البايتات المتحقّق منها.");
  }

  if (params.storagePath.startsWith("local://")) {
    const artifact = readLocalArtifactBytes(params.storagePath);
    if (!artifact) {
      throw new Error("STORAGE_MISSING: ملف التجهيز غير موجود في المخزن المحلي.");
    }
    const actualSha256 = await computeSha256Hex(artifact.bytes);
    if (actualSha256 !== params.expectedSha256) {
      throw new Error(`STORAGE_HASH_MISMATCH: expected ${params.expectedSha256}, actual ${actualSha256}`);
    }
    return { verified: true, actualSha256, byteSize: artifact.bytes.byteLength };
  }

  const { data, error } = await supabase.storage.from(PRIVATE_BUCKET).download(params.storagePath);
  if (error || !data) {
    throw new Error(`STORAGE_READBACK_FAILED: ${error?.message || "ملف التجهيز غير متاح للاسترجاع"}`);
  }
  const bytes = new Uint8Array(await data.arrayBuffer());
  const actualSha256 = await computeSha256Hex(bytes);
  if (actualSha256 !== params.expectedSha256) {
    throw new Error(`STORAGE_HASH_MISMATCH: expected ${params.expectedSha256}, actual ${actualSha256}`);
  }
  return { verified: true, actualSha256, byteSize: bytes.byteLength };
}

export async function cleanupOrphanedStagingArtifact(storagePath: string): Promise<void> {
  if (!storagePath.includes("staging/")) return;
  if (storagePath.startsWith("local://")) {
    memoryArtifactStore.delete(storagePath);
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        window.localStorage.removeItem(`${LOCAL_ARTIFACT_PREFIX}${storagePath}`);
      }
    } catch {
      // ignore
    }
    return;
  }
  try {
    await supabase.storage.from(PRIVATE_BUCKET).remove([storagePath]);
  } catch {
    // non-fatal cleanup failure
  }
}

/**
 * Retrieves an approved submission file from storage and verifies its SHA-256 against the locked snapshot.
 * In hosted mode creates a time-limited signed URL (60s) AND verifies downloaded bytes.
 */
export async function retrieveSubmissionArtifact(params: {
  storagePath?: string | null;
  expectedSha256?: string | null;
  hasVerifiedFileProof?: boolean;
}): Promise<{
  verified: boolean;
  sha256: string;
  byteSize: number;
  bytes?: Uint8Array;
  signedUrl?: string;
  fileName: string;
}> {
  if (!params.storagePath || params.storagePath.startsWith("archive-ref://") || params.hasVerifiedFileProof === false) {
    throw new Error(
      "LEGACY_SNAPSHOT_NO_FILE_PROOF: لقطة التقديم هذه محفوظة قبل تفعيل أرشفة الملف الموثق في المخزن الخاص ولا يتوفر لها ملف ثنائي مسترد.",
    );
  }

  const fileName = params.storagePath.split("/").pop() || "Taqdiri_Submission.xlsx";

  if (params.storagePath.startsWith("local://")) {
    const artifact = readLocalArtifactBytes(params.storagePath);
    if (!artifact) {
      throw new Error("STORAGE_MISSING: تعذر استرجاع بايتات الملف المخزن محلياً.");
    }
    const sha256 = await computeSha256Hex(artifact.bytes);
    if (params.expectedSha256 && sha256 !== params.expectedSha256) {
      throw new Error(`STORAGE_HASH_MISMATCH: بصمة الملف المسترجع (${sha256}) لا تطابق البصمة المعتمدة (${params.expectedSha256}).`);
    }
    return {
      verified: true,
      sha256,
      byteSize: artifact.bytes.byteLength,
      bytes: artifact.bytes,
      fileName: artifact.fileName || fileName,
    };
  }

  const [{ data: signedData, error: signErr }, { data: blob, error: dlErr }] = await Promise.all([
    supabase.storage.from(PRIVATE_BUCKET).createSignedUrl(params.storagePath, 60),
    supabase.storage.from(PRIVATE_BUCKET).download(params.storagePath),
  ]);

  if (dlErr || !blob) {
    throw new Error(`STORAGE_RETRIEVE_FAILED: ${dlErr?.message || signErr?.message || "تعذر تنزيل الملف من المخزن الخاص"}`);
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const sha256 = await computeSha256Hex(bytes);
  if (params.expectedSha256 && sha256 !== params.expectedSha256) {
    throw new Error(`STORAGE_HASH_MISMATCH: بصمة الملف المسترجع (${sha256}) لا تطابق البصمة المعتمدة (${params.expectedSha256}).`);
  }

  return {
    verified: true,
    sha256,
    byteSize: bytes.byteLength,
    bytes,
    ...(signedData?.signedUrl ? { signedUrl: signedData.signedUrl } : {}),
    fileName,
  };
}

/** Legacy direct submission upload helper preserved for backward compatibility */
export async function uploadSubmissionArtifact(params: {
  projectId: string;
  tenderId: string;
  versionNo: number;
  fileName: string;
  bytes: Uint8Array;
  contentType?: string;
}): Promise<StoredDocumentResult> {
  return uploadStagingArtifact({
    projectId: params.projectId,
    tenderId: params.tenderId,
    stagingId: `v${params.versionNo}`,
    fileName: params.fileName,
    bytes: params.bytes,
    ...(params.contentType ? { contentType: params.contentType } : {}),
  });
}

export async function uploadQuoteDocumentAttachment(params: {
  projectId: string;
  quoteId: string;
  file: File;
}): Promise<StoredDocumentResult> {
  const arrBuf = await params.file.arrayBuffer();
  const bytes = new Uint8Array(arrBuf);
  const sha256 = await computeSha256Hex(bytes);
  const safeName = params.file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storagePath = `quotes/${params.projectId}/${params.quoteId}/${safeName}`;

  if (isLocalDevelopment()) {
    const localPath = `local://${storagePath}`;
    saveLocalArtifact(localPath, bytes, sha256, params.file.type || "application/octet-stream", safeName);
    return {
      storagePath: localPath,
      sha256,
      byteSize: bytes.byteLength,
      uploadedToCloudStorage: false,
    };
  }

  const { error } = await supabase.storage
    .from(PRIVATE_BUCKET)
    .upload(storagePath, bytes, {
      contentType: params.file.type || "application/octet-stream",
      upsert: true,
    });
  if (error) {
    throw new Error(`QUOTE_UPLOAD_FAILED: ${error.message}`);
  }
  return {
    storagePath,
    sha256,
    byteSize: bytes.byteLength,
    uploadedToCloudStorage: true,
  };
}
