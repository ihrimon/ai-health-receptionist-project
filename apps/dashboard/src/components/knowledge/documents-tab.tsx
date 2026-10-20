"use client";

import { KNOWLEDGE_LIMITS } from "@brainstack/shared";
import { FileUp, RotateCw, Trash2 } from "lucide-react";
import { cn } from "cn";
import { useRef, useState, type DragEvent } from "react";
import { Button } from "@/components/ui/button";
import {
  checkUpload,
  formatBytes,
  type KnowledgeSource,
  knowledgeApi,
  limitInfo,
} from "@/lib/knowledge";
import { toastError, toastSuccess } from "@/lib/toast";
import { ConfirmDelete, EmptyState, type TabBase, TabHeader } from "./shared";
import { StatusBadge } from "./status-badge";

const ACCEPT = ".pdf,.docx,.txt,.md";

/**
 * Documents tab (D-3 §3.3): upload PDF, Word, TXT or Markdown files; each
 * is read and indexed in the background, with its status shown live.
 */
export function DocumentsTab({
  documents,
  canEdit,
  onChanged,
  onUploaded,
}: TabBase & {
  documents: KnowledgeSource[];
  /** Called with each stored document so it shows up before the next one starts. */
  onUploaded: (source: KnowledgeSource) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<KnowledgeSource | null>(null);
  const limit = limitInfo(documents.length, KNOWLEDGE_LIMITS.documents);

  async function upload(files: FileList | null) {
    if (!files) return;
    let count = documents.length;
    for (const file of Array.from(files)) {
      const problem = checkUpload(file, count);
      if (problem) {
        toastError(problem);
        continue;
      }
      setUploading(file.name);
      try {
        onUploaded(await knowledgeApi.uploadDocument(file));
        count++;
        toastSuccess(`"${file.name}" uploaded. Reading it now…`);
      } catch (err) {
        toastError(`"${file.name}": ${(err as Error).message}`);
      }
    }
    setUploading(null);
    if (input.current) input.current.value = "";
    // A failed refresh must not hide what was uploaded: each file is
    // already in the list, and the status check keeps it current.
    await onChanged().catch(() => {});
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (canEdit) void upload(e.dataTransfer.files);
  }

  return (
    <div className="grid gap-4">
      <TabHeader
        title="Documents"
        description="Upload manuals, price lists or catalogues. The bot reads them and answers from their text."
        limit={limit.label}
      />

      {canEdit && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            "flex flex-col items-center gap-2 rounded-lg border-2 border-dashed p-6 text-center text-sm transition-colors",
            dragging && "border-primary bg-primary/5",
            limit.full && "opacity-60",
          )}
        >
          <FileUp className="size-6 text-muted-foreground" />
          {uploading ? (
            <p>Uploading &ldquo;{uploading}&rdquo;…</p>
          ) : (
            <>
              <p>
                Drag files here, or{" "}
                <button
                  type="button"
                  className="text-primary underline"
                  disabled={limit.full}
                  onClick={() => input.current?.click()}
                >
                  choose files
                </button>
              </p>
              <p className="text-xs text-muted-foreground">
                PDF, Word (.docx), TXT or Markdown · up to 10 MB each
              </p>
            </>
          )}
          <input
            ref={input}
            type="file"
            accept={ACCEPT}
            multiple
            hidden
            onChange={(e) => void upload(e.target.files)}
          />
        </div>
      )}

      {documents.length === 0 ? (
        <EmptyState
          title="No documents yet"
          example="A price list PDF or a product manual works well. Scanned pages (pictures of text) can't be read yet."
        />
      ) : (
        <ul className="divide-y rounded-lg border">
          {documents.map((doc) => (
            <li key={doc.id} className="flex items-start gap-3 p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{doc.title}</p>
                <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="truncate">{doc.fileName}</span>
                  <span>{formatBytes(doc.fileSize)}</span>
                  <StatusBadge status={doc.status} />
                </p>
                {doc.error && (
                  <p className="mt-1 text-xs text-destructive">{doc.error}</p>
                )}
              </div>
              {canEdit && (
                <div className="flex shrink-0 gap-1">
                  {doc.status === "FAILED" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        knowledgeApi
                          .reindexSource(doc.id)
                          .then(onChanged, (e: Error) => toastError(e.message))
                      }
                    >
                      <RotateCw /> Retry
                    </Button>
                  )}
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Delete"
                    onClick={() => setDeleting(doc)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <ConfirmDelete
        what={deleting ? `"${deleting.title}"` : null}
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          await knowledgeApi.deleteSource(deleting!.id);
          await onChanged();
          toastSuccess("Document deleted.");
        }}
      />
    </div>
  );
}
