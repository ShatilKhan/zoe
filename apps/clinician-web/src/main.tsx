import { StrictMode, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { decodeEnvelope, decryptShare, type SharePayload } from "@zoe/share-contract";
import "./styles.css";
import { canCommitDecryptedContent, stateAfterAuthChange } from "./sessionGuard";

const projectUrl = import.meta.env.VITE_SUPABASE_URL || "https://ixwpotnpnlotjecmjbnb.supabase.co";
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";

type ViewerState =
  | { status: "checking" }
  | { status: "signed-out"; keyWasDiscarded: boolean }
  | { status: "ready-to-open" }
  | { status: "opening" }
  | { status: "ready"; payload: SharePayload }
  | { status: "error"; message: string };

function shareReference() {
  const objectId = new URLSearchParams(window.location.search).get("objectId") ?? "";
  const key = decodeURIComponent(window.location.hash.slice(1));
  if (!/^[0-9a-f-]{36}$/i.test(objectId) || !key) throw new Error("This link is missing its encrypted share reference or fragment key.");
  return { objectId, key };
}

async function downloadAndDecrypt(client: SupabaseClient, session: Session): Promise<SharePayload> {
  const { objectId, key } = shareReference();
  history.replaceState(null, "", `${window.location.pathname}?objectId=${encodeURIComponent(objectId)}`);
  const response = await fetch(`${projectUrl}/functions/v1/download-share`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${session.access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ objectId })
  });
  if (!response.ok) throw new Error(response.status === 404 ? "This share is expired, revoked, or unavailable." : "The encrypted share could not be downloaded.");
  const envelope = decodeEnvelope(new TextDecoder().decode(await response.arrayBuffer()));
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new Error("The signed-in clinician account could not be verified.");
  return decryptShare(envelope, key, data.user.id);
}

function App() {
  const client = useMemo(() => publishableKey ? createClient(projectUrl, publishableKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } }) : null, []);
  const [session, setSession] = useState<Session | null>(null);
  const [state, setState] = useState<ViewerState>({ status: "checking" });
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [authMessage, setAuthMessage] = useState("");
  const viewerUserId = useRef<string | null>(null);

  useEffect(() => {
    if (!client) {
      setState({ status: "error", message: "Clinician viewer is not configured with the Supabase publishable key." });
      return;
    }
    void client.auth.getSession().then(({ data }) => {
      setSession(data.session);
      viewerUserId.current = data.session?.user.id ?? null;
      if (data.session) setState({ status: "ready-to-open" });
      else {
        const hadKey = Boolean(window.location.hash);
        if (hadKey) history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
        setState({ status: "signed-out", keyWasDiscarded: hadKey });
      }
    });
    const { data: subscription } = client.auth.onAuthStateChange((_event, nextSession) => {
      const nextUserId = nextSession?.user.id ?? null;
      const previousUserId = viewerUserId.current;
      viewerUserId.current = nextUserId;
      setSession(nextSession);
      setState((current) => stateAfterAuthChange(current, previousUserId, nextUserId));
    });
    return () => subscription.subscription.unsubscribe();
  }, [client]);

  async function requestOtp() {
    if (!client) return;
    setAuthMessage("");
    const { error } = await client.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
    if (error) setAuthMessage(error.message);
    else { setOtpSent(true); setAuthMessage("Check your email for the one-time code."); }
  }

  async function verifyOtp() {
    if (!client) return;
    setAuthMessage("");
    const { data, error } = await client.auth.verifyOtp({ email, token: otp, type: "email" });
    if (error || !data.session) { setAuthMessage(error?.message ?? "The code could not be verified."); return; }
    setSession(data.session);
    viewerUserId.current = data.session.user.id;
    setState({ status: "ready-to-open" });
  }

  async function openShare() {
    if (!client || !session) return;
    const openingUserId = session.user.id;
    setState({ status: "opening" });
    try {
      const payload = await downloadAndDecrypt(client, session);
      if (!canCommitDecryptedContent(openingUserId, viewerUserId.current)) throw new Error("The clinician account changed while the share was opening.");
      setState({ status: "ready", payload });
    } catch (error) {
      setState({ status: "error", message: error instanceof Error ? error.message : "Could not open this share." });
    }
  }

  return (
    <main>
      <header className="site-header">
        <a className="brand" href="/" aria-label="Zoe clinician viewer"><span className="mark">Z</span><span>Zoe</span></a>
        <span className="prototype">Clinician viewer · identity not verified</span>
      </header>
      {state.status === "signed-out" ? (
        <section className="access-shell">
          <div className="intro-panel"><p className="eyebrow">INVITED RECORDS</p><h1>Sign in before opening the patient’s link.</h1><p>Zoe shares an encrypted selection—not a full chart. This MVP verifies the recipient account through Supabase Auth, but does not verify a clinical license.</p></div>
          <form className="sign-in" onSubmit={(event) => { event.preventDefault(); void (otpSent ? verifyOtp() : requestOtp()); }}>
            <p className="eyebrow">EMAIL ONE-TIME CODE</p><h2>{otpSent ? "Enter your code" : "Clinician sign in"}</h2>
            <label htmlFor="email">Email</label><input id="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required disabled={otpSent} autoComplete="email" />
            {otpSent ? <><label htmlFor="otp">One-time code</label><input id="otp" inputMode="numeric" value={otp} onChange={(event) => setOtp(event.target.value)} required autoComplete="one-time-code" /></> : null}
            <button type="submit">{otpSent ? "Verify code" : "Send code"}</button>
            {authMessage ? <small>{authMessage}</small> : null}
            {state.keyWasDiscarded ? <div className="notice">For privacy, Zoe discarded the fragment key while you were signed out. After sign-in, reopen the original patient link.</div> : null}
          </form>
        </section>
      ) : null}
      {state.status === "ready-to-open" ? <section className="status"><h2>Signed in</h2><p>Open the original patient link now. If this page still has a fragment key, continue below.</p><button onClick={() => void openShare()}>Open encrypted share</button></section> : null}
      {state.status === "opening" || state.status === "checking" ? <section className="status"><div className="spinner" /><p>{state.status === "checking" ? "Checking sign-in…" : "Checking grant and decrypting in this browser…"}</p></section> : null}
      {state.status === "error" ? <section className="status error"><h2>Share unavailable</h2><p>{state.message}</p><p>No record content was rendered.</p></section> : null}
      {state.status === "ready" ? (
        <section className="viewer">
          <aside><p className="eyebrow">PATIENT-SELECTED</p><h1>{state.payload.patientDisplayName}</h1><p>Shared {new Date(state.payload.createdAt).toLocaleString()}</p><div className="notice">Clinician account matched the encrypted recipient. Clinical license remains unverified.</div></aside>
          <div className="record-list"><div className="list-head"><div><p className="eyebrow">SELECTED RECORDS</p><h2>{state.payload.records.length} items</h2></div><span className="secure">Decrypted locally</span></div>{state.payload.records.map((record) => <article key={record.id}><div className="record-meta"><span>{record.kind}</span><span>{record.source}</span></div><h3>{record.title}</h3><p>{record.detail}</p><time>{new Date(record.recordedAt).toLocaleDateString()}</time></article>)}</div>
        </section>
      ) : null}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
