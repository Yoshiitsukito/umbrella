import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class ApiError implements Exception {
  ApiError(this.status, this.message);

  final int status;
  final String message;

  @override
  String toString() => message;
}

enum Pairing { signedIn, pending }

class Api {
  Api(this._prefs) : base = _prefs.getString('server') ?? usbServer, _cookie = _prefs.getString('cookie');

  /// Over USB (`adb reverse`) the PC server is on the phone's own localhost.
  static const usbServer = 'http://localhost:4173';
  static const _stationPort = 4174;
  static const _app = 'umbrella-white-queen';
  static const _probe = 'UMBRELLA-WQ?';
  static const _timeout = Duration(seconds: 15);

  final SharedPreferences _prefs;
  final http.Client _client = http.Client();
  String base;
  String? _cookie;
  Future<bool>? _locating;

  bool get hasSession => _cookie != null;

  String? get pairingCode => _prefs.getString('device_code');

  Map<String, String> get _headers => {'Content-Type': 'application/json', 'Cookie': ?_cookie};

  Uri _uri(String path) => Uri.parse('$base$path');

  Map<String, dynamic> _decode(http.Response res) {
    Map<String, dynamic> data = {};
    if (res.bodyBytes.isNotEmpty) {
      try {
        data = jsonDecode(utf8.decode(res.bodyBytes)) as Map<String, dynamic>;
      } on FormatException {
        data = {};
      }
    }
    if (res.statusCode >= 400) {
      throw ApiError(res.statusCode, (data['error'] ?? 'Серверийн алдаа (${res.statusCode})').toString());
    }
    return data;
  }

  static bool _offline(Object error) => error is SocketException || error is TimeoutException || error is http.ClientException;

  /// Sends a request; when the server is unreachable, looks for it again (USB or Wi-Fi) and retries once.
  Future<http.Response> _send(Future<http.Response> Function() call) async {
    try {
      return await call();
    } catch (error) {
      if (!_offline(error) || !await locate()) rethrow;
      return call();
    }
  }

  /// Like [_send], and an expired session is renewed with the device key without bothering the user.
  Future<http.Response> _authed(Future<http.Response> Function() call) async {
    var res = await _send(call);
    if (res.statusCode == 401 && await _renew()) res = await _send(call);
    return res;
  }

  Future<bool> _renew() async {
    try {
      return await pair() == Pairing.signedIn;
    } on ApiError {
      return false;
    }
  }

  Future<http.Response> _post(String path, Object body) => _client.post(_uri(path), headers: _headers, body: jsonEncode(body)).timeout(_timeout);

  Future<Map<String, dynamic>> getJson(String path) async => _decode(await _authed(() => _client.get(_uri(path), headers: _headers).timeout(_timeout)));

  Future<Map<String, dynamic>> postJson(String path, Object body) async => _decode(await _authed(() => _post(path, body)));

  Future<void> setServer(String value) async {
    base = value.trim().replaceAll(RegExp(r'/+$'), '');
    await _prefs.setString('server', base);
  }

  /// Finds a reachable server: the last one used, USB, the last Wi-Fi address, then a Wi-Fi broadcast search.
  Future<bool> locate() => _locating ??= _locate().whenComplete(() => _locating = null);

  Future<bool> _locate() async {
    final lan = _prefs.getString('lan');
    for (final candidate in {base, usbServer, ?lan}) {
      if (await _alive(candidate)) {
        await setServer(candidate);
        return true;
      }
    }
    final found = await _discover();
    if (found == null || !await _alive(found)) return false;
    await _prefs.setString('lan', found);
    await setServer(found);
    return true;
  }

  Future<bool> _alive(String server) async {
    try {
      final res = await _client.get(Uri.parse('$server/api/auth/ping')).timeout(const Duration(seconds: 2));
      return res.statusCode == 200 && res.body.contains(_app);
    } catch (_) {
      return false;
    }
  }

  Future<String?> _discover() async {
    RawDatagramSocket? socket;
    try {
      socket = await RawDatagramSocket.bind(InternetAddress.anyIPv4, 0);
      socket.broadcastEnabled = true;
      final found = Completer<String>();
      final receiver = socket;
      receiver.listen((event) {
        if (event != RawSocketEvent.read) return;
        final packet = receiver.receive();
        if (packet == null || found.isCompleted) return;
        try {
          final data = jsonDecode(utf8.decode(packet.data)) as Map<String, dynamic>;
          if (data['app'] == _app) found.complete('http://${packet.address.address}:${data['port'] ?? _stationPort}');
        } on FormatException {
          // not our server
        }
      });
      final probe = utf8.encode(_probe);
      for (var attempt = 0; attempt < 3 && !found.isCompleted; attempt++) {
        receiver.send(probe, InternetAddress('255.255.255.255'), _stationPort);
        await Future.any([found.future, Future<void>.delayed(const Duration(milliseconds: 800))]);
      }
      return found.isCompleted ? await found.future : null;
    } on SocketException {
      return null;
    } finally {
      socket?.close();
    }
  }

  /// Signs in with this phone's device key, asking the server for one first if
  /// the phone has never been paired. Returns [Pairing.pending] until an admin
  /// approves the device on the White Queen admin page.
  Future<Pairing> pair({bool renewed = false}) async {
    var id = _prefs.getString('device_id');
    var key = _prefs.getString('device_key');
    if (id == null || key == null) {
      final request = _decode(await _send(() => _post('/api/auth/device/request', {'name': 'White Queen апп'})));
      id = request['id'] as String;
      key = request['key'] as String;
      await _prefs.setString('device_id', id);
      await _prefs.setString('device_key', key);
      await _prefs.setString('device_code', request['code'].toString());
    }
    final res = await _send(() => _post('/api/auth/device/login', {'id': id, 'key': key}));
    if (res.statusCode == 202) return Pairing.pending;
    if (res.statusCode == 401 && !renewed) {
      await _forgetDevice();
      return pair(renewed: true);
    }
    _decode(res);
    final session = RegExp(r'umb_session=[^;]+').firstMatch(res.headers['set-cookie'] ?? '')?.group(0);
    if (session == null) throw ApiError(500, 'Сервер нэвтрэлтийг баталгаажуулсангүй.');
    _cookie = session;
    await _prefs.setString('cookie', session);
    return Pairing.signedIn;
  }

  Future<void> dropSession() async {
    _cookie = null;
    await _prefs.remove('cookie');
  }

  Future<void> _forgetDevice() async {
    for (final name in ['device_id', 'device_key', 'device_code']) {
      await _prefs.remove(name);
    }
  }

  Future<Uint8List> speech(String text) async {
    final res = await _authed(
      () => _client.post(_uri('/api/tts'), headers: _headers, body: jsonEncode({'text': text, 'voice': 'queen'})).timeout(const Duration(seconds: 60)),
    );
    if (res.statusCode != 200) _decode(res);
    return res.bodyBytes;
  }

  bool get frontCamera => _prefs.getBool('front') ?? true;

  Future<void> setFrontCamera(bool value) => _prefs.setBool('front', value);
}
