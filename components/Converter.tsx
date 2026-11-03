"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, DragEvent } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  AlertTriangle,
  ArrowUpDown,
  CheckCircle2,
  ChevronDown,
  Download,
  Eye,
  GripVertical,
  Loader2,
  Plus,
  RotateCw,
  Trash2,
  UploadCloud,
  X,
  XCircle,
} from "lucide-react";

/* ---------- Types & constants ---------- */

type Item = {
  id: string;
  key: string; // name + size, used for duplicate detection
  name: string;
  url: string;
  width: number;
  height: number;
  rotation: number; // 0 | 90 | 180 | 270
  modified: number; // file.lastModified (ms), used by "Auto Sort"
};

type Orientation = "portrait" | "landscape" | "auto";
type Margin = "none" | "small" | "big";
type PageSize = "auto" | "a4" | "letter";
type Quality = "high" | "balanced" | "compressed";
type SortBy = "name" | "date";

type Layout = {
  pageSize: PageSize;
  orientation: Orientation;
  margin: Margin;
};

type Watermark = { canvas: HTMLCanvasElement; data: string; w: number; h: number };
type PreviewPage = { id: string; index: number; src: string };
type Progress = { done: number; total: number; label: string };
type ToastState = {
  id: number;
  type: "success" | "error";
  title: string;
  detail?: string;
};

const MARGINS: Record<Margin, number> = { none: 0, small: 20, big: 50 };
const SIZES: Record<Exclude<PageSize, "auto">, [number, number]> = {
  a4: [595.28, 841.89],
  letter: [612, 792],
};

/** JPEG quality + max effective DPI for each export quality level. */
const QUALITY: Record<Quality, { jpeg: number; dpi: number }> = {
  high: { jpeg: 0.95, dpi: 300 },
  balanced: { jpeg: 0.8, dpi: 200 },
  compressed: { jpeg: 0.55, dpi: 120 },
};

const MAX_CANVAS = 4096;
const ACCEPT = "image/*,.heic,.heif";
const DEFAULT_NAME = "hawelly-images";
const WM_FONT_PX = 72;
const PREVIEW_CAP = 1600;
const PREVIEW_WIDTH = 900;

/* ---------- Helpers ---------- */

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
const ext = (n: string) => n.split(".").pop()?.toLowerCase() ?? "";
const isHeic = (f: File) =>
  /image\/hei[cf]/.test(f.type) || ["heic", "heif"].includes(ext(f.name));
const isSupported = (f: File) => f.type.startsWith("image/") || isHeic(f);
const fileKey = (f: File) => `${f.name}::${f.size}`;

const summarize = (names: string[]) =>
  `${names.slice(0, 3).join(", ")}${
    names.length > 3 ? ` +${names.length - 3} more` : ""
  }`;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const formatBytes = (b: number) =>
  b < 1024 * 1024
    ? `${Math.max(1, Math.round(b / 1024))} KB`
    : `${(b / (1024 * 1024)).toFixed(b < 10 * 1024 * 1024 ? 1 : 0)} MB`;

function cleanFilename(raw: string) {
  const name = raw
    .replace(/\.pdf$/i, "")
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .slice(0, 80)
    .trim();
  return name || DEFAULT_NAME;
}

/** Lets React paint (progress bar) without stalling in background tabs. */
const paint = () =>
  new Promise<void>((resolve) => {
    const fallback = setTimeout(resolve, 50);
    requestAnimationFrame(() =>
      setTimeout(() => {
        clearTimeout(fallback);
        resolve();
      }, 0)
    );
  });

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = src;
  });

async function prepareFile(file: File, key: string): Promise<Item> {
  let blob: Blob = file;
  if (isHeic(file)) {
    const heic2any = (await import("heic2any")).default;
    const out = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.92 });
    blob = Array.isArray(out) ? out[0] : out;
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    return {
      id: uid(),
      key,
      name: file.name,
      url,
      width: img.naturalWidth || 1024,
      height: img.naturalHeight || 1024,
      rotation: 0,
      modified: file.lastModified || 0,
    };
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
}

/** Size (px) of the image as rendered to canvas (after rotation), limited to `cap`. */
function renderedSize(item: Item, cap = MAX_CANVAS) {
  const base = Math.min(1, cap / Math.max(item.width, item.height));
  const dw = Math.max(1, Math.round(item.width * base));
  const dh = Math.max(1, Math.round(item.height * base));
  const swap = item.rotation % 180 !== 0;
  return { dw, dh, w: swap ? dh : dw, h: swap ? dw : dh };
}

/** Page size (pt) for an image of w×h px. Shared by thumbnails, preview and PDF. */
function pageDims(
  w: number,
  h: number,
  pageSize: PageSize,
  orientation: Orientation,
  m: number
): [number, number] {
  if (pageSize === "auto") {
    const s = Math.min(1, 3000 / Math.max(w, h)) * 0.75; // px → pt
    return [w * s + 2 * m, h * s + 2 * m];
  }
  let [pw, ph] = SIZES[pageSize];
  const landscape = orientation === "landscape" || (orientation === "auto" && w > h);
  if (landscape) [pw, ph] = [ph, pw];
  return [pw, ph];
}

/** Image box (pt) inside the page margins. The image always keeps its ratio. */
function placeImage(pw: number, ph: number, m: number, w: number, h: number) {
  const aw = Math.max(pw - 2 * m, 1);
  const ah = Math.max(ph - 2 * m, 1);
  const scale = Math.min(aw / w, ah / h);
  return { w: w * scale, h: h * scale };
}

/** Single source of truth for how one image sits on its page. */
function layoutPage(item: Item, layout: Layout) {
  const { w, h } = renderedSize(item);
  const m = MARGINS[layout.margin];
  const [pw, ph] = pageDims(w, h, layout.pageSize, layout.orientation, m);
  const box = placeImage(pw, ph, m, w, h);
  return { pw, ph, m, box };
}

/** Largest useful pixel size for the placed image (caps effective DPI). */
function exportCap(box: { w: number; h: number }, dpi: number) {
  const px = Math.ceil((Math.max(box.w, box.h) * dpi) / 72);
  return Math.min(MAX_CANVAS, Math.max(256, px));
}

async function renderCanvas(item: Item, cap = MAX_CANVAS) {
  const img = await loadImage(item.url);
  const { dw, dh, w, h } = renderedSize(item, cap);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.translate(w / 2, h / 2);
  ctx.rotate((item.rotation * Math.PI) / 180);
  ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return canvas;
}

/** Transparent, diagonal, low-opacity watermark (canvas text → supports any script). */
function makeWatermark(text: string): Watermark | null {
  const t = text.trim();
  if (!t) return null;
  const font = `600 ${WM_FONT_PX}px system-ui, "Segoe UI", Arial, sans-serif`;
  const measure = document.createElement("canvas").getContext("2d");
  if (!measure) return null;
  measure.font = font;
  const tw = Math.ceil(measure.measureText(t).width);
  const th = Math.ceil(WM_FONT_PX * 1.3);
  const angle = (-30 * Math.PI) / 180;
  const cos = Math.abs(Math.cos(angle));
  const sin = Math.abs(Math.sin(angle));
  const w = Math.ceil(tw * cos + th * sin) + 8;
  const h = Math.ceil(tw * sin + th * cos) + 8;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.translate(w / 2, h / 2);
  ctx.rotate(angle);
  ctx.font = font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(71, 85, 105, 0.22)";
  ctx.fillText(t, 0, 0);
  return { canvas, data: canvas.toDataURL("image/png"), w, h };
}

/** Centered watermark placement (pt) for a page of pw×ph. */
function placeWatermark(pw: number, ph: number, wm: { w: number; h: number }) {
  const sizeBound = (0.7 * Math.min(pw, ph)) / Math.max(wm.w, wm.h);
  const fontBound = (0.09 * Math.min(pw, ph)) / WM_FONT_PX;
  const s = Math.min(sizeBound, fontBound);
  const w = wm.w * s;
  const h = wm.h * s;
  return { x: (pw - w) / 2, y: (ph - h) / 2, w, h };
}

async function renderPreviewPage(
  item: Item,
  index: number,
  layout: Layout,
  wm: Watermark | null
): Promise<PreviewPage> {
  const { pw, ph, box } = layoutPage(item, layout);
  const k = Math.min(PREVIEW_WIDTH / pw, 3000 / ph);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(pw * k));
  canvas.height = Math.max(1, Math.round(ph * k));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const src = await renderCanvas(item, PREVIEW_CAP);
  ctx.drawImage(src, ((pw - box.w) / 2) * k, ((ph - box.h) / 2) * k, box.w * k, box.h * k);
  src.width = src.height = 0;

  if (wm) {
    const p = placeWatermark(pw, ph, wm);
    ctx.drawImage(wm.canvas, p.x * k, p.y * k, p.w * k, p.h * k);
  }
  return { id: item.id, index, src: canvas.toDataURL("image/jpeg", 0.88) };
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/* ---------- Small UI pieces ---------- */

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
  hint,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <div className={disabled ? "opacity-50" : ""}>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate2-400">
        {label}
      </p>
      <div className="grid grid-flow-col auto-cols-fr rounded-lg border border-white/10 bg-charcoal-900 p-1">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            disabled={disabled}
            aria-pressed={value === o.value}
            onClick={() => onChange(o.value)}
            className={`rounded-md px-3 py-2 text-sm font-medium transition ${
              value === o.value
                ? "bg-white text-navy-900"
                : "text-slate2-400 hover:text-white"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
      {hint && <p className="mt-1 text-xs text-slate2-500">{hint}</p>}
    </div>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  onBlur,
  placeholder,
  maxLength,
  suffix,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  maxLength?: number;
  suffix?: string;
  hint?: string;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate2-400"
      >
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type="text"
          dir="auto"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          placeholder={placeholder}
          maxLength={maxLength}
          autoComplete="off"
          spellCheck={false}
          className={`w-full rounded-lg border border-white/10 bg-charcoal-900 py-2.5 pl-3 text-sm text-white transition placeholder:text-slate2-500 focus:border-white/40 focus:outline-none focus:ring-2 focus:ring-white/10 ${
            suffix ? "pr-14" : "pr-3"
          }`}
        />
        {suffix && (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate2-500">
            {suffix}
          </span>
        )}
      </div>
      {hint && <p className="mt-1 text-xs text-slate2-500">{hint}</p>}
    </div>
  );
}

function ProgressBar({ label, value }: { label: string; value: number }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div
      className="w-full"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
    >
      <div className="mb-1.5 flex items-center justify-between gap-3 text-xs text-slate2-400">
        <span>{label}</span>
        <span className="tabular-nums">{pct}%</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-charcoal-900 ring-1 ring-white/10">
        <div
          className="h-full rounded-full bg-gradient-to-r from-slate2-400 via-slate-200 to-white transition-[width] duration-300 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function Toast({ toast, onClose }: { toast: ToastState; onClose: () => void }) {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setShown(true));
    const timer = setTimeout(onClose, 5000);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, [onClose]);

  const ok = toast.type === "success";
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[70] flex justify-center px-4 sm:bottom-6">
      <div
        role="status"
        aria-live="polite"
        className={`pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-xl border bg-navy-800 px-4 py-3 shadow-2xl transition-all duration-300 ${
          ok ? "border-emerald-400/30" : "border-red-500/40"
        } ${shown ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"}`}
      >
        {ok ? (
          <CheckCircle2 size={20} className="mt-0.5 shrink-0 text-emerald-400" />
        ) : (
          <XCircle size={20} className="mt-0.5 shrink-0 text-red-400" />
        )}
        <div className="min-w-0 flex-1">
          <p dir="auto" className="text-sm font-semibold text-white">
            {toast.title}
          </p>
          {toast.detail && (
            <p className="mt-0.5 break-words text-xs text-slate2-400">{toast.detail}</p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Dismiss notification"
          className="rounded-md p-1 text-slate2-400 hover:bg-white/10 hover:text-white"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}

function PreviewModal({
  open,
  pages,
  total,
  onClose,
  onDownload,
}: {
  open: boolean;
  pages: PreviewPage[];
  total: number;
  onClose: () => void;
  onDownload: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  const rendering = pages.length < total;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="PDF preview"
      className="fixed inset-0 z-50 flex flex-col bg-charcoal-900/95 backdrop-blur-sm"
    >
      <div className="flex items-center justify-between gap-3 border-b border-white/10 bg-navy-900/90 px-4 py-3 sm:px-6">
        <div className="min-w-0">
          <h2 className="truncate text-base font-bold">PDF preview</h2>
          <p className="text-xs text-slate2-400">
            {rendering
              ? `Rendering ${pages.length} of ${plural(total, "page")}…`
              : plural(total, "page")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onDownload}
            className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-bold text-navy-900 transition hover:bg-slate-200"
          >
            <Download size={16} />
            <span className="hidden sm:inline">Download PDF</span>
            <span className="sm:hidden">Download</span>
          </button>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close preview"
            className="rounded-lg border border-white/15 p-2 text-slate2-400 transition hover:bg-white/10 hover:text-white"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      <div
        className="flex-1 overflow-y-auto px-4 py-6 sm:px-6"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div className="mx-auto flex max-w-3xl flex-col items-center gap-6">
          {pages.map((p) => (
            <figure key={p.id} className="w-full">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={p.src}
                alt={`Page ${p.index + 1}`}
                className="mx-auto h-auto max-h-[85vh] w-auto max-w-full bg-white shadow-2xl ring-1 ring-white/10"
              />
              <figcaption className="mt-2 text-center text-xs text-slate2-400">
                Page {p.index + 1} of {total}
              </figcaption>
            </figure>
          ))}
          {rendering && (
            <div className="w-full max-w-md py-4">
              <ProgressBar
                label={`Rendering page ${pages.length + 1} of ${total}…`}
                value={pages.length / Math.max(1, total)}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Thumb({
  item,
  index,
  layout,
  onRotate,
  onDelete,
}: {
  item: Item;
  index: number;
  layout: Layout;
  onRotate: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  /* Live PDF page simulation (percentages only, so it always stays inside the
     square preview area of the card). */
  const { pw, ph, box } = layoutPage(item, layout);
  const pageW = pw >= ph ? 100 : (pw / ph) * 100;
  const pageH = pw >= ph ? (ph / pw) * 100 : 100;
  const swap = item.rotation % 180 !== 0;

  const imgStyle: CSSProperties = {
    width: swap ? `${(box.h / box.w) * 100}%` : "100%",
    height: swap ? `${(box.w / box.h) * 100}%` : "100%",
    transform: `translate(-50%, -50%) rotate(${item.rotation}deg)`,
  };

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 20 : undefined,
      }}
      className={`group relative overflow-hidden rounded-xl border bg-charcoal-900 ${
        isDragging ? "border-white shadow-2xl" : "border-white/10"
      }`}
    >
      <div className="relative aspect-square">
        <div className="absolute inset-2">
          {/* Simulated PDF page */}
          <div
            className="absolute left-1/2 top-1/2 bg-white shadow-md ring-1 ring-black/20"
            style={{
              width: `${pageW}%`,
              height: `${pageH}%`,
              transform: "translate(-50%, -50%)",
            }}
          >
            {/* Image box = page minus margins (the image keeps its ratio) */}
            <div
              className="absolute left-1/2 top-1/2"
              style={{
                width: `${(box.w / pw) * 100}%`,
                height: `${(box.h / ph) * 100}%`,
                transform: "translate(-50%, -50%)",
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={item.url}
                alt={item.name}
                draggable={false}
                className="absolute left-1/2 top-1/2 max-w-none select-none object-fill"
                style={imgStyle}
              />
            </div>
          </div>
        </div>
      </div>

      <span className="absolute left-2 top-2 rounded-md bg-navy-900/90 px-2 py-0.5 text-xs font-semibold">
        {index + 1}
      </span>

      <button
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label="Drag to reorder"
        className="absolute right-2 top-2 cursor-grab touch-none rounded-md bg-navy-900/90 p-1.5 text-slate2-400 hover:text-white active:cursor-grabbing"
      >
        <GripVertical size={16} />
      </button>

      <div className="flex items-center justify-between gap-1 border-t border-white/10 px-2 py-1.5">
        <p className="min-w-0 flex-1 truncate text-xs text-slate2-400" title={item.name}>
          {item.name}
        </p>
        <button
          type="button"
          onClick={() => onRotate(item.id)}
          aria-label="Rotate 90°"
          className="rounded-md p-1.5 text-slate2-400 hover:bg-white/10 hover:text-white"
        >
          <RotateCw size={16} />
        </button>
        <button
          type="button"
          onClick={() => onDelete(item.id)}
          aria-label="Delete image"
          className="rounded-md p-1.5 text-slate2-400 hover:bg-red-500/20 hover:text-red-400"
        >
          <Trash2 size={16} />
        </button>
      </div>
    </div>
  );
}

/* ---------- Main component ---------- */

export default function Converter() {
  const [items, setItems] = useState<Item[]>([]);
  const [orientation, setOrientation] = useState<Orientation>("auto");
  const [margin, setMargin] = useState<Margin>("small");
  const [pageSize, setPageSize] = useState<PageSize>("a4");
  const [quality, setQuality] = useState<Quality>("balanced");
  const [filename, setFilename] = useState(DEFAULT_NAME);
  const [watermark, setWatermark] = useState("");

  const [dragOver, setDragOver] = useState(false);
  const [reading, setReading] = useState<{ done: number; total: number } | null>(null);
  const [job, setJob] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);

  const [sortOpen, setSortOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewPages, setPreviewPages] = useState<PreviewPage[]>([]);
  const [previewTotal, setPreviewTotal] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const sortRef = useRef<HTMLDivElement>(null);
  const itemsRef = useRef<Item[]>([]);
  itemsRef.current = items;

  // Keys (name + size) of every image that is added or currently being added.
  const keysRef = useRef<Set<string>>(new Set());
  const readRef = useRef({ total: 0, done: 0, pending: 0 });
  const previewRun = useRef(0);

  const busy = job !== null || reading !== null;
  const ready = items.length > 0 && !busy;

  const layout = useMemo<Layout>(
    () => ({ pageSize, orientation, margin }),
    [pageSize, orientation, margin]
  );

  useEffect(
    () => () => {
      previewRun.current += 1;
      itemsRef.current.forEach((i) => URL.revokeObjectURL(i.url));
    },
    []
  );

  // Duplicate warning disappears by itself.
  useEffect(() => {
    if (!warning) return;
    const t = setTimeout(() => setWarning(null), 5000);
    return () => clearTimeout(t);
  }, [warning]);

  // "Clear all?" confirmation cancels itself if ignored.
  useEffect(() => {
    if (!confirmClear) return;
    const t = setTimeout(() => setConfirmClear(false), 6000);
    return () => clearTimeout(t);
  }, [confirmClear]);

  // Close the Auto Sort menu on outside click / Escape.
  useEffect(() => {
    if (!sortOpen) return;
    const onDown = (e: MouseEvent) => {
      if (sortRef.current && !sortRef.current.contains(e.target as Node)) setSortOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSortOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [sortOpen]);

  const closeToast = useCallback(() => setToast(null), []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const addFiles = useCallback(async (list: FileList | File[]) => {
    const all = Array.from(list);
    if (!all.length) return;

    const failed: string[] = [];
    const duplicates: string[] = [];
    const queue: { file: File; key: string }[] = [];

    for (const file of all) {
      if (!isSupported(file)) {
        failed.push(file.name);
        continue;
      }
      const key = fileKey(file);
      if (keysRef.current.has(key)) {
        duplicates.push(file.name);
        continue;
      }
      keysRef.current.add(key); // reserve so the same file can't slip in twice
      queue.push({ file, key });
    }

    setWarning(
      duplicates.length
        ? `Skipped ${plural(duplicates.length, "duplicate")}: ${summarize(duplicates)}`
        : null
    );
    setError(null);

    if (!queue.length) {
      if (failed.length) setError(`Couldn't add: ${summarize(failed)}`);
      return;
    }

    const r = readRef.current;
    r.pending += 1;
    r.total += queue.length;
    setReading({ done: r.done, total: r.total });

    for (const { file, key } of queue) {
      try {
        const item = await prepareFile(file, key);
        setItems((prev) => [...prev, item]);
      } catch {
        keysRef.current.delete(key);
        failed.push(file.name);
      }
      r.done += 1;
      setReading({ done: r.done, total: r.total });
    }

    if (failed.length) setError(`Couldn't add: ${summarize(failed)}`);

    r.pending -= 1;
    if (r.pending <= 0) {
      readRef.current = { total: 0, done: 0, pending: 0 };
      setReading(null);
    }
  }, []);

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    setItems((prev) => {
      const from = prev.findIndex((i) => i.id === active.id);
      const to = prev.findIndex((i) => i.id === over.id);
      return arrayMove(prev, from, to);
    });
  };

  const rotate = (id: string) =>
    setItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, rotation: (i.rotation + 90) % 360 } : i))
    );

  const rotateAll = () =>
    setItems((prev) => prev.map((i) => ({ ...i, rotation: (i.rotation + 90) % 360 })));

  const sortItems = (by: SortBy) => {
    setItems((prev) => {
      const next = [...prev];
      if (by === "name") {
        next.sort((a, b) =>
          a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })
        );
      } else {
        next.sort(
          (a, b) =>
            a.modified - b.modified ||
            a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })
        );
      }
      return next;
    });
    setSortOpen(false);
    setToast({
      id: Date.now(),
      type: "success",
      title: by === "name" ? "Sorted by file name" : "Sorted by file date",
      detail: by === "name" ? "A → Z, numbers in natural order." : "Oldest first.",
    });
  };

  const remove = (id: string) => {
    const target = itemsRef.current.find((i) => i.id === id);
    if (target) {
      URL.revokeObjectURL(target.url);
      keysRef.current.delete(target.key); // allow re-adding after deletion
    }
    setItems((prev) => prev.filter((i) => i.id !== id));
  };

  const clearAll = () => {
    items.forEach((i) => {
      URL.revokeObjectURL(i.url);
      keysRef.current.delete(i.key);
    });
    setItems([]);
    setError(null);
    setWarning(null);
    setConfirmClear(false);
    setSortOpen(false);
  };

  /* ----- PDF generation ----- */

  const generate = async () => {
    if (!items.length || busy) return;
    setError(null);
    setWarning(null);
    setToast(null);

    const snapshot = items;
    const total = snapshot.length;
    const q = QUALITY[quality];
    setJob({ done: 0, total, label: `Processing 1 of ${plural(total, "page")}…` });

    try {
      const { jsPDF } = await import("jspdf");
      const wm = makeWatermark(watermark);
      let doc: InstanceType<typeof jsPDF> | null = null;

      for (let i = 0; i < total; i++) {
        setJob({
          done: i,
          total,
          label: `Processing ${i + 1} of ${plural(total, "page")}…`,
        });
        await paint();

        const item = snapshot[i];
        const { pw, ph, box } = layoutPage(item, layout);
        const canvas = await renderCanvas(item, exportCap(box, q.dpi));
        const data = canvas.toDataURL("image/jpeg", q.jpeg);
        canvas.width = canvas.height = 0; // release canvas memory early

        const o = pw > ph ? "l" : "p";
        if (!doc) {
          doc = new jsPDF({ orientation: o, unit: "pt", format: [pw, ph], compress: true });
        } else {
          doc.addPage([pw, ph], o);
        }

        doc.addImage(
          data,
          "JPEG",
          (pw - box.w) / 2,
          (ph - box.h) / 2,
          box.w,
          box.h,
          undefined,
          "FAST"
        );

        if (wm) {
          const p = placeWatermark(pw, ph, wm);
          doc.addImage(wm.data, "PNG", p.x, p.y, p.w, p.h, "hawelly-watermark", "FAST");
        }
      }

      if (!doc) return;

      setJob({ done: total, total, label: "Saving PDF…" });
      await paint();

      const name = cleanFilename(filename);
      doc.setProperties({ title: name, creator: "Hawelly, waraya mid" });
      const blob = doc.output("blob");
      downloadBlob(blob, `${name}.pdf`);

      setToast({
        id: Date.now(),
        type: "success",
        title: "عملته؟ روح ذاكره بقى متراكمهوش هو كمان 😂",
        detail: `${name}.pdf · ${plural(total, "page")} · ${formatBytes(blob.size)}`,
      });
    } catch (e) {
      console.error(e);
      setToast({
        id: Date.now(),
        type: "error",
        title: "Couldn't create the PDF",
        detail: "Try fewer or smaller images, or pick a lower quality.",
      });
    } finally {
      setJob(null);
    }
  };

  /* ----- Preview modal ----- */

  const closePreview = useCallback(() => {
    previewRun.current += 1; // cancels any rendering still in progress
    setPreviewOpen(false);
    setPreviewPages([]);
  }, []);

  const openPreview = async () => {
    if (!items.length || busy) return;
    const run = ++previewRun.current;
    const snapshot = items;

    setPreviewPages([]);
    setPreviewTotal(snapshot.length);
    setPreviewOpen(true);

    try {
      const wm = makeWatermark(watermark);
      for (let i = 0; i < snapshot.length; i++) {
        await paint();
        if (previewRun.current !== run) return;
        const page = await renderPreviewPage(snapshot[i], i, layout, wm);
        if (previewRun.current !== run) return;
        setPreviewPages((prev) => [...prev, page]);
      }
    } catch (e) {
      console.error(e);
      if (previewRun.current === run) {
        closePreview();
        setToast({
          id: Date.now(),
          type: "error",
          title: "Couldn't build the preview",
          detail: "Try fewer or smaller images.",
        });
      }
    }
  };

  const downloadFromPreview = () => {
    closePreview();
    generate();
  };

  const actionBtn =
    "inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-sm text-slate2-400 transition hover:border-white/30 hover:text-white disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-white/10 disabled:hover:text-slate2-400";

  return (
    <div className="space-y-8">
      {/* Upload area */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && inputRef.current?.click()}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 text-center transition ${
          items.length ? "py-8" : "min-h-[260px] py-12"
        } ${
          dragOver
            ? "border-white bg-white/5"
            : "border-slate2-600 hover:border-slate2-400 hover:bg-white/[0.02]"
        }`}
      >
        <UploadCloud size={36} className="mb-3 text-slate2-400" />
        <p className="font-semibold">Drag & drop images here, or click to browse</p>
        <p className="mt-1 text-sm text-slate2-400">
          PNG, JPG, WEBP, HEIC, GIF, BMP, SVG · multiple files supported
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {warning && (
        <p
          role="status"
          className="flex items-start gap-2 rounded-lg border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-200"
        >
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>{warning}</span>
        </p>
      )}

      {error && (
        <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </p>
      )}

      {/* Preview grid */}
      {items.length > 0 && (
        <section>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">
              {plural(items.length, "image")}{" "}
              <span className="font-normal text-slate2-400">· drag the handle to reorder</span>
            </h2>

            {/* Quick actions bar */}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className={actionBtn}
              >
                <Plus size={16} /> Add
              </button>

              <div ref={sortRef} className="relative">
                <button
                  type="button"
                  onClick={() => setSortOpen((o) => !o)}
                  disabled={busy || items.length < 2}
                  aria-haspopup="menu"
                  aria-expanded={sortOpen}
                  className={actionBtn}
                >
                  <ArrowUpDown size={16} /> Auto Sort
                  <ChevronDown
                    size={14}
                    className={`transition ${sortOpen ? "rotate-180" : ""}`}
                  />
                </button>
                {sortOpen && (
                  <div
                    role="menu"
                    className="absolute left-0 z-30 mt-1 w-56 overflow-hidden rounded-lg border border-white/10 bg-navy-800 py-1 shadow-2xl sm:left-auto sm:right-0"
                  >
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => sortItems("name")}
                      className="block w-full px-3 py-2 text-left text-sm text-white hover:bg-white/10"
                    >
                      By file name
                      <span className="block text-xs text-slate2-400">
                        A → Z, page2 before page10
                      </span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => sortItems("date")}
                      className="block w-full px-3 py-2 text-left text-sm text-white hover:bg-white/10"
                    >
                      By file date
                      <span className="block text-xs text-slate2-400">Oldest first</span>
                    </button>
                  </div>
                )}
              </div>

              <button type="button" onClick={rotateAll} disabled={busy} className={actionBtn}>
                <RotateCw size={16} /> Rotate All
              </button>

              {confirmClear ? (
                <div
                  role="alertdialog"
                  aria-label="Confirm clear all images"
                  className="inline-flex items-center gap-2 rounded-lg border border-red-500/40 bg-red-500/10 py-1 pl-3 pr-1 text-sm"
                >
                  <span className="text-red-200">Remove all {items.length}?</span>
                  <button
                    type="button"
                    autoFocus
                    onClick={clearAll}
                    className="rounded-md bg-red-500 px-2.5 py-1 text-xs font-bold text-white transition hover:bg-red-400"
                  >
                    Yes, clear
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmClear(false)}
                    className="rounded-md px-2.5 py-1 text-xs font-medium text-slate2-400 transition hover:bg-white/10 hover:text-white"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setSortOpen(false);
                    setConfirmClear(true);
                  }}
                  disabled={busy}
                  className={`${actionBtn} hover:!text-red-400`}
                >
                  <Trash2 size={16} /> Clear All
                </button>
              )}
            </div>
          </div>

          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={items.map((i) => i.id)} strategy={rectSortingStrategy}>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                {items.map((item, idx) => (
                  <Thumb
                    key={item.id}
                    item={item}
                    index={idx}
                    layout={layout}
                    onRotate={rotate}
                    onDelete={remove}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </section>
      )}

      {/* Settings */}
      <section className="rounded-xl border border-white/10 bg-navy-800/40 p-4 sm:p-6">
        <h2 className="mb-4 text-sm font-semibold">PDF settings</h2>

        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <Segmented<PageSize>
            label="Page size"
            value={pageSize}
            onChange={setPageSize}
            options={[
              { value: "auto", label: "Auto" },
              { value: "a4", label: "A4" },
              { value: "letter", label: "Letter" },
            ]}
          />
          <Segmented<Orientation>
            label="Orientation"
            value={orientation}
            onChange={setOrientation}
            disabled={pageSize === "auto"}
            hint={pageSize === "auto" ? "Page matches each image." : undefined}
            options={[
              { value: "portrait", label: "Portrait" },
              { value: "landscape", label: "Landscape" },
              { value: "auto", label: "Auto" },
            ]}
          />
          <Segmented<Margin>
            label="Margins"
            value={margin}
            onChange={setMargin}
            options={[
              { value: "none", label: "None" },
              { value: "small", label: "Small" },
              { value: "big", label: "Big" },
            ]}
          />
        </div>

        <div className="mt-6 grid gap-5 border-t border-white/10 pt-6 md:grid-cols-2">
          <Segmented<Quality>
            label="Quality"
            value={quality}
            onChange={setQuality}
            hint={
              quality === "high"
                ? "Sharpest output (up to 300 DPI). Largest file."
                : quality === "balanced"
                ? "Good detail with a moderate file size."
                : "Smallest file. Use it when your LMS has an upload size limit."
            }
            options={[
              { value: "high", label: "High Quality" },
              { value: "balanced", label: "Balanced" },
              { value: "compressed", label: "Compressed" },
            ]}
          />
        </div>

        <div className="mt-6 grid gap-5 border-t border-white/10 pt-6 md:grid-cols-2">
          <Field
            id="pdf-filename"
            label="File name"
            value={filename}
            onChange={setFilename}
            onBlur={() => setFilename(cleanFilename(filename))}
            placeholder={DEFAULT_NAME}
            maxLength={80}
            suffix=".pdf"
            hint={`Saves as “${cleanFilename(filename)}.pdf”`}
          />
          <Field
            id="pdf-watermark"
            label="Watermark (optional)"
            value={watermark}
            onChange={setWatermark}
            placeholder="e.g. Your name or course code"
            maxLength={40}
            hint="Shown faintly across the center of every page."
          />
        </div>
      </section>

      {/* Progress & actions */}
      <div className="space-y-4">
        {reading && (
          <ProgressBar
            label={`Reading image ${Math.min(reading.done + 1, reading.total)} of ${reading.total}…`}
            value={reading.done / Math.max(1, reading.total)}
          />
        )}

        {job && (
          <ProgressBar
            label={job.label}
            value={(job.done + (job.done < job.total ? 0.5 : 0)) / Math.max(1, job.total)}
          />
        )}

        <div className="flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={openPreview}
            disabled={!ready}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-navy-800/60 px-5 py-4 text-base font-semibold text-white transition hover:border-white/40 hover:bg-navy-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-white/15 disabled:hover:bg-navy-800/60"
          >
            <Eye size={20} />
            Preview PDF
          </button>

          <div className="group relative sm:flex-1">
            {ready && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute -inset-1 rounded-2xl bg-gradient-to-r from-slate-400/40 via-white/40 to-slate-400/40 opacity-70 blur-lg transition duration-500 group-hover:opacity-100 motion-safe:animate-pulse"
              />
            )}
            <button
              type="button"
              onClick={generate}
              disabled={!ready}
              className={`relative flex w-full items-center justify-center gap-2 rounded-xl px-6 py-4 text-base font-bold transition duration-300 ${
                ready
                  ? "bg-gradient-to-r from-white via-slate-100 to-slate-300 text-navy-900 shadow-[0_0_24px_rgba(148,163,184,0.35)] hover:-translate-y-0.5 hover:shadow-[0_0_40px_rgba(203,213,225,0.6)] active:translate-y-0"
                  : "cursor-not-allowed bg-slate2-600 text-slate2-400"
              }`}
            >
              {job ? (
                <>
                  <Loader2 size={20} className="animate-spin" />
                  Creating PDF…
                </>
              ) : reading ? (
                <>
                  <Loader2 size={20} className="animate-spin" />
                  Reading images…
                </>
              ) : (
                <>
                  <Download size={20} />
                  Convert & Download PDF
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      <PreviewModal
        open={previewOpen}
        pages={previewPages}
        total={previewTotal}
        onClose={closePreview}
        onDownload={downloadFromPreview}
      />

      {toast && <Toast key={toast.id} toast={toast} onClose={closeToast} />}
    </div>
  );
}
