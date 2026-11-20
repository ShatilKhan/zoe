import { type ComponentProps, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  AppState,
  Image,
  KeyboardAvoidingView,
  PermissionsAndroid,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View
} from "react-native";
import { StatusBar } from "expo-status-bar";
import * as ImagePicker from "expo-image-picker";
import { Feather } from "@react-native-vector-icons/feather";
import { calculateNutrition, matchFood, parseExplicitGrams } from "@zoe/nutrition";
import { SYNTHETIC_RECORDS, answerFromRecords, confirmRecord, createDraftRecord, manualRecordKind, type PatientRecord, type RecordKind } from "@zoe/records";
import PresageSensor, { type PresageSensorState } from "@zoe/presage-sensor";
let useOpticalCharacterRecognizer: any = () => ({ isReady: false, error: new Error("OCR not available on this platform"), downloadProgress: 0, resource: undefined, recognizeCharacters: undefined, recognizeCharactersWorklet: undefined });
let ocrModels: any = null;
if (Platform.OS === "android") {
  try {
    const execuTorch = require("react-native-executorch");
    useOpticalCharacterRecognizer = execuTorch.useOpticalCharacterRecognizer;
    ocrModels = execuTorch.models;
  } catch {
    // OCR not available
  }
}
import { cloudAuthAvailable, requestEmailOtp, verifyEmailOtp, type CloudSession } from "./src/platform/auth";
import { openVault, VaultAccessError, type Vault, type VaultOpenOptions } from "./src/platform/vault";
import { UnlockRateLimiter, validateNewPassphrase } from "./src/platform/vaultPolicy";
import { recordsForOpenedVault } from "./src/platform/recordBootstrap";
import { lockThenClear, migrationBackAction, migrationRequiresCompletion } from "./src/platform/appLifecycle";
import { useOfflineSpeechComposer } from "./src/platform/useOfflineSpeechComposer";
import { homePresentation, maskAccountEmail } from "./src/platform/patientPresentation";

type Screen = "home" | "records" | "ask" | "wellness";
type AccessState = "intro" | "login" | "passphrase" | "migration" | "unlocking" | "ready";

const prescriptionPhotos = Platform.OS === "android" ? require("expo").requireOptionalNativeModule("PrescriptionMask") : null;
const brandMark = require("../../assets/brand/zoe-mark-transparent.png");
const colors = {
  ink: "#203A31",
  muted: "#50645A",
  cream: "#F6F6F0",
  paper: "#FFFFFF",
  mint: "#E9F1D9",
  accent: "#DCEBB0",
  moss: "#2F5D4F",
  line: "#CAD5CC",
  danger: "#9E3D35",
  urgent: "#FAE9E7"
};

type IconName = ComponentProps<typeof Feather>["name"];

function AppIcon({ name, size = 20, color = colors.muted }: { name: IconName; size?: number; color?: string }) {
  return <Feather name={name} size={size} color={color} />;
}

function CheckMark({ checked }: { checked: boolean }) {
  return <View style={[styles.checkbox, checked && styles.checkboxActive]}>{checked ? <AppIcon name="check" size={17} color={colors.ink} /> : null}</View>;
}

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
        placeholderTextColor={colors.muted}
        multiline={multiline}
        secureTextEntry={secureTextEntry}
        style={[styles.input, multiline && styles.multiline]}
      />
    </View>
  );
}

function PassphraseAccess({ accountId, accountHint, setup, error, onSubmit, onCancel, cancelLabel = "Back" }: { accountId: string; accountHint?: string | undefined; setup: boolean; error: string; onSubmit: (passphrase: string) => void; onCancel: () => void; cancelLabel?: string }) {
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

  return <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.accessPage}><View style={styles.loginCard}>
    <Text style={styles.contextLabel}>{setup ? "New device-bound vault" : "Private vault"}</Text>
    <Text style={styles.sectionTitle}>{setup ? "Create a strong passphrase" : "Enter your vault passphrase"}</Text>
    <Text style={styles.supporting}>{setup ? "Zoe combines this passphrase with a random account-specific secret held by Android Keystore. The passphrase alone cannot open a copied database." : accountHint ? `Unlock the private vault for ${accountHint}. The passphrase is processed only on this device.` : "Unlock your private vault. The passphrase is processed only on this device."}</Text>
    <Field label="Vault passphrase" value={passphrase} onChangeText={setPassphrase} secureTextEntry placeholder={setup ? "16+ varied characters or 4 unrelated words" : "Your vault passphrase"} />
    {setup ? <Field label="Confirm vault passphrase" value={confirmation} onChangeText={setConfirmation} secureTextEntry placeholder="Enter it again" /> : null}
    <View style={styles.notice}><Text style={styles.cardTitle}>No recovery</Text><Text style={styles.cardCopy}>Zoe never uploads this passphrase or vault key. Uninstalling the app, clearing its storage, losing the Keystore secret, or forgetting the passphrase makes this local vault unrecoverable.</Text></View>
    {localError || error ? <Text style={styles.error}>{localError || error}</Text> : null}
    <Button label={setup ? "Create encrypted vault" : "Unlock encrypted vault"} onPress={submit} disabled={!passphrase || (setup && !confirmation)} />
    <Button label={cancelLabel} variant="ghost" onPress={onCancel} />
  </View></KeyboardAvoidingView>;
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

function Login({ onPreview, onCloud, error }: { onPreview: () => void; onCloud: (session: CloudSession) => void; error: string }) {
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
        <Text style={styles.contextLabel}>Private by design</Text>
        <Text style={styles.heroTitle}>Your history stays close.</Text>
        <Text style={styles.heroCopy}>Keep reviewed records in an encrypted vault on this device.</Text>
      </View>
      <View style={styles.loginCard}>
        <Text style={styles.sectionTitle}>Enter Zoe</Text>
        {cloudAuthAvailable ? <>
          <Text style={styles.supporting}>Use an email one-time code. Each signed-in account opens its own local encrypted vault.</Text>
          <Field label="Email" value={email} onChangeText={setEmail} placeholder="you@example.com" />
          {otpSent ? <Field label="One-time code" value={otp} onChangeText={setOtp} placeholder="123456" /> : null}
          <Button label={otpSent ? "Verify code and unlock" : "Send one-time code"} onPress={() => void handleCloudAuth()} />
          {authMessage ? <Text style={styles.supporting}>{authMessage}</Text> : null}
          <Text style={styles.finePrint}>Or use the isolated synthetic preview below.</Text>
        </> : <Text style={styles.noticeText}>Cloud auth is unavailable until the Supabase publishable key is injected. No service-role key belongs in this app.</Text>}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Button label="Unlock synthetic preview" variant="secondary" onPress={onPreview} />
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

function Home({ records, setScreen, vaultMode, syntheticPreview }: { records: PatientRecord[]; setScreen: (screen: Screen) => void; vaultMode: Vault["mode"]; syntheticPreview: boolean }) {
  const confirmed = records.filter((record) => record.status === "confirmed");
  const presentation = homePresentation(syntheticPreview, confirmed.length);
  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Header title={presentation.title} subtitle={presentation.subtitle} />
      <View style={styles.privacyBanner}>
        <View style={styles.bannerIcon}><AppIcon name="shield" size={21} color={colors.ink} /></View>
        <View style={styles.flex}>
          <Text style={styles.cardTitle}>{vaultMode === "sqlcipher" ? "Encrypted on this device" : "Web preview storage"}</Text>
          <Text style={styles.cardCopy}>{vaultMode === "sqlcipher" ? "SQLCipher vault opened and verified." : "Browser preview uses synthetic local storage. Native builds fail closed without SQLCipher."}</Text>
        </View>
      </View>
      <View style={styles.signalCard}>
        <View style={styles.signalHeading}><AppIcon name="activity" size={21} color={colors.accent} /><Text style={styles.signalTitle}>Check pulse and breathing</Text></View>
        <Text style={styles.signalCopy}>Use the front camera for a private wellness check. Processed in memory. Zoe does not save camera frames.</Text>
        <Button label="Start a wellness check" variant="secondary" onPress={() => setScreen("wellness")} />
      </View>
      <Text style={styles.groupTitle}>Your record</Text>
      <View style={styles.metricRow}>
        <View style={styles.metric}><Text style={styles.metricValue}>{confirmed.length}</Text><Text style={styles.metricLabel}>confirmed facts</Text></View>
        <View style={styles.metric}><Text style={styles.metricValue}>{confirmed.filter((item) => item.kind === "medicine").length}</Text><Text style={styles.metricLabel}>medicines</Text></View>
      </View>
      <View style={styles.quickGrid}>
        <Pressable accessibilityRole="button" onPress={() => setScreen("records")} style={({ pressed }) => [styles.quickCard, pressed && styles.pressed]}><AppIcon name="plus" size={22} color={colors.moss} /><Text style={styles.cardTitle}>Add record</Text></Pressable>
        <Pressable accessibilityRole="button" onPress={() => setScreen("ask")} style={({ pressed }) => [styles.quickCard, pressed && styles.pressed]}><AppIcon name="message-circle" size={22} color={colors.moss} /><Text style={styles.cardTitle}>Ask Zoe</Text></Pressable>
      </View>
    </ScrollView>
  );
}

function Records({ records, onSave }: { records: PatientRecord[]; onSave: (record: PatientRecord) => Promise<void> }) {
  const ocr = useOpticalCharacterRecognizer(ocrModels ? ocrModels.ocr.PADDLE.PPOCRV6_SMALL.XNNPACK : undefined);
  const [showForm, setShowForm] = useState(false);
  const [kind, setKind] = useState<RecordKind>("note");
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [imageUri, setImageUri] = useState("");
  const [notice, setNotice] = useState("");
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const [ocrStatus, setOcrStatus] = useState<"idle" | "running" | "done" | "failed">("idle");
  const [ocrLines, setOcrLines] = useState<{ text: string; confidence: number }[]>([]);
  const [ocrError, setOcrError] = useState("");
  const [ocrRegion, setOcrRegion] = useState<{ left: number; top: number; right: number; bottom: number } | null>(null);

  async function choosePrescription() {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.85, allowsEditing: false });
    if (!result.canceled && result.assets[0]) {
      setImageUri(result.assets[0].uri);
      setKind(manualRecordKind(true));
      setShowForm(true);
      setReviewConfirmed(false);
      setOcrStatus("idle");
      setOcrLines([]);
      setOcrError("");
      setOcrRegion(null);
      setNotice("Image loaded. OCR runs locally on this device; review every field before saving. No OCR text enters the record automatically.");
    }
  }

  async function runOcr() {
    if (!ocr.isReady || !imageUri) return;
    setOcrStatus("running");
    setOcrLines([]);
    setOcrError("");
    setOcrRegion(null);
    try {
      let imageBuffer: { data: Uint8Array; width: number; height: number };
      if (Platform.OS === "android" && prescriptionPhotos) {
        const decoded = await prescriptionPhotos.decodeImageToRgb(imageUri);
        imageBuffer = { data: new Uint8Array(decoded.data), width: decoded.width, height: decoded.height };
      } else {
        const img = document.createElement("img");
        img.crossOrigin = "anonymous";
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("Image load failed"));
        img.src = imageUri;
      });
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas context unavailable");
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const rgb = new Uint8Array(canvas.width * canvas.height * 3);
      for (let i = 0; i < imageData.data.length; i += 4) {
        rgb[i / 4 * 3] = imageData.data[i]!;
        rgb[i / 4 * 3 + 1] = imageData.data[i + 1]!;
        rgb[i / 4 * 3 + 2] = imageData.data[i + 2]!;
      }
      imageBuffer = { data: rgb, width: canvas.width, height: canvas.height };
      }
      const results = await ocr.recognizeCharacters?.(imageBuffer as any);
      if (!results || results.length === 0) {
        setOcrStatus("done");
        setOcrLines([]);
        return;
      }
      const lines = results.map((r: any) => ({
        text: r.text,
        confidence: r.confidence,
      }));
      setOcrLines(lines);
      // Suggest region from line boxes (if quad data available)
      const quads = results.map((r: any) => r.quad).filter(Boolean);
      if (quads.length > 0) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const quad of quads) {
          for (const pt of quad) {
            minX = Math.min(minX, pt.x);
            minY = Math.min(minY, pt.y);
            maxX = Math.max(maxX, pt.x);
            maxY = Math.max(maxY, pt.y);
          }
        }
        setOcrRegion({ left: Math.round(minX), top: Math.round(minY), right: Math.round(maxX), bottom: Math.round(maxY) });
      }
      setOcrStatus("done");
    } catch (error) {
      setOcrStatus("failed");
      setOcrError(error instanceof Error ? error.message : "OCR failed. Enter the fields manually.");
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
      setOcrStatus("idle");
      setOcrLines([]);
      setOcrError("");
      setOcrRegion(null);
      setNotice("Saved as a confirmed patient-reviewed record.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not save record.");
    }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.flex}>
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <View style={styles.actionRow}>
        <Button label="Add manually" onPress={() => setShowForm((value) => !value)} />
        <Button label="Import Rx photo" variant="secondary" onPress={() => void choosePrescription()} />
      </View>
      {notice ? <View style={styles.notice}><Text style={styles.cardCopy}>{notice}</Text></View> : null}
      {imageUri ? (
        <View style={styles.rxPreview}>
          <View style={[styles.rxImage, styles.rxImageCorners]}><Image source={{ uri: imageUri }} resizeMode="cover" style={styles.rxImageFill} onLoad={() => { void runOcr(); }} /></View>
          <Text style={styles.cardCopy}>Full image preview · OCR runs locally and results are a draft only.</Text>
          {ocrStatus === "running" ? <Text style={styles.cardCopy}>Reading prescription text…</Text> : null}
          {ocrStatus === "failed" ? <Text style={styles.error}>{ocrError || "OCR could not read this image. Enter the fields manually."}</Text> : null}
          {ocrStatus === "done" && ocrLines.length > 0 ? (
            <View style={styles.ocrResults}>
              <Text style={styles.cardTitle}>Detected text (review only — not saved automatically)</Text>
              {ocrLines.map((line, i) => (
                <View key={i} style={styles.ocrLine}>
                  <Text style={styles.cardCopy}>{line.text}</Text>
                  <Text style={styles.finePrint}>Confidence: {Math.round(line.confidence * 100)}%</Text>
                </View>
              ))}
              {ocrRegion ? (
                <View style={styles.ocrRegion}>
                  <Text style={styles.cardTitle}>Suggested Rx region</Text>
                  <Text style={styles.cardCopy}>Left: {ocrRegion.left}, Top: {ocrRegion.top}, Right: {ocrRegion.right}, Bottom: {ocrRegion.bottom}</Text>
                  <Text style={styles.finePrint}>Adjust the region if the suggestion is wrong. All fields remain unknown until you confirm them.</Text>
                </View>
              ) : null}
            </View>
          ) : ocrStatus === "done" && ocrLines.length === 0 ? (
            <Text style={styles.cardCopy}>No text detected. Enter the fields manually.</Text>
          ) : null}
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
            <CheckMark checked={reviewConfirmed} /><Text style={styles.cardCopy}>I checked these patient-entered fields against a reliable source.</Text>
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
    </KeyboardAvoidingView>
  );
}

interface ChatMessage { id: string; role: "patient" | "zoe"; text: string; sources?: string[]; }

function Ask({ records }: { records: PatientRecord[] }) {
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([{ id: "welcome", role: "zoe", text: "Ask about a confirmed record, a medicine name, or a meal. I will show what I used and what is missing." }]);
  const [busy, setBusy] = useState(false);
  const speech = useOfflineSpeechComposer(draft, setDraft);

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
            {message.sources?.map((source) => <Text key={source} style={styles.citation}>Source: {source}</Text>)}
          </View>
        ))}
        {busy ? <View style={styles.thinking}><ActivityIndicator color={colors.moss} /><Text style={styles.cardCopy}>Checking local sources…</Text></View> : null}
      </ScrollView>
      <View style={styles.composer}>
        <Pressable accessibilityRole="button" accessibilityLabel={speech.state.listening ? "Finish dictation" : "Dictate question offline"} accessibilityState={{ busy: speech.state.listening }} onPress={() => void speech.toggle()} style={[styles.iconButton, speech.state.listening && styles.selectRowActive]}><AppIcon name={speech.state.listening ? "square" : "mic"} size={20} color={colors.ink} /></Pressable>
        <TextInput accessibilityLabel="Question" value={draft} onChangeText={speech.updateDraft} placeholder="Ask about your record or meal" placeholderTextColor={colors.muted} multiline style={styles.composerInput} />
        <Pressable accessibilityRole="button" accessibilityLabel="Send question" onPress={send} style={styles.sendButton}><AppIcon name="send" size={20} color={colors.paper} /></Pressable>
      </View>
      <Text accessibilityLiveRegion="polite" style={styles.speechStatus}>{speech.state.message}</Text>
    </View>
  );
}

function Wellness() {
  const [sensor, setSensor] = useState<PresageSensorState>(PresageSensor.unavailableState);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState("");
  const [showTechnical, setShowTechnical] = useState(false);
  const running = sensor.status === "running" || sensor.status === "starting";

  useEffect(() => {
    let mounted = true;
    const update = (next: PresageSensorState) => {
      if (!mounted) return;
      setSensor(next);
      if (!next.consented) setConsent(false);
    };
    const subscription = PresageSensor.addStateListener(update);
    void PresageSensor.getStatus().then(update);
    return () => {
      mounted = false;
      subscription?.remove();
      void PresageSensor.setConsent(false);
    };
  }, []);

  useEffect(() => {
    if (!running) return undefined;
    const timer = setInterval(() => {
      void PresageSensor.getStatus().then((next) => {
        setSensor(next);
        if (!next.consented) setConsent(false);
      });
    }, 1_000);
    return () => clearInterval(timer);
  }, [running]);

  async function toggleConsent() {
    if (busy) return;
    const granting = !consent;
    setBusy(true);
    setLocalError("");
    if (!granting) setConsent(false);
    try {
      const next = await PresageSensor.setConsent(granting);
      setSensor(next);
      setConsent(next.consented);
    } catch (caught) {
      setConsent(false);
      setLocalError(caught instanceof Error ? caught.message : "Camera consent could not be updated.");
    } finally {
      setBusy(false);
    }
  }

  async function startCapture() {
    if (!consent || busy) return;
    setBusy(true);
    setLocalError("");
    try {
      if (Platform.OS !== "android") throw new Error("SmartSpectra capture requires the Android preview build.");
      const permission = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA, {
        title: "Camera for live wellness",
        message: "Zoe uses the front camera in memory to estimate pulse and breathing. Zoe does not save camera frames.",
        buttonPositive: "Allow camera",
        buttonNegative: "Not now",
      });
      if (permission !== PermissionsAndroid.RESULTS.GRANTED) throw new Error("Camera permission was not granted. No capture started.");
      setSensor(await PresageSensor.initialize());
      setSensor(await PresageSensor.start());
    } catch (caught) {
      setLocalError(caught instanceof Error ? caught.message : "SmartSpectra could not start.");
      setSensor(await PresageSensor.getStatus());
    } finally {
      setBusy(false);
    }
  }

  async function stopCapture() {
    setBusy(true);
    try { setSensor(await PresageSensor.stop()); }
    finally { setBusy(false); }
  }

  const showStableValues = sensor.status === "running" && sensor.fresh && sensor.quality === "stable" && sensor.validation === "ok";
  const statusLabel = sensor.status === "unconfigured"
    ? "Unavailable in this build"
    : running
      ? "Camera check in progress"
      : consent
        ? "Ready to start"
        : "Waiting for permission";
  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Header title="Wellness check" subtitle="Check pulse and breathing with your front camera. These signals are not a diagnosis." />
      <View style={styles.consentCard}>
        <View style={styles.wellnessIcon}><AppIcon name="camera" size={26} color={colors.ink} /></View>
        <Text style={styles.sectionTitle}>Before you start</Text>
        <Text style={styles.cardCopy}>Zoe uses the front camera only during this check. Processed in memory. Zoe does not save camera frames.</Text>
        <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: consent }} disabled={busy} onPress={() => void toggleConsent()} style={[styles.selectRow, consent && styles.selectRowActive]}>
          <CheckMark checked={consent} /><Text style={styles.cardCopy}>Allow camera use for this wellness check.</Text>
        </Pressable>
        <View style={styles.statusPanel}>
          <Text style={styles.cardTitle}>{statusLabel}</Text>
          {sensor.reason ? <Text style={styles.cardCopy}>{sensor.reason}</Text> : null}
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: showTechnical }} accessibilityLabel="Technical details" aria-expanded={showTechnical} onPress={() => setShowTechnical((visible) => !visible)} style={styles.technicalToggle}><AppIcon name={showTechnical ? "chevron-up" : "chevron-down"} size={18} color={colors.ink} /><Text style={styles.technicalToggleText}>Technical details</Text></Pressable>
          {showTechnical ? <Text style={styles.technicalDetail}>Status {sensor.status} · readiness {sensor.readiness} · signal {sensor.quality}{sensor.validation ? ` · validation ${sensor.validation}` : ""} · SDK telemetry off</Text> : null}
        </View>
        {localError ? <Text style={styles.error}>{localError}</Text> : null}
        {running ? <Button label="Stop camera check" variant="secondary" disabled={busy} onPress={() => void stopCapture()} /> : <Button label={busy ? "Checking camera…" : "Start camera check"} disabled={!consent || busy || !sensor.linked || !sensor.configured} onPress={() => void startCapture()} />}
      </View>
      <View style={styles.metricRow}>
        <View style={styles.metric}><Text style={styles.metricValue}>{showStableValues && sensor.pulseRate != null ? Math.round(sensor.pulseRate) : "—"}</Text><Text style={styles.metricLabel}>Pulse · bpm</Text>{showStableValues && sensor.pulseConfidence != null ? <Text style={styles.source}>{Math.round(sensor.pulseConfidence)}% confidence</Text> : null}</View>
        <View style={styles.metric}><Text style={styles.metricValue}>{showStableValues && sensor.breathingRate != null ? Math.round(sensor.breathingRate) : "—"}</Text><Text style={styles.metricLabel}>Breathing · breaths/min</Text>{showStableValues && sensor.breathingConfidence != null ? <Text style={styles.source}>{Math.round(sensor.breathingConfidence)}% confidence</Text> : null}</View>
      </View>
      {showStableValues && sensor.capturedAt ? <Text style={styles.source}>Fresh reading: {new Date(sensor.capturedAt).toLocaleTimeString()}</Text> : null}
      <View style={styles.notice}><Text style={styles.cardTitle}>Only fresh, stable readings appear</Text><Text style={styles.cardCopy}>Missing, stale, invalid, or low-quality readings stay blank. Zoe never substitutes sample values.</Text></View>
    </ScrollView>
  );
}

function Navigation({ screen, setScreen, expanded }: { screen: Screen; setScreen: (screen: Screen) => void; expanded: boolean }) {
  const items: Array<{ screen: Screen; label: string; icon: IconName }> = [
    { screen: "home", label: "Home", icon: "home" },
    { screen: "records", label: "Records", icon: "file-text" },
    { screen: "ask", label: "Ask", icon: "message-circle" },
    { screen: "wellness", label: "Wellness", icon: "activity" }
  ];
  return <View accessibilityLabel="Primary navigation" style={[styles.nav, expanded && styles.navRail]}>{items.map((item) => {
    const active = item.screen === screen;
    return <Pressable key={item.screen} onPress={() => setScreen(item.screen)} accessibilityRole="button" accessibilityLabel={item.label} accessibilityState={{ selected: active }} aria-current={active ? "page" : undefined} style={({ pressed }) => [styles.navItem, expanded && styles.navRailItem, active && styles.navItemActive, pressed && styles.pressed]}><AppIcon name={item.icon} size={20} color={active ? colors.ink : colors.muted} /><Text style={[styles.navLabel, active && styles.navActive]}>{item.label}</Text></Pressable>;
  })}</View>;
}

export default function App() {
  const { width } = useWindowDimensions();
  const expanded = width >= 760;
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
    return <Home records={records} setScreen={setScreen} vaultMode={vault?.mode ?? "web-preview"} syntheticPreview={!cloudSession} />;
  }, [cloudSession, records, screen, vault]);

  if (access === "intro") return <><StatusBar style="dark" /><Intro onDone={() => setAccess("login")} /></>;
  if (access === "login") return <><StatusBar style="dark" /><Login onPreview={() => void unlock("synthetic-patient-a")} onCloud={(session) => void unlock(session.userId, session)} error={error} /></>;
  if (access === "passphrase" && pendingAccess) return <><StatusBar style="dark" /><PassphraseAccess accountId={pendingAccess.accountId} accountHint={pendingAccess.session ? maskAccountEmail(pendingAccess.session.email) : undefined} setup={pendingAccess.setup} error={error} onSubmit={(passphrase) => void unlock(pendingAccess.accountId, pendingAccess.session, { passphrase, setupPassphrase: pendingAccess.setup })} onCancel={() => { setPendingAccess(null); setError(""); setAccess("login"); }} /></>;
  if (access === "migration") return <><StatusBar style="dark" /><PassphraseAccess accountId={userId} accountHint={cloudSession ? maskAccountEmail(cloudSession.email) : undefined} setup={!migrationRecoveryRequired} error={error} onSubmit={(passphrase) => void migrateVault(passphrase)} cancelLabel={migrationRecoveryRequired ? "Lock vault" : "Back"} onCancel={() => {
    if (migrationBackAction(migrationRecoveryRequired) === "sign-out") { void signOut(); return; }
    setError("");
    setAccess("ready");
  }} /></>;
  if (access === "unlocking") return <View style={styles.loading}><ActivityIndicator size="large" color={colors.moss} /><Text style={styles.cardCopy}>Opening private vault…</Text></View>;
  return (
    <SafeAreaView style={styles.shell}>
      <StatusBar style="dark" />
      <View style={styles.sessionBar}><Text numberOfLines={1} style={styles.sessionLabel}>{cloudSession ? `Signed in · ${maskAccountEmail(cloudSession.email)}` : "Synthetic preview"}</Text><View style={styles.sessionActions}>{vault?.protection === "biometric" ? <Pressable accessibilityRole="button" style={styles.sessionButton} onPress={() => { setError(""); setMigrationRecoveryRequired(false); setAccess("migration"); }}><Text style={styles.lockText}>Use passphrase</Text></Pressable> : null}<Pressable accessibilityRole="button" style={styles.sessionButton} onPress={() => void signOut()}><AppIcon name="lock" size={15} color={colors.ink} /><Text style={styles.lockText}>Lock vault</Text></Pressable></View></View>
      <View style={styles.appFrame}>
        {expanded ? <Navigation screen={screen} setScreen={setScreen} expanded /> : null}
        <View style={styles.content}>{body}</View>
      </View>
      {!expanded ? <Navigation screen={screen} setScreen={setScreen} expanded={false} /> : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: colors.cream },
  appFrame: { flex: 1, flexDirection: "row", minWidth: 0 },
  content: { flex: 1, minWidth: 0 },
  flex: { flex: 1, minWidth: 0 },
  intro: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.cream, padding: 32 },
  introMark: { width: 170, height: 170 },
  introWord: { fontSize: 44, lineHeight: 50, fontWeight: "700", color: colors.ink, letterSpacing: -1, marginTop: -18 },
  introTagline: { color: colors.muted, fontSize: 16, lineHeight: 24, marginTop: 8 },
  accessPage: { flex: 1, backgroundColor: colors.cream, alignItems: "center", justifyContent: "center", padding: 16 },
  accessArt: { width: "100%", maxWidth: 520, alignItems: "flex-start", padding: 16 },
  loginMark: { width: 104, height: 104, alignSelf: "center", marginBottom: 12 },
  contextLabel: { color: colors.muted, fontWeight: "700", fontSize: 14, lineHeight: 19 },
  heroTitle: { color: colors.ink, fontSize: 32, lineHeight: 38, fontWeight: "700", letterSpacing: -0.5, marginTop: 8 },
  heroCopy: { color: colors.muted, fontSize: 16, lineHeight: 24, marginTop: 10, maxWidth: 520 },
  loginCard: { width: "100%", maxWidth: 520, backgroundColor: colors.paper, borderRadius: 16, padding: 20, gap: 16, borderWidth: 1, borderColor: colors.line },
  sectionTitle: { fontSize: 23, lineHeight: 28, fontWeight: "700", color: colors.ink },
  supporting: { color: colors.muted, fontSize: 15, lineHeight: 22, maxWidth: 640 },
  finePrint: { color: colors.muted, fontSize: 14, lineHeight: 20, textAlign: "center" },
  noticeText: { color: colors.ink, backgroundColor: colors.mint, padding: 12, borderRadius: 12, fontSize: 14, lineHeight: 20 },
  error: { color: colors.danger, fontSize: 14, lineHeight: 20 },
  button: { minHeight: 48, paddingHorizontal: 18, paddingVertical: 12, borderRadius: 12, alignItems: "center", justifyContent: "center", flexGrow: 1 },
  button_primary: { backgroundColor: colors.moss },
  button_secondary: { backgroundColor: colors.mint },
  button_ghost: { backgroundColor: "transparent", borderColor: colors.line, borderWidth: 1 },
  buttonText: { color: colors.paper, fontWeight: "700", fontSize: 15 },
  buttonTextDark: { color: colors.ink },
  pressed: { opacity: 0.78, transform: [{ scale: 0.99 }] },
  disabled: { opacity: 0.5 },
  page: { padding: 16, paddingBottom: 32, width: "100%", maxWidth: 760, alignSelf: "center", gap: 16 },
  header: { gap: 6, marginBottom: 4 },
  headerBrand: { flexDirection: "row", alignItems: "center", gap: 7, marginBottom: 8 },
  headerMark: { width: 28, height: 28 },
  headerWord: { color: colors.ink, fontSize: 20, fontWeight: "700" },
  screenTitle: { color: colors.ink, fontSize: 28, lineHeight: 34, fontWeight: "700", letterSpacing: -0.4 },
  privacyBanner: { backgroundColor: colors.mint, borderRadius: 14, padding: 16, flexDirection: "row", alignItems: "flex-start", gap: 12 },
  bannerIcon: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: colors.accent },
  cardTitle: { color: colors.ink, fontSize: 16, lineHeight: 22, fontWeight: "700" },
  cardCopy: { color: colors.muted, fontSize: 14, lineHeight: 21, marginTop: 2, flexShrink: 1 },
  signalCard: { backgroundColor: colors.ink, borderRadius: 16, padding: 20, gap: 12 },
  signalHeading: { flexDirection: "row", alignItems: "center", gap: 10 },
  signalTitle: { color: colors.paper, fontSize: 22, lineHeight: 27, fontWeight: "700", flexShrink: 1 },
  signalCopy: { color: "#E2ECE7", fontSize: 14, lineHeight: 21 },
  groupTitle: { color: colors.ink, fontSize: 20, lineHeight: 25, fontWeight: "700", marginTop: 8 },
  metricRow: { flexDirection: "row", gap: 16, borderTopColor: colors.line, borderTopWidth: 1, borderBottomColor: colors.line, borderBottomWidth: 1 },
  metric: { flex: 1, paddingVertical: 16 },
  metricValue: { color: colors.ink, fontSize: 28, lineHeight: 34, fontWeight: "800" },
  metricLabel: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  quickGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  quickCard: { flexGrow: 1, minWidth: 128, minHeight: 88, backgroundColor: colors.paper, borderRadius: 14, padding: 16, borderColor: colors.line, borderWidth: 1, gap: 8 },
  actionRow: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  notice: { padding: 14, borderRadius: 12, backgroundColor: colors.mint },
  formCard: { backgroundColor: colors.paper, padding: 16, borderRadius: 16, borderColor: colors.line, borderWidth: 1, gap: 16 },
  fieldWrap: { gap: 7 },
  label: { color: colors.ink, fontSize: 14, lineHeight: 19, fontWeight: "700" },
  helperText: { color: colors.muted, fontSize: 14, lineHeight: 20, marginTop: -8 },
  input: { minHeight: 48, backgroundColor: colors.paper, borderColor: colors.line, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, color: colors.ink, fontSize: 15 },
  multiline: { minHeight: 96, textAlignVertical: "top" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { minHeight: 44, borderRadius: 22, borderColor: colors.line, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 11, justifyContent: "center" },
  chipActive: { backgroundColor: colors.ink, borderColor: colors.ink },
  chipText: { color: colors.muted, textTransform: "capitalize", fontSize: 14 },
  chipTextActive: { color: colors.paper },
  recordCard: { paddingVertical: 15, borderBottomColor: colors.line, borderBottomWidth: 1, gap: 5 },
  recordTop: { flexDirection: "row", justifyContent: "space-between", gap: 10, flexWrap: "wrap" },
  kind: { color: colors.moss, fontWeight: "700", textTransform: "capitalize", fontSize: 14 },
  source: { color: colors.muted, fontSize: 14, lineHeight: 19 },
  date: { color: colors.muted, fontSize: 14, lineHeight: 19, marginTop: 4 },
  rxPreview: { backgroundColor: colors.paper, borderRadius: 16, padding: 10, borderColor: colors.line, borderWidth: 1 },
  rxImage: { height: 250, justifyContent: "center", alignItems: "center" },
  rxImageCorners: { borderRadius: 10 },
  rxImageFill: { width: "100%", height: "100%", borderRadius: 10 },
  ocrResults: { gap: 8, marginTop: 8 },
  ocrLine: { padding: 8, borderRadius: 8, backgroundColor: colors.mint, gap: 2 },
  ocrRegion: { padding: 8, borderRadius: 8, borderWidth: 1, borderColor: colors.line, gap: 4, marginTop: 8 },
  chatPage: { flex: 1, width: "100%", maxWidth: 760, alignSelf: "center", minWidth: 0 },
  chatHeader: { paddingHorizontal: 16, paddingTop: 16 },
  messages: { padding: 16, paddingTop: 6, gap: 12 },
  bubble: { maxWidth: "88%", padding: 14, borderRadius: 16, gap: 8 },
  zoeBubble: { alignSelf: "flex-start", backgroundColor: colors.paper, borderColor: colors.line, borderWidth: 1, borderTopLeftRadius: 5 },
  patientBubble: { alignSelf: "flex-end", backgroundColor: colors.moss, borderTopRightRadius: 5 },
  bubbleText: { color: colors.ink, fontSize: 15, lineHeight: 22 },
  patientBubbleText: { color: colors.paper },
  citation: { color: colors.muted, fontSize: 14, lineHeight: 20, borderTopColor: colors.line, borderTopWidth: 1, paddingTop: 7 },
  thinking: { flexDirection: "row", alignSelf: "flex-start", gap: 10, alignItems: "center", padding: 12 },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: 6, padding: 8, backgroundColor: colors.paper, borderTopColor: colors.line, borderTopWidth: 1, minWidth: 0 },
  composerInput: { flex: 1, minWidth: 0, maxHeight: 110, minHeight: 48, backgroundColor: colors.cream, borderColor: colors.line, borderWidth: 1, borderRadius: 12, padding: 12, color: colors.ink, fontSize: 15 },
  iconButton: { width: 48, height: 48, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: colors.mint, flexShrink: 0 },
  sendButton: { width: 48, height: 48, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: colors.moss, flexShrink: 0 },
  speechStatus: { color: colors.muted, backgroundColor: colors.paper, fontSize: 14, lineHeight: 20, paddingHorizontal: 12, paddingBottom: 8 },
  consentCard: { backgroundColor: colors.paper, padding: 18, borderRadius: 16, borderColor: colors.line, borderWidth: 1, alignItems: "stretch", gap: 14 },
  wellnessIcon: { width: 48, height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: colors.mint },
  statusPanel: { backgroundColor: colors.cream, borderRadius: 12, padding: 14, gap: 5 },
  technicalDetail: { color: colors.muted, fontSize: 14, lineHeight: 20, marginTop: 4 },
  technicalToggle: { minHeight: 48, alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 7, marginTop: 2, paddingRight: 12 },
  technicalToggleText: { color: colors.ink, fontSize: 14, lineHeight: 20, fontWeight: "700" },
  selectRow: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderColor: colors.line, borderRadius: 12, padding: 12 },
  selectRowActive: { backgroundColor: colors.mint, borderColor: colors.moss },
  checkbox: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: colors.moss, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  checkboxActive: { backgroundColor: colors.accent },
  successCard: { backgroundColor: colors.ink, padding: 18, borderRadius: 16, gap: 10 },
  successLabel: { color: colors.accent, fontWeight: "700", fontSize: 14, lineHeight: 20 },
  sessionBar: { minHeight: 52, paddingHorizontal: 8, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 6, backgroundColor: colors.mint, borderBottomColor: colors.line, borderBottomWidth: 1 },
  sessionLabel: { flex: 1, minWidth: 0, color: colors.muted, fontSize: 14, lineHeight: 20 },
  sessionActions: { flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 0 },
  sessionButton: { minHeight: 48, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: 10 },
  lockText: { color: colors.ink, fontWeight: "700", fontSize: 14 },
  nav: { flexDirection: "row", backgroundColor: colors.paper, borderTopColor: colors.line, borderTopWidth: 1, minHeight: 68, paddingHorizontal: 2, paddingBottom: Platform.OS === "ios" ? 10 : 2 },
  navRail: { width: 112, flexDirection: "column", borderTopWidth: 0, borderRightColor: colors.line, borderRightWidth: 1, padding: 8, gap: 4 },
  navItem: { flex: 1, minWidth: 0, minHeight: 64, alignItems: "center", justifyContent: "center", gap: 3, borderRadius: 12, paddingHorizontal: 2 },
  navRailItem: { flexGrow: 0, flexBasis: 64, width: "100%", paddingHorizontal: 8 },
  navItemActive: { backgroundColor: colors.mint },
  navLabel: { color: colors.muted, fontSize: 14, lineHeight: 18, fontWeight: "600" },
  navActive: { color: colors.ink, fontWeight: "800" },
  loading: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.cream, gap: 14 }
});
