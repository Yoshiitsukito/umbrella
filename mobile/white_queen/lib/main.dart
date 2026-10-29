import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'api.dart';
import 'pairing.dart';
import 'station.dart';

const ink = Color(0xFF17212B);
const steel = Color(0xFF46627F);
const night = Color(0xFF0B1016);

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await SystemChrome.setPreferredOrientations([DeviceOrientation.portraitUp]);
  await SystemChrome.setEnabledSystemUIMode(SystemUiMode.immersiveSticky);
  final api = Api(await SharedPreferences.getInstance());
  runApp(WhiteQueenApp(api: api));
}

class WhiteQueenApp extends StatelessWidget {
  const WhiteQueenApp({super.key, required this.api});

  final Api api;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'White Queen',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        useMaterial3: true,
        colorScheme: ColorScheme.fromSeed(seedColor: steel, brightness: Brightness.dark),
        scaffoldBackgroundColor: night,
      ),
      home: Gate(api: api),
    );
  }
}

class Gate extends StatefulWidget {
  const Gate({super.key, required this.api});

  final Api api;

  @override
  State<Gate> createState() => _GateState();
}

class _GateState extends State<Gate> {
  late bool _signedIn = widget.api.hasSession;

  @override
  Widget build(BuildContext context) {
    if (_signedIn) {
      return StationScreen(
        api: widget.api,
        onSignedOut: () async {
          await widget.api.dropSession();
          if (mounted) setState(() => _signedIn = false);
        },
      );
    }
    return PairingScreen(api: widget.api, onSignedIn: () => setState(() => _signedIn = true));
  }
}
