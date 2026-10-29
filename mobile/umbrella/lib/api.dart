import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

/// Keys shared by the app and its background service (each isolate reloads before reading).
class Keys {
  static const server = 'server';
  static const token = 'token';
  static const name = 'name';
  static const setupDone = 'setup_done';
}

class ApiError implements Exception {
  ApiError(this.status, this.message);

  final int status;
  final String message;

  @override
  String toString() => message;
}

/// The UMBRELLA server: its address and the phone's own Bearer token for /api/mobile/.
class MobileApi {
  MobileApi(this.server, this.token);

  static const _app = 'umbrella-white-queen';
  static const _timeout = Duration(seconds: 20);

  final String server;
  final String? token;
  final http.Client _client = http.Client();

  static Future<MobileApi?> load() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.reload();
    final server = prefs.getString(Keys.server);
    if (server == null || server.isEmpty) return null;
    return MobileApi(server, prefs.getString(Keys.token));
  }

  static String clean(String value) {
    var text = value.trim().replaceAll(RegExp(r'/+$'), '');
    if (text.isNotEmpty && !text.startsWith('http://') && !text.startsWith('https://')) text = 'https://$text';
    return text;
  }

  /// True when [server] answers like an UMBRELLA server.
  static Future<bool> alive(String server) async {
    try {
      final res = await http.get(Uri.parse('$server/api/auth/ping')).timeout(const Duration(seconds: 8));
      return res.statusCode == 200 && res.body.contains(_app);
    } catch (_) {
      return false;
    }
  }

  Map<String, String> get _headers => {'Content-Type': 'application/json', 'Authorization': 'Bearer ${token ?? ''}'};

  Map<String, dynamic> _decode(http.Response res) {
    Map<String, dynamic> data = {};
    try {
      if (res.bodyBytes.isNotEmpty) data = jsonDecode(utf8.decode(res.bodyBytes)) as Map<String, dynamic>;
    } on FormatException {
      data = {};
    }
    if (res.statusCode >= 400) throw ApiError(res.statusCode, (data['error'] ?? 'Серверийн алдаа (${res.statusCode})').toString());
    return data;
  }

  Future<Map<String, dynamic>> get(String path) async =>
      _decode(await _client.get(Uri.parse('$server$path'), headers: _headers).timeout(_timeout));

  Future<Map<String, dynamic>> post(String path, Object body) async =>
      _decode(await _client.post(Uri.parse('$server$path'), headers: _headers, body: jsonEncode(body)).timeout(_timeout));

  void close() => _client.close();
}
