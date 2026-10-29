import 'package:flutter/services.dart';

/// Phone radios and Do Not Disturb for the sleep button (Android only).
class UmbrellaDevice {
  static const _channel = MethodChannel('umbrella_device');

  static Future<({bool? wifi, bool? bluetooth})> radios() async {
    final data = await _channel.invokeMapMethod<String, Object?>('radios') ?? const {};
    return (wifi: data['wifi'] as bool?, bluetooth: data['bluetooth'] as bool?);
  }

  static Future<bool> setWifi(bool on) async => await _channel.invokeMethod<bool>('setWifi', {'on': on}) ?? false;

  static Future<bool> setBluetooth(bool on) async => await _channel.invokeMethod<bool>('setBluetooth', {'on': on}) ?? false;

  static Future<bool> dndAllowed() async => await _channel.invokeMethod<bool>('dndAllowed') ?? false;

  static Future<bool> dndOn() async => await _channel.invokeMethod<bool>('dndOn') ?? false;

  static Future<bool> setDnd(bool on) async => await _channel.invokeMethod<bool>('setDnd', {'on': on}) ?? false;

  static Future<bool> openDndAccess() async => await _channel.invokeMethod<bool>('openDndAccess') ?? false;

  static Future<bool> openDataPanel() async => await _channel.invokeMethod<bool>('openDataPanel') ?? false;

  static Future<bool> granted(String name) async => await _channel.invokeMethod<bool>('granted', {'name': name}) ?? false;

  static Future<bool> openAppSettings() async => await _channel.invokeMethod<bool>('openAppSettings') ?? false;

  static Future<bool> batteryExempt() async => await _channel.invokeMethod<bool>('batteryExempt') ?? false;

  static Future<bool> openBatteryExemption() async => await _channel.invokeMethod<bool>('openBatteryExemption') ?? false;
}
