/**
 * Taqdiri Protected Document & Export Storage Helper
 * Handles SHA-256 verification and Supabase private storage uploads for:
 * - Approved Tender Submission Excel workbooks (DEV-311)
 * - Supplier Quotation PDF / workbook attachments (DEV-302 / DEV-304)
 */

import { supabase } from "@/integrations/supabase/client";
import { isLocalDevelopment } from "@/lib/local-development";

const PRIVATE_BUCKET = "tender-documents";

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

  // Deterministic FNV-1a fallback when running outside WebCrypto
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

export async function uploadSubmissionArtifact(params: {
  projectId: string;
  tenderId: string;
  versionNo: number;
  fileName: string;
  bytes: Uint8Array;
  contentType?: string;
}): Promise<StoredDocumentResult> {
  const sha256 = await computeSha256Hex(params.bytes);
  const safeName = params.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storagePath = `submissions/${params.projectId}/${params.tenderId}/v${params.versionNo}_${safeName}`;

  if (isLocalDevelopment()) {
    return {
      storagePath: `local://${storagePath}`,
      sha256,
      byteSize: params.bytes.byteLength,
      uploadedToCloudStorage: false,
    };
  }

  try {
    const { error } = await supabase.storage
      .from(PRIVATE_BUCKET)
      .upload(storagePath, params.bytes, {
        contentType: params.contentType ?? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        upsert: false,
      });

    if (error) {
      return {
        storagePath: `archive-ref://${storagePath}`,
        sha256,
        byteSize: params.bytes.byteLength,
        uploadedToCloudStorage: false,
      };
    }

    return {
      storagePath,
      sha256,
      byteSize: params.bytes.byteLength,
      uploadedToCloudStorage: true,
    };
  } catch {
    return {
      storagePath: `archive-ref://${storagePath}`,
      sha256,
      byteSize: params.bytes.byteLength,
      uploadedToCloudStorage: false,
    };
  }
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
    return {
      storagePath: `local://${storagePath}`,
      sha256,
      byteSize: bytes.byteLength,
      uploadedToCloudStorage: false,
    };
  }

  try {
    const { error } = await supabase.storage
      .from(PRIVATE_BUCKET)
      .upload(storagePath, bytes, {
        contentType: params.file.type || "application/octet-stream",
        upsert: true,
      });
    return {
      storagePath: error ? `archive-ref://${storagePath}` : storagePath,
      sha256,
      byteSize: bytes.byteLength,
      uploadedToCloudStorage: !error,
    };
  } catch {
    return {
      storagePath: `archive-ref://${storagePath}`,
      sha256,
      byteSize: bytes.byteLength,
      uploadedToCloudStorage: false,
    };
  }
}
