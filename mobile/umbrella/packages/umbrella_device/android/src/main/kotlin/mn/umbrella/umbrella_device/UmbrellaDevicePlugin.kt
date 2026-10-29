package mn.umbrella.umbrella_device

import android.annotation.SuppressLint
import android.app.Activity
import android.app.NotificationManager
import android.bluetooth.BluetoothManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.net.wifi.WifiManager
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import io.flutter.embedding.engine.plugins.FlutterPlugin
import io.flutter.embedding.engine.plugins.activity.ActivityAware
import io.flutter.embedding.engine.plugins.activity.ActivityPluginBinding
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel

/**
 * Phone radios and Do Not Disturb for the sleep button. Wi-Fi and Bluetooth can only be switched by apps that
 * target Android 9 / 12 or older (this app targets 28); mobile data never can, so its settings panel is opened.
 */
class UmbrellaDevicePlugin : FlutterPlugin, MethodChannel.MethodCallHandler, ActivityAware {
    private lateinit var channel: MethodChannel
    private lateinit var context: Context
    private var activity: Activity? = null

    override fun onAttachedToEngine(binding: FlutterPlugin.FlutterPluginBinding) {
        context = binding.applicationContext
        channel = MethodChannel(binding.binaryMessenger, "umbrella_device")
        channel.setMethodCallHandler(this)
    }

    override fun onDetachedFromEngine(binding: FlutterPlugin.FlutterPluginBinding) {
        channel.setMethodCallHandler(null)
    }

    override fun onAttachedToActivity(binding: ActivityPluginBinding) {
        activity = binding.activity
    }

    override fun onDetachedFromActivityForConfigChanges() {
        activity = null
    }

    override fun onReattachedToActivityForConfigChanges(binding: ActivityPluginBinding) {
        activity = binding.activity
    }

    override fun onDetachedFromActivity() {
        activity = null
    }

    override fun onMethodCall(call: MethodCall, result: MethodChannel.Result) {
        try {
            when (call.method) {
                "radios" -> result.success(mapOf("wifi" to wifi()?.isWifiEnabled, "bluetooth" to bluetoothOn()))
                "setWifi" -> result.success(setWifi(call.argument<Boolean>("on") == true))
                "setBluetooth" -> result.success(setBluetooth(call.argument<Boolean>("on") == true))
                "dndAllowed" -> result.success(notifications().isNotificationPolicyAccessGranted)
                "dndOn" -> result.success(notifications().currentInterruptionFilter > NotificationManager.INTERRUPTION_FILTER_ALL)
                "setDnd" -> result.success(setDnd(call.argument<Boolean>("on") == true))
                "openDndAccess" -> result.success(open(Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS)))
                "openDataPanel" -> result.success(openDataPanel())
                "granted" -> result.success(
                    context.checkSelfPermission(call.argument<String>("name") ?: "") == PackageManager.PERMISSION_GRANTED
                )
                "openAppSettings" -> result.success(
                    open(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}")))
                )
                "batteryExempt" -> result.success(power().isIgnoringBatteryOptimizations(context.packageName))
                "openBatteryExemption" -> result.success(
                    open(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:${context.packageName}")))
                )
                else -> result.notImplemented()
            }
        } catch (error: Exception) {
            result.error("device", error.message, null)
        }
    }

    private fun wifi() = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager

    private fun notifications() = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

    private fun power() = context.getSystemService(Context.POWER_SERVICE) as PowerManager

    @SuppressLint("MissingPermission")
    private fun bluetoothOn(): Boolean? = try {
        (context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter?.isEnabled
    } catch (_: SecurityException) {
        null
    }

    @Suppress("DEPRECATION")
    private fun setWifi(on: Boolean): Boolean {
        val manager = wifi() ?: return false
        if (manager.isWifiEnabled == on) return true
        return try {
            manager.setWifiEnabled(on)
        } catch (_: SecurityException) {
            false
        }
    }

    @SuppressLint("MissingPermission")
    @Suppress("DEPRECATION")
    private fun setBluetooth(on: Boolean): Boolean {
        val adapter = (context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter ?: return false
        return try {
            if (adapter.isEnabled == on) true else if (on) adapter.enable() else adapter.disable()
        } catch (_: SecurityException) {
            false
        }
    }

    private fun setDnd(on: Boolean): Boolean {
        val manager = notifications()
        if (!manager.isNotificationPolicyAccessGranted) return false
        manager.setInterruptionFilter(if (on) NotificationManager.INTERRUPTION_FILTER_PRIORITY else NotificationManager.INTERRUPTION_FILTER_ALL)
        return true
    }

    private fun openDataPanel(): Boolean {
        val panel = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) Intent(Settings.Panel.ACTION_INTERNET_CONNECTIVITY) else Intent(Settings.ACTION_DATA_ROAMING_SETTINGS)
        return open(panel) || open(Intent(Settings.ACTION_WIRELESS_SETTINGS))
    }

    private fun open(intent: Intent): Boolean {
        val host = activity
        return try {
            if (host != null) host.startActivity(intent) else context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            true
        } catch (_: Exception) {
            false
        }
    }
}
