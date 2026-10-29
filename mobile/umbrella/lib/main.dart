import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_foreground_task/flutter_foreground_task.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'api.dart';
import 'setup.dart';
import 'splash.dart';
import 'tracker.dart';
import 'web.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  FlutterForegroundTask.initCommunicationPort();
  SystemChrome.setSystemUIOverlayStyle(const SystemUiOverlayStyle(statusBarColor: umbrellaInk, systemNavigationBarColor: umbrellaInk));
  runApp(const UmbrellaApp());
}

class UmbrellaApp extends StatelessWidget {
  const UmbrellaApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'UMBRELLA',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        brightness: Brightness.dark,
        colorScheme: ColorScheme.fromSeed(seedColor: umbrellaRed, brightness: Brightness.dark, primary: umbrellaRed, onPrimary: Colors.white),
        scaffoldBackgroundColor: umbrellaInk,
      ),
      home: const Root(),
    );
  }
}

enum _Stage { server, permissions, web }

/// Splash for 10 seconds over the already-loading web system, then server setup or permissions on first start.
class Root extends StatefulWidget {
  const Root({super.key});

  @override
  State<Root> createState() => _RootState();
}

class _RootState extends State<Root> {
  SharedPreferences? _prefs;
  bool _splash = true;
  bool _fading = false;

  @override
  void initState() {
    super.initState();
    SharedPreferences.getInstance().then((prefs) async {
      if (prefs.getBool(Keys.cloudServer) != true) {
        await prefs.setString(Keys.server, cloudServer);
        await prefs.setBool(Keys.cloudServer, true);
      }
      setState(() => _prefs = prefs);
      if (prefs.getString(Keys.token) != null && prefs.getBool(Keys.setupDone) == true) startTracker();
    });
  }

  _Stage get _stage {
    final prefs = _prefs!;
    if ((prefs.getString(Keys.server) ?? '').isEmpty) return _Stage.server;
    if (prefs.getBool(Keys.setupDone) != true) return _Stage.permissions;
    return _Stage.web;
  }

  void _endSplash() {
    setState(() => _fading = true);
    Future.delayed(const Duration(milliseconds: 600), () {
      if (mounted) setState(() => _splash = false);
    });
  }

  Future<void> _changeServer() async {
    await _prefs!.setString('last_server', _prefs!.getString(Keys.server) ?? '');
    await _prefs!.remove(Keys.server);
    setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final prefs = _prefs;
    Widget body = const ColoredBox(color: umbrellaInk);
    if (prefs != null) {
      body = switch (_stage) {
        _Stage.server => ServerSetup(current: prefs.getString('last_server'), onSaved: () => setState(() {})),
        _Stage.permissions => PermissionSetup(onDone: () => setState(() {})),
        _Stage.web => WebShell(key: ValueKey(prefs.getString(Keys.server)), server: prefs.getString(Keys.server)!, onChangeServer: _changeServer),
      };
    }
    return Stack(
      children: [
        Positioned.fill(child: body),
        if (_splash)
          Positioned.fill(
            child: IgnorePointer(
              ignoring: _fading,
              child: AnimatedOpacity(
                opacity: _fading ? 0 : 1,
                duration: const Duration(milliseconds: 600),
                curve: Curves.easeOut,
                child: Splash(onDone: _endSplash),
              ),
            ),
          ),
      ],
    );
  }
}
