import 'package:flutter/material.dart';
import 'package:flutter_foreground_task/flutter_foreground_task.dart';
import 'package:geolocator/geolocator.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:umbrella_device/umbrella_device.dart';

import 'api.dart';
import 'splash.dart';

/// First start: the server's public address, typed in or read from the QR on the web profile page.
class ServerSetup extends StatefulWidget {
  const ServerSetup({super.key, required this.onSaved, this.current});

  final VoidCallback onSaved;
  final String? current;

  @override
  State<ServerSetup> createState() => _ServerSetupState();
}

class _ServerSetupState extends State<ServerSetup> {
  late final _field = TextEditingController(text: widget.current ?? '');
  bool _busy = false;
  String? _error;

  Future<void> _save([String? value]) async {
    final server = MobileApi.clean(value ?? _field.text);
    if (server.isEmpty) return;
    _field.text = server;
    setState(() {
      _busy = true;
      _error = null;
    });
    if (!await MobileApi.alive(server)) {
      setState(() {
        _busy = false;
        _error = 'Энэ хаягаар UMBRELLA сервер олдсонгүй. Хаяг зөв, компьютер дээр сервер ажиллаж байгаа эсэхийг шалгана уу.';
      });
      return;
    }
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(Keys.server, server);
    widget.onSaved();
  }

  Future<void> _scan() async {
    final value = await Navigator.of(context).push<String>(MaterialPageRoute(builder: (_) => const _QrScan()));
    if (value != null) await _save(value);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(24, 48, 24, 24),
          children: [
            Center(child: Image.asset('assets/logo.png', width: 84)),
            const SizedBox(height: 20),
            const Text('Сервертэй холбох', textAlign: TextAlign.center, style: TextStyle(fontSize: 24, fontWeight: FontWeight.w700)),
            const SizedBox(height: 8),
            const Text(
              'Компьютер дээрх UMBRELLA системийн "Профайл" хуудсанд байгаа QR кодыг уншуулна уу.',
              textAlign: TextAlign.center,
              style: TextStyle(color: Color(0xFF9AA0A8)),
            ),
            const SizedBox(height: 28),
            FilledButton.icon(
              onPressed: _busy ? null : _scan,
              icon: const Icon(Icons.qr_code_scanner),
              label: const Text('QR код уншуулах'),
              style: FilledButton.styleFrom(backgroundColor: umbrellaRed, minimumSize: const Size.fromHeight(52)),
            ),
            const SizedBox(height: 24),
            TextField(
              controller: _field,
              keyboardType: TextInputType.url,
              autocorrect: false,
              decoration: const InputDecoration(labelText: 'Эсвэл хаягаа бичнэ үү', hintText: 'https://….trycloudflare.com', border: OutlineInputBorder()),
              onSubmitted: (_) => _save(),
            ),
            const SizedBox(height: 12),
            OutlinedButton(
              onPressed: _busy ? null : _save,
              style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48)),
              child: _busy ? const SizedBox.square(dimension: 20, child: CircularProgressIndicator(strokeWidth: 2)) : const Text('Холбох'),
            ),
            if (_error != null) ...[
              const SizedBox(height: 16),
              Text(_error!, style: const TextStyle(color: Color(0xFFFF6B6B))),
            ],
          ],
        ),
      ),
    );
  }
}

class _QrScan extends StatefulWidget {
  const _QrScan();

  @override
  State<_QrScan> createState() => _QrScanState();
}

class _QrScanState extends State<_QrScan> {
  bool _done = false;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('QR код уншуулах')),
      body: MobileScanner(
        onDetect: (capture) {
          final value = capture.barcodes.map((code) => code.rawValue).whereType<String>().firstOrNull;
          if (_done || value == null || !value.startsWith('http')) return;
          _done = true;
          Navigator.of(context).pop(value);
        },
      ),
    );
  }
}

/// Permissions the background service needs, each with its own button and live status.
class PermissionSetup extends StatefulWidget {
  const PermissionSetup({super.key, required this.onDone});

  final VoidCallback onDone;

  @override
  State<PermissionSetup> createState() => _PermissionSetupState();
}

class _PermissionSetupState extends State<PermissionSetup> with WidgetsBindingObserver {
  final Map<String, bool> _ok = {};

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _refresh();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _refresh();
  }

  Future<void> _refresh() async {
    final location = await Geolocator.checkPermission();
    final values = {
      'location': location == LocationPermission.always || location == LocationPermission.whileInUse,
      'always': location == LocationPermission.always,
      'activity': await UmbrellaDevice.granted('android.permission.ACTIVITY_RECOGNITION'),
      'notify': await FlutterForegroundTask.checkNotificationPermission() == NotificationPermission.granted,
      'dnd': await UmbrellaDevice.dndAllowed(),
      'battery': await UmbrellaDevice.batteryExempt(),
    };
    if (mounted) setState(() => _ok.addAll(values));
  }

  Future<void> _ask(String key) async {
    switch (key) {
      case 'location':
        if (!await Geolocator.isLocationServiceEnabled()) await Geolocator.openLocationSettings();
        await Geolocator.requestPermission();
      case 'always':
        if (await Geolocator.requestPermission() != LocationPermission.always) await Geolocator.openAppSettings();
      case 'activity':
        await UmbrellaDevice.openAppSettings();
      case 'notify':
        await FlutterForegroundTask.requestNotificationPermission();
      case 'dnd':
        await UmbrellaDevice.openDndAccess();
      case 'battery':
        await UmbrellaDevice.openBatteryExemption();
    }
    await _refresh();
  }

  Widget _row(String key, IconData icon, String title, String note) {
    final ok = _ok[key] == true;
    return Card(
      color: const Color(0xFF16161A),
      margin: const EdgeInsets.only(bottom: 10),
      child: ListTile(
        contentPadding: const EdgeInsets.fromLTRB(16, 6, 12, 6),
        leading: Icon(icon, color: ok ? const Color(0xFF4ADE80) : umbrellaRed),
        title: Text(title, style: const TextStyle(fontWeight: FontWeight.w600)),
        subtitle: Text(note, style: const TextStyle(color: Color(0xFF9AA0A8))),
        trailing: ok ? const Icon(Icons.check_circle, color: Color(0xFF4ADE80)) : TextButton(onPressed: () => _ask(key), child: const Text('Зөвшөөрөх')),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 32, 20, 24),
          children: [
            const Text('Зөвшөөрөл', style: TextStyle(fontSize: 24, fontWeight: FontWeight.w700)),
            const SizedBox(height: 6),
            const Text('Апп хаалттай байсан ч алхам, байршил, унтах товч ажиллахын тулд дараах эрхүүдийг өгнө үү.', style: TextStyle(color: Color(0xFF9AA0A8))),
            const SizedBox(height: 20),
            _row('location', Icons.my_location, 'Байршил', 'GPS-ээр байршлыг нарийвчлалтай тогтооно'),
            _row('always', Icons.share_location, 'Байршил — үргэлж', 'Апп хаалттай үед ч байршил шинэчлэгдэнэ'),
            _row('activity', Icons.directions_walk, 'Хөдөлгөөн', 'Утасны мэдрэгчээр алхам, идэвхтэй минут тоолно'),
            _row('notify', Icons.notifications_active, 'Мэдэгдэл', 'Ээлж, зарлал, унтах товч мэдэгдэл дээр гарна'),
            _row('dnd', Icons.do_not_disturb_on, '"Бүү саад бол"', 'Унтах товч дарахад дуу, чичиргээг хаана'),
            _row('battery', Icons.battery_saver, 'Батарей хэмнэлт', 'Утас апп-ыг арын горимд унтраахгүй'),
            const SizedBox(height: 16),
            FilledButton(
              onPressed: () async {
                final prefs = await SharedPreferences.getInstance();
                await prefs.setBool(Keys.setupDone, true);
                widget.onDone();
              },
              style: FilledButton.styleFrom(backgroundColor: umbrellaRed, minimumSize: const Size.fromHeight(52)),
              child: const Text('Үргэлжлүүлэх'),
            ),
          ],
        ),
      ),
    );
  }
}
