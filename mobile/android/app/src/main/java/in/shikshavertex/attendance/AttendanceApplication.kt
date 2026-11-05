package `in`.shikshavertex.attendance

import android.app.Application
import com.google.firebase.FirebaseApp

class AttendanceApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        // google-services.json -> generated Android resources. Firebase's
        // InitProvider normally initializes the default app before onCreate.
        firebaseConfigured = runCatching {
            FirebaseApp.getApps(this).firstOrNull() ?: FirebaseApp.initializeApp(this)
        }.getOrNull() != null
    }
    companion object {
        var firebaseConfigured: Boolean = false
            private set
        val apiConfigured: Boolean get() = BuildConfig.API_BASE_URL.isNotBlank()
        val configured: Boolean get() = firebaseConfigured && apiConfigured
    }
}
