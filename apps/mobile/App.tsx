import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  AppState,
  Image,
  ImageBackground,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import { StatusBar } from "expo-status-bar";
import * as ImagePicker from "expo-image-picker";
import { calculateNutrition, matchFood, parseExplicitGrams } from "@zoe/nutrition";
import { SYNTHETIC_RECORDS, answerFromRecords, confirmRecord, createDraftRecord, type PatientRecord, type RecordKind } from "@zoe/records";
import { getNativeCapabilities } from "./src/platform/capabilities";
import { cloudAuthAvailable, listShareGrants, requestEmailOtp, resolveShareRecipient, revokeShareGrant, uploadEncryptedShare, verifyEmailOtp, type CloudGrant, type CloudSession, type ResolvedRecipient } from "./src/platform/cloud";
import { openVault, VaultAccessError, type Vault, type VaultOpenOptions } from "./src/platform/vault";
import { UnlockRateLimiter, validateNewPassphrase } from "./src/platform/vaultPolicy";
import { recordsForOpenedVault } from "./src/platform/recordBootstrap";
import { lockThenClear, migrationBackAction, migrationRequiresCompletion } from "./src/platform/appLifecycle";

type Screen = "home" | "records" | "ask" | "wellness" | "share";
type AccessState = "intro" | "login" | "passphrase" | "migration" | "unlocking" | "ready";

const brandMark = require("../../assets/brand/zoe-mark-transparent.png");
const colors = {
  ink: "#182D28",
  muted: "#60736D",
  cream: "#F7F2E9",
  paper: "#FFFDF8",
  mint: "#DDEBE2",
  moss: "#2F5D4F",
  orange: "#E97845",
  line: "#D9DED8",
  danger: "#9E3D35"
};

function Button({ label, onPress, variant = "primary", disabled = false, accessibilityLabel }: { label: string; onPress: () => void; variant?: "primary" | "secondary" | "ghost"; disabled?: boolean; accessibilityLabel?: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.button, styles[`button_${variant}`], pressed && !disabled && styles.pressed, disabled && styles.disabled]}
    >
      <Text style={[styles.buttonText, variant !== "primary" && styles.buttonTextDark]}>{label}</Text>
    </Pressable>
  );
}

function Field({ label, value, onChangeText, placeholder, multiline = false, secureTextEntry = false }: { label: string; value: string; onChangeText: (value: string) => void; placeholder?: string; multiline?: boolean; secureTextEntry?: boolean }) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#87958F"
        multiline={multiline}
        secureTextEntry={secureTextEntry}
        style={[styles.input, multiline && styles.multiline]}
      />
    </View>
  );
}

function PassphraseAccess({ accountId, setup, error, onSubmit, onCancel, cancelLabel = "Back" }: { accountId: string; setup: boolean; error: string; onSubmit: (passphrase: string) => void; onCancel: () => void; cancelLabel?: string }) {
  const [passphrase, setPassphrase] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [localError, setLocalError] = useState("");
  const limiter = useRef(new UnlockRateLimiter()).current;

  function submit() {
    const wait = limiter.remainingMs();
    if (wait > 0) { setLocalError(`Wait ${Math.ceil(wait / 1000)} seconds before trying again.`); return; }
    if (setup) {
      const strengthError = validateNewPassphrase(passphrase, accountId);
      if (strengthError) { setLocalError(strengthError); return; }
      if (passphrase !== confirmation) { setLocalError("The two passphrases do not match."); return; }
    }
    setLocalError("");
    onSubmit(passphrase);
    setPassphrase("");
    setConfirmation("");
  }

  useEffect(() => {
    if (!error) return;
    const delay = limiter.recordFailure();
    if (delay > 0) setLocalError(`Too many failed attempts. Wait ${Math.ceil(delay / 1000)} seconds. This delay does not protect a copied database from offline guessing.`);
  }, [error, limiter]);

  return <SafeAreaView style={styles.accessPage}><View style={styles.loginCard}>
    <Text style={styles.eyebrow}>{setup ? "NEW DEVICE-BOUND VAULT" : "PRIVATE VAULT"}</Text>
    <Text style={styles.sectionTitle}>{setup ? "Create a strong passphrase" : "Enter your vault passphrase"}</Text>
    <Text style={styles.supporting}>{setup ? "Zoe combines this passphrase with a random account-specific secret held by Android Keystore. The passphrase alone cannot open a copied database." : `Unlock ${accountId}. The passphrase is processed only on this device.`}</Text>
    <Field label="Vault passphrase" value={passphrase} onChangeText={setPassphrase} secureTextEntry placeholder={setup ? "16+ varied characters or 4 unrelated words" : "Your vault passphrase"} />
    {setup ? <Field label="Confirm vault passphrase" value={confirmation} onChangeText={setConfirmation} secureTextEntry placeholder="Enter it again" /> : null}
    <View style={styles.notice}><Text style={styles.cardTitle}>No recovery</Text><Text style={styles.cardCopy}>Zoe never uploads this passphrase or vault key. Uninstalling the app, clearing its storage, losing the Keystore secret, or forgetting the passphrase makes this local vault unrecoverable.</Text></View>
    {localError || error ? <Text style={styles.error}>{localError || error}</Text> : null}
    <Button label={setup ? "Create encrypted vault" : "Unlock encrypted vault"} onPress={submit} disabled={!passphrase || (setup && !confirmation)} />
    <Button label={cancelLabel} variant="ghost" onPress={onCancel} />
  </View></SafeAreaView>;
}

function Intro({ onDone }: { onDone: () => void }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.92)).current;
  useEffect(() => {
    const animation = Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 450, useNativeDriver: Platform.OS !== "web" }),
      Animated.spring(scale, { toValue: 1, friction: 8, tension: 55, useNativeDriver: Platform.OS !== "web" })
    ]);
    animation.start();
    const timer = setTimeout(onDone, 1050);
    return () => {
      clearTimeout(timer);
      animation.stop();
    };
  }, [onDone, opacity, scale]);
  return (
    <View style={styles.intro}>
      <Animated.Image source={brandMark} resizeMode="contain" style={[styles.introMark, { opacity, transform: [{ scale }] }]} />
      <Text style={styles.introWord}>Zoe</Text>
      <Text style={styles.introTagline}>Your health story, held by you.</Text>
    </View>
  );
}

function Login({ onPreview, onCloud, error }: { onPreview: (accountId: string) => void; onCloud: (session: CloudSession) => void; error: string }) {
  const [accountId, setAccountId] = useState("synthetic-patient-a");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [authMessage, setAuthMessage] = useState("");

  async function handleCloudAuth() {
    setAuthMessage("");
    try {
      if (!otpSent) {
        await requestEmailOtp(email.trim());
        setOtpSent(true);
        setAuthMessage("Check your email for the one-time code.");
      } else {
        onCloud(await verifyEmailOtp(email.trim(), otp.trim()));
      }
    } catch (caught) {
      setAuthMessage(caught instanceof Error ? caught.message : "Authentication failed.");
    }
  }
  return (
    <SafeAreaView style={styles.accessPage}>
      <View style={styles.accessArt}>
        <Image source={brandMark} resizeMode="contain" style={styles.loginMark} />
        <Text style={styles.eyebrow}>PRIVATE BY DESIGN</Text>
        <Text style={styles.heroTitle}>Your history stays close.</Text>
        <Text style={styles.heroCopy}>Keep reviewed records on this device. Share only the pieces you choose.</Text>
      </View>
      <View style={styles.loginCard}>
        <Text style={styles.sectionTitle}>Enter Zoe</Text>
        {cloudAuthAvailable ? <>
          <Text style={styles.supporting}>Use an email one-time code. The authenticated Supabase user ID selects a separate local encrypted vault.</Text>
          <Field label="Email" value={email} onChangeText={setEmail} placeholder="you@example.com" />
          {otpSent ? <Field label="One-time code" value={otp} onChangeText={setOtp} placeholder="123456" /> : null}
          <Button label={otpSent ? "Verify code and unlock" : "Send one-time code"} onPress={() => void handleCloudAuth()} />
          {authMessage ? <Text style={styles.supporting}>{authMessage}</Text> : null}
          <Text style={styles.finePrint}>Or use the isolated synthetic preview below.</Text>
        </> : <Text style={styles.noticeText}>Cloud auth is unavailable until the Supabase publishable key is injected. No service-role key belongs in this app.</Text>}
        <Field label="Synthetic account ID" value={accountId} onChangeText={setAccountId} placeholder="synthetic-patient-a" />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Button label="Unlock synthetic preview" variant="secondary" onPress={() => onPreview(accountId.trim())} />
        <Text style={styles.finePrint}>Not for diagnosis or treatment. No recovery after uninstall in the MVP.</Text>
      </View>
    </SafeAreaView>
  );
}

function Header({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={styles.header}>
      <View style={styles.headerBrand}>
        <Image source={brandMark} style={styles.headerMark} />
        <Text style={styles.headerWord}>Zoe</Text>
      </View>
      <Text style={styles.screenTitle}>{title}</Text>
      {subtitle ? <Text style={styles.supporting}>{subtitle}</Text> : null}
    </View>
  );
}

function Home({ records, setScreen, vaultMode }: { records: PatientRecord[]; setScreen: (screen: Screen) => void; vaultMode: Vault["mode"] }) {
  const confirmed = records.filter((record) => record.status === "confirmed");
  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Header title="Good morning, Mira" subtitle="Your synthetic demo record is ready." />
      <View style={styles.privacyBanner}>
        <Text style={styles.privacyIcon}>◉</Text>
        <View style={styles.flex}>
          <Text style={styles.cardTitle}>{vaultMode === "sqlcipher" ? "Encrypted on this device" : "Web preview storage"}</Text>
          <Text style={styles.cardCopy}>{vaultMode === "sqlcipher" ? "SQLCipher vault opened and verified." : "Browser preview uses synthetic local storage. Native builds fail closed without SQLCipher."}</Text>
        </View>
      </View>
      <View style={styles.signalCard}>
        <Text style={styles.eyebrowLight}>WELLNESS CHECK</Text>
        <Text style={styles.signalTitle}>A calm moment for your pulse and breathing.</Text>
        <Text style={styles.signalCopy}>Camera frames are processed by SmartSpectra in the Android build and are not saved.</Text>
        <Button label="Open wellness" variant="secondary" onPress={() => setScreen("wellness")} />
      </View>
      <Text style={styles.groupTitle}>Your record</Text>
      <View style={styles.metricRow}>
        <View style={styles.metric}><Text style={styles.metricValue}>{confirmed.length}</Text><Text style={styles.metricLabel}>confirmed facts</Text></View>
        <View style={styles.metric}><Text style={styles.metricValue}>{confirmed.filter((item) => item.kind === "medicine").length}</Text><Text style={styles.metricLabel}>medicines</Text></View>
      </View>
      <View style={styles.quickGrid}>
        <Pressable onPress={() => setScreen("records")} style={({ pressed }) => [styles.quickCard, pressed && styles.pressed]}><Text style={styles.quickIcon}>＋</Text><Text style={styles.cardTitle}>Add record</Text></Pressable>
        <Pressable onPress={() => setScreen("ask")} style={({ pressed }) => [styles.quickCard, pressed && styles.pressed]}><Text style={styles.quickIcon}>✦</Text><Text style={styles.cardTitle}>Ask Zoe</Text></Pressable>
        <Pressable onPress={() => setScreen("share")} style={({ pressed }) => [styles.quickCard, pressed && styles.pressed]}><Text style={styles.quickIcon}>↗</Text><Text style={styles.cardTitle}>Share safely</Text></Pressable>
      </View>
    </ScrollView>
  );
}

function Records({ records, onSave }: { records: PatientRecord[]; onSave: (record: PatientRecord) => Promise<void> }) {
  const [showForm, setShowForm] = useState(false);
  const [kind, setKind] = useState<RecordKind>("note");
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [imageUri, setImageUri] = useState("");
  const [notice, setNotice] = useState("");
  const [reviewConfirmed, setReviewConfirmed] = useState(false);

  async function choosePrescription() {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.85, allowsEditing: false });
    if (!result.canceled && result.assets[0]) {
      setImageUri(result.assets[0].uri);
      setKind("medicine");
      setShowForm(true);
      setReviewConfirmed(false);
      setNotice("Image loaded for visual reference only. No OCR or Rx-area detection ran. Enter the fields manually and confirm that you checked them.");
    }
  }

  async function submit() {
    try {
      if (!reviewConfirmed) throw new Error("Confirm that you checked the entered fields before saving.");
      const draft = createDraftRecord({ kind, title, detail, recordedAt: new Date().toISOString(), source: "patient-reported" });
      await onSave(confirmRecord(draft));
      setTitle("");
      setDetail("");
      setImageUri("");
      setReviewConfirmed(false);
      setShowForm(false);
      setNotice("Saved as a confirmed patient-reviewed record.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not save record.");
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Header title="Health record" subtitle="Every fact shows its source. Draft text never becomes a record without your review." />
      <View style={styles.actionRow}>
        <Button label="Add manually" onPress={() => setShowForm((value) => !value)} />
        <Button label="Import Rx photo" variant="secondary" onPress={() => void choosePrescription()} />
      </View>
      {notice ? <View style={styles.notice}><Text style={styles.cardCopy}>{notice}</Text></View> : null}
      {imageUri ? (
        <View style={styles.rxPreview}>
          <ImageBackground source={{ uri: imageUri }} style={styles.rxImage} imageStyle={styles.rxImageCorners} />
          <Text style={styles.cardCopy}>Full image preview · no OCR or crop suggestion has run</Text>
        </View>
      ) : null}
      {showForm ? (
        <View style={styles.formCard}>
          <Text style={styles.sectionTitle}>{imageUri ? "Review prescription fields" : "New record"}</Text>
          <Text style={styles.label}>Type</Text>
          <View style={styles.chips}>{(["allergy", "condition", "medicine", "visit", "note"] as RecordKind[]).map((value) => <Pressable key={value} onPress={() => setKind(value)} style={[styles.chip, kind === value && styles.chipActive]}><Text style={[styles.chipText, kind === value && styles.chipTextActive]}>{value}</Text></Pressable>)}</View>
          <Field label="Name" value={title} onChangeText={setTitle} placeholder="For example: Metformin 500 mg" />
          <Field label="Details" value={detail} onChangeText={setDetail} placeholder="What you know, including schedule or reaction" multiline />
          <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: reviewConfirmed }} onPress={() => setReviewConfirmed((value) => !value)} style={[styles.selectRow, reviewConfirmed && styles.selectRowActive]}>
            <Text style={styles.checkbox}>{reviewConfirmed ? "✓" : ""}</Text><Text style={styles.cardCopy}>I checked these patient-entered fields against a reliable source.</Text>
          </Pressable>
          <Button label="Confirm patient-entered record" onPress={() => void submit()} />
        </View>
      ) : null}
      <Text style={styles.groupTitle}>Confirmed</Text>
      {records.map((record) => (
        <View key={record.id} style={styles.recordCard}>
          <View style={styles.recordTop}><Text style={styles.kind}>{record.kind}</Text><Text style={styles.source}>{record.source}</Text></View>
          <Text style={styles.cardTitle}>{record.title}</Text>
          <Text style={styles.cardCopy}>{record.detail}</Text>
          <Text style={styles.date}>{new Date(record.recordedAt).toLocaleDateString()} · patient</Text>
        </View>
      ))}
    </ScrollView>
  );
}

interface ChatMessage { id: string; role: "patient" | "zoe"; text: string; sources?: string[]; }

function Ask({ records }: { records: PatientRecord[] }) {
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([{ id: "welcome", role: "zoe", text: "Ask about a confirmed record, a medicine name, or a meal. I will show what I used and what is missing." }]);
  const [busy, setBusy] = useState(false);
  const capabilities = getNativeCapabilities();

  function send() {
    const question = draft.trim();
    if (!question || busy) return;
    setDraft("");
    setBusy(true);
    const patientMessage: ChatMessage = { id: `q-${Date.now()}`, role: "patient", text: question };
    setMessages((current) => [...current, patientMessage]);
    setTimeout(() => {
      const foods = matchFood(question);
      let response: ChatMessage;
      if (foods.length > 0) {
        const grams = parseExplicitGrams(question);
        if (foods.length !== 1 || grams === null) {
          response = { id: `a-${Date.now()}`, role: "zoe", text: `I matched ${foods.map((food) => food.name).join(" and ")}, but I will not assume a portion. Give one food with an explicit weight, such as “175 g rice”.`, sources: foods.map((food) => food.source) };
        } else {
          const food = foods[0]!;
          const total = calculateNutrition([{ foodId: food.id, grams }]);
          response = { id: `a-${Date.now()}`, role: "zoe", text: `For the stated ${grams} g of ${food.name}, the demo catalog calculates about ${total.kcal} kcal, ${total.proteinG} g protein, and ${total.fiberG} g fiber. This is a synthetic catalog calculation, not a therapeutic diet.`, sources: total.citations.map((citation) => `${citation.source} · stated ${citation.grams} g`) };
        }
      } else {
        const answer = answerFromRecords(question, records);
        response = { id: `a-${Date.now()}`, role: "zoe", text: [answer.text, ...answer.gaps].join("\n\n"), sources: answer.citations.map((citation) => citation.label) };
      }
      setMessages((current) => [...current, response]);
      setBusy(false);
    }, 280);
  }

  return (
    <View style={styles.chatPage}>
      <View style={styles.chatHeader}><Header title="Ask Zoe" subtitle="Answers are assembled locally from confirmed sources." /></View>
      <ScrollView contentContainerStyle={styles.messages}>
        {messages.map((message) => (
          <View key={message.id} style={[styles.bubble, message.role === "patient" ? styles.patientBubble : styles.zoeBubble]}>
            <Text style={[styles.bubbleText, message.role === "patient" && styles.patientBubbleText]}>{message.text}</Text>
            {message.sources?.map((source) => <Text key={source} style={styles.citation}>↳ {source}</Text>)}
          </View>
        ))}
        {busy ? <View style={styles.thinking}><ActivityIndicator color={colors.moss} /><Text style={styles.cardCopy}>Checking local sources…</Text></View> : null}
      </ScrollView>
      <View style={styles.composer}>
        <Pressable accessibilityRole="button" accessibilityLabel="Dictate question" onPress={() => setDraft(capabilities.onDeviceSpeech.reason ?? "Offline speech is unavailable.")} style={styles.iconButton}><Text style={styles.iconButtonText}>●</Text></Pressable>
        <TextInput accessibilityLabel="Question" value={draft} onChangeText={setDraft} placeholder="Ask about your record or meal" placeholderTextColor="#7E8D87" multiline style={styles.composerInput} />
        <Pressable accessibilityRole="button" accessibilityLabel="Send question" onPress={send} style={styles.sendButton}><Text style={styles.sendText}>↑</Text></Pressable>
      </View>
    </View>
  );
}

function Wellness() {
  const capability = getNativeCapabilities().smartSpectra;
  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Header title="Live wellness" subtitle="Pulse and breathing are wellness signals, not a diagnosis." />
      <View style={styles.consentCard}>
        <Text style={styles.pulseGlyph}>◌</Text>
        <Text style={styles.sectionTitle}>Camera consent comes first</Text>
        <Text style={styles.cardCopy}>The Android module requests pulse and breathing rate only. Frames are processed in memory and are not stored by Zoe.</Text>
        <View style={styles.unavailable}><Text style={styles.error}>{capability.reason}</Text></View>
        <Button label="Start on supported Android build" disabled={!capability.available} onPress={() => {}} />
      </View>
      <View style={styles.notice}><Text style={styles.cardTitle}>No simulated vital signs</Text><Text style={styles.cardCopy}>This screen stays unavailable until the real SmartSpectra SDK initializes. Zoe will not show random values as a successful capture.</Text></View>
    </ScrollView>
  );
}

function Share({ records, cloudSession }: { records: PatientRecord[]; cloudSession: CloudSession | null }) {
  const [selected, setSelected] = useState<string[]>(records.map((record) => record.id));
  const [recipient, setRecipient] = useState("synthetic-clinician");
  const [shareUrl, setShareUrl] = useState("");
  const [error, setError] = useState("");
  const [grants, setGrants] = useState<CloudGrant[]>([]);
  const [resolvedRecipient, setResolvedRecipient] = useState<ResolvedRecipient | null>(null);
  const [shareConfirmed, setShareConfirmed] = useState(false);

  async function refreshGrants() {
    if (!cloudSession) { setGrants([]); return; }
    try { setGrants(await listShareGrants(cloudSession)); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not load share grants."); }
  }

  useEffect(() => { void refreshGrants(); }, [cloudSession]);

  async function createEncryptedLink() {
    try {
      setError("");
      if (!cloudSession) throw new Error("Encrypted cloud sharing requires a Supabase-authenticated patient session. Synthetic preview accounts cannot upload.");
      if (!resolvedRecipient || resolvedRecipient.userId !== recipient.trim()) throw new Error("Resolve the clinician account before sharing.");
      if (!shareConfirmed) throw new Error("Confirm the recipient and selected records before sharing.");
      const selectedRecords = records.filter((record) => selected.includes(record.id));
      setShareUrl(await uploadEncryptedShare(cloudSession, recipient.trim(), selectedRecords));
      await refreshGrants();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create share.");
    }
  }

  async function resolveRecipient() {
    try {
      setError("");
      setShareConfirmed(false);
      if (!cloudSession) throw new Error("Sign in with Supabase before resolving a recipient.");
      setResolvedRecipient(await resolveShareRecipient(cloudSession, recipient.trim()));
    } catch (caught) {
      setResolvedRecipient(null);
      setError(caught instanceof Error ? caught.message : "Could not resolve recipient.");
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Header title="Share selected records" subtitle="Zoe encrypts the bundle before it leaves this device. A downloaded copy cannot be revoked." />
      <View style={styles.formCard}>
        <Field label="Recipient Supabase user ID" value={recipient} onChangeText={(value) => { setRecipient(value); setResolvedRecipient(null); setShareConfirmed(false); setShareUrl(""); }} placeholder="Authenticated clinician UUID" />
        <Button label="Resolve clinician account" variant="secondary" disabled={!cloudSession} onPress={() => void resolveRecipient()} />
        {resolvedRecipient ? <View style={styles.notice}><Text style={styles.cardTitle}>{resolvedRecipient.displayName}</Text><Text style={styles.cardCopy}>{resolvedRecipient.organization}</Text><Text style={styles.source}>Self-declared accepting profile · {resolvedRecipient.userId}</Text></View> : null}
        <Text style={styles.label}>Choose records</Text>
        {records.map((record) => {
          const active = selected.includes(record.id);
          return <Pressable key={record.id} onPress={() => { setShareConfirmed(false); setShareUrl(""); setSelected((current) => active ? current.filter((id) => id !== record.id) : [...current, record.id]); }} style={[styles.selectRow, active && styles.selectRowActive]}><Text style={styles.checkbox}>{active ? "✓" : ""}</Text><View style={styles.flex}><Text style={styles.cardTitle}>{record.title}</Text><Text style={styles.source}>{record.source}</Text></View></Pressable>;
        })}
        {resolvedRecipient ? <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: shareConfirmed }} onPress={() => setShareConfirmed((value) => !value)} style={[styles.selectRow, shareConfirmed && styles.selectRowActive]}><Text style={styles.checkbox}>{shareConfirmed ? "✓" : ""}</Text><Text style={styles.cardCopy}>Share {selected.length} selected record{selected.length === 1 ? "" : "s"} with {resolvedRecipient.displayName} at {resolvedRecipient.organization}.</Text></Pressable> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {!cloudSession ? <Text style={styles.error}>Synthetic preview session: upload and share creation are disabled.</Text> : null}
        <Button label="Encrypt and upload selected records" disabled={!cloudSession || !resolvedRecipient || !shareConfirmed || selected.length === 0} onPress={() => void createEncryptedLink()} />
      </View>
      {shareUrl ? <View style={styles.successCard}><Text style={styles.eyebrowLight}>ENCRYPTED LINK READY</Text><Text selectable style={styles.shareLink}>{shareUrl}</Text><Text style={styles.signalCopy}>Ciphertext is in private Supabase Storage. The fragment key after # is not sent in the HTTP request.</Text></View> : null}
      {cloudSession ? <>
        <Text style={styles.groupTitle}>Share access</Text>
        {grants.length === 0 ? <Text style={styles.supporting}>No share grants yet.</Text> : grants.map((grant) => <View key={grant.id} style={styles.recordCard}>
          <Text style={styles.cardTitle}>Recipient · {grant.recipientId}</Text>
          <Text style={styles.cardCopy}>{grant.revokedAt ? `Revoked ${new Date(grant.revokedAt).toLocaleString()}` : `Expires ${new Date(grant.expiresAt).toLocaleString()}`}</Text>
          <Button label={grant.revokedAt ? "Revoked" : "Revoke future downloads"} variant="ghost" disabled={Boolean(grant.revokedAt)} onPress={() => void revokeShareGrant(cloudSession, grant.id).then(refreshGrants).catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Revocation failed."))} />
        </View>)}
      </> : null}
    </ScrollView>
  );
}

function Navigation({ screen, setScreen }: { screen: Screen; setScreen: (screen: Screen) => void }) {
  const items: Array<{ screen: Screen; label: string; icon: string }> = [
    { screen: "home", label: "Home", icon: "⌂" },
    { screen: "records", label: "Records", icon: "▤" },
    { screen: "ask", label: "Ask", icon: "✦" },
    { screen: "wellness", label: "Wellness", icon: "◌" },
    { screen: "share", label: "Share", icon: "↗" }
  ];
  return <View style={styles.nav}>{items.map((item) => <Pressable key={item.screen} onPress={() => setScreen(item.screen)} accessibilityRole="tab" accessibilityState={{ selected: item.screen === screen }} style={styles.navItem}><Text style={[styles.navIcon, item.screen === screen && styles.navActive]}>{item.icon}</Text><Text style={[styles.navLabel, item.screen === screen && styles.navActive]}>{item.label}</Text></Pressable>)}</View>;
}

export default function App() {
  const [access, setAccess] = useState<AccessState>("intro");
  const [screen, setScreen] = useState<Screen>("home");
  const [records, setRecords] = useState<PatientRecord[]>([]);
  const [vault, setVault] = useState<Vault | null>(null);
  const [userId, setUserId] = useState("");
  const [cloudSession, setCloudSession] = useState<CloudSession | null>(null);
  const [error, setError] = useState("");
  const [pendingAccess, setPendingAccess] = useState<{ accountId: string; session: CloudSession | null; setup: boolean } | null>(null);
  const [migrationRecoveryRequired, setMigrationRecoveryRequired] = useState(false);

  async function unlock(accountId: string, session: CloudSession | null = null, options: VaultOpenOptions = {}) {
    setAccess("unlocking");
    setError("");
    try {
      const opened = await openVault(accountId, options);
      const saved = await opened.loadRecords();
      const initial = recordsForOpenedVault(saved, session === null, opened.isNew, SYNTHETIC_RECORDS);
      if (opened.isNew && initial.length > 0) await opened.saveRecords(initial);
      setVault(opened);
      setPendingAccess(null);
      setUserId(accountId);
      setCloudSession(session);
      setRecords(initial);
      setAccess("ready");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "The vault could not open.";
      setError(message);
      if (caught instanceof VaultAccessError && (caught.reason === "setup_required" || caught.reason === "passphrase_required" || caught.reason === "invalid_passphrase")) {
        setPendingAccess({ accountId, session, setup: caught.reason === "setup_required" || options.setupPassphrase === true });
        setAccess("passphrase");
      } else {
        setAccess("login");
      }
    }
  }

  async function signOut() {
    await lockThenClear(vault ? () => vault.lock() : undefined, () => {
      setVault(null);
      setRecords([]);
      setUserId("");
      setCloudSession(null);
      setPendingAccess(null);
      setMigrationRecoveryRequired(false);
      setError("");
      setScreen("home");
      setAccess("login");
    });
  }

  async function migrateVault(passphrase: string) {
    if (migrationRecoveryRequired) {
      setAccess("unlocking");
      setError("");
      try {
        const reopened = await openVault(userId, { passphrase });
        const saved = await reopened.loadRecords();
        setVault(reopened);
        setRecords(saved);
        setMigrationRecoveryRequired(false);
        setAccess("ready");
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Vault migration recovery failed without changing the encrypted vault.");
        setAccess("migration");
      }
      return;
    }
    if (!vault?.migrateToPassphrase) { setError("This vault cannot be migrated in its current state."); return; }
    setAccess("unlocking");
    setError("");
    try {
      const migrated = await vault.migrateToPassphrase(passphrase);
      setVault(migrated);
      setMigrationRecoveryRequired(false);
      setAccess("ready");
    } catch (caught) {
      const recoveryRequired = migrationRequiresCompletion(caught);
      setError(caught instanceof Error ? caught.message : "Vault migration failed without replacing the existing key.");
      setMigrationRecoveryRequired(recoveryRequired);
      if (recoveryRequired) {
        setVault(null);
        setRecords([]);
      }
      setAccess("migration");
    }
  }

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState !== "active") void signOut();
    });
    return () => subscription.remove();
  }, [access, vault]);

  async function saveRecord(record: PatientRecord) {
    if (!vault) throw new Error("Vault is locked.");
    const next = [record, ...records];
    await vault.saveRecords(next);
    setRecords(next);
  }

  const body = useMemo(() => {
    if (screen === "records") return <Records records={records} onSave={saveRecord} />;
    if (screen === "ask") return <Ask records={records} />;
    if (screen === "wellness") return <Wellness />;
    if (screen === "share") return <Share records={records} cloudSession={cloudSession} />;
    return <Home records={records} setScreen={setScreen} vaultMode={vault?.mode ?? "web-preview"} />;
  }, [cloudSession, records, screen, vault]);

  if (access === "intro") return <><StatusBar style="dark" /><Intro onDone={() => setAccess("login")} /></>;
  if (access === "login") return <><StatusBar style="dark" /><Login onPreview={(accountId) => void unlock(accountId)} onCloud={(session) => void unlock(session.userId, session)} error={error} /></>;
  if (access === "passphrase" && pendingAccess) return <><StatusBar style="dark" /><PassphraseAccess accountId={pendingAccess.accountId} setup={pendingAccess.setup} error={error} onSubmit={(passphrase) => void unlock(pendingAccess.accountId, pendingAccess.session, { passphrase, setupPassphrase: pendingAccess.setup })} onCancel={() => { setPendingAccess(null); setError(""); setAccess("login"); }} /></>;
  if (access === "migration") return <><StatusBar style="dark" /><PassphraseAccess accountId={userId} setup={!migrationRecoveryRequired} error={error} onSubmit={(passphrase) => void migrateVault(passphrase)} cancelLabel={migrationRecoveryRequired ? "Lock vault" : "Back"} onCancel={() => {
    if (migrationBackAction(migrationRecoveryRequired) === "sign-out") { void signOut(); return; }
    setError("");
    setAccess("ready");
  }} /></>;
  if (access === "unlocking") return <View style={styles.loading}><ActivityIndicator size="large" color={colors.moss} /><Text style={styles.cardCopy}>Opening private vault…</Text></View>;
  return (
    <SafeAreaView style={styles.shell}>
      <StatusBar style="dark" />
      <View style={styles.sessionBar}><Text style={styles.source}>{cloudSession ? "Supabase authenticated" : "Synthetic preview"} · {userId}</Text><View style={styles.sessionActions}>{vault?.protection === "biometric" ? <Pressable accessibilityRole="button" onPress={() => { setError(""); setMigrationRecoveryRequired(false); setAccess("migration"); }}><Text style={styles.lockText}>Use passphrase</Text></Pressable> : null}<Pressable accessibilityRole="button" onPress={() => void signOut()}><Text style={styles.lockText}>Lock vault</Text></Pressable></View></View>
      <View style={styles.content}>{body}</View>
      <Navigation screen={screen} setScreen={setScreen} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: colors.cream }, content: { flex: 1 }, flex: { flex: 1 },
  intro: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.cream, padding: 32 },
  introMark: { width: 180, height: 180 }, introWord: { fontFamily: Platform.select({ web: "Georgia", default: "serif" }), fontSize: 52, color: colors.ink, letterSpacing: -2, marginTop: -20 }, introTagline: { color: colors.muted, fontSize: 16, marginTop: 8 },
  accessPage: { flex: 1, backgroundColor: colors.cream, alignItems: "center", justifyContent: "center", padding: 22 }, accessArt: { width: "100%", maxWidth: 520, alignItems: "flex-start", padding: 24 }, loginMark: { width: 110, height: 110, alignSelf: "center", marginBottom: 12 },
  eyebrow: { color: colors.orange, fontWeight: "800", letterSpacing: 2, fontSize: 11 }, eyebrowLight: { color: "#F7CBB8", fontWeight: "800", letterSpacing: 2, fontSize: 11 }, heroTitle: { color: colors.ink, fontSize: 40, lineHeight: 43, fontFamily: Platform.select({ web: "Georgia", default: "serif" }), marginTop: 10 }, heroCopy: { color: colors.muted, fontSize: 17, lineHeight: 25, marginTop: 12 },
  loginCard: { width: "100%", maxWidth: 520, backgroundColor: colors.paper, borderRadius: 28, padding: 24, gap: 15, borderWidth: 1, borderColor: colors.line, shadowColor: "#172923", shadowOpacity: 0.08, shadowRadius: 25, shadowOffset: { width: 0, height: 10 } }, sectionTitle: { fontSize: 24, lineHeight: 29, fontWeight: "700", color: colors.ink }, supporting: { color: colors.muted, fontSize: 15, lineHeight: 21 }, finePrint: { color: colors.muted, fontSize: 12, lineHeight: 17, textAlign: "center" }, noticeText: { color: "#6C5147", backgroundColor: "#FFF4E9", padding: 12, borderRadius: 12, fontSize: 13, lineHeight: 18 }, error: { color: colors.danger, fontSize: 14, lineHeight: 20 },
  button: { minHeight: 50, paddingHorizontal: 18, paddingVertical: 14, borderRadius: 16, alignItems: "center", justifyContent: "center", flexGrow: 1 }, button_primary: { backgroundColor: colors.moss }, button_secondary: { backgroundColor: colors.mint }, button_ghost: { backgroundColor: "transparent", borderColor: colors.line, borderWidth: 1 }, buttonText: { color: "white", fontWeight: "700", fontSize: 15 }, buttonTextDark: { color: colors.ink }, pressed: { opacity: 0.72, transform: [{ scale: 0.99 }] }, disabled: { opacity: 0.45 },
  page: { padding: 20, paddingBottom: 36, width: "100%", maxWidth: 760, alignSelf: "center", gap: 14 }, header: { gap: 6, marginBottom: 5 }, headerBrand: { flexDirection: "row", alignItems: "center", gap: 7, marginBottom: 12 }, headerMark: { width: 28, height: 28 }, headerWord: { color: colors.ink, fontSize: 20, fontFamily: Platform.select({ web: "Georgia", default: "serif" }) }, screenTitle: { color: colors.ink, fontSize: 32, lineHeight: 37, fontFamily: Platform.select({ web: "Georgia", default: "serif" }) },
  privacyBanner: { backgroundColor: colors.mint, borderRadius: 20, padding: 16, flexDirection: "row", gap: 13 }, privacyIcon: { color: colors.moss, fontSize: 24 }, cardTitle: { color: colors.ink, fontSize: 16, lineHeight: 21, fontWeight: "700" }, cardCopy: { color: colors.muted, fontSize: 14, lineHeight: 20, marginTop: 3 },
  signalCard: { backgroundColor: colors.ink, borderRadius: 27, padding: 22, gap: 10 }, signalTitle: { color: "white", fontSize: 25, lineHeight: 30, fontFamily: Platform.select({ web: "Georgia", default: "serif" }) }, signalCopy: { color: "#D7E5DF", fontSize: 14, lineHeight: 20 }, groupTitle: { color: colors.ink, fontSize: 20, fontWeight: "700", marginTop: 10 },
  metricRow: { flexDirection: "row", gap: 12 }, metric: { flex: 1, backgroundColor: colors.paper, padding: 18, borderRadius: 20, borderColor: colors.line, borderWidth: 1 }, metricValue: { color: colors.orange, fontSize: 30, fontWeight: "800" }, metricLabel: { color: colors.muted, fontSize: 13 }, quickGrid: { flexDirection: "row", flexWrap: "wrap", gap: 11 }, quickCard: { flexGrow: 1, minWidth: 130, backgroundColor: colors.paper, borderRadius: 20, padding: 18, borderColor: colors.line, borderWidth: 1, gap: 8 }, quickIcon: { color: colors.orange, fontSize: 24 },
  actionRow: { flexDirection: "row", gap: 10, flexWrap: "wrap" }, notice: { padding: 15, borderRadius: 16, backgroundColor: "#FFF4E9", borderColor: "#F0D5BA", borderWidth: 1 }, formCard: { backgroundColor: colors.paper, padding: 19, borderRadius: 23, borderColor: colors.line, borderWidth: 1, gap: 14 }, fieldWrap: { gap: 6 }, label: { color: colors.ink, fontSize: 13, fontWeight: "700" }, input: { minHeight: 50, backgroundColor: "#F7F7F2", borderColor: colors.line, borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, color: colors.ink, fontSize: 15 }, multiline: { minHeight: 100, textAlignVertical: "top" }, chips: { flexDirection: "row", flexWrap: "wrap", gap: 7 }, chip: { borderRadius: 99, borderColor: colors.line, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8 }, chipActive: { backgroundColor: colors.ink, borderColor: colors.ink }, chipText: { color: colors.muted, textTransform: "capitalize", fontSize: 13 }, chipTextActive: { color: "white" },
  recordCard: { backgroundColor: colors.paper, padding: 17, borderRadius: 19, borderColor: colors.line, borderWidth: 1, gap: 5 }, recordTop: { flexDirection: "row", justifyContent: "space-between", gap: 10 }, kind: { color: colors.orange, fontWeight: "800", textTransform: "uppercase", fontSize: 11, letterSpacing: 1 }, source: { color: colors.muted, fontSize: 12 }, date: { color: colors.muted, fontSize: 12, marginTop: 5 },
  rxPreview: { backgroundColor: colors.paper, borderRadius: 22, padding: 10, borderColor: colors.line, borderWidth: 1 }, rxImage: { height: 260, justifyContent: "center", alignItems: "center" }, rxImageCorners: { borderRadius: 15 },
  chatPage: { flex: 1, width: "100%", maxWidth: 760, alignSelf: "center" }, chatHeader: { paddingHorizontal: 20, paddingTop: 20 }, messages: { padding: 20, paddingTop: 5, gap: 12 }, bubble: { maxWidth: "88%", padding: 15, borderRadius: 19, gap: 8 }, zoeBubble: { alignSelf: "flex-start", backgroundColor: colors.paper, borderColor: colors.line, borderWidth: 1, borderTopLeftRadius: 6 }, patientBubble: { alignSelf: "flex-end", backgroundColor: colors.moss, borderTopRightRadius: 6 }, bubbleText: { color: colors.ink, fontSize: 15, lineHeight: 21 }, patientBubbleText: { color: "white" }, citation: { color: colors.muted, fontSize: 12, lineHeight: 16, borderTopColor: colors.line, borderTopWidth: 1, paddingTop: 6 }, thinking: { flexDirection: "row", alignSelf: "flex-start", gap: 10, alignItems: "center", padding: 12 },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: 8, padding: 12, backgroundColor: colors.paper, borderTopColor: colors.line, borderTopWidth: 1 }, composerInput: { flex: 1, maxHeight: 110, minHeight: 48, backgroundColor: colors.cream, borderRadius: 16, padding: 12, color: colors.ink, fontSize: 15 }, iconButton: { width: 48, height: 48, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: colors.mint }, iconButtonText: { color: colors.moss, fontSize: 18 }, sendButton: { width: 48, height: 48, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: colors.orange }, sendText: { color: "white", fontSize: 25, fontWeight: "800" },
  consentCard: { backgroundColor: colors.paper, padding: 24, borderRadius: 27, borderColor: colors.line, borderWidth: 1, alignItems: "center", gap: 13 }, pulseGlyph: { color: colors.orange, fontSize: 80 }, unavailable: { backgroundColor: "#F9ECE9", borderRadius: 13, padding: 12, width: "100%" },
  selectRow: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderColor: colors.line, borderRadius: 15, padding: 12 }, selectRowActive: { backgroundColor: colors.mint, borderColor: "#9CB9A9" }, checkbox: { width: 24, height: 24, borderRadius: 7, borderWidth: 2, borderColor: colors.moss, color: colors.moss, textAlign: "center", lineHeight: 20, fontWeight: "800" }, successCard: { backgroundColor: colors.ink, padding: 20, borderRadius: 22, gap: 10 }, shareLink: { color: "white", fontSize: 12, lineHeight: 17 },
  sessionBar: { minHeight: 34, paddingHorizontal: 18, flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: colors.mint, borderBottomColor: colors.line, borderBottomWidth: 1 }, lockText: { color: colors.moss, fontWeight: "800", fontSize: 12 },
  sessionActions: { flexDirection: "row", alignItems: "center", gap: 16 },
  nav: { flexDirection: "row", backgroundColor: colors.paper, borderTopColor: colors.line, borderTopWidth: 1, minHeight: 68, paddingBottom: Platform.OS === "ios" ? 10 : 3, justifyContent: "space-around" }, navItem: { alignItems: "center", justifyContent: "center", minWidth: 66, minHeight: 58, gap: 2 }, navIcon: { color: colors.muted, fontSize: 20 }, navLabel: { color: colors.muted, fontSize: 11, fontWeight: "600" }, navActive: { color: colors.orange }, loading: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.cream, gap: 14 }
});
