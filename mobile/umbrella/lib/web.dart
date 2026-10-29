import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_android/webview_flutter_android.dart';

import 'api.dart';
import 'splash.dart';
import 'tracker.dart';

/// The UMBRELLA web system in a WebView; its `UmbrellaApp` channel hands the background service a token.
class WebShell extends StatefulWidget {
  const WebShell({super.key, required this.server, required this.onChangeServer});

  final String server;
  final VoidCallback onChangeServer;

  @override
  State<WebShell> createState() => _WebShellState();
}

class _WebShellState extends State<WebShell> {
  late final WebViewController _web;
  String? _error;

  @override
  void initState() {
    super.initState();
    _web = WebViewController(onPermissionRequest: (request) => request.grant())
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(umbrellaInk)
      ..addJavaScriptChannel('UmbrellaApp', onMessageReceived: (message) => _bridge(message.message))
      ..setNavigationDelegate(
        NavigationDelegate(
          onPageFinished: (_) {
            if (_error != null && mounted) setState(() => _error = null);
          },
          onWebResourceError: (error) {
            if ((error.isForMainFrame ?? false) && mounted) setState(() => _error = error.description);
          },
        ),
      );
    final android = _web.platform;
    if (android is AndroidWebViewController) {
      android.setMediaPlaybackRequiresUserGesture(false);
      android.setGeolocationEnabled(true);
      android.setGeolocationPermissionsPromptCallbacks(
        onShowPrompt: (request) async => const GeolocationPermissionsResponse(allow: true, retain: true),
      );
    }
    _load();
  }

  Future<void> _load() async {
    final agent = await _web.getUserAgent();
    await _web.setUserAgent('${agent ?? ''} UMBRELLA-App');
    await _web.loadRequest(Uri.parse(widget.server));
  }

  Future<void> _bridge(String raw) async {
    final Map<String, dynamic> data;
    try {
      data = jsonDecode(raw) as Map<String, dynamic>;
    } on FormatException {
      return;
    }
    final prefs = await SharedPreferences.getInstance();
    if (data['type'] == 'session') {
      final token = data['token']?.toString();
      if (token == null || token.isEmpty) return;
      await prefs.setString(Keys.token, token);
      final name = (data['user'] as Map?)?['name']?.toString();
      if (name != null) await prefs.setString(Keys.name, name);
      await startTracker();
    }
    if (data['type'] == 'logout') {
      await prefs.remove(Keys.token);
      await stopTracker();
    }
  }

  Future<bool> _closeMenu() async {
    try {
      final open = await _web.runJavaScriptReturningResult(
        "(() => { if (!document.documentElement.classList.contains('menu-open')) return 0; document.querySelector('#menu-btn').click(); return 1; })()",
      );
      return open.toString() == '1';
    } catch (_) {
      return false;
    }
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) async {
        if (didPop) return;
        if (await _closeMenu()) return;
        if (await _web.canGoBack()) {
          await _web.goBack();
        } else {
          await SystemNavigator.pop();
        }
      },
      child: Scaffold(
        backgroundColor: umbrellaInk,
        body: SafeArea(
          child: Stack(
            children: [
              WebViewWidget(controller: _web),
              if (_error != null) _offline(),
            ],
          ),
        ),
      ),
    );
  }

  Widget _offline() {
    return Positioned.fill(
      child: ColoredBox(
        color: umbrellaInk,
        child: Padding(
          padding: const EdgeInsets.all(28),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Image.asset('assets/logo.png', width: 72),
              const SizedBox(height: 20),
              const Text('Сервертэй холбогдсонгүй', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700)),
              const SizedBox(height: 8),
              const Text(
                'Интернэт холболтоо шалгана уу. Компьютер дахин асаагдсан бол серверийн хаяг өөрчлөгдсөн байж магадгүй.',
                textAlign: TextAlign.center,
                style: TextStyle(color: Color(0xFF9AA0A8)),
              ),
              const SizedBox(height: 24),
              FilledButton(
                onPressed: () {
                  setState(() => _error = null);
                  _web.reload();
                },
                style: FilledButton.styleFrom(backgroundColor: umbrellaRed, minimumSize: const Size.fromHeight(48)),
                child: const Text('Дахин оролдох'),
              ),
              const SizedBox(height: 10),
              OutlinedButton(
                onPressed: widget.onChangeServer,
                style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48)),
                child: const Text('Серверийн хаяг солих'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
