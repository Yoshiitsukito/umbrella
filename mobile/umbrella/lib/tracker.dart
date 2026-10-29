import 'dart:async';
import 'dart:convert';
import 'dart:math';
import 'dart:ui';

import 'package:flutter_foreground_task/flutter_foreground_task.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:geolocator/geolocator.dart';
import 'package:pedometer/pedometer.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:umbrella_device/umbrella_device.dart';

import 'api.dart';

const _red = Color(0xFFD50000);

/// Starts (or nudges) the always-on service that counts steps, follows location and shows the sleep button.
Future<void> startTracker() async {
  FlutterForegroundTask.init(
    androidNotificationOptions: AndroidNotificationOptions(
      channelId: 'umbrella_status',
      channelName: 'UMBRELLA төлөв',
      channelDescription: 'Алхам, байршил, унтах товч',
      channelImportance: NotificationChannelImportance.DEFAULT,
      priority: NotificationPriority.DEFAULT,
      onlyAlertOnce: true,
    ),
    iosNotificationOptions: const IOSNotificationOptions(showNotification: false),
    foregroundTaskOptions: ForegroundTaskOptions(
      eventAction: ForegroundTaskEventAction.repeat(60 * 1000),
      autoRunOnBoot: true,
      autoRunOnMyPackageReplaced: true,
      allowWakeLock: true,
      allowWifiLock: true,
    ),
  );
  if (await FlutterForegroundTask.isRunningService) {
    FlutterForegroundTask.sendDataToTask('sync');
    return;
  }
  await FlutterForegroundTask.startService(
    serviceId: 700,
    serviceTypes: [ForegroundServiceTypes.location],
    notificationTitle: 'UMBRELLA',
    notificationText: 'Холбогдож байна…',
    notificationIcon: const NotificationIcon(metaDataName: 'mn.umbrella.NOTIFICATION_ICON', backgroundColor: _red),
    callback: trackerCallback,
  );
}

Future<void> stopTracker() async {
  if (await FlutterForegroundTask.isRunningService) await FlutterForegroundTask.stopService();
}

@pragma('vm:entry-point')
void trackerCallback() => FlutterForegroundTask.setTaskHandler(Tracker());

String dateOf(DateTime time) =>
    '${time.year}-${time.month.toString().padLeft(2, '0')}-${time.day.toString().padLeft(2, '0')}';

String clockOf(DateTime time) => '${time.hour.toString().padLeft(2, '0')}:${time.minute.toString().padLeft(2, '0')}';

String groupDigits(int value) => value.toString().replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (_) => ' ');

class Tracker extends TaskHandler {
  static const _messages = AndroidNotificationChannel(
    'umbrella_messages',
    'Мэдэгдэл',
    description: 'Ээлж, чөлөө, зарлалын мэдэгдэл',
    importance: Importance.high,
  );

  late SharedPreferences _prefs;
  final _notes = FlutterLocalNotificationsPlugin();
  StreamSubscription<StepCount>? _stepSub;
  StreamSubscription<Position>? _placeSub;
  Map<String, Object?>? _place;
  Map<String, Object?>? _sentPlace;
  bool _syncing = false;
  bool _signedOut = false;

  String? _day;
  int _steps = 0;
  int _active = 0;
  int? _counter;
  int _minute = 0;
  int _minuteSteps = 0;

  @override
  Future<void> onStart(DateTime timestamp, TaskStarter starter) async {
    _prefs = await SharedPreferences.getInstance();
    _day = _prefs.getString('steps_day');
    _steps = _prefs.getInt('steps_today') ?? 0;
    _active = _prefs.getInt('active_today') ?? 0;
    _counter = _prefs.getInt('steps_counter');
    await _notes.initialize(settings: const InitializationSettings(android: AndroidInitializationSettings('ic_stat_umbrella')));
    await _notes.resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>()?.createNotificationChannel(_messages);
    _stepSub = Pedometer.stepCountStream.listen(_onSteps, onError: (_) {});
    await _followPlace();
    await _sync();
  }

  @override
  void onRepeatEvent(DateTime timestamp) => _sync();

  @override
  Future<void> onDestroy(DateTime timestamp, bool isTimeout) async {
    await _saveSteps();
    await _stepSub?.cancel();
    await _placeSub?.cancel();
  }

  @override
  void onReceiveData(Object data) {
    if (data == 'sync') _sync();
  }

  @override
  void onNotificationButtonPressed(String id) {
    if (id == 'sleep') _sleep();
    if (id == 'wake') _wake();
  }

  @override
  void onNotificationPressed() => FlutterForegroundTask.launchApp();

  // ---- steps -------------------------------------------------------------------------------------------

  void _rollDay(DateTime now) {
    final today = dateOf(now);
    if (_day == today) return;
    if (_day != null && _steps > 0) {
      _prefs.setString('steps_pending', jsonEncode({'date': _day, 'steps': _steps, 'active': _active}));
    }
    _day = today;
    _steps = 0;
    _active = 0;
  }

  void _onSteps(StepCount event) {
    final now = DateTime.now();
    _rollDay(now);
    final last = _counter;
    var delta = last == null ? 0 : event.steps - last;
    if (delta < 0) delta = event.steps;
    _counter = event.steps;
    _steps += delta;
    final minute = now.millisecondsSinceEpoch ~/ 60000;
    if (minute == _minute) {
      _minuteSteps += delta;
    } else {
      if (_minuteSteps >= 60) _active += 1;
      _minute = minute;
      _minuteSteps = delta;
    }
  }

  Future<void> _saveSteps() async {
    _rollDay(DateTime.now());
    await _prefs.setString('steps_day', _day!);
    await _prefs.setInt('steps_today', _steps);
    await _prefs.setInt('active_today', _active);
    if (_counter != null) await _prefs.setInt('steps_counter', _counter!);
  }

  // ---- location ----------------------------------------------------------------------------------------

  Future<void> _followPlace() async {
    if (_placeSub != null) return;
    final permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied || permission == LocationPermission.deniedForever) return;
    final settings = AndroidSettings(accuracy: LocationAccuracy.best, distanceFilter: 10, intervalDuration: const Duration(seconds: 15));
    _placeSub = Geolocator.getPositionStream(locationSettings: settings).listen((fix) {
      _place = {'lat': fix.latitude, 'lng': fix.longitude, 'acc': fix.accuracy, 'at': fix.timestamp.toUtc().toIso8601String()};
    }, onError: (_) {
      _placeSub?.cancel();
      _placeSub = null;
    });
  }

  // ---- server ------------------------------------------------------------------------------------------

  Future<void> _sync() async {
    if (_syncing) return;
    _syncing = true;
    try {
      await _saveSteps();
      await _prefs.reload();
      await _followPlace();
      final api = await MobileApi.load();
      if (api == null || api.token == null) {
        _signedOut = true;
        return;
      }
      try {
        final pending = _prefs.getString('steps_pending');
        if (pending != null) {
          try {
            await api.post('/api/mobile/activity', jsonDecode(pending) as Object);
          } on ApiError catch (error) {
            if (error.status != 400) rethrow;
          }
          await _prefs.remove('steps_pending');
        }
        var state = await api.post('/api/mobile/activity', {'date': _day, 'steps': _steps, 'active': _active});
        final place = _place;
        if (place != null && !identical(place, _sentPlace)) {
          state = await api.post('/api/mobile/location', place);
          _sentPlace = place;
        }
        final sleeps = _prefs.getStringList('sleep_pending') ?? [];
        while (sleeps.isNotEmpty) {
          try {
            state = await api.post('/api/mobile/sleep', jsonDecode(sleeps.first) as Object);
          } on ApiError catch (error) {
            if (error.status != 400) rethrow;
          }
          sleeps.removeAt(0);
          await _prefs.setStringList('sleep_pending', sleeps);
        }
        _signedOut = false;
        await _prefs.setString('mobile_state', jsonEncode(state));
        await _announce((state['messages'] as List?) ?? const []);
      } on ApiError catch (error) {
        _signedOut = error.status == 401;
      } catch (_) {
        // offline: everything stays queued for the next tick
      } finally {
        api.close();
      }
    } finally {
      _syncing = false;
      await _paint();
    }
  }

  Future<void> _announce(List<dynamic> messages) async {
    final shown = _prefs.getStringList('shown') ?? [];
    for (final item in messages.cast<Map<String, dynamic>>()) {
      final id = item['id'].toString();
      if (shown.contains(id)) continue;
      final text = item['text'].toString();
      await _notes.show(
        id: id.hashCode & 0x7fffffff,
        title: item['title']?.toString() ?? 'UMBRELLA',
        body: text,
        notificationDetails: NotificationDetails(
          android: AndroidNotificationDetails(
            _messages.id,
            _messages.name,
            channelDescription: _messages.description,
            importance: Importance.high,
            priority: Priority.high,
            icon: 'ic_stat_umbrella',
            color: _red,
            styleInformation: BigTextStyleInformation(text),
          ),
        ),
      );
      shown.add(id);
    }
    await _prefs.setStringList('shown', shown.sublist(max(0, shown.length - 200)));
  }

  // ---- notification and the sleep button ---------------------------------------------------------------

  Map<String, dynamic>? get _state {
    final text = _prefs.getString('mobile_state');
    return text == null ? null : jsonDecode(text) as Map<String, dynamic>;
  }

  bool _inSleepWindow(DateTime now) {
    final windows = (_state?['sleepWindows'] as List?) ?? const [];
    return windows.cast<Map<String, dynamic>>().any((item) {
      final from = DateTime.tryParse(item['from'].toString());
      final until = DateTime.tryParse(item['until'].toString());
      return from != null && until != null && now.isAfter(from) && now.isBefore(until);
    });
  }

  Future<void> _paint() async {
    final now = DateTime.now();
    final started = DateTime.tryParse(_prefs.getString('sleep_start') ?? '');
    final moving = '${groupDigits(_steps)} алхам · $_active мин идэвхтэй';
    final shift = switch (_state?['shift']?['kind']) {
      'day' => ' · өдрийн ээлж',
      'night' => ' · шөнийн ээлж',
      'off' => ' · амралт',
      _ => '',
    };
    var title = 'UMBRELLA';
    var text = '$moving$shift';
    var buttons = <NotificationButton>[];
    if (started != null) {
      title = 'Унтаж байна · ${clockOf(started.toLocal())}-аас';
      text = 'Сэрээд "Сэрлээ" товчийг дарна уу.';
      buttons = [const NotificationButton(id: 'wake', text: 'Сэрлээ', textColor: _red)];
    } else if (_inSleepWindow(now)) {
      title = 'Унтах цаг боллоо';
      text = 'Wi-Fi, Bluetooth унтарч, "Бүү саад бол" асна. $moving';
      buttons = [const NotificationButton(id: 'sleep', text: 'Унтах', textColor: _red)];
    } else if (_signedOut) {
      text = 'Апп-аа нээж дахин нэвтэрнэ үү.';
    }
    await FlutterForegroundTask.updateService(notificationTitle: title, notificationText: text, notificationButtons: buttons);
  }

  Future<void> _sleep() async {
    if (_prefs.getString('sleep_start') != null) return;
    await _prefs.setString('sleep_start', DateTime.now().toUtc().toIso8601String());
    final radios = await UmbrellaDevice.radios();
    final wifi = radios.wifi == true && await UmbrellaDevice.setWifi(false);
    final bluetooth = radios.bluetooth == true && await UmbrellaDevice.setBluetooth(false);
    final dnd = !await UmbrellaDevice.dndOn() && await UmbrellaDevice.setDnd(true);
    await _prefs.setString('sleep_radios', jsonEncode({'wifi': wifi, 'bluetooth': bluetooth, 'dnd': dnd}));
    await _paint();
    await UmbrellaDevice.openDataPanel();
  }

  Future<void> _wake() async {
    final started = _prefs.getString('sleep_start');
    if (started == null) return;
    final end = DateTime.now().toUtc();
    final start = DateTime.tryParse(started);
    if (start != null && end.difference(start).inMinutes >= 30) {
      final sleeps = _prefs.getStringList('sleep_pending') ?? [];
      sleeps.add(jsonEncode({'start': started, 'end': end.toIso8601String()}));
      await _prefs.setStringList('sleep_pending', sleeps);
    }
    await _prefs.remove('sleep_start');
    final saved = jsonDecode(_prefs.getString('sleep_radios') ?? '{}') as Map<String, dynamic>;
    await _prefs.remove('sleep_radios');
    if (saved['wifi'] == true) await UmbrellaDevice.setWifi(true);
    if (saved['bluetooth'] == true) await UmbrellaDevice.setBluetooth(true);
    if (saved['dnd'] == true) await UmbrellaDevice.setDnd(false);
    await _paint();
    await UmbrellaDevice.openDataPanel();
    Future.delayed(const Duration(seconds: 20), _sync);
  }
}
