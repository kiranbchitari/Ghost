package expo.modules.paniclock

import android.os.Handler
import android.os.Looper
import android.os.Process
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// Ends the app for good: the task is removed from Recents, then the process is
// killed so nothing (decrypted messages, keys) is left in RAM.
class PanicLockModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("PanicLock")

    Function("exit") {
      appContext.currentActivity?.finishAndRemoveTask()
      // Give the task removal a moment to reach the system before the kill.
      Handler(Looper.getMainLooper()).postDelayed({ Process.killProcess(Process.myPid()) }, 100)
    }
  }
}
