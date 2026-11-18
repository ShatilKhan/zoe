package expo.modules.presagesensor

internal data class PresageReleaseOutcome(
  val stoppedCleanly: Boolean,
  val cameraReleased: Boolean,
  val message: String,
  val cause: Throwable? = null,
)

/**
 * Makes camera release fail closed and independently testable. A reset is the
 * SDK's documented recovery path, but it counts as released only when the SDK
 * subsequently reports IDLE.
 */
internal class PresageCaptureRelease(
  private val stopSdk: suspend () -> Unit,
  private val resetSdk: suspend () -> Unit,
  private val isIdle: () -> Boolean,
) {
  suspend fun release(reason: String): PresageReleaseOutcome {
    if (isIdle()) return PresageReleaseOutcome(true, true, reason)

    val stopFailure = runCatching { stopSdk() }.exceptionOrNull()
    if (stopFailure == null && isIdle()) {
      return PresageReleaseOutcome(true, true, reason)
    }

    val resetFailure = runCatching { resetSdk() }.exceptionOrNull()
    val released = resetFailure == null && isIdle()
    val detail = when {
      released && stopFailure != null -> "SmartSpectra stop failed; SDK reset verified the camera returned to IDLE."
      released -> "SmartSpectra did not become idle after stop; SDK reset verified camera release."
      resetFailure != null -> "SmartSpectra camera release failed during stop and reset."
      else -> "SmartSpectra reset completed but camera release could not be verified."
    }
    return PresageReleaseOutcome(
      stoppedCleanly = false,
      cameraReleased = released,
      message = detail,
      cause = resetFailure ?: stopFailure,
    )
  }
}
