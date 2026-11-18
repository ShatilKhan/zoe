package expo.modules.presagesensor

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PresageSensorStateTest {
  private val nowMillis = 1_700_000_000_000L

  @Test
  fun `stable fresh measurements expose real values and timestamp`() {
    val state = PresageSensorStateMachine { nowMillis }
    state.keyAvailable(permissionGranted = true)
    assertFalse(state.snapshot.initialized)
    state.consent(true)
    state.initialized(permissionGranted = true)
    state.readiness("READY", null)
    state.validation("OK", null)
    state.processing("RUNNING")
    state.metrics(
      PresageMetricReading(72.4, true, 91.0, nowMillis * 1_000L),
      PresageMetricReading(14.2, true, 88.0, nowMillis * 1_000L),
    )

    assertTrue(state.snapshot.ready)
    assertTrue(state.snapshot.fresh)
    assertEquals("stable", state.snapshot.quality)
    assertEquals(72.4, state.snapshot.pulseRate!!, 0.001)
    assertEquals(14.2, state.snapshot.breathingRate!!, 0.001)
    assertEquals("2023-11-14T22:13:20Z", state.snapshot.capturedAt)
  }

  @Test
  fun `stale or invalid values are never exposed as a successful sample`() {
    val state = PresageSensorStateMachine { nowMillis }
    state.keyAvailable(permissionGranted = true)
    state.consent(true)
    state.initialized(permissionGranted = true)
    state.readiness("READY", null)
    state.validation("OK", null)
    state.metrics(
      PresageMetricReading(70.0, true, 90.0, (nowMillis - 16_000L) * 1_000L),
      PresageMetricReading(0.0, true, 90.0, nowMillis * 1_000L),
    )

    assertFalse(state.snapshot.fresh)
    assertEquals("poor", state.snapshot.quality)
    assertNull(state.snapshot.pulseRate)
    assertNull(state.snapshot.breathingRate)
    assertNull(state.snapshot.capturedAt)
  }

  @Test
  fun `validation failure degrades quality and stop clears measurements`() {
    val state = PresageSensorStateMachine { nowMillis }
    state.keyAvailable(permissionGranted = true)
    state.consent(true)
    state.initialized(permissionGranted = true)
    state.readiness("LIMITED", "Limited device support")
    state.validation("OK", null)
    state.processing("RUNNING")
    state.metrics(
      PresageMetricReading(73.0, true, 80.0, nowMillis * 1_000L),
      PresageMetricReading(15.0, true, 80.0, nowMillis * 1_000L),
    )
    state.validation("EXCESSIVE_MOTION", "Hold still")
    assertEquals("poor", state.snapshot.quality)
    assertFalse(state.snapshot.fresh)
    assertNull(state.snapshot.pulseRate)
    assertNull(state.snapshot.breathingRate)

    state.stopped("background")
    assertEquals("stopped", state.snapshot.status)
    assertFalse(state.snapshot.fresh)
    assertNull(state.snapshot.pulseRate)
    assertNull(state.snapshot.breathingRate)
  }

  @Test
  fun `permission and SDK errors fail closed`() {
    val state = PresageSensorStateMachine { nowMillis }
    state.keyAvailable(permissionGranted = false)
    assertFalse(state.snapshot.ready)
    assertEquals("consent-required", state.snapshot.status)

    state.error("INPUT_UNAVAILABLE", "Camera unavailable", true)
    assertFalse(state.snapshot.ready)
    assertEquals("error", state.snapshot.status)
    assertEquals("input_unavailable", state.snapshot.errorCode)
    assertTrue(state.snapshot.retryable)
  }

  @Test
  fun `camera permission cannot make a build without a key appear configured`() {
    val state = PresageSensorStateMachine { nowMillis }

    state.permission(permissionGranted = true)

    assertFalse(state.snapshot.configured)
    assertFalse(state.snapshot.ready)
    assertEquals("unconfigured", state.snapshot.status)
    assertEquals("SmartSpectra requires a secure PRESAGE_API_KEY build input.", state.snapshot.reason)
  }

  @Test
  fun `unstable sample and consent withdrawal erase previously stable values`() {
    val state = PresageSensorStateMachine { nowMillis }
    state.keyAvailable(permissionGranted = true)
    state.consent(true)
    state.initialized(permissionGranted = true)
    state.validation("OK", null)
    state.processing("RUNNING")
    state.metrics(
      PresageMetricReading(72.0, true, 90.0, nowMillis * 1_000L),
      PresageMetricReading(14.0, true, 90.0, nowMillis * 1_000L),
    )
    assertTrue(state.snapshot.fresh)

    state.metrics(
      PresageMetricReading(71.0, false, 50.0, nowMillis * 1_000L),
      PresageMetricReading(15.0, true, 90.0, nowMillis * 1_000L),
    )
    assertFalse(state.snapshot.fresh)
    assertEquals("poor", state.snapshot.quality)
    assertNull(state.snapshot.pulseRate)

    state.consent(false)
    assertFalse(state.snapshot.consented)
    assertNull(state.snapshot.breathingRate)
  }

  @Test
  fun `accepted sample expires when no more SDK events arrive`() {
    var clock = nowMillis
    val state = PresageSensorStateMachine { clock }
    state.keyAvailable(permissionGranted = true)
    state.consent(true)
    state.initialized(permissionGranted = true)
    state.validation("OK", null)
    state.processing("RUNNING")
    state.metrics(
      PresageMetricReading(72.0, true, 90.0, nowMillis * 1_000L),
      PresageMetricReading(14.0, true, 90.0, nowMillis * 1_000L),
    )

    clock += 15_001L
    state.expireStale()

    assertFalse(state.snapshot.fresh)
    assertEquals("acquiring", state.snapshot.quality)
    assertNull(state.snapshot.pulseRate)
    assertNull(state.snapshot.breathingRate)
  }

  @Test
  fun `idle transition clears stable values and late metrics cannot restore them`() {
    val state = PresageSensorStateMachine { nowMillis }
    state.keyAvailable(permissionGranted = true)
    state.consent(true)
    state.initialized(permissionGranted = true)
    state.validation("OK", null)
    state.processing("RUNNING")
    val pulse = PresageMetricReading(72.0, true, 90.0, nowMillis * 1_000L)
    val breathing = PresageMetricReading(14.0, true, 90.0, nowMillis * 1_000L)
    state.metrics(pulse, breathing)
    assertTrue(state.snapshot.fresh)

    state.processing("IDLE")
    assertEquals("idle", state.snapshot.status)
    assertFalse(state.snapshot.fresh)
    assertNull(state.snapshot.pulseRate)
    assertNull(state.snapshot.breathingRate)

    state.metrics(pulse, breathing)
    assertFalse(state.snapshot.fresh)
    assertNull(state.snapshot.pulseRate)
    assertNull(state.snapshot.breathingRate)
  }
}
