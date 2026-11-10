import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import {
  Archive,
  ArrowDownToLine,
  ArrowUpRight,
  ChevronDown,
  CircleAlert,
  FileArchive,
  FolderOpen,
  KeyRound,
  LoaderCircle,
  LogOut,
  Menu,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Upload,
  X,
} from "lucide-react";
import { apiOrigin, apiRequest, ApiRequestError, uploadFile, type ImportJob, type PackageItem } from "./api";
import { useAuth } from "./auth";

type View = "library" | "imports" | "settings";
type Notice = { kind: "success" | "error"; text: string } | null;

export function App() {
  const { session, loading, configured, signIn, signOut } = useAuth();
  const [view, setView] = useState<View>("library");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [packages, setPackages] = useState<PackageItem[]>([]);
  const [jobs, setJobs] = useState<ImportJob[]>([]);
  const [dataLoading, setDataLoading] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [search, setSearch] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    if (!session) return;
    setDataLoading(true);
    try {
      const [packageResponse, jobResponse] = await Promise.all([
        apiRequest<{ packages: PackageItem[] }>(session, "/api/v1/packages"),
        apiRequest<{ jobs: ImportJob[] }>(session, "/api/v1/import-jobs"),
      ]);
      setPackages(packageResponse.packages);
      setJobs(jobResponse.jobs);
    } catch (error) {
      setNotice({ kind: "error", text: messageForError(error) });
    } finally {
      setDataLoading(false);
    }
  }, [session]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!session || !jobs.some((job) => job.status === "queued" || job.status === "running")) return;
    const timer = window.setInterval(() => { void refresh(); }, 5_000);
    return () => window.clearInterval(timer);
  }, [session, jobs, refresh]);

  const filteredPackages = useMemo(() => {
    const term = search.trim().toLowerCase();
    return term ? packages.filter((item) => item.file_name.toLowerCase().includes(term) || item.title_id?.toLowerCase().includes(term)) : packages;
  }, [packages, search]);

  if (loading) return <div className="boot-screen"><LoaderCircle className="spin" size={18} /> Loading workspace</div>;
  if (!configured) return <SetupScreen />;
  if (!session) return <SignInScreen onSignIn={signIn} />;

  const nav = (
    <>
      <div className="brand-row">
        <OrbisMark />
        <div><div className="brand-name">Orbis Manager</div><div className="brand-scope">Private package library</div></div>
        <ChevronDown size={15} className="brand-chevron" aria-hidden="true" />
      </div>
      <div className="nav-section-label">Workspace</div>
      <nav className="side-nav" aria-label="Workspace">
        <NavButton active={view === "library"} icon={<Archive size={16} />} onClick={() => chooseView("library", setView, setMobileOpen)}>Library</NavButton>
        <NavButton active={view === "imports"} icon={<ArrowDownToLine size={16} />} onClick={() => chooseView("imports", setView, setMobileOpen)}>Imports</NavButton>
      </nav>
      <div className="nav-section-label settings-label">Account</div>
      <nav className="side-nav" aria-label="Account">
        <NavButton active={view === "settings"} icon={<Settings2 size={16} />} onClick={() => chooseView("settings", setView, setMobileOpen)}>Settings</NavButton>
      </nav>
      <div className="sidebar-bottom">
        <div className="private-note"><ShieldCheck size={15} /><span>Files stay in private storage</span></div>
        <button className="account-row" onClick={signOut} title="Sign out">
          <span className="account-avatar">{(session.user.email?.[0] ?? "O").toUpperCase()}</span>
          <span className="account-text"><span className="account-email">{session.user.email ?? "Orbis account"}</span><span className="account-plan">Signed in</span></span>
          <LogOut size={15} className="account-logout" />
        </button>
      </div>
    </>
  );

  return (
    <div className="app-shell">
      {mobileOpen && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
      <aside className={`sidebar ${mobileOpen ? "sidebar-open" : ""}`}>
        <button className="mobile-close" aria-label="Close navigation" onClick={() => setMobileOpen(false)}><X size={18} /></button>
        {nav}
      </aside>
      <main className="main-pane">
        <header className="mobile-header">
          <button className="icon-button" aria-label="Open navigation" onClick={() => setMobileOpen(true)}><Menu size={19} /></button>
          <div className="mobile-brand"><OrbisMark /><span>Orbis Manager</span></div>
          {view === "library" ? <button className="icon-button" aria-label="Upload package" onClick={() => setUploadOpen(true)}><Upload size={17} /></button> : <span className="mobile-action-spacer" />}
        </header>
        {notice && <div className={`notice notice-${notice.kind}`} role="status"><span>{notice.text}</span><button aria-label="Dismiss message" onClick={() => setNotice(null)}><X size={15} /></button></div>}
        {view === "library" && <LibraryScreen
          packages={filteredPackages}
          total={packages.length}
          search={search}
          setSearch={setSearch}
          loading={dataLoading}
          onImport={() => setImportOpen(true)}
          onUpload={() => setUploadOpen(true)}
          onRefresh={() => void refresh()}
          onDelete={async (item) => {
            if (!window.confirm(`Remove ${item.file_name} from your library?`)) return;
            try {
              await apiRequest(session, `/api/v1/packages/${item.id}`, { method: "DELETE" });
              setNotice({ kind: "success", text: "Package removed." });
              await refresh();
            } catch (error) { setNotice({ kind: "error", text: messageForError(error) }); }
          }}
          onDownload={async (item) => {
            try {
              const result = await apiRequest<{ downloadUrl: string }>(session, `/api/v1/packages/${item.id}/download-url`, { method: "POST" });
              window.location.assign(result.downloadUrl);
            } catch (error) { setNotice({ kind: "error", text: messageForError(error) }); }
          }}
        />}
        {view === "imports" && <ImportsScreen jobs={jobs} loading={dataLoading} onImport={() => setImportOpen(true)} />}
        {view === "settings" && <SettingsScreen email={session.user.email ?? ""} />}
      </main>
      {importOpen && <ImportDialog session={session} onClose={() => setImportOpen(false)} onCreated={async () => { setImportOpen(false); setView("imports"); await refresh(); setNotice({ kind: "success", text: "Import queued. You can follow its progress here." }); }} onError={(text) => setNotice({ kind: "error", text })} />}
      {uploadOpen && <UploadDialog progress={uploadProgress} onClose={() => { if (uploadProgress === null) setUploadOpen(false); }} onFile={async (file) => {
        setUploadProgress(0);
        try {
          await uploadFile(session, file, setUploadProgress);
          setUploadProgress(null);
          setUploadOpen(false);
          await refresh();
          setNotice({ kind: "success", text: "Package uploaded and checksum verified." });
        } catch (error) {
          setUploadProgress(null);
          setNotice({ kind: "error", text: messageForError(error) });
        }
      }} />}
    </div>
  );
}

function LibraryScreen({ packages, total, search, setSearch, loading, onImport, onUpload, onRefresh, onDelete, onDownload }: {
  packages: PackageItem[];
  total: number;
  search: string;
  setSearch(value: string): void;
  loading: boolean;
  onImport(): void;
  onUpload(): void;
  onRefresh(): void;
  onDelete(item: PackageItem): void;
  onDownload(item: PackageItem): void;
}) {
  return <div className="content-wrap">
    <div className="page-heading">
      <div><div className="eyebrow">Workspace / Library</div><h1>Package library</h1><p>Private storage for the packages you manage.</p></div>
      <div className="heading-actions"><button className="button button-secondary desktop-upload" onClick={onUpload}><Upload size={15} /> Upload package</button><button className="button button-primary" onClick={onImport}><Plus size={16} /> Import from URL</button></div>
    </div>
    <div className="library-summary"><div className="summary-count"><span>{total}</span><span>{total === 1 ? "package" : "packages"}</span></div><span className="summary-caption">in your private library</span></div>
    <section className="data-section" aria-labelledby="packages-title">
      <div className="section-heading"><div><h2 id="packages-title">All packages</h2><span className="section-note">Files are transferred directly between your browser and private R2 storage.</span></div><button className="text-button" onClick={onRefresh} disabled={loading}>{loading ? <LoaderCircle size={15} className="spin" /> : "Refresh"}</button></div>
      <div className="table-toolbar"><label className="search-field"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Filter packages" aria-label="Filter packages" /></label><span className="table-count">{packages.length} shown</span></div>
      <div className="table-wrap">
        <table className="package-table"><thead><tr><th>Package</th><th>Title ID</th><th>Size</th><th>SHA-256</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{packages.map((item) => <tr key={item.id}>
            <td><div className="file-cell"><span className="file-mark"><FileArchive size={16} /></span><span className="file-copy"><strong title={item.file_name}>{item.file_name}</strong><small>Added {formatDate(item.created_at)}</small></span></div></td>
            <td className="mono-cell">{item.title_id || <span className="empty-value">—</span>}</td>
            <td className="numeric-cell">{formatBytes(item.size_bytes)}</td>
            <td className="hash-cell">{item.sha256 ? <code title={item.sha256}>{item.sha256.slice(0, 10)}…</code> : <span className="empty-value">Verifying</span>}</td>
            <td><Status status={item.status} /></td>
            <td><div className="row-actions">{item.status === "ready" && <button className="row-action" aria-label={`Download ${item.file_name}`} title="Download" onClick={() => onDownload(item)}><ArrowDownToLine size={16} /></button>}<button className="row-action row-action-danger" aria-label={`Remove ${item.file_name}`} title="Remove" onClick={() => onDelete(item)}><X size={16} /></button></div></td>
          </tr>)}</tbody></table>
        {!loading && packages.length === 0 && <div className="empty-state"><div className="empty-illustration"><PackageGlyph /></div><h3>{search ? "No matching packages" : "Your library is empty"}</h3><p>{search ? "Try a different file name or title ID." : "Add a package from a direct download URL or upload a .pkg file from your device."}</p>{!search && <div className="empty-actions"><button className="button button-primary" onClick={onImport}><ArrowDownToLine size={15} /> Import from URL</button><button className="button button-secondary" onClick={onUpload}><Upload size={15} /> Upload .pkg</button></div>}</div>}
      </div>
      <div className="table-footer"><span>Showing {packages.length} of {total} packages</span><span className="secure-caption"><ShieldCheck size={14} /> Private by default</span></div>
    </section>
  </div>;
}

function ImportsScreen({ jobs, loading, onImport }: { jobs: ImportJob[]; loading: boolean; onImport(): void }) {
  return <div className="content-wrap">
    <div className="page-heading"><div><div className="eyebrow">Workspace / Activity</div><h1>Imports</h1><p>Track URL imports as they move into your library.</p></div><button className="button button-primary" onClick={onImport}><Plus size={16} /> Import from URL</button></div>
    <section className="data-section imports-section"><div className="section-heading"><div><h2>Recent imports</h2><span className="section-note">Jobs continue on the API machine and can be retried after a failure.</span></div></div>
      {jobs.length === 0 && !loading ? <div className="empty-state compact-empty"><div className="empty-illustration"><ArrowDownToLine size={22} /></div><h3>No imports yet</h3><p>When you import a package URL, its status and transfer progress will appear here.</p><button className="button button-secondary" onClick={onImport}>Create an import</button></div> : <div className="jobs-list">{jobs.map((job) => <div className="job-row" key={job.id}><div className="job-icon"><FileArchive size={17} /></div><div className="job-main"><strong>{job.file_name}</strong><span>{formatDate(job.created_at)} · {job.total_bytes ? `${formatBytes(job.progress_bytes)} of ${formatBytes(job.total_bytes)}` : formatBytes(job.progress_bytes)}</span>{job.status === "running" && <div className="progress-track"><span style={{ width: `${job.total_bytes ? Math.min(100, Math.round(job.progress_bytes / job.total_bytes * 100)) : 4}%` }} /></div>}</div><Status status={job.status} /><span className="job-detail">{job.status === "failed" ? (job.error_code ?? "Import failed") : job.status === "completed" ? "Ready in library" : job.status === "queued" ? "Waiting" : "Downloading"}</span></div>)}</div>}
    </section>
  </div>;
}

function SettingsScreen({ email }: { email: string }) {
  return <div className="content-wrap settings-wrap"><div className="page-heading"><div><div className="eyebrow">Account / Preferences</div><h1>Settings</h1><p>Account and storage details for this workspace.</p></div></div>
    <section className="data-section settings-section"><h2>Account</h2><SettingRow icon={<KeyRound size={16} />} label="Signed in as" value={email || "Email not available"} detail="Managed by your Supabase account." /><SettingRow icon={<FolderOpen size={16} />} label="Package storage" value="Private Cloudflare R2" detail="Downloads use short-lived signed URLs. Storage credentials never reach your browser." /><SettingRow icon={<ArrowUpRight size={16} />} label="API endpoint" value={apiOrigin()} detail="Set VITE_API_BASE_URL for this deployment." /></section>
    <div className="settings-footnote"><ShieldCheck size={16} /><span>Orbis Manager does not keep package files on the API machine.</span></div>
  </div>;
}

function SettingRow({ icon, label, value, detail }: { icon: ReactNode; label: string; value: string; detail: string }) {
  return <div className="setting-row"><div className="setting-icon">{icon}</div><div className="setting-info"><strong>{label}</strong><span>{detail}</span></div><code>{value}</code></div>;
}

function ImportDialog({ session, onClose, onCreated, onError }: { session: NonNullable<ReturnType<typeof useAuth>["session"]>; onClose(): void; onCreated(): void; onError(text: string): void }) {
  const [url, setUrl] = useState("");
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await apiRequest(session, "/api/v1/import-jobs", { method: "POST", body: JSON.stringify({ sourceUrl: url, fileName }) });
      onCreated();
    } catch (error) { onError(messageForError(error)); }
    finally { setBusy(false); }
  }
  return <Modal title="Import a package" onClose={onClose}><form onSubmit={(event) => void submit(event)} className="dialog-form">
    <p className="dialog-intro">Orbis downloads directly to private storage. Use a direct HTTPS link you are authorized to access.</p>
    <label className="field-label">Direct download URL<input type="url" required maxLength={4096} value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://downloads.example.com/game.pkg" autoFocus /></label>
    <label className="field-label">Package file name<input type="text" required pattern="[\p{L}\p{N}][\p{L}\p{N} ._()\-]*\.pkg" maxLength={180} value={fileName} onChange={(event) => setFileName(event.target.value)} placeholder="Game.pkg" /></label>
    <p className="field-help">Only configured public hosts are accepted. Authentication and access controls are not bypassed.</p>
    <div className="dialog-actions"><button type="button" className="button button-secondary" onClick={onClose}>Cancel</button><button type="submit" className="button button-primary" disabled={busy}>{busy ? <LoaderCircle className="spin" size={15} /> : <ArrowDownToLine size={15} />} Queue import</button></div>
  </form></Modal>;
}

function UploadDialog({ progress, onClose, onFile }: { progress: number | null; onClose(): void; onFile(file: File): void }) {
  const [error, setError] = useState("");
  return <Modal title="Upload a package" onClose={onClose}><div className="upload-box"><input type="file" accept=".pkg,application/octet-stream" disabled={progress !== null} onChange={(event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".pkg")) { setError("Choose a .pkg file."); return; }
    if (file.size === 0) { setError("The selected file is empty."); return; }
    setError("");
    onFile(file);
  }} /><div className="upload-symbol"><Upload size={21} /></div><strong>{progress === null ? "Choose a .pkg file" : progress >= 100 ? "Verifying checksum" : `Uploading · ${progress}%`}</strong><span>File contents go directly from this browser to private R2 storage.</span>{progress !== null && <div className="progress-track upload-progress"><span style={{ width: `${progress}%` }} /></div>}{error && <small className="form-error">{error}</small>}</div><div className="dialog-actions"><button className="button button-secondary" onClick={onClose} disabled={progress !== null}>Close</button></div></Modal>;
}

function SignInScreen({ onSignIn }: { onSignIn(email: string, password: string): Promise<void> }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try { await onSignIn(email, password); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Sign-in failed."); }
    finally { setBusy(false); }
  }
  return <div className="auth-layout"><div className="auth-brand"><OrbisMark /><span>Orbis Manager</span></div><div className="auth-card"><div className="eyebrow">PRIVATE PACKAGE LIBRARY</div><h1>Sign in</h1><p>Use your Orbis Manager account to open your library.</p><form onSubmit={(event) => void submit(event)} className="dialog-form"><label className="field-label">Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="username" /></label><label className="field-label">Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required autoComplete="current-password" /></label>{error && <div className="form-error">{error}</div>}<button type="submit" className="button button-primary auth-submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={16} /> : null} Continue</button></form><div className="auth-private"><ShieldCheck size={15} /> Authentication handled by Supabase</div></div></div>;
}

function SetupScreen() {
  return <div className="auth-layout"><div className="auth-brand"><OrbisMark /><span>Orbis Manager</span></div><div className="auth-card setup-card"><div className="eyebrow">SETUP REQUIRED</div><h1>Connect your project</h1><p>Set the public Supabase URL and anon key in the Vercel environment, then rebuild the frontend.</p><div className="setup-code"><code>VITE_SUPABASE_URL</code><code>VITE_SUPABASE_ANON_KEY</code><code>VITE_API_BASE_URL</code></div><div className="auth-private"><CircleAlert size={15} /> Never add the service role key or R2 secrets here.</div></div></div>;
}

function Modal({ title, onClose, children }: { title: string; onClose(): void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><header><h2 id="modal-title">{title}</h2><button className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={17} /></button></header>{children}</section></div>;
}

function NavButton({ active, icon, onClick, children }: { active: boolean; icon: ReactNode; onClick(): void; children: ReactNode }) {
  return <button className={`nav-item ${active ? "nav-item-active" : ""}`} aria-current={active ? "page" : undefined} onClick={onClick}>{icon}<span>{children}</span></button>;
}

function Status({ status }: { status: string }) {
  const label = status === "ready" || status === "completed" ? "Ready" : status === "uploading" || status === "running" ? status === "running" ? "Running" : "Uploading" : status === "queued" ? "Queued" : "Failed";
  const cls = status === "ready" || status === "completed" ? "status-ready" : status === "uploading" || status === "running" || status === "queued" ? "status-pending" : "status-failed";
  return <span className={`status ${cls}`}><i />{label}</span>;
}

function OrbisMark() {
  return <span className="orbis-mark" aria-hidden="true"><span /><span /><span /></span>;
}

function PackageGlyph() {
  return <svg viewBox="0 0 56 56" aria-hidden="true"><path d="M10 17.5 28 8l18 9.5v21L28 48l-18-9.5v-21Z" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="m10.5 18 17.5 9.4L45.5 18M28 28v19M19 12.8l18 9.6" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>;
}

function chooseView(view: View, setView: (view: View) => void, setMobileOpen: (open: boolean) => void) { setView(view); setMobileOpen(false); }
function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${new Intl.NumberFormat("en", { maximumFractionDigits: index ? 1 : 0 }).format(value)} ${units[index]}`;
}
function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "date unavailable" : new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}
function messageForError(error: unknown) {
  if (error instanceof ApiRequestError) {
    const messages: Record<string, string> = {
      URL_IMPORT_DISABLED: "URL imports are not enabled for this deployment.",
      HOST_NOT_ALLOWED: "This download host is not configured for imports.",
      UNSAFE_DESTINATION: "This URL resolves to a restricted network address.",
      PACKAGE_TOO_LARGE: "This package exceeds the configured upload limit.",
      UPLOAD_INCOMPLETE_OR_INVALID: "The uploaded file is incomplete or could not be verified.",
      PACKAGE_NOT_READY: "This package is still being processed.",
    };
    return messages[error.code] ?? `Request failed (${error.code}).`;
  }
  return error instanceof Error ? error.message : "Something went wrong. Please retry.";
}
