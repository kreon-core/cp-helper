export type NoticeTone = "info" | "error" | "success";

export interface NoticeState {
  tone: NoticeTone;
  text: string;
}

export function Notice({ notice, onClose }: { notice: NoticeState | null; onClose: () => void }) {
  if (!notice) return null;
  return (
    <div className={`notice notice-${notice.tone}`} role={notice.tone === "error" ? "alert" : "status"}>
      <span className="notice-text">{notice.text}</span>
      <button type="button" className="icon-btn" aria-label="Dismiss" onClick={onClose}>
        &times;
      </button>
    </div>
  );
}
