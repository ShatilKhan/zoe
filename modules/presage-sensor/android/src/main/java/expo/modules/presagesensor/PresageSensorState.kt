package expo.modules.presagesensor

import java.time.Instant

internal data class PresageMetricReading(
  val value: Double,
  val stable: Boolean,
  val confidence: Double,
  val timestampMicros: Long,
)

internal data class PresageSensorSnapshot(
  val linked: Boolean = true,
  val configured: Boolean = false,
  val initialized: Boolean = false,
  val consented: Boolean = false,
  val permissionGranted: Boolean = false,
  val ready: Boolean = false,
  val readiness: String = "unchecked",
  val status: String = "unconfigured",
  val quality: String = "acquiring",
  val fresh: Boolean = false,
  val capturedAt: String? = null,
  val pulseRate: Double? = null,
  val pulseConfidence: Double? = null,
  val breathingRate: Double? = null,
  val breathingConfidence: Double? = null,
  val validation: String? = null,
  val reason: String? = null,
  val errorCode: String? = null,
  val retryable: Boolean = false,
) {
  fun toMap(): Map<String, Any?> = mapOf(
    "linked" to linked,
    "configured" to configured,
    "initialized" to initialized,
    "consented" to consented,
    "permissionGranted" to permissionGranted,
    "ready" to ready,
    "readiness" to readiness,
    "status" to status,
    "quality" to quality,
    "fresh" to fresh,
    "capturedAt" to capturedAt,
    "pulseRate" to pulseRate,
    "pulseConfidence" to pulseConfidence,
    "breathingRate" to breathingRate,
    "breathingConfidence" to breathingConfidence,
    "validation" to validation,
    "reason" to reason,
    "errorCode" to errorCode,
    "retryable" to retryable,
  )
}

internal class PresageSensorStateMachine(
  private val nowMillis: () -> Long = System::currentTimeMillis,
) {
  companion object {
    private const val MAX_SAMPLE_AGE_MILLIS = 15_000L
    private const val MAX_FUTURE_SKEW_MILLIS = 5_000L
  }

  var snapshot = PresageSensorSnapshot(reason = "SmartSpectra requires a secure PRESAGE_API_KEY build input.")
    private set
  private var acceptedOldestTimestampMicros: Long? = null

  fun keyAvailable(permissionGranted: Boolean) {
    snapshot = snapshot.copy(
      configured = true,
      initialized = false,
      permissionGranted = permissionGranted,
      status = "consent-required",
      reason = "Explicit camera consent is required before SmartSpectra initializes.",
      errorCode = null,
      retryable = false,
    )
  }

  fun consent(granted: Boolean) {
    if (!granted) {
      clearMeasurements(
        quality = "acquiring",
        snapshot = snapshot.copy(
          consented = false,
          ready = false,
          status = if (snapshot.configured) "consent-required" else "unconfigured",
          reason = if (snapshot.configured) "Camera consent was withdrawn." else snapshot.reason,
        ),
      )
      return
    }
    snapshot = snapshot.copy(
      consented = true,
      ready = false,
      status = when {
        !snapshot.configured -> "unconfigured"
        !snapshot.permissionGranted -> "permission-required"
        else -> "idle"
      },
      reason = when {
        !snapshot.configured -> snapshot.reason
        !snapshot.permissionGranted -> "Camera permission is required before readiness or capture."
        else -> null
      },
      errorCode = null,
      retryable = false,
    )
  }

  fun initialized(permissionGranted: Boolean) {
    snapshot = snapshot.copy(
      configured = true,
      initialized = true,
      permissionGranted = permissionGranted,
      status = if (permissionGranted && snapshot.consented) "idle" else if (snapshot.consented) "permission-required" else "consent-required",
      reason = if (permissionGranted) null else "Camera permission is required before readiness or capture.",
      errorCode = null,
      retryable = false,
    )
  }

  fun permission(permissionGranted: Boolean) {
    if (!snapshot.configured) {
      snapshot = snapshot.copy(
        permissionGranted = permissionGranted,
        ready = false,
      )
      return
    }
    snapshot = snapshot.copy(
      permissionGranted = permissionGranted,
      status = when {
        !snapshot.consented -> "consent-required"
        permissionGranted -> snapshot.status.takeUnless { it == "permission-required" } ?: "idle"
        else -> "permission-required"
      },
      ready = if (permissionGranted) snapshot.ready else false,
      reason = if (permissionGranted) snapshot.reason.takeUnless { it?.contains("permission", ignoreCase = true) == true } else "Camera permission is required before readiness or capture.",
    )
  }

  fun readiness(verdict: String, reason: String?) {
    val normalized = verdict.lowercase()
    val isReady = normalized == "ready" || normalized == "limited"
    snapshot = snapshot.copy(
      readiness = normalized,
      ready = isReady && snapshot.permissionGranted && snapshot.consented,
      reason = reason?.takeIf { it.isNotBlank() },
      errorCode = null,
      retryable = false,
    )
  }

  fun processing(status: String) {
    val normalized = status.lowercase()
    val next = snapshot.copy(
      status = normalized,
      reason = if (normalized == "running") null else snapshot.reason,
      errorCode = if (normalized == "running") null else snapshot.errorCode,
    )
    if (normalized != "running") {
      clearMeasurements("acquiring", next)
    } else {
      snapshot = next
    }
  }

  fun validation(code: String?, hint: String?) {
    val normalized = code?.lowercase()
    val next = snapshot.copy(
      validation = normalized,
      reason = hint?.takeIf { it.isNotBlank() },
    )
    if (normalized != "ok") {
      clearMeasurements(if (normalized == null) "acquiring" else "poor", next)
    } else {
      snapshot = next
    }
  }

  fun metrics(pulse: PresageMetricReading?, breathing: PresageMetricReading?) {
    val freshPulse = pulse?.takeIf(::isFresh)
    val freshBreathing = breathing?.takeIf(::isFresh)
    if (snapshot.status != "running" || !snapshot.consented || snapshot.validation != "ok" || freshPulse == null || freshBreathing == null || !freshPulse.stable || !freshBreathing.stable) {
      val receivedSignal = pulse != null || breathing != null
      clearMeasurements(if (receivedSignal) "poor" else "acquiring")
      return
    }
    val oldestTimestamp = minOf(freshPulse.timestampMicros, freshBreathing.timestampMicros)
    val newestTimestamp = maxOf(freshPulse.timestampMicros, freshBreathing.timestampMicros)
    acceptedOldestTimestampMicros = oldestTimestamp
    snapshot = snapshot.copy(
      quality = "stable",
      fresh = true,
      capturedAt = microsToIso(newestTimestamp),
      pulseRate = freshPulse.value,
      pulseConfidence = freshPulse.confidence,
      breathingRate = freshBreathing.value,
      breathingConfidence = freshBreathing.confidence,
    )
  }

  fun expireStale() {
    val oldestTimestamp = acceptedOldestTimestampMicros ?: return
    val age = nowMillis() - (oldestTimestamp / 1_000L)
    if (age > MAX_SAMPLE_AGE_MILLIS || age < -MAX_FUTURE_SKEW_MILLIS) {
      clearMeasurements("acquiring")
    }
  }

  fun error(code: String, message: String, retryable: Boolean) {
    acceptedOldestTimestampMicros = null
    snapshot = snapshot.copy(
      ready = false,
      status = "error",
      quality = "poor",
      fresh = false,
      capturedAt = null,
      pulseRate = null,
      pulseConfidence = null,
      breathingRate = null,
      breathingConfidence = null,
      reason = message,
      errorCode = code.lowercase(),
      retryable = retryable,
    )
  }

  fun stopped(reason: String) {
    acceptedOldestTimestampMicros = null
    snapshot = snapshot.copy(
      status = "stopped",
      quality = "acquiring",
      fresh = false,
      capturedAt = null,
      pulseRate = null,
      pulseConfidence = null,
      breathingRate = null,
      breathingConfidence = null,
      reason = reason,
      errorCode = null,
      retryable = false,
    )
  }

  private fun isFresh(reading: PresageMetricReading): Boolean {
    if (!reading.value.isFinite() || reading.value <= 0.0 || reading.timestampMicros <= 0L) return false
    val age = nowMillis() - (reading.timestampMicros / 1_000L)
    return age <= MAX_SAMPLE_AGE_MILLIS && age >= -MAX_FUTURE_SKEW_MILLIS
  }

  private fun clearMeasurements(quality: String, snapshot: PresageSensorSnapshot = this.snapshot) {
    acceptedOldestTimestampMicros = null
    this.snapshot = snapshot.copy(
      quality = quality,
      fresh = false,
      capturedAt = null,
      pulseRate = null,
      pulseConfidence = null,
      breathingRate = null,
      breathingConfidence = null,
    )
  }

  private fun microsToIso(micros: Long): String {
    val seconds = Math.floorDiv(micros, 1_000_000L)
    val microsRemainder = Math.floorMod(micros, 1_000_000L)
    return Instant.ofEpochSecond(seconds, microsRemainder * 1_000L).toString()
  }
}
