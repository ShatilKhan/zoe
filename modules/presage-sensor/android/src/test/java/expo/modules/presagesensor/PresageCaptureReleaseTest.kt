package expo.modules.presagesensor

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PresageCaptureReleaseTest {
  @Test
  fun `background stop reports clean release only after idle`() = runBlocking {
    var idle = false
    val release = PresageCaptureRelease(
      stopSdk = { idle = true },
      resetSdk = { error("reset must not run") },
      isIdle = { idle },
    )

    val outcome = release.release("background")

    assertTrue(outcome.stoppedCleanly)
    assertTrue(outcome.cameraReleased)
  }

  @Test
  fun `stop failure surfaces error even when reset verifies release`() = runBlocking {
    var idle = false
    val release = PresageCaptureRelease(
      stopSdk = { error("stop failed") },
      resetSdk = { idle = true },
      isIdle = { idle },
    )

    val outcome = release.release("background")

    assertFalse(outcome.stoppedCleanly)
    assertTrue(outcome.cameraReleased)
    assertTrue(outcome.message.contains("stop failed"))
  }

  @Test
  fun `destroy fails closed when stop and reset cannot release camera`() = runBlocking {
    val release = PresageCaptureRelease(
      stopSdk = { error("stop failed") },
      resetSdk = { error("reset failed") },
      isIdle = { false },
    )

    val outcome = release.release("destroy")

    assertFalse(outcome.stoppedCleanly)
    assertFalse(outcome.cameraReleased)
  }

  @Test
  fun `capture can be released again after a verified reset fallback`() = runBlocking {
    var idle = false
    var stopAttempts = 0
    val release = PresageCaptureRelease(
      stopSdk = {
        stopAttempts += 1
        if (stopAttempts == 1) error("first stop failed")
        idle = true
      },
      resetSdk = { idle = true },
      isIdle = { idle },
    )

    val first = release.release("background")
    assertFalse(first.stoppedCleanly)
    assertTrue(first.cameraReleased)

    idle = false
    val second = release.release("navigation")
    assertTrue(second.stoppedCleanly)
    assertTrue(second.cameraReleased)
  }
}
