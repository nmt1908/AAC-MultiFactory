export default function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "OK",
  cancelLabel = "Hủy",
  onConfirm,
  onCancel,
  variant = "default", // "default" | "danger"
}) {
  if (!open) return null;

  const danger = variant === "danger";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-[320px] rounded-2xl bg-white shadow-2xl border border-slate-200 p-5">
        <h3 className="text-sm font-semibold text-slate-900">
          {title}
        </h3>
        {description && (
          <p className="mt-2 text-xs text-slate-600 leading-snug">
            {description}
          </p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 rounded-full text-xs font-medium border border-slate-200 text-slate-600 hover:bg-slate-50"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className={`px-3 py-1.5 rounded-full text-xs font-medium text-white shadow-sm ${
              danger
                ? "bg-red-600 hover:bg-red-700"
                : "bg-slate-900 hover:bg-slate-800"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
