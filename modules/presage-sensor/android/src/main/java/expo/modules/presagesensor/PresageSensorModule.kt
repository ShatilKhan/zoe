package expo.modules.presagesensor

import android.Manifest
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import androidx.lifecycle.Observer
import com.presagetech.smartspectra.CameraSelection
import com.presagetech.smartspectra.ProcessingStatus
import com.presagetech.smartspectra.SmartSpectraConfig
import com.presagetech.smartspectra.SmartSpectraError
import com.presagetech.smartspectra.SmartSpectraSdk
import com.presagetech.smartspectra.ValidationStatus
import com.presagetech.smartspectra.proto.MetricTypesProto.MetricType
import com.presagetech.smartspectra.proto.MetricsProto.Metrics
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.launch

class PresageSensorModule : Module() {
  private val state = PresageSensorStateMachine()
  private var sdk: SmartSpectraSdk? = null
  private var runtimeApiKey: String? = null
  private var observing = false

  private val processingObserver = Observer<ProcessingStatus> { status ->
    state.processing(status.name)
    emitState()
  }
  private val validationObserver = Observer<ValidationStatus?> { validation ->
    state.validation(validation?.code?.name, validation?.hint)
    emitState()
  }
  private val errorObserver = Observer<SmartSpectraError?> { error ->
    if (error != null) {
      state.error(error.code.name, error.message, error.retryable)
      emitState()
    }
  }
  private val metricsObserver = Observer<Metrics?> { metrics ->
    if (metrics == null) return@Observer
    val pulse = metrics.takeIf { it.hasCardio() }?.cardio?.pulseRateList?.lastOrNull()?.let {
      PresageMetricReading(it.value.toDouble(), it.stable, it.confidence.toDouble(), it.timestamp)
    }
    val breathing = metrics.takeIf { it.hasBreathing() }?.breathing?.rateList?.lastOrNull()?.let {
      PresageMetricReading(it.value.toDouble(), it.stable, it.confidence.toDouble(), it.timestamp)
    }
    state.metrics(pulse, breathing)
    emitState()
  }

  override fun definition() = ModuleDefinition {
    Name("PresageSensor")
    Events("onStateChange")
    Constant("configured") { BuildConfig.PRESAGE_API_KEY.isNotBlank() || runtimeApiKey != null }

    OnCreate {
      if (BuildConfig.PRESAGE_API_KEY.isNotBlank() || runtimeApiKey != null) state.keyAvailable(hasCameraPermission())
    }

    AsyncFunction("getStatus") {
      state.permission(hasCameraPermission())
      state.expireStale()
      state.snapshot.toMap()
    }

    AsyncFunction("setConsent") Coroutine { granted: Boolean ->
      state.consent(granted)
      emitState()
      if (!granted) stopInternal("Capture stopped because camera consent was withdrawn.")
      state.snapshot.toMap()
    }

    AsyncFunction("setApiKey") Coroutine { apiKey: String ->
      runtimeApiKey = apiKey.trim()
      if (runtimeApiKey.isNotBlank()) state.keyAvailable(hasCameraPermission())
      emitState()
      state.snapshot.toMap()
    }

    AsyncFunction("initialize") Coroutine { ->
      check(state.snapshot.consented) { "Explicit camera consent is required before SmartSpectra initialization." }
      requireCameraPermission()
      val configuredSdk = initializeSdkAfterConsent()
      val readiness = try {
        configuredSdk.checkDeviceReadiness()
      } catch (error: Throwable) {
        state.error("readiness_failed", error.message ?: "SmartSpectra readiness check failed.", true)
        emitState()
        throw IllegalStateException(state.snapshot.reason, error)
      }
      state.readiness(readiness.verdict.name, readiness.reason)
      emitState()
      state.snapshot.toMap()
    }

    AsyncFunction("start") Coroutine { ->
      check(state.snapshot.consented) { "Explicit camera consent is required before SmartSpectra capture." }
      val configuredSdk = requireConfiguredSdk()
      requireCameraPermission()
      if (state.snapshot.readiness == "unchecked") {
        val readiness = configuredSdk.checkDeviceReadiness()
        state.readiness(readiness.verdict.name, readiness.reason)
      }
      check(state.snapshot.ready) { state.snapshot.reason ?: "This device is not ready for SmartSpectra capture." }
      configuredSdk.start()
      state.snapshot.toMap()
    }

    AsyncFunction("stop") Coroutine { ->
      stopInternal("Capture stopped. No camera frames were retained by Zoe.")
      state.snapshot.toMap()
    }

    OnActivityEntersBackground {
      state.consent(false)
      emitState()
      appContext.mainQueue.launch { stopInternal("Capture stopped because Zoe left the foreground.") }
    }

    OnDestroy {
      state.consent(false)
      appContext.mainQueue.launch {
        stopInternal("Capture disposed.", emit = false)
        removeObservers()
      }
    }
  }

  private fun initializeSdkAfterConsent(): SmartSpectraSdk {
    sdk?.let { return it }
    val apiKey = runtimeApiKey.takeIf { it.isNotBlank() } ?: BuildConfig.PRESAGE_API_KEY
    check(apiKey.isNotBlank()) { "SmartSpectra is compiled in, but no PRESAGE_API_KEY was supplied through build environment or broker." }
    val config = SmartSpectraConfig().apply {
      apiKey = apiKey
      enableTelemetry = false
      imageOutputEnabled = false
      requestedMetrics = listOf(MetricType.PULSE_RATE, MetricType.BREATHING_RATE)
    }
    val configuredSdk = SmartSpectraSdk.initialize(appContext.applicationContext, config).apply {
      useCamera(CameraSelection.Front)
    }
    sdk = configuredSdk
    state.initialized(hasCameraPermission())
    installObservers(configuredSdk)
    emitState()
    return configuredSdk
  }

  private fun installObservers(configuredSdk: SmartSpectraSdk) {
    if (observing) return
    configuredSdk.processingStatus.observeForever(processingObserver)
    configuredSdk.validationStatus.observeForever(validationObserver)
    configuredSdk.error.observeForever(errorObserver)
    configuredSdk.metrics.observeForever(metricsObserver)
    observing = true
  }

  private fun removeObservers() {
    val configuredSdk = sdk ?: return
    if (!observing) return
    configuredSdk.processingStatus.removeObserver(processingObserver)
    configuredSdk.validationStatus.removeObserver(validationObserver)
    configuredSdk.error.removeObserver(errorObserver)
    configuredSdk.metrics.removeObserver(metricsObserver)
    observing = false
  }

  private fun requireConfiguredSdk(): SmartSpectraSdk {
    return sdk ?: throw IllegalStateException("SmartSpectra is compiled in, but no API key was supplied.")
  }

  private fun hasCameraPermission(): Boolean = ContextCompat.checkSelfPermission(
    appContext.applicationContext,
    Manifest.permission.CAMERA,
  ) == PackageManager.PERMISSION_GRANTED

  private fun requireCameraPermission() {
    val granted = hasCameraPermission()
    state.permission(granted)
    emitState()
    check(granted) { "Camera permission is required before SmartSpectra readiness or capture." }
  }

  private suspend fun stopInternal(reason: String, emit: Boolean = true) {
    val configuredSdk = sdk
    if (configuredSdk == null) {
      if (state.snapshot.configured) state.stopped(reason)
      if (emit) emitState()
    } else {
      configuredSdk.stop()
      sdk = null
      state.stopped(reason)
      if (emit) emitState()
    }
  }