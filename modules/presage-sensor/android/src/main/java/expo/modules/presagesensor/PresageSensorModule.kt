package expo.modules.presagesensor

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class PresageSensorModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("PresageSensor")

    AsyncFunction("getStatus") {
      mapOf(
        "linked" to false,
        "reason" to "SmartSpectra 3.5.0 artifact and scoped demo key are not linked. Capture is disabled."
      )
    }

    AsyncFunction("start") {
      throw IllegalStateException("SmartSpectra is not linked; Zoe will not emit simulated wellness samples.")
    }

    AsyncFunction("stop") { Unit }
  }
}
