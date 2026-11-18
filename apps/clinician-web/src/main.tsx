import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { assertEnvelopeMatchesGrant, decodeEnvelope, decryptShare, type AuthorizedGrantMetadata, type SharePayload } from "@zoe/share-contract";
import "./styles.css";
import { canCommitDecryptedContent, captureAndScrubShareReference, createOneShotReference, stateAfterAuthChange, type ShareReference } from "./sessionGuard";
import zoeMarkUrl from "../../../assets/brand/zoe-mark-transparent.png";

const projectUrl = import.meta.env.VITE_SUPABASE_URL || "https://ixwpotnpnlotjecmjbnb.supabase.co";
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";

type ViewerState =
  | { status: "checking" }
  | { status: "signed-out"; keyWasDiscarded: boolean }
  | { status: "ready-to-open" }
  | { status: "opening" }
  | { status: "ready"; payload: SharePayload }
  | { status: "error"; message: string };

let initialReference: ShareReference | null = null;
let capturedReferenceError = "";
try {
  initialReference = captureAndScrubShareReference(window.location, (url) => history.replaceState(null, "", url));
} catch (error) {
  capturedReferenceError = error instanceof Error ? error.message : "The encrypted share link is invalid.";
}
const moduleReference = createOneShotReference(initialReference);
initialReference = null;

async function downloadAndDecrypt(client: SupabaseClient, session: Session, reference: ShareReference): Promise<SharePayload> {
  const { objectId, key } = reference;
  const response = await fetch(`${projectUrl}/functions/v1/download-share`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${session.access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ objectId })
  });
  if (!response.ok) throw new Error(response.status === 404 ? "This share is expired, revoked, or unavailable." : "The encrypted share could not be downloaded.");
  const body = await response.json() as { encodedEnvelope?: unknown; grant?: Partial<AuthorizedGrantMetadata> };
  if (typeof body.encodedEnvelope !== "string" || !body.grant || typeof body.grant.grantId !== "string" || typeof body.grant.patientId !== "string" || typeof body.grant.recipientId !== "string" || typeof body.grant.objectId !== "string" || typeof body.grant.expiresAt !== "string") {
    throw new Error("The share authorization response was invalid.");
  }
  const envelope = decodeEnvelope(body.encodedEnvelope);
  const grant = body.grant as AuthorizedGrantMetadata;
  assertEnvelopeMatchesGrant(envelope, grant);
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
  const [displayName, setDisplayName] = useState("");
  const [organization, setOrganization] = useState("");
  const [acceptingShares, setAcceptingShares] = useState(true);
  const [enrollmentMessage, setEnrollmentMessage] = useState("");
  const viewerUserId = useRef<string | null>(null);
  const pendingReference = useRef<ShareReference | null>(moduleReference.take());

  useEffect(() => {
    if (!client) {
      setState({ status: "error", message: "Clinician viewer is not configured with the Supabase publishable key." });
      return;
    }
    void client.auth.getSession().then(({ data }) => {
      setSession(data.session);
      viewerUserId.current = data.session?.user.id ?? null;
      if (data.session) setState(capturedReferenceError ? { status: "error", message: capturedReferenceError } : { status: "ready-to-open" });
      else {
        const hadKey = pendingReference.current !== null;
        pendingReference.current = null;
        setState({ status: "signed-out", keyWasDiscarded: hadKey });
      }
    });
    const { data: subscription } = client.auth.onAuthStateChange((_event, nextSession) => {
      const nextUserId = nextSession?.user.id ?? null;
      const previousUserId = viewerUserId.current;
      if (previousUserId !== nextUserId) pendingReference.current = null;
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
    const reference = pendingReference.current;
    pendingReference.current = null;
    if (!reference) { setState({ status: "error", message: "The fragment key is no longer in memory. Reopen the original patient link." }); return; }
    const openingUserId = session.user.id;
    setState({ status: "opening" });
    try {
      const payload = await downloadAndDecrypt(client, session, reference);
      if (!canCommitDecryptedContent(openingUserId, viewerUserId.current)) throw new Error("The clinician account changed while the share was opening.");
      setState({ status: "ready", payload });
    } catch (error) {
      setState({ status: "error", message: error instanceof Error ? error.message : "Could not open this share." });
    }
  }

  async function saveEnrollment() {
    if (!client || !session) return;
    setEnrollmentMessage("");
    const name = displayName.trim();
    const org = organization.trim();
    if (name.length < 2 || org.length < 2) { setEnrollmentMessage("Name and organization are required."); return; }
    const { error } = await client.from("share_recipients").upsert({ user_id: session.user.id, display_name: name, organization: org, accepting_shares: acceptingShares, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    setEnrollmentMessage(error ? error.message : "Self-declared recipient profile saved.");
  }

  async function signOut() {
    if (!client) return;
    pendingReference.current = null;
    setState({ status: "signed-out", keyWasDiscarded: false });
    await client.auth.signOut();
  }

  return (
    <main>
      <header className="site-header">
        <a className="brand" href="/" aria-label="Zoe clinician viewer"><img className="brand-mark" src={zoeMarkUrl} alt="" /><span>Zoe</span></a>
        <div className="header-actions"><span className="prototype">Clinician viewer · identity not verified</span>{session ? <button className="sign-out" onClick={() => void signOut()}>Sign out</button> : null}</div>
      </header>
      {state.status === "signed-out" ? (
        <section className="access-shell">
          <div className="intro-panel"><p className="eyebrow">Invited records</p><h1>Sign in before opening the patient’s link.</h1><p>Zoe shares an encrypted selection—not a full chart. This MVP verifies the recipient account through Supabase Auth, but does not verify a clinical license.</p></div>
          <form className="sign-in" onSubmit={(event) => { event.preventDefault(); void (otpSent ? verifyOtp() : requestOtp()); }}>
            <p className="eyebrow">Email one-time code</p><h2>{otpSent ? "Enter your code" : "Clinician sign in"}</h2>
            <label htmlFor="email">Email</label><input id="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required disabled={otpSent} autoComplete="email" />
            {otpSent ? <><label htmlFor="otp">One-time code</label><input id="otp" inputMode="numeric" value={otp} onChange={(event) => setOtp(event.target.value)} required autoComplete="one-time-code" /></> : null}
            <button type="submit">{otpSent ? "Verify code" : "Send code"}</button>
            {authMessage ? <small>{authMessage}</small> : null}
            {state.keyWasDiscarded ? <div className="notice">For privacy, Zoe discarded the fragment key while you were signed out. After sign-in, reopen the original patient link.</div> : null}
          </form>
        </section>
      ) : null}
      {state.status === "ready-to-open" ? <section className="ready-grid"><div className="status"><h2>Signed in</h2><p>{pendingReference.current ? "The link key was removed from the address bar and is held only in this page until you open it." : "Reopen the original patient link to load its one-time fragment key."}</p><button disabled={!pendingReference.current} onClick={() => void openShare()}>Open encrypted share</button></div><form className="enrollment" onSubmit={(event) => { event.preventDefault(); void saveEnrollment(); }}><p className="eyebrow">Recipient directory</p><h2>Self-declared profile</h2><p>This makes your authenticated account discoverable for shares. Zoe does not verify identity, employment, or licensure.</p><label htmlFor="display-name">Display name</label><input id="display-name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} required /><label htmlFor="organization">Organization</label><input id="organization" value={organization} onChange={(event) => setOrganization(event.target.value)} required /><label className="checkbox-row"><input type="checkbox" checked={acceptingShares} onChange={(event) => setAcceptingShares(event.target.checked)} />Accept new Zoe shares</label><button type="submit">Save recipient profile</button>{enrollmentMessage ? <small>{enrollmentMessage}</small> : null}<small>Account ID: {session?.user.id}</small></form></section> : null}
      {state.status === "opening" || state.status === "checking" ? <section className="status"><div className="spinner" /><p>{state.status === "checking" ? "Checking sign-in…" : "Checking grant and decrypting in this browser…"}</p></section> : null}
      {state.status === "error" ? <section className="status error"><h2>Share unavailable</h2><p>{state.message}</p><p>No record content was rendered.</p></section> : null}
      {state.status === "ready" ? (
        <section className="viewer">
          <aside><p className="eyebrow">Patient-selected</p><h1>{state.payload.patientDisplayName}</h1><p>Shared {new Date(state.payload.createdAt).toLocaleString()}</p><div className="notice">Clinician account matched the encrypted recipient. Clinical license remains unverified.</div></aside>
          <div className="record-list"><div className="list-head"><div><p className="eyebrow">Selected records</p><h2>{state.payload.records.length} items</h2></div><span className="secure">Decrypted locally</span></div>{state.payload.records.map((record) => <article key={record.id}><div className="record-meta"><span>{record.kind}</span><span>{record.source}</span></div><h3>{record.title}</h3><p>{record.detail}</p><time>{new Date(record.recordedAt).toLocaleDateString()}</time></article>)}</div>
        </section>
      ) : null}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
