import { type ComponentProps, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  AccessibilityInfo,
  Animated,
  AppState,
  Keyboard,
  KeyboardAvoidingView,
  Image,
  PermissionsAndroid,
  Platform,
  Pressable,
  ScrollView,
  type ScrollViewInstance,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { requireOptionalNativeModule } from "expo";
import * as ImagePicker from "expo-image-picker";
import { CameraView, useCameraPermissions, type PictureRef } from "expo-camera";
import { Image as PreviewImage } from "expo-image";
import { SafeAreaProvider, SafeAreaView, initialWindowMetrics, useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@react-native-vector-icons/feather";
import { SYNTHETIC_RECORDS, confirmRecord, createDraftRecord, manualRecordKind, type PatientRecord, type RecordKind } from "@zoe/records";import PresageSensor, { type PresageSensorState } from "@zoe/presage-sensor";
import { PatientAuthProvider, type EmailCodeMode, type PatientAuth } from "./src/platform/auth";
import { canAutoReopenPatientVault, canOpenPatientVault, patientSessionScope, type PatientIdentity } from "./src/platform/patientIdentity";
import { hasLegacySyntheticPreview, openSyntheticPreviewVault, openVault, VaultAccessError, type Vault, type VaultOpenOptions } from "./src/platform/vault";
import { UnlockRateLimiter, validateNewPassphrase } from "./src/platform/vaultPolicy";
import { recordsForOpenedVault } from "./src/platform/recordBootstrap";
import { lockThenClear, migrationBackAction, migrationRequiresCompletion, shouldCoverVault, startIfCurrent, VaultAccessGeneration, vaultForegroundAction, withDeadline } from "./src/platform/appLifecycle";
import { PhotoOwnership } from "./src/platform/photoOwnership";
import { useOfflineSpeechComposer } from "./src/platform/useOfflineSpeechComposer";
import { FormScroll } from "./src/components/FormScroll";
import { homePresentation, maskAccountEmail } from "./src/platform/patientPresentation";
import { planAssistantTurn } from "./src/assistant/assistantPolicy";
import { AssistantRunner } from "./src/assistant/assistantRunner";
import { useOnDeviceModel } from "./src/assistant/useOnDeviceModel";

type Screen = "home" | "records" | "ask" | "wellness";
const prescriptionPhotos = Platform.OS === "android" ? requireOptionalNativeModule<{
  clearLegacyPhotoCopies(): Promise<void>;
  recentGalleryImages(): Promise<string[]>;
}>("PrescriptionMask") : null;
const photoCleanup = Platform.OS !== "android"
  ? Promise.resolve(true)
  : prescriptionPhotos?.clearLegacyPhotoCopies().then(() => true, () => false) ?? Promise.resolve(false);
type AccessState = "intro" | "login" | "locked" | "legacy" | "passphrase" | "migration" | "unlocking" | "ready";
type VaultTarget = { accountId: string; session: PatientIdentity | null; devicePreview: boolean };

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
const sessionBarHeight = 52;

type IconName = ComponentProps<typeof Feather>["name"];

function AppIcon({ name, size = 20, color = colors.muted }: { name: IconName; size?: number; color?: string }) {
  return <Feather name={name} size={size} color={color} />;
}

function CheckMark({ checked, animate = false }: { checked: boolean; animate?: boolean }) {
  const progress = useRef(new Animated.Value(checked ? 1 : 0)).current;
  const [reduceMotion, setReduceMotion] = useState(true);
  useEffect(() => {
    if (!animate) return;
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => { if (mounted) setReduceMotion(value); }).catch(() => {});
    const listener = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => { mounted = false; listener?.remove(); };
  }, [animate]);
  useEffect(() => {
    if (!animate || reduceMotion) { progress.setValue(checked ? 1 : 0); return; }
    const transition = Animated.timing(progress, { toValue: checked ? 1 : 0, duration: 150, useNativeDriver: Platform.OS !== "web" });
    transition.start();
    return () => transition.stop();
  }, [animate, checked, progress, reduceMotion]);
  return <View style={[styles.checkbox, checked && styles.checkboxActive]}><Animated.View style={{ opacity: animate && !reduceMotion ? progress : Number(checked) }}><AppIcon name="check" size={17} color={colors.ink} /></Animated.View></View>;
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

function Field({ label, value, onChangeText, placeholder, multiline = false, secureTextEntry = false, autoCapitalize, keyboardType, autoComplete }: { label: string; value: string; onChangeText: (value: string) => void; placeholder?: string; multiline?: boolean; secureTextEntry?: boolean } & Pick<ComponentProps<typeof TextInput>, "autoCapitalize" | "keyboardType" | "autoComplete">) {
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
        secureTextEntry={secureTextEntry} autoCapitalize={autoCapitalize} keyboardType={keyboardType} autoComplete={autoComplete}
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

  return <FormScroll contentContainerStyle={styles.accessPage}><View style={styles.loginCard}>
    <Text style={styles.contextLabel}>{setup ? "New device-bound vault" : "Private vault"}</Text>
    <Text style={styles.sectionTitle}>{setup ? "Create a strong passphrase" : "Enter your vault passphrase"}</Text>
    <Text style={styles.supporting}>{setup ? "Zoe combines this passphrase with a random account-specific secret held by Android Keystore. The passphrase alone cannot open a copied database." : accountHint ? `Unlock the private vault for ${accountHint}. The passphrase is processed only on this device.` : "Unlock your private vault. The passphrase is processed only on this device."}</Text>
    <Field label="Vault passphrase" value={passphrase} onChangeText={setPassphrase} secureTextEntry placeholder={setup ? "16+ varied characters or 4 unrelated words" : "Your vault passphrase"} />
    {setup ? <Field label="Confirm vault passphrase" value={confirmation} onChangeText={setConfirmation} secureTextEntry placeholder="Enter it again" /> : null}
    <View style={styles.notice}><Text style={styles.cardTitle}>No recovery</Text><Text style={styles.cardCopy}>Zoe never uploads this passphrase or vault key. Uninstalling the app, clearing its storage, losing the Keystore secret, or forgetting the passphrase makes this local vault unrecoverable.</Text></View>
    {localError || error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{localError || error}</Text> : null}
    <Button label={setup ? "Create encrypted vault" : "Unlock encrypted vault"} onPress={submit} disabled={!passphrase || (setup && !confirmation)} />
    <Button label={cancelLabel} variant="ghost" onPress={onCancel} />
  </View></FormScroll>;
}

function Intro({ onDone }: { onDone: () => void }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.92)).current;
  const [showIntro, setShowIntro] = useState(false);
  useEffect(() => {
    let active = true;
    let animation: Animated.CompositeAnimation | undefined;
    const finish = () => { if (active) onDone(); };
    if (Platform.OS === "web" && globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      finish();
      return;
    }
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", (reduced) => {
      if (reduced) finish();
    });
    void AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (!active) return;
      if (reduced) { finish(); return; }
      setShowIntro(true);
      animation = Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 320, useNativeDriver: Platform.OS !== "web" }),
        Animated.timing(scale, { toValue: 1, duration: 320, useNativeDriver: Platform.OS !== "web" })
      ]);
      animation.start(({ finished }) => { if (finished) finish(); });
    }, finish);
    return () => { active = false; subscription?.remove(); animation?.stop(); };
  }, [onDone, opacity, scale]);
  if (!showIntro) return <View style={styles.intro} />;
  return (
    <View style={styles.intro}>
      <Animated.Image source={brandMark} resizeMode="contain" style={[styles.introMark, { opacity, transform: [{ scale }] }]} />
      <Text style={styles.introWord}>Zoe</Text>
      <Text style={styles.introTagline}>Your health story, held by you.</Text>
    </View>
  );
}

function Login({ onPreview, onLegacyPreview, onSignOut, auth, error }: { onPreview: () => void; onLegacyPreview: () => void; onSignOut: () => void; auth: PatientAuth; error: string }) {
  const authGeneration = useRef(new VaultAccessGeneration()).current;
  const [legacyPreviewExists, setLegacyPreviewExists] = useState(false);
  useEffect(() => {
    let mounted = true;
    void hasLegacySyntheticPreview().then((exists) => { if (mounted) setLegacyPreviewExists(exists); }).catch(() => {});
    const subscription = AppState.addEventListener("change", (state) => {
      if (vaultForegroundAction(state) === "lock") authGeneration.invalidate();
    });
    return () => { mounted = false; subscription.remove(); authGeneration.invalidate(); };
  }, [authGeneration]);
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [codeMode, setCodeMode] = useState<EmailCodeMode | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const authOperation = useRef(false);
  const [authMessage, setAuthMessage] = useState("");

  async function handleEmailCode() {
    if (!auth.emailCode || authOperation.current) return;
    const generation = authGeneration.invalidate();
    const isCurrent = () => authGeneration.current(generation);
    authOperation.current = true;
    setAuthBusy(true);
    setAuthMessage("");
    try {
      if (codeMode) {
        await auth.emailCode.verify(codeMode, otp.trim(), isCurrent);
      } else {
        const mode = await auth.emailCode.send(email.trim());
        if (!isCurrent()) return;
        setCodeMode(mode);
        setAuthMessage("Check your email for the one-time code.");
      }
    } catch {
      if (isCurrent()) setAuthMessage(codeMode ? "Could not verify that code. Try again or request a new code." : "Could not send a code. Check your email address and try again.");
    } finally {
      authOperation.current = false;
      setAuthBusy(false);
    }
  }

  function changeEmail(value: string) {
    authGeneration.invalidate();
    setEmail(value);
    setOtp("");
    setCodeMode(null);
    setAuthMessage("");
  }
  return (
    <FormScroll contentContainerStyle={styles.accessPage}>
      <View style={styles.accessArt}>
        <Image source={brandMark} resizeMode="contain" style={styles.loginMark} />
        <Text style={styles.contextLabel}>Private by design</Text>
        <Text style={styles.heroTitle}>Your history stays close.</Text>
        <Text style={styles.heroCopy}>Keep reviewed records in an encrypted vault on this device.</Text>
      </View>
      <View style={styles.loginCard}>
        <Text style={styles.sectionTitle}>Enter Zoe</Text>
        {auth.emailCode ? <>
          <Text style={styles.supporting}>Use an email one-time code. {Platform.OS === "web" ? "This browser preview uses temporary test records." : "Each signed-in account opens its own local encrypted vault."}</Text>
          <Field label="Email" value={email} onChangeText={changeEmail} placeholder="you@example.com" autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
          {codeMode ? <Field label="One-time code" value={otp} onChangeText={setOtp} placeholder="123456" keyboardType="number-pad" autoComplete="one-time-code" /> : null}
          <Button label={codeMode ? "Verify code" : "Send one-time code"} onPress={() => void handleEmailCode()} disabled={authBusy || !email.trim() || (Boolean(codeMode) && !/^\d{6}$/.test(otp.trim()))} />
          {codeMode ? <Button label="Request a new code" variant="ghost" onPress={() => changeEmail(email)} disabled={authBusy} /> : null}
          {authMessage ? <Text accessibilityLiveRegion="polite" style={styles.supporting}>{authMessage}</Text> : null}
          <Text style={styles.finePrint}>Or use the isolated synthetic preview below.</Text>
        </> : auth.signOut && !auth.restoring ? <>
          <Text style={styles.noticeText}>This session cannot open your vault. Finish signing out to request a new code.</Text>
          <Button label="Finish signing out" onPress={onSignOut} />
        </> : <Text style={styles.noticeText}>{auth.restoring ? "Checking your sign-in…" : "Email sign-in is unavailable in this build."}</Text>}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Button label="Unlock synthetic preview" variant="secondary" onPress={() => { authGeneration.invalidate(); onPreview(); }} />
        {legacyPreviewExists ? <Button label="Open previous synthetic vault" variant="ghost" onPress={() => { authGeneration.invalidate(); onLegacyPreview(); }} /> : null}
        <Text style={styles.finePrint}>Not for diagnosis or treatment. No recovery after uninstall in the MVP.</Text>
      </View>
    </FormScroll>
  );
}

function Header({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={styles.header}>
      <Text accessibilityRole="header" style={styles.screenTitle}>{title}</Text>
      {subtitle ? <Text style={styles.supporting}>{subtitle}</Text> : null}
    </View>
  );
}

function Home({ records, setScreen, vaultMode, syntheticPreview }: { records: PatientRecord[]; setScreen: (screen: Screen) => void; vaultMode: Vault["mode"]; syntheticPreview: boolean }) {
  const confirmed = records.filter((record) => record.status === "confirmed");
  const presentation = homePresentation(syntheticPreview, confirmed.length, vaultMode === "sqlcipher");
  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Header title={presentation.title} subtitle={presentation.subtitle} />
      <View style={styles.signalCard}>
        <View style={styles.signalHeading}><AppIcon name="activity" size={21} color={colors.accent} /><Text style={styles.signalTitle}>Check pulse and breathing</Text></View>
        <Text style={styles.signalCopy}>Use the front camera for a private wellness check. Processed in memory. Zoe does not save camera frames.</Text>
        <Button label="Start a wellness check" variant="secondary" onPress={() => setScreen("wellness")} />
      </View>
      <View style={styles.privacyBanner}>
        <View style={styles.bannerIcon}><AppIcon name="shield" size={21} color={colors.ink} /></View>
        <View style={styles.flex}>
          <Text style={styles.cardTitle}>{vaultMode === "sqlcipher" ? "Encrypted on this device" : "Web preview storage"}</Text>
          <Text style={styles.cardCopy}>{vaultMode === "sqlcipher" ? "Your private vault is open." : syntheticPreview ? "Browser preview uses local storage." : "Synthetic test records are cleared when you lock or reload."}</Text>
        </View>
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
  const [showForm, setShowForm] = useState(false);
  const [kind, setKind] = useState<RecordKind>("note");
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [photo, setPhoto] = useState<string | PictureRef | null>(null);
  const [gallery, setGallery] = useState<string[]>([]);
  const [photoState, setPhotoState] = useState<"closed" | "choose" | "camera" | "gallery" | "review">("closed");
  const [photoError, setPhotoError] = useState("");
  const [imageReady, setImageReady] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const camera = useRef<CameraView>(null);
  const photos = useRef(new PhotoOwnership()).current;
  const [, requestCameraPermission] = useCameraPermissions();
  const [notice, setNotice] = useState("");
  const [reviewConfirmed, setReviewConfirmed] = useState(false);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (vaultForegroundAction(state) === "lock") photos.clear();
    });
    return () => { subscription.remove(); photos.clear(); };
  }, [photos]);

  function reviewPhoto(source: string | PictureRef, generation: number, dispose: () => void = () => {}) {
    if (!photos.adopt(generation, dispose)) return;
    setPhotoError("");
    setImageReady(false);
    setPhoto(source);
    setGallery([]);
    setKind("medicine");
    setShowForm(true);
    setReviewConfirmed(false);
    setPhotoState("review");
  }

  async function choosePrescription(changeAccess = false) {
    const generation = photos.begin();
    setPhotoError("");
    setPhotoBusy(true);
    try {
      if (Platform.OS === "android") {
        const api = Number(Platform.Version);
        if (api < 33 || !prescriptionPhotos) {
          setPhotoError("Gallery access is unavailable on this Android version. Take a photo or enter the fields manually.");
          return;
        }
        const images = PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES;
        const selected = PermissionsAndroid.PERMISSIONS.READ_MEDIA_VISUAL_USER_SELECTED;
        const permissions = api >= 34 ? [images, selected] : [images];
        let allowed = (await Promise.all(permissions.map((permission) => PermissionsAndroid.check(permission)))).some(Boolean);
        if (!photos.current(generation)) return;
        if (!allowed || changeAccess) {
          const grants = await PermissionsAndroid.requestMultiple(permissions);
          allowed = permissions.some((permission) => grants[permission] === PermissionsAndroid.RESULTS.GRANTED);
        }
        if (!photos.current(generation)) return;
        if (!allowed) {
          setPhotoError("Photo access is off. Take a photo or enter the fields manually.");
          return;
        }
        const entries = await prescriptionPhotos.recentGalleryImages();
        if (!photos.current(generation)) return;
        setGallery(entries);
        setPhotoState("gallery");
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.85 });
      const uri = result.assets?.[0]?.uri;
      if (uri) reviewPhoto(uri, generation, () => { if (uri.startsWith("blob:")) URL.revokeObjectURL(uri); });
      else if (photos.current(generation)) setPhotoError("No photo selected. Choose an image or enter the record manually.");
    } catch {
      if (photos.current(generation)) setPhotoError("Could not open the photo. Try another image or enter the record manually.");
    } finally { if (photos.current(generation)) setPhotoBusy(false); }
  }

  async function openCamera() {
    const generation = photos.begin();
    setPhotoError("");
    setPhotoBusy(true);
    try {
      const permission = await requestCameraPermission();
      if (!photos.current(generation)) return;
      if (!permission.granted) {
        setPhotoError("Camera permission is off. Choose an image or enter the record manually.");
        return;
      }
      setCameraReady(false);
      setPhotoState("camera");
    } catch {
      if (photos.current(generation)) setPhotoError("Camera unavailable. Choose an image or enter the record manually.");
    } finally { if (photos.current(generation)) setPhotoBusy(false); }
  }

  async function takePhoto() {
    if (!cameraReady || !camera.current || photoBusy) return;
    const generation = photos.begin();
    setPhotoBusy(true);
    try {
      const picture = await camera.current.takePictureAsync({ pictureRef: true });
      if (picture) reviewPhoto(picture, generation, () => picture.release());
      else if (photos.current(generation)) setPhotoError("No photo was returned. Try again or enter the fields manually.");
    } catch {
      if (photos.current(generation)) setPhotoError("Could not take the photo. Try again or choose an image.");
    } finally { if (photos.current(generation)) setPhotoBusy(false); }
  }

  function clearPhoto() {
    photos.clear();
    setPhoto(null);
    setGallery([]);
    setPhotoBusy(false);
    setImageReady(false);
    setPhotoError("");
    setReviewConfirmed(false);
  }

  function startManual(fromPrescription = false) {
    setNotice("");
    clearPhoto();
    setPhotoState("closed");
    setKind(manualRecordKind(fromPrescription));
    setShowForm(true);
  }
  async function submit() {
    try {
      if (!reviewConfirmed || (photoState === "review" && !imageReady)) throw new Error("Confirm that you checked the entered fields before saving.");
      const draft = createDraftRecord({ kind, title, detail, recordedAt: new Date().toISOString(), source: "patient-reported" });
      await onSave(confirmRecord(draft));
      setTitle("");
      setDetail("");
      clearPhoto();
      setPhotoState("closed");
      setReviewConfirmed(false);
      setShowForm(false);
      setNotice("Saved as a confirmed patient-reviewed record.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not save record.");
    }
  }

  return (
    <FormScroll contentContainerStyle={styles.page}>
      <Header title="Health record" subtitle="Every fact shows its source. Draft text never becomes a record without your review." />
      <View style={styles.actionRow}>
        <Button label="Add manually" onPress={() => startManual()} />
        <Button label="Import Rx photo" variant="secondary" onPress={() => { clearPhoto(); setNotice(""); setPhotoState("choose"); setShowForm(false); }} />
      </View>
      {!showForm && notice ? <View style={styles.notice}><Text accessibilityLiveRegion="polite" style={styles.cardCopy}>{notice}</Text></View> : null}
      {photoState === "choose" || photoState === "camera" || photoState === "gallery" ? (
        <View style={styles.formCard}>
          <Text accessibilityRole="header" style={styles.sectionTitle}>Add a prescription</Text>
          <Text style={styles.cardCopy}>Use a clear image. You’ll enter and review the fields yourself.</Text>
          {photoState === "camera" ? <>
            <CameraView ref={camera} style={styles.rxImage} facing="back" mode="picture" onCameraReady={() => setCameraReady(true)} onMountError={() => { setPhotoState("choose"); setPhotoError("Camera unavailable. Choose an image or enter the record manually."); }} />
            <Button label="Capture photo" disabled={!cameraReady || photoBusy} onPress={() => void takePhoto()} />
            <Button label="Close camera" variant="ghost" disabled={photoBusy} onPress={() => setPhotoState("choose")} />
          </> : photoState === "gallery" ? <>
            <Text style={styles.cardCopy}>{gallery.length ? "Choose from recent images you’ve allowed Zoe to see." : "No accessible photos. Change photo access or take a photo."}</Text>
            <View style={styles.chips}>{gallery.map((uri, index) => <Pressable key={uri} accessibilityRole="button" accessibilityLabel={`Select recent photo ${index + 1}`} onPress={() => reviewPhoto(uri, photos.begin())}><PreviewImage source={{ uri }} cachePolicy="none" style={styles.galleryThumbnail} /></Pressable>)}</View>
            <Button label="Change photo access" variant="secondary" disabled={photoBusy} onPress={() => void choosePrescription(true)} />
          </> : <>
            {Platform.OS === "android" ? <Button label="Take a photo" disabled={photoBusy} onPress={() => void openCamera()} /> : null}
            <Button label="Choose from device" variant="secondary" disabled={photoBusy} onPress={() => void choosePrescription()} />
          </>}
          <Button label="Enter fields manually" variant="ghost" onPress={() => startManual(true)} />
          <Button label="Cancel photo import" variant="ghost" onPress={() => { clearPhoto(); setPhotoState("closed"); }} />
        </View>
      ) : null}
      {photoError ? <Text accessibilityLiveRegion="polite" style={styles.error}>{photoError}</Text> : null}
      {photoState === "review" && photo ? (
        <View style={styles.rxPreview}>
          <View style={styles.rxImage}><PreviewImage accessibilityLabel="Selected prescription photo" source={typeof photo === "string" ? { uri: photo } : photo} cachePolicy="none" contentFit="contain" style={styles.rxImageFill} onLoad={() => setImageReady(true)} onError={() => { setImageReady(false); setReviewConfirmed(false); setPhotoError("This photo could not be read. Try another image or enter the fields manually."); }} /></View>
          <Text style={styles.cardCopy}>{imageReady ? "Image loaded for visual reference only. Enter the fields you can verify." : photoError ? "Preview unavailable" : "Loading selected photo…"}</Text>
          <Button label="Replace or retake photo" variant="secondary" onPress={() => { clearPhoto(); setPhotoState("choose"); setShowForm(false); }} />
          <Button label="Photo unclear? Enter fields manually" variant="ghost" onPress={() => startManual(true)} />
        </View>
      ) : null}
      {showForm ? (
        <View style={styles.formCard}>
          <Text style={styles.sectionTitle}>{photo ? "Review prescription fields" : "New record"}</Text>
          <Text style={styles.label}>Type</Text>
          <View style={styles.chips}>{(["allergy", "condition", "medicine", "visit", "note"] as RecordKind[]).map((value) => <Pressable accessibilityRole="button" accessibilityState={{ selected: kind === value }} key={value} onPress={() => { setKind(value); setReviewConfirmed(false); }} style={[styles.chip, kind === value && styles.chipActive]}><Text style={[styles.chipText, kind === value && styles.chipTextActive]}>{value}</Text></Pressable>)}</View>
          <Field label="Name" value={title} onChangeText={(value) => { setTitle(value); setReviewConfirmed(false); }} placeholder={kind === "allergy" ? "Allergy name" : "Record name"} />
          <Field label="Details" value={detail} onChangeText={(value) => { setDetail(value); setReviewConfirmed(false); }} placeholder="What you know, including schedule or reaction" multiline />
          <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: reviewConfirmed }} onPress={() => setReviewConfirmed((value) => !value)} style={[styles.selectRow, reviewConfirmed && styles.selectRowActive]}>
            <CheckMark checked={reviewConfirmed} /><Text style={styles.cardCopy}>I checked these patient-entered fields against a reliable source.</Text>
          </Pressable>
          {notice ? <Text accessibilityLiveRegion="polite" style={styles.error}>{notice}</Text> : null}
          <Button label="Confirm patient-entered record" disabled={!reviewConfirmed || !title.trim() || !detail.trim() || (photoState === "review" && !imageReady)} onPress={() => void submit()} />
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
    </FormScroll>
  );
}

interface ChatMessage { id: string; role: "patient" | "zoe"; text: string; sources?: string[]; gaps?: string[]; urgent?: boolean; recoveryQuestion?: string; }

function Ask({ records, accountScope, onSearchRecords }: { records: PatientRecord[]; accountScope: string; onSearchRecords: () => void }) {
  const safeInsets = useSafeAreaInsets();
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [focused, setFocused] = useState(false);
  const [draftHeight, setDraftHeight] = useState(48);
  const [turnPending, setTurnPending] = useState(false);
  const scroll = useRef<ScrollViewInstance>(null);
  const followingBottom = useRef(true);
  const previousSources = useRef<string[]>([]);
  const speech = useOfflineSpeechComposer(draft, setDraft);
  const model = useOnDeviceModel(accountScope);
  const runner = useRef(new AssistantRunner(accountScope)).current;

  useEffect(() => () => {
    runner.cancel();
    model.cancel();
  }, [accountScope]);

  useEffect(() => {
    if (messages.length === 0) return;
    const frame = requestAnimationFrame(() => scroll.current?.scrollToEnd({ animated: false }));
    return () => cancelAnimationFrame(frame);
  }, [messages.length]);

  async function send() {
    const question = draft.trim();
    if (!question || turnPending) return;
    speech.updateDraft("");
    setDraftHeight(48);
    const id = messages.length;
    const patientMessage: ChatMessage = { id: `q-${id}`, role: "patient", text: question };
    const answerId = `a-${id}`;
    const plan = planAssistantTurn(question, records, previousSources.current);
    previousSources.current = plan.nextRecordSources;
    followingBottom.current = true;
    setMessages((current) => [...current, patientMessage, {
      id: answerId,
      role: "zoe",
      text: plan.modelPrompt && model.status === "ready" ? "Preparing a grounded answer on this device…" : plan.fallback,
      gaps: plan.gaps,
      urgent: plan.urgent,
      sources: plan.sources.map((source) => `${source.label} · ${source.id}`),
    }]);
    if (!plan.modelPrompt || model.status !== "ready") return;

    setTurnPending(true);
    const result = await runner.run(accountScope, plan, { generate: model.generate, cancel: model.cancel });
    setTurnPending(false);
    if (result.cancelled) {
      setMessages((current) => current.map((message) => message.id === answerId
        ? { ...message, text: plan.fallback, gaps: [...plan.gaps, "Answer stopped. Saved-record result shown."], recoveryQuestion: question }
        : message));
      return;
    }
    setMessages((current) => current.map((message) => message.id === answerId
      ? { ...message, text: result.text, gaps: result.outcome === "generated" || result.outcome === "deterministic" ? plan.gaps : [...plan.gaps, "Extra wording was unavailable. Saved-record result shown."], ...(result.outcome === "failed" || result.outcome === "rejected" ? { recoveryQuestion: question } : {}) }
      : message));
  }

  function cancelTurn() {
    runner.cancel();
    model.cancel();
  }

  const modelStatus = model.status === "unavailable"
    ? "On-device AI needs the Android app. Record lookup still works here."
    : model.status === "downloading"
      ? `Downloading on-device AI · ${model.progress}%`
      : model.status === "verifying"
        ? "Verifying on-device AI…"
      : model.status === "loading"
        ? "Loading on-device AI…"
        : model.status === "generating"
          ? "Preparing answer on this device…"
          : model.status === "ready"
            ? "On-device AI ready · cached for offline use"
            : model.status === "error"
              ? "On-device AI download failed. Record lookup still works."
              : "On-device AI is optional · 483 MB download";

  function followIfPinned() {
    if (followingBottom.current) scroll.current?.scrollToEnd({ animated: false });
  }

  return (
    <KeyboardAvoidingView behavior="padding" keyboardVerticalOffset={Platform.OS === "android" ? safeInsets.top + sessionBarHeight : 0} style={styles.chatPage}>
      <View style={styles.chatHeader}><Header title="Ask Zoe" subtitle="Records, medicines, food, or wellness." /></View>
      <ScrollView ref={scroll} style={styles.chatScroll} keyboardShouldPersistTaps="handled"
        scrollEventThrottle={16}
        onScroll={({ nativeEvent: { contentOffset, contentSize, layoutMeasurement } }) => {
          followingBottom.current = contentSize.height - contentOffset.y - layoutMeasurement.height <= 32;
        }}
        onContentSizeChange={followIfPinned} onLayout={followIfPinned} contentContainerStyle={styles.messages}>
        {messages.length === 0 ? <>
          <View style={styles.chips}>{["What medicines have I saved?", "What are my allergies?", "Estimate my lunch"].map((prompt) => <Pressable key={prompt} accessibilityRole="button" onPress={() => speech.updateDraft(prompt)} style={styles.chip}><Text style={styles.promptText}>{prompt}</Text></Pressable>)}</View>
          <View style={styles.signalHeading}><AppIcon name="shield" size={17} color={colors.moss} /><Text style={styles.promptText}>On-device · Sources shown</Text></View>
          <View style={styles.modelPanel}>
            <Text style={styles.cardCopy}>{modelStatus}</Text>
            {model.status === "idle" ? <Button label="Download on-device AI" variant="secondary" onPress={model.enable} /> : null}
            {model.status === "error" ? <Button label="Retry download" variant="secondary" onPress={model.retry} /> : null}
            {model.status === "downloading" ? <Button label="Cancel download" variant="ghost" onPress={model.cancel} /> : null}
          </View>
        </> : null}
        {messages.map((message) => (
          <View key={message.id} testID={message.role === "zoe" ? "ask-answer" : undefined} accessibilityLiveRegion={message.role === "zoe" ? "polite" : "none"} style={[styles.bubble, message.role === "patient" ? styles.patientBubble : styles.zoeBubble, message.urgent && styles.urgentBubble]}>
            <Text style={styles.bubbleText}>{message.text}</Text>
            {message.sources?.length ? <View style={styles.citation}><Text style={styles.label}>Saved sources</Text>{message.sources.map((source, index) => <Text key={index} style={styles.source}>{source}</Text>)}</View> : null}
            {message.gaps?.map((gap) => <Text key={gap} style={styles.source}>{gap}</Text>)}
            {message.recoveryQuestion ? <View style={styles.recoveryActions}><Button label="Retry answer" variant="secondary" onPress={() => speech.updateDraft(message.recoveryQuestion!)} /><Button label="Search records" variant="ghost" onPress={onSearchRecords} /></View> : null}
          </View>
        ))}
      </ScrollView>
      <View style={styles.composerDock}>
        {messages.length ? <Text style={styles.modelStatus}>{modelStatus}</Text> : null}
        {messages.length && model.status === "idle" ? <Button label="Download on-device AI" variant="ghost" onPress={model.enable} /> : null}
        {messages.length && model.status === "error" ? <Button label="Retry on-device AI download" variant="ghost" onPress={model.retry} /> : null}
        {messages.length && model.status === "downloading" ? <Button label="Cancel AI download" variant="ghost" onPress={model.cancel} /> : null}
        <Text accessibilityLiveRegion="polite" aria-live="polite" style={styles.speechStatus}>{speech.state.message}</Text>
        <View style={[styles.composer, focused && styles.composerFocused]}>
          <TextInput accessibilityLabel="Question" value={draft} onChangeText={speech.updateDraft} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onContentSizeChange={({ nativeEvent }) => setDraftHeight(Math.max(48, Math.min(104, nativeEvent.contentSize.height)))} placeholder={messages.length ? "Ask a follow-up…" : "Ask about your record"} placeholderTextColor={colors.muted} multiline style={[styles.composerInput, { height: draft ? draftHeight : 48 }]} />
          <Pressable accessibilityRole="button" accessibilityLabel={speech.state.listening ? "Finish dictation" : "Dictate question offline"} accessibilityState={{ busy: speech.state.listening, disabled: Platform.OS === "web" }} disabled={Platform.OS === "web"} onPress={() => void speech.toggle()} style={[styles.iconButton, speech.state.listening && styles.selectRowActive, Platform.OS === "web" && styles.disabled]}><AppIcon name={speech.state.listening ? "square" : "mic"} size={20} color={colors.ink} /></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={turnPending ? "Stop on-device answer" : "Send question"} disabled={!turnPending && !draft.trim()} onPress={turnPending ? cancelTurn : () => void send()} style={[styles.sendButton, !turnPending && !draft.trim() && styles.disabled]}><AppIcon name={turnPending ? "square" : "send"} size={20} color={colors.paper} /></Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

function Wellness({ captureGeneration }: { captureGeneration: VaultAccessGeneration }) {
  const [sensor, setSensor] = useState<PresageSensorState>(PresageSensor.unavailableState);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [starting, setStarting] = useState(false);
  const [releaseUnverified, setReleaseUnverified] = useState(false);
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
    const lifecycle = AppState.addEventListener("change", (state) => {
      if (vaultForegroundAction(state) === "lock") captureGeneration.invalidate();
    });
    void PresageSensor.getStatus().then(update).catch(() => {});
    return () => {
      mounted = false;
      captureGeneration.invalidate();
      lifecycle.remove();
      subscription?.remove();
      void PresageSensor.setConsent(false).catch(() => {});
    };
  }, []);

  useEffect(() => {
    if (!running) return undefined;
    const timer = setInterval(() => {
      void PresageSensor.getStatus().then((next) => {
        setSensor(next);
        if (!next.consented) setConsent(false);
      }).catch(() => {});
    }, 1_000);
    return () => clearInterval(timer);
  }, [running]);

  async function toggleConsent() {
    if (busy || releaseBlocked) return;
    if (consent) { await stopCapture(); return; }
    const generation = captureGeneration.invalidate();
    setBusy(true);
    setLocalError("");
    try {
      const next = await PresageSensor.setConsent(true);
      if (!captureGeneration.current(generation)) return;
      setSensor(next);
      setConsent(next.consented);
    } catch {
      if (!captureGeneration.current(generation)) return;
      setConsent(false);
      setLocalError("Camera consent could not be updated.");
    } finally {
      setBusy(false);
    }
  }

  async function startCapture(allowLimited = false) {
    if (!consent || busy || starting || releaseBlocked) return;
    const generation = captureGeneration.invalidate();
    const canContinue = () => captureGeneration.current(generation) && (!AppState.currentState || AppState.currentState === "active");
    setBusy(true);
    setStarting(true);
    setLocalError("");
    try {
      if (Platform.OS !== "android") throw new Error("SmartSpectra capture requires the Android preview build.");
      const permission = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA, {
        title: "Camera for live wellness",
        message: "Zoe uses the front camera in memory to estimate pulse and breathing. Zoe does not save camera frames.",
        buttonPositive: "Allow camera",
        buttonNegative: "Not now",
      });
      if (!canContinue()) return;
      if (permission !== PermissionsAndroid.RESULTS.GRANTED) {
        setLocalError("Camera permission wasn’t granted. No capture started.");
        return;
      }
      const allowed = await PresageSensor.setConsent(true);
      if (!canContinue() || !allowed.consented) return;
      const ready = await PresageSensor.initialize();
      if (!canContinue()) return;
      setSensor(ready);
      if (!ready.ready || (ready.readiness === "limited" && !allowLimited)) return;
      await startIfCurrent(canContinue, async () => {
        const started = await PresageSensor.start();
        if (canContinue()) setSensor(started);
      });
    } catch {
      if (canContinue()) setLocalError("Camera check could not start. Try again.");
    } finally {
      if (captureGeneration.current(generation)) {
        setStarting(false);
        setBusy(false);
      }
    }
  }

  async function stopCapture() {
    const generation = captureGeneration.invalidate();
    setStarting(false);
    setBusy(true);
    setLocalError("");
    setConsent(false);
    setReleaseUnverified(true);
    try {
      const next = await withDeadline<PresageSensorState | null>(PresageSensor.setConsent(false), 4_000, null);
      if (!captureGeneration.current(generation)) return;
      if (next) setSensor(next);
      if (next && !next.consented && next.status !== "starting" && next.status !== "running" && next.errorCode !== "camera_release_failed") {
        setReleaseUnverified(false);
      }
    } catch {
      if (captureGeneration.current(generation)) setLocalError("Camera release could not be verified.");
    } finally {
      if (captureGeneration.current(generation)) setBusy(false);
    }
  }

  const releaseBlocked = releaseUnverified || sensor.errorCode === "camera_release_failed";
  const showStableValues = consent && !starting && !releaseBlocked && sensor.status === "running" && sensor.fresh && sensor.quality === "stable" && sensor.validation === "ok";
  const available = sensor.linked && sensor.configured;
  const readinessHelp = sensor.readinessCategory === "camera-unavailable"
    ? "Check camera permission and close other apps using the camera."
    : sensor.readinessCategory === "setup-or-connection"
      ? "Check your connection and try again."
      : sensor.readinessCategory === "device-capability"
        ? "Try another Android device."
        : null;
  const readinessCopy = sensor.readiness === "limited"
    ? "The device check found limits. You can continue. Zoe will show only stable readings."
    : sensor.readiness === "blocked"
      ? readinessHelp ?? "The device check blocked capture. Close other apps using the camera and retry."
      : sensor.readiness === "inconclusive"
        ? readinessHelp ?? "The device check couldn’t finish with a clear result. Try again."
        : null;
  const statusLabel = !available
    ? "Unavailable in this build"
    : releaseBlocked
      ? "Camera release unverified"
      : starting
        ? "Preparing camera check…"
        : running
          ? "Camera check in progress"
          : consent && sensor.readiness === "limited"
            ? "Limited readiness"
            : consent && sensor.readiness === "blocked"
              ? "Readiness check blocked capture"
              : consent && sensor.readiness === "inconclusive"
                ? "Readiness check inconclusive"
                : consent ? "Ready to check" : "Waiting for permission";
  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Header title="Wellness reading" subtitle="Your front camera estimates pulse and breathing. These readings are for general wellness." />
      <View style={styles.consentCard}>
        <View style={styles.wellnessIcon}><AppIcon name="camera" size={26} color={colors.ink} /></View>
        <Text style={styles.sectionTitle}>Before you start</Text>
        <Text style={styles.cardCopy}>Camera use · Only during this check</Text>
        <Text style={styles.cardCopy}>Video frames · Processed in memory. Zoe does not save camera frames.</Text>
        <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: consent, disabled: busy || !available || releaseBlocked }} disabled={busy || !available || releaseBlocked} onPress={() => void toggleConsent()} style={[styles.selectRow, consent && styles.selectRowActive]}>
          <CheckMark checked={consent} animate /><Text style={styles.cardCopy}>Allow camera use for this wellness check.</Text>
        </Pressable>
        <View style={styles.statusPanel}>
          <Text style={styles.cardTitle}>{statusLabel}</Text>
          {!available ? <Text style={styles.cardCopy}>Live readings aren’t available in this version of Zoe.</Text> : null}
          {releaseBlocked ? <Text accessibilityLiveRegion="polite" style={styles.cardCopy}>Another check is blocked until Zoe verifies the camera has stopped.</Text> : null}
          {consent && !starting && !running && !releaseBlocked && readinessCopy ? <Text accessibilityLiveRegion="polite" style={styles.cardCopy}>{readinessCopy}</Text> : null}
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: showTechnical }} accessibilityLabel="Technical details" aria-expanded={showTechnical} onPress={() => setShowTechnical((visible) => !visible)} style={styles.technicalToggle}><AppIcon name={showTechnical ? "chevron-up" : "chevron-down"} size={18} color={colors.ink} /><Text style={styles.technicalToggleText}>Technical details</Text></Pressable>
          {showTechnical ? <Text style={styles.technicalDetail}>Status {sensor.status} · readiness {sensor.readinessStage ?? "not-checked"} · verdict {sensor.readiness}{sensor.readinessCategory ? ` · category ${sensor.readinessCategory}` : ""} · signal {sensor.quality}{sensor.validation ? ` · validation ${sensor.validation}` : ""} · SDK telemetry off</Text> : null}
        </View>
        {localError ? <Text style={styles.error}>{localError}</Text> : null}
        {starting
          ? <Button label="Cancel camera check" variant="secondary" onPress={() => void stopCapture()} />
          : releaseBlocked
            ? <Button label="Retry camera release" variant="secondary" disabled={busy} onPress={() => void stopCapture()} />
            : running
              ? <Button label="Stop camera check" variant="secondary" disabled={busy} onPress={() => void stopCapture()} />
              : <Button label={sensor.ready && sensor.readiness === "limited" ? "Continue limited check" : readinessCopy ? "Retry readiness check" : "Start camera check"} disabled={!consent || busy || !available} onPress={() => void startCapture(sensor.ready && sensor.readiness === "limited")} />}
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
  const [covered, setCovered] = useState(() => shouldCoverVault(AppState.currentState ?? "active", true));

  useEffect(() => {
    let appState = AppState.currentState ?? "active";
    let focused = true;
    const update = () => setCovered(shouldCoverVault(appState, focused));
    const state = AppState.addEventListener("change", (next) => { appState = next; update(); });
    const blur = Platform.OS === "android" ? AppState.addEventListener("blur", () => { focused = false; update(); }) : undefined;
    const focus = Platform.OS === "android" ? AppState.addEventListener("focus", () => { focused = true; update(); }) : undefined;
    return () => { state.remove(); blur?.remove(); focus?.remove(); };
  }, []);

  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <SafeAreaView style={styles.shell}>
        <StatusBar style="dark" />
        <View style={styles.flex} pointerEvents={covered ? "none" : "auto"} accessibilityElementsHidden={covered} importantForAccessibility={covered ? "no-hide-descendants" : "auto"} aria-hidden={covered}>
          <PatientAuthProvider>{(auth) => <PatientApp auth={auth} />}</PatientAuthProvider>
        </View>
        {covered ? <View accessible style={styles.privacyCover} accessibilityLabel="Zoe is hidden while another window is active." /> : null}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function PatientApp({ auth }: { auth: PatientAuth }) {
  const { width } = useWindowDimensions();
  const expanded = width >= 760;
  const [access, setAccess] = useState<AccessState>("intro");
  const [screen, setScreen] = useState<Screen>("home");
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [records, setRecords] = useState<PatientRecord[]>([]);
  const [vault, setVault] = useState<Vault | null>(null);
  const [userId, setUserId] = useState("");
  const [error, setError] = useState("");
  const [pendingAccess, setPendingAccess] = useState<{ accountId: string; session: PatientIdentity | null; setup: boolean; recoverLegacy: boolean } | null>(null);
  const [migrationRecoveryRequired, setMigrationRecoveryRequired] = useState(false);
  const vaultTarget = useRef<VaultTarget | null>(null);
  const accessGeneration = useRef(new VaultAccessGeneration()).current;
  const captureGeneration = useRef(new VaultAccessGeneration()).current;
  const activeVault = useRef<Vault | null>(null);
  const vaultOperation = useRef(false);
  const signingOut = useRef(false);
  const sessionScope = patientSessionScope(auth.identity);
  const appliedSessionScope = useRef("");
  const closingVault = useRef<Promise<void>>(Promise.resolve());
  const finishIntro = useCallback(() => setAccess((current) => current === "intro" ? "login" : current), []);
  const closeWellnessSession = useCallback(() => {
    captureGeneration.invalidate();
    if (PresageSensor.available) void PresageSensor.setConsent(false).catch(() => {});
  }, [captureGeneration]);
  const navigate = useCallback((next: Screen) => {
    if (screen === "wellness" && next !== "wellness") closeWellnessSession();
    setScreen(next);
  }, [closeWellnessSession, screen]);

  useEffect(() => {
    if (Platform.OS !== "android") return;
    const show = Keyboard.addListener("keyboardDidShow", () => setKeyboardVisible(true));
    const hide = Keyboard.addListener("keyboardDidHide", () => setKeyboardVisible(false));
    return () => { show.remove(); hide.remove(); };
  }, []);

  async function unlock(accountId: string, session: PatientIdentity | null = null, options: VaultOpenOptions = {}, devicePreview = false) {
    if (AppState.currentState && AppState.currentState !== "active") return;
    if ((session && (signingOut.current || !auth.canUseSession?.(session))) || !canOpenPatientVault(accountId, session, appliedSessionScope.current)) return;
    if (vaultOperation.current) { setError("A vault operation is finishing. Try again shortly."); return; }
    vaultOperation.current = true;
    vaultTarget.current = { accountId, session, devicePreview };
    const generation = accessGeneration.invalidate();
    const isCurrent = () => accessGeneration.current(generation) && (!session || auth.canUseSession?.(session) === true);
    setAccess("unlocking");
    setError("");
    let candidate: Vault | null = null;
    try {
      await closingVault.current;
      if (!await photoCleanup) throw new Error("Could not clear old photo copies. Restart Zoe before opening your vault.");
      if (!isCurrent()) return;
      if (session) {
        const verdict = await auth.verifySession?.(session);
        if (!isCurrent()) return;
        if (verdict !== "active" && verdict !== "offline") {
          setError("Could not check your sign-in. Connect and try again.");
          setAccess("locked");
          return;
        }
      }
      const opened = await (devicePreview ? openSyntheticPreviewVault() : openVault(accountId, options));
      if (!isCurrent()) { await lockThenClear(() => opened.lock(), () => {}); return; }
      candidate = opened;
      const saved = await opened.loadRecords();
      if (!isCurrent()) { await lockThenClear(() => opened.lock(), () => {}); return; }
      const initial = recordsForOpenedVault(saved, session === null, opened.isNew, SYNTHETIC_RECORDS);
      if (opened.isNew && initial.length > 0) await opened.saveRecords(initial);
      if (!isCurrent()) { await lockThenClear(() => opened.lock(), () => {}); return; }
      activeVault.current = opened;
      setVault(opened);
      setPendingAccess(null);
      setUserId(accountId);
      setRecords(initial);
      setAccess("ready");
    } catch (caught) {
      if (candidate) await lockThenClear(() => candidate!.lock(), () => {});
      if (!isCurrent()) return;
      const message = caught instanceof VaultAccessError ? caught.message : "The vault could not open.";
      setError(message);
      if (caught instanceof VaultAccessError && caught.reason === "legacy_recovery_required") {
        setPendingAccess({ accountId, session, setup: false, recoverLegacy: true });
        setAccess("legacy");
      } else if (caught instanceof VaultAccessError && (caught.reason === "setup_required" || caught.reason === "passphrase_required" || caught.reason === "invalid_passphrase")) {
        setPendingAccess({ accountId, session, setup: caught.reason === "setup_required" || options.setupPassphrase === true, recoverLegacy: options.recoverLegacy === true });
        setAccess("passphrase");
      } else {
        setAccess("locked");
      }
    } finally { vaultOperation.current = false; }
  }

  const lockVault = useCallback(async (clearTarget = false) => {
      accessGeneration.invalidate();
      closeWellnessSession();
      const opened = activeVault.current;
      activeVault.current = null;
      setVault(null);
      setRecords([]);
      if (clearTarget) {
        vaultTarget.current = null;
        setUserId("");
      }
      setPendingAccess(null);
      setMigrationRecoveryRequired(false);
      setError("");
      setScreen("home");
      setAccess(vaultTarget.current ? "locked" : "login");
      if (opened) {
        closingVault.current = lockThenClear(() => opened.lock(), () => {});
        await closingVault.current;
      }
  }, [accessGeneration, closeWellnessSession]);

  useLayoutEffect(() => {
    if (sessionScope === appliedSessionScope.current) return;
    appliedSessionScope.current = sessionScope;
    const expected = auth.identity;
    void (async () => {
      await lockVault(true);
      if (!expected || patientSessionScope(expected) !== appliedSessionScope.current || !auth.canUseSession?.(expected)) return;
      vaultTarget.current = { accountId: expected.accountId, session: expected, devicePreview: false };
      await unlock(expected.accountId, expected);
    })();
  }, [auth.identity, lockVault, sessionScope]);

  async function signOutOfZoe() {
    if (!auth.signOut || signingOut.current) return;
    const scope = appliedSessionScope.current;
    signingOut.current = true;
    void lockVault(true);
    try {
      await auth.signOut();
    } catch {
      const currentScope = appliedSessionScope.current;
      if (currentScope === scope || currentScope === "") setError("Could not sign out. Your vault is locked. Try again.");
    } finally {
      signingOut.current = false;
    }
  }

  async function migrateVault(passphrase: string) {
    if (vaultOperation.current) return;
    vaultOperation.current = true;
    try {
      await runMigration(passphrase);
    } finally { vaultOperation.current = false; }
  }

  async function runMigration(passphrase: string) {
    const generation = accessGeneration.invalidate();
    const session = vaultTarget.current?.session;
    const isCurrent = () => accessGeneration.current(generation) && (!session || auth.canUseSession?.(session) === true);
    if (!isCurrent()) return;
    if (migrationRecoveryRequired) {
      setAccess("unlocking");
      setError("");
      let reopened: Vault | null = null;
      try {
        reopened = await openVault(userId, { passphrase });
        if (!isCurrent()) { await lockThenClear(() => reopened!.lock(), () => {}); return; }
        const saved = await reopened.loadRecords();
        if (!isCurrent()) { await lockThenClear(() => reopened!.lock(), () => {}); return; }
        activeVault.current = reopened;
        setVault(reopened);
        setRecords(saved);
        setMigrationRecoveryRequired(false);
        setAccess("ready");
      } catch (caught) {
        if (reopened) await lockThenClear(() => reopened!.lock(), () => {});
        if (!isCurrent()) return;
        setError(caught instanceof VaultAccessError ? caught.message : "Vault migration recovery failed. Try entering the same passphrase again.");
        setAccess("migration");
      }
      return;
    }
    if (!vault?.migrateToPassphrase) { setError("This vault cannot be migrated in its current state."); return; }
    setAccess("unlocking");
    setError("");
    try {
      const migrated = await vault.migrateToPassphrase(passphrase);
      if (!isCurrent()) { await lockThenClear(() => migrated.lock(), () => {}); return; }
      activeVault.current = migrated;
      setVault(migrated);
      setMigrationRecoveryRequired(false);
      setAccess("ready");
    } catch (caught) {
      if (!isCurrent()) return;
      const recoveryRequired = migrationRequiresCompletion(caught);
      setError(caught instanceof VaultAccessError ? caught.message : "Vault migration failed. Try again.");
      setMigrationRecoveryRequired(recoveryRequired);
      if (recoveryRequired) {
        activeVault.current = null;
        setVault(null);
        setRecords([]);
      }
      setAccess("migration");
    }
  }

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      const action = vaultForegroundAction(nextState);
      if (action === "lock") void lockVault();
      if (action === "show" && auth.identity && auth.verifySession) {
        const expected = auth.identity;
        void auth.verifySession(expected).then((verdict) => {
          if (patientSessionScope(expected) !== appliedSessionScope.current) return;
          if (canAutoReopenPatientVault(expected, appliedSessionScope.current, verdict, auth.canUseSession?.(expected) === true)) {
            void unlock(expected.accountId, expected);
            return;
          }
          void lockVault();
          setError(verdict === "unavailable" ? "Could not check your sign-in. Connect and try again." : "Your sign-in ended. Sign in again to open records.");
        });
      }
    });
    return () => subscription.remove();
  }, [auth.identity, auth.verifySession, lockVault]);

  async function saveRecord(record: PatientRecord) {
    const session = vaultTarget.current?.session;
    const canWrite = () => activeVault.current === vault && (!session || auth.canUseSession?.(session) === true);
    if (!vault || !canWrite()) throw new Error("Vault is locked.");
    const next = [record, ...records];
    await vault.saveRecords(next);
    if (canWrite()) setRecords(next);
  }

  const body = useMemo(() => {
    if (screen === "records") return <Records records={records} onSave={saveRecord} />;
    if (screen === "ask") return <Ask key={userId} records={records} accountScope={userId} onSearchRecords={() => navigate("records")} />;
    if (screen === "wellness") return <Wellness captureGeneration={captureGeneration} />;
    return <Home records={records} setScreen={navigate} vaultMode={vault?.mode ?? "web-preview"} syntheticPreview={!auth.identity} />;
  }, [auth.canUseSession, auth.identity, captureGeneration, navigate, records, screen, userId, vault]);

  if (sessionScope !== appliedSessionScope.current) return <View style={styles.loading} />;
  const accountHint = auth.identity?.email ? maskAccountEmail(auth.identity.email) : "Patient account";
  if (access === "intro") return <Intro onDone={finishIntro} />;
  if (access === "login") return <Login onPreview={() => void unlock("synthetic-device-preview-v1", null, {}, true)} onLegacyPreview={() => void unlock("synthetic-patient-a")} onSignOut={() => void signOutOfZoe()} auth={auth} error={error} />;
  if (access === "locked" && vaultTarget.current) {
    const target = vaultTarget.current;
    return <ScrollView contentContainerStyle={styles.accessPage}><View style={styles.loginCard}>
      <Text accessibilityRole="header" style={styles.sectionTitle}>{target.session ? "Private records closed" : "Vault locked"}</Text>
      <Text style={styles.supporting}>{target.session ? `Signed in · ${accountHint}` : "Synthetic preview"}</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Button label={target.session ? "Open records" : "Unlock vault"} onPress={() => void unlock(target.accountId, target.session, {}, target.devicePreview)} />
      <Button label={target.session ? "Sign out" : "Back to sign-in"} variant="ghost" onPress={() => void (target.session ? signOutOfZoe() : lockVault(true))} />
    </View></ScrollView>;
  }
  if (access === "legacy" && pendingAccess) return <ScrollView contentContainerStyle={styles.accessPage}><View style={styles.loginCard}>
    <Text accessibilityRole="header" style={styles.sectionTitle}>Previous vault found</Text>
    <Text style={styles.supporting}>Your older encrypted vault is unchanged. Recover it with its original passphrase or biometric credential.</Text>
    {error ? <Text style={styles.error}>{error}</Text> : null}
    <Button label="Recover previous vault" onPress={() => void unlock(pendingAccess.accountId, pendingAccess.session, { recoverLegacy: true })} />
    <Button label="Sign out" variant="ghost" onPress={() => void signOutOfZoe()} />
  </View></ScrollView>;
  if (access === "passphrase" && pendingAccess) return <PassphraseAccess accountId={pendingAccess.accountId} accountHint={pendingAccess.session ? accountHint : undefined} setup={pendingAccess.setup} error={error} onSubmit={(passphrase) => void unlock(pendingAccess.accountId, pendingAccess.session, { passphrase, setupPassphrase: pendingAccess.setup, recoverLegacy: pendingAccess.recoverLegacy })} onCancel={() => pendingAccess.session ? setAccess("legacy") : void lockVault()} />;
  if (access === "migration") return <PassphraseAccess accountId={userId} accountHint={auth.identity ? accountHint : undefined} setup={!migrationRecoveryRequired} error={error} onSubmit={(passphrase) => void migrateVault(passphrase)} cancelLabel={migrationRecoveryRequired ? "Lock vault" : "Back"} onCancel={() => {
    if (migrationBackAction(migrationRecoveryRequired) === "sign-out") { void lockVault(); return; }
    setError("");
    setAccess("ready");
  }} />;
  if (access === "unlocking") return <View style={styles.loading}><ActivityIndicator size="large" color={colors.moss} /><Text style={styles.cardCopy}>Opening private vault…</Text></View>;
  return (
    <View style={styles.shell}>
      <View style={styles.sessionBar}><Text numberOfLines={1} style={styles.sessionLabel}>{auth.identity ? `Signed in · ${accountHint}` : "Synthetic preview"}</Text><View style={styles.sessionActions}>{vault?.protection === "biometric" ? <Pressable accessibilityRole="button" style={styles.sessionButton} onPress={() => { setError(""); setMigrationRecoveryRequired(false); setAccess("migration"); }}><Text style={styles.lockText}>Use passphrase</Text></Pressable> : null}{auth.identity ? <Pressable accessibilityRole="button" accessibilityLabel="Sign out" style={styles.sessionButton} onPress={() => void signOutOfZoe()}><AppIcon name="log-out" size={15} color={colors.ink} /><Text style={styles.lockText}>Sign out</Text></Pressable> : <Pressable accessibilityRole="button" accessibilityLabel="Lock synthetic preview" style={styles.sessionButton} onPress={() => void lockVault()}><AppIcon name="lock" size={15} color={colors.ink} /><Text style={styles.lockText}>Lock preview</Text></Pressable>}</View></View>
      <View style={styles.appFrame}>
        {expanded ? <Navigation screen={screen} setScreen={navigate} expanded /> : null}
        <View style={styles.content}>{body}</View>
      </View>
      {!expanded && !(keyboardVisible && (screen === "ask" || screen === "records")) ? <Navigation screen={screen} setScreen={navigate} expanded={false} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: colors.cream },
  privacyCover: { ...StyleSheet.absoluteFill, backgroundColor: colors.cream },
  appFrame: { flex: 1, flexDirection: "row", minWidth: 0 },
  content: { flex: 1, minWidth: 0 },
  flex: { flex: 1, minWidth: 0, minHeight: 0 },
  intro: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.cream, padding: 32 },
  introMark: { width: 170, height: 170 },
  introWord: { fontSize: 44, lineHeight: 50, fontWeight: "700", color: colors.ink, letterSpacing: -1, marginTop: -18 },
  introTagline: { color: colors.muted, fontSize: 16, lineHeight: 24, marginTop: 8 },
  accessPage: { flexGrow: 1, backgroundColor: colors.cream, alignItems: "center", justifyContent: "center", padding: 16 },
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
  button_primary: { backgroundColor: colors.ink },
  button_secondary: { backgroundColor: colors.accent },
  button_ghost: { backgroundColor: "transparent", borderColor: colors.line, borderWidth: 1 },
  buttonText: { color: colors.paper, fontWeight: "700", fontSize: 15 },
  buttonTextDark: { color: colors.ink },
  pressed: { opacity: 0.78, transform: [{ scale: 0.99 }] },
  disabled: { opacity: 0.5 },
  page: { padding: 16, paddingBottom: 32, width: "100%", maxWidth: 760, alignSelf: "center", gap: 16 },
  header: { gap: 6, marginBottom: 4 },
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
  input: { minHeight: 48, backgroundColor: colors.paper, borderColor: colors.line, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, color: colors.ink, fontSize: 15 },
  multiline: { minHeight: 96, maxHeight: 144, textAlignVertical: "top" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { minHeight: 48, borderRadius: 24, backgroundColor: colors.paper, borderColor: colors.line, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 10, justifyContent: "center" },
  chipActive: { backgroundColor: colors.ink, borderColor: colors.ink },
  chipText: { color: colors.muted, textTransform: "capitalize", fontSize: 14 },
  chipTextActive: { color: colors.paper },
  recordCard: { backgroundColor: colors.paper, padding: 14, borderColor: colors.line, borderWidth: 1, borderRadius: 15, gap: 5 },
  recordTop: { flexDirection: "row", justifyContent: "space-between", gap: 10, flexWrap: "wrap" },
  kind: { color: colors.moss, fontWeight: "700", textTransform: "capitalize", fontSize: 14 },
  source: { color: colors.muted, fontSize: 14, lineHeight: 19 },
  date: { color: colors.muted, fontSize: 14, lineHeight: 19, marginTop: 4 },
  rxPreview: { backgroundColor: colors.paper, borderRadius: 16, padding: 12, borderColor: colors.line, borderWidth: 1, gap: 8 },
  rxImage: { height: 250, backgroundColor: "#E7EAE0", borderRadius: 12, overflow: "hidden" },
  rxImageFill: { width: "100%", height: "100%", borderRadius: 10 },
  galleryThumbnail: { width: 82, height: 82, borderRadius: 8, backgroundColor: colors.mint },
  chatPage: { flex: 1, width: "100%", maxWidth: 760, alignSelf: "center", minWidth: 0 },
  chatHeader: { paddingHorizontal: 16, paddingTop: 18 },
  chatScroll: { flex: 1 },
  liveAnnouncement: { position: "absolute", width: 1, height: 1, overflow: "hidden", opacity: 0 },
  messages: { padding: 16, gap: 12 },
  promptText: { color: colors.ink, fontSize: 14, fontWeight: "600" },
  modelPanel: { backgroundColor: colors.paper, borderColor: colors.line, borderWidth: 1, borderRadius: 14, padding: 12, gap: 8 },
  bubble: { maxWidth: "92%", padding: 14, borderRadius: 16, gap: 8 },
  zoeBubble: { alignSelf: "flex-start", backgroundColor: "#E7EDE4", borderColor: colors.line, borderWidth: 1, borderBottomLeftRadius: 5 },
  patientBubble: { alignSelf: "flex-end", backgroundColor: "#DAE8CD", borderBottomRightRadius: 5 },
  urgentBubble: { backgroundColor: colors.urgent, borderColor: colors.danger },
  bubbleText: { color: colors.ink, fontSize: 15, lineHeight: 22 },
  citation: { borderTopColor: colors.line, borderTopWidth: 1, paddingTop: 8, gap: 4 },
  recoveryActions: { gap: 6, paddingTop: 6 },
  composerDock: { paddingHorizontal: 12, paddingBottom: 12, paddingTop: 4, gap: 5, flexShrink: 0 },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: 5, padding: 5, backgroundColor: colors.paper, borderColor: colors.line, borderWidth: 1, borderRadius: 16, minWidth: 0 },
  composerFocused: { borderColor: colors.moss },
  composerInput: { flex: 1, minWidth: 0, minHeight: 48, paddingHorizontal: 8, paddingVertical: 10, color: colors.ink, fontSize: 15, textAlignVertical: "top" },
  iconButton: { width: 48, height: 48, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: colors.mint, flexShrink: 0 },
  sendButton: { width: 48, height: 48, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: colors.ink, flexShrink: 0 },
  speechStatus: { color: colors.muted, fontSize: 14, lineHeight: 20, paddingHorizontal: 4 },
  modelStatus: { color: colors.muted, fontSize: 13, lineHeight: 18, paddingHorizontal: 4 },
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
  sessionBar: { minHeight: sessionBarHeight, paddingHorizontal: 8, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 6, backgroundColor: colors.mint, borderBottomColor: colors.line, borderBottomWidth: 1 },
  sessionLabel: { flex: 1, minWidth: 0, color: colors.muted, fontSize: 14, lineHeight: 20 },
  sessionActions: { flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 0 },
  sessionButton: { minHeight: 48, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: 10 },
  lockText: { color: colors.ink, fontWeight: "700", fontSize: 14 },
  nav: { flexDirection: "row", backgroundColor: "#F9FAF5", borderTopColor: colors.line, borderTopWidth: 1, minHeight: 68, padding: 4, gap: 3 },
  navRail: { width: 112, flexDirection: "column", borderTopWidth: 0, borderRightColor: colors.line, borderRightWidth: 1, padding: 8, gap: 4 },
  navItem: { flex: 1, minWidth: 0, minHeight: 64, alignItems: "center", justifyContent: "center", gap: 3, borderRadius: 12, paddingHorizontal: 2 },
  navRailItem: { flexGrow: 0, flexBasis: 64, width: "100%", paddingHorizontal: 8 },
  navItemActive: { backgroundColor: colors.accent },
  navLabel: { color: colors.muted, fontSize: 14, lineHeight: 18, fontWeight: "600" },
  navActive: { color: colors.ink, fontWeight: "800" },
  loading: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.cream, gap: 14 }
});
