import React, { useState, useEffect, useCallback } from "react";
import { Plus, Trash2, Send, Check, ArrowLeft, Zap, Wrench, PoundSterling, X, MessageCircle, Mail, MessageSquare, Link2, ShieldCheck } from "lucide-react";

// ============================================================
// SUPABASE CONFIG — read from .env (Vite injects via import.meta.env)
// ============================================================
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

const APP_BASE_URL = window.location.origin + window.location.pathname;

const sbHeaders: Record<string, string> = {
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
  "Content-Type": "application/json",
};

async function sbSelect(query: string) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/jobs?${query}`, { headers: sbHeaders });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Supabase select failed: ${res.status} ${body}`);
  }
  return res.json();
}
async function sbInsert(row: Record<string, unknown>) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/jobs`, {
    method: "POST",
    headers: { ...sbHeaders, Prefer: "return=representation" },
    body: JSON.stringify(row),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Supabase insert failed: ${res.status} ${body}`);
  }
  return res.json();
}
async function sbUpdate(id: string, patch: Record<string, unknown>) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/jobs?id=eq.${id}`, {
    method: "PATCH",
    headers: { ...sbHeaders, Prefer: "return=representation" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`Supabase update failed: ${res.status}`);
  return res.json();
}

// ---------- traders table ----------
async function sbSelectTraders(query: string) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/traders?${query}`, { headers: sbHeaders });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Supabase traders select failed: ${res.status} ${body}`);
  }
  return res.json();
}
async function sbUpsertTrader(row: Record<string, unknown>) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/traders`, {
    method: "POST",
    headers: { ...sbHeaders, Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(row),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Supabase traders upsert failed: ${res.status} ${body}`);
  }
  return res.json();
}

// ============================================================
// STRIPE CONFIG
// ============================================================
const SUBSCRIPTION_PAYMENT_LINK = "https://buy.stripe.com/eVqbJ0ciIgIl8j99xbasg00";

// ---------- helpers ----------
const uid = () => Math.random().toString(36).slice(2, 9);
const money = (n: number) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n || 0);
const todayISO = () => new Date().toISOString().slice(0, 10);
const addDays = (d: string, n: number) => {
  const dt = new Date(d);
  dt.setDate(dt.getDate() + n);
  return dt.toISOString().slice(0, 10);
};
const fmtDate = (iso: string) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) : "";

const VAT_RATE = 0.2;
const OWNER_KEY = "docket:owner_id";

interface LineItem {
  id: string;
  desc: string;
  qty: number | string;
  price: number | string;
}
interface Job {
  id: string;
  number: number | null;
  customer: string;
  phone: string;
  dial_code: string;
  job_desc: string;
  lines: LineItem[];
  vat_registered: boolean;
  status: "draft" | "sent" | "approved" | "paid";
  created_at: string;
  owner_id: string;
  sent_at?: string | null;
  approved_at?: string | null;
  due_date?: string | null;
  paid_at?: string | null;
}

const emptyLine = (): LineItem => ({ id: uid(), desc: "", qty: 1, price: 0 });

const lineTotal = (l: LineItem) => (Number(l.qty) || 0) * (Number(l.price) || 0);
const subtotal = (job: Job) => (job.lines || []).reduce((s, l) => s + lineTotal(l), 0);
const vatAmount = (job: Job) => (job.vat_registered ? subtotal(job) * VAT_RATE : 0);
const total = (job: Job) => subtotal(job) + vatAmount(job);

const STATUS_META: Record<string, { label: string; color: string }> = {
  draft: { label: "Draft", color: "#8A8F98" },
  sent: { label: "Sent", color: "#F5A623" },
  approved: { label: "Invoice — Outstanding", color: "#C9491F" },
  paid: { label: "Paid", color: "#1B6B54" },
};

function buildMessage(job: Job, link: string) {
  const kind = job.status === "draft" || job.status === "sent" ? "quote" : "invoice";
  const lines = (job.lines || [])
    .map((l) => `- ${l.desc || "Item"} x${l.qty}: ${money(lineTotal(l))}`)
    .join("\n");
  const vatLine = job.vat_registered ? `\nVAT (20%): ${money(vatAmount(job))}` : "";
  return (
    `${kind === "quote" ? "Quote" : "Invoice"} #${String(job.number).padStart(3, "0")}\n` +
    `${job.job_desc || ""}\n\n${lines}\n${vatLine}\n` +
    `Total: ${money(total(job))}\n\n` +
    `View & ${kind === "quote" ? "approve" : "pay"} here: ${link}`
  );
}

function phoneToWaNumber(phone: string, dialCode: string) {
  const localDigits = (phone || "").replace(/[^\d]/g, "").replace(/^0+/, "");
  const code = (dialCode || "").replace(/[^\d]/g, "");
  return localDigits ? code + localDigits : "";
}

// ============================================================
// ENTRY: decide trader view vs customer view based on URL
// ============================================================
export default function DocketApp() {
  const params = new URLSearchParams(window.location.search);
  const jobId = params.get("job");
  return jobId ? <CustomerView jobId={jobId} /> : <TraderApp />;
}

// ============================================================
// TRADER APP (private, your device)
// ============================================================
type ViewMode = "list" | "editor" | "detail" | "settings";

function TraderApp() {
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [paymentLink, setPaymentLink] = useState("");
  const [bankDetails, setBankDetails] = useState("");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState<ViewMode>("list");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [tab, setTab] = useState<"active" | "paid">("active");
  const [toast, setToast] = useState<string | null>(null);

  const toastTimer = React.useRef<number | undefined>(undefined);
  const showToast = (msg: string) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2400);
  };

  const draftBuffer = React.useRef<Record<string, Job>>({});
  const [, forceTick] = useState(0);

  useEffect(() => {
    let id = localStorage.getItem(OWNER_KEY);
    if (!id) {
      id = uid() + uid();
      localStorage.setItem(OWNER_KEY, id);
    }
    setOwnerId(id);
  }, []);

  const refresh = useCallback(async (oid: string) => {
    try {
      const rows = await sbSelect(`owner_id=eq.${oid}&order=number.desc.nullslast`);
      setJobs(rows);
    } catch (e) {
      console.error(e);
      showToast((e as Error).message?.slice(0, 90) || "Couldn't reach the server");
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (ownerId) refresh(ownerId);
  }, [ownerId, refresh]);

  const checkSubscription = useCallback(async (oid: string) => {
    try {
      const rows = await sbSelectTraders(`owner_id=eq.${oid}`);
      setSubscribed(rows[0]?.subscribed === true);
      setPaymentLink(rows[0]?.payment_link || "");
      setBankDetails(rows[0]?.bank_details || "");
    } catch (e) {
      console.error(e);
      setSubscribed(false);
    }
  }, []);

  useEffect(() => {
    if (ownerId) checkSubscription(ownerId);
  }, [ownerId, checkSubscription]);

  const confirmSubscribed = async () => {
    try {
      await sbUpsertTrader({ owner_id: ownerId, subscribed: true, subscribed_at: new Date().toISOString() });
      setSubscribed(true);
    } catch {
      showToast("Couldn't update — try again");
    }
  };

  const savePaymentDetails = async (link: string, bank: string) => {
    try {
      await sbUpsertTrader({ owner_id: ownerId, subscribed: true, payment_link: link, bank_details: bank });
      setPaymentLink(link);
      setBankDetails(bank);
      showToast("Payment details saved");
      setView("list");
    } catch {
      showToast("Couldn't save — try again");
    }
  };

  const activeJob = jobs.find((j) => j.id === activeId) || draftBuffer.current[activeId!];

  const openNew = () => {
    const draft: Job = {
      id: uid(),
      number: null,
      customer: "",
      phone: "",
      dial_code: "44",
      job_desc: "",
      lines: [emptyLine()],
      vat_registered: false,
      status: "draft",
      created_at: todayISO(),
      owner_id: ownerId!,
    };
    draftBuffer.current[draft.id] = draft;
    setActiveId(draft.id);
    setView("editor");
    forceTick((n) => n + 1);
  };

  const openDetail = (id: string) => {
    setActiveId(id);
    setView("detail");
  };

  const patchDraft = (patch: Partial<Job>) => {
    draftBuffer.current[activeId!] = { ...draftBuffer.current[activeId!], ...patch };
    forceTick((n) => n + 1);
  };

  const patchLine = (lineId: string, patch: Partial<LineItem>) => {
    const d = draftBuffer.current[activeId!];
    d.lines = d.lines.map((l) => (l.id === lineId ? { ...l, ...patch } : l));
    forceTick((n) => n + 1);
  };
  const addLine = () => {
    const d = draftBuffer.current[activeId!];
    d.lines = [...d.lines, emptyLine()];
    forceTick((n) => n + 1);
  };
  const removeLine = (lineId: string) => {
    const d = draftBuffer.current[activeId!];
    d.lines = d.lines.filter((l) => l.id !== lineId);
    forceTick((n) => n + 1);
  };

  const nextNumber = () => Math.max(0, ...jobs.filter((j) => j.number).map((j) => j.number!)) + 1;

  const commitDraft = async (status: "draft" | "sent") => {
    const d = draftBuffer.current[activeId!];
    if (!d.customer.trim()) {
      showToast("Add a customer name first");
      return false;
    }
    const row = {
      ...d,
      number: nextNumber(),
      status,
      sent_at: status === "sent" ? todayISO() : null,
    };
    try {
      await sbInsert(row);
      delete draftBuffer.current[activeId!];
      await refresh(ownerId!);
      return true;
    } catch (e) {
      console.error(e);
      showToast((e as Error).message?.slice(0, 80) || "Save failed");
      return false;
    }
  };

  const saveDraft = async () => {
    const ok = await commitDraft("draft");
    if (ok) {
      showToast("Draft saved");
      setView("list");
    }
  };

  const sendQuote = async () => {
    const ok = await commitDraft("sent");
    if (ok) {
      showToast("Quote ready — choose how to send it");
      const rows = await sbSelect(`owner_id=eq.${ownerId}&order=number.desc&limit=1`);
      if (rows[0]) {
        setActiveId(rows[0].id);
        setView("detail");
      }
    }
  };

  const discardDraft = () => {
    delete draftBuffer.current[activeId!];
    setView("list");
  };

  const approveToInvoice = async () => {
    await sbUpdate(activeId!, { status: "approved", approved_at: todayISO(), due_date: addDays(todayISO(), 14) });
    await refresh(ownerId!);
    showToast("Converted to invoice");
  };
  const markPaid = async () => {
    await sbUpdate(activeId!, { status: "paid", paid_at: todayISO() });
    await refresh(ownerId!);
    showToast("Marked as paid");
  };
  const deleteJob = async () => {
    await fetch(`${SUPABASE_URL}/rest/v1/jobs?id=eq.${activeId}`, { method: "DELETE", headers: sbHeaders });
    await refresh(ownerId!);
    setView("list");
  };

  if (!loaded) return <div style={{ background: BASE, minHeight: "100vh" }} />;
  if (subscribed === null) return <div style={{ background: BASE, minHeight: "100vh" }} />;
  if (subscribed === false) return <SubscribeScreen onConfirm={confirmSubscribed} />;

  const savedJobs = jobs.filter((j) => j.number);
  const activeList = savedJobs.filter((j) => j.status !== "paid");
  const paidList = savedJobs.filter((j) => j.status === "paid");
  const outstandingTotal = activeList.filter((j) => j.status === "approved").reduce((s, j) => s + total(j), 0);
  const overdueCount = activeList.filter((j) => j.status === "approved" && j.due_date && j.due_date < todayISO()).length;

  return (
    <div style={styles.app}>
      <FontLoader />
      {view === "list" && (
        <ListView
          activeList={activeList}
          paidList={paidList}
          tab={tab}
          setTab={setTab}
          outstandingTotal={outstandingTotal}
          overdueCount={overdueCount}
          onOpen={openDetail}
          onNew={openNew}
          onSettings={() => setView("settings")}
        />
      )}
      {view === "settings" && (
        <SettingsView
          paymentLink={paymentLink}
          bankDetails={bankDetails}
          onSave={savePaymentDetails}
          onBack={() => setView("list")}
        />
      )}
      {view === "editor" && activeJob && (
        <EditorView
          job={activeJob}
          onBack={discardDraft}
          onChange={patchDraft}
          onLineChange={patchLine}
          onAddLine={addLine}
          onRemoveLine={removeLine}
          onSaveDraft={saveDraft}
          onSend={sendQuote}
        />
      )}
      {view === "detail" && activeJob && (
        <DetailView
          job={activeJob}
          onBack={() => setView("list")}
          onApprove={approveToInvoice}
          onMarkPaid={markPaid}
          onDelete={deleteJob}
          onShowToast={showToast}
        />
      )}
      {toast && <div style={styles.toast}>{toast}</div>}
    </div>
  );
}

// ================= SETTINGS =================
function SettingsView({ paymentLink, bankDetails, onSave, onBack }: {
  paymentLink: string;
  bankDetails: string;
  onSave: (link: string, bank: string) => void;
  onBack: () => void;
}) {
  const [link, setLink] = useState(paymentLink || "");
  const [bank, setBank] = useState(bankDetails || "");
  return (
    <div style={styles.screen}>
      <div style={styles.editorHeader}>
        <button style={styles.iconBtn} onClick={onBack}><ArrowLeft size={20} color={INK} /></button>
        <span style={styles.editorTitle}>Settings</span>
        <div style={{ width: 36 }} />
      </div>
      <div style={styles.editorBody}>
        <Field label="Your Stripe payment link (optional)">
          <input
            style={styles.input}
            placeholder="https://buy.stripe.com/..."
            value={link}
            onChange={(e) => setLink(e.target.value)}
            autoCapitalize="none"
          />
        </Field>
        <div style={{ fontSize: 12.5, color: "#71757F", lineHeight: 1.6, marginBottom: 22 }}>
          Set this to a custom-amount Payment Link from your own Stripe account. Money goes straight to you, not through Docket.
        </div>

        <Field label="Bank transfer details (optional)">
          <textarea
            style={{ ...styles.input, minHeight: 80, resize: "vertical", fontFamily: "inherit" }}
            placeholder={"e.g.\nAccount name: J Smith Electrical\nSort code: 12-34-56\nAccount no: 12345678"}
            value={bank}
            onChange={(e) => setBank(e.target.value)}
          />
        </Field>
        <div style={{ fontSize: 12.5, color: "#71757F", lineHeight: 1.6 }}>
          Shown to the customer on their invoice as an alternative to card payment — handy if you don't use Stripe. You can fill in one, both, or neither.
        </div>
      </div>
      <div style={styles.editorFooter}>
        <button style={{ ...styles.primaryBtn, flex: 1 }} onClick={() => onSave(link.trim(), bank.trim())}>
          Save
        </button>
      </div>
    </div>
  );
}

// ================= SUBSCRIBE SCREEN =================
function SubscribeScreen({ onConfirm }: { onConfirm: () => void }) {
  const [opened, setOpened] = useState(false);

  const openStripe = () => {
    window.open(SUBSCRIPTION_PAYMENT_LINK, "_blank");
    setOpened(true);
  };

  return (
    <div style={styles.app}>
      <FontLoader />
      <div style={styles.screen}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", padding: "0 30px", textAlign: "center" }}>
          <div style={styles.brandMark}><Zap size={20} color={AMBER} strokeWidth={2.5} /></div>
          <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 26, letterSpacing: 2, marginTop: 14 }}>DOCKET</div>
          <div style={{ color: "#8A8F98", fontSize: 14.5, marginTop: 10, lineHeight: 1.5 }}>
            Subscribe to send quotes, manage invoices, and get paid — all in one place.
          </div>
          <div style={{ fontFamily: MONO, color: AMBER, fontSize: 30, fontWeight: 700, marginTop: 26 }}>£15<span style={{ fontSize: 14, color: "#8A8F98" }}>/month</span></div>

          <button style={{ ...styles.primaryBtn, width: "100%", marginTop: 30 }} onClick={openStripe}>
            <Send size={16} color="#14161B" /> Subscribe with Stripe
          </button>

          {opened && (
            <button style={{ ...styles.secondaryBtn, width: "100%", marginTop: 12 }} onClick={onConfirm}>
              I've completed payment
            </button>
          )}
          {opened && (
            <div style={{ fontSize: 11.5, color: "#71757F", marginTop: 12 }}>
              Tap this once Stripe confirms your payment went through.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ================= LIST =================
function ListView({ activeList, paidList, tab, setTab, outstandingTotal, overdueCount, onOpen, onNew, onSettings }: {
  activeList: Job[];
  paidList: Job[];
  tab: "active" | "paid";
  setTab: (t: "active" | "paid") => void;
  outstandingTotal: number;
  overdueCount: number;
  onOpen: (id: string) => void;
  onNew: () => void;
  onSettings: () => void;
}) {
  const list = tab === "active" ? activeList : paidList;
  return (
    <div style={styles.screen}>
      <div style={styles.header}>
        <div style={styles.brandRow}>
          <div style={styles.brandMark}><Zap size={16} color={AMBER} strokeWidth={2.5} /></div>
          <span style={styles.brandName}>DOCKET</span>
          <div style={{ flex: 1 }} />
          <button style={styles.iconBtn} onClick={onSettings}><Wrench size={16} color="#8A8F98" /></button>
        </div>
        <div style={styles.summaryRow}>
          <div>
            <div style={styles.summaryLabel}>OUTSTANDING</div>
            <div style={styles.summaryValue}>{money(outstandingTotal)}</div>
          </div>
          {overdueCount > 0 && <div style={styles.overdueChip}>{overdueCount} overdue</div>}
        </div>
      </div>
      <div style={styles.tabRow}>
        {(["active", "paid"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} style={{ ...styles.tabBtn, color: tab === t ? INK : "#8A8F98", borderBottom: tab === t ? `2px solid ${AMBER}` : "2px solid transparent" }}>
            {t === "active" ? "Active" : "Paid"}
          </button>
        ))}
      </div>
      <div style={styles.list}>
        {list.length === 0 && (
          <div style={styles.empty}>
            <Wrench size={28} color="#54586A" strokeWidth={1.5} />
            <div style={styles.emptyTitle}>{tab === "active" ? "No jobs on the books" : "Nothing paid yet"}</div>
            <div style={styles.emptyBody}>{tab === "active" ? "Tap + to write your first quote." : "Paid invoices land here."}</div>
          </div>
        )}
        {list.slice().sort((a, b) => (b.number || 0) - (a.number || 0)).map((j) => {
          const meta = STATUS_META[j.status];
          const overdue = j.status === "approved" && j.due_date && j.due_date < todayISO();
          return (
            <button key={j.id} style={styles.card} onClick={() => onOpen(j.id)}>
              <div style={styles.cardLeft}>
                <div style={styles.jobNo}>#{String(j.number).padStart(3, "0")}</div>
                <div>
                  <div style={styles.cardCustomer}>{j.customer || "Untitled"}</div>
                  <div style={styles.cardJobDesc}>{j.job_desc || "No description"}</div>
                </div>
              </div>
              <div style={styles.cardRight}>
                <div style={styles.cardAmount}>{money(total(j))}</div>
                <div style={{ ...styles.statusPill, color: overdue ? "#C9491F" : meta.color, borderColor: overdue ? "#C9491F" : meta.color }}>
                  {overdue ? "Overdue" : meta.label}
                </div>
              </div>
            </button>
          );
        })}
      </div>
      <button style={styles.fab} onClick={onNew} aria-label="New quote"><Plus size={26} color="#14161B" strokeWidth={2.5} /></button>
    </div>
  );
}

// ================= EDITOR =================
function EditorView({ job, onBack, onChange, onLineChange, onAddLine, onRemoveLine, onSaveDraft, onSend }: {
  job: Job;
  onBack: () => void;
  onChange: (patch: Partial<Job>) => void;
  onLineChange: (id: string, patch: Partial<LineItem>) => void;
  onAddLine: () => void;
  onRemoveLine: (id: string) => void;
  onSaveDraft: () => void;
  onSend: () => void;
}) {
  const sub = subtotal(job), vat = vatAmount(job), tot = total(job);
  return (
    <div style={styles.screen}>
      <div style={styles.editorHeader}>
        <button style={styles.iconBtn} onClick={onBack}><X size={20} color={INK} /></button>
        <span style={styles.editorTitle}>New quote</span>
        <div style={{ width: 36 }} />
      </div>
      <div style={styles.editorBody}>
        <Field label="Customer name">
          <input style={styles.input} placeholder="e.g. Mrs Patterson" value={job.customer} onChange={(e) => onChange({ customer: e.target.value })} />
        </Field>
        <Field label="Phone (optional)">
          <div style={{ display: "flex", gap: 8 }}>
            <div style={styles.dialCodeWrap}>
              <span style={styles.dialCodePrefix}>+</span>
              <input style={{ ...styles.input, ...styles.dialCodeInput }} placeholder="44" inputMode="numeric" value={job.dial_code} onChange={(e) => onChange({ dial_code: e.target.value.replace(/[^\d]/g, "") })} />
            </div>
            <input style={{ ...styles.input, flex: 1 }} placeholder="7700 900123" inputMode="tel" value={job.phone} onChange={(e) => onChange({ phone: e.target.value })} />
          </div>
        </Field>
        <Field label="Job description">
          <input style={styles.input} placeholder="e.g. Rewire kitchen ring main" value={job.job_desc} onChange={(e) => onChange({ job_desc: e.target.value })} />
        </Field>
        <div style={styles.sectionLabel}>LINE ITEMS</div>
        {job.lines.map((l) => (
          <div key={l.id} style={styles.lineRow}>
            <input style={{ ...styles.input, flex: 1 }} placeholder="Item / labour" value={l.desc} onChange={(e) => onLineChange(l.id, { desc: e.target.value })} />
            <input style={{ ...styles.input, width: 46, textAlign: "center", fontFamily: MONO }} type="number" min="0" value={l.qty} onChange={(e) => onLineChange(l.id, { qty: e.target.value })} />
            <div style={styles.priceWrap}>
              <span style={styles.priceSign}>£</span>
              <input style={{ ...styles.input, width: 72, paddingLeft: 16, fontFamily: MONO }} type="number" min="0" value={l.price} onChange={(e) => onLineChange(l.id, { price: e.target.value })} />
            </div>
            {job.lines.length > 1 && <button style={styles.trashBtn} onClick={() => onRemoveLine(l.id)}><Trash2 size={16} color="#8A8F98" /></button>}
          </div>
        ))}
        <button style={styles.addLineBtn} onClick={onAddLine}><Plus size={15} color={AMBER} /> Add line</button>
        <label style={styles.vatRow}>
          <input type="checkbox" checked={job.vat_registered} onChange={(e) => onChange({ vat_registered: e.target.checked })} />
          <span>VAT registered (adds 20%)</span>
        </label>
        <div style={styles.totalsBox}>
          <TotalRow label="Subtotal" value={sub} />
          {job.vat_registered && <TotalRow label="VAT (20%)" value={vat} />}
          <TotalRow label="Total" value={tot} big />
        </div>
      </div>
      <div style={styles.editorFooter}>
        <button style={styles.secondaryBtn} onClick={onSaveDraft}>Save draft</button>
        <button style={styles.primaryBtn} onClick={onSend}><Send size={16} color="#14161B" /> Send quote</button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={styles.fieldLabel}>{label}</div>
      {children}
    </div>
  );
}
function TotalRow({ label, value, big }: { label: string; value: number; big?: boolean }) {
  return (
    <div style={styles.totalRow}>
      <span style={{ color: big ? INK : "#8A8F98", fontWeight: big ? 700 : 500 }}>{label}</span>
      <span style={{ fontFamily: MONO, color: big ? AMBER : INK, fontSize: big ? 22 : 15, fontWeight: big ? 700 : 500 }}>{money(value)}</span>
    </div>
  );
}

// ================= DETAIL (trader side) =================
function DetailView({ job, onBack, onApprove, onMarkPaid, onDelete, onShowToast }: {
  job: Job;
  onBack: () => void;
  onApprove: () => void;
  onMarkPaid: () => void;
  onDelete: () => void;
  onShowToast: (msg: string) => void;
}) {
  const meta = STATUS_META[job.status];
  const overdue = job.status === "approved" && job.due_date && job.due_date < todayISO();
  const stamped = job.status === "paid";
  const link = `${APP_BASE_URL}?job=${job.id}`;
  const message = buildMessage(job, link);
  const subject = `${job.status === "approved" || job.status === "paid" ? "Invoice" : "Quote"} #${String(job.number).padStart(3, "0")}`;

  const sendWhatsApp = () => {
    const num = phoneToWaNumber(job.phone, job.dial_code);
    window.open(num ? `https://wa.me/${num}?text=${encodeURIComponent(message)}` : `https://wa.me/?text=${encodeURIComponent(message)}`, "_blank");
  };
  const sendEmail = () => window.open(`mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`, "_blank");
  const sendSms = () => {
    const local = (job.phone || "").replace(/[^\d]/g, "").replace(/^0+/, "");
    const code = (job.dial_code || "").replace(/[^\d]/g, "");
    window.open(`sms:${local ? "+" + code + local : ""}?body=${encodeURIComponent(message)}`, "_blank");
  };
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(link); onShowToast?.("Link copied"); } catch { onShowToast?.("Couldn't copy"); }
  };

  return (
    <div style={styles.screen}>
      <div style={styles.editorHeader}>
        <button style={styles.iconBtn} onClick={onBack}><ArrowLeft size={20} color={INK} /></button>
        <span style={styles.editorTitle}>Job #{String(job.number).padStart(3, "0")}</span>
        <button style={styles.iconBtn} onClick={onDelete}><Trash2 size={18} color="#8A8F98" /></button>
      </div>

      <div style={styles.docketWrap}>
        <div style={styles.docket}>
          {stamped && <div style={styles.stamp}>PAID</div>}
          <div style={styles.docketTop}>
            <div>
              <div style={styles.docketLabel}>{job.status === "approved" || job.status === "paid" ? "INVOICE" : "QUOTE"}</div>
              <div style={styles.docketNumber}>#{String(job.number).padStart(3, "0")}</div>
            </div>
            <div style={{ ...styles.statusPill, color: overdue ? "#C9491F" : meta.color, borderColor: overdue ? "#C9491F" : meta.color }}>
              {overdue ? "Overdue" : meta.label}
            </div>
          </div>
          <div style={styles.docketDivider} />
          <div style={styles.docketRow}><span style={styles.docketMuted}>Customer</span><span style={styles.docketStrong}>{job.customer}</span></div>
          {job.phone && <div style={styles.docketRow}><span style={styles.docketMuted}>Phone</span><span style={styles.docketStrong}>+{job.dial_code} {job.phone}</span></div>}
          <div style={styles.docketRow}><span style={styles.docketMuted}>Job</span><span style={styles.docketStrong}>{job.job_desc}</span></div>
          <div style={styles.docketRow}><span style={styles.docketMuted}>Date</span><span style={styles.docketStrong}>{fmtDate(job.created_at)}</span></div>
          {job.due_date && <div style={styles.docketRow}><span style={styles.docketMuted}>Due</span><span style={styles.docketStrong}>{fmtDate(job.due_date)}</span></div>}
          <div style={styles.docketDivider} />
          {job.lines.map((l) => (
            <div key={l.id} style={styles.docketLineRow}>
              <span style={styles.docketLineDesc}>{l.desc || "—"} <span style={styles.docketQty}>× {l.qty}</span></span>
              <span style={{ fontFamily: MONO }}>{money(lineTotal(l))}</span>
            </div>
          ))}
          <div style={styles.docketDivider} />
          <TotalRow label="Subtotal" value={subtotal(job)} />
          {job.vat_registered && <TotalRow label="VAT (20%)" value={vatAmount(job)} />}
          <TotalRow label="Total" value={total(job)} big />
        </div>
      </div>

      {job.status !== "paid" && job.status !== "draft" && (
        <div style={styles.sendPanel}>
          <div style={styles.sendPanelLabel}>SEND TO CUSTOMER — INCLUDES LIVE LINK</div>
          <div style={styles.sendRow}>
            <button style={styles.sendBtn} onClick={sendWhatsApp}><MessageCircle size={17} color="#25D366" /><span>WhatsApp</span></button>
            <button style={styles.sendBtn} onClick={sendSms}><MessageSquare size={17} color={AMBER} /><span>SMS</span></button>
            <button style={styles.sendBtn} onClick={sendEmail}><Mail size={17} color="#8FB8FF" /><span>Email</span></button>
            <button style={styles.sendBtn} onClick={copyLink}><Link2 size={17} color="#B4B8C0" /><span>Copy link</span></button>
          </div>
          <div style={styles.sendHint}>The customer's link lets them approve (and later pay) without you doing it manually.</div>
        </div>
      )}

      <div style={styles.editorFooter}>
        {job.status === "sent" && <button style={styles.primaryBtn} onClick={onApprove}><Check size={16} color="#14161B" /> Mark approved manually</button>}
        {job.status === "approved" && <button style={styles.primaryBtn} onClick={onMarkPaid}><PoundSterling size={16} color="#14161B" /> Mark as paid manually</button>}
        {job.status === "paid" && <div style={styles.paidNote}>Payment received {fmtDate(job.paid_at!)}</div>}
        {job.status === "draft" && <div style={styles.paidNote}>Draft — not yet sent</div>}
      </div>
    </div>
  );
}

// ============================================================
// CUSTOMER VIEW — public, read-only + approve/pay
// ============================================================
function CustomerView({ jobId }: { jobId: string }) {
  const [job, setJob] = useState<Job | null>(null);
  const [traderLink, setTraderLink] = useState<string | null>(null);
  const [traderBank, setTraderBank] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [justApproved, setJustApproved] = useState(false);

  const load = useCallback(async () => {
    try {
      const rows = await sbSelect(`id=eq.${jobId}`);
      if (rows[0]) {
        setJob(rows[0]);
        try {
          const traderRows = await sbSelectTraders(`owner_id=eq.${rows[0].owner_id}`);
          setTraderLink(traderRows[0]?.payment_link || "");
          setTraderBank(traderRows[0]?.bank_details || "");
        } catch {
          setTraderLink("");
          setTraderBank("");
        }
      } else {
        setError(true);
      }
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => { load(); }, [load]);

  const approve = async () => {
    try {
      await sbUpdate(jobId, { status: "approved", approved_at: todayISO(), due_date: addDays(todayISO(), 14) });
      setJustApproved(true);
      await load();
    } catch {
      alert("Couldn't approve right now — please try again or contact the sender.");
    }
  };

  if (loading) return <div style={{ background: "#F4F1EA", minHeight: "100vh" }} />;
  if (error || !job) return (
    <div style={{ ...styles.app, background: "#F4F1EA" }}>
      <div style={{ padding: 40, textAlign: "center", color: "#1C1F26" }}>Quote not found. Ask the sender for a fresh link.</div>
    </div>
  );

  const kind = job.status === "draft" || job.status === "sent" ? "quote" : "invoice";
  const meta = STATUS_META[job.status];

  return (
    <div style={{ ...styles.app, background: "#F4F1EA" }}>
      <FontLoader />
      <div style={{ ...styles.screen, background: "#F4F1EA" }}>
        <div style={{ padding: "26px 20px 10px", display: "flex", alignItems: "center", gap: 8 }}>
          <ShieldCheck size={18} color="#1B6B54" />
          <span style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 15, color: "#1C1F26", letterSpacing: 1 }}>DOCKET · SECURE VIEW</span>
        </div>
        <div style={styles.docketWrap}>
          <div style={{ ...styles.docket, boxShadow: "0 4px 20px rgba(0,0,0,0.08)" }}>
            {job.status === "paid" && <div style={styles.stamp}>PAID</div>}
            <div style={styles.docketTop}>
              <div>
                <div style={styles.docketLabel}>{kind === "quote" ? "QUOTE" : "INVOICE"}</div>
                <div style={styles.docketNumber}>#{String(job.number).padStart(3, "0")}</div>
              </div>
              <div style={{ ...styles.statusPill, color: meta.color, borderColor: meta.color }}>{meta.label}</div>
            </div>
            <div style={styles.docketDivider} />
            <div style={styles.docketRow}><span style={styles.docketMuted}>For</span><span style={styles.docketStrong}>{job.customer}</span></div>
            <div style={styles.docketRow}><span style={styles.docketMuted}>Job</span><span style={styles.docketStrong}>{job.job_desc}</span></div>
            {job.due_date && <div style={styles.docketRow}><span style={styles.docketMuted}>Due</span><span style={styles.docketStrong}>{fmtDate(job.due_date)}</span></div>}
            <div style={styles.docketDivider} />
            {job.lines.map((l) => (
              <div key={l.id} style={styles.docketLineRow}>
                <span style={styles.docketLineDesc}>{l.desc || "—"} <span style={styles.docketQty}>× {l.qty}</span></span>
                <span style={{ fontFamily: MONO }}>{money(lineTotal(l))}</span>
              </div>
            ))}
            <div style={styles.docketDivider} />
            <TotalRow label="Subtotal" value={subtotal(job)} />
            {job.vat_registered && <TotalRow label="VAT (20%)" value={vatAmount(job)} />}
            <TotalRow label="Total" value={total(job)} big />
          </div>
        </div>

        <div style={{ padding: "10px 20px 30px" }}>
          {kind === "quote" && job.status === "sent" && !justApproved && (
            <button style={{ ...styles.primaryBtn, width: "100%" }} onClick={approve}>
              <Check size={16} color="#14161B" /> Approve this quote
            </button>
          )}
          {(justApproved || job.status === "approved") && (
            <div>
              <div style={{ textAlign: "center", color: "#1B6B54", fontWeight: 600, fontSize: 13.5, marginBottom: 10 }}>
                ✓ Approved
              </div>
              {traderLink && (
                <a
                  href={traderLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ ...styles.primaryBtn, width: "100%", textDecoration: "none" }}
                >
                  <PoundSterling size={16} color="#14161B" /> Pay by card — {money(total(job))}
                </a>
              )}
              {traderBank && (
                <div style={{ marginTop: traderLink ? 14 : 0, background: "#EDE9DE", borderRadius: 9, padding: "14px 16px" }}>
                  <div style={{ fontSize: 11, letterSpacing: 1, fontWeight: 700, color: "#8A8478", marginBottom: 6 }}>
                    OR PAY BY BANK TRANSFER
                  </div>
                  <div style={{ fontSize: 13.5, color: "#3A3E48", whiteSpace: "pre-wrap", lineHeight: 1.6 }}>
                    {traderBank}
                  </div>
                </div>
              )}
              {!traderLink && !traderBank && (
                <button style={{ ...styles.primaryBtn, width: "100%", opacity: 0.5 }} disabled>
                  <PoundSterling size={16} color="#14161B" /> Payment details not set up yet
                </button>
              )}
            </div>
          )}
          {job.status === "paid" && (
            <div style={{ textAlign: "center", color: "#1B6B54", fontWeight: 600, fontSize: 14 }}>
              Payment received — thank you.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ================= tokens & shared styles =================
const BASE = "#14161B";
const INK = "#EDEAE3";
const AMBER = "#F5A623";
const DISPLAY = "'Barlow Condensed', sans-serif";
const BODY = "'Inter', sans-serif";
const MONO = "'JetBrains Mono', monospace";

function FontLoader() {
  useEffect(() => {
    const id = "docket-fonts";
    if (document.getElementById(id)) return;
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500;700&display=swap";
    document.head.appendChild(link);
  }, []);
  return null;
}

const styles: Record<string, React.CSSProperties> = {
  app: { background: BASE, minHeight: "100vh", fontFamily: BODY, color: INK },
  screen: { maxWidth: 480, margin: "0 auto", minHeight: "100vh", display: "flex", flexDirection: "column", position: "relative" },
  header: { padding: "22px 20px 14px" },
  brandRow: { display: "flex", alignItems: "center", gap: 8, marginBottom: 18 },
  brandMark: { width: 26, height: 26, borderRadius: 6, background: "#2A2E38", display: "flex", alignItems: "center", justifyContent: "center" },
  brandName: { fontFamily: DISPLAY, fontWeight: 700, fontSize: 20, letterSpacing: 3, color: INK },
  summaryRow: { display: "flex", alignItems: "flex-end", justifyContent: "space-between" },
  summaryLabel: { fontSize: 11, letterSpacing: 1.5, color: "#71757F", fontWeight: 600, marginBottom: 2 },
  summaryValue: { fontFamily: MONO, fontSize: 34, fontWeight: 700, color: AMBER, lineHeight: 1 },
  overdueChip: { background: "rgba(201,73,31,0.15)", color: "#E06A46", fontSize: 12, fontWeight: 600, padding: "6px 10px", borderRadius: 20, border: "1px solid rgba(224,106,70,0.4)" },
  tabRow: { display: "flex", gap: 22, padding: "0 20px", borderBottom: "1px solid #262A33" },
  tabBtn: { background: "none", border: "none", padding: "10px 0 12px", fontSize: 14, fontWeight: 600, cursor: "pointer" },
  list: { flex: 1, padding: "14px 16px 100px", display: "flex", flexDirection: "column", gap: 10 },
  empty: { display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", padding: "60px 30px", gap: 6 },
  emptyTitle: { fontFamily: DISPLAY, fontSize: 18, fontWeight: 700, color: INK, marginTop: 6 },
  emptyBody: { fontSize: 13, color: "#71757F" },
  card: { background: "#20232B", border: "1px solid #282C35", borderRadius: 10, padding: "13px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", textAlign: "left" },
  cardLeft: { display: "flex", alignItems: "center", gap: 12 },
  jobNo: { fontFamily: MONO, fontSize: 12, color: "#54586A", fontWeight: 700, minWidth: 34 },
  cardCustomer: { fontSize: 15, fontWeight: 600, color: INK },
  cardJobDesc: { fontSize: 12.5, color: "#8A8F98", marginTop: 1, maxWidth: 190, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  cardRight: { display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 5 },
  cardAmount: { fontFamily: MONO, fontSize: 15, fontWeight: 700, color: INK },
  statusPill: { fontSize: 10.5, fontWeight: 700, letterSpacing: 0.4, padding: "3px 8px", borderRadius: 20, border: "1px solid", textTransform: "uppercase" },
  fab: { position: "absolute", right: 20, bottom: 26, width: 56, height: 56, borderRadius: 28, background: AMBER, border: "none", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 6px 18px rgba(245,166,35,0.35)", cursor: "pointer" },
  editorHeader: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 14px", borderBottom: "1px solid #262A33" },
  editorTitle: { fontFamily: DISPLAY, fontWeight: 700, fontSize: 18, letterSpacing: 0.5 },
  iconBtn: { width: 36, height: 36, borderRadius: 8, border: "none", background: "#20232B", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" },
  editorBody: { flex: 1, padding: "18px 18px 30px", overflowY: "auto" },
  fieldLabel: { fontSize: 11.5, fontWeight: 600, color: "#8A8F98", marginBottom: 6, letterSpacing: 0.3 },
  input: { width: "100%", boxSizing: "border-box", background: "#20232B", border: "1px solid #2E323C", borderRadius: 8, padding: "11px 12px", color: INK, fontSize: 14.5, fontFamily: BODY, outline: "none" },
  dialCodeWrap: { position: "relative", width: 64, flexShrink: 0 },
  dialCodePrefix: { position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "#8A8F98", fontSize: 14.5 },
  dialCodeInput: { paddingLeft: 20, width: "100%" },
  sectionLabel: { fontSize: 11, letterSpacing: 1.5, color: "#71757F", fontWeight: 700, margin: "22px 0 10px" },
  lineRow: { display: "flex", gap: 8, marginBottom: 8, alignItems: "center" },
  priceWrap: { position: "relative" },
  priceSign: { position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", color: "#71757F", fontSize: 13, fontFamily: MONO },
  trashBtn: { background: "none", border: "none", cursor: "pointer", padding: 4 },
  addLineBtn: { display: "flex", alignItems: "center", gap: 6, background: "none", border: "1px dashed #333842", borderRadius: 8, padding: "9px 12px", color: AMBER, fontWeight: 600, fontSize: 13.5, cursor: "pointer", width: "100%", justifyContent: "center", marginTop: 2 },
  vatRow: { display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, color: "#B4B8C0", marginTop: 20, cursor: "pointer" },
  totalsBox: { marginTop: 20, paddingTop: 14, borderTop: "1px solid #262A33" },
  totalRow: { display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "5px 0" },
  editorFooter: { display: "flex", gap: 10, padding: "14px 18px 22px", borderTop: "1px solid #262A33" },
  secondaryBtn: { flex: 1, background: "#20232B", border: "1px solid #2E323C", borderRadius: 9, padding: "13px 0", color: INK, fontWeight: 600, fontSize: 14.5, cursor: "pointer" },
  primaryBtn: { flex: 2, background: AMBER, border: "none", borderRadius: 9, padding: "13px 0", color: "#14161B", fontWeight: 700, fontSize: 14.5, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 7 },
  paidNote: { flex: 1, textAlign: "center", color: "#71757F", fontSize: 13, padding: "13px 0" },
  docketWrap: { flex: 1, padding: "18px 16px 10px", overflowY: "auto" },
  docket: { background: "#F4F1EA", color: "#1C1F26", borderRadius: 10, padding: "22px 20px", position: "relative", overflow: "hidden", boxShadow: "0 10px 30px rgba(0,0,0,0.35)" },
  stamp: { position: "absolute", top: 26, right: -34, background: "rgba(27,107,84,0.12)", color: "#1B6B54", border: "3px solid #1B6B54", fontFamily: DISPLAY, fontWeight: 700, fontSize: 26, letterSpacing: 4, padding: "4px 40px", transform: "rotate(18deg)", borderRadius: 6 },
  docketTop: { display: "flex", justifyContent: "space-between", alignItems: "flex-start" },
  docketLabel: { fontSize: 11, letterSpacing: 2, fontWeight: 700, color: "#8A8F98" },
  docketNumber: { fontFamily: DISPLAY, fontSize: 30, fontWeight: 700, lineHeight: 1.1 },
  docketDivider: { borderTop: "1px dashed #C9C4B6", margin: "14px 0" },
  docketRow: { display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 13.5 },
  docketMuted: { color: "#8A8F98" },
  docketStrong: { fontWeight: 600, textAlign: "right", maxWidth: "65%" },
  docketLineRow: { display: "flex", justifyContent: "space-between", fontSize: 13.5, padding: "4px 0" },
  docketLineDesc: { color: "#3A3E48" },
  docketQty: { color: "#8A8F98", fontFamily: MONO, fontSize: 12 },
  sendPanel: { padding: "4px 16px 14px" },
  sendPanelLabel: { fontSize: 11, letterSpacing: 1.5, color: "#71757F", fontWeight: 700, marginBottom: 9, paddingLeft: 2 },
  sendRow: { display: "flex", gap: 8 },
  sendBtn: { flex: 1, background: "#20232B", border: "1px solid #2E323C", borderRadius: 9, padding: "10px 4px", display: "flex", flexDirection: "column", alignItems: "center", gap: 5, color: "#B4B8C0", fontSize: 11, fontWeight: 600, cursor: "pointer" },
  sendHint: { fontSize: 11.5, color: "#71757F", marginTop: 8, paddingLeft: 2 },
  toast: { position: "fixed", bottom: 100, left: "50%", transform: "translateX(-50%)", background: "#20232B", border: "1px solid #333842", color: INK, padding: "10px 18px", borderRadius: 30, fontSize: 13.5, fontWeight: 500, boxShadow: "0 8px 24px rgba(0,0,0,0.4)" },
};
