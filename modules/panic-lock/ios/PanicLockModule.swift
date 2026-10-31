import ExpoModulesCore
import Foundation

// Ends the app for good: the process exits, so nothing (decrypted messages,
// keys) is left in RAM. iOS has no public API for this; exit(0) is the usual way.
public final class PanicLockModule: Module {
  public func definition() -> ModuleDefinition {
    Name("PanicLock")

    Function("exit") {
      DispatchQueue.main.async { exit(0) }
    }
  }
}
